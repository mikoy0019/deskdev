-- ============================================
-- DeskDev Studio — 024: Hardening
-- Closes the holes a full review of 001–023 turned up. Every change here is
-- additive or tightening; nothing widens access.
--
--   1. Sign-up trigger no longer trusts client metadata for role/permissions
--   2. tasks.category_id — the column the app has written to since subtasks
--   3. time_entries: only the owner (or an admin) edits/deletes an entry
--   4. task_activity: only admins delete history; lead_activity: honest actor
--   5. eod_reports: editing needs the same tasks:edit the insert needed
--   6. conversations: only the creator/admin changes membership or ownership
--   7. messages: created_at / conversation / sender are immutable
--   8. channel_reactions: the reaction's channel must be the message's channel
--   9. channel_messages: pinning is a manager action, even on your own message
--  10. vault_meta / vault_settings: no direct UPDATE; owner-only handover
--  11. task_activity.client_id gets the FK every other child table has
--  12. courses.* get the updated_at triggers every other table has
--  13. pg_cron is enabled here, so 020's chat purge actually runs
-- ============================================

-- ---------- 1. Sign-up: role and permissions are never client-supplied ----------
-- Supabase's auth endpoint is public even with no sign-up screen in the app.
-- With the anon key from the bundle anyone could sign up with
-- `data: { role: 'admin' }` and the old trigger would honour it. Every real
-- account is created by the admin-users Edge Function, which patches role
-- and permissions with the service role afterwards.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, phone, title, role, permissions)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(COALESCE(NEW.email, 'user'), '@', 1)),
    NEW.raw_user_meta_data->>'phone',
    NEW.raw_user_meta_data->>'title',
    'member',
    '{}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ---------- 2. tasks.category_id ----------
-- Task.categoryId has existed in the app since 015 (subtasks reuse the
-- client's project categories) but no migration added the column, so every
-- task saved with a category was rejected by PostgREST and lived only locally.
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.project_categories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS tasks_category_id_idx ON public.tasks (category_id);

-- ---------- 3. time_entries: your own hours ----------
DROP POLICY IF EXISTS "time_entries_update" ON public.time_entries;
CREATE POLICY "time_entries_update"
  ON public.time_entries FOR UPDATE
  TO authenticated
  USING (public.has_perm('tasks', 'edit') AND (user_id = auth.uid() OR public.is_admin()))
  WITH CHECK (public.has_perm('tasks', 'edit') AND (user_id = auth.uid() OR public.is_admin()));

DROP POLICY IF EXISTS "time_entries_delete" ON public.time_entries;
CREATE POLICY "time_entries_delete"
  ON public.time_entries FOR DELETE
  TO authenticated
  USING (public.has_perm('tasks', 'edit') AND (user_id = auth.uid() OR public.is_admin()));

-- ---------- 4. Activity logs: no erasing, no spoofing ----------
DROP POLICY IF EXISTS "task_activity_delete" ON public.task_activity;
CREATE POLICY "task_activity_delete"
  ON public.task_activity FOR DELETE
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "lead_activity_insert" ON public.lead_activity;
CREATE POLICY "lead_activity_insert"
  ON public.lead_activity FOR INSERT
  TO authenticated
  WITH CHECK (public.has_perm('growth', 'edit') AND actor_id = auth.uid());

DROP POLICY IF EXISTS "lead_activity_delete" ON public.lead_activity;
CREATE POLICY "lead_activity_delete"
  ON public.lead_activity FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ---------- 5. eod_reports: same gate to edit as to write ----------
DROP POLICY IF EXISTS "eod_reports_update_own" ON public.eod_reports;
CREATE POLICY "eod_reports_update_own"
  ON public.eod_reports FOR UPDATE
  TO authenticated
  USING (author_id = auth.uid() AND public.has_perm('tasks', 'edit'))
  WITH CHECK (author_id = auth.uid() AND public.has_perm('tasks', 'edit'));

-- ---------- 6. conversations: membership and ownership are the creator's ----------
-- The UPDATE policy lets any participant rename a group, which is right; it
-- also let them rewrite participant_ids (add a stranger, drop everyone else)
-- and created_by (become the owner, then delete the thread for all). RLS
-- cannot restrict columns, so a trigger does.
CREATE OR REPLACE FUNCTION public.guard_conversation_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'a conversation cannot change owner';
  END IF;
  IF (NEW.participant_ids <> OLD.participant_ids OR NEW.is_group <> OLD.is_group)
     AND NOT (auth.uid() = OLD.created_by OR public.is_admin()) THEN
    RAISE EXCEPTION 'only the conversation owner can change its members';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversations_guard_update ON public.conversations;
CREATE TRIGGER conversations_guard_update
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.guard_conversation_update();

-- ---------- 7. messages: only the text can change ----------
-- A sender could move a message to another thread or push created_at into the
-- future, which sorts it to the top forever and keeps it past the 24h purge.
CREATE OR REPLACE FUNCTION public.guard_message_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.conversation_id <> OLD.conversation_id
     OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'messages cannot be moved, re-attributed or re-dated';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_guard_update ON public.messages;
CREATE TRIGGER messages_guard_update
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.guard_message_update();

-- Clients stamp created_at themselves (to sort a reply after what it
-- answers on a skewed clock). Allow a little skew, never a future date.
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_created_at_not_future;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_created_at_not_future CHECK (created_at <= now() + interval '5 minutes');

ALTER TABLE public.channel_messages DROP CONSTRAINT IF EXISTS channel_messages_created_at_not_future;
ALTER TABLE public.channel_messages
  ADD CONSTRAINT channel_messages_created_at_not_future CHECK (created_at <= now() + interval '5 minutes');

-- ---------- 8. channel_reactions: channel must match the message ----------
-- The denormalised channel_id is what RLS checks; without this a member could
-- attach a reaction to a private-channel message by naming a public channel.
CREATE OR REPLACE FUNCTION public.guard_channel_reaction()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.channel_id IS DISTINCT FROM (SELECT m.channel_id FROM public.channel_messages m WHERE m.id = NEW.message_id) THEN
    RAISE EXCEPTION 'reaction channel does not match its message';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS channel_reactions_guard ON public.channel_reactions;
CREATE TRIGGER channel_reactions_guard
  BEFORE INSERT OR UPDATE ON public.channel_reactions
  FOR EACH ROW EXECUTE FUNCTION public.guard_channel_reaction();

-- ---------- 9. channel_messages: pinning is a manager action ----------
CREATE OR REPLACE FUNCTION public.guard_channel_message_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.channel_id <> OLD.channel_id
     OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'channel messages cannot be moved, re-attributed or re-dated';
  END IF;
  IF (NEW.body <> OLD.body OR NEW.reply_to_id IS DISTINCT FROM OLD.reply_to_id)
     AND auth.uid() IS DISTINCT FROM OLD.sender_id THEN
    RAISE EXCEPTION 'only the author can edit a message';
  END IF;
  IF (NEW.pinned_at IS DISTINCT FROM OLD.pinned_at OR NEW.pinned_by IS DISTINCT FROM OLD.pinned_by) THEN
    IF NOT public.can_manage_channel(OLD.channel_id) THEN
      RAISE EXCEPTION 'only a channel manager can pin or unpin';
    END IF;
    -- Whoever pins is the pinner; the client cannot credit someone else.
    NEW.pinned_by := CASE WHEN NEW.pinned_at IS NULL THEN NULL ELSE auth.uid() END;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------- 10. Vault: no direct edits, owner-only handover ----------
-- The client only ever SELECTs and INSERTs vault_meta, and DELETEs an
-- archived generation. Archiving is the reset Edge Function's job (022), run
-- with the service role after a code is verified. An open UPDATE/DELETE
-- policy let any admin archive or drop the live vault with one REST call,
-- which is exactly what the approval flow exists to prevent.
DROP POLICY IF EXISTS "vault_meta_admin_all" ON public.vault_meta;

DROP POLICY IF EXISTS "vault_meta_admin_select" ON public.vault_meta;
CREATE POLICY "vault_meta_admin_select"
  ON public.vault_meta FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "vault_meta_admin_insert" ON public.vault_meta;
CREATE POLICY "vault_meta_admin_insert"
  ON public.vault_meta FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "vault_meta_admin_delete_archived" ON public.vault_meta;
CREATE POLICY "vault_meta_admin_delete_archived"
  ON public.vault_meta FOR DELETE TO authenticated
  USING (public.is_admin() AND archived_at IS NOT NULL);

-- The owner address is the approver for every reset. Anyone could set it to
-- themselves and approve their own request; now only an unset address, or the
-- current owner, can change it.
DROP POLICY IF EXISTS "vault_settings_admin_all" ON public.vault_settings;

DROP POLICY IF EXISTS "vault_settings_admin_select" ON public.vault_settings;
CREATE POLICY "vault_settings_admin_select"
  ON public.vault_settings FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "vault_settings_admin_insert" ON public.vault_settings;
CREATE POLICY "vault_settings_admin_insert"
  ON public.vault_settings FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "vault_settings_owner_update" ON public.vault_settings;
CREATE POLICY "vault_settings_owner_update"
  ON public.vault_settings FOR UPDATE TO authenticated
  USING (public.is_admin() AND (owner_email IS NULL OR lower(owner_email) = lower(auth.email())))
  WITH CHECK (public.is_admin());

-- ---------- 11. task_activity.client_id foreign key ----------
-- Every other child of clients cascades; 'deleted' activity rows (task_id
-- NULL) survived and came back on hydrate pointing at a client that no longer
-- existed. Orphans go first or the constraint cannot be added.
DELETE FROM public.task_activity a
 WHERE NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = a.client_id);

ALTER TABLE public.task_activity DROP CONSTRAINT IF EXISTS task_activity_client_id_fkey;
ALTER TABLE public.task_activity
  ADD CONSTRAINT task_activity_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

-- ---------- 12. courses: updated_at maintained server-side ----------
DROP TRIGGER IF EXISTS courses_set_updated_at ON public.courses;
CREATE TRIGGER courses_set_updated_at
  BEFORE UPDATE ON public.courses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS course_modules_set_updated_at ON public.course_modules;
CREATE TRIGGER course_modules_set_updated_at
  BEFORE UPDATE ON public.course_modules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS course_topics_set_updated_at ON public.course_topics;
CREATE TRIGGER course_topics_set_updated_at
  BEFORE UPDATE ON public.course_topics
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- 13. pg_cron: make the chat purge real ----------
-- 020 only scheduled the purge if pg_cron happened to be installed, and it is
-- not by default — so the "messages vanish after 24h" promise held only in
-- the UI. Enable it and schedule (idempotently) here.
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-expired-chat') THEN
    PERFORM cron.unschedule('purge-expired-chat');
  END IF;
  PERFORM cron.schedule(
    'purge-expired-chat',
    '0 * * * *',
    $cron$ SELECT public.purge_expired_chat() $cron$
  );
END $$;
