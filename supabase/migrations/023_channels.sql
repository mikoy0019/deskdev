-- ============================================
-- DeskDev Studio — 023: Channels (Discord-style team rooms)
-- Persistent, topic-based rooms grouped into categories. Unlike chat (019)
-- nothing here expires, and anyone can browse public channels.
--
--   channel_categories  collapsible headings in the channel list
--   channels            a room: text or announcement, public or private
--   channel_messages    lines inside a channel (replies + pins live here)
--   channel_reactions   one emoji from one user on one message
--   channel_reads       per-user "read up to" marker → unread dots + mentions
--
-- Who can do what:
--   everyone     browse public channels, post in text channels, react
--   members      the same inside a private channel they were added to
--   manager      a channel's creator or any admin: edit/delete the channel,
--                post in announcement channels, pin, remove anyone's message
--   admins       additionally see every private channel (workspace owners)
-- ============================================

CREATE TABLE IF NOT EXISTS public.channel_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  position    integer NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.channels (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Deleting a category leaves its channels uncategorised, never deletes them.
  category_id  uuid REFERENCES public.channel_categories (id) ON DELETE SET NULL,
  -- Lowercase slug, Discord style: "client-updates".
  name         text NOT NULL CHECK (name ~ '^[a-z0-9][a-z0-9_-]{0,49}$'),
  topic        text CHECK (topic IS NULL OR char_length(topic) <= 300),
  -- text: everyone who can see it posts. announcement: managers post, others read + react.
  kind         text NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'announcement')),
  is_private   boolean NOT NULL DEFAULT false,
  -- Only consulted when is_private. The creator is always included.
  member_ids   uuid[] NOT NULL DEFAULT '{}',
  position     integer NOT NULL DEFAULT 0,
  created_by   uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.channel_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id  uuid NOT NULL REFERENCES public.channels (id) ON DELETE CASCADE,
  sender_id   uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  -- Mentions are stored inline as <@uuid> / @everyone and rendered by the client.
  body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  -- A deleted parent turns the reply into a plain message ("original deleted").
  reply_to_id uuid REFERENCES public.channel_messages (id) ON DELETE SET NULL,
  pinned_at   timestamptz,
  pinned_by   uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  edited_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.channel_reactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  uuid NOT NULL REFERENCES public.channel_messages (id) ON DELETE CASCADE,
  -- Denormalised so RLS can check visibility without a join per row.
  channel_id  uuid NOT NULL REFERENCES public.channels (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  emoji       text NOT NULL CHECK (char_length(emoji) BETWEEN 1 AND 16),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id, emoji)
);

-- Not unique on (channel_id, user_id), same reasoning as conversation_reads:
-- two devices racing the first marker must not surface a write error.
CREATE TABLE IF NOT EXISTS public.channel_reads (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id   uuid NOT NULL REFERENCES public.channels (id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS channels_category_idx ON public.channels (category_id, position);
CREATE INDEX IF NOT EXISTS channels_members_idx ON public.channels USING gin (member_ids);
CREATE INDEX IF NOT EXISTS channel_messages_channel_created_idx ON public.channel_messages (channel_id, created_at);
CREATE INDEX IF NOT EXISTS channel_messages_pinned_idx ON public.channel_messages (channel_id) WHERE pinned_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS channel_reactions_message_idx ON public.channel_reactions (message_id);
CREATE INDEX IF NOT EXISTS channel_reads_channel_user_idx ON public.channel_reads (channel_id, user_id);

DROP TRIGGER IF EXISTS channel_categories_set_updated_at ON public.channel_categories;
CREATE TRIGGER channel_categories_set_updated_at
  BEFORE UPDATE ON public.channel_categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS channels_set_updated_at ON public.channels;
CREATE TRIGGER channels_set_updated_at
  BEFORE UPDATE ON public.channels
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- Helpers ----------
-- SECURITY DEFINER so the message/reaction/read policies can look a channel
-- up without re-entering the channels policy.

CREATE OR REPLACE FUNCTION public.can_view_channel(ch uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.channels c
    WHERE c.id = ch
      AND (NOT c.is_private OR auth.uid() = ANY (c.member_ids) OR public.is_admin())
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_channel(ch uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin() OR EXISTS (
    SELECT 1 FROM public.channels c WHERE c.id = ch AND c.created_by = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.can_post_channel(ch uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_view_channel(ch) AND (
    public.can_manage_channel(ch)
    OR EXISTS (SELECT 1 FROM public.channels c WHERE c.id = ch AND c.kind = 'text')
  );
$$;

-- A new message moves the channel's activity stamp (unread dots compare
-- against it). Definer: the poster is rarely allowed to update the channel.
CREATE OR REPLACE FUNCTION public.bump_channel_on_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.channels
     SET last_message_at = GREATEST(last_message_at, NEW.created_at)
   WHERE id = NEW.channel_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS channel_messages_bump_channel ON public.channel_messages;
CREATE TRIGGER channel_messages_bump_channel
  AFTER INSERT ON public.channel_messages
  FOR EACH ROW EXECUTE FUNCTION public.bump_channel_on_message();

-- RLS cannot restrict columns: a manager may UPDATE a message to pin it, but
-- only its author may rewrite what it says, and nobody may move it.
CREATE OR REPLACE FUNCTION public.guard_channel_message_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.channel_id <> OLD.channel_id OR NEW.sender_id IS DISTINCT FROM OLD.sender_id THEN
    RAISE EXCEPTION 'channel messages cannot be moved or re-attributed';
  END IF;
  IF (NEW.body <> OLD.body OR NEW.reply_to_id IS DISTINCT FROM OLD.reply_to_id)
     AND auth.uid() IS DISTINCT FROM OLD.sender_id THEN
    RAISE EXCEPTION 'only the author can edit a message';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS channel_messages_guard_update ON public.channel_messages;
CREATE TRIGGER channel_messages_guard_update
  BEFORE UPDATE ON public.channel_messages
  FOR EACH ROW EXECUTE FUNCTION public.guard_channel_message_update();

-- ---------- Row Level Security ----------
ALTER TABLE public.channel_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channels           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_messages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_reactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_reads      ENABLE ROW LEVEL SECURITY;

-- categories: everyone sees the headings; anyone may add one; the creator or
-- an admin renames/deletes it.
DROP POLICY IF EXISTS "channel_categories_select" ON public.channel_categories;
CREATE POLICY "channel_categories_select"
  ON public.channel_categories FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "channel_categories_insert" ON public.channel_categories;
CREATE POLICY "channel_categories_insert"
  ON public.channel_categories FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "channel_categories_update" ON public.channel_categories;
CREATE POLICY "channel_categories_update"
  ON public.channel_categories FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR public.is_admin())
  WITH CHECK (true);

DROP POLICY IF EXISTS "channel_categories_delete" ON public.channel_categories;
CREATE POLICY "channel_categories_delete"
  ON public.channel_categories FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR public.is_admin());

-- channels
DROP POLICY IF EXISTS "channels_select" ON public.channels;
CREATE POLICY "channels_select"
  ON public.channels FOR SELECT TO authenticated
  USING (NOT is_private OR auth.uid() = ANY (member_ids) OR public.is_admin());

DROP POLICY IF EXISTS "channels_insert" ON public.channels;
CREATE POLICY "channels_insert"
  ON public.channels FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND (NOT is_private OR auth.uid() = ANY (member_ids)));

DROP POLICY IF EXISTS "channels_update" ON public.channels;
CREATE POLICY "channels_update"
  ON public.channels FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR public.is_admin())
  WITH CHECK (created_by = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "channels_delete" ON public.channels;
CREATE POLICY "channels_delete"
  ON public.channels FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR public.is_admin());

-- messages: visible with the channel; post where allowed; the author edits;
-- the author or a manager deletes; the author or a manager may update (pin),
-- with the guard trigger keeping the body author-only.
DROP POLICY IF EXISTS "channel_messages_select" ON public.channel_messages;
CREATE POLICY "channel_messages_select"
  ON public.channel_messages FOR SELECT TO authenticated
  USING (public.can_view_channel(channel_id));

DROP POLICY IF EXISTS "channel_messages_insert" ON public.channel_messages;
CREATE POLICY "channel_messages_insert"
  ON public.channel_messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid() AND public.can_post_channel(channel_id));

DROP POLICY IF EXISTS "channel_messages_update" ON public.channel_messages;
CREATE POLICY "channel_messages_update"
  ON public.channel_messages FOR UPDATE TO authenticated
  USING (sender_id = auth.uid() OR public.can_manage_channel(channel_id))
  WITH CHECK (public.can_view_channel(channel_id));

DROP POLICY IF EXISTS "channel_messages_delete" ON public.channel_messages;
CREATE POLICY "channel_messages_delete"
  ON public.channel_messages FOR DELETE TO authenticated
  USING (sender_id = auth.uid() OR public.can_manage_channel(channel_id));

-- reactions: visible with the channel; you add and remove only your own.
DROP POLICY IF EXISTS "channel_reactions_select" ON public.channel_reactions;
CREATE POLICY "channel_reactions_select"
  ON public.channel_reactions FOR SELECT TO authenticated
  USING (public.can_view_channel(channel_id));

DROP POLICY IF EXISTS "channel_reactions_insert" ON public.channel_reactions;
CREATE POLICY "channel_reactions_insert"
  ON public.channel_reactions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.can_view_channel(channel_id));

DROP POLICY IF EXISTS "channel_reactions_delete" ON public.channel_reactions;
CREATE POLICY "channel_reactions_delete"
  ON public.channel_reactions FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- reads: private to their owner (no "seen by" in channels).
DROP POLICY IF EXISTS "channel_reads_select_own" ON public.channel_reads;
CREATE POLICY "channel_reads_select_own"
  ON public.channel_reads FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "channel_reads_insert_own" ON public.channel_reads;
CREATE POLICY "channel_reads_insert_own"
  ON public.channel_reads FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.can_view_channel(channel_id));

DROP POLICY IF EXISTS "channel_reads_update_own" ON public.channel_reads;
CREATE POLICY "channel_reads_update_own"
  ON public.channel_reads FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "channel_reads_delete_own" ON public.channel_reads;
CREATE POLICY "channel_reads_delete_own"
  ON public.channel_reads FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ---------- Starter layout ----------
-- A workspace should open onto something, not an empty list. Only runs when
-- there are no channels yet, so re-running the migration never duplicates.
DO $$
DECLARE
  info uuid;
  talk uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.channels) THEN
    INSERT INTO public.channel_categories (name, position) VALUES ('Information', 0) RETURNING id INTO info;
    INSERT INTO public.channel_categories (name, position) VALUES ('Text channels', 1) RETURNING id INTO talk;
    INSERT INTO public.channels (category_id, name, topic, kind, position) VALUES
      (info, 'announcements', 'Studio-wide news. Admins post, everyone reacts.', 'announcement', 0),
      (talk, 'general', 'Anything and everything for the whole team.', 'text', 0),
      (talk, 'wins', 'Shipped something? Landed a client? Share it here.', 'text', 1);
  END IF;
END $$;

-- ---------- Realtime ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['channel_categories', 'channels', 'channel_messages', 'channel_reactions', 'channel_reads'] LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
