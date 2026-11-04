-- Whiteboard revisions: task covers/comments, DM replies, OLJ application
-- preparation and server-side channel notifications. Apply before the UI.
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS cover_url text;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_cover_url_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_cover_url_check
  CHECK (cover_url IS NULL OR (cover_url ~* '^https://[^[:space:]]+$' AND length(cover_url) <= 2048));

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS reply_to_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS messages_conversation_id_id_idx ON public.messages(conversation_id, id);
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_reply_same_conversation;
ALTER TABLE public.messages ADD CONSTRAINT messages_reply_same_conversation
  FOREIGN KEY (conversation_id, reply_to_id) REFERENCES public.messages(conversation_id, id)
  ON DELETE SET NULL (reply_to_id);
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_reply_not_self;
ALTER TABLE public.messages ADD CONSTRAINT messages_reply_not_self CHECK (reply_to_id IS DISTINCT FROM id);

ALTER TABLE public.job_postings ADD COLUMN IF NOT EXISTS application jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.job_postings DROP CONSTRAINT IF EXISTS job_postings_application_check;
ALTER TABLE public.job_postings ADD CONSTRAINT job_postings_application_check
  CHECK (jsonb_typeof(application) = 'object' AND octet_length(application::text) <= 200000);
DROP POLICY IF EXISTS job_postings_insert ON public.job_postings;
CREATE POLICY job_postings_insert ON public.job_postings FOR INSERT TO authenticated
  WITH CHECK (public.has_perm('growth', 'edit') AND source = 'onlinejobs.ph'
    AND url ~ '^https://www\.onlinejobs\.ph/jobseekers/job/[^[:space:]]+$');

-- Comments reuse the append-only task history so the existing realtime and
-- permission boundaries apply, including the activity log export.
CREATE OR REPLACE FUNCTION public.guard_task_comment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.detail IS NULL OR NOT (NEW.detail ? 'comment') THEN RETURN NEW; END IF;
  IF NEW.action IS DISTINCT FROM 'updated' OR jsonb_typeof(NEW.detail->'comment') IS DISTINCT FROM 'string'
     OR length(btrim(NEW.detail->>'comment')) NOT BETWEEN 1 AND 10000
     OR NEW.actor_id IS DISTINCT FROM auth.uid() OR auth.uid() IS NULL
     OR NOT public.has_perm('tasks', 'edit')
     OR NOT EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = NEW.task_id AND t.client_id = NEW.client_id) THEN
    RAISE EXCEPTION 'invalid task comment' USING ERRCODE = '42501';
  END IF;
  NEW.created_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_task_comment() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS task_comment_guard ON public.task_activity;
CREATE TRIGGER task_comment_guard BEFORE INSERT ON public.task_activity FOR EACH ROW EXECUTE FUNCTION public.guard_task_comment();

CREATE OR REPLACE FUNCTION public.notify_task_comment_mentions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.detail IS NULL OR NOT (NEW.detail ? 'comment') THEN RETURN NEW; END IF;
  INSERT INTO public.notifications(user_id, actor_id, type, title, body, entity, entity_id)
  SELECT p.id, auth.uid(), 'task_updated', left(actor.full_name || ' mentioned you on ' || t.title, 300),
    left(NEW.detail->>'comment', 1000), 'task', NEW.task_id
    FROM public.profiles p CROSS JOIN public.profiles actor CROSS JOIN public.tasks t
   WHERE actor.id = NEW.actor_id AND t.id = NEW.task_id AND p.id <> NEW.actor_id
     AND p.deactivated_at IS NULL AND public.user_has_perm(p.id, 'tasks', 'view')
     AND position('<@' || p.id::text || '>' in (NEW.detail->>'comment')) > 0;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_task_comment_mentions() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS task_comment_mentions ON public.task_activity;
CREATE TRIGGER task_comment_mentions AFTER INSERT ON public.task_activity FOR EACH ROW EXECUTE FUNCTION public.notify_task_comment_mentions();

-- Notify from the insert transaction, not the sender's browser. Existing
-- channel_mention routes and preference category also handle ordinary posts.
CREATE OR REPLACE FUNCTION public.notify_channel_post()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE room public.channels%ROWTYPE; actor_name text;
BEGIN
  -- Imports and maintenance may replay historical messages. Only a signed-in
  -- person's new post should alert the team.
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF auth.uid() IS NOT NULL AND NEW.sender_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'channel sender must be the actor' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO room FROM public.channels WHERE id = NEW.channel_id;
  SELECT full_name INTO actor_name FROM public.profiles WHERE id = NEW.sender_id;
  INSERT INTO public.notifications(user_id, actor_id, type, title, body, entity, entity_id)
  SELECT p.id, auth.uid(), 'channel_mention', left(coalesce(actor_name, 'Teammate') ||
    CASE WHEN position('<@' || p.id::text || '>' in NEW.body) > 0 THEN ' mentioned you in #'
         WHEN EXISTS (SELECT 1 FROM public.channel_messages parent WHERE parent.id = NEW.reply_to_id AND parent.sender_id = p.id) THEN ' replied to you in #'
         ELSE ' posted in #' END || room.name, 300),
    left(NEW.body, 1000), 'channel', NEW.channel_id
    FROM public.profiles p WHERE p.id IS DISTINCT FROM NEW.sender_id AND p.deactivated_at IS NULL
     AND (p.role = 'admin' OR ((NOT room.is_private OR p.id = ANY(room.member_ids))
       AND (room.client_id IS NULL OR public.user_has_perm(p.id, 'clients', 'view'))));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_channel_post() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS channel_post_notifications ON public.channel_messages;
CREATE TRIGGER channel_post_notifications AFTER INSERT ON public.channel_messages FOR EACH ROW EXECUTE FUNCTION public.notify_channel_post();
