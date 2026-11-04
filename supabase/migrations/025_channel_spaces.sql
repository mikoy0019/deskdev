-- ============================================
-- DeskDev Studio — 025: Channel spaces
-- Channels and their categories belong to a space, the way Discord channels
-- belong to a server: either the studio itself (client_id NULL) or one
-- client. The right-hand rail lists the spaces; picking one shows its
-- categories and channels.
--
-- Access rules are unchanged (023): a client's channels are as public or
-- private as any other. Deleting a client takes its channels with it.
-- ============================================

ALTER TABLE public.channel_categories
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE;

ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS channel_categories_client_idx ON public.channel_categories (client_id, position);
CREATE INDEX IF NOT EXISTS channels_client_idx ON public.channels (client_id, position);

-- A channel's category must live in the same space, or the list could never
-- show it under its heading.
CREATE OR REPLACE FUNCTION public.guard_channel_space()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.category_id IS NOT NULL AND (
    SELECT c.client_id FROM public.channel_categories c WHERE c.id = NEW.category_id
  ) IS DISTINCT FROM NEW.client_id THEN
    RAISE EXCEPTION 'a channel and its category must belong to the same space';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS channels_guard_space ON public.channels;
CREATE TRIGGER channels_guard_space
  BEFORE INSERT OR UPDATE OF category_id, client_id ON public.channels
  FOR EACH ROW EXECUTE FUNCTION public.guard_channel_space();
