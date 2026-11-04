-- ============================================
-- DeskDev Studio — 042: Sign-up guard
--
-- Every account is created by an admin (DeskDev → Settings → Users, the
-- admin-users Edge Function). Whether a stranger could also make one has
-- depended on one dashboard switch (Authentication → "Allow new users to
-- sign up"), and on 2026-10-04 that switch was found on: POST /auth/v1/signup
-- with the public key created an auth.users row, and 001's trigger gave it a
-- member profile that showed in the staff directory, in New chat and in
-- mentions. The switch stays a required setting (docs/runbooks/AUTH.md §1).
-- This file is the second lock, in the database, so that a setting nobody
-- looks at cannot open the door again.
--
--   1. signup_allowlist   the addresses that may get an account in the next
--                         few minutes. Service role and operators only.
--   2. signup_guard()     BEFORE INSERT on auth.users. A new account passes
--                         when the address is on the allow-list (the entry is
--                         used up by it) or when an operator is typing the
--                         SQL. Everything else is refused.
--
-- Goes with the admin-users version that writes the allow-list entry
-- (functions/admin-users/signup_allowlist.ts). Apply this file, then deploy
-- the function. In between, "Add user" in DeskDev answers "Could not create
-- the user": the older function writes no entry and the guard refuses it.
-- Nothing is open in that window, and the refusal is the proof that the guard
-- sees GoTrue's session. The new function also runs against a database
-- without this file, so the other order works as well, without that proof.
-- The first admin of a new project: supabase/README.md, "First admin".
--
-- Emergency off, one statement, as postgres (it removes the trigger with the
-- function; auth.users itself belongs to supabase_auth_admin, so this does
-- not depend on being allowed to ALTER that table):
--     DROP FUNCTION public.signup_guard() CASCADE;
-- Back on: apply this file again.
--
-- Depends on 001 (profiles). Re-runnable.
-- ============================================

-- ---------- 0. Ledger order guard ----------
DO $$
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION '042 needs 001_profiles_roles.sql (profiles) applied first';
  END IF;
END $$;

-- ---------- 1. The allow-list ----------
-- A row says: this address may be given an account until expires_at. The
-- admin-users function writes it right before auth.admin.createUser and
-- removes it right after; an operator writes it by hand for the first admin
-- of a new project. Ten minutes is enough for "SQL editor, then Dashboard →
-- Add user" and short enough that a forgotten row stops mattering.
CREATE TABLE IF NOT EXISTS public.signup_allowlist (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stored as typed; compared as lower(btrim(email)), the way GoTrue stores
  -- addresses. Not unique: two admins adding the same person at once each
  -- get their own row and each remove their own.
  email      text NOT NULL CHECK (btrim(email) <> '' AND char_length(email) <= 255),
  invited_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  -- No standing invitations: an entry that never expires would be a sign-up
  -- form for that address.
  CONSTRAINT signup_allowlist_short_lived
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '1 hour')
);

CREATE INDEX IF NOT EXISTS signup_allowlist_email_idx
  ON public.signup_allowlist (lower(btrim(email)));

-- RLS on and no policy: nothing for anon or a signed-in user, whatever the
-- grants say. Supabase's default privileges hand the API roles ALL on a new
-- table, so the grants go too. The service role bypasses RLS and keeps the
-- three verbs the function uses (rows are never edited).
ALTER TABLE public.signup_allowlist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.signup_allowlist FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON public.signup_allowlist TO service_role;

-- ---------- 2. The guard ----------
-- Who is asking is read from session_user, the role the connection logged in
-- as. Inside a SECURITY DEFINER function current_user is the function's
-- owner, so it says nothing about the caller; session_user is not changed by
-- SECURITY DEFINER or by SET ROLE.
--
--   postgres, supabase_admin   an operator: the SQL editor, psql with the
--                              database password, a restore without replica
--                              mode. Passes.
--   anything else              has to be on the allow-list. That is GoTrue
--                              (supabase_auth_admin): sign-up, magic link,
--                              OAuth, invite, the admin API and the
--                              dashboard's "Add user" all insert through it.
--
-- The list names who is trusted, not who is refused, on purpose. If GoTrue
-- ever connects under another name the guard still applies to it; if an
-- operator tool connects under a name that is not listed, it gets the error
-- below and adds an allow-list row first. Both mistakes are visible. Naming
-- GoTrue instead would let everyone through the day that name is wrong.
-- What this still relies on: GoTrue does not log in as postgres or
-- supabase_admin. Read-only check on a project:
--   SELECT DISTINCT usename, application_name FROM pg_stat_activity;
-- The proof, once per project: supabase/README.md, "Prove the guard on the
-- project" (a dashboard "Add user" with no allow-list row must be refused).
--
-- scripts/backup/restore.mjs loads data with session_replication_role =
-- replica, where ordinary triggers do not fire: restores are not affected.
CREATE OR REPLACE FUNCTION public.signup_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text := lower(btrim(NEW.email));
  v_used  int;
BEGIN
  IF session_user IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  -- Phone-only and anonymous accounts have no address to match, and DeskDev
  -- uses neither.
  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'signup_guard: accounts need an email address and are created by an admin (DeskDev > Settings > Users)'
      USING ERRCODE = '42501';
  END IF;

  -- Single use: the entry goes in the same transaction as the account. If
  -- the insert fails later (duplicate address, a failing trigger) both come
  -- back, which is why admin-users removes its own row afterwards as well.
  DELETE FROM public.signup_allowlist a
   WHERE lower(btrim(a.email)) = v_email
     AND a.expires_at > now();
  GET DIAGNOSTICS v_used = ROW_COUNT;

  IF v_used = 0 THEN
    -- The address stays out of the message: it ends up in the auth and
    -- database logs.
    RAISE EXCEPTION 'signup_guard: sign-ups are closed; accounts are created by an admin (DeskDev > Settings > Users)'
      USING ERRCODE = '42501',
            HINT = 'An operator can allow one address for ten minutes: INSERT INTO public.signup_allowlist (email) VALUES (...)';
  END IF;

  -- Leftovers of creates that failed before reaching this trigger.
  DELETE FROM public.signup_allowlist WHERE expires_at <= now();

  RETURN NEW;
END;
$$;

-- A trigger function cannot be called directly, and the trigger fires
-- whatever the caller's EXECUTE rights are, so nobody needs a grant.
REVOKE ALL ON FUNCTION public.signup_guard() FROM PUBLIC, anon, authenticated, service_role;

-- Created only when missing, without DROP TRIGGER: dropping a trigger needs
-- ownership of auth.users, creating one needs only the TRIGGER privilege the
-- postgres role has (the same one 001's on_auth_user_created relies on).
-- CREATE OR REPLACE FUNCTION above is enough to update the logic.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'auth.users'::regclass AND tgname = 'signup_guard' AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER signup_guard
      BEFORE INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.signup_guard();
  END IF;
END $$;

-- Applying this file means "the guard is on". Say so if it is not.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'auth.users'::regclass AND tgname = 'signup_guard' AND tgenabled = 'D'
  ) THEN
    RAISE EXCEPTION '042: the signup_guard trigger exists but is disabled. Enable it: ALTER TABLE auth.users ENABLE TRIGGER signup_guard';
  END IF;
END $$;

-- admin-users reaches the table through PostgREST, which has to learn that
-- it exists before the next "Add user".
NOTIFY pgrst, 'reload schema';
