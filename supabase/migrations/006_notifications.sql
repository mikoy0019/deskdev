-- ============================================
-- DeskDev Studio — 006: Notifications (+ Realtime)
-- Available to all authenticated users (recipient-scoped)
-- ============================================

CREATE TABLE IF NOT EXISTS public.notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,  -- recipient
  actor_id   uuid REFERENCES public.profiles(id),
  type       text NOT NULL,  -- task_assigned|task_updated|project_updated|client_updated|crm_updated|event_updated|meeting_updated|due_reminder|system
  title      text NOT NULL,
  body       text,
  entity     text,      -- e.g. 'task','project','client','crm_row','event'
  entity_id  uuid,
  read       boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_read_created_idx
  ON public.notifications (user_id, read, created_at);

-- ---------- Row Level Security ----------
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Recipients see only their own notifications
DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Recipients can mark read / update their own notifications
DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Recipients can delete their own notifications
DROP POLICY IF EXISTS "notifications_delete_own" ON public.notifications;
CREATE POLICY "notifications_delete_own"
  ON public.notifications FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Any authenticated user can fan out notifications to other recipients,
-- as long as they honestly identify themselves as the actor.
DROP POLICY IF EXISTS "notifications_insert_as_actor" ON public.notifications;
CREATE POLICY "notifications_insert_as_actor"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (actor_id = auth.uid());

-- ---------- Realtime ----------
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
