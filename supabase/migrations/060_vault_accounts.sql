-- 060: a vault account for each admin (revision 6). The vault keeps ONE data
-- key per generation (008/021); until now it was wrapped only under the shared
-- master password. A key slot wraps the same data key under one admin's own
-- vault password, so each admin opens the vault with their own password and
-- their own authenticator, and the master password can stay with the owner.
--
--   kind 'password' — the admin's own vault password (made after unlocking
--                     once, or by claiming an invite).
--   kind 'invite'   — made by an admin who has the vault open, for another
--                     active admin: the key wrapped under a one-time code the
--                     inviter hands over in person. The invitee enters it once
--                     with their authenticator and picks their own password.
--
-- The server never sees a password, a code or the data key: slots hold only
-- salts and wrapped keys, and like vault_meta (031) they are readable only at
-- aal2 — and only by their own admin, so nobody can copy another admin's slot
-- to guess at it offline. Losing the admin role or the account removes the
-- slot. Removing access stops future unlocks; it does not reach a session
-- that is already open (a reset does). Re-runnable.

BEGIN;

CREATE TABLE IF NOT EXISTS public.vault_key_slots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meta_id     uuid NOT NULL REFERENCES public.vault_meta(id) ON DELETE CASCADE,
  -- SET NULL per the repo rule; a slot without an owner opens nothing and the
  -- trigger below removes slots when their admin goes.
  user_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  kind        text NOT NULL CHECK (kind IN ('password', 'invite')),
  salt        text NOT NULL CHECK (salt ~ '^[0-9a-f]{32}$'),
  iterations  integer NOT NULL CHECK (iterations BETWEEN 100000 AND 2000000),
  wrapped_key text NOT NULL CHECK (wrapped_key ~ '^[0-9a-f]+$' AND length(wrapped_key) <= 256),
  created_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS vault_key_slots_one_per_admin ON public.vault_key_slots(meta_id, user_id);

DROP TRIGGER IF EXISTS vault_key_slots_set_updated_at ON public.vault_key_slots;
CREATE TRIGGER vault_key_slots_set_updated_at
  BEFORE UPDATE ON public.vault_key_slots
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.vault_key_slots ENABLE ROW LEVEL SECURITY;

-- Read: your own slot, as an active admin at aal2.
DROP POLICY IF EXISTS vault_key_slots_read_own ON public.vault_key_slots;
CREATE POLICY vault_key_slots_read_own ON public.vault_key_slots
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.is_admin());

-- Add: for the active generation only; your own password slot, or an invite
-- for another active admin who has none yet.
DROP POLICY IF EXISTS vault_key_slots_insert ON public.vault_key_slots;
CREATE POLICY vault_key_slots_insert ON public.vault_key_slots
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin()
    AND created_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.vault_meta m WHERE m.id = meta_id AND m.archived_at IS NULL)
    AND (
      (user_id = auth.uid() AND kind = 'password')
      OR (
        kind = 'invite' AND user_id <> auth.uid()
        AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = user_id AND p.role = 'admin' AND p.deactivated_at IS NULL)
      )
    )
  );

-- Change: your own slot only (a new password, or claiming an invite).
DROP POLICY IF EXISTS vault_key_slots_update_own ON public.vault_key_slots;
CREATE POLICY vault_key_slots_update_own ON public.vault_key_slots
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND public.is_admin())
  WITH CHECK (user_id = auth.uid() AND kind = 'password');

-- Remove your own here; someone else's through vault_remove_access() below
-- (a DELETE naming another admin's row can't see it: slots read as your own).
DROP POLICY IF EXISTS vault_key_slots_delete ON public.vault_key_slots;
CREATE POLICY vault_key_slots_delete ON public.vault_key_slots
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND public.is_admin());

-- Everything at aal2, like the vault's other tables (030/031).
DROP POLICY IF EXISTS vault_key_slots_require_aal2 ON public.vault_key_slots;
CREATE POLICY vault_key_slots_require_aal2 ON public.vault_key_slots
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (((SELECT auth.jwt()) ->> 'aal') = 'aal2')
  WITH CHECK (((SELECT auth.jwt()) ->> 'aal') = 'aal2');

DROP POLICY IF EXISTS "active_account_only" ON public.vault_key_slots;
CREATE POLICY "active_account_only" ON public.vault_key_slots
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_active())) WITH CHECK ((SELECT public.is_active()));

REVOKE ALL ON public.vault_key_slots FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.vault_key_slots TO authenticated;
GRANT UPDATE (kind, salt, iterations, wrapped_key) ON public.vault_key_slots TO authenticated;
GRANT ALL ON public.vault_key_slots TO service_role;

-- ---------- Who has access (no key material) ----------

CREATE OR REPLACE FUNCTION public.vault_access_list()
RETURNS TABLE (user_id uuid, kind text, created_by uuid, created_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'An active admin is required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT s.user_id, s.kind, s.created_by, s.created_at
      FROM public.vault_key_slots s
      JOIN public.vault_meta m ON m.id = s.meta_id AND m.archived_at IS NULL
     WHERE s.user_id IS NOT NULL
     ORDER BY s.created_at;
END $$;
REVOKE ALL ON FUNCTION public.vault_access_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vault_access_list() TO authenticated;

-- Take an admin's access to the active generation away (or cancel an invite).
-- An admin at aal2 only; returns how many slots went (0 or 1).
CREATE OR REPLACE FUNCTION public.vault_remove_access(p_user uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE n integer;
BEGIN
  IF NOT public.is_admin() OR coalesce((SELECT auth.jwt()) ->> 'aal', '') <> 'aal2' THEN
    RAISE EXCEPTION 'An active admin with the second factor is required' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.vault_key_slots s
   USING public.vault_meta m
   WHERE s.meta_id = m.id AND m.archived_at IS NULL AND s.user_id = p_user;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.vault_remove_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vault_remove_access(uuid) TO authenticated;

-- What the unlock screen should ask for, before the authenticator step:
-- 'password' (your own), 'invite' (claim it) or NULL (the master password).
CREATE OR REPLACE FUNCTION public.vault_my_access()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.kind
    FROM public.vault_key_slots s
    JOIN public.vault_meta m ON m.id = s.meta_id AND m.archived_at IS NULL
   WHERE s.user_id = auth.uid() AND public.is_admin()
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.vault_my_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vault_my_access() TO authenticated;

-- ---------- No longer an admin, no vault account ----------

CREATE OR REPLACE FUNCTION public.vault_slots_follow_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM 'admin' OR NEW.deactivated_at IS NOT NULL THEN
    DELETE FROM public.vault_key_slots WHERE user_id = NEW.id;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.vault_slots_follow_profile() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS vault_slots_follow_profile ON public.profiles;
CREATE TRIGGER vault_slots_follow_profile
  AFTER UPDATE OF role, deactivated_at ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.vault_slots_follow_profile();

-- ---------- Audit: access given, taken away, a password changed ----------

CREATE OR REPLACE FUNCTION public.audit_vault_key_slot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.write_audit_log(
      CASE WHEN NEW.kind = 'invite' THEN 'vault.access_invited' ELSE 'vault.access_created' END,
      'vault', NEW.user_id::text, jsonb_build_object('kind', NEW.kind), NEW.created_by);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.write_audit_log('vault.access_removed', 'vault', OLD.user_id::text,
      jsonb_build_object('kind', OLD.kind));
  ELSIF OLD.kind = 'invite' AND NEW.kind = 'password' THEN
    PERFORM public.write_audit_log('vault.access_claimed', 'vault', NEW.user_id::text, '{}'::jsonb, NEW.user_id);
  ELSIF NEW.wrapped_key IS DISTINCT FROM OLD.wrapped_key THEN
    PERFORM public.write_audit_log('vault.password_changed', 'vault', NEW.user_id::text, '{}'::jsonb, NEW.user_id);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.audit_vault_key_slot() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS vault_key_slots_audit ON public.vault_key_slots;
CREATE TRIGGER vault_key_slots_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.vault_key_slots
  FOR EACH ROW EXECUTE FUNCTION public.audit_vault_key_slot();

COMMIT;
