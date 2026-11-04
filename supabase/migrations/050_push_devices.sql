-- ============================================
-- DeskDev Studio — 050: push to the phone app (Android / iOS)
-- The Expo app's counterpart of 029's Web Push subscriptions. Runbook:
-- supabase/PUSH.md ("Phone app").
--
--   push_devices            one row per phone that allowed notifications,
--                           keyed by its Expo push token
--   upsert_push_device()    the app's only way to write a row (bound to auth.uid())
--   delete_push_device()    remove this phone's row on sign-out / switch-off
--
-- Nothing new fires: 029's triggers already call send-push for every unread
-- notification and chat message, and send-push now reads this table next to
-- push_subscriptions. Applying this before the phone app is set up is
-- harmless — with no rows there is nobody to send to.
--
-- Re-runnable: IF NOT EXISTS / OR REPLACE / DROP … IF EXISTS throughout.
-- Needs 029, 033 and 043.
-- ============================================

DO $$
BEGIN
  IF to_regprocedure('public.is_active()') IS NULL THEN
    RAISE EXCEPTION '050 needs 043_active_accounts_only.sql (is_active) applied first';
  END IF;
END $$;

-- ---------- 1. Table ----------
CREATE TABLE IF NOT EXISTS public.push_devices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  -- ExponentPushToken[…]. Unique: one app install = one token, and a second
  -- account signing in on that phone takes the row over.
  token           text NOT NULL UNIQUE,
  platform        text NOT NULL CHECK (platform IN ('ios', 'android')),
  -- Which kinds of push this phone wants (the app's notification settings).
  -- Same keys and defaults as push_subscriptions after 033.
  categories      jsonb NOT NULL DEFAULT '{"mentions":true,"messages":true,"tasks":true,"reminders":true,"workspace":false,"leads":true}'::jsonb,
  device_name     text,
  app_version     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  failure_count   integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS push_devices_user_idx ON public.push_devices (user_id);

DROP TRIGGER IF EXISTS push_devices_set_updated_at ON public.push_devices;
CREATE TRIGGER push_devices_set_updated_at
  BEFORE UPDATE ON public.push_devices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- 2. Row Level Security ----------
-- Users see and delete their own rows. Writes go through the RPC below only,
-- so the app cannot attach a token to someone else or skip validation.
ALTER TABLE public.push_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_devices_select_own" ON public.push_devices;
CREATE POLICY "push_devices_select_own"
  ON public.push_devices FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "push_devices_delete_own" ON public.push_devices;
CREATE POLICY "push_devices_delete_own"
  ON public.push_devices FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- 043's rule for every table: an account without an active profile reads
-- and writes no row, its own included. This table is made after 043's sweep,
-- so it carries the policy itself.
DROP POLICY IF EXISTS "active_account_only" ON public.push_devices;
CREATE POLICY "active_account_only"
  ON public.push_devices AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_active())) WITH CHECK ((SELECT public.is_active()));

-- Everything off first (TRUNCATE and MAINTAIN included, which RLS does not
-- guard), then back what the app needs.
REVOKE ALL ON public.push_devices FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.push_devices TO authenticated;
GRANT ALL ON public.push_devices TO service_role;

-- ---------- 3. Validation ----------
-- An Expo push token. send-push only ever POSTs these to Expo's own push
-- service, so unlike 029's endpoints there is no URL to aim anywhere — the
-- check keeps junk out of the table. Mirrored in supabase/functions/
-- send-push/logic.ts (isExpoPushToken) — change both.
CREATE OR REPLACE FUNCTION public.is_expo_push_token(p_token text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT p_token IS NOT NULL
     AND p_token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,256}\]$';
$$;

REVOKE ALL ON FUNCTION public.is_expo_push_token(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_expo_push_token(text) TO authenticated, service_role;

-- ---------- 4. App RPCs ----------
-- Binds the token to the caller, replacing any row with that token (a phone
-- that changed hands, or the same install registering again). p_categories
-- NULL keeps the stored switches when the same user re-registers.
CREATE OR REPLACE FUNCTION public.upsert_push_device(
  p_token       text,
  p_platform    text,
  p_categories  jsonb DEFAULT NULL,
  p_device_name text DEFAULT NULL,
  p_app_version text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_token    text := trim(coalesce(p_token, ''));
  v_platform text := lower(trim(coalesce(p_platform, '')));
  v_defaults jsonb := '{"mentions":true,"messages":true,"tasks":true,"reminders":true,"workspace":false,"leads":true}'::jsonb;
  v_given    jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to turn on push notifications' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_expo_push_token(v_token) THEN
    RAISE EXCEPTION 'Invalid push token' USING ERRCODE = '22023';
  END IF;

  IF v_platform NOT IN ('ios', 'android') THEN
    RAISE EXCEPTION 'Push to the phone app is for iOS and Android' USING ERRCODE = '22023';
  END IF;

  -- Keep only known category keys with boolean values; the rest default.
  IF p_categories IS NOT NULL THEN
    SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
      INTO v_given
      FROM jsonb_each(CASE WHEN jsonb_typeof(p_categories) = 'object' THEN p_categories ELSE '{}'::jsonb END) AS e
     WHERE e.key IN ('mentions', 'messages', 'tasks', 'reminders', 'workspace', 'leads')
       AND jsonb_typeof(e.value) = 'boolean';
  END IF;

  INSERT INTO public.push_devices AS d
    (user_id, token, platform, categories, device_name, app_version)
  VALUES
    (v_uid, v_token, v_platform, v_defaults || coalesce(v_given, '{}'::jsonb),
     left(nullif(trim(p_device_name), ''), 120), left(nullif(trim(p_app_version), ''), 32))
  ON CONFLICT (token) DO UPDATE
    SET user_id       = EXCLUDED.user_id,
        platform      = EXCLUDED.platform,
        categories    = CASE
                          WHEN v_given IS NULL AND d.user_id = EXCLUDED.user_id THEN d.categories
                          ELSE EXCLUDED.categories
                        END,
        device_name   = EXCLUDED.device_name,
        app_version   = EXCLUDED.app_version,
        failure_count = 0,
        updated_at    = now();

  -- Same cap as 029: a re-register loop cannot grow the table without bound.
  DELETE FROM public.push_devices
   WHERE user_id = v_uid
     AND id NOT IN (
       SELECT id FROM public.push_devices
        WHERE user_id = v_uid
        ORDER BY updated_at DESC
        LIMIT 20
     );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_push_device(p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  DELETE FROM public.push_devices
   WHERE user_id = auth.uid()
     AND token = trim(coalesce(p_token, ''));
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_push_device(text, text, jsonb, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_push_device(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_push_device(text, text, jsonb, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_push_device(text) TO authenticated;
