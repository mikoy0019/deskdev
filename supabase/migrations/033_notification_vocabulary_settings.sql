-- ============================================
-- DeskDev Studio — 033: Notification vocabulary + workspace settings
-- The one place that grows what DeskDev can notify about, and the one
-- settings row the Growth and Showcase features read. Apply after 032 (it
-- uses audit_actor() / write_audit_log()). Re-runnable: OR REPLACE /
-- IF NOT EXISTS / DROP … IF EXISTS throughout.
--
--   1. user_has_perm(): has_perm() for someone other than the caller
--   2. notifications: 030's guard learns lead_new, lead_sla, lead_followup,
--      lead_assigned and showcase_ready, and only lets them reach people who
--      may see what they are about
--   3. push: a 'leads' category next to 029's five
--   4. workspace_settings: one row of Growth + Showcase settings
--
-- Mirrors, change together:
--   types       ↔ site/src/deskdev/lib/notifications.ts (KnownNotificationType)
--               ↔ supabase/functions/send-push/logic.ts categoryOf
--   categories  ↔ notifications.ts NOTIFY_CATEGORIES / DEFAULT_NOTIFY_PREFS
--               ↔ send-push/logic.ts NOTIFY_CATEGORIES / DEFAULT_PUSH_CATEGORIES
--   entities    'lead' → /growth/leads?lead=<id>, 'showcase' → /showcase?item=<id>
--               (notificationHref ↔ notificationPath)
-- ============================================

-- ---------- 1. user_has_perm ----------
-- has_perm() answers for auth.uid(). Choosing who may RECEIVE a notification
-- (the guard below, lead intake, the SLA sweep) needs the same rule for any
-- profile. A deactivated profile has no permissions (032).
CREATE OR REPLACE FUNCTION public.user_has_perm(p_user uuid, feature text, level text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_user
      AND p.deactivated_at IS NULL
      AND (
        p.role = 'admin'
        OR (level = 'view' AND p.permissions->>feature IN ('view', 'edit'))
        OR (level = 'edit' AND p.permissions->>feature = 'edit')
      )
  );
$$;

REVOKE ALL ON FUNCTION public.user_has_perm(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_perm(uuid, text, text) TO service_role;

-- ---------- 2. notifications: the new types ----------
-- 'showcase_ready' is server-generated (037's showcase_on_project), so the
-- guard asks showcase_notification_ok() whether this sender may send one for
-- this item. 037 defines the real check once showcase_items exists; until
-- then this stub says no. Created only when missing, so re-running 033 never
-- replaces 037's version with the stub.
DO $$
BEGIN
  IF to_regprocedure('public.showcase_notification_ok(uuid)') IS NULL THEN
    EXECUTE $fn$
      CREATE FUNCTION public.showcase_notification_ok(p_item uuid)
      RETURNS boolean
      LANGUAGE sql
      STABLE
      SET search_path = public
      AS 'SELECT false'
    $fn$;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.showcase_notification_ok(uuid) FROM PUBLIC, anon, authenticated;

-- Same function as 030 with five more types. Lead notifications carry a
-- prospect's name and message, so they only reach people with growth:view,
-- and only someone with growth:view may send one; a showcase draft only
-- reaches admins and showcase viewers, and only for a real item sent by
-- showcase_on_project or a showcase viewer. Rows that fail those checks are
-- dropped silently, as 030 does for mentions, so a user's own write (a lead
-- reassigned, a project marked done) never fails because of a notification.
-- Cron jobs and the anon intake RPC have no auth.uid() and skip this guard;
-- they choose their recipients with user_has_perm().
CREATE OR REPLACE FUNCTION public.guard_notification_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.actor_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'a notification must name you as its actor' USING ERRCODE = '42501';
  END IF;

  IF NEW.type IS NULL OR NEW.type NOT IN (
    'task_assigned', 'task_updated', 'project_updated', 'client_updated',
    'crm_updated', 'event_updated', 'meeting_updated', 'due_reminder',
    'channel_mention',
    'lead_new', 'lead_sla', 'lead_followup', 'lead_assigned', 'showcase_ready'
  ) THEN
    RAISE EXCEPTION 'notification type % cannot be sent from the app', NEW.type USING ERRCODE = '42501';
  END IF;

  -- Reminders are computed by each device for its own user.
  IF NEW.type = 'due_reminder' AND NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'a due reminder can only be sent to yourself' USING ERRCODE = '42501';
  END IF;

  -- A mention carries a preview of the message. It only goes to someone who
  -- can read the channel: public or a member of a private one, and in a
  -- client's space only with clients:view. Admins see every channel. Rows that
  -- fail the check are dropped silently, so the sender's other rows still go.
  IF NEW.type = 'channel_mention' THEN
    IF NEW.entity IS DISTINCT FROM 'channel'
       OR NEW.entity_id IS NULL
       OR NOT public.can_view_channel(NEW.entity_id)
       OR NOT EXISTS (
         SELECT 1
           FROM public.channels c
           JOIN public.profiles p ON p.id = NEW.user_id
          WHERE c.id = NEW.entity_id
            AND (
              p.role = 'admin'
              OR (
                (NOT c.is_private OR NEW.user_id = ANY (c.member_ids))
                AND (c.client_id IS NULL OR p.permissions->>'clients' IN ('view', 'edit'))
              )
            )
       ) THEN
      RETURN NULL;
    END IF;
  END IF;

  IF NEW.type IN ('lead_new', 'lead_sla', 'lead_followup', 'lead_assigned') THEN
    IF NEW.entity IS DISTINCT FROM 'lead'
       OR NOT public.has_perm('growth', 'view')
       OR NOT public.user_has_perm(NEW.user_id, 'growth', 'view') THEN
      RETURN NULL;
    END IF;
  END IF;

  IF NEW.type = 'showcase_ready' THEN
    IF NEW.entity IS DISTINCT FROM 'showcase'
       OR NOT public.showcase_notification_ok(NEW.entity_id)
       OR NOT public.user_has_perm(NEW.user_id, 'showcase', 'view') THEN
      RETURN NULL;
    END IF;
  END IF;

  -- The server decides when it was sent and that it is unread.
  NEW.created_at := now();
  NEW.read := false;
  NEW.title := left(NEW.title, 300);
  NEW.body := left(NEW.body, 1000);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_notification_insert() FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.notifications.type IS
  'task_assigned|task_updated|project_updated|client_updated|crm_updated|event_updated|meeting_updated|due_reminder|channel_mention|lead_new|lead_sla|lead_followup|lead_assigned|showcase_ready|system';
COMMENT ON COLUMN public.notifications.entity IS
  'task|project|client|crm_table|crm_row|crm_column|event|channel|conversation|lead|showcase';

-- ---------- 3. Push: the 'leads' category ----------
-- New leads, missed SLAs, follow-ups and assignments get their own switch,
-- on by default: speed to lead is the point. Only growth viewers ever
-- receive lead notifications (section 2 and the intake RPC), so the default
-- is effectively "on for the Growth team". Rows stored before this keep
-- their switches; a missing 'leads' key reads as on (send-push
-- normalizeCategories), and the app re-sends its switches on next load.
ALTER TABLE public.push_subscriptions
  ALTER COLUMN categories
  SET DEFAULT '{"mentions":true,"messages":true,"tasks":true,"reminders":true,"workspace":false,"leads":true}'::jsonb;

-- Devices that turned push on before this migration: write the switch down
-- for the Growth team, so the stored row says what the device will do (it
-- would already read a missing key as on). A switch already present is
-- never overwritten.
UPDATE public.push_subscriptions
   SET categories = categories || '{"leads":true}'::jsonb
 WHERE jsonb_typeof(categories) = 'object'
   AND NOT categories ? 'leads'
   AND public.user_has_perm(user_id, 'growth', 'view');

-- Same function as 029; only the defaults and the allowed keys change.
CREATE OR REPLACE FUNCTION public.upsert_push_subscription(
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
  p_app_base   text,
  p_categories jsonb DEFAULT NULL,
  p_platform   text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_endpoint text := trim(coalesce(p_endpoint, ''));
  v_p256dh   text := translate(rtrim(trim(coalesce(p_p256dh, '')), '='), '+/', '-_');
  v_auth     text := translate(rtrim(trim(coalesce(p_auth, '')), '='), '+/', '-_');
  v_base     text := rtrim(trim(coalesce(p_app_base, '')), '/');
  v_defaults jsonb := '{"mentions":true,"messages":true,"tasks":true,"reminders":true,"workspace":false,"leads":true}'::jsonb;
  v_given    jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to turn on push notifications' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_push_service_endpoint(v_endpoint) THEN
    RAISE EXCEPTION 'This browser''s push service is not supported' USING ERRCODE = '22023';
  END IF;

  -- 65-byte P-256 point → 87 chars; 16-byte auth secret → 22 chars.
  IF v_p256dh !~ '^[A-Za-z0-9_-]{87}$' OR v_auth !~ '^[A-Za-z0-9_-]{22}$' THEN
    RAISE EXCEPTION 'Invalid push subscription keys' USING ERRCODE = '22023';
  END IF;

  -- https everywhere; plain http only for a local dev host.
  IF length(v_base) > 512
     OR NOT (
       v_base ~* '^https://[a-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~%-]+)*$'
       OR v_base ~* '^http://(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.localhost)(:[0-9]{1,5})?(/[A-Za-z0-9._~%-]+)*$'
     ) THEN
    RAISE EXCEPTION 'Invalid app base URL' USING ERRCODE = '22023';
  END IF;

  -- Keep only known category keys with boolean values; the rest default.
  IF p_categories IS NOT NULL THEN
    SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
      INTO v_given
      FROM jsonb_each(CASE WHEN jsonb_typeof(p_categories) = 'object' THEN p_categories ELSE '{}'::jsonb END) AS e
     WHERE e.key IN ('mentions', 'messages', 'tasks', 'reminders', 'workspace', 'leads')
       AND jsonb_typeof(e.value) = 'boolean';
  END IF;

  INSERT INTO public.push_subscriptions AS s
    (user_id, endpoint, p256dh, auth, app_base, categories, platform, user_agent)
  VALUES
    (v_uid, v_endpoint, v_p256dh, v_auth, v_base, v_defaults || coalesce(v_given, '{}'::jsonb),
     left(nullif(trim(p_platform), ''), 32), left(nullif(trim(p_user_agent), ''), 512))
  ON CONFLICT (endpoint) DO UPDATE
    SET user_id       = EXCLUDED.user_id,
        p256dh        = EXCLUDED.p256dh,
        auth          = EXCLUDED.auth,
        app_base      = EXCLUDED.app_base,
        categories    = CASE
                          WHEN v_given IS NULL AND s.user_id = EXCLUDED.user_id THEN s.categories
                          ELSE EXCLUDED.categories
                        END,
        platform      = EXCLUDED.platform,
        user_agent    = EXCLUDED.user_agent,
        failure_count = 0,
        updated_at    = now();

  -- A person rarely has more than a handful of installs; cap the rows so a
  -- re-subscribe loop cannot grow the table without bound.
  DELETE FROM public.push_subscriptions
   WHERE user_id = v_uid
     AND id NOT IN (
       SELECT id FROM public.push_subscriptions
        WHERE user_id = v_uid
        ORDER BY updated_at DESC
        LIMIT 20
     );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_push_subscription(text, text, text, text, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_push_subscription(text, text, text, text, jsonb, text, text) TO authenticated;

-- ---------- 4. workspace_settings ----------
-- One row (id is always true) instead of per-device local settings: the SLA
-- clock, the owner pool and the auto-publish switch must be the same for
-- everyone and readable by cron jobs. Every signed-in user reads it (the
-- Growth screens show the SLA and target); only admins change it.
CREATE TABLE IF NOT EXISTS public.workspace_settings (
  id                            boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- Minutes of business time a new lead may wait for a first response.
  growth_sla_minutes            int NOT NULL DEFAULT 60
                                  CHECK (growth_sla_minutes BETWEEN 5 AND 10080),
  -- Business minutes after which an unanswered lead goes to the admins.
  growth_escalate_minutes       int NOT NULL DEFAULT 240
                                  CHECK (growth_escalate_minutes BETWEEN 5 AND 43200),
  -- Internal only (SLA arithmetic). Never shown on the site or in replies.
  -- tz: IANA name; days: ISO weekdays 1 = Monday … 7 = Sunday; start/end: HH:MM.
  growth_business_hours         jsonb NOT NULL
                                  DEFAULT '{"tz":"Asia/Manila","days":[1,2,3,4,5],"start":"09:00","end":"18:00"}'::jsonb,
  -- Round-robin order for new leads; empty → an admin owns them.
  growth_owner_pool             uuid[] NOT NULL DEFAULT '{}'
                                  CHECK (cardinality(growth_owner_pool) <= 50),
  -- Notify every Growth editor about a new lead, not just its owner.
  growth_notify_all             boolean NOT NULL DEFAULT true,
  growth_booking_url            text
                                  CHECK (growth_booking_url IS NULL
                                         OR (growth_booking_url ~* '^https://[^\s/]+\.[^\s]+$' AND length(growth_booking_url) <= 2048)),
  growth_auto_reply             boolean NOT NULL DEFAULT false,
  growth_stale_days             int NOT NULL DEFAULT 14
                                  CHECK (growth_stale_days BETWEEN 1 AND 365),
  growth_monthly_client_target  int
                                  CHECK (growth_monthly_client_target IS NULL OR growth_monthly_client_target BETWEEN 0 AND 10000),
  -- Q5: a finished project with consent and a passing link check publishes
  -- itself only when this is on. Ships off.
  showcase_auto_publish         boolean NOT NULL DEFAULT false,
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  updated_by                    uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  CONSTRAINT workspace_settings_escalate_after_sla CHECK (growth_escalate_minutes >= growth_sla_minutes)
);

INSERT INTO public.workspace_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- Business hours arrive as free JSON from the settings screen, and the SLA
-- maths (add_business_minutes) must never meet a bad zone or an empty week.
CREATE OR REPLACE FUNCTION public.is_valid_business_hours(p_hours jsonb)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT p_hours IS NOT NULL
     AND jsonb_typeof(p_hours) = 'object'
     AND jsonb_typeof(p_hours -> 'tz') = 'string'
     AND EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_hours ->> 'tz')
     AND jsonb_typeof(p_hours -> 'days') = 'array'
     AND jsonb_array_length(p_hours -> 'days') BETWEEN 1 AND 7
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_hours -> 'days') d
        WHERE jsonb_typeof(d) <> 'number' OR d::text !~ '^[1-7]$'
     )
     AND (SELECT count(DISTINCT d::text) FROM jsonb_array_elements(p_hours -> 'days') d)
         = jsonb_array_length(p_hours -> 'days')
     AND coalesce(p_hours ->> 'start', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     AND coalesce(p_hours ->> 'end', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     AND (p_hours ->> 'start') < (p_hours ->> 'end');
$$;

REVOKE ALL ON FUNCTION public.is_valid_business_hours(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_valid_business_hours(jsonb) TO authenticated, service_role;

-- Validates, tidies and stamps every write. The owner pool keeps its order
-- (it is the round-robin order) but loses duplicates, unknown ids and
-- deactivated people, so a teammate leaving never blocks the next save.
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

  NEW.updated_at := now();
  NEW.updated_by := public.audit_actor();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workspace_settings_guard ON public.workspace_settings;
CREATE TRIGGER workspace_settings_guard
  BEFORE INSERT OR UPDATE ON public.workspace_settings
  FOR EACH ROW EXECUTE FUNCTION public.guard_workspace_settings();

-- Settings decide who gets leads and what goes public, so changes are audited
-- with their before and after values.
CREATE OR REPLACE FUNCTION public.audit_workspace_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old     jsonb := to_jsonb(OLD) - 'updated_at' - 'updated_by';
  v_new     jsonb := to_jsonb(NEW) - 'updated_at' - 'updated_by';
  v_changes jsonb;
BEGIN
  SELECT coalesce(jsonb_object_agg(n.key, jsonb_build_object('from', v_old -> n.key, 'to', n.value)), '{}'::jsonb)
    INTO v_changes
    FROM jsonb_each(v_new) n
   WHERE n.value IS DISTINCT FROM v_old -> n.key;

  IF v_changes <> '{}'::jsonb THEN
    PERFORM public.write_audit_log('settings.updated', 'workspace_settings', 'singleton', v_changes, NEW.updated_by);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS workspace_settings_audit ON public.workspace_settings;
CREATE TRIGGER workspace_settings_audit
  AFTER UPDATE ON public.workspace_settings
  FOR EACH ROW EXECUTE FUNCTION public.audit_workspace_settings();

REVOKE ALL ON FUNCTION public.guard_workspace_settings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_workspace_settings() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.workspace_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace_settings_select" ON public.workspace_settings;
CREATE POLICY "workspace_settings_select"
  ON public.workspace_settings FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "workspace_settings_admin_update" ON public.workspace_settings;
CREATE POLICY "workspace_settings_admin_update"
  ON public.workspace_settings FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- The row is seeded above and is never inserted or deleted by a client.
-- anon reads nothing: the site gets what it needs (the booking link) from
-- the intake RPC's answer, not from this table.
REVOKE ALL ON public.workspace_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON public.workspace_settings TO authenticated;
GRANT ALL ON public.workspace_settings TO service_role;

-- Live updates, so an admin's change reaches open Growth screens.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'workspace_settings'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_settings;
  END IF;
END;
$$;
