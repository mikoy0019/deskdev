-- ============================================
-- DeskDev Studio — 013: Job postings (found by the n8n job finder)
-- The Adzuna / onlinejobs.ph finder upserts postings here (deduped on url).
-- Surfaced in the Growth Hub "Job leads" panel; promote → a lead.
-- Gated by the `growth` permission. n8n writes via the service key.
-- ============================================

CREATE TABLE IF NOT EXISTS public.job_postings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source      text NOT NULL,
  external_id text,
  url         text NOT NULL UNIQUE,          -- dedupe key for n8n upsert
  title       text NOT NULL,
  company     text,
  location    text,
  remote      boolean NOT NULL DEFAULT false,
  category    text,
  tag         text NOT NULL DEFAULT 'lead' CHECK (tag IN ('lead','gig')),
  salary_text text,
  posted_at   timestamptz,
  description text,
  dismissed   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_postings_created_idx ON public.job_postings (created_at);
CREATE INDEX IF NOT EXISTS job_postings_tag_idx ON public.job_postings (tag);

-- ---------- Row Level Security ----------
ALTER TABLE public.job_postings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_postings_select" ON public.job_postings;
CREATE POLICY "job_postings_select"
  ON public.job_postings FOR SELECT
  TO authenticated USING (public.has_perm('growth', 'view'));

-- Dismiss (mark handled) from the app.
DROP POLICY IF EXISTS "job_postings_update" ON public.job_postings;
CREATE POLICY "job_postings_update"
  ON public.job_postings FOR UPDATE
  TO authenticated USING (public.has_perm('growth', 'edit'))
  WITH CHECK (public.has_perm('growth', 'edit'));

DROP POLICY IF EXISTS "job_postings_delete" ON public.job_postings;
CREATE POLICY "job_postings_delete"
  ON public.job_postings FOR DELETE
  TO authenticated USING (public.has_perm('growth', 'edit'));

-- Note: INSERT is done by n8n with the service role key (bypasses RLS), so no
-- insert policy is granted to authenticated app users.

-- ---------- Realtime ----------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'job_postings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.job_postings;
  END IF;
END $$;
