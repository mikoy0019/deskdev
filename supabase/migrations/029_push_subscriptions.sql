-- ============================================
-- DeskDev Studio — 029: Web Push subscriptions + delivery triggers
-- Background notifications for the installed DeskDev app. Runbook:
-- supabase/PUSH.md.
--
--   push_subscriptions          one row per installed app / browser that allowed push
--   upsert_push_subscription()  the client's only way to write a row (bound to auth.uid())
--   delete_push_subscription()  remove this device's row on sign-out / switch-off
--   push_badge_count()          unread notifications + unread chat → app icon badge
--   push_dispatch()             pg_net POST to the send-push Edge Function
--   triggers                    AFTER INSERT on notifications and messages
--
-- Applying this before push is set up is harmless: until the two Vault
-- secrets below exist the triggers do nothing, and they can never fail an
-- insert. Enable delivery later (SQL editor, as postgres):
--
--   SELECT vault.create_secret('https://<ref>.supabase.co/functions/v1/send-push', 'deskdev_push_function_url');
--   SELECT vault.create_secret('<PUSH_WEBHOOK_SECRET>', 'deskdev_push_secret');
--
-- Re-runnable: IF NOT EXISTS / OR REPLACE / DROP … IF EXISTS throughout.
-- ============================================

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ---------- 1. Table ----------
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  -- The push service URL. Unique: one device install = one endpoint, and a
  -- second account signing in on that device takes the row over.
  endpoint        text NOT NULL UNIQUE,
  p256dh          text NOT NULL,
  auth            text NOT NULL,
  -- Origin + base path of the install, no trailing slash, e.g.
  -- https://workspace.nixgensolutions.com — push links are built from it.
  app_base        text NOT NULL,
  -- Which kinds of push this device wants (mirrors Settings → Notifications).
  categories      jsonb NOT NULL DEFAULT '{"mentions":true,"messages":true,"tasks":true,"reminders":true,"workspace":false}'::jsonb,
  platform        text,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  failure_count   integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON public.push_subscriptions (user_id);

DROP TRIGGER IF EXISTS push_subscriptions_set_updated_at ON public.push_subscriptions;
CREATE TRIGGER push_subscriptions_set_updated_at
  BEFORE UPDATE ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- 2. Row Level Security ----------
-- Users see and delete their own rows. Writes go through the RPC below only,
-- so a client cannot attach an endpoint to someone else or skip validation.
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_subscriptions_select_own" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_select_own"
  ON public.push_subscriptions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "push_subscriptions_delete_own" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_delete_own"
  ON public.push_subscriptions FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Belt and braces on top of RLS (no INSERT/UPDATE policy exists anyway).
REVOKE ALL ON public.push_subscriptions FROM anon;
REVOKE INSERT, UPDATE, TRUNCATE, REFERENCES, TRIGGER ON public.push_subscriptions FROM authenticated;
GRANT SELECT, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;

-- ---------- 3. Validation helpers ----------
-- Push services DeskDev will POST to. The endpoint comes from the browser, so
-- without a list the Edge Function could be aimed at any URL. Mirrored in
-- supabase/functions/send-push/logic.ts (isPushServiceEndpoint) — change both.
--   Chromium browsers: fcm.googleapis.com (also *.google.com/fcm/…, e.g.
--   jmt17.google.com)   Safari/iOS: web.push.apple.com
--   Firefox: updates.push.services.mozilla.com   Edge on Windows: *.notify.windows.com
CREATE OR REPLACE FUNCTION public.is_push_service_endpoint(p_endpoint text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT p_endpoint IS NOT NULL
     AND length(p_endpoint) <= 2048
     AND p_endpoint !~ '\s'
     AND (p_endpoint ~* '^https://([a-z0-9-]+\.)*(fcm\.googleapis\.com|android\.googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com)(:443)?/'
          OR p_endpoint ~* '^https://([a-z0-9-]+\.)+google\.com(:443)?/fcm/');
$$;

-- ---------- 4. Client RPCs ----------
-- Binds the endpoint to the caller, replacing any row with that endpoint (a
-- device that changed hands, or the same install re-subscribing). Keys are
-- normalised to unpadded base64url. p_categories NULL keeps the stored
-- switches when the same user re-upserts.
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
  v_defaults jsonb := '{"mentions":true,"messages":true,"tasks":true,"reminders":true,"workspace":false}'::jsonb;
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
     WHERE e.key IN ('mentions', 'messages', 'tasks', 'reminders', 'workspace')
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

CREATE OR REPLACE FUNCTION public.delete_push_subscription(p_endpoint text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  DELETE FROM public.push_subscriptions
   WHERE user_id = auth.uid()
     AND endpoint = trim(coalesce(p_endpoint, ''));
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_push_subscription(text, text, text, text, jsonb, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_push_subscription(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_push_subscription(text, text, text, text, jsonb, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_push_subscription(text) TO authenticated;

-- ---------- 5. Badge count (service role only) ----------
-- The number on the app icon, computed the way the app computes it
-- (pwa/useAppBadge.ts): unread notifications plus unread chat lines — other
-- people's messages newer than the latest read marker, inside the retention
-- window (020).
CREATE OR REPLACE FUNCTION public.push_badge_count(p_user uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT (
    (SELECT count(*)
       FROM public.notifications n
      WHERE n.user_id = p_user AND n.read IS NOT TRUE)
    +
    (SELECT count(*)
       FROM public.messages m
       JOIN public.conversations c ON c.id = m.conversation_id
      WHERE p_user = ANY (c.participant_ids)
        AND c.last_message_at > now() - public.chat_retention()
        AND m.created_at > now() - public.chat_retention()
        AND m.sender_id IS DISTINCT FROM p_user
        AND m.created_at > coalesce(
              (SELECT max(r.last_read_at)
                 FROM public.conversation_reads r
                WHERE r.conversation_id = m.conversation_id AND r.user_id = p_user),
              '-infinity'::timestamptz))
  )::integer;
$$;

REVOKE ALL ON FUNCTION public.push_badge_count(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_badge_count(uuid) TO service_role;

-- ---------- 6. Dispatch to the Edge Function ----------
-- Reads the function URL and shared secret from Vault. Missing either → does
-- nothing. Any error → a WARNING, never an exception: it runs inside AFTER
-- INSERT triggers, and a chat line or notification must never fail because
-- push is down. pg_net queues the request and sends it after commit, so a
-- rolled-back insert sends nothing. The body is only a pointer (the function
-- re-reads the row), which keeps message text out of net._http_response.
CREATE OR REPLACE FUNCTION public.push_dispatch(p_type text, p_record jsonb)
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
    SELECT nullif(trim(decrypted_secret), '') INTO v_url
      FROM vault.decrypted_secrets WHERE name = 'deskdev_push_function_url' LIMIT 1;
    SELECT nullif(trim(decrypted_secret), '') INTO v_secret
      FROM vault.decrypted_secrets WHERE name = 'deskdev_push_secret' LIMIT 1;

    IF v_url IS NULL OR v_secret IS NULL THEN
      RETURN;
    END IF;

    PERFORM net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_secret,
        'Content-Type',  'application/json'
      ),
      body    := jsonb_build_object('type', p_type, 'record', p_record),
      timeout_milliseconds := 10000
    );
  EXCEPTION WHEN others THEN
    RAISE WARNING 'push_dispatch(%): %', p_type, SQLERRM;
  END;
END;
$$;

-- Not callable by clients: with it, anyone could aim pushes at anyone.
REVOKE ALL ON FUNCTION public.push_dispatch(text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.push_on_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.push_dispatch('notification', jsonb_build_object('id', NEW.id, 'user_id', NEW.user_id, 'type', NEW.type));
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.push_on_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.push_dispatch('message', jsonb_build_object('id', NEW.id, 'conversation_id', NEW.conversation_id));
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.push_on_notification() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.push_on_message() FROM PUBLIC, anon, authenticated;

-- Rows filed already read (nothing to alert about) never leave the database.
DROP TRIGGER IF EXISTS push_on_notification ON public.notifications;
CREATE TRIGGER push_on_notification
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  WHEN (NEW.read IS NOT TRUE)
  EXECUTE FUNCTION public.push_on_notification();

DROP TRIGGER IF EXISTS push_on_message ON public.messages;
CREATE TRIGGER push_on_message
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.push_on_message();
