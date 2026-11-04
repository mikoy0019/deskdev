-- ============================================
-- DeskDev Studio — 022: vault resets need owner approval
--
-- Archiving the vault (021) is no longer something an admin can do alone. A
-- reset now requires a 6-digit code emailed to the vault owner, so one admin
-- cannot lock everyone else out of the credential store on their own.
--
--   vault_settings     who approves (one owner email)
--   vault_reset_codes  outstanding codes — hashed, short-lived, single-use
--
-- Codes are verified by the `vault-reset` Edge Function under the service role.
-- No client ever reads this table: RLS is on with NO policies, which denies
-- every authenticated request while leaving the service role unaffected.
-- ============================================

-- ---------- who approves ----------
create table if not exists public.vault_settings (
  id          uuid primary key default gen_random_uuid(),
  owner_email text,
  singleton   boolean not null default true unique,   -- exactly one row
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

insert into public.vault_settings (owner_email)
select null
where not exists (select 1 from public.vault_settings);

drop trigger if exists vault_settings_set_updated_at on public.vault_settings;
create trigger vault_settings_set_updated_at before update on public.vault_settings
  for each row execute function public.set_updated_at();

alter table public.vault_settings enable row level security;

-- Admins read and set the owner address; nobody else sees it.
drop policy if exists "vault_settings_admin_all" on public.vault_settings;
create policy "vault_settings_admin_all" on public.vault_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- outstanding reset codes ----------
create table if not exists public.vault_reset_codes (
  id           uuid primary key default gen_random_uuid(),
  -- SHA-256 of the 6 digits. The code itself exists only in the owner's inbox.
  code_hash    text        not null,
  requested_by uuid        references public.profiles (id) on delete set null,
  sent_to      text        not null,
  attempts     int         not null default 0,
  expires_at   timestamptz not null,
  used_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists vault_reset_codes_open_idx
  on public.vault_reset_codes (expires_at) where used_at is null;

-- RLS on, zero policies: unreachable from the anon and authenticated roles.
-- Only the service-role Edge Function touches it.
alter table public.vault_reset_codes enable row level security;

-- Archiving is now the Edge Function's job (after it verifies a code), so the
-- direct RPC from 021 is withdrawn from clients. The function itself runs as
-- the service role and is unaffected by this revoke.
revoke all on function public.archive_vault() from public, anon, authenticated;
