-- ============================================
-- DeskDev Studio — 019: Chat (inbox + conversations)
-- Direct messages and group chats between profiles. Open to every
-- authenticated user — no permission key — but every row is scoped to the
-- conversation's participants, so nobody (admins included) reads chats they
-- are not part of.
--
--   conversations       one thread; participant_ids holds every member
--   messages            chat lines inside a conversation
--   conversation_reads  per-user "read up to" marker → unread counts + "Seen"
-- ============================================

CREATE TABLE IF NOT EXISTS public.conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Group name. NULL for direct messages (the UI shows the other person).
  title           text,
  is_group        boolean NOT NULL DEFAULT false,
  participant_ids uuid[] NOT NULL CHECK (cardinality(participant_ids) >= 2),
  created_by      uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  -- Bumped by the messages trigger below; drives inbox ordering.
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations (id) ON DELETE CASCADE,
  sender_id       uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  body            text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  edited_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Not unique on (conversation_id, user_id): two devices can create a marker
-- concurrently, and the client reads the latest one, so a duplicate is
-- harmless where a unique violation would surface as a write error.
CREATE TABLE IF NOT EXISTS public.conversation_reads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations (id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  last_read_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversations_participants_idx ON public.conversations USING gin (participant_ids);
CREATE INDEX IF NOT EXISTS conversations_last_message_idx ON public.conversations (last_message_at DESC);
CREATE INDEX IF NOT EXISTS messages_conversation_created_idx ON public.messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS conversation_reads_conv_user_idx ON public.conversation_reads (conversation_id, user_id);

DROP TRIGGER IF EXISTS conversations_set_updated_at ON public.conversations;
CREATE TRIGGER conversations_set_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- Helpers ----------

-- SECURITY DEFINER so policies on messages/reads can look up membership
-- without re-entering the conversations policy.
CREATE OR REPLACE FUNCTION public.is_conversation_participant(conv uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = conv AND auth.uid() = ANY (c.participant_ids)
  );
$$;

-- A new message moves its conversation to the top of every participant's
-- inbox. Runs as definer: the sender may not satisfy the conversations UPDATE
-- policy's WITH CHECK in edge cases, and the bump must never fail the insert.
CREATE OR REPLACE FUNCTION public.bump_conversation_on_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.conversations
     SET last_message_at = GREATEST(last_message_at, NEW.created_at)
   WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_bump_conversation ON public.messages;
CREATE TRIGGER messages_bump_conversation
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.bump_conversation_on_message();

-- ---------- Row Level Security ----------
ALTER TABLE public.conversations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_reads ENABLE ROW LEVEL SECURITY;

-- conversations: members read and edit (rename a group); the creator must be
-- a member; the creator or an admin may delete.
DROP POLICY IF EXISTS "conversations_select_member" ON public.conversations;
CREATE POLICY "conversations_select_member"
  ON public.conversations FOR SELECT TO authenticated
  USING (auth.uid() = ANY (participant_ids));

DROP POLICY IF EXISTS "conversations_insert_member" ON public.conversations;
CREATE POLICY "conversations_insert_member"
  ON public.conversations FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND auth.uid() = ANY (participant_ids));

DROP POLICY IF EXISTS "conversations_update_member" ON public.conversations;
CREATE POLICY "conversations_update_member"
  ON public.conversations FOR UPDATE TO authenticated
  USING (auth.uid() = ANY (participant_ids))
  WITH CHECK (auth.uid() = ANY (participant_ids));

DROP POLICY IF EXISTS "conversations_delete_owner" ON public.conversations;
CREATE POLICY "conversations_delete_owner"
  ON public.conversations FOR DELETE TO authenticated
  USING (auth.uid() = ANY (participant_ids) AND (created_by = auth.uid() OR public.is_admin()));

-- messages: members read; you post as yourself; you edit/delete your own.
DROP POLICY IF EXISTS "messages_select_member" ON public.messages;
CREATE POLICY "messages_select_member"
  ON public.messages FOR SELECT TO authenticated
  USING (public.is_conversation_participant(conversation_id));

DROP POLICY IF EXISTS "messages_insert_as_sender" ON public.messages;
CREATE POLICY "messages_insert_as_sender"
  ON public.messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid() AND public.is_conversation_participant(conversation_id));

DROP POLICY IF EXISTS "messages_update_own" ON public.messages;
CREATE POLICY "messages_update_own"
  ON public.messages FOR UPDATE TO authenticated
  USING (sender_id = auth.uid())
  WITH CHECK (sender_id = auth.uid() AND public.is_conversation_participant(conversation_id));

DROP POLICY IF EXISTS "messages_delete_own" ON public.messages;
CREATE POLICY "messages_delete_own"
  ON public.messages FOR DELETE TO authenticated
  USING (sender_id = auth.uid());

-- conversation_reads: members see each other's markers (powers "Seen");
-- you only write your own.
DROP POLICY IF EXISTS "conversation_reads_select_member" ON public.conversation_reads;
CREATE POLICY "conversation_reads_select_member"
  ON public.conversation_reads FOR SELECT TO authenticated
  USING (public.is_conversation_participant(conversation_id));

DROP POLICY IF EXISTS "conversation_reads_insert_own" ON public.conversation_reads;
CREATE POLICY "conversation_reads_insert_own"
  ON public.conversation_reads FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_conversation_participant(conversation_id));

DROP POLICY IF EXISTS "conversation_reads_update_own" ON public.conversation_reads;
CREATE POLICY "conversation_reads_update_own"
  ON public.conversation_reads FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "conversation_reads_delete_own" ON public.conversation_reads;
CREATE POLICY "conversation_reads_delete_own"
  ON public.conversation_reads FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ---------- Realtime ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['conversations', 'messages', 'conversation_reads'] LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
