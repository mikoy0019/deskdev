-- ============================================
-- DeskDev Studio — 002: Client Categories & Clients
-- Feature: 'clients'
-- ============================================

-- ---------- client_categories ----------
CREATE TABLE IF NOT EXISTS public.client_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text UNIQUE NOT NULL,
  color      text,
  sort_order int DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- clients ----------
CREATE TABLE IF NOT EXISTS public.clients (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  company     text,
  email       text,
  phone       text,
  category_id uuid REFERENCES public.client_categories(id) ON DELETE SET NULL,
  engagement  text NOT NULL DEFAULT 'gig_on_call' CHECK (engagement IN ('full_time', 'part_time', 'gig_on_call')),
  status      text DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
  timezone    text,
  color       text,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clients_category_id_idx ON public.clients (category_id);
CREATE INDEX IF NOT EXISTS clients_status_idx ON public.clients (status);

DROP TRIGGER IF EXISTS clients_set_updated_at ON public.clients;
CREATE TRIGGER clients_set_updated_at
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- Row Level Security ----------
ALTER TABLE public.client_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

-- client_categories
DROP POLICY IF EXISTS "client_categories_select" ON public.client_categories;
CREATE POLICY "client_categories_select"
  ON public.client_categories FOR SELECT
  TO authenticated
  USING (public.has_perm('clients', 'view'));

DROP POLICY IF EXISTS "client_categories_insert" ON public.client_categories;
CREATE POLICY "client_categories_insert"
  ON public.client_categories FOR INSERT
  TO authenticated
  WITH CHECK (public.has_perm('clients', 'edit'));

DROP POLICY IF EXISTS "client_categories_update" ON public.client_categories;
CREATE POLICY "client_categories_update"
  ON public.client_categories FOR UPDATE
  TO authenticated
  USING (public.has_perm('clients', 'edit'))
  WITH CHECK (public.has_perm('clients', 'edit'));

DROP POLICY IF EXISTS "client_categories_delete" ON public.client_categories;
CREATE POLICY "client_categories_delete"
  ON public.client_categories FOR DELETE
  TO authenticated
  USING (public.has_perm('clients', 'edit'));

-- clients
DROP POLICY IF EXISTS "clients_select" ON public.clients;
CREATE POLICY "clients_select"
  ON public.clients FOR SELECT
  TO authenticated
  USING (public.has_perm('clients', 'view'));

DROP POLICY IF EXISTS "clients_insert" ON public.clients;
CREATE POLICY "clients_insert"
  ON public.clients FOR INSERT
  TO authenticated
  WITH CHECK (public.has_perm('clients', 'edit'));

DROP POLICY IF EXISTS "clients_update" ON public.clients;
CREATE POLICY "clients_update"
  ON public.clients FOR UPDATE
  TO authenticated
  USING (public.has_perm('clients', 'edit'))
  WITH CHECK (public.has_perm('clients', 'edit'));

DROP POLICY IF EXISTS "clients_delete" ON public.clients;
CREATE POLICY "clients_delete"
  ON public.clients FOR DELETE
  TO authenticated
  USING (public.has_perm('clients', 'edit'));
