// Vault data access + TOTP MFA helpers. Talks to Supabase DIRECTLY (never the
// persisted zustand store) so decrypted secrets and ciphertext never land in
// localStorage/AsyncStorage. All rows are admin-only via RLS; every string
// field here is already-encrypted ciphertext.
import { supabase } from './supabase'
import { decryptString, encryptString, unlockDataKey, type VaultMeta } from './vaultCrypto'

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
//
// A vault has one ACTIVE generation and any number of ARCHIVED ones. A reset
// archives rather than deletes (migration 021), so the ciphertext of a previous
// master password survives and can be folded back in later.

/**
 * Whether an active generation exists, WITHOUT reading its salt or wrapped key
 * — the phase question (setup vs locked) is asked before the TOTP step. The
 * vault_has_active_meta() RPC arrives with migration 030; until that is
 * applied the old direct read answers it instead.
 */
export async function vaultHasActiveMeta(): Promise<boolean> {
  const { data, error } = await supabase.rpc('vault_has_active_meta')
  if (!error) return data === true
  if (isMissingFunction(error)) return (await getVaultMeta()) !== null
  throw new Error(error.message)
}

/** PostgREST's "no such function" (the migration that adds it isn't applied yet). */
export function isMissingFunction(error: { code?: string; message?: string }): boolean {
  return error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(error.message ?? '')
}

/** True once this session has passed the TOTP step (Supabase AAL2). */
export async function sessionIsAal2(): Promise<boolean> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (error) return false
  return data.currentLevel === 'aal2'
}

/**
 * The active generation, or null when the vault has never been set up.
 * Holds the salt + wrapped key, so call it only AFTER verifyTotp: migration 031
 * hides vault_meta from sessions below aal2 (it then reads as null).
 */
export async function getVaultMeta(): Promise<VaultMetaRow | null> {
  const { data, error } = await supabase.from('vault_meta')
    .select('*').is('archived_at', null).limit(1).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as VaultMetaRow) ?? null
}

/** Generations left behind by earlier resets, newest first. */
export async function listArchivedMetas(): Promise<VaultMetaRow[]> {
  const { data, error } = await supabase.from('vault_meta')
    .select('*').not('archived_at', 'is', null).order('archived_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data as VaultMetaRow[]) ?? []
}

/** How much is sitting in an archived generation — drives the restore banner. */
export async function countArchivedItems(metaId: string): Promise<number> {
  const { count, error } = await supabase.from('vault_items')
    .select('id', { count: 'exact', head: true }).eq('meta_id', metaId)
  if (error) throw new Error(error.message)
  return count ?? 0
}

export async function createVaultMeta(meta: VaultMeta): Promise<VaultMetaRow> {
  const { data, error } = await supabase.from('vault_meta').insert({
    salt: meta.salt, iterations: meta.iterations, wrapped_key: meta.wrappedKey,
  }).select().single()
  if (error) throw new Error(error.message)
  return data as VaultMetaRow
}

// ── folders ────────────────────────────────────────────────────────────────────
/** Folders of one generation. Always scoped: another generation's rows are
 *  encrypted with a different data key and would fail to decrypt. */
export async function listFolders(metaId: string): Promise<VaultFolderRow[]> {
  const { data, error } = await supabase.from('vault_folders')
    .select('*').eq('meta_id', metaId).order('created_at')
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
  const { data, error } = await supabase.from('vault_items')
    .select('*').eq('meta_id', metaId).order('created_at')
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
 * "localhost:5173" for anyone who enrolled from a dev server, and would drift
 * again on every domain change. Pinning it keeps one stable label everywhere.
 */
export const TOTP_ISSUER = 'DeskDev Studio'

/** The id of a verified TOTP factor, or null if none is set up yet. */
export async function getVerifiedTotpFactorId(): Promise<string | null> {
  const { data, error } = await supabase.auth.mfa.listFactors()
  if (error) throw new Error(error.message)
  return data.totp.find((f) => f.status === 'verified')?.id ?? null
}

/** Begin TOTP enrollment (clears half-finished ones first). Returns QR + secret. */
export async function enrollTotp(): Promise<TotpEnrollment> {
  const { data: list } = await supabase.auth.mfa.listFactors()
  for (const f of list?.totp ?? []) {
    if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id })
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', issuer: TOTP_ISSUER })
  if (error) throw new Error(error.message)
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri }
}

/** Challenge + verify a 6-digit code — used to confirm enrollment AND to unlock. */
export async function verifyTotp(factorId: string, code: string): Promise<void> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() })
  if (error) throw new Error(error.message)
}

/** Who approves a vault reset. Null until an admin sets it. */
export async function getVaultOwnerEmail(): Promise<string | null> {
  const { data, error } = await supabase.from('vault_settings').select('owner_email').limit(1).maybeSingle()
  if (error) throw new Error(error.message)
  return (data?.owner_email as string | null) ?? null
}

/**
 * Hand the approval address over. The one settings row is seeded by the
 * migrations (022/030), so this only ever updates it. RLS (030) lets the update
 * through only at aal2, and only while the address is unset or is the caller's
 * own; a refused update matches no rows rather than erroring, so 0 rows back
 * means it did NOT save.
 */
export async function setVaultOwnerEmail(email: string): Promise<void> {
  const { data, error } = await supabase.from('vault_settings')
    .update({ owner_email: email }).eq('singleton', true).select('id')
  if (error) throw new Error(error.message)
  if (!data?.length) {
    throw new Error('Not saved: only the current approval address can hand it over, from an unlocked vault.')
  }
}

/**
 * Ask the vault owner to approve a reset: the `vault-reset` Edge Function mails
 * them a 6-digit code. Returns the masked address it went to, so the requester
 * knows who to chase without learning the full address.
 */
export async function requestVaultResetCode(): Promise<{ sentTo: string; expiresMinutes: number }> {
  const { data, error } = await supabase.functions.invoke('vault-reset', { body: { action: 'request' } })
  if (error) throw new Error(await edgeMessage(error, 'Could not send the approval code'))
  return { sentTo: data.sent_to as string, expiresMinutes: data.expires_minutes as number }
}

/** Submit the owner's code. On success the vault is archived server-side. */
export async function confirmVaultReset(code: string): Promise<void> {
  const { error } = await supabase.functions.invoke('vault-reset', { body: { action: 'verify', code } })
  if (error) throw new Error(await edgeMessage(error, 'Could not verify the code'))
}

/**
 * supabase-js turns a non-2xx Edge Function reply into an opaque
 * FunctionsHttpError; the useful sentence is in the response body.
 */
async function edgeMessage(error: unknown, fallback: string): Promise<string> {
  const ctx = (error as { context?: Response }).context
  try {
    const body = (await ctx?.clone().json()) as { error?: string } | undefined
    if (body?.error) return body.error
  } catch { /* not JSON — fall through */ }
  return (error as Error)?.message || fallback
}

/**
 * Finish a reset the owner has already approved: unlink the authenticator so
 * the next admin enrolls afresh. The archive itself happened server-side in the
 * `vault-reset` Edge Function — a client cannot archive on its own (022). The ciphertext stays in place against its
 * old vault_meta row, so an admin who later remembers the previous master
 * password can restore it with `restoreArchivedGeneration`. Deleting is a
 * separate, explicit act (`deleteArchivedGeneration`).
 */
export async function resetVault(opts?: { factorId?: string | null; code?: string }): Promise<void> {
  // A current code steps the session up to AAL2 so the verified authenticator
  // can actually be unlinked (otherwise Supabase refuses to unenroll it).
  if (opts?.factorId && opts?.code) {
    try { await verifyTotp(opts.factorId, opts.code) } catch { /* unenroll below may still work */ }
  }
  try {
    const { data } = await supabase.auth.mfa.listFactors()
    for (const f of data?.all ?? []) {
      try { await supabase.auth.mfa.unenroll({ factorId: f.id }) } catch { /* AAL2 not reached */ }
    }
  } catch { /* ignore — the vault is already archived */ }
}

/**
 * Fold an archived generation back into the active one: decrypt each folder and
 * item with the old master password, re-encrypt under the current data key, then
 * drop the archived meta (its now-duplicated rows cascade away).
 *
 * Returns how many items were brought across. Throws `Wrong master password`
 * before touching anything if the old password does not unwrap the archive.
 */
export async function restoreArchivedGeneration(input: {
  archived: VaultMetaRow
  oldPassword: string
  activeMetaId: string
  activeDataKey: Uint8Array
}): Promise<number> {
  const { archived, oldPassword, activeMetaId, activeDataKey } = input

  // Throws on a wrong password — nothing is written before this succeeds.
  const oldKey = unlockDataKey(oldPassword, {
    salt: archived.salt, iterations: archived.iterations, wrappedKey: archived.wrapped_key,
  })

  const [folders, items] = await Promise.all([listFolders(archived.id), listItems(archived.id)])

  // Old folder id → new folder id, so items land under the right folder.
  const remapped = new Map<string, string>()
  for (const f of folders) {
    const name = decryptString(oldKey, f.name_enc)
    const created = await createFolder(activeMetaId, f.client_id, encryptString(activeDataKey, name))
    remapped.set(f.id, created.id)
  }

  let restored = 0
  for (const i of items) {
    const folderId = remapped.get(i.folder_id)
    if (!folderId) continue   // orphan: its folder was already gone
    await createItem({
      metaId: activeMetaId,
      folderId,
      itemType: i.item_type,
      titleEnc: encryptString(activeDataKey, decryptString(oldKey, i.title_enc)),
      dataEnc: encryptString(activeDataKey, decryptString(oldKey, i.data_enc)),
    })
    restored++
  }

  // Everything is duplicated into the active generation; drop the archive.
  await deleteArchivedGeneration(archived.id)
  return restored
}

/** Permanently delete one archived generation. Cascades to its folders and items. */
export async function deleteArchivedGeneration(metaId: string): Promise<void> {
  const { error } = await supabase.from('vault_meta').delete().eq('id', metaId).not('archived_at', 'is', null)
  if (error) throw new Error(error.message)
}

// ── vault accounts (060) ───────────────────────────────────────────────────────
//
// One key slot per admin wraps the active generation's data key under that
// admin's own vault password (kind 'password'), or under a one-time invite
// code another admin handed over (kind 'invite'). Read only at aal2, and
// only your own: the unlock screen asks vault_my_access() which form to show.

export type VaultAccessKind = 'password' | 'invite'

export interface VaultSlotRow {
  id: string; meta_id: string; user_id: string; kind: VaultAccessKind
  salt: string; iterations: number; wrapped_key: string
  created_by: string | null; created_at: string; updated_at: string
}

/** Before the TOTP step: 'password', 'invite' or null (use the master password). */
export async function myVaultAccess(): Promise<VaultAccessKind | null> {
  const { data, error } = await supabase.rpc('vault_my_access')
  if (error) {
    if (isMissingFunction(error)) return null // 060 not applied: master password only
    throw new Error(error.message)
  }
  return data === 'password' || data === 'invite' ? data : null
}

/** Your own slot of a generation (aal2), or null. */
export async function getMySlot(metaId: string): Promise<VaultSlotRow | null> {
  const me = await uid()
  if (!me) return null
  const { data, error } = await supabase.from('vault_key_slots')
    .select('*').eq('meta_id', metaId).eq('user_id', me).maybeSingle()
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return null
    throw new Error(error.message)
  }
  return (data as VaultSlotRow) ?? null
}

/** Save your own vault password: a new slot, or a new wrap on yours (also claims an invite). */
export async function saveMySlot(metaId: string, meta: VaultMeta, existing: VaultSlotRow | null): Promise<void> {
  const row = { kind: 'password' as const, salt: meta.salt, iterations: meta.iterations, wrapped_key: meta.wrappedKey }
  if (existing) {
    const { data, error } = await supabase.from('vault_key_slots').update(row).eq('id', existing.id).select('id')
    if (error) throw new Error(error.message)
    if (!data?.length) throw new Error('Your vault account could not be saved. Reload and try again.')
    return
  }
  const me = await uid()
  const { error } = await supabase.from('vault_key_slots').insert({ ...row, meta_id: metaId, user_id: me, created_by: me })
  if (error) throw new Error(error.message)
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** A one-time invite code: 10 characters (50 bits), shown as XXXXX-XXXXX. */
export function newInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  const chars = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
  return `${chars.slice(0, 5).join('')}-${chars.slice(5).join('')}`
}

/** How a typed code is compared: capitals, no spaces or dashes. */
export function normalizeInviteCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** An invite slot for another admin, wrapped under `wrapped` (made from the code). */
export async function createInviteSlot(metaId: string, userId: string, wrapped: VaultMeta): Promise<void> {
  const me = await uid()
  const { error } = await supabase.from('vault_key_slots').insert({
    meta_id: metaId, user_id: userId, kind: 'invite', created_by: me,
    salt: wrapped.salt, iterations: wrapped.iterations, wrapped_key: wrapped.wrappedKey,
  })
  if (error) throw new Error(/duplicate key|unique/i.test(error.message) ? 'They already have access. Remove it first to send a new invite.' : error.message)
}

export interface VaultAccessEntry { user_id: string; kind: VaultAccessKind; created_by: string | null; created_at: string }

/** Who can open the active generation, without any key material. */
export async function listVaultAccess(): Promise<VaultAccessEntry[]> {
  const { data, error } = await supabase.rpc('vault_access_list')
  if (error) {
    if (isMissingFunction(error)) return []
    throw new Error(error.message)
  }
  return (data as VaultAccessEntry[]) ?? []
}

/** Take an admin's access away, or cancel their invite. */
export async function removeVaultAccess(userId: string): Promise<void> {
  const { error } = await supabase.rpc('vault_remove_access', { p_user: userId })
  if (error) throw new Error(error.message)
}
