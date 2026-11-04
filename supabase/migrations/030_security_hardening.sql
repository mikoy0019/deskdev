-- ============================================
-- DeskDev Studio — 030: Security hardening
-- Closes the holes an RLS review of 001–029 turned up. Every change here
-- tightens access or validates input. Nothing widens access. The script can
-- run more than once.
--
--   1. vault_settings: exactly one row; the owner hand-over needs the
--      authenticator (aal2)
--   2. vault_items / vault_folders: every client operation needs aal2;
--      vault_meta DELETE needs aal2; vault_has_active_meta() for the pre-TOTP
--      phase check
--   3. notifications: client inserts are validated and stamped by the server
--   4. channels in a client's space follow the clients:view permission
--   5. channel_categories: an honest WITH CHECK; a category with channels
--      cannot change space
--   6. conversations: last_message_at / created_at belong to the server
--   7. profiles.email: only admins (or the service role) change it
-- ============================================

-- ---------- 1. vault_settings: one row, aal2 hand-over ----------
-- The only uniqueness was `singleton boolean unique`, which still allows one
-- row with true and one with false. Any admin could plant a second row
-- (singleton = false) carrying their own address. vault-reset reads
-- `limit(1)` with no ORDER BY, so after the next UPDATE of the real row the
-- planted address won, and the reset approval code went to the rogue admin.
-- 022 seeds the row and clients never need to INSERT, so the insert policy
-- goes and a CHECK pins the table to that one row.
DELETE FROM public.vault_settings WHERE NOT singleton;

ALTER TABLE public.vault_settings DROP CONSTRAINT IF EXISTS vault_settings_singleton_true;
ALTER TABLE public.vault_settings
  ADD CONSTRAINT vault_settings_singleton_true CHECK (singleton);

INSERT INTO public.vault_settings (owner_email)
SELECT null
WHERE NOT EXISTS (SELECT 1 FROM public.vault_settings);

DROP POLICY IF EXISTS "vault_settings_admin_insert" ON public.vault_settings;

-- Handing over the owner address used to need only owner_email = auth.email().
-- That is a password-only (aal1) session, which an admin can get for any
-- account by resetting its password. The only UI that sets the address
-- (OwnerEmailCard) is inside the unlocked vault, after the TOTP step-up, so
-- it already runs at aal2.
DROP POLICY IF EXISTS "vault_settings_owner_update" ON public.vault_settings;
CREATE POLICY "vault_settings_owner_update"
  ON public.vault_settings FOR UPDATE TO authenticated
  USING (
    public.is_admin()
    AND ((SELECT auth.jwt()) ->> 'aal') = 'aal2'
    AND (owner_email IS NULL OR lower(owner_email) = lower(auth.email()))
  )
  WITH CHECK (
    public.is_admin()
    AND ((SELECT auth.jwt()) ->> 'aal') = 'aal2'
  );

-- ---------- 2. Vault data needs the second factor ----------
-- The vault's TOTP is a real Supabase MFA factor. A verified unlock raises the
-- session to aal2, but no policy checked that, so a password-only (aal1)
-- admin session could download every ciphertext or bulk-delete the live
-- generation with one REST call. RESTRICTIVE policies add the aal2 condition
-- on top of the existing admin-only ones from 008.
-- Every client read and write of folders and items runs after UnlockGate or
-- EnrollGate has called verifyTotp. Cascades from a vault_meta delete are
-- referential actions, and RLS does not apply to those.
DROP POLICY IF EXISTS "vault_items_require_aal2" ON public.vault_items;
CREATE POLICY "vault_items_require_aal2"
  ON public.vault_items AS RESTRICTIVE FOR ALL TO authenticated
  USING (((SELECT auth.jwt()) ->> 'aal') = 'aal2')
  WITH CHECK (((SELECT auth.jwt()) ->> 'aal') = 'aal2');

DROP POLICY IF EXISTS "vault_folders_require_aal2" ON public.vault_folders;
CREATE POLICY "vault_folders_require_aal2"
  ON public.vault_folders AS RESTRICTIVE FOR ALL TO authenticated
  USING (((SELECT auth.jwt()) ->> 'aal') = 'aal2')
  WITH CHECK (((SELECT auth.jwt()) ->> 'aal') = 'aal2');

-- Deleting an archived generation (and restoring one, which ends in a delete)
-- only happens inside the unlocked vault.
DROP POLICY IF EXISTS "vault_meta_delete_require_aal2" ON public.vault_meta;
CREATE POLICY "vault_meta_delete_require_aal2"
  ON public.vault_meta AS RESTRICTIVE FOR DELETE TO authenticated
  USING (((SELECT auth.jwt()) ->> 'aal') = 'aal2');

-- vault_meta SELECT and INSERT stay at aal1 for now. Both apps read the
-- active meta BEFORE the TOTP step to choose between enroll, setup and
-- locked, and SetupGate inserts the meta without a TOTP step. This helper
-- answers the phase question without the salt or wrapped key. Once both
-- apps use it and verify TOTP before reading or creating the meta, a later
-- migration can gate vault_meta SELECT and INSERT at aal2 too.
CREATE OR REPLACE FUNCTION public.vault_has_active_meta()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
     AND EXISTS (SELECT 1 FROM public.vault_meta WHERE archived_at IS NULL);
$$;

REVOKE ALL ON FUNCTION public.vault_has_active_meta() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vault_has_active_meta() TO authenticated;

-- ---------- 3. notifications: client inserts are validated ----------
-- The only check was actor_id = auth.uid(), so any member could send any
-- user a notification of any type with any text and any created_at. That
-- included 'system', and a 2999 date pinned it to the top of the list. Each
-- row also goes to the Sheets log (009) and to the recipient's devices as a
-- push (029). Both apps fan notifications out to other users, so the policy
-- stays as it is and this trigger checks what a client may send.
-- Server-side inserts (service role, SQL with no JWT) have no auth.uid() and
-- are not affected.
CREATE OR REPLACE FUNCTION public.guard_notification_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.actor_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'a notification must name you as its actor' USING ERRCODE = '42501';
  END IF;

  IF NEW.type IS NULL OR NEW.type NOT IN (
    'task_assigned', 'task_updated', 'project_updated', 'client_updated',
    'crm_updated', 'event_updated', 'meeting_updated', 'due_reminder',
    'channel_mention'
  ) THEN
    RAISE EXCEPTION 'notification type % cannot be sent from the app', NEW.type USING ERRCODE = '42501';
  END IF;

  -- Reminders are computed by each device for its own user.
  IF NEW.type = 'due_reminder' AND NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'a due reminder can only be sent to yourself' USING ERRCODE = '42501';
  END IF;

  -- A mention carries a preview of the message. It only goes to someone who
  -- can read the channel: public or a member of a private one, and in a
  -- client's space only with clients:view. Admins see every channel. Rows that
  -- fail the check are dropped silently, so the sender's other rows still go.
  IF NEW.type = 'channel_mention' THEN
    IF NEW.entity IS DISTINCT FROM 'channel'
       OR NEW.entity_id IS NULL
       OR NOT public.can_view_channel(NEW.entity_id)
       OR NOT EXISTS (
         SELECT 1
           FROM public.channels c
           JOIN public.profiles p ON p.id = NEW.user_id
          WHERE c.id = NEW.entity_id
            AND (
              p.role = 'admin'
              OR (
                (NOT c.is_private OR NEW.user_id = ANY (c.member_ids))
                AND (c.client_id IS NULL OR p.permissions->>'clients' IN ('view', 'edit'))
              )
            )
       ) THEN
      RETURN NULL;
    END IF;
  END IF;

  -- The server decides when it was sent and that it is unread.
  NEW.created_at := now();
  NEW.read := false;
  NEW.title := left(NEW.title, 300);
  NEW.body := left(NEW.body, 1000);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notifications_guard_insert ON public.notifications;
CREATE TRIGGER notifications_guard_insert
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.guard_notification_insert();

-- ---------- 4. Client-space channels follow clients:view ----------
-- 025 put channels and categories into spaces but kept the 023 access
-- rules. A member who could not see a client could still read, post, create
-- and move channels in that client's space by UUID. The app lists client
-- spaces only from the RLS-filtered clients list (gated on clients:view), so
-- it never relied on that wider access.
CREATE OR REPLACE FUNCTION public.can_see_space(space uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT space IS NULL OR public.has_perm('clients', 'view');
$$;

-- Messages, reactions, reads and can_post_channel all go through this.
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
      AND (c.client_id IS NULL OR public.has_perm('clients', 'view'))
  );
$$;

DROP POLICY IF EXISTS "channels_select" ON public.channels;
CREATE POLICY "channels_select"
  ON public.channels FOR SELECT TO authenticated
  USING (
    public.can_see_space(client_id)
    AND (NOT is_private OR auth.uid() = ANY (member_ids) OR public.is_admin())
  );

DROP POLICY IF EXISTS "channels_insert" ON public.channels;
CREATE POLICY "channels_insert"
  ON public.channels FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.can_see_space(client_id)
    AND (NOT is_private OR auth.uid() = ANY (member_ids))
  );

DROP POLICY IF EXISTS "channels_update" ON public.channels;
CREATE POLICY "channels_update"
  ON public.channels FOR UPDATE TO authenticated
  USING ((created_by = auth.uid() OR public.is_admin()) AND public.can_see_space(client_id))
  WITH CHECK ((created_by = auth.uid() OR public.is_admin()) AND public.can_see_space(client_id));

DROP POLICY IF EXISTS "channels_delete" ON public.channels;
CREATE POLICY "channels_delete"
  ON public.channels FOR DELETE TO authenticated
  USING ((created_by = auth.uid() OR public.is_admin()) AND public.can_see_space(client_id));

-- ---------- 5. channel_categories: same space rule, honest WITH CHECK ----------
-- channel_categories_update had WITH CHECK (true). A creator could hand the
-- category to someone else, clear created_by, or move it to another client's
-- space and leave its channels behind under a heading that no longer existed.
DROP POLICY IF EXISTS "channel_categories_select" ON public.channel_categories;
CREATE POLICY "channel_categories_select"
  ON public.channel_categories FOR SELECT TO authenticated
  USING (public.can_see_space(client_id));

DROP POLICY IF EXISTS "channel_categories_insert" ON public.channel_categories;
CREATE POLICY "channel_categories_insert"
  ON public.channel_categories FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.can_see_space(client_id));

DROP POLICY IF EXISTS "channel_categories_update" ON public.channel_categories;
CREATE POLICY "channel_categories_update"
  ON public.channel_categories FOR UPDATE TO authenticated
  USING ((created_by = auth.uid() OR public.is_admin()) AND public.can_see_space(client_id))
  WITH CHECK ((created_by = auth.uid() OR public.is_admin()) AND public.can_see_space(client_id));

DROP POLICY IF EXISTS "channel_categories_delete" ON public.channel_categories;
CREATE POLICY "channel_categories_delete"
  ON public.channel_categories FOR DELETE TO authenticated
  USING ((created_by = auth.uid() OR public.is_admin()) AND public.can_see_space(client_id));

-- A category that holds channels cannot change space. Rejecting is safer
-- than cascading: the category's creator may not manage every channel in it.
-- SECURITY DEFINER so that private channels the caller cannot see still count.
CREATE OR REPLACE FUNCTION public.guard_channel_category_space()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.client_id IS DISTINCT FROM OLD.client_id
     AND EXISTS (SELECT 1 FROM public.channels WHERE category_id = NEW.id) THEN
    RAISE EXCEPTION 'a category with channels cannot change space';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS channel_categories_guard_space ON public.channel_categories;
CREATE TRIGGER channel_categories_guard_space
  BEFORE UPDATE OF client_id ON public.channel_categories
  FOR EACH ROW EXECUTE FUNCTION public.guard_channel_category_space();

-- 025's channel-side guard read the category as the caller. Now that
-- categories in a hidden space are invisible, that lookup would return NULL
-- and let a studio channel (client_id NULL) be filed under a client's
-- category. Reading it as definer keeps the check exact. The function only
-- reads.
CREATE OR REPLACE FUNCTION public.guard_channel_space()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.category_id IS NOT NULL AND (
    SELECT c.client_id FROM public.channel_categories c WHERE c.id = NEW.category_id
  ) IS DISTINCT FROM NEW.client_id THEN
    RAISE EXCEPTION 'a channel and its category must belong to the same space';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------- 6. conversations: timestamps belong to the server ----------
-- Any participant could set last_message_at. Setting it to 2999 pinned the
-- thread to the top of every inbox and kept it past the 24h purge forever.
-- Setting it to 1970 let a non-owner have the next purge delete the whole
-- group, which only the owner or an admin may do. The bump trigger
-- (019, SECURITY DEFINER) runs as the function owner, not as a client role,
-- so it can still move last_message_at.
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
  IF (NEW.last_message_at IS DISTINCT FROM OLD.last_message_at
      OR NEW.created_at IS DISTINCT FROM OLD.created_at)
     AND current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'conversation timestamps are set by the server';
  END IF;
  RETURN NEW;
END;
$$;

-- On insert the client's clock is not trusted either. Both apps stamp a new
-- thread with their own now(), so the server's now() keeps the same meaning.
CREATE OR REPLACE FUNCTION public.stamp_conversation_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    NEW.created_at := now();
    NEW.last_message_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversations_stamp_insert ON public.conversations;
CREATE TRIGGER conversations_stamp_insert
  BEFORE INSERT ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.stamp_conversation_insert();

-- Repair rows already pushed into the future (runs as the migration owner,
-- which the guard lets through).
UPDATE public.conversations
   SET last_message_at = now()
 WHERE last_message_at > now() + interval '5 minutes';
UPDATE public.conversations
   SET created_at = now()
 WHERE created_at > now() + interval '5 minutes';

-- ---------- 7. profiles.email: admins only ----------
-- profiles_update_own lets a member edit their own row, and the trigger only
-- guarded role and permissions. A member could point profiles.email at any
-- address, and the task-assigned mail and the Sheets log trust that column.
-- The app shows the field read-only; admin-users changes it with the service
-- role, which stays exempt. full_name and phone remain self-editable.
CREATE OR REPLACE FUNCTION public.protect_profile_privileges()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.role IS DISTINCT FROM OLD.role
      OR NEW.permissions IS DISTINCT FROM OLD.permissions
      OR NEW.email IS DISTINCT FROM OLD.email)
     AND NOT public.is_admin()
     -- service_role (admin-users Edge Function) has no auth.uid(); it verifies
     -- the caller is an admin itself. Direct SQL (no JWT claims) is trusted too.
     AND COALESCE(auth.role(), 'service_role') <> 'service_role' THEN
    RAISE EXCEPTION 'Only admins can change role, permissions or email';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
