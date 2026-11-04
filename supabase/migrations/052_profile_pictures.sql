-- ============================================
-- DeskDev Studio — 052: profile pictures (admins) and client pictures
--
--   profiles.avatar_key   an admin's own picture, in place of the initials
--   clients.avatar_key    a client's picture (logo or photo), set by an admin
--   'avatars' bucket      public images under profiles/<id>/… and clients/<id>/…
--
-- Who may set them: admins only, for now — the owner's call ("admins can
-- change their own profile picture, and admins can set client profile pic").
-- RLS already lets every user update their own profile and clients:edit
-- update clients, and RLS cannot single out a column, so a BEFORE UPDATE
-- trigger guards the two new columns (as 001 guards role / permissions).
--
-- The app resizes a picture to a 256 px WebP before upload and stores the
-- object key; the public URL is derived from it. Keys carry a random part, so
-- a new picture is a new key (CDN caches stay right) and nobody can guess
-- one. Removing a picture clears the key; the app deletes the old object.
--
-- Re-runnable. Needs 001, 002, 032 (is_admin() of an active admin).
-- ============================================

-- ---------- 1. Columns ----------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_key text;
ALTER TABLE public.clients  ADD COLUMN IF NOT EXISTS avatar_key text;

-- A key only ever points inside its own row's folder.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_avatar_key_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_avatar_key_check CHECK (
  avatar_key IS NULL
  OR avatar_key ~ ('^profiles/' || id::text || '/[A-Za-z0-9_-]{8,64}\.(webp|png|jpe?g)$')
);

ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_avatar_key_check;
ALTER TABLE public.clients ADD CONSTRAINT clients_avatar_key_check CHECK (
  avatar_key IS NULL
  OR avatar_key ~ ('^clients/' || id::text || '/[A-Za-z0-9_-]{8,64}\.(webp|png|jpe?g)$')
);

-- ---------- 2. Admins only ----------
-- service_role (Edge Functions) and direct SQL have no auth.uid(): trusted,
-- as in 001's protect_profile_privileges.
CREATE OR REPLACE FUNCTION public.guard_avatar_key()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.avatar_key IS DISTINCT FROM OLD.avatar_key
     AND NOT public.is_admin()
     AND COALESCE(auth.role(), 'service_role') <> 'service_role' THEN
    RAISE EXCEPTION 'Only admins can change pictures' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_avatar_key() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_guard_avatar_key ON public.profiles;
CREATE TRIGGER profiles_guard_avatar_key
  BEFORE UPDATE OF avatar_key ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_avatar_key();

DROP TRIGGER IF EXISTS clients_guard_avatar_key ON public.clients;
CREATE TRIGGER clients_guard_avatar_key
  BEFORE UPDATE OF avatar_key ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.guard_avatar_key();

-- A new client created with a picture already set: same rule.
CREATE OR REPLACE FUNCTION public.guard_client_avatar_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.avatar_key IS NOT NULL
     AND NOT public.is_admin()
     AND COALESCE(auth.role(), 'service_role') <> 'service_role' THEN
    RAISE EXCEPTION 'Only admins can change pictures' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_client_avatar_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS clients_guard_avatar_insert ON public.clients;
CREATE TRIGGER clients_guard_avatar_insert
  BEFORE INSERT ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.guard_client_avatar_insert();

-- ---------- 3. Storage: the 'avatars' bucket ----------
-- Public, like 'showcase': every screen shows these, straight from the CDN.
-- 1 MB is far above a 256 px WebP; the type list matches the CHECKs above.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 1048576, ARRAY['image/webp', 'image/png', 'image/jpeg'])
ON CONFLICT (id) DO UPDATE
  SET public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Writes: admins, and only into the two folders. No anon SELECT policy:
-- public downloads don't need one, and one would let anyone list the keys.
DROP POLICY IF EXISTS "avatars_objects_select" ON storage.objects;
CREATE POLICY "avatars_objects_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars' AND public.is_admin());

DROP POLICY IF EXISTS "avatars_objects_insert" ON storage.objects;
CREATE POLICY "avatars_objects_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars' AND public.is_admin()
    AND name ~ '^(profiles|clients)/[0-9a-f-]{36}/[A-Za-z0-9_-]{8,64}\.(webp|png|jpe?g)$'
  );

DROP POLICY IF EXISTS "avatars_objects_update" ON storage.objects;
CREATE POLICY "avatars_objects_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND public.is_admin())
  WITH CHECK (
    bucket_id = 'avatars' AND public.is_admin()
    AND name ~ '^(profiles|clients)/[0-9a-f-]{36}/[A-Za-z0-9_-]{8,64}\.(webp|png|jpe?g)$'
  );

DROP POLICY IF EXISTS "avatars_objects_delete" ON storage.objects;
CREATE POLICY "avatars_objects_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND public.is_admin());
