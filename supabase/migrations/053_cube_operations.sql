-- Cube automatically maintains internal departmental work queues; no external sends.
BEGIN;

CREATE TABLE IF NOT EXISTS public.cube_departments (
  code text PRIMARY KEY CHECK (code IN ('growth','client_ops','delivery','creative','finance','people','leadership')),
  owner_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  enabled boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS public.cube_control (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  last_error text
);
CREATE TABLE IF NOT EXISTS public.cube_intakes (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  contract_reference text NOT NULL DEFAULT '' CHECK (length(contract_reference) <= 2000),
  brief_confirmed boolean NOT NULL DEFAULT false,
  assets_confirmed boolean NOT NULL DEFAULT false,
  creative_required boolean NOT NULL DEFAULT false,
  creative_approved boolean NOT NULL DEFAULT false,
  qa_confirmed boolean NOT NULL DEFAULT false,
  evidence text NOT NULL DEFAULT '' CHECK (length(evidence) <= 4000),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.cube_work_items (
  key text PRIMARY KEY,
  department text NOT NULL REFERENCES public.cube_departments(code),
  subject_type text NOT NULL CHECK (subject_type IN ('lead','task','project','integration','operation')),
  subject_id text NOT NULL,
  title text NOT NULL,
  instruction text NOT NULL,
  urgency text NOT NULL CHECK (urgency IN ('attention','urgent')),
  owner_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  urgent_since_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cube_work_open_idx ON public.cube_work_items(department,status,urgency);
CREATE TABLE IF NOT EXISTS public.cube_operation_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  work_key text,
  action text NOT NULL,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  at timestamptz NOT NULL DEFAULT now(),
  detail jsonb NOT NULL DEFAULT '{}'
);
ALTER TABLE public.cube_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cube_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cube_intakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cube_work_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cube_operation_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cube_departments,public.cube_control,public.cube_intakes,public.cube_work_items,public.cube_operation_history FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.cube_departments,public.cube_control,public.cube_intakes,public.cube_work_items,public.cube_operation_history TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.cube_departments,public.cube_control,public.cube_intakes,public.cube_work_items,public.cube_operation_history TO service_role;
REVOKE ALL ON SEQUENCE public.cube_operation_history_id_seq FROM PUBLIC,anon,authenticated;
GRANT USAGE,SELECT ON SEQUENCE public.cube_operation_history_id_seq TO service_role;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['cube_departments','cube_control','cube_intakes','cube_work_items','cube_operation_history'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS cube_admin_read ON public.%I',t);
    EXECUTE format('CREATE POLICY cube_admin_read ON public.%I FOR SELECT TO authenticated USING (public.is_admin() AND public.is_active())',t);
    EXECUTE format('DROP POLICY IF EXISTS active_account_only ON public.%I',t);
    EXECUTE format('CREATE POLICY active_account_only ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.is_active())) WITH CHECK ((SELECT public.is_active()))',t);
  END LOOP;
END $$;
INSERT INTO public.cube_control(id) VALUES(true) ON CONFLICT DO NOTHING;
INSERT INTO public.cube_departments(code) VALUES('growth'),('client_ops'),('delivery'),('creative'),('finance'),('people'),('leadership') ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.cube_configure(p_department text,p_owner uuid,p_enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public,pg_temp AS $$
BEGIN
  IF NOT public.is_admin() OR NOT public.is_active() THEN RAISE EXCEPTION 'An active admin is required' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.cube_control WHERE id FOR UPDATE;
  IF p_enabled IS NULL THEN RAISE EXCEPTION 'Choose an execution mode' USING ERRCODE='22023'; END IF;
  IF p_department = 'workspace' THEN
    UPDATE public.cube_control SET enabled=p_enabled WHERE id;
  ELSE
    IF p_owner IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_owner AND role='admin' AND deactivated_at IS NULL) THEN
      RAISE EXCEPTION 'The department owner must be an active admin' USING ERRCODE='22023';
    END IF;
    UPDATE public.cube_departments SET owner_id=p_owner,enabled=p_enabled WHERE code=p_department;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown department' USING ERRCODE='22023'; END IF;
  END IF;
  INSERT INTO public.cube_operation_history(action,actor_id,detail) VALUES('configured',auth.uid(),jsonb_build_object('department',p_department,'ownerId',p_owner,'enabled',p_enabled));
END $$;
REVOKE ALL ON FUNCTION public.cube_configure(text,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cube_configure(text,uuid,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.cube_save_intake(p_project uuid,p_version integer,p_intake jsonb)
RETURNS public.cube_intakes LANGUAGE plpgsql SECURITY DEFINER SET search_path = public,pg_temp AS $$
DECLARE old public.cube_intakes; saved public.cube_intakes; k text;
BEGIN
  IF NOT public.is_admin() OR NOT public.is_active() THEN RAISE EXCEPTION 'An active admin is required' USING ERRCODE='42501'; END IF;
  -- Serialize first saves as well as updates, even before an intake row exists.
  PERFORM 1 FROM public.projects WHERE id=p_project FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project not found' USING ERRCODE='22023'; END IF;
  SELECT * INTO old FROM public.cube_intakes WHERE project_id=p_project;
  IF p_version IS DISTINCT FROM coalesce(old.version,0) THEN RAISE EXCEPTION 'Project intake changed. Reload before saving.' USING ERRCODE='40001'; END IF;
  IF jsonb_typeof(p_intake) IS DISTINCT FROM 'object' OR NOT p_intake ?& ARRAY['contractReference','briefConfirmed','assetsConfirmed','creativeRequired','creativeApproved','qaConfirmed','evidence']
    OR (SELECT count(*) FROM jsonb_object_keys(p_intake)) <> 7 OR jsonb_typeof(p_intake->'contractReference') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_intake->'evidence') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid intake fields' USING ERRCODE='22023'; END IF;
  FOREACH k IN ARRAY ARRAY['briefConfirmed','assetsConfirmed','creativeRequired','creativeApproved','qaConfirmed'] LOOP
    IF jsonb_typeof(p_intake->k) IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid confirmation' USING ERRCODE='22023'; END IF;
  END LOOP;
  IF ((p_intake->>'briefConfirmed')::boolean OR (p_intake->>'assetsConfirmed')::boolean OR (p_intake->>'creativeApproved')::boolean OR (p_intake->>'qaConfirmed')::boolean) AND btrim(p_intake->>'evidence')='' THEN
    RAISE EXCEPTION 'Confirmations require evidence' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.cube_intakes(project_id,version,contract_reference,brief_confirmed,assets_confirmed,creative_required,creative_approved,qa_confirmed,evidence,updated_by)
  VALUES(p_project,p_version+1,btrim(p_intake->>'contractReference'),(p_intake->>'briefConfirmed')::boolean,(p_intake->>'assetsConfirmed')::boolean,(p_intake->>'creativeRequired')::boolean,(p_intake->>'creativeApproved')::boolean,(p_intake->>'qaConfirmed')::boolean,p_intake->>'evidence',auth.uid())
  ON CONFLICT(project_id) DO UPDATE SET version=EXCLUDED.version,contract_reference=EXCLUDED.contract_reference,brief_confirmed=EXCLUDED.brief_confirmed,assets_confirmed=EXCLUDED.assets_confirmed,creative_required=EXCLUDED.creative_required,creative_approved=EXCLUDED.creative_approved,qa_confirmed=EXCLUDED.qa_confirmed,evidence=EXCLUDED.evidence,updated_by=auth.uid(),updated_at=now() RETURNING * INTO saved;
  INSERT INTO public.cube_operation_history(action,actor_id,detail) VALUES('intake_saved',auth.uid(),jsonb_build_object('projectId',p_project,'version',saved.version));
  RETURN saved;
END $$;
REVOKE ALL ON FUNCTION public.cube_save_intake(uuid,integer,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cube_save_intake(uuid,integer,jsonb) TO authenticated;

-- Only the scheduler/service role calls this directly. The authenticated wrapper checks admins.
CREATE OR REPLACE FUNCTION public.cube_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public,pg_temp AS $$
DECLARE today date; fallback uuid;
BEGIN
  -- A single transaction owns evaluation, automatic routing and result history.
  PERFORM 1 FROM public.cube_control WHERE id FOR UPDATE;
  IF NOT (SELECT enabled FROM public.cube_control WHERE id) THEN RETURN; END IF;
  BEGIN
    SELECT (now() AT TIME ZONE (growth_business_hours->>'tz'))::date INTO today FROM public.workspace_settings WHERE id;
    SELECT id INTO fallback FROM public.profiles WHERE role='admin' AND deactivated_at IS NULL ORDER BY created_at,id LIMIT 1;
    UPDATE public.cube_departments SET owner_id=fallback WHERE owner_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=owner_id AND p.role='admin' AND p.deactivated_at IS NULL);
    -- Never reuse a caller-created temporary table inside a privileged function.
    DROP TABLE IF EXISTS pg_temp.cube_next;
    CREATE TEMP TABLE cube_next (
      key text PRIMARY KEY,department text,subject_type text,subject_id text,title text,instruction text,urgency text,owner_id uuid
    ) ON COMMIT DROP;

    INSERT INTO pg_temp.cube_next
    SELECT 'growth:lead:'||l.id,'growth','lead',l.id::text,l.name,
      'Assign an active owner, review the last contact and record the follow-up outcome.',
      CASE WHEN l.follow_up<today OR (l.first_responded_at IS NULL AND l.sla_due_at<=now()) THEN 'urgent' ELSE 'attention' END,l.owner_id
    FROM public.leads l WHERE l.stage NOT IN ('won','lost') AND NOT l.spam AND l.pii_scrubbed_at IS NULL
      AND (l.owner_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=l.owner_id AND p.deactivated_at IS NULL) OR l.follow_up<=today OR (l.first_responded_at IS NULL AND l.sla_due_at<=now()));

    INSERT INTO pg_temp.cube_next
    SELECT 'delivery:task:'||t.id,'delivery','task',t.id::text,t.title,'Resolve the recorded blocker or revise the delivery plan in the source task.',
      CASE WHEN t.due_date<today OR t.priority='high' THEN 'urgent' ELSE 'attention' END,t.assignee_id
    FROM public.tasks t WHERE NOT t.archived AND t.status<>'done' AND (t.status='blocked' OR t.due_date<today);

    INSERT INTO pg_temp.cube_next
    SELECT 'people:task:'||t.id,'people','task',t.id::text,t.title,'Assign an active task owner. Capacity and skill records must be supplied before Cube can balance workload.','attention',NULL::uuid
    FROM public.tasks t WHERE NOT t.archived AND t.status<>'done' AND NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=t.assignee_id AND p.deactivated_at IS NULL);

    INSERT INTO pg_temp.cube_next
    SELECT 'people:project:'||p.id,'people','project',p.id::text,p.title,'Assign an active delivery owner in the source project.','attention',NULL::uuid
    FROM public.projects p WHERE p.status<>'done' AND NOT EXISTS(SELECT 1 FROM public.profiles u WHERE u.id=p.assignee_id AND u.deactivated_at IS NULL);

    INSERT INTO pg_temp.cube_next
    SELECT 'client_ops:project:'||p.id,'client_ops','project',p.id::text,p.title,'Confirm the client brief and required assets in project intake.','attention',p.assignee_id
    FROM public.projects p LEFT JOIN public.cube_intakes i ON i.project_id=p.id WHERE p.status<>'done' AND (NOT coalesce(i.brief_confirmed,false) OR NOT coalesce(i.assets_confirmed,false));

    INSERT INTO pg_temp.cube_next
    SELECT 'creative:project:'||p.id,'creative','project',p.id::text,p.title,'Complete the creative review and record approval in project intake.','attention',NULL::uuid
    FROM public.projects p JOIN public.cube_intakes i ON i.project_id=p.id WHERE p.status<>'done' AND i.creative_required AND NOT i.creative_approved;

    INSERT INTO pg_temp.cube_next
    SELECT 'finance:project:'||p.id,'finance','project',p.id::text,p.title,
      CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(e.terms->'invoices') inv WHERE (inv->>'dueDate')::date<today AND coalesce((SELECT sum((r->>'amountMinor')::numeric) FROM jsonb_array_elements(e.terms->'payments') r WHERE r->>'invoiceId'=inv->>'id'),0)<(inv->>'amountMinor')::numeric) THEN 'Reconcile the overdue invoice against confirmed receipts.'
        WHEN coalesce(i.contract_reference,'')='' THEN 'Contract pending: add the real agreement reference when supplied. A reference alone does not record acceptance.'
        WHEN e.id IS NULL OR coalesce(e.terms->>'scope','')='' OR coalesce(e.terms->>'acceptanceEvidence','')='' OR coalesce(e.terms->>'acceptedOn','')='' THEN 'Create the engagement and record scope, acceptance and deposit evidence.'
        WHEN coalesce((SELECT sum((r->>'amountMinor')::numeric) FROM jsonb_array_elements(e.terms->'payments') r),0)<(e.terms->>'depositMinor')::numeric THEN 'Record the agreed deposit before kickoff.'
        ELSE 'Reconcile the overdue invoice against confirmed receipts.' END,
      CASE WHEN p.status='in_progress' OR EXISTS(SELECT 1 FROM jsonb_array_elements(e.terms->'invoices') inv WHERE (inv->>'dueDate')::date<today AND coalesce((SELECT sum((r->>'amountMinor')::numeric) FROM jsonb_array_elements(e.terms->'payments') r WHERE r->>'invoiceId'=inv->>'id'),0)<(inv->>'amountMinor')::numeric) THEN 'urgent' ELSE 'attention' END,NULL::uuid
    FROM public.projects p LEFT JOIN public.cube_intakes i ON i.project_id=p.id LEFT JOIN public.project_engagements e ON e.project_id=p.id
    WHERE (p.status<>'done' AND (coalesce(i.contract_reference,'')='' OR e.id IS NULL OR btrim(e.terms->>'scope')='' OR btrim(e.terms->>'acceptanceEvidence')='' OR e.terms->>'acceptedOn'=''
      OR coalesce((SELECT sum((r->>'amountMinor')::numeric) FROM jsonb_array_elements(e.terms->'payments') r),0)<(e.terms->>'depositMinor')::numeric))
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(e.terms->'invoices') inv WHERE (inv->>'dueDate')::date<today AND coalesce((SELECT sum((r->>'amountMinor')::numeric) FROM jsonb_array_elements(e.terms->'payments') r WHERE r->>'invoiceId'=inv->>'id'),0)<(inv->>'amountMinor')::numeric);

    INSERT INTO pg_temp.cube_next
    SELECT 'delivery:project:'||p.id,'delivery','project',p.id::text,p.title,
      CASE WHEN e.terms->>'phase'='active' THEN 'Complete delivery QA and record its evidence before final handoff.' ELSE 'Intake and Finance prerequisites are recorded. Accept the delivery handoff and start the engagement in the project panel.' END,'attention',p.assignee_id
    FROM public.projects p JOIN public.project_engagements e ON e.project_id=p.id JOIN public.cube_intakes i ON i.project_id=p.id
    WHERE p.status<>'done' AND ((e.terms->>'phase'='active' AND NOT i.qa_confirmed) OR (e.terms->>'phase'='planning' AND i.contract_reference<>'' AND i.brief_confirmed AND i.assets_confirmed AND (NOT i.creative_required OR i.creative_approved)
      AND btrim(e.terms->>'scope')<>'' AND btrim(e.terms->>'acceptanceEvidence')<>'' AND e.terms->>'acceptedOn'<>''
      AND coalesce((SELECT sum((r->>'amountMinor')::numeric) FROM jsonb_array_elements(e.terms->'payments') r),0)>=(e.terms->>'depositMinor')::numeric
      AND EXISTS(SELECT 1 FROM public.profiles u WHERE u.id=p.assignee_id AND u.deactivated_at IS NULL)));

    INSERT INTO pg_temp.cube_next
    SELECT 'leadership:integration:'||job,'leadership','integration',job,'Integration: '||job,'Review the integration run log: '||status||'. Cube does not treat untested credentials or absent run evidence as working.','attention',NULL::uuid
    FROM public.automation_health WHERE status IN ('failing','stale','never');

    DELETE FROM pg_temp.cube_next n WHERE NOT EXISTS(SELECT 1 FROM public.cube_departments d WHERE d.code=n.department AND d.enabled);
    INSERT INTO pg_temp.cube_next
    SELECT 'leadership:operation:'||n.key,'leadership','operation',n.key,'Escalation: '||n.title,'An urgent departmental exception has remained open for 24 hours. Coordinate the responsible department.','attention',NULL::uuid
    FROM pg_temp.cube_next n JOIN public.cube_work_items old ON old.key=n.key WHERE n.department<>'leadership' AND n.urgency='urgent' AND old.urgency='urgent' AND old.status='open' AND old.urgent_since_at<=now()-interval '24 hours'
      AND (SELECT enabled FROM public.cube_departments WHERE code='leadership');

    UPDATE pg_temp.cube_next n SET owner_id=d.owner_id FROM public.cube_departments d WHERE d.code=n.department AND
      (n.department IN ('finance','leadership') OR NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=n.owner_id AND p.deactivated_at IS NULL));
    INSERT INTO public.cube_operation_history(work_key,action,detail)
    SELECT n.key,CASE WHEN old.key IS NULL THEN 'created' WHEN old.status='resolved' THEN 'reopened' ELSE 'updated' END,jsonb_build_object('department',n.department,'ownerId',n.owner_id)
    FROM pg_temp.cube_next n LEFT JOIN public.cube_work_items old ON old.key=n.key
    WHERE old.key IS NULL OR old.status<>'open' OR (old.owner_id,old.title,old.instruction,old.urgency) IS DISTINCT FROM (n.owner_id,n.title,n.instruction,n.urgency);
    INSERT INTO public.cube_work_items(key,department,subject_type,subject_id,title,instruction,urgency,owner_id,urgent_since_at)
    SELECT key,department,subject_type,subject_id,title,instruction,urgency,owner_id,CASE WHEN urgency='urgent' THEN now() ELSE NULL END FROM pg_temp.cube_next
    ON CONFLICT(key) DO UPDATE SET title=EXCLUDED.title,instruction=EXCLUDED.instruction,urgency=EXCLUDED.urgency,owner_id=EXCLUDED.owner_id,status='open',
      first_seen_at=CASE WHEN cube_work_items.status='open' THEN cube_work_items.first_seen_at ELSE now() END,
      urgent_since_at=CASE WHEN EXCLUDED.urgency<>'urgent' THEN NULL WHEN cube_work_items.status='open' AND cube_work_items.urgency='urgent' THEN coalesce(cube_work_items.urgent_since_at,now()) ELSE now() END,updated_at=now();
    INSERT INTO public.cube_operation_history(work_key,action)
    SELECT w.key,'resolved' FROM public.cube_work_items w JOIN public.cube_departments d ON d.code=w.department
      WHERE d.enabled AND w.status='open' AND NOT EXISTS(SELECT 1 FROM pg_temp.cube_next n WHERE n.key=w.key)
      AND NOT (w.subject_type='operation' AND EXISTS(SELECT 1 FROM public.cube_work_items parent JOIN public.cube_departments pd ON pd.code=parent.department WHERE parent.key=w.subject_id AND NOT pd.enabled));
    UPDATE public.cube_work_items w SET status='resolved',updated_at=now() FROM public.cube_departments d
      WHERE d.code=w.department AND d.enabled AND w.status='open' AND NOT EXISTS(SELECT 1 FROM pg_temp.cube_next n WHERE n.key=w.key)
      AND NOT (w.subject_type='operation' AND EXISTS(SELECT 1 FROM public.cube_work_items parent JOIN public.cube_departments pd ON pd.code=parent.department WHERE parent.key=w.subject_id AND NOT pd.enabled));
    UPDATE public.cube_control SET last_run_at=now(),last_error=NULL WHERE id;
  EXCEPTION WHEN OTHERS THEN
    -- Failed evaluation rolls back its entire inner transaction; never resolve from incomplete sources.
    UPDATE public.cube_control SET last_error='Cube evaluation failed. Review the database scheduler logs; existing work is unchanged.' WHERE id;
  END;
END $$;
REVOKE ALL ON FUNCTION public.cube_tick() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cube_tick() TO service_role;

CREATE OR REPLACE FUNCTION public.cube_run()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public,pg_temp AS $$
BEGIN
  IF NOT public.is_admin() OR NOT public.is_active() THEN RAISE EXCEPTION 'An active admin is required' USING ERRCODE='42501'; END IF;
  PERFORM public.cube_tick();
END $$;
REVOKE ALL ON FUNCTION public.cube_run() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cube_run() TO authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('cube-operations','* * * * *','SELECT public.cube_tick();');
COMMIT;
