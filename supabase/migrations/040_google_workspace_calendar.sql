-- ============================================
-- DeskDev Studio — 040: Google Workspace calendar (C1) + personal ICS feeds (C1b)
-- One-way sync: DeskDev events → the "NixGen Team" calendar on the company
-- Google account. Runbook: supabase/functions/google-calendar/README.md.
--
--   google_workspace_link        the company grant (one row; RLS on, no policies)
--   google_connections CHECK     widened from 'v1.%' to '^v[0-9]+\.' (sealed-token v2, C0)
--   events (+ columns)           timezone, sync switch, Meet switch, sync bookkeeping
--   event_attendees              teammates and client emails invited to an event
--   google_sync_outbox           one pending row per event that needs a push
--   google_calendar_kick()       pg_net POST to the google-calendar function (029 pattern)
--   google_sync_claim/complete/release   the worker's only way in (service role)
--   google_workspace_link triggers   grant lifecycle (switch, kick, revoked → admins)
--   google_workspace_mark_revoked / status
--   google_calendar_retry()      cron every 2 minutes: stale claims, backoff, purge
--   calendar_feed_tokens         hashed, rotatable personal feed tokens (C1b)
--   calendar_feed(token)         the feed's data, keyed by the token's hash
--
-- Loop guard: the worker writes back (event id, etag, Meet link, status)
-- only through google_sync_complete(), which sets the transaction-local
-- setting deskdev.google_sync = 'on'. The events trigger returns early when
-- it sees that setting, so a write-back never queues another push. On top of
-- that, only a change to a column Google actually shows queues a push.
--
-- Applying this before Google is connected is harmless: the trigger queues
-- rows only for events with sync_google = true, the kick does nothing until
-- the link is active AND both Vault secrets exist, and nothing can fail a
-- user's write. Enable delivery later (SQL editor, as postgres):
--
--   SELECT vault.create_secret('https://<ref>.supabase.co/functions/v1/google-calendar', 'deskdev_google_calendar_url');
--   SELECT vault.create_secret('<GOOGLE_CALENDAR_WEBHOOK_SECRET>', 'deskdev_google_calendar_secret');
--
-- Depends on 032 (profiles.deactivated_at, write_audit_log) and 033
-- (user_has_perm, workspace_settings). Re-runnable throughout.
-- ============================================

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ---------- 1. The company grant ----------
-- One row (id is always true). The refresh token is sealed by the google
-- function's token module (AES-256-GCM, versioned prefix), so a table dump
-- is not a working Google grant. A grant Google revoked is kept with
-- status = 'revoked' instead of being deleted: the admins get told, the
-- calendar id survives, and reconnecting the same account resumes the sync.
CREATE TABLE IF NOT EXISTS public.google_workspace_link (
  id                 boolean PRIMARY KEY DEFAULT true CHECK (id),
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  google_email       text NOT NULL,
  scopes             text[] NOT NULL DEFAULT '{}',
  -- NULL after an admin's Disconnect (the google function clears it and
  -- revokes it at Google); always set while active.
  refresh_token_enc  text CHECK (refresh_token_enc IS NULL OR refresh_token_enc ~ '^v[0-9]+\.'),
  -- The "NixGen Team" calendar the function created (calendar.app.created
  -- only reaches calendars the app made). NULL until the first sync.
  calendar_id        text,
  calendar_time_zone text,
  connected_by       uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  connected_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at         timestamptz,
  revoked_reason     text,
  last_sync_at       timestamptz,
  last_error         text,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_workspace_link_active_has_token
    CHECK (status <> 'active' OR refresh_token_enc IS NOT NULL)
);

DROP TRIGGER IF EXISTS google_workspace_link_set_updated_at ON public.google_workspace_link;
CREATE TRIGGER google_workspace_link_set_updated_at
  BEFORE UPDATE ON public.google_workspace_link
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS on with NO policies, like google_connections (027): only the service
-- role (inside the edge functions) touches the row. Admins read a redacted
-- status through google_workspace_status().
ALTER TABLE public.google_workspace_link ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_workspace_link FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.google_workspace_link TO service_role;

-- Personal grants (027) may now be sealed as v2 (key ids, rotatable keys):
-- 027's CHECK only allowed 'v1.%'. Until this runs, the google function
-- falls back to writing v1, so the order of deploy and migration is free.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
     WHERE con.conrelid = 'public.google_connections'::regclass
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%refresh_token_enc%'
  LOOP
    EXECUTE format('ALTER TABLE public.google_connections DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.google_connections
    ADD CONSTRAINT google_connections_refresh_token_enc_check CHECK (refresh_token_enc ~ '^v[0-9]+\.');
END $$;

-- ---------- 2. Time zones ----------
-- IANA names only. Postgres also accepts POSIX strings like 'UTC+8' (with
-- the sign inverted), which Google and the browser's Intl reject, so the
-- shape is checked before Postgres is asked.
CREATE OR REPLACE FUNCTION public.is_valid_time_zone(p_tz text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_tz IS NULL OR length(p_tz) > 64
     OR p_tz !~ '^(UTC|[A-Za-z]+(/[A-Za-z0-9_+-]+){1,2})$' THEN
    RETURN false;
  END IF;
  PERFORM now() AT TIME ZONE p_tz;
  RETURN true;
EXCEPTION WHEN others THEN
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.is_valid_time_zone(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_valid_time_zone(text) TO authenticated, service_role;

-- The zone an event without one is planned in: the team calendar's zone,
-- then the business-hours zone (033), then UTC. Internal only.
CREATE OR REPLACE FUNCTION public.google_calendar_default_tz()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v text;
BEGIN
  SELECT nullif(btrim(calendar_time_zone), '') INTO v FROM public.google_workspace_link WHERE id;
  IF v IS NULL THEN
    BEGIN
      SELECT nullif(btrim(growth_business_hours ->> 'tz'), '') INTO v FROM public.workspace_settings WHERE id;
    EXCEPTION WHEN undefined_table OR undefined_column THEN
      v := NULL;
    END;
  END IF;
  IF v IS NULL OR NOT public.is_valid_time_zone(v) THEN
    v := 'UTC';
  END IF;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.google_calendar_default_tz() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.google_calendar_default_tz() TO authenticated, service_role;

-- ---------- 3. events: sync columns ----------
-- timezone: recurrences repeat at the same wall-clock time in this zone
--   (without it a weekly 9:00 drifts an hour across DST).
-- sync_google / add_meet: the user's switches.
-- google_event_id … sync_error: written by the worker only (trigger below).
-- origin: 'google' is for the inbound sync (C2); C1 only writes 'deskdev'.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS timezone        text,
  ADD COLUMN IF NOT EXISTS sync_google     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS add_meet        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS google_event_id text,
  ADD COLUMN IF NOT EXISTS google_etag     text,
  ADD COLUMN IF NOT EXISTS sync_status     text,
  ADD COLUMN IF NOT EXISTS sync_error      text,
  ADD COLUMN IF NOT EXISTS origin          text NOT NULL DEFAULT 'deskdev';

ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_sync_status_check;
ALTER TABLE public.events
  ADD CONSTRAINT events_sync_status_check
  CHECK (sync_status IS NULL OR sync_status IN ('pending', 'synced', 'error'));

ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_origin_check;
ALTER TABLE public.events
  ADD CONSTRAINT events_origin_check CHECK (origin IN ('deskdev', 'google'));

CREATE UNIQUE INDEX IF NOT EXISTS events_google_event_id_key
  ON public.events (google_event_id) WHERE google_event_id IS NOT NULL;

-- ---------- 4. The outbox ----------
-- One row per push. A partial unique index keeps at most ONE pending row per
-- event, so ten quick edits become one push of the latest state (the worker
-- always reads the event as it is now, never a snapshot). No FK to events:
-- a delete must outlive the event it removes from Google.
CREATE TABLE IF NOT EXISTS public.google_sync_outbox (
  id              bigserial PRIMARY KEY,
  event_id        uuid NOT NULL,
  op              text NOT NULL CHECK (op IN ('upsert', 'delete')),
  -- The Google id at the time of a delete (the event row may be gone).
  google_event_id text,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts        int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at       timestamptz,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS google_sync_outbox_one_pending
  ON public.google_sync_outbox (event_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS google_sync_outbox_due_idx
  ON public.google_sync_outbox (next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS google_sync_outbox_status_idx
  ON public.google_sync_outbox (status, updated_at);

ALTER TABLE public.google_sync_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_sync_outbox FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.google_sync_outbox TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.google_sync_outbox_id_seq TO service_role;

-- The id Google stores the event under. Deterministic, so a retried insert
-- after a lost response answers 409 instead of creating a duplicate (and
-- sending every guest a second invitation). Google event ids use base32hex
-- (a–v, 0–9), 5–1024 chars; a uuid's hex digits are a subset.
-- Mirrored in supabase/functions/google-calendar/mapping.ts (googleEventId).
CREATE OR REPLACE FUNCTION public.google_calendar_event_id(p_event uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT 'dd' || replace(p_event::text, '-', '');
$$;

REVOKE ALL ON FUNCTION public.google_calendar_event_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.google_calendar_event_id(uuid) TO authenticated, service_role;

-- Ask the function to drain the outbox. Once per transaction (a bulk edit
-- is one request), only while the grant is active, and never an exception:
-- it runs inside the events trigger, and a user's edit must not fail because
-- Google is down. pg_net sends after commit, so a rolled-back edit sends
-- nothing; the body is only a pointer, the function reads the outbox itself.
CREATE OR REPLACE FUNCTION public.google_calendar_kick(p_force boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_url    text;
  v_secret text;
BEGIN
  BEGIN
    IF NOT p_force AND coalesce(current_setting('deskdev.google_kicked', true), '') = 'on' THEN
      RETURN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.google_workspace_link WHERE id AND status = 'active') THEN
      RETURN;
    END IF;

    SELECT nullif(trim(decrypted_secret), '') INTO v_url
      FROM vault.decrypted_secrets WHERE name = 'deskdev_google_calendar_url' LIMIT 1;
    SELECT nullif(trim(decrypted_secret), '') INTO v_secret
      FROM vault.decrypted_secrets WHERE name = 'deskdev_google_calendar_secret' LIMIT 1;
    IF v_url IS NULL OR v_secret IS NULL THEN
      RETURN;
    END IF;

    PERFORM net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
      body    := jsonb_build_object('action', 'drain'),
      timeout_milliseconds := 10000
    );
    PERFORM set_config('deskdev.google_kicked', 'on', true);
  EXCEPTION WHEN others THEN
    RAISE WARNING 'google_calendar_kick: %', SQLERRM;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.google_calendar_kick(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.google_calendar_kick(boolean) TO service_role;

-- Queue (or refresh) the one pending push for an event, then kick. A newer
-- intent replaces an older one: delete after upsert means delete, upsert
-- after delete means upsert (the worker reads the event as it is then).
CREATE OR REPLACE FUNCTION public.google_sync_enqueue(p_event uuid, p_op text, p_google_event_id text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.google_sync_outbox AS o (event_id, op, google_event_id)
  VALUES (p_event, p_op, p_google_event_id)
  ON CONFLICT (event_id) WHERE status = 'pending' DO UPDATE
    SET op              = EXCLUDED.op,
        google_event_id = coalesce(EXCLUDED.google_event_id, o.google_event_id),
        attempts        = 0,
        next_attempt_at = now(),
        last_error      = NULL,
        updated_at      = now();
  PERFORM public.google_calendar_kick();
END;
$$;

REVOKE ALL ON FUNCTION public.google_sync_enqueue(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.google_sync_enqueue(uuid, text, text) TO service_role;

-- ---------- 5. events trigger: validate, protect, queue ----------
CREATE OR REPLACE FUNCTION public.google_calendar_events_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_worker   boolean := coalesce(current_setting('deskdev.google_sync', true), '') = 'on';
  v_material boolean;
BEGIN
  NEW.timezone := nullif(btrim(NEW.timezone), '');
  IF NEW.timezone IS NOT NULL AND NOT public.is_valid_time_zone(NEW.timezone) THEN
    RAISE EXCEPTION 'Unknown time zone "%"', left(NEW.timezone, 64) USING ERRCODE = '22023';
  END IF;

  -- Loop guard: the worker's own write-back never queues another push.
  IF v_worker THEN
    RETURN NEW;
  END IF;

  -- Sync bookkeeping belongs to the server. A signed-in client that sends
  -- these (a whole-row save) is ignored rather than refused; a forged
  -- google_event_id could otherwise aim a delete at another calendar entry.
  IF auth.uid() IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      NEW.google_event_id := NULL;
      NEW.google_etag     := NULL;
      NEW.sync_status     := NULL;
      NEW.sync_error      := NULL;
      NEW.origin          := 'deskdev';
    ELSE
      NEW.google_event_id := OLD.google_event_id;
      NEW.google_etag     := OLD.google_etag;
      NEW.sync_status     := OLD.sync_status;
      NEW.sync_error      := OLD.sync_error;
      NEW.origin          := OLD.origin;
    END IF;
  END IF;

  -- Meet switched off: the Meet link Google made goes with it (a link the
  -- user changed in the same save is theirs and stays).
  IF TG_OP = 'UPDATE' AND OLD.add_meet AND NOT NEW.add_meet
     AND NEW.meeting_link IS NOT DISTINCT FROM OLD.meeting_link
     AND NEW.meeting_link ~ '^https://meet\.google\.com/' THEN
    NEW.meeting_link := NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.sync_google THEN
      NEW.sync_status := 'pending';
      NEW.sync_error  := NULL;
      PERFORM public.google_sync_enqueue(NEW.id, 'upsert', NEW.google_event_id);
    END IF;
    RETURN NEW;
  END IF;

  -- Only what Google shows counts. Meeting notes, colour and the client link
  -- never leave DeskDev, so editing them pushes nothing.
  v_material := ROW(NEW.kind, NEW.title, NEW.description, NEW.starts_at, NEW.ends_at, NEW.all_day,
                    NEW.location, NEW.meeting_link, NEW.recurrence, NEW.recurrence_until,
                    NEW.timezone, NEW.add_meet)
    IS DISTINCT FROM
                ROW(OLD.kind, OLD.title, OLD.description, OLD.starts_at, OLD.ends_at, OLD.all_day,
                    OLD.location, OLD.meeting_link, OLD.recurrence, OLD.recurrence_until,
                    OLD.timezone, OLD.add_meet);

  IF NEW.sync_google AND (v_material OR NOT OLD.sync_google) THEN
    NEW.sync_status := 'pending';
    NEW.sync_error  := NULL;
    PERFORM public.google_sync_enqueue(NEW.id, 'upsert', NEW.google_event_id);
  ELSIF OLD.sync_google AND NOT NEW.sync_google THEN
    -- Switched off: take it off the team calendar (guests get a cancellation).
    NEW.sync_status := 'pending';
    NEW.sync_error  := NULL;
    PERFORM public.google_sync_enqueue(NEW.id, 'delete', coalesce(OLD.google_event_id, public.google_calendar_event_id(OLD.id)));
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.google_calendar_events_deleted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF coalesce(current_setting('deskdev.google_sync', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  IF OLD.sync_google OR OLD.google_event_id IS NOT NULL THEN
    PERFORM public.google_sync_enqueue(OLD.id, 'delete', coalesce(OLD.google_event_id, public.google_calendar_event_id(OLD.id)));
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.google_calendar_events_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.google_calendar_events_deleted() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS google_calendar_events_guard ON public.events;
CREATE TRIGGER google_calendar_events_guard
  BEFORE INSERT OR UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.google_calendar_events_guard();

DROP TRIGGER IF EXISTS google_calendar_events_deleted ON public.events;
CREATE TRIGGER google_calendar_events_deleted
  AFTER DELETE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.google_calendar_events_deleted();

-- ---------- 6. event_attendees ----------
-- A teammate (profile_id, email filled from the profile) or anyone by email
-- (a client). Google owns the RSVP: clients cannot set response_status, the
-- inbound sync (C2) writes it.
CREATE TABLE IF NOT EXISTS public.event_attendees (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
  profile_id      uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  email           text NOT NULL
                    CHECK (length(email) <= 320 AND email ~ '^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$'),
  display_name    text CHECK (display_name IS NULL OR length(display_name) <= 200),
  optional        boolean NOT NULL DEFAULT false,
  response_status text NOT NULL DEFAULT 'needsAction'
                    CHECK (response_status IN ('needsAction', 'declined', 'tentative', 'accepted')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS event_attendees_event_email_key
  ON public.event_attendees (event_id, lower(email));
CREATE INDEX IF NOT EXISTS event_attendees_profile_idx
  ON public.event_attendees (profile_id) WHERE profile_id IS NOT NULL;

DROP TRIGGER IF EXISTS event_attendees_set_updated_at ON public.event_attendees;
CREATE TRIGGER event_attendees_set_updated_at
  BEFORE UPDATE ON public.event_attendees
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Writes need edit access to the event's kind, exactly like events (005).
CREATE OR REPLACE FUNCTION public.can_edit_event(p_event uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
     WHERE e.id = p_event
       AND ((e.kind = 'event'   AND public.has_perm('calendar', 'edit'))
         OR (e.kind = 'meeting' AND public.has_perm('meetings', 'edit')))
  );
$$;

REVOKE ALL ON FUNCTION public.can_edit_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_edit_event(uuid) TO authenticated;

ALTER TABLE public.event_attendees ENABLE ROW LEVEL SECURITY;

-- Read: whoever can read the event (the subquery runs under events' RLS).
DROP POLICY IF EXISTS "event_attendees_select" ON public.event_attendees;
CREATE POLICY "event_attendees_select"
  ON public.event_attendees FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id));

DROP POLICY IF EXISTS "event_attendees_insert" ON public.event_attendees;
CREATE POLICY "event_attendees_insert"
  ON public.event_attendees FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_event(event_id));

DROP POLICY IF EXISTS "event_attendees_update" ON public.event_attendees;
CREATE POLICY "event_attendees_update"
  ON public.event_attendees FOR UPDATE TO authenticated
  USING (public.can_edit_event(event_id))
  WITH CHECK (public.can_edit_event(event_id));

DROP POLICY IF EXISTS "event_attendees_delete" ON public.event_attendees;
CREATE POLICY "event_attendees_delete"
  ON public.event_attendees FOR DELETE TO authenticated
  USING (public.can_edit_event(event_id));

REVOKE ALL ON public.event_attendees FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.event_attendees FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_attendees TO authenticated;
GRANT ALL ON public.event_attendees TO service_role;

CREATE OR REPLACE FUNCTION public.event_attendees_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_worker boolean := coalesce(current_setting('deskdev.google_sync', true), '') = 'on';
BEGIN
  -- A teammate is invited at their profile address unless one is given.
  IF NEW.profile_id IS NOT NULL AND nullif(btrim(NEW.email), '') IS NULL THEN
    SELECT p.email INTO NEW.email FROM public.profiles p WHERE p.id = NEW.profile_id;
  END IF;
  NEW.email := lower(btrim(NEW.email));
  NEW.display_name := nullif(btrim(NEW.display_name), '');

  IF auth.uid() IS NOT NULL AND NOT v_worker THEN
    -- An attendee cannot be moved to another event, and the RSVP is Google's.
    IF TG_OP = 'INSERT' THEN
      NEW.response_status := 'needsAction';
    ELSE
      NEW.event_id := OLD.event_id;
      IF lower(NEW.email) IS DISTINCT FROM lower(OLD.email) THEN
        NEW.response_status := 'needsAction';
      ELSE
        NEW.response_status := OLD.response_status;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.event_attendees_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS event_attendees_guard ON public.event_attendees;
CREATE TRIGGER event_attendees_guard
  BEFORE INSERT OR UPDATE ON public.event_attendees
  FOR EACH ROW EXECUTE FUNCTION public.event_attendees_guard();

-- A changed guest list is a change to the Google event. An RSVP is not
-- (Google told us), and a cascade from a deleted event finds no event row.
CREATE OR REPLACE FUNCTION public.event_attendees_queue_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.event_id ELSE NEW.event_id END;
BEGIN
  IF coalesce(current_setting('deskdev.google_sync', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE'
     AND lower(NEW.email) = lower(OLD.email)
     AND NEW.optional = OLD.optional
     AND NEW.display_name IS NOT DISTINCT FROM OLD.display_name THEN
    RETURN NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM public.events WHERE id = v_event AND sync_google) THEN
    -- The sync chip shows "pending". The events guard would put back the old
    -- status for a signed-in caller, so this one write runs as the server's,
    -- and the guard is switched back on straight after.
    PERFORM set_config('deskdev.google_sync', 'on', true);
    UPDATE public.events
       SET sync_status = 'pending', sync_error = NULL
     WHERE id = v_event AND sync_status IS DISTINCT FROM 'pending';
    PERFORM set_config('deskdev.google_sync', '', true);
    PERFORM public.google_sync_enqueue(v_event, 'upsert', NULL);
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.event_attendees_queue_sync() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS event_attendees_queue_sync ON public.event_attendees;
CREATE TRIGGER event_attendees_queue_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.event_attendees
  FOR EACH ROW EXECUTE FUNCTION public.event_attendees_queue_sync();

-- ---------- 7. The worker's RPCs (service role only) ----------
-- Claim due rows. An event that already has a row in flight is skipped, so
-- two workers never push the same event at once; SKIP LOCKED keeps two
-- workers off the same row. Each row comes with the event as it is NOW
-- (NULL when it is gone) and its guest list.
CREATE OR REPLACE FUNCTION public.google_sync_claim(p_limit int DEFAULT 20)
RETURNS TABLE (
  id              bigint,
  event_id        uuid,
  op              text,
  google_event_id text,
  attempts        int,
  event           jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT o.id
      FROM public.google_sync_outbox o
     WHERE o.status = 'pending'
       AND o.next_attempt_at <= now()
       AND NOT EXISTS (
         SELECT 1 FROM public.google_sync_outbox p
          WHERE p.event_id = o.event_id AND p.status = 'processing')
     ORDER BY o.id
     LIMIT greatest(1, least(coalesce(p_limit, 20), 100))
     FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.google_sync_outbox o
       SET status = 'processing', locked_at = now(), attempts = o.attempts + 1, updated_at = now()
      FROM due
     WHERE o.id = due.id
    RETURNING o.id, o.event_id, o.op, o.google_event_id, o.attempts
  )
  SELECT c.id, c.event_id, c.op, c.google_event_id, c.attempts,
         CASE WHEN e.id IS NULL THEN NULL ELSE
           (to_jsonb(e) - 'notes' - 'color')
           || jsonb_build_object(
                'default_time_zone', public.google_calendar_default_tz(),
                'attendees', coalesce((
                  SELECT jsonb_agg(jsonb_build_object(
                           'email', a.email,
                           'display_name', coalesce(a.display_name, pr.full_name),
                           'optional', a.optional,
                           'profile_id', a.profile_id)
                         ORDER BY a.created_at, a.id)
                    FROM public.event_attendees a
                    LEFT JOIN public.profiles pr ON pr.id = a.profile_id
                   WHERE a.event_id = e.id), '[]'::jsonb))
         END
    FROM claimed c
    LEFT JOIN public.events e ON e.id = c.event_id
   ORDER BY c.id;
END;
$$;

-- Hand rows back untouched (the grant died mid-run): the attempt does not count.
CREATE OR REPLACE FUNCTION public.google_sync_release(p_ids bigint[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT o.id, o.event_id FROM public.google_sync_outbox o
     WHERE o.id = ANY (coalesce(p_ids, '{}')) AND o.status = 'processing'
  LOOP
    IF EXISTS (SELECT 1 FROM public.google_sync_outbox p WHERE p.event_id = r.event_id AND p.status = 'pending') THEN
      -- A newer edit is already queued; it carries the latest state.
      UPDATE public.google_sync_outbox SET status = 'done', locked_at = NULL, last_error = 'superseded', updated_at = now()
       WHERE id = r.id;
    ELSE
      UPDATE public.google_sync_outbox
         SET status = 'pending', locked_at = NULL, attempts = greatest(attempts - 1, 0), updated_at = now()
       WHERE id = r.id;
    END IF;
  END LOOP;
END;
$$;

-- Retry backoff: 1, 2, 4 … minutes, capped at 6 hours; the 10th failure is final.
-- Mirrored in supabase/functions/google-calendar/mapping.ts (retryDelayMinutes).
CREATE OR REPLACE FUNCTION public.google_sync_backoff(p_attempts int)
RETURNS interval
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT least(interval '6 hours', interval '1 minute' * power(2, greatest(coalesce(p_attempts, 1), 1) - 1));
$$;

-- Record one push. p_result: 'done' | 'retry' (transient) | 'failed' (final).
-- Every write here runs with deskdev.google_sync = 'on' (the loop guard).
CREATE OR REPLACE FUNCTION public.google_sync_complete(
  p_id              bigint,
  p_result          text,
  p_error           text DEFAULT NULL,
  p_google_event_id text DEFAULT NULL,
  p_etag            text DEFAULT NULL,
  p_meet_url        text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  o          public.google_sync_outbox%ROWTYPE;
  v_error    text := left(nullif(btrim(p_error), ''), 500);
  v_newer    boolean;
  v_final    boolean;
BEGIN
  IF p_result NOT IN ('done', 'retry', 'failed') THEN
    RAISE EXCEPTION 'unknown result %', p_result USING ERRCODE = '22023';
  END IF;

  SELECT * INTO o FROM public.google_sync_outbox WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR o.status <> 'processing' THEN
    RETURN; -- released or reclaimed meanwhile; the newer owner reports
  END IF;

  PERFORM set_config('deskdev.google_sync', 'on', true);

  v_newer := EXISTS (SELECT 1 FROM public.google_sync_outbox p
                      WHERE p.event_id = o.event_id AND p.status = 'pending');
  v_final := p_result = 'failed' OR (p_result = 'retry' AND o.attempts >= 10);

  IF p_result = 'done' THEN
    UPDATE public.google_sync_outbox
       SET status = 'done', locked_at = NULL, last_error = NULL, updated_at = now()
     WHERE id = o.id;

    IF o.op = 'upsert' THEN
      UPDATE public.events e
         SET google_event_id = coalesce(nullif(p_google_event_id, ''), e.google_event_id),
             google_etag     = coalesce(nullif(p_etag, ''), e.google_etag),
             -- Google's Meet link fills an empty field only; a link someone
             -- typed is never overwritten.
             meeting_link    = CASE
                                 WHEN e.meeting_link IS NULL AND p_meet_url ~ '^https://meet\.google\.com/'
                                 THEN p_meet_url ELSE e.meeting_link END,
             sync_status     = CASE WHEN v_newer THEN 'pending' ELSE 'synced' END,
             sync_error      = NULL
       WHERE e.id = o.event_id;
    ELSE
      -- Off the calendar. The event (if it still exists, sync switched off)
      -- forgets its Google id; switching sync back on creates it again.
      UPDATE public.events e
         SET google_event_id = NULL,
             google_etag     = NULL,
             sync_status     = CASE WHEN v_newer THEN 'pending' ELSE NULL END,
             sync_error      = NULL
       WHERE e.id = o.event_id AND NOT e.sync_google;
    END IF;

    UPDATE public.google_workspace_link SET last_sync_at = now(), last_error = NULL WHERE id;
    RETURN;
  END IF;

  IF v_final OR v_newer THEN
    -- Final, or a newer edit is queued (it gets its own fresh attempts).
    UPDATE public.google_sync_outbox
       SET status = CASE WHEN v_final AND NOT v_newer THEN 'failed' ELSE 'done' END,
           locked_at = NULL,
           last_error = CASE WHEN v_newer AND NOT v_final THEN 'superseded: ' ELSE '' END || coalesce(v_error, 'failed'),
           updated_at = now()
     WHERE id = o.id;
  ELSE
    UPDATE public.google_sync_outbox
       SET status = 'pending',
           locked_at = NULL,
           last_error = v_error,
           next_attempt_at = now() + public.google_sync_backoff(o.attempts),
           updated_at = now()
     WHERE id = o.id;
  END IF;

  UPDATE public.events
     SET sync_status = CASE WHEN v_newer THEN 'pending' ELSE 'error' END,
         sync_error  = CASE WHEN v_newer THEN NULL ELSE coalesce(v_error, 'Google Calendar sync failed') END
   WHERE id = o.event_id;

  UPDATE public.google_workspace_link SET last_error = coalesce(v_error, 'sync failed') WHERE id;
END;
$$;

-- The function stores the calendar it created. First writer wins: when two
-- runs raced to create one, the loser is told the winner's id (and deletes
-- its own copy).
CREATE OR REPLACE FUNCTION public.google_workspace_set_calendar(p_calendar_id text, p_time_zone text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v text;
BEGIN
  UPDATE public.google_workspace_link
     SET calendar_id = p_calendar_id,
         calendar_time_zone = CASE WHEN public.is_valid_time_zone(p_time_zone) THEN p_time_zone ELSE calendar_time_zone END
   WHERE id AND calendar_id IS NULL
  RETURNING calendar_id INTO v;
  IF v IS NULL THEN
    SELECT calendar_id INTO v FROM public.google_workspace_link WHERE id;
  END IF;
  RETURN v;
END;
$$;

-- The team calendar was deleted on the Google side: forget it, so the next
-- run creates a new one, and push every synced event to it again.
CREATE OR REPLACE FUNCTION public.google_workspace_calendar_lost(p_calendar_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
BEGIN
  UPDATE public.google_workspace_link SET calendar_id = NULL WHERE id AND calendar_id = p_calendar_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  PERFORM set_config('deskdev.google_sync', 'on', true);
  UPDATE public.events
     SET google_event_id = NULL, google_etag = NULL, sync_status = 'pending', sync_error = NULL
   WHERE sync_google;
  FOR r IN SELECT id FROM public.events WHERE sync_google LOOP
    PERFORM public.google_sync_enqueue(r.id, 'upsert', NULL);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.google_sync_claim(int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.google_sync_release(bigint[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.google_sync_backoff(int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.google_sync_complete(bigint, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.google_workspace_set_calendar(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.google_workspace_calendar_lost(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.google_sync_claim(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.google_sync_release(bigint[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.google_sync_backoff(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.google_sync_complete(bigint, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.google_workspace_set_calendar(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.google_workspace_calendar_lost(text) TO service_role;

-- ---------- 8. Grant lifecycle ----------
-- The google function (C0) writes this row directly with the service role:
-- 'finish' upserts it (status 'active'), 'disconnect' sets status 'revoked'
-- and clears the token, and the shared token module (accessTokenForWorkspace)
-- sets status 'revoked' when Google answers invalid_grant. So the side
-- effects live in triggers on the row, whoever writes it:
--   - a different Google account means a different calendar: the calendar
--     id is dropped and every synced event is pushed to the new one;
--   - (re)connecting kicks the worker, so changes queued while disconnected go;
--   - Google revoking the grant (token still stored, i.e. not an admin's
--     Disconnect) tells every active admin, once per revocation, and is audited.
--     An admin's Disconnect is audited by the google function itself.
-- An earlier draft of this file stored the grant through an RPC; the row
-- triggers replace it, so a database that ran the draft loses it here.
DROP FUNCTION IF EXISTS public.google_workspace_store_grant(text, text[], text, uuid);

CREATE OR REPLACE FUNCTION public.google_workspace_link_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.google_email := lower(btrim(NEW.google_email));

  IF TG_OP = 'UPDATE' AND NEW.google_email IS DISTINCT FROM lower(btrim(OLD.google_email)) THEN
    NEW.calendar_id := NULL;
    NEW.calendar_time_zone := NULL;
  END IF;

  IF NEW.status = 'active' THEN
    NEW.revoked_at := NULL;
    NEW.revoked_reason := NULL;
  ELSIF TG_OP = 'INSERT' OR OLD.status = 'active' THEN
    NEW.revoked_at := coalesce(NEW.revoked_at, now());
    NEW.revoked_reason := left(coalesce(
      nullif(btrim(NEW.revoked_reason), ''),
      CASE WHEN NEW.refresh_token_enc IS NULL THEN 'disconnected' END,
      nullif(btrim(NEW.last_error), ''),
      'revoked'), 200);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.google_workspace_link_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_switch    boolean := TG_OP = 'UPDATE' AND NEW.google_email IS DISTINCT FROM OLD.google_email;
  v_connected boolean := NEW.status = 'active'
                         AND (TG_OP = 'INSERT' OR OLD.status <> 'active' OR v_switch
                              OR NEW.connected_at IS DISTINCT FROM OLD.connected_at);
  r record;
BEGIN
  IF v_switch THEN
    PERFORM set_config('deskdev.google_sync', 'on', true);
    UPDATE public.events
       SET google_event_id = NULL, google_etag = NULL, sync_status = 'pending', sync_error = NULL
     WHERE sync_google;
    PERFORM set_config('deskdev.google_sync', '', true);
    FOR r IN SELECT id FROM public.events WHERE sync_google LOOP
      PERFORM public.google_sync_enqueue(r.id, 'upsert', NULL);
    END LOOP;
  END IF;

  IF v_connected THEN
    -- Whatever piled up while disconnected goes now.
    PERFORM public.google_calendar_kick(true);
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'active' AND NEW.status = 'revoked'
     AND NEW.refresh_token_enc IS NOT NULL THEN
    -- Google refused the grant (revoked in the Google account, password
    -- reset, 6 months unused, or a consent screen left in Testing). No
    -- auth.uid() here (service role or cron), so 030's guard does not apply;
    -- 'system' notifications open the notifications page.
    INSERT INTO public.notifications (user_id, actor_id, type, title, body)
    SELECT p.id, auth.uid(), 'system',
           'Google Calendar disconnected',
           'DeskDev can no longer update the team calendar. Connect the company Google account again in Settings → Integrations; queued changes will sync then.'
      FROM public.profiles p
     WHERE p.role = 'admin' AND p.deactivated_at IS NULL;

    BEGIN
      PERFORM public.write_audit_log('google.workspace_revoked', 'google_workspace_link', 'workspace',
        jsonb_build_object('google_email', NEW.google_email, 'reason', NEW.revoked_reason), NULL);
    EXCEPTION WHEN undefined_function THEN
      NULL; -- 032 not applied: still revoked, unaudited
    END;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.google_workspace_link_lifecycle() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.google_workspace_link_changed() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS google_workspace_link_lifecycle ON public.google_workspace_link;
CREATE TRIGGER google_workspace_link_lifecycle
  BEFORE INSERT OR UPDATE ON public.google_workspace_link
  FOR EACH ROW EXECUTE FUNCTION public.google_workspace_link_lifecycle();

DROP TRIGGER IF EXISTS google_workspace_link_changed ON public.google_workspace_link;
CREATE TRIGGER google_workspace_link_changed
  AFTER INSERT OR UPDATE ON public.google_workspace_link
  FOR EACH ROW EXECUTE FUNCTION public.google_workspace_link_changed();

-- The worker's way to retire a grant Google no longer honours for the
-- calendar (e.g. the calendar scope was unticked on the consent screen).
-- The triggers above notify and audit. Returns true when this call changed
-- the status.
CREATE OR REPLACE FUNCTION public.google_workspace_mark_revoked(p_reason text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.google_workspace_link
     SET status = 'revoked', revoked_at = now(),
         revoked_reason = left(coalesce(nullif(btrim(p_reason), ''), 'revoked'), 200)
   WHERE id AND status = 'active';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.google_workspace_mark_revoked(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.google_workspace_mark_revoked(text) TO service_role;

-- What the app may know. Admins: the account, calendar and queue health.
-- Calendar/meetings viewers: only whether sync is on (for the sync chip).
-- Everyone else: NULL. Never the token.
CREATE OR REPLACE FUNCTION public.google_workspace_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  l public.google_workspace_link%ROWTYPE;
  v_status text;
BEGIN
  IF NOT (public.has_perm('calendar', 'view') OR public.has_perm('meetings', 'view')) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO l FROM public.google_workspace_link WHERE id;
  v_status := coalesce(l.status, 'disconnected');

  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('status', v_status);
  END IF;

  RETURN jsonb_build_object(
    'status',        v_status,
    'googleEmail',   l.google_email,
    'calendarReady', l.calendar_id IS NOT NULL,
    'calendarTimeZone', l.calendar_time_zone,
    'connectedAt',   l.connected_at,
    'revokedAt',     l.revoked_at,
    'revokedReason', l.revoked_reason,
    'lastSyncAt',    l.last_sync_at,
    'lastError',     l.last_error,
    'pending',       (SELECT count(*) FROM public.google_sync_outbox WHERE status IN ('pending', 'processing')),
    'failed',        (SELECT count(*) FROM public.google_sync_outbox WHERE status = 'failed' AND updated_at > now() - interval '7 days')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.google_workspace_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.google_workspace_status() TO authenticated, service_role;

-- An admin's "Sync now" / "Retry failed": failed pushes of the last 7 days
-- are queued again (fresh attempts) and the worker is kicked.
CREATE OR REPLACE FUNCTION public.google_calendar_retry_failed()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  n int := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can retry the calendar sync' USING ERRCODE = '42501';
  END IF;
  FOR r IN
    SELECT DISTINCT ON (o.event_id) o.event_id, o.op, o.google_event_id
      FROM public.google_sync_outbox o
     WHERE o.status = 'failed' AND o.updated_at > now() - interval '7 days'
       AND NOT EXISTS (SELECT 1 FROM public.google_sync_outbox p
                        WHERE p.event_id = o.event_id AND p.status IN ('pending', 'processing'))
     ORDER BY o.event_id, o.id DESC
  LOOP
    PERFORM public.google_sync_enqueue(r.event_id, r.op, r.google_event_id);
    n := n + 1;
  END LOOP;
  PERFORM public.google_calendar_kick(true);
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.google_calendar_retry_failed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.google_calendar_retry_failed() TO authenticated;

-- ---------- 9. Cron: retries, stale claims, housekeeping ----------
-- A run that died mid-push (timeout, deploy) leaves rows 'processing'; after
-- 10 minutes they are due again. Backed-off rows become due on their own;
-- this only wakes the worker when something is due. Done rows are kept a
-- week (debugging), failed ones a month.
CREATE OR REPLACE FUNCTION public.google_calendar_retry()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT o.id, o.event_id FROM public.google_sync_outbox o
     WHERE o.status = 'processing' AND o.locked_at < now() - interval '10 minutes'
     ORDER BY o.id
  LOOP
    IF EXISTS (SELECT 1 FROM public.google_sync_outbox p WHERE p.event_id = r.event_id AND p.status = 'pending') THEN
      UPDATE public.google_sync_outbox SET status = 'done', locked_at = NULL, last_error = 'superseded (stale claim)', updated_at = now()
       WHERE id = r.id;
    ELSE
      UPDATE public.google_sync_outbox SET status = 'pending', locked_at = NULL, next_attempt_at = now(), updated_at = now()
       WHERE id = r.id;
    END IF;
  END LOOP;

  DELETE FROM public.google_sync_outbox WHERE status = 'done' AND updated_at < now() - interval '7 days';
  DELETE FROM public.google_sync_outbox WHERE status = 'failed' AND updated_at < now() - interval '30 days';

  IF EXISTS (SELECT 1 FROM public.google_sync_outbox WHERE status = 'pending' AND next_attempt_at <= now()) THEN
    PERFORM public.google_calendar_kick(true);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.google_calendar_retry() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.google_calendar_retry() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'google-calendar-retry') THEN
    PERFORM cron.unschedule('google-calendar-retry');
  END IF;
  PERFORM cron.schedule(
    'google-calendar-retry',
    '*/2 * * * *',
    $cron$ SELECT public.google_calendar_retry() $cron$
  );
END $$;

-- ---------- 10. Personal calendar feeds (C1b) ----------
-- "See DeskDev in my own calendar" without any Google scope: a secret URL
-- the person subscribes to from Google/Apple/Outlook. Only the SHA-256 of the
-- token is stored, so a table dump yields no working feed. One active token
-- per person; rotating revokes the old URL at once.
-- user_id cascades: a feed is a credential, not history, and must die with
-- its owner (deactivation already empties it, see calendar_feed()).
CREATE TABLE IF NOT EXISTS public.calendar_feed_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  -- Last 4 characters, so Settings can say "…a1b2" without the secret.
  token_hint   text NOT NULL,
  -- 'mine': events the person created or is invited to. 'all': every event
  -- they can see in DeskDev (the whole team calendar).
  scope        text NOT NULL DEFAULT 'mine' CHECK (scope IN ('mine', 'all')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS calendar_feed_tokens_one_active
  ON public.calendar_feed_tokens (user_id) WHERE revoked_at IS NULL;

ALTER TABLE public.calendar_feed_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.calendar_feed_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.calendar_feed_tokens TO service_role;

CREATE OR REPLACE FUNCTION public.calendar_feed_hash(p_token text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

REVOKE ALL ON FUNCTION public.calendar_feed_hash(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_feed_hash(text) TO service_role;

-- Issue a new feed token for the caller (revoking the previous one) and
-- return it ONCE. 64 hex characters from two v4 uuids and the clock, hashed:
-- about 244 random bits, with no pgcrypto dependency.
CREATE OR REPLACE FUNCTION public.calendar_feed_rotate(p_scope text DEFAULT 'mine')
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_token text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to create a calendar feed' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_perm('calendar', 'view') OR public.has_perm('meetings', 'view')) THEN
    RAISE EXCEPTION 'Calendar access is required for a calendar feed' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_scope, 'mine') NOT IN ('mine', 'all') THEN
    RAISE EXCEPTION 'Unknown feed scope' USING ERRCODE = '22023';
  END IF;

  v_token := encode(sha256(convert_to(
               gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex');

  UPDATE public.calendar_feed_tokens SET revoked_at = now()
   WHERE user_id = v_uid AND revoked_at IS NULL;
  INSERT INTO public.calendar_feed_tokens (user_id, token_hash, token_hint, scope)
  VALUES (v_uid, public.calendar_feed_hash(v_token), right(v_token, 4), coalesce(p_scope, 'mine'));

  -- Revoked tokens are kept 30 days (the status screen's "last used"), then go.
  DELETE FROM public.calendar_feed_tokens
   WHERE user_id = v_uid AND revoked_at < now() - interval '30 days';
  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.calendar_feed_revoke()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.calendar_feed_tokens SET revoked_at = now()
   WHERE user_id = auth.uid() AND revoked_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.calendar_feed_status()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(
    (SELECT jsonb_build_object(
              'active', true,
              'scope', t.scope,
              'hint', t.token_hint,
              'createdAt', t.created_at,
              'lastUsedAt', t.last_used_at)
       FROM public.calendar_feed_tokens t
      WHERE t.user_id = auth.uid() AND t.revoked_at IS NULL),
    jsonb_build_object('active', false));
$$;

REVOKE ALL ON FUNCTION public.calendar_feed_rotate(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calendar_feed_revoke() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calendar_feed_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calendar_feed_rotate(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_feed_revoke() TO authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_feed_status() TO authenticated;

-- The feed itself. Calendar apps fetch a URL with no session, so this is the
-- one calendar entry point anon may call; the token is the only credential
-- and only its hash is looked up. The owner's access is re-checked on every
-- fetch (deactivated, or lost calendar access → no feed), mirroring
-- events_select: calendar OR meetings view sees every event. Meeting notes
-- and colours never leave DeskDev. NULL for anything that is not a live token.
CREATE OR REPLACE FUNCTION public.calendar_feed(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  t       public.calendar_feed_tokens%ROWTYPE;
  v_name  text;
  v_from  timestamptz := now() - interval '60 days';
  v_to    timestamptz := now() + interval '400 days';
  v_events jsonb;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO t FROM public.calendar_feed_tokens
   WHERE token_hash = public.calendar_feed_hash(p_token) AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF NOT (public.user_has_perm(t.user_id, 'calendar', 'view') OR public.user_has_perm(t.user_id, 'meetings', 'view')) THEN
    RETURN NULL;
  END IF;

  SELECT p.full_name INTO v_name FROM public.profiles p WHERE p.id = t.user_id;

  SELECT coalesce(jsonb_agg(x.ev ORDER BY x.starts_at), '[]'::jsonb) INTO v_events
    FROM (
      SELECT e.starts_at,
             jsonb_build_object(
               'id', e.id, 'kind', e.kind, 'title', e.title, 'description', e.description,
               'location', e.location, 'meeting_link', e.meeting_link,
               'starts_at', e.starts_at, 'ends_at', e.ends_at, 'all_day', e.all_day,
               'recurrence', e.recurrence, 'recurrence_until', e.recurrence_until,
               'timezone', e.timezone, 'created_at', e.created_at, 'updated_at', e.updated_at) AS ev
        FROM public.events e
       WHERE e.starts_at <= v_to
         AND (
           (e.recurrence = 'none' AND coalesce(e.ends_at, e.starts_at) >= v_from)
           OR (e.recurrence <> 'none' AND (e.recurrence_until IS NULL OR e.recurrence_until >= v_from::date))
         )
         AND (
           t.scope = 'all'
           OR e.created_by = t.user_id
           OR EXISTS (SELECT 1 FROM public.event_attendees a WHERE a.event_id = e.id AND a.profile_id = t.user_id)
         )
       ORDER BY e.starts_at
       LIMIT 2000
    ) x;

  -- At most one write an hour per feed: calendar apps poll often.
  IF t.last_used_at IS NULL OR t.last_used_at < now() - interval '1 hour' THEN
    UPDATE public.calendar_feed_tokens SET last_used_at = now() WHERE id = t.id;
  END IF;

  RETURN jsonb_build_object(
    'owner', coalesce(v_name, 'DeskDev'),
    'scope', t.scope,
    'default_time_zone', public.google_calendar_default_tz(),
    'events', v_events);
END;
$$;

REVOKE ALL ON FUNCTION public.calendar_feed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calendar_feed(text) TO anon, authenticated, service_role;

-- ---------- 11. Realtime ----------
-- Attendee lists update live like events (007). The worker's write-backs to
-- events (sync chip) already travel through the events publication.
DO $$
BEGIN
  ALTER TABLE public.event_attendees REPLICA IDENTITY FULL;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'event_attendees'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.event_attendees;
  END IF;
END $$;
