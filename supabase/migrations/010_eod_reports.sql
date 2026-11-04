-- ============================================
-- DeskDev Studio — 010: EOD reports (+ Realtime + n8n log)
-- Persists rendered End-of-Day reports so they can be queried and logged/emailed.
-- One row per author per client per day (the app upserts on that key).
-- Gated by the same `tasks` permission the report is built from.
-- ============================================

CREATE TABLE IF NOT EXISTS public.eod_reports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  client_id     uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  report_date   date NOT NULL,
  content       text NOT NULL,
  total_minutes integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (author_id, client_id, report_date)
);

CREATE INDEX IF NOT EXISTS eod_reports_client_date_idx
  ON public.eod_reports (client_id, report_date);

-- Keep updated_at fresh on re-save (same helper the other tables use).
DROP TRIGGER IF EXISTS eod_reports_set_updated_at ON public.eod_reports;
CREATE TRIGGER eod_reports_set_updated_at
  BEFORE UPDATE ON public.eod_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------- Row Level Security ----------
ALTER TABLE public.eod_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "eod_reports_select" ON public.eod_reports;
CREATE POLICY "eod_reports_select"
  ON public.eod_reports FOR SELECT
  TO authenticated
  USING (public.has_perm('tasks', 'view'));

-- Authors write their own rows (and must have tasks-edit, like the board).
DROP POLICY IF EXISTS "eod_reports_insert_own" ON public.eod_reports;
CREATE POLICY "eod_reports_insert_own"
  ON public.eod_reports FOR INSERT
  TO authenticated
  WITH CHECK (author_id = auth.uid() AND public.has_perm('tasks', 'edit'));

DROP POLICY IF EXISTS "eod_reports_update_own" ON public.eod_reports;
CREATE POLICY "eod_reports_update_own"
  ON public.eod_reports FOR UPDATE
  TO authenticated
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

DROP POLICY IF EXISTS "eod_reports_delete_own" ON public.eod_reports;
CREATE POLICY "eod_reports_delete_own"
  ON public.eod_reports FOR DELETE
  TO authenticated
  USING (author_id = auth.uid());

-- ---------- Realtime ----------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'eod_reports'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.eod_reports;
  END IF;
END $$;

-- ---------- n8n activity log ----------
-- Reuses notify_n8n_log() from 009: an inserted EOD report POSTs to the same
-- /webhook/deskdev-log endpoint with table='eod_reports'. INSERT only, so a
-- re-saved (updated) report on the same day is not re-logged.
DROP TRIGGER IF EXISTS n8n_log_eod_report ON public.eod_reports;
CREATE TRIGGER n8n_log_eod_report
  AFTER INSERT ON public.eod_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_n8n_log();
