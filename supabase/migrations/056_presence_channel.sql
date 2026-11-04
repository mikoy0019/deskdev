-- 056: who is online (revision 7). The app joins the Realtime topic
-- 'deskdev-presence' as a PRIVATE channel, keyed by user id, and tracks
-- 'active' or 'away'. Private channels are authorised by RLS on
-- realtime.messages: these two policies let an active signed-in account read
-- and publish presence on that one topic, and nothing else. Without them a
-- visitor holding the public key could watch who is online.
--
-- Skipped where Supabase Realtime's schema is absent (PGlite tests).
-- Re-runnable.

DO $$
BEGIN
  IF to_regclass('realtime.messages') IS NULL OR to_regprocedure('realtime.topic()') IS NULL THEN
    RAISE NOTICE '056: realtime.messages is not here; presence policies skipped';
    RETURN;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS deskdev_presence_read ON realtime.messages';
  EXECUTE $p$
    CREATE POLICY deskdev_presence_read ON realtime.messages
      FOR SELECT TO authenticated
      USING (
        realtime.messages.extension = 'presence'
        AND (SELECT realtime.topic()) = 'deskdev-presence'
        AND (SELECT public.is_active())
      )
  $p$;

  EXECUTE 'DROP POLICY IF EXISTS deskdev_presence_track ON realtime.messages';
  EXECUTE $p$
    CREATE POLICY deskdev_presence_track ON realtime.messages
      FOR INSERT TO authenticated
      WITH CHECK (
        realtime.messages.extension = 'presence'
        AND (SELECT realtime.topic()) = 'deskdev-presence'
        AND (SELECT public.is_active())
      )
  $p$;
END $$;
