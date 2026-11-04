-- ============================================
-- DeskDev Studio — 004: CRM (dynamic tables/columns/rows)
-- Feature: 'crm'
-- ============================================

-- ---------- crm_tables ----------
CREATE TABLE IF NOT EXISTS public.crm_tables (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  client_id  uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  color      text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_tables_client_id_idx ON public.crm_tables (client_id);

DROP TRIGGER IF EXISTS crm_tables_set_updated_at ON public.crm_tables;
CREATE TRIGGER crm_tables_set_updated_at
  BEFORE UPDATE ON public.crm_tables
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- crm_columns ----------
CREATE TABLE IF NOT EXISTS public.crm_columns (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id   uuid NOT NULL REFERENCES public.crm_tables(id) ON DELETE CASCADE,
  name       text NOT NULL,
  type       text NOT NULL CHECK (type IN ('text', 'number', 'select', 'multi_select', 'date', 'checkbox', 'url')),
  options    jsonb DEFAULT '[]',  -- select choices: [{id, label, color}]
  sort_order int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS crm_columns_table_id_idx ON public.crm_columns (table_id);

-- ---------- crm_rows ----------
CREATE TABLE IF NOT EXISTS public.crm_rows (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id   uuid NOT NULL REFERENCES public.crm_tables(id) ON DELETE CASCADE,
  values     jsonb NOT NULL DEFAULT '{}',  -- keyed by column uuid
  position   int DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_rows_table_id_idx ON public.crm_rows (table_id);

DROP TRIGGER IF EXISTS crm_rows_set_updated_at ON public.crm_rows;
CREATE TRIGGER crm_rows_set_updated_at
  BEFORE UPDATE ON public.crm_rows
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- Row Level Security ----------
ALTER TABLE public.crm_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_rows ENABLE ROW LEVEL SECURITY;

-- crm_tables
DROP POLICY IF EXISTS "crm_tables_select" ON public.crm_tables;
CREATE POLICY "crm_tables_select"
  ON public.crm_tables FOR SELECT
  TO authenticated
  USING (public.has_perm('crm', 'view'));

DROP POLICY IF EXISTS "crm_tables_insert" ON public.crm_tables;
CREATE POLICY "crm_tables_insert"
  ON public.crm_tables FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_perm('crm', 'edit')
    AND (created_by = auth.uid() OR created_by IS NULL)
  );

DROP POLICY IF EXISTS "crm_tables_update" ON public.crm_tables;
CREATE POLICY "crm_tables_update"
  ON public.crm_tables FOR UPDATE
  TO authenticated
  USING (public.has_perm('crm', 'edit'))
  WITH CHECK (public.has_perm('crm', 'edit'));

DROP POLICY IF EXISTS "crm_tables_delete" ON public.crm_tables;
CREATE POLICY "crm_tables_delete"
  ON public.crm_tables FOR DELETE
  TO authenticated
  USING (public.has_perm('crm', 'edit'));

-- crm_columns
DROP POLICY IF EXISTS "crm_columns_select" ON public.crm_columns;
CREATE POLICY "crm_columns_select"
  ON public.crm_columns FOR SELECT
  TO authenticated
  USING (public.has_perm('crm', 'view'));

DROP POLICY IF EXISTS "crm_columns_insert" ON public.crm_columns;
CREATE POLICY "crm_columns_insert"
  ON public.crm_columns FOR INSERT
  TO authenticated
  WITH CHECK (public.has_perm('crm', 'edit'));

DROP POLICY IF EXISTS "crm_columns_update" ON public.crm_columns;
CREATE POLICY "crm_columns_update"
  ON public.crm_columns FOR UPDATE
  TO authenticated
  USING (public.has_perm('crm', 'edit'))
  WITH CHECK (public.has_perm('crm', 'edit'));

DROP POLICY IF EXISTS "crm_columns_delete" ON public.crm_columns;
CREATE POLICY "crm_columns_delete"
  ON public.crm_columns FOR DELETE
  TO authenticated
  USING (public.has_perm('crm', 'edit'));

-- crm_rows
DROP POLICY IF EXISTS "crm_rows_select" ON public.crm_rows;
CREATE POLICY "crm_rows_select"
  ON public.crm_rows FOR SELECT
  TO authenticated
  USING (public.has_perm('crm', 'view'));

DROP POLICY IF EXISTS "crm_rows_insert" ON public.crm_rows;
CREATE POLICY "crm_rows_insert"
  ON public.crm_rows FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_perm('crm', 'edit')
    AND (created_by = auth.uid() OR created_by IS NULL)
  );

DROP POLICY IF EXISTS "crm_rows_update" ON public.crm_rows;
CREATE POLICY "crm_rows_update"
  ON public.crm_rows FOR UPDATE
  TO authenticated
  USING (public.has_perm('crm', 'edit'))
  WITH CHECK (public.has_perm('crm', 'edit'));

DROP POLICY IF EXISTS "crm_rows_delete" ON public.crm_rows;
CREATE POLICY "crm_rows_delete"
  ON public.crm_rows FOR DELETE
  TO authenticated
  USING (public.has_perm('crm', 'edit'));
