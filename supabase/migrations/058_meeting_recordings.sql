-- 058: Meeting Recordings (revision 8). A recording is a link to where the
-- video lives (YouTube, Vimeo, Loom, Drive, a file; any https link is kept,
-- the embeddable ones play in DeskDev). Recordings are filed by client: each
-- of the client's projects is a folder of its own (no row needed), and
-- recording_folders adds the client's own categories.
--
-- Access follows Meetings: meetings:view reads, meetings:edit writes. A
-- deleted client takes its categories with it and leaves its recordings
-- unfiled; a deleted project or category leaves them in the client.
-- Re-runnable.

BEGIN;

-- ---------- 1. Tables ----------

CREATE TABLE IF NOT EXISTS public.recording_folders (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recording_folders_client_idx ON public.recording_folders(client_id);

CREATE TABLE IF NOT EXISTS public.meeting_recordings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  project_id    uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  folder_id     uuid REFERENCES public.recording_folders(id) ON DELETE SET NULL,
  title         text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  url           text NOT NULL CHECK (url ~* '^https://[^[:space:]]+$' AND length(url) <= 2000),
  thumbnail_url text CHECK (thumbnail_url IS NULL OR (thumbnail_url ~* '^https://[^[:space:]]+$' AND length(thumbnail_url) <= 2000)),
  recorded_on   date,
  notes         text CHECK (notes IS NULL OR length(notes) <= 10000),
  created_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meeting_recordings_client_idx ON public.meeting_recordings(client_id);
CREATE INDEX IF NOT EXISTS meeting_recordings_project_idx ON public.meeting_recordings(project_id);
CREATE INDEX IF NOT EXISTS meeting_recordings_folder_idx ON public.meeting_recordings(folder_id);

-- ---------- 2. Keep the filing consistent ----------
-- A project's recording belongs to the project's client; a category only
-- holds its own client's recordings.

CREATE OR REPLACE FUNCTION public.meeting_recordings_file()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE folder_client uuid;
BEGIN
  IF NEW.project_id IS NOT NULL THEN
    SELECT client_id INTO NEW.client_id FROM public.projects WHERE id = NEW.project_id;
  END IF;
  IF NEW.folder_id IS NOT NULL THEN
    SELECT client_id INTO folder_client FROM public.recording_folders WHERE id = NEW.folder_id;
    IF folder_client IS DISTINCT FROM NEW.client_id THEN NEW.folder_id := NULL; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.meeting_recordings_file() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS meeting_recordings_file ON public.meeting_recordings;
CREATE TRIGGER meeting_recordings_file
  BEFORE INSERT OR UPDATE OF client_id, project_id, folder_id ON public.meeting_recordings
  FOR EACH ROW EXECUTE FUNCTION public.meeting_recordings_file();

DROP TRIGGER IF EXISTS recording_folders_set_updated_at ON public.recording_folders;
CREATE TRIGGER recording_folders_set_updated_at
  BEFORE UPDATE ON public.recording_folders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS meeting_recordings_set_updated_at ON public.meeting_recordings;
CREATE TRIGGER meeting_recordings_set_updated_at
  BEFORE UPDATE ON public.meeting_recordings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- 3. Row-level security ----------

ALTER TABLE public.recording_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_recordings ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['recording_folders', 'meeting_recordings'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.has_perm(''meetings'', ''view''))', t || '_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.has_perm(''meetings'', ''edit'') AND (created_by = auth.uid() OR created_by IS NULL))', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.has_perm(''meetings'', ''edit'')) WITH CHECK (public.has_perm(''meetings'', ''edit''))', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.has_perm(''meetings'', ''edit''))', t || '_delete', t);
    -- 043's rule for every table a signed-in account can reach: no active profile, no row.
    EXECUTE format('DROP POLICY IF EXISTS "active_account_only" ON public.%I', t);
    EXECUTE format('CREATE POLICY "active_account_only" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.is_active())) WITH CHECK ((SELECT public.is_active()))', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- ---------- 4. Realtime ----------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['recording_folders', 'meeting_recordings'] LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND NOT EXISTS (
         SELECT 1 FROM pg_publication_tables
          WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
       ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

COMMIT;
