-- 057: the CRM sheet (revision 4). A column may hold a person (a user id in
-- the row's values) or a formula (worked out per row in the app from the
-- row's other cells; nothing is stored in rows for it), and keeps the width
-- someone dragged it to. RLS of 004 already covers these columns. Re-runnable.

BEGIN;

ALTER TABLE public.crm_columns ADD COLUMN IF NOT EXISTS width integer;
ALTER TABLE public.crm_columns ADD COLUMN IF NOT EXISTS formula text;

ALTER TABLE public.crm_columns DROP CONSTRAINT IF EXISTS crm_columns_type_check;
ALTER TABLE public.crm_columns ADD CONSTRAINT crm_columns_type_check
  CHECK (type IN ('text', 'number', 'select', 'multi_select', 'date', 'checkbox', 'url', 'person', 'formula'));

ALTER TABLE public.crm_columns DROP CONSTRAINT IF EXISTS crm_columns_width_check;
ALTER TABLE public.crm_columns ADD CONSTRAINT crm_columns_width_check
  CHECK (width IS NULL OR width BETWEEN 80 AND 800);

ALTER TABLE public.crm_columns DROP CONSTRAINT IF EXISTS crm_columns_formula_check;
ALTER TABLE public.crm_columns ADD CONSTRAINT crm_columns_formula_check
  CHECK (formula IS NULL OR length(formula) <= 2000);

COMMIT;
