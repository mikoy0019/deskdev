-- 055: a course topic can carry a written note, besides or instead of its SOP
-- video (revision 5). Plain text, shown as written; the course_topics RLS of
-- 016 and the realtime of 016 already cover the new column. Re-runnable.

BEGIN;

ALTER TABLE public.course_topics ADD COLUMN IF NOT EXISTS notes text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.course_topics'::regclass AND conname = 'course_topics_notes_length'
  ) THEN
    ALTER TABLE public.course_topics
      ADD CONSTRAINT course_topics_notes_length CHECK (notes IS NULL OR length(notes) <= 100000);
  END IF;
END $$;

COMMIT;
