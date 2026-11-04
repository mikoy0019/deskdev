-- ============================================
-- DeskDev Studio — 021: a vault reset no longer destroys data
--
-- Before: "Reset & start over" deleted every item, folder and the key meta.
-- A forgotten master password therefore cost the credentials permanently.
--
-- After: a reset ARCHIVES the current generation. The ciphertext stays exactly
-- where it is, tied to the vault_meta row whose key can open it, and a fresh
-- active generation is created alongside. If the old password resurfaces, the
-- archive can be decrypted and folded back in; deleting it stays possible, but
-- only as an explicit, separate choice.
--
-- "Generation" = one vault_meta row (salt + wrapped data key) plus every folder
-- and item encrypted under its data key. Exactly one generation is active.
-- ============================================

-- ---------- vault_meta: many generations, one active ----------
alter table public.vault_meta add column if not exists archived_at timestamptz;

-- The old design allowed exactly one row via `singleton boolean unique`.
-- Archived generations need to sit beside the active one, so that constraint
-- goes and a partial unique index takes over: any number of archived rows,
-- never more than one un-archived.
alter table public.vault_meta drop constraint if exists vault_meta_singleton_key;
alter table public.vault_meta drop column if exists singleton;

create unique index if not exists vault_meta_one_active
  on public.vault_meta ((true)) where archived_at is null;

create index if not exists vault_meta_archived_idx on public.vault_meta (archived_at);

-- ---------- folders and items belong to a generation ----------
-- ON DELETE CASCADE makes "delete this archive permanently" a single row
-- delete: dropping the meta drops the data only its key could ever open.
alter table public.vault_folders add column if not exists meta_id uuid
  references public.vault_meta (id) on delete cascade;
alter table public.vault_items add column if not exists meta_id uuid
  references public.vault_meta (id) on delete cascade;

-- Existing rows predate generations: they belong to the one meta that exists.
update public.vault_folders f
   set meta_id = (select m.id from public.vault_meta m where m.archived_at is null limit 1)
 where f.meta_id is null;

update public.vault_items i
   set meta_id = (select m.id from public.vault_meta m where m.archived_at is null limit 1)
 where i.meta_id is null;

create index if not exists vault_folders_meta_idx on public.vault_folders (meta_id);
create index if not exists vault_items_meta_idx   on public.vault_items (meta_id);

-- ---------- archive, instead of delete ----------
-- Runs as the caller (no SECURITY DEFINER): the admin-only RLS policies on
-- vault_meta still decide who may do this.
create or replace function public.archive_vault()
returns uuid
language plpgsql
set search_path = public
as $$
declare archived uuid;
begin
  update public.vault_meta
     set archived_at = now()
   where archived_at is null
  returning id into archived;

  return archived;   -- null when there was no active generation
end;
$$;

-- Policies from 008 are FOR ALL on each table and still cover the new columns;
-- nothing here widens access. Every row remains admins-only.
