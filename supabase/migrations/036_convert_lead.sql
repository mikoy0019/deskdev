-- ============================================
-- DeskDev Studio — 036: convert_lead
--
-- Winning a lead used to be four separate client writes in the app
-- (useStore.convertLeadToClient): add a client, link it, move the stage, log.
-- It checked no clients permission, could stop half-way (a client with no
-- lead link, or a won lead with no client) and created no project.
--
-- convert_lead(p_lead_id, p_service) does all of it in one transaction:
--   - the client: the lead's linked client, else the existing client the
--     intake matched by email (an upsell), else a new one from the lead
--   - a project "<Company> - <Service>" in planning, owned by the lead owner
--   - starter tasks for that service (kickoff, access request into the
--     Vault, discovery doc, plus two service-specific ones)
--   - the lead: client_id set, stage won, first response stamped
--   - lead_activity: stage_changed + won (when the stage moves) and
--     'converted' with {client_id, project_id, service}
-- Idempotent: a second call (double click, retry after a timeout, two
-- people at once) returns the first conversion's ids and writes nothing.
-- Permission: growth:edit AND clients:edit, or an admin. It is SECURITY
-- DEFINER, so the caller does not also need projects:edit or tasks:edit:
-- converting is a Growth action and the result is visible to whoever can
-- see projects.
-- Returns {client_id, project_id, already_converted}.
-- Local (no Supabase) mode keeps the app's own client-side path.
-- Depends on 034. Re-runnable.
-- ============================================

-- Human label for a service slug, used in the project title. Same labels as
-- lib/leads.ts LEAD_SERVICES, so the local-mode title matches.
CREATE OR REPLACE FUNCTION public.lead_service_label(p_service text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE lower(btrim(coalesce(p_service, '')))
    WHEN ''           THEN 'Project'
    WHEN 'website'    THEN 'Website'
    WHEN 'app'        THEN 'App / dashboard'
    WHEN 'automation' THEN 'Automation & AI'
    WHEN 'developer'  THEN 'Dedicated developer'
    ELSE initcap(replace(left(lower(btrim(p_service)), 40), '_', ' '))
  END;
$$;

REVOKE ALL ON FUNCTION public.lead_service_label(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_service_label(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.convert_lead(p_lead_id uuid, p_service text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_lead     public.leads%ROWTYPE;
  v_done     jsonb;
  v_service  text;
  v_label    text;
  v_company  text;
  v_client   uuid;
  v_new_client boolean := false;
  v_project  uuid;
  v_task     uuid;
  v_titles   text[];
  i          integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to convert a lead' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_admin()
          OR (public.has_perm('growth', 'edit') AND public.has_perm('clients', 'edit'))) THEN
    RAISE EXCEPTION 'Converting a lead needs Growth and Clients edit access' USING ERRCODE = '42501';
  END IF;

  -- The row lock makes concurrent conversions queue; the second one then
  -- sees the first one's 'converted' row below.
  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_lead.spam THEN
    RAISE EXCEPTION 'Mark this lead as not spam before converting it' USING ERRCODE = '22023';
  END IF;

  SELECT a.detail INTO v_done
    FROM public.lead_activity a
   WHERE a.lead_id = p_lead_id AND a.action = 'converted'
   ORDER BY a.created_at DESC
   LIMIT 1;
  IF v_done IS NOT NULL THEN
    RETURN jsonb_build_object(
      'client_id', v_done ->> 'client_id',
      'project_id', v_done ->> 'project_id',
      'already_converted', true);
  END IF;

  v_service := nullif(left(regexp_replace(lower(btrim(coalesce(p_service, ''))), '[^a-z0-9]+', '_', 'g'), 40), '');
  v_service := coalesce(v_service, v_lead.services[1]);
  v_label   := public.lead_service_label(v_service);

  -- ---- Client: linked, else matched at intake, else new. An existing
  -- client's own company name wins over whatever the enquiry said.
  SELECT c.id, coalesce(nullif(btrim(c.company), ''), nullif(btrim(c.name), ''))
    INTO v_client, v_company
    FROM public.clients c
   WHERE c.id = coalesce(v_lead.client_id, v_lead.existing_client_id);
  v_company := coalesce(v_company, nullif(btrim(v_lead.company), ''), nullif(btrim(v_lead.name), ''), 'New client');
  IF v_client IS NULL THEN
    INSERT INTO public.clients (name, company, email, phone, notes)
    VALUES (coalesce(nullif(btrim(v_lead.name), ''), 'New client'),
            v_lead.company, v_lead.email, v_lead.phone,
            left('Converted from a Growth lead (' || v_lead.source || ')'
                 || CASE WHEN v_lead.notes IS NOT NULL AND btrim(v_lead.notes) <> ''
                         THEN E'\n\n' || v_lead.notes ELSE '' END, 5000))
    RETURNING id INTO v_client;
    v_new_client := true;
  END IF;

  -- ---- Project.
  INSERT INTO public.projects (client_id, title, status, assignee_id, created_by, budget, notes, start_date)
  VALUES (v_client,
          left(v_company || ' - ' || v_label, 200),
          'planning',
          v_lead.owner_id,
          v_uid,
          CASE WHEN v_lead.value > 0 THEN v_lead.value END,
          CASE WHEN v_lead.message IS NOT NULL
               THEN left('From the enquiry:' || E'\n' || v_lead.message, 5000) END,
          current_date)
  RETURNING id INTO v_project;

  -- ---- Starter tasks: three for every engagement, two per service.
  v_titles := ARRAY[
    'Kickoff call with ' || v_company,
    'Request access and store credentials in the Vault',
    'Write the discovery doc'
  ] || CASE v_service
    WHEN 'website'    THEN ARRAY['Collect brand assets and page content', 'Agree the sitemap and page list']
    WHEN 'app'        THEN ARRAY['Define user roles and core flows', 'Draft the data model']
    WHEN 'automation' THEN ARRAY['Map the current process and tools', 'List the integrations and API access needed']
    WHEN 'developer'  THEN ARRAY['Onboard the developer to the client''s tools', 'Agree the weekly reporting cadence']
    ELSE ARRAY[]::text[]
  END;

  FOR i IN 1 .. cardinality(v_titles) LOOP
    INSERT INTO public.tasks (client_id, project_id, title, status, priority, assignee_id, created_by, position)
    VALUES (v_client, v_project, left(v_titles[i], 200), 'todo',
            CASE WHEN i = 1 THEN 'high' ELSE 'med' END,
            v_lead.owner_id, v_uid, i - 1)
    RETURNING id INTO v_task;
    INSERT INTO public.task_activity (task_id, client_id, actor_id, action, detail)
    VALUES (v_task, v_client, v_uid, 'created',
            jsonb_build_object('title', left(v_titles[i], 200), 'from_lead', p_lead_id));
  END LOOP;

  -- ---- The lead.
  UPDATE public.leads
     SET client_id          = v_client,
         stage              = 'won',
         lost_reason        = NULL,
         first_responded_at = coalesce(first_responded_at, now()),
         last_touch_at      = now()
   WHERE id = p_lead_id;

  IF v_lead.stage IS DISTINCT FROM 'won' THEN
    INSERT INTO public.lead_activity (lead_id, actor_id, action, detail)
    VALUES (p_lead_id, v_uid, 'stage_changed', jsonb_build_object('from', v_lead.stage, 'to', 'won'));
    INSERT INTO public.lead_activity (lead_id, actor_id, action, detail)
    VALUES (p_lead_id, v_uid, 'won',
            jsonb_build_object('name', v_lead.name, 'value', v_lead.value, 'source', v_lead.source));
  END IF;

  INSERT INTO public.lead_activity (lead_id, actor_id, action, detail)
  VALUES (p_lead_id, v_uid, 'converted', jsonb_build_object(
    'client_id', v_client, 'project_id', v_project, 'service', v_service,
    'new_client', v_new_client, 'tasks', cardinality(v_titles)));

  RETURN jsonb_build_object('client_id', v_client, 'project_id', v_project, 'already_converted', false);
END;
$$;

REVOKE ALL ON FUNCTION public.convert_lead(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_lead(uuid, text) TO authenticated;
