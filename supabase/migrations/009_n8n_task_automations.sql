-- Database webhooks -> n8n [deskdev] task / activity / notification automations
-- Extends the pattern from 008_n8n_webhooks.sql (pg_net -> n8n webhook, shared
-- secret in the `x-webhook-secret` header). Two new n8n workflows consume these:
--
--   /webhook/deskdev-log           <- task_activity + notifications inserts
--                                     (n8n routes by `table`/`action` into the
--                                      "Deskdev Log Activities" Google Sheet tabs)
--   /webhook/deskdev-task-assigned <- tasks inserts that carry an assignee
--                                     (n8n looks up the assignee email and sends
--                                      the "you've been assigned" mail)
--
-- The workflows re-query Supabase over REST for human-readable names, so the
-- payloads below are the trigger signal, not the full record of truth.
--
-- Shared secret (same one 008 uses) is NOT stored in the repo. Set once:
--   ALTER DATABASE postgres SET app.n8n_webhook_secret = '<the value>';

CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── Generic activity/notification log -> n8n -> Google Sheets ────────────────
-- One function for both source tables; n8n switches on `table` (and, for
-- task_activity, on record.action) to pick the destination tab.
CREATE OR REPLACE FUNCTION public.notify_n8n_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
AS $$
BEGIN
  PERFORM net.http_post(
    url     := 'https://nixgen-n8n.onrender.com/webhook/deskdev-log',
    headers := jsonb_build_object(
      'Content-Type',     'application/json',
      'x-webhook-secret', coalesce(current_setting('app.n8n_webhook_secret', true), '')
    ),
    body    := jsonb_build_object(
      'type',   TG_OP,
      'table',  TG_TABLE_NAME,
      'record', to_jsonb(NEW)
    ),
    timeout_milliseconds := 5000
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS n8n_log_task_activity ON public.task_activity;
CREATE TRIGGER n8n_log_task_activity
  AFTER INSERT ON public.task_activity
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_n8n_log();

DROP TRIGGER IF EXISTS n8n_log_notification ON public.notifications;
CREATE TRIGGER n8n_log_notification
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_n8n_log();

-- ── Task assigned -> n8n -> email the assignee ──────────────────────────────
-- Fires on (a) INSERT of a task that already has an assignee, and (b) UPDATE
-- that changes the assignee to a different, non-null user (reassignment). Both
-- route to the same n8n workflow, which emails whoever NEW.assignee_id points at.
CREATE OR REPLACE FUNCTION public.notify_n8n_task_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
AS $$
BEGIN
  PERFORM net.http_post(
    url     := 'https://nixgen-n8n.onrender.com/webhook/deskdev-task-assigned',
    headers := jsonb_build_object(
      'Content-Type',     'application/json',
      'x-webhook-secret', coalesce(current_setting('app.n8n_webhook_secret', true), '')
    ),
    body    := jsonb_build_object(
      'type',   TG_OP,
      'table',  TG_TABLE_NAME,
      'record', to_jsonb(NEW)
    ),
    timeout_milliseconds := 5000
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS n8n_task_assigned ON public.tasks;
CREATE TRIGGER n8n_task_assigned
  AFTER INSERT ON public.tasks
  FOR EACH ROW
  WHEN (NEW.assignee_id IS NOT NULL)
  EXECUTE FUNCTION public.notify_n8n_task_assigned();

-- Reassignment: only when the assignee actually changes to a different, non-null
-- user (not on every task edit, and not when the assignee is cleared).
DROP TRIGGER IF EXISTS n8n_task_reassigned ON public.tasks;
CREATE TRIGGER n8n_task_reassigned
  AFTER UPDATE ON public.tasks
  FOR EACH ROW
  WHEN (NEW.assignee_id IS NOT NULL AND NEW.assignee_id IS DISTINCT FROM OLD.assignee_id)
  EXECUTE FUNCTION public.notify_n8n_task_assigned();
