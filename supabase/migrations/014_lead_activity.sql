-- ============================================
-- DeskDev Studio — 014: Lead history (+ speed-to-lead / loss-reason columns)
--
-- Leads previously had no history: moveLeadStage only wrote `stage`, so response
-- time, time-in-stage and stall detection were all unmeasurable, and "won this
-- month" had to be approximated from updated_at (which ANY edit bumps).
-- This mirrors the proven task_activity pattern from 003.
-- ============================================

-- ---------- New lead columns ----------
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS first_responded_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_touch_at      timestamptz,
  ADD COLUMN IF NOT EXISTS lost_reason        text;

-- Guarded so a re-run doesn't error on the existing constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_lost_reason_check'
  ) THEN
    ALTER TABLE public.leads ADD CONSTRAINT leads_lost_reason_check
      CHECK (lost_reason IS NULL OR lost_reason IN
        ('competitor','price','timing','no_decision','unresponsive','other'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS leads_last_touch_idx ON public.leads (last_touch_at);

-- ---------- Lead activity (append-only event log) ----------
CREATE TABLE IF NOT EXISTS public.lead_activity (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id    uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  actor_id   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action     text NOT NULL CHECK (action IN
               ('created','stage_changed','contacted','note','won','lost')),
  detail     jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_activity_lead_created_idx
  ON public.lead_activity (lead_id, created_at);

-- ---------- Row Level Security ----------
ALTER TABLE public.lead_activity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lead_activity_select" ON public.lead_activity;
CREATE POLICY "lead_activity_select"
  ON public.lead_activity FOR SELECT
  TO authenticated USING (public.has_perm('growth', 'view'));

DROP POLICY IF EXISTS "lead_activity_insert" ON public.lead_activity;
CREATE POLICY "lead_activity_insert"
  ON public.lead_activity FOR INSERT
  TO authenticated WITH CHECK (public.has_perm('growth', 'edit'));

DROP POLICY IF EXISTS "lead_activity_delete" ON public.lead_activity;
CREATE POLICY "lead_activity_delete"
  ON public.lead_activity FOR DELETE
  TO authenticated USING (public.has_perm('growth', 'edit'));

-- ---------- n8n ----------
-- The first webhook on a Growth table. Reuses notify_n8n_log() from 009, so lead
-- events flow to the EXISTING /webhook/deskdev-log → Google Sheets logger with no
-- new n8n plumbing (n8n routes on the `table` field in the payload).
DROP TRIGGER IF EXISTS n8n_log_lead_activity ON public.lead_activity;
CREATE TRIGGER n8n_log_lead_activity
  AFTER INSERT ON public.lead_activity
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_n8n_log();

-- ---------- Realtime ----------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'lead_activity'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_activity;
  END IF;
END $$;
