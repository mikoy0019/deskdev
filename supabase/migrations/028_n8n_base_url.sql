-- 028 — n8n's address lives in Vault, and the free instance is kept awake
--
-- 026 made n8n_post() the only place in the database that knows the n8n
-- host, but hardcoded it. The instance has since moved (Render service
-- nixgen-n8n, now https://nixgen-n8n-8gp7.onrender.com), so the host is read
-- from Vault next to the webhook secret. Moving n8n again is one statement,
-- not a migration (SQL editor, as postgres):
--
--   SELECT vault.update_secret(id, 'https://<new host>') FROM vault.secrets WHERE name = 'n8n_base_url';
--
-- First time on a project: SELECT vault.create_secret('https://<host>', 'n8n_base_url');
-- Until that row exists the constant below is used, so a fresh project that
-- skips the step still reaches the current instance.
--
-- Keep-alive: Render's free plan stops an instance after 15 minutes without
-- inbound traffic, and a stopped n8n runs no schedules (the 07:00 / 08:00
-- digests would silently never fire). pg_cron pings /healthz every 10
-- minutes. Harmless on a paid plan; unschedule 'n8n-keepalive' to stop it.
--
-- Re-runnable.

-- ---------- 1. The base URL ----------
-- Like n8n_webhook_secret(): Vault first, then the fallback, and it must never
-- raise, because it runs inside AFTER INSERT triggers.
CREATE OR REPLACE FUNCTION public.n8n_base_url()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s text;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO s
    FROM vault.decrypted_secrets
    WHERE name = 'n8n_base_url'
    LIMIT 1;
  EXCEPTION WHEN others THEN
    s := NULL;
  END;
  RETURN rtrim(coalesce(nullif(trim(s), ''), 'https://nixgen-n8n-8gp7.onrender.com'), '/');
END;
$$;

REVOKE ALL ON FUNCTION public.n8n_base_url() FROM PUBLIC, anon, authenticated;

-- ---------- 2. The one door, now host-agnostic ----------
-- Same signature and behaviour as 026; only the host moved.
CREATE OR REPLACE FUNCTION public.n8n_post(hook text, payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
AS $$
BEGIN
  IF hook IS NULL OR hook !~ '^[a-z0-9-]{1,64}$' THEN
    RAISE EXCEPTION 'n8n_post: invalid hook name %', hook;
  END IF;
  PERFORM net.http_post(
    url     := public.n8n_base_url() || '/webhook/' || hook,
    headers := jsonb_build_object(
      'Content-Type',     'application/json',
      'x-webhook-secret', public.n8n_webhook_secret()
    ),
    body    := payload,
    timeout_milliseconds := 5000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.n8n_post(text, jsonb) FROM PUBLIC, anon, authenticated;

-- ---------- 3. Keep-alive ----------
CREATE OR REPLACE FUNCTION public.n8n_keepalive()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
AS $$
BEGIN
  PERFORM net.http_get(url := public.n8n_base_url() || '/healthz', timeout_milliseconds := 10000);
END;
$$;

REVOKE ALL ON FUNCTION public.n8n_keepalive() FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'n8n-keepalive') THEN
    PERFORM cron.unschedule('n8n-keepalive');
  END IF;
  PERFORM cron.schedule(
    'n8n-keepalive',
    '*/10 * * * *',
    $cron$ SELECT public.n8n_keepalive() $cron$
  );
END $$;
