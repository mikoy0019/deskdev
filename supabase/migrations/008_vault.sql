-- 008_vault.sql
-- Encrypted per-client credential vault. ADMINS ONLY.
--
-- Zero-knowledge: the server stores ONLY ciphertext. Folder names, item titles,
-- and item field data are AES-256-GCM encrypted on the client with a data key
-- that is itself wrapped by a PBKDF2 key derived from the vault master password
-- — which never reaches Supabase. `vault_meta` holds the salt + wrapped key so
-- any admin device can derive the same data key from the shared master password.

-- ---------- vault_meta (single row: salt + wrapped data key) ----------
create table if not exists public.vault_meta (
  id          uuid primary key default gen_random_uuid(),
  salt        text not null,
  iterations  int  not null,
  wrapped_key text not null,
  singleton   boolean not null default true unique,   -- enforces exactly one row
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- vault_folders (per client, or standalone) ----------
create table if not exists public.vault_folders (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid references public.clients(id) on delete set null,
  name_enc   text not null,                             -- encrypted folder name
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vault_folders_client_idx on public.vault_folders (client_id);

-- ---------- vault_items (title + field blob, both encrypted) ----------
create table if not exists public.vault_items (
  id         uuid primary key default gen_random_uuid(),
  folder_id  uuid not null references public.vault_folders(id) on delete cascade,
  item_type  text not null default 'login',             -- plaintext icon hint only
  title_enc  text not null,                             -- encrypted title
  data_enc   text not null,                             -- encrypted JSON of fields
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vault_items_folder_idx on public.vault_items (folder_id);

-- ---------- updated_at triggers ----------
drop trigger if exists vault_meta_set_updated_at on public.vault_meta;
create trigger vault_meta_set_updated_at before update on public.vault_meta
  for each row execute function public.set_updated_at();

drop trigger if exists vault_folders_set_updated_at on public.vault_folders;
create trigger vault_folders_set_updated_at before update on public.vault_folders
  for each row execute function public.set_updated_at();

drop trigger if exists vault_items_set_updated_at on public.vault_items;
create trigger vault_items_set_updated_at before update on public.vault_items
  for each row execute function public.set_updated_at();

-- ---------- Row Level Security: ADMINS ONLY, every operation ----------
alter table public.vault_meta    enable row level security;
alter table public.vault_folders enable row level security;
alter table public.vault_items   enable row level security;

drop policy if exists "vault_meta_admin_all" on public.vault_meta;
create policy "vault_meta_admin_all" on public.vault_meta
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "vault_folders_admin_all" on public.vault_folders;
create policy "vault_folders_admin_all" on public.vault_folders
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "vault_items_admin_all" on public.vault_items;
create policy "vault_items_admin_all" on public.vault_items
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
