-- ============================================
-- DeskDev Studio — 048: the booking page (nixgensolutions.com/book)
--
--   workspace_settings.booking_*   the page's switches: on/off, call title and
--                                  length, notice, how far ahead, buffer, host
--   guard_workspace_settings()     033's guard, plus tidying the booking fields
--   events.lead_id                 a meeting linked to the lead it is with
--   events.booked_via              'website' for a call booked on the site
--   events_booking_guard()         app users may link a lead (with growth:view),
--                                  never set booked_via
--   booking_attempts               the throttle ledger (7-day retention)
--   booking_overlaps(host, from, to)  the race guard: is the host busy then?
--   booking_record(payload)        one booking, start to finish (service role)
--
-- How a booking flows (the parts outside this file):
--   1. The site's /book page asks the google-calendar edge function for free
--      slots: business hours (033's growth_business_hours) minus Google busy
--      times and DeskDev events, recurrences expanded.
--   2. The visitor picks one. The site's server calls the function's `book`
--      action, which re-checks that slot against Google and then calls
--      booking_record() here with the service role.
--   3. booking_record re-checks the slot against DeskDev under a lock (two
--      visitors can pick the same slot at once), reuses the visitor's open
--      lead or creates one, inserts the meeting (kind 'meeting', lead_id,
--      booked_via 'website', the host and the visitor as attendees), logs
--      'meeting_booked' on the lead (034's lead_activity_stops_sla counts it
--      as the response), and tells the host and the lead's owner.
--   4. With the company Google grant active the meeting is inserted with
--      sync_google = true and add_meet = true, so 040's
--      google_calendar_events_guard queues the push and kicks the worker in
--      the same transaction. The worker creates the Google event with a Meet
--      link and invites the visitor (Google sends the invitation).
--
-- A lead created here has no last_submitted_at, so 035's n8n_lead_intake
-- (the "thanks, book a call" auto-reply) does not fire for someone who has
-- just booked one. The host's Google invitation is the confirmation.
--
-- Notification vocabulary: 'meeting_booked' is new. notifications.type has no
-- CHECK; 033's guard_notification_insert returns early when auth.uid() is
-- NULL, which it is for the service role, so these NULL-actor rows pass
-- untouched (as 034's intake and 047's form rows do). The app never sends
-- the type itself.
--
-- Depends on 032 (profiles.deactivated_at), 033 (workspace_settings,
-- user_has_perm, audit_actor), 034 (lead intake columns, pick_lead_owner,
-- lead_activity_stops_sla), 040 (events sync columns, event_attendees,
-- google_workspace_link, google_calendar_default_tz, is_valid_time_zone),
-- 043 (is_active, for booking_attempts' active_account_only policy).
-- Re-runnable: IF NOT EXISTS / OR REPLACE / DROP … IF EXISTS throughout.
-- ============================================

DO $$
BEGIN
  IF to_regprocedure('public.pick_lead_owner()') IS NULL THEN
    RAISE EXCEPTION '048 needs 034_lead_intake.sql (pick_lead_owner) applied first';
  END IF;
  IF to_regclass('public.google_workspace_link') IS NULL
     OR to_regclass('public.event_attendees') IS NULL THEN
    RAISE EXCEPTION '048 needs 040_google_workspace_calendar.sql applied first';
  END IF;
  IF to_regprocedure('public.is_active()') IS NULL THEN
    RAISE EXCEPTION '048 needs 043_active_accounts_only.sql (is_active) applied first';
  END IF;
END $$;

-- ---------- 1. Booking settings ----------
-- On the one settings row (033). The page is off until an admin turns it on.
ALTER TABLE public.workspace_settings
  ADD COLUMN IF NOT EXISTS booking_enabled        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS booking_title          text    NOT NULL DEFAULT 'Discovery call',
  ADD COLUMN IF NOT EXISTS booking_minutes        int     NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS booking_notice_minutes int     NOT NULL DEFAULT 240,
  ADD COLUMN IF NOT EXISTS booking_days_ahead     int     NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS booking_buffer_minutes int     NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS booking_host_id        uuid    REFERENCES public.profiles (id) ON DELETE SET NULL;

ALTER TABLE public.workspace_settings DROP CONSTRAINT IF EXISTS workspace_settings_booking_title_check;
ALTER TABLE public.workspace_settings ADD CONSTRAINT workspace_settings_booking_title_check
  CHECK (char_length(btrim(booking_title)) BETWEEN 1 AND 80);
ALTER TABLE public.workspace_settings DROP CONSTRAINT IF EXISTS workspace_settings_booking_minutes_check;
ALTER TABLE public.workspace_settings ADD CONSTRAINT workspace_settings_booking_minutes_check
  CHECK (booking_minutes BETWEEN 15 AND 180 AND booking_minutes % 5 = 0);
ALTER TABLE public.workspace_settings DROP CONSTRAINT IF EXISTS workspace_settings_booking_notice_check;
ALTER TABLE public.workspace_settings ADD CONSTRAINT workspace_settings_booking_notice_check
  CHECK (booking_notice_minutes BETWEEN 0 AND 20160);
ALTER TABLE public.workspace_settings DROP CONSTRAINT IF EXISTS workspace_settings_booking_days_check;
ALTER TABLE public.workspace_settings ADD CONSTRAINT workspace_settings_booking_days_check
  CHECK (booking_days_ahead BETWEEN 1 AND 60);
ALTER TABLE public.workspace_settings DROP CONSTRAINT IF EXISTS workspace_settings_booking_buffer_check;
ALTER TABLE public.workspace_settings ADD CONSTRAINT workspace_settings_booking_buffer_check
  CHECK (booking_buffer_minutes BETWEEN 0 AND 120);

-- 033's guard, unchanged, plus: the title is trimmed, and a host who has
-- left (deactivated, 032) falls away so the next save never fails on them.
-- booking_record falls back from a missing host on its own.
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

  NEW.updated_at := now();
  NEW.updated_by := public.audit_actor();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_workspace_settings() FROM PUBLIC, anon, authenticated;

-- ---------- 2. events: the lead link and the booking mark ----------
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS lead_id    uuid REFERENCES public.leads (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS booked_via text;

ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_booked_via_check;
ALTER TABLE public.events ADD CONSTRAINT events_booked_via_check
  CHECK (booked_via IS NULL OR booked_via = 'website');

CREATE INDEX IF NOT EXISTS events_lead_idx ON public.events (lead_id, starts_at) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_booked_idx ON public.events (starts_at) WHERE booked_via IS NOT NULL;

-- A signed-in user may link a meeting to a lead when they can see leads
-- (growth:view); otherwise the link is left as it was. booked_via is the
-- server's: an app write never sets or clears it. Ignored rather than
-- refused, like 040's sync bookkeeping, so a whole-row save never fails.
-- The service role (booking_record, the sync worker) has no auth.uid().
CREATE OR REPLACE FUNCTION public.events_booking_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.booked_via := NULL;
    IF NEW.lead_id IS NOT NULL AND NOT public.has_perm('growth', 'view') THEN
      NEW.lead_id := NULL;
    END IF;
  ELSE
    NEW.booked_via := OLD.booked_via;
    IF NEW.lead_id IS DISTINCT FROM OLD.lead_id AND NOT public.has_perm('growth', 'view') THEN
      NEW.lead_id := OLD.lead_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.events_booking_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS events_booking_guard ON public.events;
CREATE TRIGGER events_booking_guard
  BEFORE INSERT OR UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.events_booking_guard();

COMMENT ON COLUMN public.events.booked_via IS
  'website = booked by a visitor on nixgensolutions.com/book (booking_record). Server-only.';

-- ---------- 3. Throttle ledger ----------
-- One row per booking_record call that got past the on/off switch AND the
-- throttle, booked or not ('invalid', 'slot_taken'), so probing and floods
-- can be counted. Refused calls are not written (034's rule since its
-- security review): if they counted, a caller could keep the window full
-- and a flood of refusals could grow the table without bound. 'throttled'
-- stays in the CHECK as vocabulary; nothing writes it. Admins may read it;
-- nobody writes it from a client. Purged after 7 days (section 6).
CREATE TABLE IF NOT EXISTS public.booking_attempts (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  ip_hash    text,
  email_norm text,
  event_id   uuid REFERENCES public.events (id) ON DELETE SET NULL,
  status     text NOT NULL CHECK (status IN ('booked', 'throttled', 'slot_taken', 'invalid'))
);

CREATE INDEX IF NOT EXISTS booking_attempts_ip_idx ON public.booking_attempts (ip_hash, at);
CREATE INDEX IF NOT EXISTS booking_attempts_email_idx ON public.booking_attempts (email_norm, at);
CREATE INDEX IF NOT EXISTS booking_attempts_at_idx ON public.booking_attempts (at);

ALTER TABLE public.booking_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "booking_attempts_select_admin" ON public.booking_attempts;
CREATE POLICY "booking_attempts_select_admin"
  ON public.booking_attempts FOR SELECT
  TO authenticated USING (public.is_admin());

-- 043's rule for every table a signed-in account can reach (this one is
-- created after 043's catalog sweep): no active profile, no row.
DROP POLICY IF EXISTS "active_account_only" ON public.booking_attempts;
CREATE POLICY "active_account_only"
  ON public.booking_attempts AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_active())) WITH CHECK ((SELECT public.is_active()));

REVOKE ALL ON public.booking_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.booking_attempts TO authenticated;
GRANT ALL ON public.booking_attempts TO service_role;
REVOKE ALL ON SEQUENCE public.booking_attempts_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.booking_attempts_id_seq TO service_role;

-- ---------- 4. booking_overlaps ----------
-- Is the host busy anywhere in [p_from, p_to)? Busy = a timed DeskDev event
-- that was booked on the site, or that the host created, or that the host
-- attends. All-day events never block. Recurring events are expanded: each
-- occurrence repeats at the same wall-clock time in the event's zone (040),
-- so a weekly 9:00 stays at 9:00 across DST; only occurrences near the window
-- are generated. An event without an end counts as 30 minutes.
-- The edge function computes free slots itself (with Google's busy times as
-- well); this is the database's last word, under booking_record's lock.
CREATE OR REPLACE FUNCTION public.booking_overlaps(p_host uuid, p_from timestamptz, p_to timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH ev AS (
    SELECT e.starts_at,
           coalesce(e.timezone, public.google_calendar_default_tz()) AS tz,
           greatest(coalesce(e.ends_at, e.starts_at + interval '30 minutes') - e.starts_at,
                    interval '1 minute') AS dur,
           e.recurrence,
           e.recurrence_until,
           CASE e.recurrence WHEN 'daily'   THEN interval '1 day'
                             WHEN 'weekly'  THEN interval '7 days'
                             WHEN 'monthly' THEN interval '1 month' END AS step,
           -- Seconds between occurrences, at least (DST short days, February)
           -- and at most; they bound which occurrences can reach the window.
           CASE e.recurrence WHEN 'daily' THEN 82800 WHEN 'weekly' THEN 601200 WHEN 'monthly' THEN 2419200 END AS min_secs,
           CASE e.recurrence WHEN 'daily' THEN 90000 WHEN 'weekly' THEN 608400 WHEN 'monthly' THEN 2682000 END AS max_secs
      FROM public.events e
     WHERE NOT coalesce(e.all_day, false)
       AND e.starts_at < p_to
       AND (e.booked_via = 'website'
            OR (p_host IS NOT NULL AND e.created_by = p_host)
            OR (p_host IS NOT NULL AND EXISTS (
                  SELECT 1 FROM public.event_attendees a
                   WHERE a.event_id = e.id AND a.profile_id = p_host)))
  )
  SELECT EXISTS (
    SELECT 1
      FROM ev
      CROSS JOIN LATERAL generate_series(
        CASE WHEN ev.recurrence = 'none' THEN 0
             ELSE greatest(0, floor(extract(epoch FROM (p_from - ev.starts_at - ev.dur)) / ev.max_secs)::int - 1) END,
        CASE WHEN ev.recurrence = 'none' THEN 0
             ELSE greatest(0, ceil(extract(epoch FROM (p_to - ev.starts_at)) / ev.min_secs)::int + 1) END
      ) AS n
      CROSS JOIN LATERAL (
        SELECT CASE WHEN ev.recurrence = 'none' THEN ev.starts_at
                    ELSE ((ev.starts_at AT TIME ZONE ev.tz) + n * ev.step) AT TIME ZONE ev.tz END AS occ
      ) o
     WHERE o.occ < p_to
       AND o.occ + ev.dur > p_from
       AND (ev.recurrence = 'none'
            OR ev.recurrence_until IS NULL
            OR (o.occ AT TIME ZONE ev.tz)::date <= ev.recurrence_until)
  );
$$;

REVOKE ALL ON FUNCTION public.booking_overlaps(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_overlaps(uuid, timestamptz, timestamptz) TO service_role;

-- ---------- 5. booking_record ----------
-- Called by the google-calendar edge function's `book` action with the
-- service role, after it checked the slot against Google. Everything stored
-- is validated and truncated here, as 034's intake_site_lead does.
--
-- p_payload: start, end (ISO timestamptz; end − start = booking_minutes),
--   name (120), email (254), company (160), phone (40), notes (2000),
--   customer_tz (IANA, informational), ip_hash (128).
-- Returns {ok:true, event_id, lead_id, lead_created, host_id, starts_at,
--   ends_at} or {ok:false, reason: disabled | invalid | slot_taken | throttled}.
CREATE OR REPLACE FUNCTION public.booking_record(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s          public.workspace_settings%ROWTYPE;
  p          jsonb;
  v_start    timestamptz;
  v_end      timestamptz;
  v_name     text;
  v_email    text;
  v_norm     text;
  v_company  text;
  v_phone    text;
  v_notes    text;
  v_ctz      text;
  v_ip       text;
  v_tz       text;
  v_buffer   interval;
  v_lead     public.leads%ROWTYPE;
  v_lead_id  uuid;
  v_created  boolean := false;
  v_owner    uuid;
  v_host     uuid;
  v_existing uuid;
  v_client   uuid;
  v_event    uuid;
  v_sync     boolean;
  v_desc     text;
  v_title    text;
  v_when     text;
BEGIN
  SELECT * INTO s FROM public.workspace_settings WHERE id;
  IF NOT FOUND OR NOT s.booking_enabled THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'disabled');
  END IF;

  p := CASE WHEN jsonb_typeof(p_payload) = 'object' THEN p_payload ELSE '{}'::jsonb END;

  -- ---- Clean every field (034's rules).
  BEGIN
    v_start := (p ->> 'start')::timestamptz;
    v_end   := (p ->> 'end')::timestamptz;
  EXCEPTION WHEN others THEN
    v_start := NULL;
    v_end   := NULL;
  END;
  v_name    := nullif(left(btrim(regexp_replace(coalesce(p ->> 'name', ''), '[[:cntrl:][:space:]]+', ' ', 'g')), 120), '');
  v_email   := btrim(coalesce(p ->> 'email', ''));
  v_norm    := lower(v_email);
  v_company := nullif(left(btrim(regexp_replace(coalesce(p ->> 'company', ''), '[[:cntrl:][:space:]]+', ' ', 'g')), 160), '');
  v_phone   := nullif(left(btrim(regexp_replace(coalesce(p ->> 'phone', ''), '[^0-9+()./ x-]', '', 'g')), 40), '');
  v_notes   := nullif(btrim(regexp_replace(replace(replace(coalesce(p ->> 'notes', ''), E'\r\n', E'\n'), E'\r', E'\n'),
                                           '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', '', 'g')), '');
  v_ip      := nullif(left(btrim(coalesce(p ->> 'ip_hash', '')), 128), '');
  v_ctz     := nullif(btrim(coalesce(p ->> 'customer_tz', '')), '');
  IF v_ctz IS NOT NULL AND NOT public.is_valid_time_zone(v_ctz) THEN
    v_ctz := NULL;
  END IF;

  -- ---- Probing guard before anything else: 30 calls an hour from one
  -- visitor. Calls without an ip_hash share ONE bucket of 30 an hour: the
  -- site always sends one, so only a direct caller holding the secret omits
  -- it, and omitting it must not mean "no limit" (034's rule). Only calls
  -- that got through count, and a refusal writes nothing.
  IF (v_ip IS NOT NULL AND (SELECT count(*) FROM public.booking_attempts
                             WHERE ip_hash = v_ip AND status <> 'throttled'
                               AND at > now() - interval '1 hour') >= 30)
     OR (v_ip IS NULL AND (SELECT count(*) FROM public.booking_attempts
                            WHERE ip_hash IS NULL AND status <> 'throttled'
                              AND at > now() - interval '1 hour') >= 30) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'throttled');
  END IF;

  IF v_start IS NULL OR v_end IS NULL
     OR v_name IS NULL
     OR v_email = '' OR char_length(v_email) > 254
     OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:].]+$'
     OR char_length(coalesce(v_notes, '')) > 2000
     OR v_end - v_start <> make_interval(mins => s.booking_minutes)
     OR v_start <= now()
     OR v_start > now() + make_interval(days => s.booking_days_ahead + 1) THEN
    INSERT INTO public.booking_attempts (ip_hash, email_norm, status) VALUES (v_ip, nullif(v_norm, ''), 'invalid');
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;

  -- ---- One booking at a time: two visitors on the same slot must not both win.
  PERFORM pg_advisory_xact_lock(hashtext('public.booking_record'));

  -- ---- Throttle: 3 bookings per address and 10 per visitor a day; calls
  -- without an ip_hash share one visitor bucket. Refusals write nothing.
  IF (SELECT count(*) FROM public.booking_attempts
       WHERE email_norm = v_norm AND status = 'booked' AND at > now() - interval '1 day') >= 3
     OR (v_ip IS NOT NULL AND (SELECT count(*) FROM public.booking_attempts
       WHERE ip_hash = v_ip AND status = 'booked' AND at > now() - interval '1 day') >= 10)
     OR (v_ip IS NULL AND (SELECT count(*) FROM public.booking_attempts
       WHERE ip_hash IS NULL AND status = 'booked' AND at > now() - interval '1 day') >= 10) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'throttled');
  END IF;

  -- ---- The visitor's open lead, if any (nothing is written yet).
  SELECT * INTO v_lead
    FROM public.leads l
   WHERE l.email_norm = v_norm
     AND l.spam = false
     AND l.stage IN ('new', 'contacted', 'proposal')
   ORDER BY l.created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF FOUND THEN
    v_owner := v_lead.owner_id;
  ELSE
    -- Who a new lead would go to (034's round robin), so the host fallback
    -- below matches the owner the lead will get.
    v_owner := public.pick_lead_owner();
  END IF;

  -- ---- The host: the chosen one if still active, else the lead's owner,
  -- else the longest-standing active admin.
  SELECT p2.id INTO v_host FROM public.profiles p2
   WHERE p2.id = s.booking_host_id AND p2.deactivated_at IS NULL;
  IF v_host IS NULL THEN
    SELECT p2.id INTO v_host FROM public.profiles p2
     WHERE p2.id = v_owner AND p2.deactivated_at IS NULL;
  END IF;
  IF v_host IS NULL THEN
    SELECT p2.id INTO v_host FROM public.profiles p2
     WHERE p2.role = 'admin' AND p2.deactivated_at IS NULL
     ORDER BY p2.created_at, p2.id
     LIMIT 1;
  END IF;

  -- ---- The race guard (the edge function already checked Google).
  v_buffer := make_interval(mins => s.booking_buffer_minutes);
  IF public.booking_overlaps(v_host, v_start - v_buffer, v_end + v_buffer) THEN
    INSERT INTO public.booking_attempts (ip_hash, email_norm, status) VALUES (v_ip, v_norm, 'slot_taken');
    RETURN jsonb_build_object('ok', false, 'reason', 'slot_taken');
  END IF;

  -- ---- The lead: reuse (filling blanks) or create.
  SELECT c.id INTO v_existing
    FROM public.clients c
   WHERE lower(btrim(c.email)) = v_norm
   ORDER BY c.created_at
   LIMIT 1;

  IF v_lead.id IS NOT NULL THEN
    v_lead_id := v_lead.id;
    UPDATE public.leads l
       SET phone              = coalesce(l.phone, v_phone),
           company            = coalesce(l.company, v_company),
           existing_client_id = coalesce(l.existing_client_id, v_existing)
     WHERE l.id = v_lead_id
       AND (l.phone IS NULL AND v_phone IS NOT NULL
            OR l.company IS NULL AND v_company IS NOT NULL
            OR l.existing_client_id IS NULL AND v_existing IS NOT NULL);
  ELSE
    INSERT INTO public.leads
      (name, email, phone, company, source, form, message, consent_at, existing_client_id, owner_id, stage)
    VALUES
      (v_name, v_email, v_phone, v_company, 'website', 'booking', v_notes, now(), v_existing, v_owner, 'new')
    RETURNING id INTO v_lead_id;
    v_created := true;

    INSERT INTO public.lead_activity (lead_id, actor_id, action, detail)
    VALUES (v_lead_id, NULL, 'submitted', jsonb_strip_nulls(jsonb_build_object(
      'form', 'booking', 'source', 'website', 'message', v_notes, 'existing_client_id', v_existing)));
    IF v_owner IS NOT NULL THEN
      INSERT INTO public.lead_activity (lead_id, actor_id, action, detail)
      VALUES (v_lead_id, NULL, 'assigned', jsonb_build_object('owner_id', v_owner, 'auto', true, 'rule', 'pool'));
    END IF;
  END IF;

  SELECT * INTO v_lead FROM public.leads WHERE id = v_lead_id;
  v_client := coalesce(v_lead.client_id, v_lead.existing_client_id);

  -- ---- The meeting. Google shows the description to the visitor too, so it
  -- carries only what they gave us; the team's notes stay in `notes`.
  v_tz := public.google_calendar_default_tz();
  v_sync := EXISTS (SELECT 1 FROM public.google_workspace_link WHERE id AND status = 'active');
  v_desc := concat_ws(E'\n',
    'Booked on nixgensolutions.com',
    CASE WHEN v_company IS NOT NULL THEN 'Company: ' || v_company END,
    CASE WHEN v_phone IS NOT NULL THEN 'Phone: ' || v_phone END,
    CASE WHEN v_ctz IS NOT NULL THEN 'Their time zone: ' || v_ctz END,
    CASE WHEN v_notes IS NOT NULL THEN E'\n' || v_notes END);

  INSERT INTO public.events
    (kind, title, description, client_id, starts_at, ends_at, all_day, recurrence,
     created_by, timezone, sync_google, add_meet, lead_id, booked_via)
  VALUES
    ('meeting', left(s.booking_title || ' — ' || v_name, 200), v_desc, v_client, v_start, v_end, false, 'none',
     v_host, v_tz, v_sync, true, v_lead_id, 'website')
  RETURNING id INTO v_event;

  -- The host at their profile address (040's guard fills it in), then the
  -- visitor. A host without an address is left off rather than failing.
  IF v_host IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.profiles p2 WHERE p2.id = v_host AND nullif(btrim(p2.email), '') IS NOT NULL) THEN
    INSERT INTO public.event_attendees (event_id, profile_id, email)
    VALUES (v_event, v_host, NULL)
    ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO public.event_attendees (event_id, email, display_name)
  VALUES (v_event, v_norm, v_name)
  ON CONFLICT DO NOTHING;

  -- ---- The lead's history; 034's trigger takes this as the response.
  INSERT INTO public.lead_activity (lead_id, actor_id, action, detail)
  VALUES (v_lead_id, NULL, 'meeting_booked', jsonb_build_object(
    'event_id', v_event, 'starts_at', v_start, 'booked_via', 'website'));

  -- ---- Tell the host and the lead's owner. Someone who can't open leads
  -- gets a link to the meeting instead.
  v_when := to_char(v_start AT TIME ZONE v_tz, 'Dy DD Mon, HH24:MI') || ' ' || v_tz;
  v_title := left(v_name || ' booked a ' || lower(s.booking_title) || ': ' || v_when, 300);
  INSERT INTO public.notifications (user_id, actor_id, type, title, body, entity, entity_id)
  SELECT r.id, NULL, 'meeting_booked', v_title, v_company,
         CASE WHEN public.user_has_perm(r.id, 'growth', 'view') THEN 'lead' ELSE 'event' END,
         CASE WHEN public.user_has_perm(r.id, 'growth', 'view') THEN v_lead_id ELSE v_event END
    FROM public.profiles r
   WHERE r.id IN (v_host, v_lead.owner_id)
     AND r.deactivated_at IS NULL;

  INSERT INTO public.booking_attempts (ip_hash, email_norm, event_id, status)
  VALUES (v_ip, v_norm, v_event, 'booked');

  RETURN jsonb_build_object(
    'ok', true,
    'event_id', v_event,
    'lead_id', v_lead_id,
    'lead_created', v_created,
    'host_id', v_host,
    'starts_at', v_start,
    'ends_at', v_end);
END;
$$;

REVOKE ALL ON FUNCTION public.booking_record(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_record(jsonb) TO service_role;

COMMENT ON COLUMN public.notifications.type IS
  'task_assigned|task_updated|project_updated|client_updated|crm_updated|event_updated|meeting_updated|due_reminder|channel_mention|lead_new|lead_sla|lead_followup|lead_assigned|showcase_ready|form_submitted|meeting_booked|system';

-- ---------- 6. Retention ----------
CREATE OR REPLACE FUNCTION public.purge_booking_attempts()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  DELETE FROM public.booking_attempts WHERE at < now() - interval '7 days';
$$;

REVOKE ALL ON FUNCTION public.purge_booking_attempts() FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-booking-attempts') THEN
    PERFORM cron.unschedule('purge-booking-attempts');
  END IF;
  PERFORM cron.schedule('purge-booking-attempts', '35 3 * * *',
    $cron$ SELECT public.purge_booking_attempts() $cron$);
END $$;
