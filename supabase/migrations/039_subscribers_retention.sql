-- ============================================
-- DeskDev Studio — 039: Site subscribers + data retention
--
--   1. site_subscribers: the footer newsletter box stops throwing emails
--      away. One row per address (email_norm), with the consent time kept as
--      evidence and unsubscribes kept as a suppression record. No sending
--      yet; Growth → Subscribers lists and exports them.
--   2. intake_subscriber(p_secret, p_payload): the second anon entry point
--      next to 034's intake_site_lead, gated by the same Vault secret
--      ('lead_intake_secret') and throttled in the database.
--   3. Retention, run daily by pg_cron:
--        - spam (quarantined) leads are deleted 30 days after they last
--          changed;
--        - lost leads have their personal data scrubbed after 24 months
--          (the row, stage, source, service, budget and score stay for the
--          reports);
--        - notifications older than 90 days are deleted.
--
-- Depends on 032 (write_audit_log) and 034 (leads.spam, email_norm,
-- message, ip_hash, attribution, last_submitted_at). Re-runnable.
-- ============================================

-- ---------- 0. Ledger order guard ----------
-- The retention job is plpgsql, so a missing column would only surface at
-- 03:45 some night. Fail here instead.
DO $$
BEGIN
  IF to_regprocedure('public.write_audit_log(text, text, text, jsonb, uuid)') IS NULL THEN
    RAISE EXCEPTION '039 needs 032_account_lifecycle.sql (write_audit_log) applied first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'spam') THEN
    RAISE EXCEPTION '039 needs 034_lead_intake.sql (leads.spam, message, ip_hash, attribution) applied first';
  END IF;
END $$;

-- ---------- 1. Subscribers ----------
CREATE TABLE IF NOT EXISTS public.site_subscribers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL CHECK (char_length(email) <= 254),
  -- One row per address however it was typed. The unique index below is
  -- what makes a second signup a no-op instead of a duplicate.
  email_norm      text GENERATED ALWAYS AS (lower(btrim(email))) STORED,
  -- Where the box was: 'footer' today; a slug so the panel can filter.
  source          text NOT NULL DEFAULT 'footer' CHECK (source ~ '^[a-z0-9_-]{1,32}$'),
  -- Proof of opt-in. Set by the server when the row is created, never by a
  -- client, and never rewritten by a later anonymous signup.
  consent_at      timestamptz NOT NULL DEFAULT now(),
  -- An unsubscribe keeps the row so a future sender can suppress the
  -- address; deleting it would let a later import re-add someone who said no.
  unsubscribed_at timestamptz,
  -- Salted hash from the Worker (LEAD_IP_SALT), never the raw address.
  ip_hash         text CHECK (ip_hash IS NULL OR char_length(ip_hash) <= 128),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS site_subscribers_email_norm_key
  ON public.site_subscribers (email_norm);
CREATE INDEX IF NOT EXISTS site_subscribers_created_idx
  ON public.site_subscribers (created_at);

DROP TRIGGER IF EXISTS site_subscribers_set_updated_at ON public.site_subscribers;
CREATE TRIGGER site_subscribers_set_updated_at
  BEFORE UPDATE ON public.site_subscribers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.site_subscribers ENABLE ROW LEVEL SECURITY;

-- Supabase's default privileges hand anon ALL on new tables. RLS alone would
-- block it, but the only public door is intake_subscriber, so take the
-- grants away too.
REVOKE ALL ON public.site_subscribers FROM PUBLIC, anon;

-- Staff can read, unsubscribe and delete (delete-on-request). They cannot
-- insert, and they cannot rewrite the address or the consent evidence: the
-- only column a client may UPDATE is unsubscribed_at.
REVOKE ALL ON public.site_subscribers FROM authenticated;
GRANT SELECT, DELETE ON public.site_subscribers TO authenticated;
GRANT UPDATE (unsubscribed_at) ON public.site_subscribers TO authenticated;

DROP POLICY IF EXISTS "site_subscribers_select" ON public.site_subscribers;
CREATE POLICY "site_subscribers_select"
  ON public.site_subscribers FOR SELECT
  TO authenticated USING (public.has_perm('growth', 'view'));

DROP POLICY IF EXISTS "site_subscribers_update" ON public.site_subscribers;
CREATE POLICY "site_subscribers_update"
  ON public.site_subscribers FOR UPDATE
  TO authenticated USING (public.has_perm('growth', 'edit'))
  WITH CHECK (public.has_perm('growth', 'edit'));

DROP POLICY IF EXISTS "site_subscribers_delete" ON public.site_subscribers;
CREATE POLICY "site_subscribers_delete"
  ON public.site_subscribers FOR DELETE
  TO authenticated USING (public.has_perm('growth', 'edit'));

-- ---------- 2. Throttle ledger ----------
-- Accepted signups only, kept for a day. A throttled call writes nothing, so
-- a flood cannot grow this table past the limits below. RLS on with no
-- policies and no grants: only intake_subscriber (SECURITY DEFINER) and the
-- retention job touch it.
CREATE TABLE IF NOT EXISTS public.site_subscriber_attempts (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  ip_hash    text,
  email_norm text NOT NULL
);

CREATE INDEX IF NOT EXISTS site_subscriber_attempts_ip_idx
  ON public.site_subscriber_attempts (ip_hash, at);
CREATE INDEX IF NOT EXISTS site_subscriber_attempts_email_idx
  ON public.site_subscriber_attempts (email_norm, at);
CREATE INDEX IF NOT EXISTS site_subscriber_attempts_at_idx
  ON public.site_subscriber_attempts (at);

ALTER TABLE public.site_subscriber_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_subscriber_attempts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.site_subscriber_attempts_id_seq FROM PUBLIC, anon, authenticated;

-- ---------- 3. intake_subscriber ----------
-- Called by the site Worker (/api/subscribe) with the anon key plus
-- LEAD_INTAKE_SECRET; the Worker holds no service-role key (plan rule 5).
--
-- p_payload keys (everything else is ignored):
--   email        required, <= 254 chars, must look like an address
--   source       optional slug, default 'footer'
--   ip_hash      optional, salted hash computed by the Worker
--   consent      optional boolean; an explicit false is refused
--   turnstile_ok optional boolean; an explicit false stores nothing. Unlike
--                a lead, a lost newsletter signup costs nothing, while bot
--                signups would poison the list once sending starts.
--
-- Returns {ok, status}:
--   subscribed    new row
--   already       the address is on the list, OR it unsubscribed; nothing
--                 changed either way. An unsubscribe is a suppression
--                 record: this anonymous door cannot prove the caller owns
--                 the inbox, so it never clears one or writes fresh consent
--                 evidence over it. Coming back takes a confirmed opt-in
--                 (a service-role path, not built yet).
--   throttled     too many signups from this ip_hash / address / overall
--   invalid       not an object, bad address, or consent false
--   unverified    turnstile_ok was false
-- The Worker must not echo 'already' vs 'subscribed' to the visitor, or the
-- form becomes a "who is on the list" oracle.
-- A wrong or missing secret raises 42501 and records nothing.
CREATE OR REPLACE FUNCTION public.intake_subscriber(p_secret text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret  text;
  v_email   text;
  v_norm    text;
  v_source  text;
  v_ip      text;
  v_existed boolean;
BEGIN
  -- Fail closed: no Vault row, an empty one or a short one means the door is
  -- shut, not open.
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

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'status', 'invalid');
  END IF;

  IF jsonb_typeof(p_payload -> 'turnstile_ok') = 'boolean'
     AND NOT (p_payload ->> 'turnstile_ok')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'status', 'unverified');
  END IF;

  IF jsonb_typeof(p_payload -> 'consent') = 'boolean'
     AND NOT (p_payload ->> 'consent')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'status', 'invalid');
  END IF;

  v_email := btrim(coalesce(p_payload ->> 'email', ''));
  IF v_email = '' OR char_length(v_email) > 254
     OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s.]+$' THEN
    RETURN jsonb_build_object('ok', false, 'status', 'invalid');
  END IF;
  v_norm := lower(v_email);

  v_source := lower(btrim(coalesce(p_payload ->> 'source', '')));
  IF v_source !~ '^[a-z0-9_-]{1,32}$' THEN
    v_source := 'footer';
  END IF;

  v_ip := nullif(left(btrim(coalesce(p_payload ->> 'ip_hash', '')), 128), '');

  -- Throttle, the same shape as 034's lead intake. Per visitor: 5 signups in
  -- 10 minutes, 20 a day; calls without an ip_hash (only a direct caller
  -- holding the secret omits it) share one bucket of 10 in 10 minutes, so a
  -- missing ip_hash never means "no limit". Per address: 3 an hour. Overall:
  -- 60 in 10 minutes, which caps the damage if the secret leaks and the
  -- caller rotates ip_hash. Refusals are not written to the ledger, so they
  -- never count towards a window.
  IF (v_ip IS NOT NULL AND (
        (SELECT count(*) FROM public.site_subscriber_attempts
          WHERE ip_hash = v_ip AND at > now() - interval '10 minutes') >= 5
        OR (SELECT count(*) FROM public.site_subscriber_attempts
             WHERE ip_hash = v_ip AND at > now() - interval '1 day') >= 20))
     OR (v_ip IS NULL AND
         (SELECT count(*) FROM public.site_subscriber_attempts
           WHERE ip_hash IS NULL AND at > now() - interval '10 minutes') >= 10)
     OR (SELECT count(*) FROM public.site_subscriber_attempts
         WHERE email_norm = v_norm AND at > now() - interval '1 hour') >= 3
     OR (SELECT count(*) FROM public.site_subscriber_attempts
         WHERE at > now() - interval '10 minutes') >= 60 THEN
    RETURN jsonb_build_object('ok', false, 'status', 'throttled');
  END IF;

  INSERT INTO public.site_subscriber_attempts (ip_hash, email_norm)
  VALUES (v_ip, v_norm);

  SELECT true INTO v_existed
  FROM public.site_subscribers
  WHERE email_norm = v_norm;

  IF NOT coalesce(v_existed, false) THEN
    -- ON CONFLICT covers two signups for the same address racing each other.
    INSERT INTO public.site_subscribers (email, source, consent_at, ip_hash)
    VALUES (v_email, v_source, now(), v_ip)
    ON CONFLICT (email_norm) DO NOTHING;
    RETURN jsonb_build_object('ok', true, 'status', 'subscribed');
  END IF;

  -- On the list already, or unsubscribed: either way the row stays exactly
  -- as it is (see the header). The route answers both like a new signup.
  RETURN jsonb_build_object('ok', true, 'status', 'already');
END;
$$;

REVOKE ALL ON FUNCTION public.intake_subscriber(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.intake_subscriber(text, jsonb) TO anon, service_role;

-- A delete is how a "forget me" request is honoured, so it leaves evidence in
-- 032's audit_log: who removed a subscriber and when. Not the address itself,
-- which would keep in the log exactly what was asked to be forgotten.
CREATE OR REPLACE FUNCTION public.audit_site_subscriber_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.write_audit_log(
    'subscriber.deleted', 'site_subscriber', OLD.id::text,
    jsonb_build_object(
      'source',       OLD.source,
      'subscribed',   OLD.consent_at,
      'unsubscribed', OLD.unsubscribed_at
    )
  );
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_site_subscriber_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS site_subscribers_audit_delete ON public.site_subscribers;
CREATE TRIGGER site_subscribers_audit_delete
  AFTER DELETE ON public.site_subscribers
  FOR EACH ROW EXECUTE FUNCTION public.audit_site_subscriber_delete();

-- ---------- 4. Retention ----------
-- Marks a lost lead whose personal data is gone, so the scrub runs once per
-- lead and the UI can say "details removed under the retention policy".
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS pii_scrubbed_at timestamptz;

-- notifications_user_read_created_idx (006) leads with user_id, so the
-- 90-day delete would scan the table without this.
CREATE INDEX IF NOT EXISTS notifications_created_at_idx
  ON public.notifications (created_at);

-- The windows, in one place.
CREATE OR REPLACE FUNCTION public.retention_windows()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'spam_leads',          '30 days',
    'lost_lead_pii',       '24 months',
    'notifications',       '90 days',
    'subscriber_attempts', '1 day'
  )
$$;

-- One pass of every retention rule. SECURITY DEFINER so the scheduler can
-- reach rows RLS hides; never callable from a client.
CREATE OR REPLACE FUNCTION public.run_data_retention()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w          jsonb := public.retention_windows();
  spam_cut   timestamptz := now() - (w ->> 'spam_leads')::interval;
  lost_cut   timestamptz := now() - (w ->> 'lost_lead_pii')::interval;
  notif_cut  timestamptz := now() - (w ->> 'notifications')::interval;
  tries_cut  timestamptz := now() - (w ->> 'subscriber_attempts')::interval;
  spam_ids   uuid[];
  lost_ids   uuid[];
  n_notif    bigint;
  n_tries    bigint;
  result     jsonb;
BEGIN
  -- Spam: the whole lead goes (lead_activity cascades). The clock is the
  -- last change, so a lead marked spam yesterday gets its full 30 days to be
  -- rescued with "not spam" however old the submission is.
  WITH gone AS (
    DELETE FROM public.leads
    WHERE spam IS TRUE
      AND updated_at < spam_cut
      AND coalesce(last_submitted_at, created_at) < spam_cut
    RETURNING id
  )
  SELECT coalesce(array_agg(id), '{}') INTO spam_ids FROM gone;

  -- A lead marked spam after it notified someone leaves notifications that
  -- quote the sender; they go with it.
  IF cardinality(spam_ids) > 0 THEN
    DELETE FROM public.notifications
    WHERE entity = 'lead' AND entity_id = ANY (spam_ids);
  END IF;

  -- Lost leads: keep the row for win/loss reporting, drop who it was. Kept:
  -- stage, lost_reason, source, form, services, budget_band, timeline,
  -- value, score, owner and dates. attribution keeps only the campaign keys
  -- the reports group by (no referrer URL, landing page or click id).
  WITH scrubbed AS (
    UPDATE public.leads l
       SET name            = 'Removed (retention)',
           email           = NULL,
           phone           = NULL,
           company         = NULL,
           message         = NULL,
           notes           = NULL,
           ip_hash         = NULL,
           spam_reason     = NULL,
           attribution     = CASE WHEN l.attribution IS NULL THEN NULL ELSE
                               jsonb_strip_nulls(jsonb_build_object(
                                 'utm_source',   l.attribution -> 'utm_source',
                                 'utm_medium',   l.attribution -> 'utm_medium',
                                 'utm_campaign', l.attribution -> 'utm_campaign'))
                             END,
           pii_scrubbed_at = now()
     WHERE l.stage = 'lost'
       AND l.spam IS NOT TRUE
       AND l.pii_scrubbed_at IS NULL
       AND l.updated_at < lost_cut
       AND coalesce(l.last_submitted_at, l.created_at) < lost_cut
    RETURNING l.id
  )
  SELECT coalesce(array_agg(id), '{}') INTO lost_ids FROM scrubbed;

  IF cardinality(lost_ids) > 0 THEN
    -- The timeline keeps its shape (who did what, when, from/to stage, lost
    -- reason) but not the prospect's words or contact details, which
    -- 'submitted', 'resubmitted' and the Gmail rows carry in detail.
    UPDATE public.lead_activity
       SET detail = detail - ARRAY[
             'name', 'email', 'phone', 'company', 'message', 'notes', 'note',
             'body', 'text', 'subject', 'snippet', 'from_email', 'to_email',
             'ip_hash', 'attribution', 'payload'
           ]
     WHERE lead_id = ANY (lost_ids);

    DELETE FROM public.notifications
    WHERE entity = 'lead' AND entity_id = ANY (lost_ids);
  END IF;

  WITH gone AS (
    DELETE FROM public.notifications WHERE created_at < notif_cut RETURNING 1
  )
  SELECT count(*) INTO n_notif FROM gone;

  WITH gone AS (
    DELETE FROM public.site_subscriber_attempts WHERE at < tries_cut RETURNING 1
  )
  SELECT count(*) INTO n_tries FROM gone;

  result := jsonb_build_object(
    'spam_leads_deleted',          cardinality(spam_ids),
    'lost_leads_scrubbed',         cardinality(lost_ids),
    'notifications_deleted',       n_notif,
    'subscriber_attempts_deleted', n_tries
  );

  -- Data that disappears on a schedule should still be explainable later.
  -- Counts only, and only for a run that removed something, so a quiet night
  -- adds no row. The throttle ledger is housekeeping and does not count.
  IF cardinality(spam_ids) > 0 OR cardinality(lost_ids) > 0 OR n_notif > 0 THEN
    PERFORM public.write_audit_log('retention.run', 'retention', NULL, result);
  END IF;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.run_data_retention() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retention_windows() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retention_windows() TO authenticated;

-- ---------- 5. Schedule ----------
-- 024 enabled pg_cron; IF NOT EXISTS keeps this safe on a project where it did not run.
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'data-retention') THEN
    PERFORM cron.unschedule('data-retention');
  END IF;
  PERFORM cron.schedule(
    'data-retention',
    '45 3 * * *',                      -- daily, after purge-automation-runs (03:15)
    $cron$ SELECT public.run_data_retention() $cron$
  );
END $$;
