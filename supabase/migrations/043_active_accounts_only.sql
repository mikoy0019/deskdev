-- ============================================
-- DeskDev Studio — 043: active accounts only, channel creators, old grants
--
-- What supabase/tests/rls.test.mjs found when it tried every table as every
-- kind of caller (gate layer 8):
--
--   A. 032 takes a deactivated account's rights away inside is_admin() and
--      has_perm(). Policies that ask neither never noticed: with a token
--      issued before the deactivation (GoTrue's ban only stops the refresh,
--      so up to the token lifetime) the account still read every profile,
--      workspace_settings, the studio channels and its own conversations and
--      notifications, could post, create channels and conversations, notify
--      others and rename itself. It could also register a device for push
--      again, and send-push kept delivering to it after the token was dead.
--      A signed-in account with no profile row had the same reach.
--   B. channels_update / channels_delete only asked created_by = auth.uid().
--      The creator of a private channel that an admin took out of member_ids
--      could put itself back with one UPDATE (no WHERE, so the SELECT policy
--      was not asked).
--   C. Supabase's default privileges: anon held every table privilege on the
--      34 tables of 001-026 (RLS returned it nothing) and EXECUTE on 26
--      helper and trigger functions; anon and authenticated held TRUNCATE,
--      which RLS does not guard.
--
--   1. is_active()               the caller has a profile and it is not deactivated
--   2. "active_account_only"     one RESTRICTIVE policy on every table that has
--                                a policy for authenticated: no active profile,
--                                no row, whatever the other policies say
--   3. upsert_push_subscription  refuses a caller that is not active; rows
--                                such an account registered already are removed
--   4. channels                  managing a private channel needs membership
--   5. grants                    anon keeps showcase_items' column grants and
--                                its three functions (five once 047's form
--                                links exist), nothing else; TRUNCATE,
--                                REFERENCES and TRIGGER leave the API roles
--   6. the result is checked, and the file fails if it is not what 5 says
--
-- What was looked at and left alone:
--   * service_role and the table owner bypass RLS: Edge Functions, cron jobs,
--     SECURITY DEFINER functions and the triggers that write on a user's
--     behalf (notifications, audit, bump_*, showcase_on_project, the Google
--     outbox) are not touched by 2. No table has FORCE ROW LEVEL SECURITY.
--   * Realtime evaluates the same policies with the subscriber's JWT, so a
--     deactivated account's open socket stops receiving rows at once.
--   * showcase_items_public_read is TO anon and 2 is TO authenticated: the
--     public site reads exactly what it read before.
--   * SECURITY DEFINER functions a signed-in account may call. They run as
--     the owner, so 2 does not reach them; each was read for what it does for
--     a caller that is not active:
--       upsert_push_subscription   wrote a row: closed in 3
--       convert_lead, calendar_feed_rotate, google_workspace_status,
--       google_calendar_retry_failed, vault_has_active_meta, can_edit_event
--                                  ask has_perm() / is_admin(): already refuse
--       delete_push_subscription, calendar_feed_revoke
--                                  only remove the caller's own rows: wanted
--       calendar_feed_status       the caller's own feed row (hint and dates)
--       calendar_feed              a token, and user_has_perm() of its owner
--       google_calendar_default_tz the workspace time zone
--       is_conversation_participant, can_see_space, can_view_channel,
--       can_post_channel           answer yes or no about an id the caller
--                                  already knows; every table they guard
--                                  refuses the caller through 2
--
-- Order on a project: this file, then deploy send-push (it skips deactivated
-- recipients). Either order is safe; see supabase/README.md, "Account
-- lockout".
--
-- Emergency off for 2 (signed-in people read nothing and the cause is this
-- file), as postgres. It removes the policies and nothing else:
--     DO $$ DECLARE r record; BEGIN
--       FOR r IN SELECT tablename FROM pg_policies
--                 WHERE schemaname = 'public' AND policyname = 'active_account_only' LOOP
--         EXECUTE format('DROP POLICY "active_account_only" ON public.%I', r.tablename);
--       END LOOP;
--     END $$;
-- Back on: apply this file again.
--
-- Depends on 032 (deactivated_at), 033 (the push function it replaces), 030
-- (can_view_channel) and 034 / 039 / 040 (the three anon functions).
-- Re-runnable.
-- ============================================

-- CREATE POLICY and REVOKE take a short exclusive lock on each table. If
-- something holds one of them, give up and change nothing rather than queue
-- every request to that table behind this file.
SET LOCAL lock_timeout = '5s';

-- ---------- 0. Ledger order guard ----------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'deactivated_at'
  ) THEN
    RAISE EXCEPTION '043 needs 032_account_lifecycle.sql (profiles.deactivated_at) applied first';
  END IF;
  IF to_regprocedure('public.upsert_push_subscription(text,text,text,text,jsonb,text,text)') IS NULL
     OR to_regprocedure('public.can_view_channel(uuid)') IS NULL
     OR to_regprocedure('public.intake_site_lead(text,jsonb)') IS NULL
     OR to_regprocedure('public.intake_subscriber(text,jsonb)') IS NULL
     OR to_regprocedure('public.calendar_feed(text)') IS NULL THEN
    RAISE EXCEPTION '043 needs 001 to 042 applied first (a function it replaces or keeps for anon is missing)';
  END IF;
END $$;

-- ---------- 1. is_active() ----------
-- "Signed in" is a valid token; "active" is a profile that exists and is not
-- deactivated. SECURITY DEFINER for the same reason as is_admin(): it is
-- called from the policies of profiles itself.
CREATE OR REPLACE FUNCTION public.is_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = auth.uid() AND deactivated_at IS NULL
  );
$$;

REVOKE ALL ON FUNCTION public.is_active() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active() TO authenticated, service_role;

-- ---------- 2. No active profile, no row ----------
-- RESTRICTIVE: it is ANDed with whatever the permissive policies allow, so
-- it can only take away. FOR ALL covers reads (USING) and writes (WITH
-- CHECK). The call sits in a scalar sub-select so the planner runs it once
-- per statement (an InitPlan), not once per row.
-- The tables come from the catalog, so none is forgotten: every table in
-- public with a permissive policy that applies to authenticated (or to
-- PUBLIC, which includes it). A table with no such policy gives a signed-in
-- account nothing to begin with. Later migrations add the policy to the
-- tables they create (the test suite fails until they do), or re-run this
-- block.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND EXISTS (
         SELECT 1 FROM pg_policy p
          WHERE p.polrelid = c.oid
            AND p.polpermissive
            AND ('authenticated'::regrole::oid = ANY (p.polroles) OR 0 = ANY (p.polroles))
       )
     ORDER BY c.relname
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "active_account_only" ON public.%I', t.relname);
    EXECUTE format(
      'CREATE POLICY "active_account_only" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      || 'USING ((SELECT public.is_active())) WITH CHECK ((SELECT public.is_active()))',
      t.relname
    );
  END LOOP;
END $$;

-- ---------- 3. Push: only an active account registers a device ----------
-- 033's function with one more check. It is SECURITY DEFINER and writes the
-- row itself, so the policies of 2 do not apply to it: a deactivated account
-- could register a device again after 032's trigger had removed its rows.
CREATE OR REPLACE FUNCTION public.upsert_push_subscription(
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
  p_app_base   text,
  p_categories jsonb DEFAULT NULL,
  p_platform   text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_endpoint text := trim(coalesce(p_endpoint, ''));
  v_p256dh   text := translate(rtrim(trim(coalesce(p_p256dh, '')), '='), '+/', '-_');
  v_auth     text := translate(rtrim(trim(coalesce(p_auth, '')), '='), '+/', '-_');
  v_base     text := rtrim(trim(coalesce(p_app_base, '')), '/');
  v_defaults jsonb := '{"mentions":true,"messages":true,"tasks":true,"reminders":true,"workspace":false,"leads":true}'::jsonb;
  v_given    jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to turn on push notifications' USING ERRCODE = '42501';
  END IF;

  -- Deactivated, or an account with no profile: nothing to notify it about.
  IF NOT public.is_active() THEN
    RAISE EXCEPTION 'This account is not active' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_push_service_endpoint(v_endpoint) THEN
    RAISE EXCEPTION 'This browser''s push service is not supported' USING ERRCODE = '22023';
  END IF;

  -- 65-byte P-256 point → 87 chars; 16-byte auth secret → 22 chars.
  IF v_p256dh !~ '^[A-Za-z0-9_-]{87}$' OR v_auth !~ '^[A-Za-z0-9_-]{22}$' THEN
    RAISE EXCEPTION 'Invalid push subscription keys' USING ERRCODE = '22023';
  END IF;

  -- https everywhere; plain http only for a local dev host.
  IF length(v_base) > 512
     OR NOT (
       v_base ~* '^https://[a-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~%-]+)*$'
       OR v_base ~* '^http://(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.localhost)(:[0-9]{1,5})?(/[A-Za-z0-9._~%-]+)*$'
     ) THEN
    RAISE EXCEPTION 'Invalid app base URL' USING ERRCODE = '22023';
  END IF;

  -- Keep only known category keys with boolean values; the rest default.
  IF p_categories IS NOT NULL THEN
    SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
      INTO v_given
      FROM jsonb_each(CASE WHEN jsonb_typeof(p_categories) = 'object' THEN p_categories ELSE '{}'::jsonb END) AS e
     WHERE e.key IN ('mentions', 'messages', 'tasks', 'reminders', 'workspace', 'leads')
       AND jsonb_typeof(e.value) = 'boolean';
  END IF;

  INSERT INTO public.push_subscriptions AS s
    (user_id, endpoint, p256dh, auth, app_base, categories, platform, user_agent)
  VALUES
    (v_uid, v_endpoint, v_p256dh, v_auth, v_base, v_defaults || coalesce(v_given, '{}'::jsonb),
     left(nullif(trim(p_platform), ''), 32), left(nullif(trim(p_user_agent), ''), 512))
  ON CONFLICT (endpoint) DO UPDATE
    SET user_id       = EXCLUDED.user_id,
        p256dh        = EXCLUDED.p256dh,
        auth          = EXCLUDED.auth,
        app_base      = EXCLUDED.app_base,
        categories    = CASE
                          WHEN v_given IS NULL AND s.user_id = EXCLUDED.user_id THEN s.categories
                          ELSE EXCLUDED.categories
                        END,
        platform      = EXCLUDED.platform,
        user_agent    = EXCLUDED.user_agent,
        failure_count = 0,
        updated_at    = now();

  -- A person rarely has more than a handful of installs; cap the rows so a
  -- re-subscribe loop cannot grow the table without bound.
  DELETE FROM public.push_subscriptions
   WHERE user_id = v_uid
     AND id NOT IN (
       SELECT id FROM public.push_subscriptions
        WHERE user_id = v_uid
        ORDER BY updated_at DESC
        LIMIT 20
     );
END;
$$;

-- Devices a deactivated account registered through the old function. 032's
-- trigger removes a person's rows at the moment of deactivation; these came
-- after it.
DELETE FROM public.push_subscriptions s
 USING public.profiles p
 WHERE p.id = s.user_id
   AND p.deactivated_at IS NOT NULL;

-- ---------- 4. Channels: the creator of a private channel must be in it ----------
-- "The creator is always a member" (023) is checked when the channel is
-- made. An admin can take the creator out afterwards, and from then on the
-- creator reads nothing of it; it must not manage it either. The clause is
-- the one channels_select uses. WITH CHECK is 030's, unchanged: it judges
-- the new row, and leaving your own channel stays possible.
DROP POLICY IF EXISTS "channels_update" ON public.channels;
CREATE POLICY "channels_update"
  ON public.channels FOR UPDATE TO authenticated
  USING (
    (created_by = auth.uid() OR public.is_admin())
    AND public.can_see_space(client_id)
    AND (NOT is_private OR auth.uid() = ANY (member_ids) OR public.is_admin())
  )
  WITH CHECK ((created_by = auth.uid() OR public.is_admin()) AND public.can_see_space(client_id));

DROP POLICY IF EXISTS "channels_delete" ON public.channels;
CREATE POLICY "channels_delete"
  ON public.channels FOR DELETE TO authenticated
  USING (
    (created_by = auth.uid() OR public.is_admin())
    AND public.can_see_space(client_id)
    AND (NOT is_private OR auth.uid() = ANY (member_ids) OR public.is_admin())
  );

-- The same rule for what a manager may do inside the channel (edit and
-- delete other people's messages, post in an announcement channel): a
-- creator who can no longer view the channel no longer manages it.
-- can_view_channel() (030) also holds the client-space rule.
CREATE OR REPLACE FUNCTION public.can_manage_channel(ch uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin() OR (
    public.can_view_channel(ch)
    AND EXISTS (
      SELECT 1 FROM public.channels c WHERE c.id = ch AND c.created_by = auth.uid()
    )
  );
$$;

-- ---------- 5. Grants: what Supabase's defaults left open ----------
-- Every object postgres creates in public is granted to anon, authenticated
-- and service_role, and functions to PUBLIC as well. Later migrations revoke
-- on what they create; the objects of 001-029 never were. The lists are read
-- from the catalog so an object is not forgotten. Members of an extension
-- are not ours and are skipped. service_role is never touched, and nothing
-- here grants a right that was not held before.
DO $$
DECLARE
  r record;
  -- MAINTAIN (VACUUM, REINDEX, LOCK TABLE ...) is a table privilege from
  -- Postgres 17 on and part of the default ALL; older servers do not parse it.
  v_has_maintain boolean := current_setting('server_version_num')::int >= 170000;
BEGIN
  -- Tables and views.
  FOR r IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p', 'v', 'm')
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
       )
     ORDER BY c.relname
  LOOP
    -- showcase_items is the one table the public site reads with the anon
    -- key, through the column grants of 037. A table-level REVOKE would take
    -- those column grants with it, so it is left out by name; 037 already
    -- took anon's table-level grant away.
    IF r.relname <> 'showcase_items' THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', r.relname);
    END IF;
    -- RLS does not guard TRUNCATE, and no client has a use for REFERENCES
    -- or TRIGGER. On showcase_items too: none of the three is a column grant
    -- anon holds.
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM anon, authenticated', r.relname);
    IF v_has_maintain THEN
      EXECUTE format('REVOKE MAINTAIN ON public.%I FROM anon, authenticated', r.relname);
    END IF;
  END LOOP;

  -- Sequences: anon inserts nowhere.
  FOR r IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'S'
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
       )
     ORDER BY c.relname
  LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM anon', r.relname);
  END LOOP;

  -- Functions.
  FOR r IN
    SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS signature,
           p.prorettype IN ('trigger'::regtype, 'event_trigger'::regtype) AS is_trigger,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_may,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_may,
           has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_may
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       -- The functions anon must keep. Each checks a secret or a token
       -- itself (034, 039, 040; 047's two form-link doors once 047 exists,
       -- so applying this file again later keeps them too). array_remove
       -- drops a door that does not exist yet: a NULL in the list would
       -- make the comparison NULL and skip every function.
       AND p.oid <> ALL (array_remove(ARRAY[
         'public.intake_site_lead(text,jsonb)'::regprocedure::oid,
         'public.intake_subscriber(text,jsonb)'::regprocedure::oid,
         'public.calendar_feed(text)'::regprocedure::oid,
         to_regprocedure('public.form_link_read(text,text)')::oid,
         to_regprocedure('public.form_link_submit(text,text,jsonb,text)')::oid
       ], NULL))
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
       )
     ORDER BY 1
  LOOP
    IF r.is_trigger THEN
      -- A trigger fires whatever the caller's EXECUTE rights are, and
      -- Postgres refuses to call a trigger function directly: nobody needs
      -- the grant (032 onwards revoke it the same way).
      EXECUTE format('REVOKE ALL ON ROUTINE %s FROM PUBLIC, anon, authenticated', r.signature);
    ELSIF r.anon_may THEN
      -- The helpers of 001-029 (is_admin, has_perm, can_view_channel ...).
      -- Policies call them as the signed-in user, so authenticated keeps
      -- EXECUTE; PUBLIC goes, and with it anon. The two roles get back only
      -- what they could do a moment ago.
      EXECUTE format('REVOKE ALL ON ROUTINE %s FROM PUBLIC, anon', r.signature);
      IF r.authenticated_may THEN
        EXECUTE format('GRANT EXECUTE ON ROUTINE %s TO authenticated', r.signature);
      END IF;
      IF r.service_role_may THEN
        EXECUTE format('GRANT EXECUTE ON ROUTINE %s TO service_role', r.signature);
      END IF;
    END IF;
  END LOOP;
END $$;

-- ---------- 6. Applying this file means "it is closed". Say so if it is not ----------
-- A REVOKE on an object that belongs to another role only warns. A warning
-- in the SQL editor is easy to miss, so what is left is turned into an
-- error and the whole file rolls back. Fix: revoke by hand as the object's
-- owner (or move it out of public), then apply the file again.
DO $$
DECLARE
  v_left text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_left
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p')
     AND EXISTS (
       SELECT 1 FROM pg_policy p
        WHERE p.polrelid = c.oid AND p.polpermissive
          AND ('authenticated'::regrole::oid = ANY (p.polroles) OR 0 = ANY (p.polroles))
     )
     AND NOT EXISTS (
       SELECT 1 FROM pg_policy p
        WHERE p.polrelid = c.oid AND p.polname = 'active_account_only' AND NOT p.polpermissive
     );
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION '043: no active_account_only policy on: %', v_left;
  END IF;

  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_left
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p', 'v', 'm')
     AND NOT EXISTS (
       SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
     )
     AND (
       has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       OR has_table_privilege('authenticated', c.oid, 'TRUNCATE, REFERENCES, TRIGGER')
       OR has_any_column_privilege('anon', c.oid, 'INSERT, UPDATE, REFERENCES')
       OR (c.relname <> 'showcase_items' AND has_any_column_privilege('anon', c.oid, 'SELECT'))
     );
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION '043: anon or authenticated still hold a table privilege they should not on: %', v_left;
  END IF;

  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO v_left
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND has_function_privilege('anon', p.oid, 'EXECUTE')
     AND p.oid <> ALL (array_remove(ARRAY[
       'public.intake_site_lead(text,jsonb)'::regprocedure::oid,
       'public.intake_subscriber(text,jsonb)'::regprocedure::oid,
       'public.calendar_feed(text)'::regprocedure::oid,
       to_regprocedure('public.form_link_read(text,text)')::oid,
       to_regprocedure('public.form_link_submit(text,text,jsonb,text)')::oid
     ], NULL))
     AND NOT EXISTS (
       SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
     );
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION '043: anon can still execute: %', v_left;
  END IF;
END $$;

-- DeskDev asks is_active() through PostgREST, which has to learn that it
-- exists.
NOTIFY pgrst, 'reload schema';
