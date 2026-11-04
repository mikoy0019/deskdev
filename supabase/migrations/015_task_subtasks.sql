-- ============================================
-- DeskDev Studio — 015: Subtasks (tasks.parent_task_id)
--
-- A task can now hold subtasks, and a parent cannot be completed until every
-- one of its unarchived subtasks is done. Subtasks are ordinary task rows
-- (same client, same permissions, own assignee/due date/time log) with a
-- parent pointer — no second table, so RLS, task_activity and time_entries
-- keep working unchanged.
--
-- Two invariants are enforced in the database as well as the app, because
-- tasks are also written by the REST API and n8n:
--   1. Subtasks are one level deep — a subtask can't have subtasks.
--   2. A parent can't be set to 'done' while an unarchived subtask is open.
-- Deleting a parent cascades to its subtasks (ON DELETE CASCADE below).
--
-- Note: adding an open subtask under an already-'done' parent is allowed by
-- the DB (the parent's own row isn't being written). The app reopens the
-- parent to 'in_progress' in that case — see addTask in store/useStore.ts.
-- ============================================

-- ---------- New tasks column ----------
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS parent_task_id uuid
    REFERENCES public.tasks(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS tasks_parent_task_id_idx
  ON public.tasks (parent_task_id);

-- ---------- Invariant 1: subtasks are one level deep ----------
CREATE OR REPLACE FUNCTION public.tasks_check_subtask_depth()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.parent_task_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_task_id = NEW.id THEN
    RAISE EXCEPTION 'A task cannot be its own parent (task %)', NEW.id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.tasks
    WHERE id = NEW.parent_task_id AND parent_task_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'Subtasks are one level deep: task % is already a subtask', NEW.parent_task_id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.tasks WHERE parent_task_id = NEW.id) THEN
    RAISE EXCEPTION
      'Task % has subtasks of its own and cannot become a subtask', NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_check_subtask_depth ON public.tasks;
CREATE TRIGGER tasks_check_subtask_depth
  BEFORE INSERT OR UPDATE OF parent_task_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_check_subtask_depth();

-- ---------- Invariant 2: open subtasks block the parent's completion ----------
CREATE OR REPLACE FUNCTION public.tasks_check_subtasks_done()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  open_subtasks int;
BEGIN
  -- Only on the transition into 'done' — re-saving an already-done task, or
  -- a parent whose subtasks were archived afterwards, must not start failing.
  IF NEW.status <> 'done' OR (TG_OP = 'UPDATE' AND OLD.status = 'done') THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO open_subtasks
  FROM public.tasks
  WHERE parent_task_id = NEW.id
    AND status <> 'done'
    AND archived IS NOT TRUE;

  IF open_subtasks > 0 THEN
    RAISE EXCEPTION
      'Task % cannot be completed: % subtask(s) still open', NEW.id, open_subtasks;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_check_subtasks_done ON public.tasks;
CREATE TRIGGER tasks_check_subtasks_done
  BEFORE INSERT OR UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_check_subtasks_done();
