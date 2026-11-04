-- Internal agreement, delivery and receipt records. No payment processing or e-signing.
BEGIN;

CREATE TABLE IF NOT EXISTS public.project_engagements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL UNIQUE REFERENCES public.projects(id) ON DELETE RESTRICT,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  terms jsonb NOT NULL,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.project_engagements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.project_engagements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.project_engagements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_engagements TO service_role;

-- Finance records are admin-only, even when project details are shared with members.
DROP POLICY IF EXISTS engagements_admin_read ON public.project_engagements;
CREATE POLICY engagements_admin_read ON public.project_engagements FOR SELECT TO authenticated
  USING (public.is_admin());
DROP POLICY IF EXISTS active_account_only ON public.project_engagements;
CREATE POLICY active_account_only ON public.project_engagements AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_active())) WITH CHECK ((SELECT public.is_active()));

CREATE OR REPLACE FUNCTION public.validate_engagement_terms(p_terms jsonb, p_previous jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  item jsonb;
  old_item jsonb;
  k text;
  total_invoiced numeric := 0;
  total_collected numeric := 0;
  paid numeric;
  d text;
BEGIN
  IF jsonb_typeof(p_terms) IS DISTINCT FROM 'object'
    OR NOT p_terms ?& ARRAY['currency','feeMinor','depositMinor','scope','acceptanceEvidence','acceptedOn','phase','milestones','invoices','payments']
    OR (SELECT count(*) FROM jsonb_object_keys(p_terms)) <> 10 THEN
    RAISE EXCEPTION 'Invalid engagement fields' USING ERRCODE = '22023';
  END IF;
  FOREACH k IN ARRAY ARRAY['currency','scope','acceptanceEvidence','acceptedOn','phase'] LOOP
    IF jsonb_typeof(p_terms->k) IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'Invalid text field: %', k USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF p_terms->>'currency' NOT IN ('USD','PHP','EUR','GBP','AUD','CAD')
    OR p_terms->>'phase' NOT IN ('planning','active','completed')
    OR length(p_terms->>'scope') > 12000 OR length(p_terms->>'acceptanceEvidence') > 2000 THEN
    RAISE EXCEPTION 'Invalid currency, phase or scope length' USING ERRCODE = '22023';
  END IF;
  FOREACH k IN ARRAY ARRAY['feeMinor','depositMinor'] LOOP
    IF jsonb_typeof(p_terms->k) IS DISTINCT FROM 'number' OR (p_terms->>k) !~ '^[0-9]{1,12}$' THEN
      RAISE EXCEPTION 'Amounts must be non-negative integer minor units' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF (p_terms->>'depositMinor')::numeric > (p_terms->>'feeMinor')::numeric THEN
    RAISE EXCEPTION 'The deposit cannot exceed the agreed fee' USING ERRCODE = '22023';
  END IF;
  d := p_terms->>'acceptedOn';
  IF (d <> '') <> (btrim(p_terms->>'acceptanceEvidence') <> '') OR
    (d <> '' AND (btrim(p_terms->>'scope') = '' OR d !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR d::date > (now() AT TIME ZONE 'UTC')::date)) THEN
    RAISE EXCEPTION 'Record scope, acceptance evidence and a valid past acceptance date together' USING ERRCODE = '22023';
  END IF;
  FOREACH k IN ARRAY ARRAY['milestones','invoices','payments'] LOOP
    IF jsonb_typeof(p_terms->k) IS DISTINCT FROM 'array' OR jsonb_array_length(p_terms->k) > 100 THEN
      RAISE EXCEPTION 'Lists must contain at most 100 records' USING ERRCODE = '22023';
    END IF;
    IF (SELECT count(*) FROM jsonb_array_elements(p_terms->k)) <>
       (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_terms->k)) THEN
      RAISE EXCEPTION 'Record ids must be unique' USING ERRCODE = '22023';
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(p_terms->k) LOOP
      IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR jsonb_typeof(item->'id') IS DISTINCT FROM 'string'
        OR length(btrim(item->>'id')) NOT BETWEEN 1 AND 100 THEN
        RAISE EXCEPTION 'Each record needs an id' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(p_terms->'milestones') LOOP
    IF NOT item ?& ARRAY['id','title','dueDate','status','approvalEvidence']
      OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 5
      OR jsonb_typeof(item->'title') IS DISTINCT FROM 'string' OR length(btrim(item->>'title')) NOT BETWEEN 1 AND 200
      OR jsonb_typeof(item->'approvalEvidence') IS DISTINCT FROM 'string' OR length(item->>'approvalEvidence') > 2000
      OR coalesce(item->>'status','') NOT IN ('planned','review','approved')
      OR jsonb_typeof(item->'dueDate') IS DISTINCT FROM 'string' OR (item->>'dueDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'Invalid milestone' USING ERRCODE = '22023';
    END IF;
    PERFORM (item->>'dueDate')::date;
    IF item->>'status' = 'approved' AND btrim(item->>'approvalEvidence') = '' THEN
      RAISE EXCEPTION 'Approved milestones need approval evidence' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['invoices','payments'] LOOP
    IF (SELECT count(*) FROM jsonb_array_elements(p_terms->k)) <>
      (SELECT count(DISTINCT lower(btrim(value->>'reference'))) FROM jsonb_array_elements(p_terms->k)) THEN
      RAISE EXCEPTION 'References must be unique' USING ERRCODE = '22023';
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(p_terms->k) LOOP
      IF jsonb_typeof(item->'reference') IS DISTINCT FROM 'string' OR length(btrim(item->>'reference')) NOT BETWEEN 1 AND 200
        OR jsonb_typeof(item->'amountMinor') IS DISTINCT FROM 'number' OR (item->>'amountMinor') !~ '^[0-9]{1,12}$'
        OR (item->>'amountMinor')::numeric <= 0 THEN
        RAISE EXCEPTION 'Each invoice or receipt needs a reference and positive amount' USING ERRCODE = '22023';
      END IF;
      IF k = 'invoices' THEN
        IF NOT item ?& ARRAY['id','reference','amountMinor','dueDate'] OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 4
          OR jsonb_typeof(item->'dueDate') IS DISTINCT FROM 'string' OR (item->>'dueDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
          RAISE EXCEPTION 'Invalid invoice' USING ERRCODE = '22023';
        END IF;
        PERFORM (item->>'dueDate')::date;
        total_invoiced := total_invoiced + (item->>'amountMinor')::numeric;
        SELECT coalesce(sum((value->>'amountMinor')::numeric),0) INTO paid
          FROM jsonb_array_elements(p_terms->'payments') WHERE value->>'invoiceId' = item->>'id';
        IF paid > (item->>'amountMinor')::numeric THEN
          RAISE EXCEPTION 'Payments cannot exceed their invoice amount' USING ERRCODE = '22023';
        END IF;
      ELSE
        IF NOT item ?& ARRAY['id','invoiceId','reference','amountMinor','receivedOn'] OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 5
          OR jsonb_typeof(item->'receivedOn') IS DISTINCT FROM 'string' OR (item->>'receivedOn') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          OR (item->>'receivedOn')::date > (now() AT TIME ZONE 'UTC')::date
          OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_terms->'invoices') WHERE value->>'id' = item->>'invoiceId') THEN
          RAISE EXCEPTION 'Invalid receipt date or invoice' USING ERRCODE = '22023';
        END IF;
        total_collected := total_collected + (item->>'amountMinor')::numeric;
      END IF;
    END LOOP;
  END LOOP;
  IF total_invoiced > (p_terms->>'feeMinor')::numeric THEN
    RAISE EXCEPTION 'Invoices cannot exceed the agreed fee' USING ERRCODE = '22023';
  END IF;
  IF p_previous IS NOT NULL THEN
    IF p_previous->>'acceptedOn' <> '' THEN
      FOREACH k IN ARRAY ARRAY['currency','feeMinor','depositMinor','scope','acceptanceEvidence','acceptedOn'] LOOP
        IF p_terms->k IS DISTINCT FROM p_previous->k THEN
          RAISE EXCEPTION 'Accepted terms are locked' USING ERRCODE = '22023';
        END IF;
      END LOOP;
    END IF;
    FOREACH k IN ARRAY ARRAY['invoices','payments'] LOOP
      FOR old_item IN SELECT value FROM jsonb_array_elements(p_previous->k) LOOP
        IF NOT (p_terms->k @> jsonb_build_array(old_item)) THEN
          RAISE EXCEPTION 'Saved invoices and receipts cannot be changed or removed' USING ERRCODE = '22023';
        END IF;
      END LOOP;
    END LOOP;
    IF p_previous->>'phase' = 'completed' AND
      (p_terms->>'phase' <> 'completed' OR p_terms->'milestones' IS DISTINCT FROM p_previous->'milestones') THEN
      RAISE EXCEPTION 'Completed delivery is locked' USING ERRCODE = '22023';
    END IF;
    IF p_previous->>'phase' = 'active' AND p_terms->>'phase' = 'planning' THEN
      RAISE EXCEPTION 'An active engagement cannot return to planning' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_terms->>'phase' <> 'planning' AND
    (d = '' OR total_collected < (p_terms->>'depositMinor')::numeric) THEN
    RAISE EXCEPTION 'Accepted scope and recorded deposit are required before kickoff' USING ERRCODE = '22023';
  END IF;
  IF p_terms->>'phase' = 'completed' AND (jsonb_array_length(p_terms->'milestones') = 0 OR
    EXISTS (SELECT 1 FROM jsonb_array_elements(p_terms->'milestones') WHERE value->>'status' <> 'approved')) THEN
    RAISE EXCEPTION 'Approve every milestone before completing delivery' USING ERRCODE = '22023';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_engagement_terms(jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_engagement_terms(jsonb,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.save_project_engagement(p_project_id uuid, p_version integer, p_terms jsonb)
RETURNS public.project_engagements LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  previous public.project_engagements;
  saved public.project_engagements;
BEGIN
  IF NOT public.is_admin() OR NOT public.is_active() THEN
    RAISE EXCEPTION 'Only an active admin can manage engagements' USING ERRCODE = '42501';
  END IF;
  -- Lock the parent even on first create; two simultaneous creates cannot overwrite each other.
  PERFORM 1 FROM public.projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project not found' USING ERRCODE = '22023'; END IF;
  SELECT * INTO previous FROM public.project_engagements WHERE project_id = p_project_id FOR UPDATE;
  IF p_version IS DISTINCT FROM coalesce(previous.version,0) THEN
    RAISE EXCEPTION 'This engagement changed. Reload it before saving.' USING ERRCODE = '40001';
  END IF;
  PERFORM public.validate_engagement_terms(p_terms,previous.terms);
  IF previous.id IS NULL THEN
    INSERT INTO public.project_engagements(project_id,lead_id,terms,updated_by)
      VALUES(p_project_id,
        (SELECT lead_id FROM public.lead_activity WHERE action = 'converted' AND detail->>'project_id' = p_project_id::text ORDER BY created_at DESC LIMIT 1),
        p_terms,auth.uid()) RETURNING * INTO saved;
  ELSE
    UPDATE public.project_engagements SET terms = p_terms, version = version + 1, updated_by = auth.uid(), updated_at = clock_timestamp()
      WHERE id = previous.id RETURNING * INTO saved;
  END IF;
  PERFORM public.write_audit_log('engagement.saved','project_engagement',saved.id::text,
    jsonb_build_object('project_id',p_project_id,'version',saved.version,'before',previous.terms,'after',saved.terms),auth.uid());
  RETURN saved;
END;
$$;
REVOKE ALL ON FUNCTION public.save_project_engagement(uuid,integer,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_project_engagement(uuid,integer,jsonb) TO authenticated, service_role;

ALTER TABLE public.project_engagements REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'project_engagements') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.project_engagements;
  END IF;
END $$;
COMMIT;
