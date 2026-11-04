-- ============================================
-- DeskDev Studio — 012: Growth leads (Growth Hub's own pipeline)
-- A dedicated sales-lead store owned by the Growth Hub, separate from the
-- Operations CRM tables. Inbound (site form) + the job finder write here.
-- Gated by the `growth` permission.
-- ============================================

CREATE TABLE IF NOT EXISTS public.leads (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  company    text,
  email      text,
  phone      text,
  stage      text NOT NULL DEFAULT 'new' CHECK (stage IN ('new','contacted','proposal','won','lost')),
  value      integer NOT NULL DEFAULT 0,
  source     text NOT NULL DEFAULT 'other' CHECK (source IN ('seo','referral','linkedin','outbound','website','other')),
  follow_up  date,
  hot        boolean NOT NULL DEFAULT false,
  notes      text,
  owner_id   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  client_id  uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leads_stage_idx ON public.leads (stage);
CREATE INDEX IF NOT EXISTS leads_created_idx ON public.leads (created_at);

DROP TRIGGER IF EXISTS leads_set_updated_at ON public.leads;
CREATE TRIGGER leads_set_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- Row Level Security ----------
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leads_select" ON public.leads;
CREATE POLICY "leads_select"
  ON public.leads FOR SELECT
  TO authenticated USING (public.has_perm('growth', 'view'));

DROP POLICY IF EXISTS "leads_insert" ON public.leads;
CREATE POLICY "leads_insert"
  ON public.leads FOR INSERT
  TO authenticated WITH CHECK (public.has_perm('growth', 'edit'));

DROP POLICY IF EXISTS "leads_update" ON public.leads;
CREATE POLICY "leads_update"
  ON public.leads FOR UPDATE
  TO authenticated USING (public.has_perm('growth', 'edit'))
  WITH CHECK (public.has_perm('growth', 'edit'));

DROP POLICY IF EXISTS "leads_delete" ON public.leads;
CREATE POLICY "leads_delete"
  ON public.leads FOR DELETE
  TO authenticated USING (public.has_perm('growth', 'edit'));

-- ---------- Realtime ----------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'leads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.leads;
  END IF;
END $$;
