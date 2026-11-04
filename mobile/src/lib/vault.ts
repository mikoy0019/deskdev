// Vault data access + TOTP MFA helpers. Mirrors site/src/deskdev/lib/vault.ts. Talks to
// Supabase DIRECTLY (never the persisted store) so ciphertext/plaintext never
// land in AsyncStorage. All rows are admin-only via RLS.
import { supabase } from './supabase'
import type { VaultMeta } from './vaultCrypto'

export interface VaultMetaRow {
  id: string; salt: string; iterations: number; wrapped_key: string
  /** Null on the one active generation; set when a reset archived it. */
  archived_at: string | null
  created_at: string
}
export interface VaultFolderRow { id: string; meta_id: string; client_id: string | null; name_enc: string; created_at: string; updated_at: string }
export interface VaultItemRow { id: string; meta_id: string; folder_id: string; item_type: string; title_enc: string; data_enc: string; created_at: string; updated_at: string }

async function uid(): Promise<string | undefined> {
  return (await supabase.auth.getUser()).data.user?.id
}

// ── meta (salt + wrapped data key) ─────────────────────────────────────────────
/**
 * Whether an active generation exists, WITHOUT reading its salt or wrapped key
 * (the setup-vs-locked question is asked before the TOTP step). The RPC comes
 * with migration 030; until it is applied the direct read answers instead.
 */
export async function vaultHasActiveMeta(): Promise<boolean> {
  const { data, error } = await supabase.rpc('vault_has_active_meta')
  if (!error) return data === true
  if (error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(error.message ?? '')) {
    return (await getVaultMeta()) !== null
  }
  throw new Error(error.message)
}

/** True once this session has passed the TOTP step (Supabase AAL2). */
export async function sessionIsAal2(): Promise<boolean> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (error) return false
  return data.currentLevel === 'aal2'
}

/** The active generation. Archived ones (from a reset) are excluded.
 *  Call only after verifyTotp: migration 031 hides vault_meta below aal2. */
export async function getVaultMeta(): Promise<VaultMetaRow | null> {
  const { data, error } = await supabase.from('vault_meta').select('*').is('archived_at', null).limit(1).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as VaultMetaRow) ?? null
}
export async function createVaultMeta(meta: VaultMeta): Promise<VaultMetaRow> {
  const { data, error } = await supabase.from('vault_meta').insert({
    salt: meta.salt, iterations: meta.iterations, wrapped_key: meta.wrappedKey,
  }).select().single()
  if (error) throw new Error(error.message)
  return data as VaultMetaRow
}

// ── folders ────────────────────────────────────────────────────────────────────
export async function listFolders(metaId: string): Promise<VaultFolderRow[]> {
  const { data, error } = await supabase.from('vault_folders').select('*').eq('meta_id', metaId).order('created_at')
  if (error) throw new Error(error.message)
  return (data as VaultFolderRow[]) ?? []
}
export async function createFolder(metaId: string, clientId: string | null, nameEnc: string): Promise<VaultFolderRow> {
  const { data, error } = await supabase.from('vault_folders')
    .insert({ meta_id: metaId, client_id: clientId, name_enc: nameEnc, created_by: await uid() }).select().single()
  if (error) throw new Error(error.message)
  return data as VaultFolderRow
}
export async function renameFolder(id: string, nameEnc: string): Promise<void> {
  const { error } = await supabase.from('vault_folders').update({ name_enc: nameEnc }).eq('id', id)
  if (error) throw new Error(error.message)
}
export async function deleteFolder(id: string): Promise<void> {
  const { error } = await supabase.from('vault_folders').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ── items ──────────────────────────────────────────────────────────────────────
export async function listItems(metaId: string): Promise<VaultItemRow[]> {
  const { data, error } = await supabase.from('vault_items').select('*').eq('meta_id', metaId).order('created_at')
  if (error) throw new Error(error.message)
  return (data as VaultItemRow[]) ?? []
}
export async function createItem(input: {
  metaId: string; folderId: string; itemType: string; titleEnc: string; dataEnc: string
}): Promise<VaultItemRow> {
  const { data, error } = await supabase.from('vault_items').insert({
    meta_id: input.metaId, folder_id: input.folderId, item_type: input.itemType,
    title_enc: input.titleEnc, data_enc: input.dataEnc, created_by: await uid(),
  }).select().single()
  if (error) throw new Error(error.message)
  return data as VaultItemRow
}
export async function updateItem(id: string, patch: {
  itemType?: string; titleEnc?: string; dataEnc?: string
}): Promise<void> {
  const row: Record<string, unknown> = {}
  if (patch.itemType !== undefined) row.item_type = patch.itemType
  if (patch.titleEnc !== undefined) row.title_enc = patch.titleEnc
  if (patch.dataEnc !== undefined) row.data_enc = patch.dataEnc
  const { error } = await supabase.from('vault_items').update(row).eq('id', id)
  if (error) throw new Error(error.message)
}
export async function deleteItem(id: string): Promise<void> {
  const { error } = await supabase.from('vault_items').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ── TOTP MFA (the vault's second factor) ────────────────────────────────────────
export interface TotpEnrollment { factorId: string; qrCode: string; secret: string; uri: string }

/**
 * What the authenticator app shows above the code. Supabase falls back to the
 * host of the project's Site URL when this is omitted — which reads as
 * "localhost:5173" for anyone who enrolled from a dev server. Must stay in sync
 * with TOTP_ISSUER in site/src/deskdev/lib/vault.ts so both clients enroll one label.
 */
export const TOTP_ISSUER = 'DeskDev Studio'

export async function getVerifiedTotpFactorId(): Promise<string | null> {
  const { data, error } = await supabase.auth.mfa.listFactors()
  if (error) throw new Error(error.message)
  return data.totp.find((f) => f.status === 'verified')?.id ?? null
}

export async function enrollTotp(): Promise<TotpEnrollment> {
  const { data: list } = await supabase.auth.mfa.listFactors()
  for (const f of list?.totp ?? []) {
    if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id })
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', issuer: TOTP_ISSUER })
  if (error) throw new Error(error.message)
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri }
}

export async function verifyTotp(factorId: string, code: string): Promise<void> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() })
  if (error) throw new Error(error.message)
}

/** Email a magic recovery LINK (built-in email; no SMTP needed). Clicking it on
 *  the web app finishes the vault reset. */
export async function sendRecoveryLink(email: string, redirectTo: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
  })
  if (error) throw new Error(error.message)
}

/**
 * Resetting the vault needs the vault owner's emailed approval code, and the
 * archive itself happens in the `vault-reset` Edge Function. That flow is
 * web-only for now — mobile would need a code-entry screen it does not have —
 * so this client can no longer reset anything. It never deletes vault data:
 * since migration 021 a reset archives, and since 022 only the Edge Function
 * may do it.
 */
export async function resetVault(): Promise<never> {
  throw new Error('Resetting the vault needs owner approval — do it from the DeskDev web app.')
}
