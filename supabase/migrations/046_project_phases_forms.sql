-- ============================================
-- DeskDev Studio — 046: project phases + form responses
--
--   projects.phase             onboarding → development → launched
--   projects.phase_changed_at  stamped by the server whenever the phase moves
--   stamp_project_phase()      BEFORE INSERT OR UPDATE OF phase on projects
--   form_responses             answers to an app-defined form (template key +
--                              version), anchored to a project, a lead or a
--                              client. Phase 2 stores the 'onboarding' form per
--                              project; the lead-meeting forms and customer
--                              quick-form links of phase 3 reuse the table.
--   can_access_form_response() the RLS rule: the most specific anchor decides
--   guard_form_response()      created_by and the submitted stamps are the
--                              server's, never the client's
--
-- How a project moves (the app drives it; nothing here notifies anyone):
--   - New rows start in 'onboarding' through the column default: manual
--     inserts, and convert_lead (036), whose INSERT names no phase column.
--   - "Proceed to development" sets phase = 'development'.
--   - "Development done" sets phase = 'launched', status = 'done' and live_url
--     in one UPDATE. That UPDATE names status and live_url, so 037's
--     projects_showcase_on_done trigger (AFTER INSERT OR UPDATE OF status,
--     live_url) fires and drafts the portfolio item as before.
--
-- Existing projects are not pushed back into onboarding: they backfill to
-- 'launched' when done, else 'development', once (rows that already have a
-- phase are never touched again).
--
-- Runs after 043 (active accounts only): form_responses is created after
-- 043's catalog sweep, so it gets 043's restrictive "active_account_only"
-- policy here, and its grants are revoked here the way 043 does for older
-- tables (nothing for anon; no TRUNCATE, REFERENCES, TRIGGER or MAINTAIN).
--
-- Depends on 001 (set_updated_at, is_admin, has_perm; 032 redefines the last
-- two with the same signatures), 003 (projects), 012 (leads), 043
-- (is_active). Re-runnable: IF NOT EXISTS / OR REPLACE / DROP … IF EXISTS
-- throughout.
-- ============================================

DO $$
BEGIN
  IF to_regprocedure('public.is_active()') IS NULL THEN
    RAISE EXCEPTION '046 needs 043_active_accounts_only.sql (is_active) applied first';
  END IF;
END $$;

-- ---------- 1. projects.phase ----------
-- Added nullable first so the backfill can tell "not yet decided" (NULL) from
-- a real phase; the default, NOT NULL and CHECK come after it.
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS phase text;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS phase_changed_at timestamptz;

-- The backfill is a one-off data move, not an edit: the updated_at trigger is
-- held for its duration so every project doesn't read "updated today". Inside
-- one DO block, so a failure rolls the DISABLE back with the UPDATE. Only
-- projects_set_updated_at (003) fires on this UPDATE otherwise: 037's
-- showcase trigger watches status and live_url, which are not touched.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.projects WHERE phase IS NULL) THEN
    ALTER TABLE public.projects DISABLE TRIGGER projects_set_updated_at;
    UPDATE public.projects
       SET phase            = CASE WHEN status = 'done' THEN 'launched' ELSE 'development' END,
           phase_changed_at = coalesce(phase_changed_at, updated_at, created_at, now())
     WHERE phase IS NULL;
    ALTER TABLE public.projects ENABLE TRIGGER projects_set_updated_at;
  END IF;
END;
$$;

ALTER TABLE public.projects ALTER COLUMN phase SET DEFAULT 'onboarding';
ALTER TABLE public.projects ALTER COLUMN phase SET NOT NULL;
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_phase_check;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_phase_check CHECK (phase IN ('onboarding', 'development', 'launched'));

CREATE INDEX IF NOT EXISTS projects_phase_idx ON public.projects (phase);

-- phase_changed_at is the server's: now() on insert, now() when the phase
-- actually moves, and otherwise whatever it was (a client can't backdate it).
CREATE OR REPLACE FUNCTION public.stamp_project_phase()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.phase_changed_at := now();
  ELSIF NEW.phase IS DISTINCT FROM OLD.phase THEN
    NEW.phase_changed_at := now();
  ELSE
    NEW.phase_changed_at := OLD.phase_changed_at;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_project_phase() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS projects_stamp_phase ON public.projects;
CREATE TRIGGER projects_stamp_phase
  BEFORE INSERT OR UPDATE OF phase, phase_changed_at ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.stamp_project_phase();

-- ---------- 2. form_responses ----------
-- The form definitions live in the app (site/src/deskdev); a row stores which
-- template (`form`) and which revision of it (`version`) the answers were
-- given against, so an older response still reads correctly after the form
-- changes. One response per form per project; one per form per lead for
-- forms filled before a project exists.
CREATE TABLE IF NOT EXISTS public.form_responses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form          text NOT NULL CHECK (form ~ '^[a-z0-9_]{1,40}$'),
  version       integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  project_id    uuid REFERENCES public.projects (id) ON DELETE CASCADE,
  client_id     uuid REFERENCES public.clients (id) ON DELETE SET NULL,
  lead_id       uuid REFERENCES public.leads (id) ON DELETE CASCADE,
  answers       jsonb NOT NULL DEFAULT '{}'::jsonb
                  CHECK (jsonb_typeof(answers) = 'object' AND octet_length(answers::text) < 65536),
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  submitted_at  timestamptz,
  submitted_by  uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_by    uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT form_responses_anchor_check
    CHECK (project_id IS NOT NULL OR client_id IS NOT NULL OR lead_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS form_responses_form_project_key
  ON public.form_responses (form, project_id) WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS form_responses_form_lead_key
  ON public.form_responses (form, lead_id) WHERE lead_id IS NOT NULL AND project_id IS NULL;
CREATE INDEX IF NOT EXISTS form_responses_project_idx
  ON public.form_responses (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS form_responses_lead_idx
  ON public.form_responses (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS form_responses_client_idx
  ON public.form_responses (client_id) WHERE client_id IS NOT NULL;

DROP TRIGGER IF EXISTS form_responses_set_updated_at ON public.form_responses;
CREATE TRIGGER form_responses_set_updated_at
  BEFORE UPDATE ON public.form_responses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Who may read or write a response: the most specific anchor decides. A
-- project's onboarding answers (scope, budget) follow projects access even
-- though the row also names the client; a lead's meeting form follows growth;
-- a client-only form follows clients. Ordered, not OR'd: with OR, clients:edit
-- alone could write answers onto a project its holder cannot edit.
-- Plain SQL, not SECURITY DEFINER: it reads no table, and has_perm (001/032)
-- already is.
CREATE OR REPLACE FUNCTION public.can_access_form_response(
  p_project uuid, p_lead uuid, p_client uuid, p_level text
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_project IS NOT NULL THEN public.has_perm('projects', p_level)
    WHEN p_lead    IS NOT NULL THEN public.has_perm('growth', p_level)
    WHEN p_client  IS NOT NULL THEN public.has_perm('clients', p_level)
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION public.can_access_form_response(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_form_response(uuid, uuid, uuid, text) TO authenticated, service_role;

ALTER TABLE public.form_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "form_responses_select" ON public.form_responses;
CREATE POLICY "form_responses_select"
  ON public.form_responses FOR SELECT TO authenticated
  USING (public.can_access_form_response(project_id, lead_id, client_id, 'view'));

DROP POLICY IF EXISTS "form_responses_insert" ON public.form_responses;
CREATE POLICY "form_responses_insert"
  ON public.form_responses FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access_form_response(project_id, lead_id, client_id, 'edit')
    AND (created_by = auth.uid() OR created_by IS NULL)
  );

DROP POLICY IF EXISTS "form_responses_update" ON public.form_responses;
CREATE POLICY "form_responses_update"
  ON public.form_responses FOR UPDATE TO authenticated
  USING (public.can_access_form_response(project_id, lead_id, client_id, 'edit'))
  WITH CHECK (public.can_access_form_response(project_id, lead_id, client_id, 'edit'));

DROP POLICY IF EXISTS "form_responses_delete" ON public.form_responses;
CREATE POLICY "form_responses_delete"
  ON public.form_responses FOR DELETE TO authenticated
  USING (public.is_admin() OR public.can_access_form_response(project_id, lead_id, client_id, 'edit'));

-- 043's rule for every table a signed-in account can reach: no active
-- profile (deactivated, or none at all), no row, whatever the policies above
-- say. The same shape as 043 section 2.
DROP POLICY IF EXISTS "active_account_only" ON public.form_responses;
CREATE POLICY "active_account_only"
  ON public.form_responses AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_active())) WITH CHECK ((SELECT public.is_active()));

-- No anon access at all. Phase 3's customer quick-form link will reach a
-- single response through a SECURITY DEFINER RPC keyed by a hashed token,
-- never through table grants. authenticated gets back only the four
-- statements RLS guards (043 section 5).
REVOKE ALL ON public.form_responses FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.form_responses TO authenticated;
GRANT ALL ON public.form_responses TO service_role;

-- created_by and the submitted stamps are the server's for client roles
-- (037's guard pattern: current_user is 'authenticated' for a signed-in
-- caller; SECURITY DEFINER code, cron and the service role pass through).
--   draft → submitted   submitted_at = now(), submitted_by = auth.uid()
--   submitted → draft   both cleared (reopened for editing)
--   submitted, edited   both kept as they were
-- The template key can't change under existing answers either.
CREATE OR REPLACE FUNCTION public.guard_form_response()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_client boolean := current_user IN ('authenticated', 'anon');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_client THEN
      NEW.created_by := auth.uid();
      NEW.created_at := now();
    END IF;
    IF NEW.status = 'submitted' THEN
      IF v_client OR NEW.submitted_at IS NULL THEN
        NEW.submitted_at := now();
      END IF;
      IF v_client OR NEW.submitted_by IS NULL THEN
        NEW.submitted_by := auth.uid();
      END IF;
    ELSE
      NEW.submitted_at := NULL;
      NEW.submitted_by := NULL;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  NEW.form := OLD.form;
  IF v_client THEN
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;
  IF NEW.status = 'draft' THEN
    NEW.submitted_at := NULL;
    NEW.submitted_by := NULL;
  ELSIF OLD.status <> 'submitted' THEN
    -- draft → submitted
    IF v_client OR NEW.submitted_at IS NULL THEN
      NEW.submitted_at := now();
    END IF;
    IF v_client OR NEW.submitted_by IS NULL THEN
      NEW.submitted_by := auth.uid();
    END IF;
  ELSIF v_client THEN
    NEW.submitted_at := OLD.submitted_at;
    NEW.submitted_by := OLD.submitted_by;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_form_response() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS form_responses_guard ON public.form_responses;
CREATE TRIGGER form_responses_guard
  BEFORE INSERT OR UPDATE ON public.form_responses
  FOR EACH ROW EXECUTE FUNCTION public.guard_form_response();

-- ---------- 3. Realtime ----------
-- Answers sync live between two people on the same project, like the rest of
-- the app (007). FULL so a DELETE carries the anchors RLS needs.
DO $$
BEGIN
  ALTER TABLE public.form_responses REPLICA IDENTITY FULL;
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'form_responses'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.form_responses;
  END IF;
END;
$$;
