-- ============================================
-- DeskDev Studio — 011: Growth outbound campaigns
-- Manually-tracked outreach campaigns (volume/opens/replies), surfaced in the
-- Growth Hub "Outbound Command" section. Gated by the new `growth` permission.
-- ============================================

CREATE TABLE IF NOT EXISTS public.campaigns (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  channel    text NOT NULL DEFAULT 'email' CHECK (channel IN ('email','linkedin','cold_call')),
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','done')),
  contacted  integer NOT NULL DEFAULT 0,
  opens      integer NOT NULL DEFAULT 0,
  replies    integer NOT NULL DEFAULT 0,
  positive   integer NOT NULL DEFAULT 0,
  week_of    date NOT NULL,
  owner_id   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaigns_week_idx ON public.campaigns (week_of);

DROP TRIGGER IF EXISTS campaigns_set_updated_at ON public.campaigns;
CREATE TRIGGER campaigns_set_updated_at
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- Row Level Security ----------
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaigns_select" ON public.campaigns;
CREATE POLICY "campaigns_select"
  ON public.campaigns FOR SELECT
  TO authenticated USING (public.has_perm('growth', 'view'));

DROP POLICY IF EXISTS "campaigns_insert" ON public.campaigns;
CREATE POLICY "campaigns_insert"
  ON public.campaigns FOR INSERT
  TO authenticated WITH CHECK (public.has_perm('growth', 'edit'));

DROP POLICY IF EXISTS "campaigns_update" ON public.campaigns;
CREATE POLICY "campaigns_update"
  ON public.campaigns FOR UPDATE
  TO authenticated USING (public.has_perm('growth', 'edit'))
  WITH CHECK (public.has_perm('growth', 'edit'));

DROP POLICY IF EXISTS "campaigns_delete" ON public.campaigns;
CREATE POLICY "campaigns_delete"
  ON public.campaigns FOR DELETE
  TO authenticated USING (public.has_perm('growth', 'edit'));

-- ---------- Realtime ----------
-- Idempotent: ALTER PUBLICATION ADD TABLE has no IF NOT EXISTS, so guard it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'campaigns'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.campaigns;
  END IF;
END $$;
