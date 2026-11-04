-- 059: Whiteboard (revision 9). Drawings made with the Excalidraw editor,
-- kept in folders. A board's scene (elements, files, a little view state) is
-- one jsonb document; the list reads everything but it. `version` goes up on
-- every save, so a save made on top of someone else's newer one is refused
-- (the app asks to reload) instead of silently replacing it.
--
-- The team's shared space: every active signed-in account can open, draw on
-- and file boards; only the person who made a board or folder, or an admin,
-- deletes it. A deleted folder leaves its boards unfiled. Re-runnable.

BEGIN;

-- ---------- 1. Tables ----------

CREATE TABLE IF NOT EXISTS public.whiteboard_folders (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.whiteboards (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id  uuid REFERENCES public.whiteboard_folders(id) ON DELETE SET NULL,
  title      text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  scene      jsonb NOT NULL DEFAULT '{"elements": []}'::jsonb
               CHECK (jsonb_typeof(scene) = 'object' AND octet_length(scene::text) <= 5242880),
  version    integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whiteboards_folder_idx ON public.whiteboards(folder_id);

-- ---------- 2. Who saved last, and the version ----------

CREATE OR REPLACE FUNCTION public.whiteboards_stamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_by := coalesce(auth.uid(), NEW.updated_by);
  IF TG_OP = 'UPDATE' AND NEW.scene IS DISTINCT FROM OLD.scene THEN
    NEW.version := OLD.version + 1;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.version := OLD.version;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.whiteboards_stamp() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS whiteboards_stamp ON public.whiteboards;
CREATE TRIGGER whiteboards_stamp
  BEFORE INSERT OR UPDATE ON public.whiteboards
  FOR EACH ROW EXECUTE FUNCTION public.whiteboards_stamp();

DROP TRIGGER IF EXISTS whiteboards_set_updated_at ON public.whiteboards;
CREATE TRIGGER whiteboards_set_updated_at
  BEFORE UPDATE ON public.whiteboards
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS whiteboard_folders_set_updated_at ON public.whiteboard_folders;
CREATE TRIGGER whiteboard_folders_set_updated_at
  BEFORE UPDATE ON public.whiteboard_folders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- 3. Row-level security ----------

ALTER TABLE public.whiteboard_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whiteboards ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['whiteboard_folders', 'whiteboards'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', t || '_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid() OR created_by IS NULL)', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (created_by = auth.uid() OR public.is_admin())', t || '_delete', t);
    -- 043's rule for every table a signed-in account can reach: no active profile, no row.
    EXECUTE format('DROP POLICY IF EXISTS "active_account_only" ON public.%I', t);
    EXECUTE format('CREATE POLICY "active_account_only" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.is_active())) WITH CHECK ((SELECT public.is_active()))', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- created_by is the maker's to keep: nobody rewrites who made a board.
REVOKE UPDATE ON public.whiteboards FROM authenticated;
GRANT UPDATE (folder_id, title, scene) ON public.whiteboards TO authenticated;
REVOKE UPDATE ON public.whiteboard_folders FROM authenticated;
GRANT UPDATE (name) ON public.whiteboard_folders TO authenticated;

COMMIT;
