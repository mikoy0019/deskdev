-- Keep existing board grants/RLS. Publish changes so permitted readers can
-- reconcile drawings as other editors save, without waiting for a refresh.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime' AND NOT puballtables)
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'whiteboards') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whiteboards;
  END IF;
END $$;
