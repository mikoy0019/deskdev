-- ============================================
-- DeskDev Studio — 017: Cache the SOP video's poster image
-- Titles and posters are read from the provider's oEmbed endpoint when the
-- link is saved, then stored here. Caching the poster is what gives Loom and
-- Vimeo a thumbnail at all — neither exposes one at a guessable URL, and we
-- do not want a per-card network call on every render.
-- ============================================

ALTER TABLE public.course_topics
  ADD COLUMN IF NOT EXISTS sop_thumbnail_url text;
