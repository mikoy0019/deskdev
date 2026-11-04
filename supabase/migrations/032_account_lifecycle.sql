-- ============================================
-- DeskDev Studio — 032: Account lifecycle + audit log
-- Offboarding that keeps history, deletes that work for test accounts, and a
-- record of who changed access. Apply after 030 (it extends that file's
-- protect_profile_privileges). Re-runnable: IF NOT EXISTS / OR REPLACE /
-- DROP … IF EXISTS throughout, and the foreign-key rewrite skips constraints
-- that are already ON DELETE SET NULL.
--
--   1. profiles.deactivated_at / deactivated_by
--   2. every foreign key to profiles that had no ON DELETE rule → SET NULL
--   3. audit_log (admins read; only triggers and the service role write)
--   4. audit_actor() / write_audit_log(): who did it, for triggers and
--      service-role callers
--   5. profiles: deactivation is admin-only, stamped, and locks out at once
--   6. audit triggers: profile access changes, vault reset approvals
--   7. a database backstop for "DeskDev always keeps one admin"
-- ============================================

-- ---------- 1. Deactivation columns ----------
-- admin-users `deactivate` used to leave no trace on the profile: pickers
-- could not tell a departed teammate from a quiet one. The timestamp lets
-- them filter, and the audit log keeps the story.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL;

-- ---------- 2. Foreign keys to profiles: ON DELETE SET NULL ----------
-- Ten columns from 003–008 referenced profiles with no ON DELETE rule, so
-- deleting any account that ever created a task, logged time, built a CRM
-- table, scheduled an event, sent a notification or saved a vault item failed
-- with "Database error deleting user". (The plan counted 8; 008's two vault
-- columns block the same way.) History survives with the person blanked out,
-- which is what every later table (010+) already does.
-- The constraint is found by column, not by name, so a differently named
-- constraint on the live project is still replaced, and one that is already
-- SET NULL is left alone.
DO $$
DECLARE
  r      record;
  v_name text;
  v_rule "char";
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('projects',       'created_by'),
      ('tasks',          'created_by'),
      ('task_activity',  'actor_id'),
      ('time_entries',   'user_id'),
      ('crm_tables',     'created_by'),
      ('crm_rows',       'created_by'),
      ('events',         'created_by'),
      ('notifications',  'actor_id'),
      ('vault_folders',  'created_by'),
      ('vault_items',    'created_by')
    ) AS t (tbl, col)
  LOOP
    IF to_regclass('public.' || r.tbl) IS NULL THEN
      CONTINUE;
    END IF;

    SELECT c.conname, c.confdeltype INTO v_name, v_rule
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.conrelid = ('public.' || r.tbl)::regclass
       AND c.contype = 'f'
       AND c.confrelid = 'public.profiles'::regclass
       AND array_length(c.conkey, 1) = 1
       AND a.attname = r.col
     LIMIT 1;

    IF v_name IS NOT NULL AND v_rule = 'n' THEN
      CONTINUE; -- already SET NULL
    END IF;

    IF v_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.tbl, v_name);
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.profiles (id) ON DELETE SET NULL',
      r.tbl, r.tbl || '_' || r.col || '_fkey', r.col
    );
  END LOOP;
END;
$$;

-- ---------- 3. audit_log ----------
-- Append-only record of access and security changes. actor_id deliberately
-- has no foreign key: the log must still say who did it after that account
-- is deleted (rule 2's SET NULL would erase exactly the fact we keep it for).
-- entity_id is text because subjects are uuids, slugs or singletons.
CREATE TABLE IF NOT EXISTS public.audit_log (
  id        bigserial PRIMARY KEY,
  at        timestamptz NOT NULL DEFAULT now(),
  actor_id  uuid,
  action    text NOT NULL CHECK (action ~ '^[a-z_]+\.[a-z_]+$' AND length(action) <= 64),
  entity    text,
  entity_id text,
  detail    jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS audit_log_at_idx ON public.audit_log (at DESC);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON public.audit_log (entity, entity_id, at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON public.audit_log (actor_id, at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log_admin_select" ON public.audit_log;
CREATE POLICY "audit_log_admin_select"
  ON public.audit_log FOR SELECT TO authenticated
  USING (public.is_admin());

-- No INSERT/UPDATE/DELETE policy, and no grant either: not even an admin can
-- forge, edit or erase a row from the client. Triggers below run as the
-- function owner; edge functions use the service role.
REVOKE ALL ON public.audit_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
REVOKE ALL ON SEQUENCE public.audit_log_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.audit_log_id_seq TO service_role;

-- ---------- 4. Who did it ----------
-- A signed-in user is auth.uid(). The admin-users function works with the
-- service role, where auth.uid() is NULL, so it names the verified admin in
-- an `x-deskdev-actor` request header; PostgREST exposes request headers to
-- SQL. The header is only believed for the service role: that key never
-- leaves the edge functions, and a signed-in user always has auth.uid().
CREATE OR REPLACE FUNCTION public.audit_actor()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_header text;
BEGIN
  IF v_uid IS NOT NULL THEN
    RETURN v_uid;
  END IF;
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_header := nullif(current_setting('request.headers', true), '')::json ->> 'x-deskdev-actor';
  EXCEPTION WHEN others THEN
    RETURN NULL; -- malformed headers never break the write that is being audited
  END;
  IF v_header ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN v_header::uuid;
  END IF;
  RETURN NULL;
END;
$$;

-- The one way rows get in. Used by the triggers here, by later migrations
-- (the showcase publish guard) and by service-role edge functions (Drive
-- export). Never by clients: they would write their own history.
CREATE OR REPLACE FUNCTION public.write_audit_log(
  p_action    text,
  p_entity    text,
  p_entity_id text,
  p_detail    jsonb DEFAULT '{}'::jsonb,
  p_actor     uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audit_log (actor_id, action, entity, entity_id, detail)
  VALUES (
    coalesce(p_actor, public.audit_actor()),
    p_action,
    left(p_entity, 64),
    left(p_entity_id, 128),
    coalesce(p_detail, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.audit_actor() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.write_audit_log(text, text, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_actor() TO service_role;
GRANT EXECUTE ON FUNCTION public.write_audit_log(text, text, text, jsonb, uuid) TO service_role;

-- ---------- 5. Deactivation: admin-only, stamped, effective at once ----------
-- 030's guard plus the two new columns: a member must not be able to clear
-- their own deactivation (profiles_update_own lets them edit their row).
CREATE OR REPLACE FUNCTION public.protect_profile_privileges()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.role IS DISTINCT FROM OLD.role
      OR NEW.permissions IS DISTINCT FROM OLD.permissions
      OR NEW.email IS DISTINCT FROM OLD.email
      OR NEW.deactivated_at IS DISTINCT FROM OLD.deactivated_at
      OR NEW.deactivated_by IS DISTINCT FROM OLD.deactivated_by)
     AND NOT public.is_admin()
     -- service_role (admin-users Edge Function) has no auth.uid(); it verifies
     -- the caller is an admin itself. Direct SQL (no JWT claims) is trusted too.
     AND COALESCE(auth.role(), 'service_role') <> 'service_role' THEN
    RAISE EXCEPTION 'Only admins can change role, permissions, email or deactivation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Who deactivated is the server's call, not the client's: a deactivation
-- always names the admin who did it, and reactivation clears it.
CREATE OR REPLACE FUNCTION public.stamp_profile_deactivation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.deactivated_at IS NULL THEN
    NEW.deactivated_by := NULL;
  ELSIF OLD.deactivated_at IS NULL THEN
    NEW.deactivated_at := now();
    NEW.deactivated_by := coalesce(public.audit_actor(), NEW.deactivated_by);
  ELSE
    -- Already deactivated: the original stamp stands. deactivated_by may
    -- still go to NULL, which is what ON DELETE SET NULL does when the admin
    -- who deactivated them is deleted.
    NEW.deactivated_at := OLD.deactivated_at;
    IF NEW.deactivated_by IS NOT NULL THEN
      NEW.deactivated_by := OLD.deactivated_by;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_stamp_deactivation ON public.profiles;
CREATE TRIGGER profiles_stamp_deactivation
  BEFORE UPDATE OF deactivated_at, deactivated_by ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.stamp_profile_deactivation();

-- A deactivated account loses admin and every permission in RLS right away,
-- even before its access token expires and even if someone set the column
-- without also demoting (admin-users demotes too). Same signatures as 001,
-- so every policy that calls them picks this up.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND deactivated_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.has_perm(feature text, level text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.deactivated_at IS NULL
      AND (
        p.role = 'admin'
        OR (
          level = 'view'
          AND p.permissions->>feature IN ('view', 'edit')
        )
        OR (
          level = 'edit'
          AND p.permissions->>feature = 'edit'
        )
      )
  );
$$;

-- A deactivated person's phones and browsers stop getting pushes at once.
-- admin-users deletes them too; this covers every other path.
CREATE OR REPLACE FUNCTION public.drop_push_on_deactivation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF to_regclass('public.push_subscriptions') IS NOT NULL THEN
    DELETE FROM public.push_subscriptions WHERE user_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS profiles_drop_push_on_deactivation ON public.profiles;
CREATE TRIGGER profiles_drop_push_on_deactivation
  AFTER UPDATE OF deactivated_at ON public.profiles
  FOR EACH ROW
  WHEN (OLD.deactivated_at IS NULL AND NEW.deactivated_at IS NOT NULL)
  EXECUTE FUNCTION public.drop_push_on_deactivation();

-- ---------- 6. Audit triggers ----------
-- Profiles: role, permissions, sign-in email, deactivation, create, delete.
-- full_name / phone / title / avatar are self-service and not audited.
CREATE OR REPLACE FUNCTION public.audit_profile_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.write_audit_log('profile.created', 'profile', NEW.id::text,
      jsonb_build_object('email', NEW.email, 'full_name', NEW.full_name, 'role', NEW.role));
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.write_audit_log('profile.deleted', 'profile', OLD.id::text,
      jsonb_build_object('email', OLD.email, 'full_name', OLD.full_name, 'role', OLD.role));
    RETURN NULL;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    PERFORM public.write_audit_log('profile.role_changed', 'profile', NEW.id::text,
      jsonb_build_object('from', OLD.role, 'to', NEW.role, 'full_name', NEW.full_name));
  END IF;

  IF NEW.permissions IS DISTINCT FROM OLD.permissions THEN
    PERFORM public.write_audit_log('profile.permissions_changed', 'profile', NEW.id::text,
      jsonb_build_object('from', OLD.permissions, 'to', NEW.permissions, 'full_name', NEW.full_name));
  END IF;

  IF NEW.email IS DISTINCT FROM OLD.email THEN
    PERFORM public.write_audit_log('profile.email_changed', 'profile', NEW.id::text,
      jsonb_build_object('from', OLD.email, 'to', NEW.email, 'full_name', NEW.full_name));
  END IF;

  IF OLD.deactivated_at IS NULL AND NEW.deactivated_at IS NOT NULL THEN
    PERFORM public.write_audit_log('profile.deactivated', 'profile', NEW.id::text,
      jsonb_build_object('full_name', NEW.full_name, 'email', NEW.email), NEW.deactivated_by);
  ELSIF OLD.deactivated_at IS NOT NULL AND NEW.deactivated_at IS NULL THEN
    PERFORM public.write_audit_log('profile.reactivated', 'profile', NEW.id::text,
      jsonb_build_object('full_name', NEW.full_name, 'email', NEW.email, 'deactivated_at', OLD.deactivated_at));
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS profiles_audit ON public.profiles;
CREATE TRIGGER profiles_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.audit_profile_change();

-- Vault resets: a code requested, a code accepted (the approval), the active
-- generation archived or deleted, and the approval address handed over. The
-- code hash and the vault contents never enter the log.
CREATE OR REPLACE FUNCTION public.audit_vault_reset_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.write_audit_log('vault.reset_requested', 'vault', NEW.id::text,
      jsonb_build_object('sent_to', NEW.sent_to, 'expires_at', NEW.expires_at), NEW.requested_by);
  ELSIF OLD.used_at IS NULL AND NEW.used_at IS NOT NULL THEN
    PERFORM public.write_audit_log('vault.reset_approved', 'vault', NEW.id::text,
      jsonb_build_object('sent_to', NEW.sent_to, 'attempts', NEW.attempts), NEW.requested_by);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS vault_reset_codes_audit ON public.vault_reset_codes;
CREATE TRIGGER vault_reset_codes_audit
  AFTER INSERT OR UPDATE OF used_at ON public.vault_reset_codes
  FOR EACH ROW EXECUTE FUNCTION public.audit_vault_reset_code();

-- vault-reset archives with the service role and sends no actor header, so
-- the actor is whoever's approved code was used in the last ten minutes.
CREATE OR REPLACE FUNCTION public.audit_vault_meta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.audit_actor();
BEGIN
  IF v_actor IS NULL THEN
    SELECT requested_by INTO v_actor
      FROM public.vault_reset_codes
     WHERE used_at > now() - interval '10 minutes'
     ORDER BY used_at DESC
     LIMIT 1;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.write_audit_log('vault.generation_deleted', 'vault', OLD.id::text,
      jsonb_build_object('archived_at', OLD.archived_at), v_actor);
  ELSIF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
    PERFORM public.write_audit_log('vault.archived', 'vault', NEW.id::text, '{}'::jsonb, v_actor);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS vault_meta_audit ON public.vault_meta;
CREATE TRIGGER vault_meta_audit
  AFTER UPDATE OF archived_at OR DELETE ON public.vault_meta
  FOR EACH ROW EXECUTE FUNCTION public.audit_vault_meta();

CREATE OR REPLACE FUNCTION public.audit_vault_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.owner_email IS DISTINCT FROM OLD.owner_email THEN
    PERFORM public.write_audit_log('vault.owner_changed', 'vault', 'settings',
      jsonb_build_object('from', OLD.owner_email, 'to', NEW.owner_email));
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS vault_settings_audit ON public.vault_settings;
CREATE TRIGGER vault_settings_audit
  AFTER UPDATE OF owner_email ON public.vault_settings
  FOR EACH ROW EXECUTE FUNCTION public.audit_vault_settings();

-- ---------- 7. Backstop: one active admin always remains ----------
-- admin-users counts admins before demoting, deactivating or deleting, but
-- two admins demoting each other at the same instant both pass that count.
-- Locking the admin rows serialises those transactions, so the second one
-- sees the first one's change and is refused.
CREATE OR REPLACE FUNCTION public.guard_last_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_others int;
BEGIN
  IF OLD.role <> 'admin' OR OLD.deactivated_at IS NOT NULL THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.role = 'admin' AND NEW.deactivated_at IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM 1 FROM public.profiles WHERE role = 'admin' FOR UPDATE;
  SELECT count(*) INTO v_others
    FROM public.profiles
   WHERE role = 'admin' AND deactivated_at IS NULL AND id <> OLD.id;

  IF v_others = 0 THEN
    RAISE EXCEPTION 'DeskDev needs at least one admin. Make someone else an admin first.'
      USING ERRCODE = '23514';
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_last_admin ON public.profiles;
CREATE TRIGGER profiles_guard_last_admin
  BEFORE UPDATE OF role, deactivated_at OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_last_admin();

-- Trigger functions are not RPCs.
REVOKE ALL ON FUNCTION public.stamp_profile_deactivation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.drop_push_on_deactivation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_profile_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_vault_reset_code() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_vault_meta() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_vault_settings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_last_admin() FROM PUBLIC, anon, authenticated;
