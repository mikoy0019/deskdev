-- ============================================
-- DeskDev Studio — 005: Events (calendar) & Meetings
-- Features: 'calendar' (kind='event'), 'meetings' (kind='meeting')
-- ============================================

CREATE TABLE IF NOT EXISTS public.events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             text NOT NULL DEFAULT 'event' CHECK (kind IN ('event', 'meeting')),
  title            text NOT NULL,
  description      text,
  client_id        uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz,
  all_day          boolean DEFAULT false,
  location         text,
  meeting_link     text,
  notes            text,  -- meeting notes
  color            text,
  recurrence       text NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly')),
  recurrence_until date,
  created_by       uuid REFERENCES public.profiles(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_starts_at_idx ON public.events (starts_at);
CREATE INDEX IF NOT EXISTS events_client_starts_idx ON public.events (client_id, starts_at);

DROP TRIGGER IF EXISTS events_set_updated_at ON public.events;
CREATE TRIGGER events_set_updated_at
  BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- Row Level Security ----------
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- Read: anyone with calendar OR meetings view access sees the calendar
DROP POLICY IF EXISTS "events_select" ON public.events;
CREATE POLICY "events_select"
  ON public.events FOR SELECT
  TO authenticated
  USING (
    public.has_perm('calendar', 'view')
    OR public.has_perm('meetings', 'view')
  );

-- Writes: split by kind — events need calendar edit, meetings need meetings edit
DROP POLICY IF EXISTS "events_insert" ON public.events;
CREATE POLICY "events_insert"
  ON public.events FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      (kind = 'event'   AND public.has_perm('calendar', 'edit'))
      OR (kind = 'meeting' AND public.has_perm('meetings', 'edit'))
    )
    AND (created_by = auth.uid() OR created_by IS NULL)
  );

DROP POLICY IF EXISTS "events_update" ON public.events;
CREATE POLICY "events_update"
  ON public.events FOR UPDATE
  TO authenticated
  USING (
    (kind = 'event'   AND public.has_perm('calendar', 'edit'))
    OR (kind = 'meeting' AND public.has_perm('meetings', 'edit'))
  )
  WITH CHECK (
    (kind = 'event'   AND public.has_perm('calendar', 'edit'))
    OR (kind = 'meeting' AND public.has_perm('meetings', 'edit'))
  );

DROP POLICY IF EXISTS "events_delete" ON public.events;
CREATE POLICY "events_delete"
  ON public.events FOR DELETE
  TO authenticated
  USING (
    (kind = 'event'   AND public.has_perm('calendar', 'edit'))
    OR (kind = 'meeting' AND public.has_perm('meetings', 'edit'))
  );
