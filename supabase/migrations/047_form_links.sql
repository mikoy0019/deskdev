-- ============================================
-- DeskDev Studio — 047: customer quick-form links
--
--   form_responses.share_token_hash    sha256 (hex) of a private link's token;
--                                      the token itself is never stored
--   form_responses.share_expires_at    when the link stops working
--   form_responses.shared_at / _by     stamped by the server when a new link
--                                      is made
--   form_responses.shared_to           the address the team meant to send it to
--   form_responses.customer_submitted_at  when the customer sent it back (one
--                                      submission per link)
--   guard_form_response()              046's guard, plus the share stamps
--   form_link_read(secret, token)      the response behind a link, for the site
--   form_link_submit(secret, token, answers, title)
--                                      the customer's answers in, the team told
--   lead_activity_action_check         + 'form_submitted'
--
-- How a link works:
--   1. A signed-in editor makes a link in DeskDev: the app draws a random
--      token, stores only its sha256 (share_token_hash) with an expiry, and
--      shows the URL nixgensolutions.com/f/<token> once. The guard stamps
--      shared_at / shared_by and reopens the form for the customer
--      (customer_submitted_at back to NULL). Revoking sets the hash to NULL.
--   2. The customer opens the link. The site's server (the /f page and the
--      /api/forms route, holding the Worker secret LEAD_INTAKE_SECRET) calls
--      form_link_read with the anon key + that secret. The RPC returns the
--      full answers; the site server keeps the template's customer fields
--      only (site/src/deskdev/lib/forms.ts customerAnswers) before anything
--      reaches a browser, so internal notes never leave the server.
--   3. The customer submits. The site server cleans the answers down to the
--      customer fields and calls form_link_submit: the answers merge into the
--      response (status unchanged — the team reviews and completes it in
--      DeskDev, which is what writes bound answers onto the lead, client or
--      project), customer_submitted_at closes the link, the team is notified
--      ('form_submitted') and a lead-anchored response logs lead activity.
--
-- Why a secret on top of the token: the RPCs return answers that include the
-- team's internal notes, and the filtering lives in the site's TypeScript.
-- Without the secret, anyone holding a link could call the RPC directly and
-- read them. Same Vault secret and fail-closed check as 034's
-- intake_site_lead ('lead_intake_secret').
--
-- Anon doors: form_link_read and form_link_submit are granted to anon on
-- purpose (the site Worker holds only the anon key), like the doors 043
-- keeps (intake_site_lead, intake_subscriber, calendar_feed); each checks
-- the secret before anything else. 043's list names these two as well, so
-- applying 043 again later (its emergency "back on") leaves them granted.
--
-- Notification vocabulary: notifications.type has no CHECK constraint; the
-- app-side vocabulary is 033's guard_notification_insert(), which returns
-- early when auth.uid() is NULL. The site calls these RPCs with the anon key
-- (no JWT subject), so the NULL-actor 'form_submitted' rows pass untouched,
-- like 034's intake and 035's cron rows. The app never sends that type
-- itself, so it is deliberately not added to the guard's app list.
--
-- Depends on 032 (profiles.deactivated_at), 033 (user_has_perm), 034
-- (lead_intake_secret in Vault, lead_activity_action_check), 046
-- (form_responses, guard_form_response). Re-runnable: IF NOT EXISTS /
-- OR REPLACE / DROP … IF EXISTS throughout.
-- ============================================

-- ---------- 1. Share columns ----------
ALTER TABLE public.form_responses ADD COLUMN IF NOT EXISTS share_token_hash text;
ALTER TABLE public.form_responses ADD COLUMN IF NOT EXISTS share_expires_at timestamptz;
ALTER TABLE public.form_responses ADD COLUMN IF NOT EXISTS shared_at timestamptz;
ALTER TABLE public.form_responses ADD COLUMN IF NOT EXISTS shared_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL;
ALTER TABLE public.form_responses ADD COLUMN IF NOT EXISTS shared_to text;
ALTER TABLE public.form_responses ADD COLUMN IF NOT EXISTS customer_submitted_at timestamptz;

ALTER TABLE public.form_responses DROP CONSTRAINT IF EXISTS form_responses_share_check;
ALTER TABLE public.form_responses
  ADD CONSTRAINT form_responses_share_check
  CHECK (share_token_hash IS NULL OR (share_token_hash ~ '^[0-9a-f]{64}$' AND share_expires_at IS NOT NULL));

ALTER TABLE public.form_responses DROP CONSTRAINT IF EXISTS form_responses_shared_to_check;
ALTER TABLE public.form_responses
  ADD CONSTRAINT form_responses_shared_to_check
  CHECK (shared_to IS NULL OR char_length(shared_to) <= 254);

-- One live link per hash (a collision would be a 256-bit coincidence; the
-- index is what the RPCs look the token up by).
CREATE UNIQUE INDEX IF NOT EXISTS form_responses_share_token_key
  ON public.form_responses (share_token_hash) WHERE share_token_hash IS NOT NULL;

-- ---------- 2. The guard: 046's rules + the share stamps ----------
-- Everything 046 did, unchanged (created_by and the submitted stamps are the
-- server's; the form key can't change). Added, for client callers only:
--   new link (share_token_hash changed to a non-null value)
--       shared_at = now(), shared_by = auth.uid(), customer_submitted_at = NULL
--   anything else          shared_at / shared_by / customer_submitted_at kept
--   insert                 customer_submitted_at NULL; shared_* stamped only
--                          when the row is inserted with a link
-- Trusted callers (form_link_submit, cron, the service role) pass through,
-- which is how customer_submitted_at gets written at all.
CREATE OR REPLACE FUNCTION public.guard_form_response()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_client boolean := current_user IN ('authenticated', 'anon');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_client THEN
      NEW.created_by := auth.uid();
      NEW.created_at := now();
      NEW.customer_submitted_at := NULL;
      IF NEW.share_token_hash IS NOT NULL THEN
        NEW.shared_at := now();
        NEW.shared_by := auth.uid();
      ELSE
        NEW.shared_at := NULL;
        NEW.shared_by := NULL;
      END IF;
    END IF;
    IF NEW.status = 'submitted' THEN
      IF v_client OR NEW.submitted_at IS NULL THEN
        NEW.submitted_at := now();
      END IF;
      IF v_client OR NEW.submitted_by IS NULL THEN
        NEW.submitted_by := auth.uid();
      END IF;
    ELSE
      NEW.submitted_at := NULL;
      NEW.submitted_by := NULL;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  NEW.form := OLD.form;
  IF v_client THEN
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    IF NEW.share_token_hash IS NOT NULL
       AND NEW.share_token_hash IS DISTINCT FROM OLD.share_token_hash THEN
      NEW.shared_at := now();
      NEW.shared_by := auth.uid();
      NEW.customer_submitted_at := NULL;
    ELSE
      NEW.shared_at := OLD.shared_at;
      NEW.shared_by := OLD.shared_by;
      NEW.customer_submitted_at := OLD.customer_submitted_at;
    END IF;
  END IF;
  IF NEW.status = 'draft' THEN
    NEW.submitted_at := NULL;
    NEW.submitted_by := NULL;
  ELSIF OLD.status <> 'submitted' THEN
    -- draft → submitted
    IF v_client OR NEW.submitted_at IS NULL THEN
      NEW.submitted_at := now();
    END IF;
    IF v_client OR NEW.submitted_by IS NULL THEN
      NEW.submitted_by := auth.uid();
    END IF;
  ELSIF v_client THEN
    NEW.submitted_at := OLD.submitted_at;
    NEW.submitted_by := OLD.submitted_by;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_form_response() FROM PUBLIC, anon, authenticated;
-- The trigger itself (form_responses_guard, BEFORE INSERT OR UPDATE) is 046's
-- and already points at this function.

-- ---------- 3. lead_activity: + 'form_submitted' ----------
-- 034's full list (the only definition since), plus the customer sending a
-- form back. 035's n8n log trigger and 034's SLA trigger both filter by
-- action, so neither reacts to it.
ALTER TABLE public.lead_activity DROP CONSTRAINT IF EXISTS lead_activity_action_check;
ALTER TABLE public.lead_activity ADD CONSTRAINT lead_activity_action_check
  CHECK (action IN (
    'created', 'stage_changed', 'contacted', 'note', 'won', 'lost',
    'submitted', 'resubmitted', 'assigned', 'sla_breached', 'spam_marked',
    'not_spam', 'proposal_sent', 'auto_reply_sent', 'email_received',
    'email_sent', 'meeting_booked', 'converted', 'followup_set',
    'booking_link_sent', 'call_logged',
    'form_submitted'
  ));

-- ---------- 4. The secret check (shared by both RPCs) ----------
-- 034's rule: no Vault row, an empty or short one, or a mismatch → forbidden.
CREATE OR REPLACE FUNCTION public.form_link_check_secret(p_secret text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_secret text;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_secret
      FROM vault.decrypted_secrets
     WHERE name = 'lead_intake_secret'
     LIMIT 1;
  EXCEPTION WHEN others THEN
    v_secret := NULL;
  END;
  IF v_secret IS NULL OR char_length(v_secret) < 16
     OR p_secret IS NULL OR p_secret IS DISTINCT FROM v_secret THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.form_link_check_secret(text) FROM PUBLIC, anon, authenticated;

-- ---------- 5. form_link_read ----------
-- The response behind a link. Full answers on purpose: the site server strips
-- the template's internal fields before anything reaches a browser (see the
-- header). A submitted link still reads (submitted: true) so the page can
-- thank the customer instead of showing an error.
CREATE OR REPLACE FUNCTION public.form_link_read(p_secret text, p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row     public.form_responses%ROWTYPE;
  v_name    text;
  v_company text;
  v_title   text;
  c_name    text;
  c_company text;
BEGIN
  PERFORM public.form_link_check_secret(p_secret);

  IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{32,128}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  SELECT * INTO v_row
    FROM public.form_responses
   WHERE share_token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_row.share_expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expired');
  END IF;

  SELECT l.name, l.company INTO v_name, v_company
    FROM public.leads l WHERE l.id = v_row.lead_id;
  SELECT p.title INTO v_title
    FROM public.projects p WHERE p.id = v_row.project_id;
  -- The client fills what the lead doesn't say (a project-anchored form has no
  -- lead). Separate variables: SELECT INTO with no row nulls its targets.
  IF v_name IS NULL OR v_company IS NULL THEN
    SELECT c.name, c.company INTO c_name, c_company
      FROM public.clients c
     WHERE c.id = coalesce(v_row.client_id,
                           (SELECT p.client_id FROM public.projects p WHERE p.id = v_row.project_id));
    v_name := coalesce(v_name, c_name);
    v_company := coalesce(v_company, c_company);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'form', v_row.form,
    'version', v_row.version,
    'answers', v_row.answers,
    'submitted', v_row.customer_submitted_at IS NOT NULL,
    'customer_submitted_at', v_row.customer_submitted_at,
    'expires_at', v_row.share_expires_at,
    'context', jsonb_build_object('name', v_name, 'company', v_company, 'project_title', v_title)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.form_link_read(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.form_link_read(text, text) TO anon, service_role;

-- ---------- 6. form_link_submit ----------
-- The customer's answers in. One submission per link: the team makes a new
-- link to reopen it. The answers merge over what is stored (the customer is
-- the source for their own details); the status stays where it was, so the
-- team still reviews and completes the form in DeskDev.
--
-- Who hears about it: whoever made the link, plus the lead's owner or the
-- project's assignee — active people who can view the anchor's feature
-- (user_has_perm checks deactivation too). If none of them can, the admins.
CREATE OR REPLACE FUNCTION public.form_link_submit(
  p_secret text, p_token text, p_answers jsonb, p_form_title text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row      public.form_responses%ROWTYPE;
  v_name     text;
  v_feature  text;
  v_entity   text;
  v_entity_id uuid;
  v_owner    uuid;
  v_title    text;
BEGIN
  PERFORM public.form_link_check_secret(p_secret);

  IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{32,128}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- Locked: two submits racing on the same link must not both get through.
  SELECT * INTO v_row
    FROM public.form_responses
   WHERE share_token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_row.share_expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expired');
  END IF;
  IF v_row.customer_submitted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'submitted');
  END IF;
  IF p_answers IS NULL OR jsonb_typeof(p_answers) <> 'object'
     OR octet_length(p_answers::text) >= 65536
     OR octet_length((v_row.answers || p_answers)::text) >= 65536 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;

  UPDATE public.form_responses
     SET answers = answers || p_answers,
         customer_submitted_at = now()
   WHERE id = v_row.id;

  -- The anchor decides the link in the notification and who may receive it
  -- (the same order as 046's can_access_form_response).
  IF v_row.project_id IS NOT NULL THEN
    v_feature := 'projects'; v_entity := 'project'; v_entity_id := v_row.project_id;
    SELECT p.assignee_id INTO v_owner FROM public.projects p WHERE p.id = v_row.project_id;
  ELSIF v_row.lead_id IS NOT NULL THEN
    v_feature := 'growth'; v_entity := 'lead'; v_entity_id := v_row.lead_id;
    SELECT l.owner_id INTO v_owner FROM public.leads l WHERE l.id = v_row.lead_id;
  ELSE
    v_feature := 'clients'; v_entity := 'client'; v_entity_id := v_row.client_id;
  END IF;

  SELECT l.name INTO v_name FROM public.leads l WHERE l.id = v_row.lead_id;
  IF v_name IS NULL THEN
    SELECT c.name INTO v_name
      FROM public.clients c
     WHERE c.id = coalesce(v_row.client_id,
                           (SELECT p.client_id FROM public.projects p WHERE p.id = v_row.project_id));
  END IF;
  v_title := left(coalesce(v_name, 'A customer') || ' sent back the '
                  || coalesce(nullif(btrim(p_form_title), ''), 'form'), 300);

  INSERT INTO public.notifications (user_id, actor_id, type, title, body, entity, entity_id)
  SELECT r.id, NULL, 'form_submitted', v_title, NULL, v_entity, v_entity_id
    FROM (SELECT DISTINCT x.id
            FROM (VALUES (v_row.shared_by), (v_owner)) AS x (id)
           WHERE x.id IS NOT NULL
             AND public.user_has_perm(x.id, v_feature, 'view')) r;

  IF NOT FOUND THEN
    INSERT INTO public.notifications (user_id, actor_id, type, title, body, entity, entity_id)
    SELECT p.id, NULL, 'form_submitted', v_title, NULL, v_entity, v_entity_id
      FROM public.profiles p
     WHERE p.role = 'admin' AND p.deactivated_at IS NULL;
  END IF;

  IF v_row.lead_id IS NOT NULL THEN
    INSERT INTO public.lead_activity (lead_id, actor_id, action, detail)
    VALUES (v_row.lead_id, NULL, 'form_submitted',
            jsonb_build_object('form', v_row.form, 'response_id', v_row.id));
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'form', v_row.form);
END;
$$;

REVOKE ALL ON FUNCTION public.form_link_submit(text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.form_link_submit(text, text, jsonb, text) TO anon, service_role;

COMMENT ON COLUMN public.notifications.type IS
  'task_assigned|task_updated|project_updated|client_updated|crm_updated|event_updated|meeting_updated|due_reminder|channel_mention|lead_new|lead_sla|lead_followup|lead_assigned|showcase_ready|form_submitted|system';
