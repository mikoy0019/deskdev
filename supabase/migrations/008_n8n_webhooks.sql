-- Database webhook -> n8n [deskdev] new-client-alert
-- Fires the workflow at https://nixgen-n8n.onrender.com/webhook/deskdev-new-client
-- when a client row is inserted. The workflow re-queries public.clients over the
-- REST API, so the payload below is informational, not load-bearing.
--
-- The shared secret is NOT stored in this repo. Set it once per project with:
--   ALTER DATABASE postgres SET app.n8n_webhook_secret = '<the value>';
-- Until the n8n side validates it, the header is simply ignored.

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.notify_n8n_new_client()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
AS $$
BEGIN
  PERFORM net.http_post(
    url     := 'https://nixgen-n8n.onrender.com/webhook/deskdev-new-client',
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

DROP TRIGGER IF EXISTS n8n_new_client_alert ON public.clients;
CREATE TRIGGER n8n_new_client_alert
  AFTER INSERT ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_n8n_new_client();
