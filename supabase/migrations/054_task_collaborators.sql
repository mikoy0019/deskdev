-- 054: a task can have collaborators besides its one assignee (revision 2).
--
-- An id array, the channels.member_ids pattern (023): who may see a task is
-- still decided by tasks:view alone, so collaborators need no row rule, and
-- the existing tasks realtime, fetch and update paths carry the column as is.
-- The guard keeps the list honest: no duplicates, never the assignee, only
-- people who exist, at most 20. Re-runnable.

BEGIN;

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS collaborator_ids uuid[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS tasks_collaborator_ids_idx ON public.tasks USING gin (collaborator_ids);

CREATE OR REPLACE FUNCTION public.tasks_clean_collaborators()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- First mention wins, so the order people were added in is kept.
  NEW.collaborator_ids := coalesce((
    SELECT array_agg(c ORDER BY first_at)
      FROM (
        SELECT c, min(ord) AS first_at
          FROM unnest(NEW.collaborator_ids) WITH ORDINALITY AS u(c, ord)
         WHERE c IS NOT NULL
           AND c IS DISTINCT FROM NEW.assignee_id
           AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.c)
         GROUP BY c
      ) kept
  ), '{}');
  IF cardinality(NEW.collaborator_ids) > 20 THEN
    RAISE EXCEPTION 'A task can have at most 20 collaborators' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.tasks_clean_collaborators() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tasks_clean_collaborators ON public.tasks;
CREATE TRIGGER tasks_clean_collaborators
  BEFORE INSERT OR UPDATE OF collaborator_ids, assignee_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_clean_collaborators();

COMMIT;
