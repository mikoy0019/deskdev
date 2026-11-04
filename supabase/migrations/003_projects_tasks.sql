-- ============================================
-- DeskDev Studio — 003: Project Categories, Projects, Tasks,
--                        Task Activity, Time Entries
-- Features: 'projects' (project_categories, projects)
--           'tasks'    (tasks, task_activity, time_entries)
-- ============================================

-- ---------- project_categories ----------
CREATE TABLE IF NOT EXISTS public.project_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name       text NOT NULL,
  color      text,
  sort_order int DEFAULT 0,
  UNIQUE (client_id, name)
);

CREATE INDEX IF NOT EXISTS project_categories_client_id_idx ON public.project_categories (client_id);

-- ---------- projects ----------
CREATE TABLE IF NOT EXISTS public.projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.project_categories(id) ON DELETE SET NULL,
  title       text NOT NULL,
  status      text NOT NULL DEFAULT 'backlog' CHECK (status IN ('backlog', 'planning', 'in_progress', 'waiting', 'done')),
  start_date  date,
  due_date    date,
  budget      numeric(12,2),
  notes       text,
  assignee_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  position    int DEFAULT 0,
  created_by  uuid REFERENCES public.profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS projects_client_id_idx ON public.projects (client_id);
CREATE INDEX IF NOT EXISTS projects_status_idx ON public.projects (status);
CREATE INDEX IF NOT EXISTS projects_assignee_id_idx ON public.projects (assignee_id);

DROP TRIGGER IF EXISTS projects_set_updated_at ON public.projects;
CREATE TRIGGER projects_set_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- tasks ----------
CREATE TABLE IF NOT EXISTS public.tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  project_id   uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  title        text NOT NULL,
  status       text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'blocked', 'done')),
  priority     text DEFAULT 'med' CHECK (priority IN ('low', 'med', 'high')),
  due_date     date,
  assignee_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes        text,
  position     int DEFAULT 0,
  archived     boolean DEFAULT false,
  completed_at timestamptz,
  created_by   uuid REFERENCES public.profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_client_id_idx ON public.tasks (client_id);
CREATE INDEX IF NOT EXISTS tasks_project_id_idx ON public.tasks (project_id);
CREATE INDEX IF NOT EXISTS tasks_assignee_id_idx ON public.tasks (assignee_id);
CREATE INDEX IF NOT EXISTS tasks_status_idx ON public.tasks (status);

DROP TRIGGER IF EXISTS tasks_set_updated_at ON public.tasks;
CREATE TRIGGER tasks_set_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- task_activity ----------
CREATE TABLE IF NOT EXISTS public.task_activity (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    uuid REFERENCES public.tasks(id) ON DELETE CASCADE,
  client_id  uuid NOT NULL,
  actor_id   uuid REFERENCES public.profiles(id),
  action     text CHECK (action IN ('created', 'status_changed', 'updated', 'assigned', 'completed', 'deleted')),
  detail     jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_activity_client_created_idx ON public.task_activity (client_id, created_at);

-- ---------- time_entries ----------
CREATE TABLE IF NOT EXISTS public.time_entries (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  client_id  uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES public.profiles(id),
  entry_date date NOT NULL,
  minutes    int NOT NULL CHECK (minutes > 0),
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS time_entries_client_date_idx ON public.time_entries (client_id, entry_date);

-- ---------- Row Level Security ----------
ALTER TABLE public.project_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;

-- project_categories (feature: projects)
DROP POLICY IF EXISTS "project_categories_select" ON public.project_categories;
CREATE POLICY "project_categories_select"
  ON public.project_categories FOR SELECT
  TO authenticated
  USING (public.has_perm('projects', 'view'));

DROP POLICY IF EXISTS "project_categories_insert" ON public.project_categories;
CREATE POLICY "project_categories_insert"
  ON public.project_categories FOR INSERT
  TO authenticated
  WITH CHECK (public.has_perm('projects', 'edit'));

DROP POLICY IF EXISTS "project_categories_update" ON public.project_categories;
CREATE POLICY "project_categories_update"
  ON public.project_categories FOR UPDATE
  TO authenticated
  USING (public.has_perm('projects', 'edit'))
  WITH CHECK (public.has_perm('projects', 'edit'));

DROP POLICY IF EXISTS "project_categories_delete" ON public.project_categories;
CREATE POLICY "project_categories_delete"
  ON public.project_categories FOR DELETE
  TO authenticated
  USING (public.has_perm('projects', 'edit'));

-- projects (feature: projects)
DROP POLICY IF EXISTS "projects_select" ON public.projects;
CREATE POLICY "projects_select"
  ON public.projects FOR SELECT
  TO authenticated
  USING (public.has_perm('projects', 'view'));

DROP POLICY IF EXISTS "projects_insert" ON public.projects;
CREATE POLICY "projects_insert"
  ON public.projects FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_perm('projects', 'edit')
    AND (created_by = auth.uid() OR created_by IS NULL)
  );

DROP POLICY IF EXISTS "projects_update" ON public.projects;
CREATE POLICY "projects_update"
  ON public.projects FOR UPDATE
  TO authenticated
  USING (public.has_perm('projects', 'edit'))
  WITH CHECK (public.has_perm('projects', 'edit'));

DROP POLICY IF EXISTS "projects_delete" ON public.projects;
CREATE POLICY "projects_delete"
  ON public.projects FOR DELETE
  TO authenticated
  USING (public.has_perm('projects', 'edit'));

-- tasks (feature: tasks)
DROP POLICY IF EXISTS "tasks_select" ON public.tasks;
CREATE POLICY "tasks_select"
  ON public.tasks FOR SELECT
  TO authenticated
  USING (public.has_perm('tasks', 'view'));

DROP POLICY IF EXISTS "tasks_insert" ON public.tasks;
CREATE POLICY "tasks_insert"
  ON public.tasks FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_perm('tasks', 'edit')
    AND (created_by = auth.uid() OR created_by IS NULL)
  );

DROP POLICY IF EXISTS "tasks_update" ON public.tasks;
CREATE POLICY "tasks_update"
  ON public.tasks FOR UPDATE
  TO authenticated
  USING (public.has_perm('tasks', 'edit'))
  WITH CHECK (public.has_perm('tasks', 'edit'));

DROP POLICY IF EXISTS "tasks_delete" ON public.tasks;
CREATE POLICY "tasks_delete"
  ON public.tasks FOR DELETE
  TO authenticated
  USING (public.has_perm('tasks', 'edit'));

-- task_activity (feature: tasks)
DROP POLICY IF EXISTS "task_activity_select" ON public.task_activity;
CREATE POLICY "task_activity_select"
  ON public.task_activity FOR SELECT
  TO authenticated
  USING (public.has_perm('tasks', 'view'));

DROP POLICY IF EXISTS "task_activity_insert" ON public.task_activity;
CREATE POLICY "task_activity_insert"
  ON public.task_activity FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_perm('tasks', 'edit')
    AND actor_id = auth.uid()
  );

DROP POLICY IF EXISTS "task_activity_delete" ON public.task_activity;
CREATE POLICY "task_activity_delete"
  ON public.task_activity FOR DELETE
  TO authenticated
  USING (public.has_perm('tasks', 'edit'));

-- time_entries (feature: tasks)
DROP POLICY IF EXISTS "time_entries_select" ON public.time_entries;
CREATE POLICY "time_entries_select"
  ON public.time_entries FOR SELECT
  TO authenticated
  USING (public.has_perm('tasks', 'view'));

DROP POLICY IF EXISTS "time_entries_insert" ON public.time_entries;
CREATE POLICY "time_entries_insert"
  ON public.time_entries FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_perm('tasks', 'edit')
    AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS "time_entries_update" ON public.time_entries;
CREATE POLICY "time_entries_update"
  ON public.time_entries FOR UPDATE
  TO authenticated
  USING (public.has_perm('tasks', 'edit'))
  WITH CHECK (public.has_perm('tasks', 'edit'));

DROP POLICY IF EXISTS "time_entries_delete" ON public.time_entries;
CREATE POLICY "time_entries_delete"
  ON public.time_entries FOR DELETE
  TO authenticated
  USING (public.has_perm('tasks', 'edit'));
