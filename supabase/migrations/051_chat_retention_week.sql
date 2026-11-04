-- ============================================
-- DeskDev Studio — 051: chat is kept for a week (was 24 hours)
--
-- 020's single knob, turned. Everything that measures the window reads it:
--   purge_expired_chat()  (020, hourly pg_cron) deletes messages older than
--                         a week, and conversations idle for a week outright
--   push_badge_count()    (029) counts unread chat inside the window
-- The app hides anything past the same window (lib/chat.ts
-- CHAT_RETENTION_HOURS, web and phone) — keep the two in step.
--
-- Lengthening the window deletes nothing that isn't deleted already: rows
-- purged under the 24-hour rule are gone, and the next hourly purge simply
-- keeps more.
--
-- Re-runnable.
-- ============================================

CREATE OR REPLACE FUNCTION public.chat_retention()
RETURNS interval
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$ SELECT interval '7 days' $$;

-- Read by the SECURITY DEFINER purge and badge count (as their owner); no
-- client needs it, and nothing it answers is a secret either.
REVOKE ALL ON FUNCTION public.chat_retention() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_retention() TO authenticated, service_role;
