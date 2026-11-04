-- ============================================
-- DeskDev Studio — 020: Chat retention (24 hours)
-- Chat is ephemeral. A message older than 24h is deleted, and a conversation
-- with no activity for 24h is deleted outright — messages, read markers and
-- the thread itself.
--
-- Two layers, deliberately:
--   1. purge_expired_chat()  — the delete, run hourly by pg_cron.
--   2. the client also hides anything past the window, so a late or disabled
--      cron never shows a stale message.
-- ============================================

-- Single knob. Change here and both the purge and the index comment follow.
CREATE OR REPLACE FUNCTION public.chat_retention()
RETURNS interval
LANGUAGE sql
IMMUTABLE
AS $$ SELECT interval '24 hours' $$;

-- Deletes expired chat. SECURITY DEFINER so the scheduler (and only the
-- scheduler) can remove rows the RLS policies would otherwise protect —
-- messages_delete_own limits users to their own lines, which would leave the
-- other half of every conversation behind.
CREATE OR REPLACE FUNCTION public.purge_expired_chat()
RETURNS TABLE (deleted_messages bigint, deleted_conversations bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cutoff timestamptz := now() - public.chat_retention();
  msgs   bigint;
  convs  bigint;
BEGIN
  -- Expired lines inside conversations that are still active.
  WITH gone AS (
    DELETE FROM public.messages WHERE created_at < cutoff RETURNING 1
  )
  SELECT count(*) INTO msgs FROM gone;

  -- Threads idle for the whole window go entirely; the FK cascades take any
  -- remaining messages and every read marker with them.
  WITH gone AS (
    DELETE FROM public.conversations WHERE last_message_at < cutoff RETURNING 1
  )
  SELECT count(*) INTO convs FROM gone;

  RETURN QUERY SELECT msgs, convs;
END;
$$;

-- The purge is not something a client should be able to trigger.
REVOKE ALL ON FUNCTION public.purge_expired_chat() FROM PUBLIC, anon, authenticated;

-- Supporting indexes for the two deletes above.
CREATE INDEX IF NOT EXISTS messages_created_at_idx ON public.messages (created_at);
-- conversations_last_message_idx from 019 already covers last_message_at.

-- ---------- Schedule ----------
-- pg_cron lives in the "extensions" schema on Supabase and may not be enabled.
-- Enable it in Dashboard → Database → Extensions if the notice below fires.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('purge-expired-chat')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-expired-chat');

    PERFORM cron.schedule(
      'purge-expired-chat',
      '0 * * * *',                        -- hourly, on the hour
      $cron$ SELECT public.purge_expired_chat() $cron$
    );
  ELSE
    RAISE NOTICE 'pg_cron not installed — chat purge is NOT scheduled. Enable the pg_cron extension, then re-run this migration.';
  END IF;
END $$;
