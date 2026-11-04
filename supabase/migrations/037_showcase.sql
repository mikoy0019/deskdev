-- ============================================
-- DeskDev Studio — 037: Showcase (the public project library on /portfolio)
-- Feature: 'showcase' (new permission key; admins always pass has_perm).
--
--   showcase_items         one card on nixgensolutions.com/portfolio
--   anon read surface      column grants + one RLS policy, NOT a view
--   guard_showcase_item()  publishing and unpublishing are admin-only
--   audit_showcase_item()  every publish / unpublish / delete of a live item
--                          lands in audit_log (032)
--   storage bucket         'showcase': public read, 5 MB, images only,
--                          writes need showcase:edit
--   projects.live_url      https only; clients.showcase_consent
--   showcase_on_project()  a project marked done with a live URL drafts an
--                          item and tells the admins (type 'showcase_ready', 033);
--                          it never publishes
--   protect_client_showcase_consent()  only an admin sets a client's consent
--   showcase_record_link_check()  the link checker's entry point (B3); the
--                          only path from auto-publish to the public site
--   showcase_notification_ok()  033's guard: who may send 'showcase_ready'
--
-- This is the first table anon can read. Supabase grants ALL on every new
-- table to anon by default, so the grants below start with REVOKE ALL and then
-- hand back a column list. The assertions at the end of this file run as anon
-- and abort the migration if a draft or a private column is reachable.
--
-- Depends on 032 (audit_log, profiles.deactivated_at) and 033
-- (workspace_settings.showcase_auto_publish, the 'showcase_ready' type in the
-- notification guard). Re-runnable: IF NOT EXISTS / OR REPLACE / DROP … IF
-- EXISTS throughout.
-- ============================================

-- ---------- 1. Columns on projects and clients ----------
-- live_url feeds the showcase trigger and is what the public card links to,
-- so only https is accepted (a staging http:// URL never reaches the site).
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS live_url text;
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_live_url_https;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_live_url_https CHECK (
    live_url IS NULL
    OR (live_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?(/[^[:space:]]*)?$' AND char_length(live_url) <= 2048)
  );

-- Whether the client agreed to appear on the public site. 'unknown' drafts an
-- item that an admin must clear; 'declined' files it as hidden.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS showcase_consent text NOT NULL DEFAULT 'unknown';
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_showcase_consent_check;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_showcase_consent_check CHECK (showcase_consent IN ('unknown', 'granted', 'declined'));

-- Consent is what lets a client's work onto the public site (with
-- auto-publish on, it is the whole decision), so it is an admin's call, like
-- role and permissions on profiles. clients:edit is not enough. SECURITY
-- INVOKER on purpose, as guard_showcase_item below: current_user is the
-- caller's role, so SECURITY DEFINER code, cron and the service role pass.
CREATE OR REPLACE FUNCTION public.protect_client_showcase_consent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND NOT public.is_admin()
     AND (CASE WHEN TG_OP = 'INSERT' THEN NEW.showcase_consent <> 'unknown'
               ELSE NEW.showcase_consent IS DISTINCT FROM OLD.showcase_consent END) THEN
    RAISE EXCEPTION 'only an admin can record a client''s showcase consent' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_client_showcase_consent() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS clients_protect_showcase_consent ON public.clients;
CREATE TRIGGER clients_protect_showcase_consent
  BEFORE INSERT OR UPDATE OF showcase_consent ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.protect_client_showcase_consent();

-- Who recorded consent, in 032's audit_log (an AFTER trigger: the guard above
-- runs as the caller, who cannot write the log).
CREATE OR REPLACE FUNCTION public.audit_client_showcase_consent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.showcase_consent = 'unknown' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.showcase_consent IS NOT DISTINCT FROM OLD.showcase_consent THEN
    RETURN NULL;
  END IF;
  PERFORM public.write_audit_log(
    'client.showcase_consent', 'client', NEW.id::text,
    jsonb_build_object(
      'from', CASE WHEN TG_OP = 'UPDATE' THEN OLD.showcase_consent END,
      'to', NEW.showcase_consent
    )
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_client_showcase_consent() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS clients_audit_showcase_consent ON public.clients;
CREATE TRIGGER clients_audit_showcase_consent
  AFTER INSERT OR UPDATE OF showcase_consent ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.audit_client_showcase_consent();

-- ---------- 2. showcase_items ----------
-- A table of its own rather than columns on projects: the legacy entries have
-- no project or client, and public and internal fields on separate tables keep
-- the anon grants simple to reason about.
CREATE TABLE IF NOT EXISTS public.showcase_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 80),
  kind             text NOT NULL DEFAULT 'website' CHECK (kind IN ('website', 'web_app', 'product')),
  title            text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  url              text CHECK (
                     url IS NULL
                     OR (url ~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?(/[^[:space:]]*)?$' AND char_length(url) <= 2048)
                   ),
  -- false: a login-gated or private app. The card says "Private app — demo on
  -- request" and the URL never leaves the database (see public_url).
  link_public      boolean NOT NULL DEFAULT true,
  -- The only URL anon can read. Column grants cannot depend on the row, so
  -- guard_showcase_item() derives it on every write (url when link_public,
  -- else NULL); any value a client sends is overwritten. Not a GENERATED
  -- column: the table is in the realtime publication with REPLICA IDENTITY
  -- FULL, and Postgres refuses UPDATEs when the replica identity holds an
  -- unpublished generated column.
  public_url       text,
  industry         text CHECK (char_length(industry) <= 80),
  summary          text CHECK (char_length(summary) <= 600),
  result_tag       text CHECK (char_length(result_tag) <= 60),
  stack            text[] NOT NULL DEFAULT '{}',
  accent           text CHECK (accent ~ '^#[0-9A-Fa-f]{6}$'),
  mockup_variant   text CHECK (char_length(mockup_variant) <= 40),
  -- image_key: 1280w, image_key_small: 640w. A key is an object path in the
  -- 'showcase' bucket, a '/…' path under the site's /public, or (legacy) a
  -- full https capture URL. image_source says where it came from and how the
  -- card renders (site/src/lib/showcase.ts reads the same vocabulary):
  --   upload / capture  stored in the bucket by DeskDev / the capture job
  --   local             a file in the site's /public
  --   mshots            no stored image yet; a website card uses a live
  --                     mShots capture of its URL until the backfill lands
  --   mockup            show the themed app mockup even though a key is set
  --                     (the capture is only a sign-in screen)
  --   none              the capture is known to be broken: monogram
  image_key        text CHECK (char_length(image_key) <= 1024),
  image_key_small  text CHECK (char_length(image_key_small) <= 1024),
  image_alt        text CHECK (char_length(image_alt) <= 300),
  image_source     text CHECK (image_source IN ('upload', 'capture', 'local', 'mshots', 'mockup', 'none')),
  case_study       jsonb CHECK (case_study IS NULL OR jsonb_typeof(case_study) = 'object'),
  -- draft: not reviewed · ready: needs an admin's review ("Needs review")
  -- published: on the site · hidden: kept off the site · archived: retired
  status           text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'ready', 'published', 'hidden', 'archived')),
  featured         boolean NOT NULL DEFAULT false,
  home_featured    boolean NOT NULL DEFAULT false,
  sort_order       int NOT NULL DEFAULT 0,
  launched_on      date,
  consent          text NOT NULL DEFAULT 'unknown'
                     CHECK (consent IN ('unknown', 'granted', 'declined', 'legacy', 'internal')),
  consent_note     text CHECK (char_length(consent_note) <= 1000),
  consent_at       timestamptz,
  project_id       uuid REFERENCES public.projects (id) ON DELETE SET NULL,
  client_id        uuid REFERENCES public.clients (id) ON DELETE SET NULL,
  -- unknown until the link check (B3) has run; 'down' takes the card off the
  -- site without changing its status, so it comes back when the site does.
  link_status      text NOT NULL DEFAULT 'unknown' CHECK (link_status IN ('unknown', 'ok', 'down')),
  link_checked_at  timestamptz,
  link_fail_count  int NOT NULL DEFAULT 0 CHECK (link_fail_count >= 0),
  published_at     timestamptz,
  published_by     uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_by       uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- Nothing reaches the public site without consent on record.
  CONSTRAINT showcase_items_published_needs_consent
    CHECK (status <> 'published' OR consent IN ('granted', 'legacy', 'internal'))
);

CREATE INDEX IF NOT EXISTS showcase_items_status_sort_idx ON public.showcase_items (status, sort_order);
CREATE INDEX IF NOT EXISTS showcase_items_client_id_idx ON public.showcase_items (client_id);
-- One item per project: the done trigger and a manual "add to showcase" must
-- not both create one.
CREATE UNIQUE INDEX IF NOT EXISTS showcase_items_project_id_uidx
  ON public.showcase_items (project_id) WHERE project_id IS NOT NULL;

DROP TRIGGER IF EXISTS showcase_items_set_updated_at ON public.showcase_items;
CREATE TRIGGER showcase_items_set_updated_at
  BEFORE UPDATE ON public.showcase_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- 3. Staff access: RLS on has_perm('showcase', …) ----------
ALTER TABLE public.showcase_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "showcase_items_select" ON public.showcase_items;
CREATE POLICY "showcase_items_select"
  ON public.showcase_items FOR SELECT TO authenticated
  USING (public.has_perm('showcase', 'view'));

DROP POLICY IF EXISTS "showcase_items_insert" ON public.showcase_items;
CREATE POLICY "showcase_items_insert"
  ON public.showcase_items FOR INSERT TO authenticated
  WITH CHECK (public.has_perm('showcase', 'edit'));

DROP POLICY IF EXISTS "showcase_items_update" ON public.showcase_items;
CREATE POLICY "showcase_items_update"
  ON public.showcase_items FOR UPDATE TO authenticated
  USING (public.has_perm('showcase', 'edit'))
  WITH CHECK (public.has_perm('showcase', 'edit'));

-- Deleting a live item takes it off the site, which is an unpublish.
DROP POLICY IF EXISTS "showcase_items_delete" ON public.showcase_items;
CREATE POLICY "showcase_items_delete"
  ON public.showcase_items FOR DELETE TO authenticated
  USING (public.has_perm('showcase', 'edit') AND (status <> 'published' OR public.is_admin()));

-- ---------- 4. The anon read surface ----------
-- The site Worker reads with the anon key and holds no privileged secret.
-- Anon gets SELECT on the public columns only. consent*, url (use
-- public_url), status, link health, project/client and people IDs are never
-- granted, so `select=*` fails for anon and the site must name its columns.
-- authenticated too: Supabase's default privileges also hand it TRUNCATE,
-- TRIGGER and REFERENCES, and TRUNCATE skips RLS, the publish guard and the
-- audit trigger. It gets back exactly the four verbs below.
REVOKE ALL ON public.showcase_items FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, slug, kind, title, public_url, link_public, industry, summary, result_tag,
  stack, accent, mockup_variant, image_key, image_key_small,
  image_alt, image_source, case_study, featured, home_featured, sort_order,
  launched_on, published_at, updated_at
) ON public.showcase_items TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.showcase_items TO authenticated;
GRANT ALL ON public.showcase_items TO service_role;

-- The policy filters on status and link_status, which anon cannot select.
-- RLS expressions are not subject to column privileges; assertion 1 below
-- proves it on this database.
DROP POLICY IF EXISTS "showcase_items_public_read" ON public.showcase_items;
CREATE POLICY "showcase_items_public_read"
  ON public.showcase_items FOR SELECT TO anon
  USING (status = 'published' AND link_status <> 'down');

-- ---------- 5. Publish guard: admins only ----------
-- Modelled on protect_profile_privileges. A signed-in non-admin (current_user
-- authenticated) may draft and edit, but not move an item onto or off the
-- site, and not edit one that is live: everything public passes an admin.
-- SECURITY INVOKER on purpose: current_user is the caller's role here. Inside
-- SECURITY DEFINER code (showcase_record_link_check's auto-publish), cron and
-- the service role, current_user is not a client role and the guard lets it
-- through. showcase_on_project never publishes, so a project editor cannot
-- use it to reach the site.
-- Publish metadata, created_by and public_url are stamped by the server,
-- never the client.
CREATE OR REPLACE FUNCTION public.guard_showcase_item()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_client boolean := current_user IN ('authenticated', 'anon');
  v_was    boolean := TG_OP = 'UPDATE' AND OLD.status = 'published';
  v_is     boolean := NEW.status = 'published';
BEGIN
  IF v_client AND NOT public.is_admin() THEN
    IF v_was IS DISTINCT FROM v_is THEN
      RAISE EXCEPTION 'only an admin can publish or unpublish a showcase item' USING ERRCODE = '42501';
    END IF;
    IF v_was THEN
      RAISE EXCEPTION 'only an admin can edit a published showcase item' USING ERRCODE = '42501';
    END IF;
  END IF;

  NEW.public_url := CASE WHEN NEW.link_public THEN NEW.url END;

  IF TG_OP = 'INSERT' THEN
    IF v_client THEN
      NEW.created_by := auth.uid();
      NEW.created_at := now();
      NEW.published_at := NULL;
      NEW.published_by := NULL;
    END IF;
    IF v_is AND (v_client OR NEW.published_at IS NULL) THEN
      NEW.published_at := now();
      NEW.published_by := auth.uid();
    END IF;
    IF NEW.consent <> 'unknown' AND (v_client OR NEW.consent_at IS NULL) THEN
      NEW.consent_at := now();
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF v_client THEN
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;
  IF v_is AND NOT v_was THEN
    NEW.published_at := now();
    NEW.published_by := auth.uid();
  ELSIF v_client THEN
    NEW.published_at := OLD.published_at;
    NEW.published_by := OLD.published_by;
  END IF;
  IF NEW.consent IS DISTINCT FROM OLD.consent AND (v_client OR NEW.consent_at IS NOT DISTINCT FROM OLD.consent_at) THEN
    NEW.consent_at := now();
  ELSIF v_client THEN
    NEW.consent_at := OLD.consent_at;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_showcase_item() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS showcase_items_guard ON public.showcase_items;
CREATE TRIGGER showcase_items_guard
  BEFORE INSERT OR UPDATE ON public.showcase_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_showcase_item();

-- ---------- 6. Audit: what went on or off the public site ----------
-- Through 032's write_audit_log (SECURITY DEFINER; audit_log has no client
-- write path), which also names the admin behind a service-role call. A
-- separate AFTER trigger so the guard above can keep reading current_user.
-- The seed (038) sets deskdev.showcase_seed for its one statement and writes a
-- single 'showcase.seeded' row instead of one row per legacy entry.
CREATE OR REPLACE FUNCTION public.audit_showcase_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action text;
  v_row    public.showcase_items;
BEGIN
  IF coalesce(current_setting('deskdev.showcase_seed', true), '') = 'on' THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.status = 'published' THEN
    v_action := 'showcase.published'; v_row := NEW;
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'published' AND OLD.status <> 'published' THEN
    v_action := 'showcase.published'; v_row := NEW;
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'published' AND NEW.status <> 'published' THEN
    v_action := 'showcase.unpublished'; v_row := NEW;
  ELSIF TG_OP = 'DELETE' AND OLD.status = 'published' THEN
    v_action := 'showcase.deleted'; v_row := OLD;
  ELSE
    RETURN NULL;
  END IF;

  PERFORM public.write_audit_log(
    v_action,
    'showcase',
    v_row.id::text,
    jsonb_build_object(
      'slug', v_row.slug,
      'title', v_row.title,
      'from', CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
      'to', CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.status END,
      'consent', v_row.consent,
      'project_id', v_row.project_id
    )
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_showcase_item() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS showcase_items_audit ON public.showcase_items;
CREATE TRIGGER showcase_items_audit
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.showcase_items
  FOR EACH ROW EXECUTE FUNCTION public.audit_showcase_item();

-- ---------- 7. Storage: the 'showcase' bucket ----------
-- Public bucket: published cards load their images straight from the CDN
-- with year-long cache headers (keys are content-addressed, so a new image is
-- a new key). Public means anyone holding an exact object URL can fetch it,
-- including a draft's image; the keys are unguessable and a takedown deletes
-- the objects (B3).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('showcase', 'showcase', true, 5242880, ARRAY['image/webp', 'image/png', 'image/jpeg', 'image/avif'])
ON CONFLICT (id) DO UPDATE
  SET public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- No anon SELECT policy on storage.objects: public downloads do not need one,
-- and one would let anyone list every key, drafts included.
DROP POLICY IF EXISTS "showcase_objects_select" ON storage.objects;
CREATE POLICY "showcase_objects_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'showcase' AND public.has_perm('showcase', 'view'));

DROP POLICY IF EXISTS "showcase_objects_insert" ON storage.objects;
CREATE POLICY "showcase_objects_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'showcase' AND public.has_perm('showcase', 'edit'));

-- Replacing or removing the image of a live card changes the public site, so
-- only an admin may touch an object a published item points at.
DROP POLICY IF EXISTS "showcase_objects_update" ON storage.objects;
CREATE POLICY "showcase_objects_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'showcase' AND public.has_perm('showcase', 'edit')
    AND (public.is_admin() OR NOT EXISTS (
      SELECT 1 FROM public.showcase_items s
       WHERE s.status = 'published' AND name IN (s.image_key, s.image_key_small)
    ))
  )
  WITH CHECK (bucket_id = 'showcase' AND public.has_perm('showcase', 'edit'));

DROP POLICY IF EXISTS "showcase_objects_delete" ON storage.objects;
CREATE POLICY "showcase_objects_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'showcase' AND public.has_perm('showcase', 'edit')
    AND (public.is_admin() OR NOT EXISTS (
      SELECT 1 FROM public.showcase_items s
       WHERE s.status = 'published' AND name IN (s.image_key, s.image_key_small)
    ))
  );

-- ---------- 8. Slugs ----------
-- "Heart & Soul WY" -> "heart-soul-wy". The seed (038) and the site fallback
-- use the same rule.
CREATE OR REPLACE FUNCTION public.showcase_slugify(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT coalesce(
    nullif(btrim(left(btrim(regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'), '-'), 80), '-'), ''),
    'item'
  );
$$;

REVOKE ALL ON FUNCTION public.showcase_slugify(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.showcase_slugify(text) TO authenticated, service_role;

-- ---------- 9. A finished project drafts a showcase item ----------
-- Fires when a project is (or becomes) done with a live URL, whatever wrote
-- the row: web, PWA, n8n or SQL. Consent comes from the client (a white-label
-- or agency client counts as declined, Q5): declined files the item as hidden
-- and tells nobody; otherwise it is a draft and every other
-- active admin gets 'showcase_ready'. Nothing here publishes: the project's
-- live_url is whatever a projects:edit user typed, so with auto-publish on
-- (default off, 033) AND consent granted the item is filed as 'ready', and
-- only showcase_record_link_check() below puts it live, once the link checker
-- (B3) has seen the URL answer (Q5(c)). Until then an admin publishes by hand.
-- SECURITY DEFINER: the person marking the project done may lack
-- showcase:edit. auth.uid() still names them, so the notification carries
-- actor_id = auth.uid() and passes 030's guard (rule 4).
CREATE OR REPLACE FUNCTION public.showcase_on_project()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_id       uuid;
  v_name     text;
  v_company  text;
  v_industry text;
  v_consent  text;
  v_auto     boolean;
  v_status   text;
  v_title    text;
  v_base     text;
  v_slug     text;
  v_n        int := 1;
  v_note     text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'done' OR NEW.live_url IS NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'done' AND OLD.live_url IS NOT DISTINCT FROM NEW.live_url THEN
    RETURN NULL;
  END IF;

  -- Already in the showcase: keep an unreviewed item's URL current, and
  -- leave anything an admin has decided on alone.
  SELECT id INTO v_id FROM public.showcase_items WHERE project_id = NEW.id;
  IF FOUND THEN
    UPDATE public.showcase_items
       SET url = NEW.live_url
     WHERE id = v_id AND status IN ('draft', 'ready') AND url IS DISTINCT FROM NEW.live_url;
    RETURN NULL;
  END IF;

  SELECT c.name, c.company, c.showcase_consent, cc.name
    INTO v_name, v_company, v_consent, v_industry
    FROM public.clients c
    LEFT JOIN public.client_categories cc ON cc.id = c.category_id
   WHERE c.id = NEW.client_id;

  v_consent := coalesce(v_consent, 'unknown');
  -- Q5: white-label and agency work belongs to someone else's client, so it
  -- is filed as declined (hidden, nobody notified) unless the client's
  -- consent was recorded explicitly. The category name is the only marker
  -- the schema has for it.
  IF v_consent = 'unknown' AND v_industry ~* '(white[ -]?label|agency)' THEN
    v_consent := 'declined';
    v_note := 'Filed as declined: the client''s category (' || left(v_industry, 80)
              || ') marks white-label or agency work. Record consent on the client to change it.';
  END IF;
  v_auto := coalesce((SELECT ws.showcase_auto_publish FROM public.workspace_settings ws LIMIT 1), false);
  v_status := CASE
    WHEN v_consent = 'declined' THEN 'hidden'
    WHEN v_auto AND v_consent = 'granted' THEN 'ready'
    ELSE 'draft'
  END;
  v_title := left(coalesce(nullif(btrim(v_company), ''), nullif(btrim(v_name), ''), NEW.title), 120);

  v_base := left(public.showcase_slugify(v_title), 72);
  v_slug := v_base;
  WHILE EXISTS (SELECT 1 FROM public.showcase_items WHERE slug = v_slug) LOOP
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  END LOOP;

  INSERT INTO public.showcase_items (
    slug, kind, title, url, link_public, industry, status, consent, consent_note, consent_at,
    project_id, client_id, created_by
  ) VALUES (
    v_slug, 'website', v_title, NEW.live_url, true, left(v_industry, 80), v_status, v_consent, v_note,
    CASE WHEN v_consent <> 'unknown' THEN now() END,
    NEW.id, NEW.client_id, v_actor
  )
  RETURNING id INTO v_id;

  IF v_status <> 'hidden' THEN
    INSERT INTO public.notifications (user_id, actor_id, type, title, body, entity, entity_id)
    SELECT p.id,
           v_actor,
           'showcase_ready',
           'Ready for the showcase: ' || v_title,
           CASE WHEN v_status = 'ready'
                THEN 'The client granted consent and auto-publish is on: it goes live on /portfolio once its link check passes.'
                ELSE 'The project is done and live. Review the item before it goes on /portfolio.'
           END,
           'showcase',
           v_id
      FROM public.profiles p
     WHERE p.role = 'admin'
       AND p.deactivated_at IS NULL
       AND p.id IS DISTINCT FROM v_actor;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.showcase_on_project() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS projects_showcase_on_done ON public.projects;
CREATE TRIGGER projects_showcase_on_done
  AFTER INSERT OR UPDATE OF status, live_url ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.showcase_on_project();

-- ---------- 9b. The link check's entry point (B3) ----------
-- The checker (service role) reports what it saw. Three failures in a row
-- mark the link down, which takes a published card off the site (the anon
-- policy hides link_status 'down'). A passing check is the only way an item
-- reaches the site without an admin, and only for the item showcase_on_project
-- filed: 'ready', auto-publish still on, and still the done project of a
-- client whose consent an admin recorded, at the URL on that project. The
-- item's own consent and url are not enough: a showcase editor can set both,
-- and publishing is an admin's call. Admins are told when it goes live.
-- Returns the item's status afterwards (NULL for an unknown item).
CREATE OR REPLACE FUNCTION public.showcase_record_link_check(p_item uuid, p_ok boolean)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auto   boolean;
  v_status text;
  v_title  text;
BEGIN
  IF p_item IS NULL OR p_ok IS NULL THEN
    RAISE EXCEPTION 'item and result are required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.showcase_items
     SET link_checked_at = now(),
         link_fail_count = CASE WHEN p_ok THEN 0 ELSE link_fail_count + 1 END,
         link_status     = CASE WHEN p_ok THEN 'ok'
                                WHEN link_fail_count + 1 >= 3 THEN 'down'
                                ELSE link_status END
   WHERE id = p_item
   RETURNING status INTO v_status;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_auto := coalesce((SELECT ws.showcase_auto_publish FROM public.workspace_settings ws LIMIT 1), false);
  IF p_ok AND v_auto AND v_status = 'ready' THEN
    UPDATE public.showcase_items s
       SET status = 'published'
     WHERE s.id = p_item AND s.status = 'ready' AND s.consent = 'granted' AND s.link_status = 'ok'
       AND EXISTS (
         SELECT 1
           FROM public.projects pr
           JOIN public.clients c ON c.id = pr.client_id
          WHERE pr.id = s.project_id
            AND pr.status = 'done'
            AND pr.live_url = s.url
            AND c.showcase_consent = 'granted'
       )
    RETURNING s.title INTO v_title;
    IF FOUND THEN
      v_status := 'published';
      -- actor_id NULL: the checker has no auth.uid(), so 033's guard is skipped.
      INSERT INTO public.notifications (user_id, actor_id, type, title, body, entity, entity_id)
      SELECT p.id, NULL, 'showcase_ready',
             left('Published to the site: ' || v_title, 300),
             'Its link check passed, the client granted consent and auto-publish is on. It is live on /portfolio.',
             'showcase', p_item
        FROM public.profiles p
       WHERE p.role = 'admin' AND p.deactivated_at IS NULL;
    END IF;
  END IF;
  RETURN v_status;
END;
$$;

REVOKE ALL ON FUNCTION public.showcase_record_link_check(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.showcase_record_link_check(uuid, boolean) TO service_role;

-- ---------- 9c. Who may send 'showcase_ready' ----------
-- 033's notification guard asks this (033 ships a stub that says no). The
-- type is server-generated: showcase_on_project sends it in the transaction
-- that created the item, as the person who finished the project, who may have
-- no showcase access. Anyone else needs showcase:view, and every row must name
-- an existing item, so a member cannot send the admins a "ready for the
-- showcase" with a title and link of their choosing.
-- SECURITY DEFINER: the sender may not be able to read showcase_items.
CREATE OR REPLACE FUNCTION public.showcase_notification_ok(p_item uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_item IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.showcase_items s
     WHERE s.id = p_item
       -- created_at = now(): inserted by this very transaction.
       AND (s.created_at = now() OR public.has_perm('showcase', 'view'))
  );
$$;

REVOKE ALL ON FUNCTION public.showcase_notification_ok(uuid) FROM PUBLIC, anon, authenticated;

-- ---------- 10. Realtime ----------
-- Staff screens stay live. Realtime applies the same RLS and column
-- privileges, so an anon subscriber would only ever see published rows'
-- public columns.
ALTER TABLE public.showcase_items REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'showcase_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.showcase_items;
  END IF;
END $$;

-- ---------- 11. The three assertions ----------
-- Run as anon against two throwaway rows, inside a block that always rolls
-- back. Any failure aborts the migration, so a leaky grant cannot ship.
--   1. anon sees a published row (the policy may filter on columns anon has
--      no grant for)
--   2. anon sees 0 drafts
--   3. anon reading consent_note is a permission error
DO $$
DECLARE
  n int;
BEGIN
  BEGIN
    INSERT INTO public.showcase_items (slug, title, status, consent)
    VALUES ('zz-assert-published', 'Assertion: published', 'published', 'internal'),
           ('zz-assert-draft', 'Assertion: draft', 'draft', 'unknown');

    SET LOCAL ROLE anon;

    SELECT count(*) INTO n FROM public.showcase_items WHERE slug = 'zz-assert-published';
    IF n <> 1 THEN
      RAISE EXCEPTION 'showcase assertion 1 failed: anon sees % published test rows, expected 1', n;
    END IF;

    SELECT count(*) INTO n FROM public.showcase_items WHERE slug = 'zz-assert-draft';
    IF n <> 0 THEN
      RAISE EXCEPTION 'showcase assertion 2 failed: anon sees a draft';
    END IF;

    BEGIN
      PERFORM consent_note FROM public.showcase_items LIMIT 1;
      RAISE EXCEPTION 'showcase assertion 3 failed: anon can read consent_note';
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;

    RAISE EXCEPTION 'showcase assertions passed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'showcase assertions passed' THEN
      RAISE;
    END IF;
  END;
END $$;
