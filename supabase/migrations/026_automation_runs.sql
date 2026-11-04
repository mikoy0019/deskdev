-- 026 — Automation run log + one signed door to n8n
--
-- DeskDev's automation design. Three rules it encodes:
--
--   1. n8n is judged by the rows it writes HERE, never by /healthz. A 200 from
--      /healthz means the process is up; it says nothing about whether the
--      overdue-tasks digest went out this morning. Every scheduled workflow
--      ends with a "Log run" node that inserts an `ok` row, and the
--      [deskdev] error-handler workflow inserts an `error` row for any failed
--      execution. `automation_health` turns that into ok / stale / failing.
--
--   2. Every database → n8n webhook goes through ONE function, n8n_post(),
--      which attaches the shared secret. 008/009 each built their own request
--      and the n8n side never checked the header. The workflows now require it
--      (Webhook node → Header Auth), so the secret has to be right everywhere.
--
--   3. The secret lives in Supabase Vault, not in a database GUC and never in
--      this repo. Set it once (SQL editor, as postgres):
--
--        SELECT vault.create_secret('<long random value>', 'n8n_webhook_secret');
--
--      The old `app.n8n_webhook_secret` GUC is still read as a fallback, so a
--      project that already set it keeps working until the Vault row exists.
--      The SAME value goes into the n8n credential "DeskDev Webhook Secret",
--      the vault-reset edge function (N8N_WEBHOOK_SECRET) and the site Worker
--      (N8N_WEBHOOK_SECRET). Runbook: automation/README.md → The shared webhook secret.
--
-- Re-runnable: IF NOT EXISTS / OR REPLACE / ON CONFLICT throughout.

-- ---------- 1. Registry of scheduled jobs ----------
-- What "on time" means for each scheduled workflow. A job with no ok row for
-- longer than cadence + grace is `stale`: the schedule did not fire, or fired
-- and died before it could log. Event-driven workflows (webhooks) are not
-- registered; they appear in the health view only once they have run rows.
CREATE TABLE IF NOT EXISTS public.automation_jobs (
  job           text PRIMARY KEY CHECK (job ~ '^[a-z0-9-]{1,64}$'),
  workflow      text NOT NULL,
  cadence_hours integer NOT NULL CHECK (cadence_hours > 0),
  grace_hours   integer NOT NULL DEFAULT 2 CHECK (grace_hours >= 0),
  enabled       boolean NOT NULL DEFAULT true,
  description   text NOT NULL DEFAULT ''
);

-- `enabled` mirrors whether the workflow is switched on in n8n. A disabled job
-- shows as `paused` instead of `stale`. daily-activity-digest was left
-- inactive in n8n; flip it here when it is activated there.
INSERT INTO public.automation_jobs (job, workflow, cadence_hours, grace_hours, enabled, description) VALUES
  ('overdue-tasks',         '[deskdev] overdue-tasks',         24,  2, true,  'Daily 08:00 Manila: overdue tasks email'),
  ('weekly-time-summary',   '[deskdev] weekly-time-summary',   168, 6, true,  'Monday 08:00 Manila: last 7 days of time entries'),
  ('daily-activity-digest', '[deskdev] daily-activity-digest', 24,  2, false, 'Daily 18:30 Manila: tasks completed + hours logged'),
  ('job-postings-finder',   '[deskdev] job-postings-finder',   24,  2, true,  'Daily 07:00 Manila: Adzuna + onlinejobs.ph into job_postings'),
  ('lead-nudge',            '[deskdev] lead-nudge',            24,  2, true,  'Daily 08:00 Manila: leads that need a reply or a follow-up')
ON CONFLICT (job) DO UPDATE
  SET workflow      = EXCLUDED.workflow,
      cadence_hours = EXCLUDED.cadence_hours,
      grace_hours   = EXCLUDED.grace_hours,
      description   = EXCLUDED.description;
-- (enabled is deliberately NOT overwritten on re-run: it is operator state.)

-- ---------- 2. The run log ----------
-- Written only by n8n with the service role (the "Supabase — DeskDev"
-- credential). No insert policy exists, so a signed-in user cannot forge a
-- green light.
CREATE TABLE IF NOT EXISTS public.automation_runs (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job          text NOT NULL CHECK (job ~ '^[a-z0-9-]{1,64}$'),
  workflow     text,
  status       text NOT NULL CHECK (status IN ('ok', 'error', 'skipped')),
  execution_id text,
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS automation_runs_job_created_idx
  ON public.automation_runs (job, created_at DESC);

ALTER TABLE public.automation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "automation_jobs_select_admin" ON public.automation_jobs;
CREATE POLICY "automation_jobs_select_admin"
  ON public.automation_jobs FOR SELECT
  TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "automation_runs_select_admin" ON public.automation_runs;
CREATE POLICY "automation_runs_select_admin"
  ON public.automation_runs FOR SELECT
  TO authenticated USING (public.is_admin());

-- ---------- 3. Health, per job ----------
-- security_invoker: the view runs with the caller's rights, so the admin-only
-- policies above apply to it too.
CREATE OR REPLACE VIEW public.automation_health
WITH (security_invoker = true) AS
WITH stats AS (
  SELECT job,
         max(created_at) FILTER (WHERE status = 'ok')    AS last_ok_at,
         max(created_at) FILTER (WHERE status = 'error') AS last_error_at,
         count(*) FILTER (WHERE created_at > now() - interval '7 days')                    AS runs_7d,
         count(*) FILTER (WHERE status = 'error' AND created_at > now() - interval '7 days') AS errors_7d
  FROM public.automation_runs
  GROUP BY job
),
last_error AS (
  SELECT DISTINCT ON (job) job, detail->>'message' AS message, detail->>'node' AS node
  FROM public.automation_runs
  WHERE status = 'error'
  ORDER BY job, created_at DESC
),
jobs AS (
  SELECT job, workflow, cadence_hours, grace_hours, enabled, description
  FROM public.automation_jobs
  UNION ALL
  -- Webhook workflows: visible once they have logged anything (in practice,
  -- once the error handler has recorded a failure for them).
  SELECT s.job, NULL, NULL, NULL, true, ''
  FROM stats s
  WHERE NOT EXISTS (SELECT 1 FROM public.automation_jobs j WHERE j.job = s.job)
)
SELECT j.job,
       j.workflow,
       j.description,
       CASE WHEN j.cadence_hours IS NULL THEN 'event' ELSE 'schedule' END AS kind,
       j.cadence_hours,
       j.enabled,
       s.last_ok_at,
       s.last_error_at,
       e.message AS last_error,
       e.node    AS last_error_node,
       coalesce(s.runs_7d, 0)   AS runs_7d,
       coalesce(s.errors_7d, 0) AS errors_7d,
       CASE
         WHEN NOT j.enabled THEN 'paused'
         WHEN j.cadence_hours IS NULL THEN
           CASE WHEN s.last_error_at > now() - interval '24 hours' THEN 'failing' ELSE 'ok' END
         WHEN s.last_ok_at IS NULL AND s.last_error_at IS NULL THEN 'never'
         WHEN s.last_error_at IS NOT NULL
              AND (s.last_ok_at IS NULL OR s.last_error_at > s.last_ok_at) THEN 'failing'
         WHEN s.last_ok_at < now() - make_interval(hours => j.cadence_hours + j.grace_hours) THEN 'stale'
         ELSE 'ok'
       END AS status
FROM jobs j
LEFT JOIN stats s USING (job)
LEFT JOIN last_error e USING (job);

REVOKE ALL ON public.automation_health FROM anon;

-- ---------- 4. Retention: 90 days ----------
CREATE OR REPLACE FUNCTION public.purge_old_automation_runs()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.automation_runs WHERE created_at < now() - interval '90 days';
$$;

REVOKE ALL ON FUNCTION public.purge_old_automation_runs() FROM PUBLIC, anon, authenticated;

-- 024 enabled pg_cron; IF NOT EXISTS keeps this safe on a project where it did not run.
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-automation-runs') THEN
    PERFORM cron.unschedule('purge-automation-runs');
  END IF;
  PERFORM cron.schedule(
    'purge-automation-runs',
    '15 3 * * *',
    $cron$ SELECT public.purge_old_automation_runs() $cron$
  );
END $$;

-- ---------- 5. The webhook secret ----------
-- Vault first, the legacy GUC second, '' last. It must never raise: it runs
-- inside AFTER INSERT triggers, and an exception there would roll back the
-- user's own write (a task, a notification) because a mail could not be sent.
CREATE OR REPLACE FUNCTION public.n8n_webhook_secret()
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
    WHERE name = 'n8n_webhook_secret'
    LIMIT 1;
  EXCEPTION WHEN others THEN
    s := NULL;
  END;
  RETURN coalesce(
    nullif(s, ''),
    nullif(current_setting('app.n8n_webhook_secret', true), ''),
    ''
  );
END;
$$;

-- Supabase grants EXECUTE on new public functions to anon/authenticated by
-- default privileges; revoking from PUBLIC alone would leave the secret one
-- RPC call away.
REVOKE ALL ON FUNCTION public.n8n_webhook_secret() FROM PUBLIC, anon, authenticated;

-- ---------- 6. One door: n8n_post(hook, payload) ----------
-- The only place in the database that knows the n8n host. pg_net queues the
-- request and returns at once, so a slow or sleeping n8n never holds the
-- caller's transaction open.
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
    url     := 'https://nixgen-n8n.onrender.com/webhook/' || hook,
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

-- ---------- 7. Existing triggers now go through the door ----------
-- Same names, same signatures, same payloads as 008/009, so every trigger
-- created by 008, 009, 010 and 014 picks these up with no DROP/CREATE.
CREATE OR REPLACE FUNCTION public.notify_n8n_new_client()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.n8n_post('deskdev-new-client', jsonb_build_object(
    'type',   TG_OP,
    'table',  TG_TABLE_NAME,
    'record', to_jsonb(NEW)
  ));
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_n8n_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.n8n_post('deskdev-log', jsonb_build_object(
    'type',   TG_OP,
    'table',  TG_TABLE_NAME,
    'record', to_jsonb(NEW)
  ));
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_n8n_task_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.n8n_post('deskdev-task-assigned', jsonb_build_object(
    'type',   TG_OP,
    'table',  TG_TABLE_NAME,
    'record', to_jsonb(NEW)
  ));
  RETURN NULL;
END;
$$;
