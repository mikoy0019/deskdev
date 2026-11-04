-- ============================================
-- DeskDev Studio — 049: email from inside DeskDev (sent and read by n8n's Gmail)
--
--   emails                        one message, out (queued → sending → sent |
--                                 failed) or in (received), anchored to a
--                                 project, a lead or a client
--   email_addresses_valid()       the address-list CHECK (≤ max, each valid)
--   email_clean_addresses()       trims, lower-cases, dedupes, drops invalid
--   guard_email()                 app inserts: outbound + queued only; the
--                                 sender, the from line and every n8n field are
--                                 the server's; a reply joins its thread
--   notify_n8n_email_send()       a queued email → n8n 'deskdev-email-send'
--   email_sent_activity()         an email reaching 'sent' → 'email_sent' on the
--                                 lead (034's lead_activity_stops_sla counts it)
--   email_ingest(payload)         n8n's inbox poll → a matched reply is stored
--                                 (service role only); unmatched mail is not
--   email_retry(id)               the app's Retry on a failed (or stuck) email
--   email_send_sweep()            cron: re-kicks queued mail n8n never picked up
--   emails_drop_orphans()         deleting a client or project takes the mail
--                                 anchored to it alone (else the delete fails)
--   workspace_settings.email_*    sender name, signature, the Gmail address
--   automation_jobs 'email-inbound'  registered paused until activated
--
-- How mail flows (the parts outside this file):
--   Out: the app inserts a row (status 'queued'). The AFTER INSERT trigger
--     posts {email_id} to n8n's email-send workflow (026's n8n_post). n8n
--     re-reads the row with the service role, claims it with a conditional
--     PATCH (status=eq.queued → 'sending', so two runs never both send),
--     sends it through the "Gmail account" credential (a reply goes into the
--     replied-to Gmail thread), then PATCHes 'sent' + the Gmail ids, or
--     'failed' + error. 'sent' on a lead logs 'email_sent', which stops the
--     reply clock. n8n on Render can sleep through a kick (pg_net does not
--     retry), so a cron sweep re-kicks mail still queued after 3 minutes and
--     fails it after a day, where the app's Retry picks it up.
--   In: n8n's email-inbound workflow polls Gmail (in:inbox -from:me) every
--     5 minutes and calls email_ingest() per message. A message joins a
--     thread DeskDev already has, else the sender's open lead, else the
--     client with that address. Anything else is NOT stored: the studio's
--     inbox is not DeskDev's to copy.
--
-- Access follows the most specific anchor, exactly as 046's
-- can_access_form_response (project → projects, else lead → growth, else
-- client → clients), which this file reuses: read at 'view', write at 'edit'.
-- App users never UPDATE an email (no grant); the n8n status flow and Retry
-- go through the service role or SECURITY DEFINER code.
--
-- Notification vocabulary: 'email_received' is new. notifications.type has
-- no CHECK and 033's guard_notification_insert returns early when
-- auth.uid() is NULL (the service role), so email_ingest's NULL-actor rows
-- pass untouched, as 047's and 048's do. lead_activity already allows
-- 'email_sent' and 'email_received' (034); only 'email_sent' stops the SLA.
--
-- Depends on 026/028 (n8n_post, automation_jobs), 032 (deactivated_at,
-- is_admin, has_perm), 033 (workspace_settings, user_has_perm, audit_actor),
-- 034 (leads.email_norm, lead_activity_stops_sla), 043 (is_active, for the
-- active_account_only policy on emails), 046 (can_access_form_response), 048
-- (guard_workspace_settings as re-issued there). Re-runnable: IF NOT EXISTS /
-- OR REPLACE / DROP … IF EXISTS.
-- ============================================

DO $$
BEGIN
  IF to_regprocedure('public.can_access_form_response(uuid, uuid, uuid, text)') IS NULL THEN
    RAISE EXCEPTION '049 needs 046_project_phases_forms.sql (can_access_form_response) applied first';
  END IF;
  IF to_regprocedure('public.n8n_post(text, jsonb)') IS NULL THEN
    RAISE EXCEPTION '049 needs 026_automation_runs.sql (n8n_post) applied first';
  END IF;
  IF to_regprocedure('public.is_active()') IS NULL THEN
    RAISE EXCEPTION '049 needs 043_active_accounts_only.sql (is_active) applied first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'workspace_settings' AND column_name = 'booking_host_id') THEN
    RAISE EXCEPTION '049 needs 048_booking.sql applied first (it re-issues 048''s guard_workspace_settings)';
  END IF;
END $$;

-- ---------- 1. Sender settings ----------
-- The from line and signature for every email the studio sends. The address
-- is the Gmail account n8n's "Gmail account" credential sends from: it fills
-- the from line DeskDev shows and lets the inbox poll skip our own mail.
ALTER TABLE public.workspace_settings
  ADD COLUMN IF NOT EXISTS email_from_name    text NOT NULL DEFAULT 'NixGen Solutions',
  ADD COLUMN IF NOT EXISTS email_signature    text,
  ADD COLUMN IF NOT EXISTS email_from_address text;

ALTER TABLE public.workspace_settings DROP CONSTRAINT IF EXISTS workspace_settings_email_from_name_check;
ALTER TABLE public.workspace_settings ADD CONSTRAINT workspace_settings_email_from_name_check
  CHECK (char_length(btrim(email_from_name)) BETWEEN 1 AND 80);
ALTER TABLE public.workspace_settings DROP CONSTRAINT IF EXISTS workspace_settings_email_signature_check;
ALTER TABLE public.workspace_settings ADD CONSTRAINT workspace_settings_email_signature_check
  CHECK (email_signature IS NULL OR char_length(email_signature) <= 1000);
ALTER TABLE public.workspace_settings DROP CONSTRAINT IF EXISTS workspace_settings_email_from_address_check;
ALTER TABLE public.workspace_settings ADD CONSTRAINT workspace_settings_email_from_address_check
  CHECK (email_from_address IS NULL
         OR (char_length(email_from_address) <= 254
             AND email_from_address ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:].]+$'));

-- 048's guard, unchanged, plus: the sender name is trimmed, an empty
-- signature or address becomes NULL, and the address is lower-cased (the
-- inbox poll compares it with lower(from)).
CREATE OR REPLACE FUNCTION public.guard_workspace_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.id := true;

  IF NOT public.is_valid_business_hours(NEW.growth_business_hours) THEN
    RAISE EXCEPTION 'business hours need a known time zone, at least one weekday (1–7) and start < end as HH:MM'
      USING ERRCODE = '22023';
  END IF;
  NEW.growth_business_hours := jsonb_build_object(
    'tz',    NEW.growth_business_hours ->> 'tz',
    'days',  (SELECT jsonb_agg(d ORDER BY d::text::int) FROM jsonb_array_elements(NEW.growth_business_hours -> 'days') d),
    'start', NEW.growth_business_hours ->> 'start',
    'end',   NEW.growth_business_hours ->> 'end'
  );

  NEW.growth_owner_pool := coalesce((
    SELECT array_agg(x.id ORDER BY x.first_ord)
      FROM (
        SELECT u.id, min(u.ord) AS first_ord
          FROM unnest(NEW.growth_owner_pool) WITH ORDINALITY AS u (id, ord)
          JOIN public.profiles p ON p.id = u.id AND p.deactivated_at IS NULL
         GROUP BY u.id
      ) x
  ), '{}');

  NEW.growth_booking_url := nullif(btrim(NEW.growth_booking_url), '');

  -- 048: booking
  NEW.booking_title := btrim(NEW.booking_title);
  IF NEW.booking_host_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.profiles p WHERE p.id = NEW.booking_host_id AND p.deactivated_at IS NULL) THEN
    NEW.booking_host_id := NULL;
  END IF;

  -- 049: email
  NEW.email_from_name    := btrim(NEW.email_from_name);
  NEW.email_signature    := nullif(btrim(NEW.email_signature), '');
  NEW.email_from_address := nullif(lower(btrim(NEW.email_from_address)), '');

  NEW.updated_at := now();
  NEW.updated_by := public.audit_actor();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_workspace_settings() FROM PUBLIC, anon, authenticated;

-- ---------- 2. Address lists ----------
-- 034's address shape, ≤ 254 characters, no NULL entries, at most p_max.
CREATE OR REPLACE FUNCTION public.email_addresses_valid(p text[], p_max int)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT p IS NOT NULL
     AND cardinality(p) <= p_max
     AND NOT EXISTS (
       SELECT 1 FROM unnest(p) AS a (v)
        WHERE v IS NULL
           OR char_length(v) > 254
           OR v !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:].]+$'
     );
$$;

-- Trimmed, lower-cased, de-duplicated (first wins), invalid entries dropped,
-- at most p_max. For mail headers, which can hold anything.
CREATE OR REPLACE FUNCTION public.email_clean_addresses(p text[], p_max int)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(array_agg(x.v ORDER BY x.ord), '{}')
    FROM (
      SELECT v, min(ord) AS ord
        FROM (SELECT lower(btrim(a.v)) AS v, a.ord
                FROM unnest(coalesce(p, '{}')) WITH ORDINALITY AS a (v, ord)) s
       WHERE v IS NOT NULL
         AND char_length(v) BETWEEN 3 AND 254
         AND v ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:].]+$'
       GROUP BY v
       ORDER BY min(ord)
       LIMIT greatest(p_max, 0)
    ) x;
$$;

REVOKE ALL ON FUNCTION public.email_addresses_valid(text[], int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.email_clean_addresses(text[], int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_addresses_valid(text[], int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.email_clean_addresses(text[], int) TO authenticated, service_role;

-- ---------- 3. emails ----------
CREATE TABLE IF NOT EXISTS public.emails (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction         text NOT NULL CHECK (direction IN ('out', 'in')),
  status            text NOT NULL CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'received')),
  lead_id           uuid REFERENCES public.leads (id) ON DELETE CASCADE,
  client_id         uuid REFERENCES public.clients (id) ON DELETE SET NULL,
  project_id        uuid REFERENCES public.projects (id) ON DELETE SET NULL,
  from_email        text CHECK (from_email IS NULL OR char_length(from_email) <= 254),
  from_name         text CHECK (from_name IS NULL OR char_length(from_name) <= 120),
  to_emails         text[] NOT NULL,
  cc_emails         text[] NOT NULL DEFAULT '{}',
  subject           text NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 1 AND 300),
  body_text         text NOT NULL CHECK (char_length(body_text) <= 50000),
  in_reply_to       uuid REFERENCES public.emails (id) ON DELETE SET NULL,
  gmail_message_id  text CHECK (gmail_message_id IS NULL OR char_length(gmail_message_id) <= 200),
  gmail_thread_id   text CHECK (gmail_thread_id IS NULL OR char_length(gmail_thread_id) <= 200),
  error             text CHECK (error IS NULL OR char_length(error) <= 500),
  sent_at           timestamptz,
  received_at       timestamptz,
  created_by        uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT emails_anchor_check
    CHECK (lead_id IS NOT NULL OR client_id IS NOT NULL OR project_id IS NOT NULL),
  CONSTRAINT emails_direction_status_check
    CHECK ((direction = 'out' AND status IN ('queued', 'sending', 'sent', 'failed'))
           OR (direction = 'in' AND status = 'received')),
  -- Outbound mail needs a recipient; an inbound copy may have none we can
  -- read (we were only Bcc'd).
  CONSTRAINT emails_to_check
    CHECK ((direction = 'in' OR cardinality(to_emails) >= 1) AND public.email_addresses_valid(to_emails, 10)),
  CONSTRAINT emails_cc_check
    CHECK (public.email_addresses_valid(cc_emails, 10))
);

CREATE UNIQUE INDEX IF NOT EXISTS emails_gmail_message_key
  ON public.emails (gmail_message_id) WHERE gmail_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS emails_lead_idx    ON public.emails (lead_id)    WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS emails_client_idx  ON public.emails (client_id)  WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS emails_project_idx ON public.emails (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS emails_thread_idx  ON public.emails (gmail_thread_id) WHERE gmail_thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS emails_created_idx ON public.emails (created_at DESC);
CREATE INDEX IF NOT EXISTS emails_queued_idx  ON public.emails (updated_at) WHERE status = 'queued';

DROP TRIGGER IF EXISTS emails_set_updated_at ON public.emails;
CREATE TRIGGER emails_set_updated_at
  BEFORE UPDATE ON public.emails
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.emails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "emails_select" ON public.emails;
CREATE POLICY "emails_select"
  ON public.emails FOR SELECT TO authenticated
  USING (public.can_access_form_response(project_id, lead_id, client_id, 'view'));

DROP POLICY IF EXISTS "emails_insert" ON public.emails;
CREATE POLICY "emails_insert"
  ON public.emails FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access_form_response(project_id, lead_id, client_id, 'edit')
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS "emails_delete" ON public.emails;
CREATE POLICY "emails_delete"
  ON public.emails FOR DELETE TO authenticated
  USING (public.is_admin());

-- 043's rule for every table a signed-in account can reach (this one is
-- created after 043's catalog sweep): no active profile, no row.
DROP POLICY IF EXISTS "active_account_only" ON public.emails;
CREATE POLICY "active_account_only"
  ON public.emails AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_active())) WITH CHECK ((SELECT public.is_active()));

-- No UPDATE for app users at all (no grant, no policy): a sent email is a
-- record. Status changes are n8n's (service role) and email_retry's.
REVOKE ALL ON public.emails FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.emails TO authenticated;
GRANT ALL ON public.emails TO service_role;

-- A lead's mail goes with the lead (CASCADE). A client or project is SET
-- NULL on the email, which would leave mail anchored only to it with no
-- anchor at all (emails_anchor_check refuses that, and the delete would
-- fail): that mail goes with its client or project instead.
CREATE OR REPLACE FUNCTION public.emails_drop_orphans()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_TABLE_NAME = 'clients' THEN
    DELETE FROM public.emails
     WHERE client_id = OLD.id AND lead_id IS NULL AND project_id IS NULL;
  ELSIF TG_TABLE_NAME = 'projects' THEN
    DELETE FROM public.emails
     WHERE project_id = OLD.id AND lead_id IS NULL AND client_id IS NULL;
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.emails_drop_orphans() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS emails_drop_orphans ON public.clients;
CREATE TRIGGER emails_drop_orphans
  BEFORE DELETE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.emails_drop_orphans();

DROP TRIGGER IF EXISTS emails_drop_orphans ON public.projects;
CREATE TRIGGER emails_drop_orphans
  BEFORE DELETE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.emails_drop_orphans();

-- ---------- 4. The guard ----------
-- Client callers (current_user 'authenticated'/'anon', 037/046's pattern;
-- not SECURITY DEFINER, so current_user is the caller and the in_reply_to
-- lookup below runs under the caller's RLS). The service role (n8n) and
-- SECURITY DEFINER code pass through untouched.
--   insert   outbound + queued only; created_by, created_at, the from line
--            (workspace_settings) are stamped; every field n8n owns starts
--            empty; addresses are trimmed, lower-cased, de-duplicated (the
--            CHECKs then refuse an invalid one rather than dropping it).
--   reply    in_reply_to must be an email the caller can see. The reply sits
--            in the same thread: each anchor the app sends must equal the
--            original's, and the ones it leaves out are copied from it.
--   update   refused (app users have no UPDATE grant; this is belt and braces).
CREATE OR REPLACE FUNCTION public.guard_email()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_client boolean := current_user IN ('authenticated', 'anon');
  v_ws     record;
  v_orig   record;
BEGIN
  IF NOT v_client THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'emails are not edited from the app' USING ERRCODE = '42501';
  END IF;

  IF NEW.direction IS DISTINCT FROM 'out' OR NEW.status IS DISTINCT FROM 'queued' THEN
    RAISE EXCEPTION 'the app may only queue outbound email' USING ERRCODE = '42501';
  END IF;

  NEW.created_by       := auth.uid();
  NEW.created_at       := now();
  NEW.updated_at       := now();
  NEW.gmail_message_id := NULL;
  NEW.gmail_thread_id  := NULL;
  NEW.error            := NULL;
  NEW.sent_at          := NULL;
  NEW.received_at      := NULL;

  SELECT ws.email_from_name, ws.email_from_address INTO v_ws
    FROM public.workspace_settings ws WHERE ws.id;
  NEW.from_name  := v_ws.email_from_name;
  NEW.from_email := v_ws.email_from_address;

  NEW.subject   := btrim(NEW.subject);
  -- Kept in the order typed; a NULL or blank entry stays and the CHECK refuses it.
  NEW.to_emails := ARRAY(SELECT d.v FROM (
                           SELECT DISTINCT ON (lower(btrim(a.v))) lower(btrim(a.v)) AS v, a.ord
                             FROM unnest(NEW.to_emails) WITH ORDINALITY AS a (v, ord)
                            ORDER BY lower(btrim(a.v)), a.ord) d
                         ORDER BY d.ord);
  NEW.cc_emails := ARRAY(SELECT d.v FROM (
                           SELECT DISTINCT ON (lower(btrim(a.v))) lower(btrim(a.v)) AS v, a.ord
                             FROM unnest(coalesce(NEW.cc_emails, '{}')) WITH ORDINALITY AS a (v, ord)
                            ORDER BY lower(btrim(a.v)), a.ord) d
                         ORDER BY d.ord);

  IF NEW.in_reply_to IS NOT NULL THEN
    SELECT e.lead_id, e.client_id, e.project_id INTO v_orig
      FROM public.emails e WHERE e.id = NEW.in_reply_to;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'in_reply_to is not an email you can see' USING ERRCODE = '42501';
    END IF;
    IF (NEW.lead_id    IS NOT NULL AND NEW.lead_id    IS DISTINCT FROM v_orig.lead_id)
       OR (NEW.client_id  IS NOT NULL AND NEW.client_id  IS DISTINCT FROM v_orig.client_id)
       OR (NEW.project_id IS NOT NULL AND NEW.project_id IS DISTINCT FROM v_orig.project_id) THEN
      RAISE EXCEPTION 'a reply belongs to the same lead, client or project as the email it answers'
        USING ERRCODE = '42501';
    END IF;
    NEW.lead_id    := coalesce(NEW.lead_id, v_orig.lead_id);
    NEW.client_id  := coalesce(NEW.client_id, v_orig.client_id);
    NEW.project_id := coalesce(NEW.project_id, v_orig.project_id);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_email() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS emails_guard ON public.emails;
CREATE TRIGGER emails_guard
  BEFORE INSERT OR UPDATE ON public.emails
  FOR EACH ROW EXECUTE FUNCTION public.guard_email();

-- ---------- 5. Sending: the kick and the 'email_sent' activity ----------
-- The body is only the id; n8n re-reads the email with the service role, so
-- no message text sits in net._http_response. A failure is a WARNING (035's
-- rule): the email itself must commit; the sweep below re-kicks it.
CREATE OR REPLACE FUNCTION public.notify_n8n_email_send()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  BEGIN
    PERFORM public.n8n_post('deskdev-email-send', jsonb_build_object('email_id', NEW.id));
  EXCEPTION WHEN others THEN
    RAISE WARNING 'notify_n8n_email_send(%): %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_n8n_email_send() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS emails_n8n_send ON public.emails;
CREATE TRIGGER emails_n8n_send
  AFTER INSERT ON public.emails
  FOR EACH ROW
  WHEN (NEW.direction = 'out' AND NEW.status = 'queued')
  EXECUTE FUNCTION public.notify_n8n_email_send();

-- A sent email to a lead is a response: 034's lead_activity_stops_sla stamps
-- first_responded_at / last_touch_at from this row. Only on the transition,
-- so a re-PATCH of an already sent row logs nothing twice.
CREATE OR REPLACE FUNCTION public.email_sent_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.lead_activity (lead_id, actor_id, action, detail)
  VALUES (NEW.lead_id, NEW.created_by, 'email_sent',
          jsonb_build_object('email_id', NEW.id, 'subject', left(NEW.subject, 300)));
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.email_sent_activity() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS emails_sent_activity ON public.emails;
CREATE TRIGGER emails_sent_activity
  AFTER UPDATE OF status ON public.emails
  FOR EACH ROW
  WHEN (NEW.direction = 'out' AND NEW.status = 'sent' AND OLD.status IS DISTINCT FROM 'sent'
        AND NEW.lead_id IS NOT NULL)
  EXECUTE FUNCTION public.email_sent_activity();

-- ---------- 6. email_ingest: replies into DeskDev ----------
-- Called by n8n's email-inbound workflow, one Gmail message at a time, with
-- the service role ("Supabase — DeskDev" credential). Payload keys:
--   gmail_message_id  required
--   gmail_thread_id   optional (a reply to mail DeskDev sent shares it)
--   from_email        required, must look like an address
--   from_name, to_emails (array), cc_emails (array), subject, body_text,
--   received_at (ISO; unparseable → now())
-- Returns
--   {ok:false, reason:'invalid'}                         no id / no usable sender
--   {ok:true, matched:false, reason:'own'}               our own address
--   {ok:true, matched:true, duplicate:true, email_id}    already stored
--   {ok:true, matched:false}                             nobody in DeskDev: NOT stored
--   {ok:true, matched:true, email_id, lead_id, client_id, project_id}
CREATE OR REPLACE FUNCTION public.email_ingest(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  p           jsonb := CASE WHEN jsonb_typeof(p_payload) = 'object' THEN p_payload ELSE '{}'::jsonb END;
  v_msg       text;
  v_thread    text;
  v_from      text;
  v_name      text;
  v_subject   text;
  v_body      text;
  v_to        text[];
  v_cc        text[];
  v_received  timestamptz;
  v_own       text;
  v_id        uuid;
  v_lead      uuid;
  v_client    uuid;
  v_project   uuid;
  v_reply_to  uuid;
  v_feature   text;
  v_entity    text;
  v_entity_id uuid;
  v_owner     uuid;
  v_sender    uuid;
  v_title     text;
  r           record;
BEGIN
  v_msg  := nullif(btrim(coalesce(p ->> 'gmail_message_id', '')), '');
  v_from := lower(btrim(coalesce(p ->> 'from_email', '')));
  IF v_msg IS NULL OR char_length(v_msg) > 200
     OR char_length(v_from) > 254
     OR v_from !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:].]+$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;

  -- Our own mail (sent from Gmail directly, or a copy to ourselves).
  SELECT ws.email_from_address INTO v_own FROM public.workspace_settings ws WHERE ws.id;
  IF v_own IS NOT NULL AND v_from = lower(v_own) THEN
    RETURN jsonb_build_object('ok', true, 'matched', false, 'reason', 'own');
  END IF;

  SELECT e.id INTO v_id FROM public.emails e WHERE e.gmail_message_id = v_msg;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'matched', true, 'duplicate', true, 'email_id', v_id);
  END IF;

  v_thread := left(nullif(btrim(coalesce(p ->> 'gmail_thread_id', '')), ''), 200);

  -- 1. A thread DeskDev already has: the reply sits with the conversation.
  IF v_thread IS NOT NULL THEN
    SELECT e.id, e.lead_id, e.client_id, e.project_id INTO r
      FROM public.emails e
     WHERE e.gmail_thread_id = v_thread
     ORDER BY coalesce(e.received_at, e.sent_at, e.created_at) DESC, e.created_at DESC
     LIMIT 1;
    IF FOUND THEN
      v_reply_to := r.id;
      v_lead := r.lead_id; v_client := r.client_id; v_project := r.project_id;
    END IF;
  END IF;

  -- 2. The sender's newest open, real lead.
  IF v_reply_to IS NULL THEN
    SELECT l.id, l.client_id INTO r
      FROM public.leads l
     WHERE l.email_norm = v_from
       AND l.spam = false
       AND l.stage IN ('new', 'contacted', 'proposal')
     ORDER BY l.created_at DESC
     LIMIT 1;
    IF FOUND THEN
      v_lead := r.id; v_client := r.client_id;
    END IF;
  END IF;

  -- 3. A client with that address.
  IF v_reply_to IS NULL AND v_lead IS NULL THEN
    SELECT c.id INTO v_client
      FROM public.clients c
     WHERE lower(btrim(c.email)) = v_from
     ORDER BY c.created_at
     LIMIT 1;
  END IF;

  IF v_lead IS NULL AND v_client IS NULL AND v_project IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'matched', false);
  END IF;

  -- ---- Clean what's stored.
  v_name    := nullif(left(btrim(regexp_replace(coalesce(p ->> 'from_name', ''), '[[:cntrl:]]+', ' ', 'g')), 120), '');
  v_subject := left(btrim(regexp_replace(coalesce(p ->> 'subject', ''), '[[:cntrl:][:space:]]+', ' ', 'g')), 300);
  IF v_subject = '' THEN
    v_subject := '(no subject)';
  END IF;
  v_body := left(coalesce(p ->> 'body_text', ''), 50000);
  v_to := public.email_clean_addresses(
    CASE jsonb_typeof(p -> 'to_emails')
      WHEN 'array'  THEN ARRAY(SELECT jsonb_array_elements_text(p -> 'to_emails'))
      WHEN 'string' THEN string_to_array(p ->> 'to_emails', ',')
      ELSE '{}'::text[] END, 10);
  v_cc := public.email_clean_addresses(
    CASE jsonb_typeof(p -> 'cc_emails')
      WHEN 'array'  THEN ARRAY(SELECT jsonb_array_elements_text(p -> 'cc_emails'))
      WHEN 'string' THEN string_to_array(p ->> 'cc_emails', ',')
      ELSE '{}'::text[] END, 10);
  BEGIN
    v_received := nullif(p ->> 'received_at', '')::timestamptz;
  EXCEPTION WHEN others THEN
    v_received := NULL;
  END;
  IF v_received IS NULL OR v_received > now() + interval '1 day' THEN
    v_received := now();
  END IF;

  -- Two polls racing on one message: the unique index decides, quietly.
  INSERT INTO public.emails
    (direction, status, lead_id, client_id, project_id, from_email, from_name,
     to_emails, cc_emails, subject, body_text, in_reply_to,
     gmail_message_id, gmail_thread_id, received_at)
  VALUES
    ('in', 'received', v_lead, v_client, v_project, v_from, v_name,
     v_to, v_cc, v_subject, v_body, v_reply_to,
     v_msg, v_thread, v_received)
  ON CONFLICT (gmail_message_id) WHERE gmail_message_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT e.id INTO v_id FROM public.emails e WHERE e.gmail_message_id = v_msg;
    RETURN jsonb_build_object('ok', true, 'matched', true, 'duplicate', true, 'email_id', v_id);
  END IF;

  -- An inbound email is not our response: 'email_received' is not in 034's
  -- SLA list, so the reply clock keeps running.
  IF v_lead IS NOT NULL THEN
    INSERT INTO public.lead_activity (lead_id, actor_id, action, detail)
    VALUES (v_lead, NULL, 'email_received', jsonb_build_object('email_id', v_id, 'subject', v_subject));
  END IF;

  -- ---- Tell people. The anchor decides the link and who may receive it
  -- (046's order); recipients are whoever last wrote in the thread and the
  -- lead's owner / project's assignee, if they can see it; else the admins.
  IF v_project IS NOT NULL THEN
    v_feature := 'projects'; v_entity := 'project'; v_entity_id := v_project;
    SELECT pr.assignee_id INTO v_owner FROM public.projects pr WHERE pr.id = v_project;
  ELSIF v_lead IS NOT NULL THEN
    v_feature := 'growth'; v_entity := 'lead'; v_entity_id := v_lead;
    SELECT l.owner_id INTO v_owner FROM public.leads l WHERE l.id = v_lead;
  ELSE
    v_feature := 'clients'; v_entity := 'client'; v_entity_id := v_client;
  END IF;

  IF v_thread IS NOT NULL THEN
    SELECT e.created_by INTO v_sender
      FROM public.emails e
     WHERE e.gmail_thread_id = v_thread AND e.direction = 'out' AND e.created_by IS NOT NULL
     ORDER BY e.created_at DESC
     LIMIT 1;
  END IF;

  v_title := left(coalesce(v_name, v_from) || ': ' || v_subject, 300);

  INSERT INTO public.notifications (user_id, actor_id, type, title, body, entity, entity_id)
  SELECT x.id, NULL, 'email_received', v_title, NULL, v_entity, v_entity_id
    FROM (SELECT DISTINCT y.id
            FROM (VALUES (v_sender), (v_owner)) AS y (id)
           WHERE y.id IS NOT NULL
             AND public.user_has_perm(y.id, v_feature, 'view')) x;

  IF NOT FOUND THEN
    INSERT INTO public.notifications (user_id, actor_id, type, title, body, entity, entity_id)
    SELECT pf.id, NULL, 'email_received', v_title, NULL, v_entity, v_entity_id
      FROM public.profiles pf
     WHERE pf.role = 'admin' AND pf.deactivated_at IS NULL;
  END IF;

  RETURN jsonb_build_object('ok', true, 'matched', true, 'email_id', v_id,
                            'lead_id', v_lead, 'client_id', v_client, 'project_id', v_project);
END;
$$;

REVOKE ALL ON FUNCTION public.email_ingest(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_ingest(jsonb) TO service_role;

-- ---------- 7. email_retry: the app's Retry ----------
-- For a failed email, or one still queued after five minutes (the kick
-- reached a sleeping n8n and was lost). Needs edit access to the email's
-- anchor (the same rule as writing one). Back to 'queued', error cleared,
-- kicked again; n8n's conditional claim keeps a double kick from sending twice.
CREATE OR REPLACE FUNCTION public.email_retry(p_email_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  e public.emails%ROWTYPE;
BEGIN
  SELECT * INTO e FROM public.emails WHERE id = p_email_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL
     OR NOT public.can_access_form_response(e.project_id, e.lead_id, e.client_id, 'view') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF NOT public.can_access_form_response(e.project_id, e.lead_id, e.client_id, 'edit') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF e.direction <> 'out'
     OR NOT (e.status = 'failed' OR (e.status = 'queued' AND e.updated_at < now() - interval '5 minutes')) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_failed');
  END IF;

  UPDATE public.emails SET status = 'queued', error = NULL WHERE id = p_email_id;
  BEGIN
    PERFORM public.n8n_post('deskdev-email-send', jsonb_build_object('email_id', p_email_id));
  EXCEPTION WHEN others THEN
    RAISE WARNING 'email_retry(%): %', p_email_id, SQLERRM;
  END;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.email_retry(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_retry(uuid) TO authenticated, service_role;

-- ---------- 8. The sweep: queued mail n8n never picked up ----------
-- pg_net fires once and does not retry; n8n on Render's free plan can be
-- asleep when the kick lands. Every 5 minutes: re-kick what has been queued
-- for 3+ minutes (oldest first, 20 a run), and fail what has waited a day so
-- the app shows it with Retry instead of "Sending…" forever. Rows stuck in
-- 'sending' are left alone: the mail may have gone out.
CREATE OR REPLACE FUNCTION public.email_send_sweep()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_n  integer := 0;
BEGIN
  UPDATE public.emails
     SET status = 'failed',
         error  = 'Not sent: the mail service did not pick it up within a day. Retry to send it now.'
   WHERE direction = 'out' AND status = 'queued' AND updated_at < now() - interval '1 day';

  -- Claimed but never finished (n8n stopped between the Gmail call and the
  -- write-back): after an hour nothing more will happen to it. It may already
  -- be in the customer's inbox, so it is failed with a warning, never re-sent.
  UPDATE public.emails
     SET status = 'failed',
         error  = 'Not confirmed: the mail service stopped while sending. Check Gmail''s Sent folder before you retry.'
   WHERE direction = 'out' AND status = 'sending' AND updated_at < now() - interval '1 hour';

  FOR v_id IN
    SELECT e.id FROM public.emails e
     WHERE e.direction = 'out' AND e.status = 'queued'
       AND e.updated_at < now() - interval '3 minutes'
     ORDER BY e.updated_at
     LIMIT 20
  LOOP
    BEGIN
      PERFORM public.n8n_post('deskdev-email-send', jsonb_build_object('email_id', v_id));
      v_n := v_n + 1;
    EXCEPTION WHEN others THEN
      RAISE WARNING 'email_send_sweep(%): %', v_id, SQLERRM;
    END;
  END LOOP;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.email_send_sweep() FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'email-send-sweep') THEN
    PERFORM cron.unschedule('email-send-sweep');
  END IF;
  PERFORM cron.schedule('email-send-sweep', '*/5 * * * *',
    $cron$ SELECT public.email_send_sweep() $cron$);
END $$;

-- ---------- 9. The inbox poll's health row ----------
-- Registered paused: `enabled` is operator state (026), flipped when the
-- email-inbound workflow is switched on in n8n. Never overwritten on re-run.
INSERT INTO public.automation_jobs (job, workflow, cadence_hours, grace_hours, enabled, description)
VALUES ('email-inbound', '[deskdev] email-inbound', 1, 1, false,
        'Every 5 minutes: replies from leads and clients, from Gmail into DeskDev')
ON CONFLICT (job) DO NOTHING;

-- ---------- 10. Realtime ----------
-- Threads update live (Sending… → Sent, a reply arriving). FULL so a DELETE
-- carries the anchors RLS needs.
DO $$
BEGIN
  ALTER TABLE public.emails REPLICA IDENTITY FULL;
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'emails'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.emails;
  END IF;
END;
$$;
