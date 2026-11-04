import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  ArchiveIcon, ArrowsClockwiseIcon, BracketsCurlyIcon, CaretRightIcon, DatabaseIcon, EnvelopeSimpleIcon,
  EyeIcon, EyeSlashIcon, FolderIcon, FolderOpenIcon, FolderSimplePlusIcon, HardDrivesIcon, type Icon,
  KeyIcon, LockIcon, LockSimpleIcon, LockSimpleOpenIcon, NoteIcon, PlugsConnectedIcon, PlusIcon,
  ShieldCheckIcon, SignInIcon, TrashIcon, UserPlusIcon, UsersThreeIcon, XIcon,
} from '@phosphor-icons/react'
import Layout from '../components/Layout'
import { EmptyState } from '../components/ui-foundation'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import { ClientSelect } from '../components/pickers'
import { IndicatorGroup, LayoutIndicator, Skeleton, useStagger } from '../components/motion'
import {
  CopyGlyph, FieldError, FormField, IconTile, INPUT_INVALID, Notice, useCopied, useHeldWhile,
} from '../components/settings/formKit'
import { useResetOnChange } from '../lib/useResetOnChange'
import { useStore, useCurrentUser } from '../store/useStore'
import { classNames, fmtDate } from '../lib/format'
import {
  initVaultKeys, unlockDataKey, encryptString, decryptString, rewrapDataKey,
} from '../lib/vaultCrypto'
import {
  getVaultMeta, vaultHasActiveMeta, sessionIsAal2, createVaultMeta, listFolders, createFolder, deleteFolder,
  listItems, createItem, updateItem, deleteItem, getVerifiedTotpFactorId, enrollTotp, verifyTotp, resetVault,
  listArchivedMetas, countArchivedItems, restoreArchivedGeneration, deleteArchivedGeneration,
  getVaultOwnerEmail, setVaultOwnerEmail, requestVaultResetCode, confirmVaultReset,
  myVaultAccess, getMySlot, saveMySlot, newInviteCode, normalizeInviteCode, createInviteSlot, listVaultAccess,
  removeVaultAccess,
  type VaultFolderRow, type VaultItemRow, type VaultMetaRow, type TotpEnrollment, type VaultAccessKind,
  type VaultAccessEntry, type VaultSlotRow,
} from '../lib/vault'
import { isSupabaseConfigured } from '../lib/supabase'

type Phase = 'loading' | 'no-admin' | 'no-backend' | 'enroll' | 'setup' | 'locked' | 'unlocked'

interface Field { id: string; label: string; value: string; secret: boolean }
interface VaultFolder { id: string; clientId: string | null; name: string }
interface Item { id: string; folderId: string; type: string; title: string; fields: Field[] }

const ITEM_TYPES: { value: string; label: string; icon: Icon; seed: { label: string; secret: boolean }[] }[] = [
  { value: 'login', label: 'Login', icon: KeyIcon, seed: [{ label: 'Username', secret: false }, { label: 'Password', secret: true }] },
  { value: 'api', label: 'API Key', icon: BracketsCurlyIcon, seed: [{ label: 'API Key', secret: true }] },
  { value: 'oauth', label: 'OAuth', icon: PlugsConnectedIcon, seed: [{ label: 'Client ID', secret: false }, { label: 'Client Secret', secret: true }] },
  { value: 'database', label: 'Database', icon: DatabaseIcon, seed: [{ label: 'Host', secret: false }, { label: 'Username', secret: false }, { label: 'Password', secret: true }] },
  { value: 'server', label: 'Server / SSH', icon: HardDrivesIcon, seed: [{ label: 'Host', secret: false }, { label: 'Username', secret: false }, { label: 'Password', secret: true }] },
  { value: 'note', label: 'Secure Note', icon: NoteIcon, seed: [] },
]
const typeMeta = (t: string) => ITEM_TYPES.find((x) => x.value === t)
const genId = () => crypto.randomUUID()

/** The 6-digit authenticator / approval code field: mono, spaced, numeric keypad, OTP autofill. */
const CODE_INPUT = classNames('input w-full text-center font-mono text-base tracking-[0.4em] tabular-nums', INPUT_INVALID)

export default function Vault() {
  const user = useCurrentUser()
  const clients = useStore((s) => s.clients)
  const isAdmin = user?.role === 'admin'

  const [phase, setPhase] = useState<Phase>('loading')
  // Whether an active generation exists. Its salt + wrapped key are read only
  // after the TOTP step (UnlockGate), never while the vault is locked.
  const [hasMeta, setHasMeta] = useState(false)
  // The active generation's row — its id tags everything written from here.
  const [metaRow, setMetaRow] = useState<VaultMetaRow | null>(null)
  const [factorId, setFactorId] = useState<string | null>(null)
  // Revision 6: your own vault account ('password'), an invite to claim, or
  // neither (the master password). Asked before the TOTP step; no secrets.
  const [access, setAccess] = useState<VaultAccessKind | null>(null)
  const [dataKey, setDataKey] = useState<Uint8Array | null>(null)
  const [resetCode, setResetCode] = useState<string | null>(null)

  const clientName = (id: string | null) => clients.find((c) => c.id === id)?.name ?? null

  // No backend / not an admin are facts of this render, not fetched state, so
  // they gate the view directly instead of being copied into `phase`.
  const view: Phase = !isSupabaseConfigured ? 'no-backend' : !isAdmin ? 'no-admin' : phase
  // Losing admin mid-session (a role change) drops the unlocked key at once.
  if (!isAdmin && dataKey) setDataKey(null)

  const applyServerState = useCallback((fid: string | null, active: boolean, mine: VaultAccessKind | null = null) => {
    setFactorId(fid)
    setAccess(mine)
    setMetaRow(null)
    setHasMeta(active)
    setPhase(!fid ? 'enroll' : !active ? 'setup' : 'locked')
  }, [])

  // Re-read the server state after a reset (event path; the effect below covers mount).
  const bootstrap = useCallback(async () => {
    setDataKey(null)
    if (!isSupabaseConfigured || !isAdmin) return
    setPhase('loading')
    try {
      const [fid, active, mine] = await Promise.all([getVerifiedTotpFactorId(), vaultHasActiveMeta(), myVaultAccess().catch(() => null)])
      applyServerState(fid, active, mine)
    } catch (e) {
      toast.error(`Vault: ${(e as Error).message}`)
    }
  }, [isAdmin, applyServerState])

  useEffect(() => {
    if (!isSupabaseConfigured || !isAdmin) return
    let live = true
    Promise.all([getVerifiedTotpFactorId(), vaultHasActiveMeta(), myVaultAccess().catch(() => null)]).then(
      ([fid, active, mine]) => { if (live) applyServerState(fid, active, mine) },
      (e: unknown) => { if (live) toast.error(`Vault: ${(e as Error).message}`) },
    )
    return () => { live = false }
  }, [isAdmin, applyServerState])

  // The old magic-link recovery (/vault?recover=1) is gone: proving control of
  // your own inbox is no longer enough to reset the vault. A reset now needs a
  // code emailed to the vault owner — see UnlockGate's approval flow.

  const startOver = async (code: string | null) => {
    try { await resetVault({ factorId, code: code ?? undefined }); toast.success('Vault reset — starting fresh'); await bootstrap() }
    catch (e) { toast.error((e as Error).message) }
  }

  const lock = () => { setDataKey(null); setMetaRow(null); setPhase('locked') }

  if (view === 'loading') {
    return (
      <Layout title="Vault">
        <Centered>
          {/* Shaped like the gate card it resolves into. */}
          <div className="card w-full max-w-md space-y-5 p-6 sm:p-8" role="status" aria-busy="true" aria-label="Loading vault">
            <div className="flex items-center gap-3">
              <Skeleton w={40} h={40} rounded="lg" />
              <Skeleton w="55%" h={16} />
            </div>
            <div className="space-y-2">
              <Skeleton h={12} />
              <Skeleton w="70%" h={12} />
            </div>
            <Skeleton h={40} />
            <Skeleton h={40} />
            <Skeleton h={40} />
          </div>
        </Centered>
      </Layout>
    )
  }
  if (view === 'no-backend') {
    return (
      <Layout title="Vault">
        <EmptyState
          className="max-w-md mx-auto mt-10"
          glyph="vault"
          title="Vault needs the Supabase backend"
          description="Credentials are encrypted in your browser and stored in Supabase. Connect the backend (NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY) to use it; local demo mode has nowhere to keep them."
        />
      </Layout>
    )
  }
  if (view === 'no-admin') {
    return (
      <Layout title="Vault">
        <EmptyState
          className="max-w-md mx-auto mt-10"
          glyph="vault"
          title="Admins only"
          description="The Vault holds the studio's shared credentials. Ask a workspace admin if you need something from it."
        />
      </Layout>
    )
  }

  return (
    <Layout title="Vault">
      {view === 'enroll' && (
        <EnrollGate onDone={(fid) => { setFactorId(fid); setPhase(hasMeta ? 'locked' : 'setup') }} />
      )}
      {view === 'setup' && factorId && (
        <SetupGate factorId={factorId} onDone={(row, key) => { setHasMeta(true); setMetaRow(row); setDataKey(key); setPhase('unlocked') }} onStartOver={() => setResetCode('')} />
      )}
      {view === 'locked' && factorId && (
        <UnlockGate
          factorId={factorId}
          access={access}
          onUnlock={(row, key) => { setMetaRow(row); setDataKey(key); setPhase('unlocked') }}
          onGone={() => void bootstrap()}
          onStartOver={(code) => setResetCode(code)}
        />
      )}
      {view === 'unlocked' && dataKey && metaRow && (
        <VaultBody metaId={metaRow.id} dataKey={dataKey} clientName={clientName} onLock={lock} onRestored={() => { /* rows reloaded in place */ }} />
      )}

      <ConfirmDialog
        open={resetCode !== null}
        title="Reset the vault?"
        message="This sets the vault aside and starts fresh: you pick a new master password and re-link an authenticator. Your existing credentials are NOT deleted — they stay encrypted under the old password and can be restored later from the vault screen if you remember it."
        confirmLabel="Archive & start over"
        danger
        onConfirm={() => startOver(resetCode)}
        onClose={() => setResetCode(null)}
      />
    </Layout>
  )
}

// ── Gate card ──────────────────────────────────────────────────────────────────
/**
 * The shell every gate shares: brand icon plate, display title, then the
 * step. Arrives with a short fade when the gate changes (enroll → setup,
 * unlock ↔ recover), none from the keyboard.
 */
function GateCard({ icon, title, children, footer }: { icon: Icon; title: string; children: ReactNode; footer?: ReactNode }) {
  const titleId = useId()
  return (
    <Centered>
      <section aria-labelledby={titleId} className="card w-full max-w-md overflow-hidden animate-route">
        <div className="space-y-5 p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <IconTile icon={icon} tone="brand" />
            <h2 id={titleId} className="text-display text-lg font-semibold text-ink-50 text-balance">{title}</h2>
          </div>
          {children}
        </div>
        {footer && (
          <div className="flex flex-col items-center gap-1 border-t border-ink-600 bg-ink-900/50 px-6 py-3 sm:px-8">{footer}</div>
        )}
      </section>
    </Centered>
  )
}

/** Quiet text action in a gate footer (reset paths, "send a new code"). 44px under a finger. */
const GATE_LINK = 'pressable min-h-9 w-full rounded-md px-2 py-1.5 text-center text-xs text-ink-300 hover:text-ink-50 pointer-coarse:min-h-11 text-pretty'
const GATE_LINK_BRAND = 'pressable min-h-9 w-full rounded-md px-2 py-1.5 text-center text-xs text-brand-700 hover:text-brand-800 dark:text-brand-400 dark:hover:text-brand-300 pointer-coarse:min-h-11 text-pretty'

// ── Gate: TOTP enrollment ─────────────────────────────────────────────────────
function EnrollGate({ onDone }: { onDone: (factorId: string) => void }) {
  const [enroll, setEnroll] = useState<TotpEnrollment | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, flashCopied] = useCopied()

  const start = async () => {
    setBusy(true)
    try { setEnroll(await enrollTotp()) }
    catch (e) { toast.error((e as Error).message) }
    finally { setBusy(false) }
  }
  const confirm = async () => {
    if (!enroll) return
    setBusy(true)
    try { await verifyTotp(enroll.factorId, code); toast.success('Authenticator linked'); onDone(enroll.factorId) }
    catch { setError('Invalid code — try again') }
    finally { setBusy(false) }
  }
  const copyKey = async () => {
    if (!enroll) return
    try { await navigator.clipboard.writeText(enroll.secret); flashCopied(); toast.success('Key copied') }
    catch { toast.error('Could not copy — select the key instead') }
  }

  return (
    <GateCard icon={ShieldCheckIcon} title="Set up 2-factor auth">
      <p className="text-sm leading-relaxed text-ink-300">The Vault requires an authenticator code every time it’s opened. Scan this once with Google Authenticator, Authy, or 1Password.</p>
      {!enroll ? (
        <button className="btn-primary w-full pointer-coarse:min-h-11" onClick={start} disabled={busy}>{busy ? 'Preparing…' : 'Begin setup'}</button>
      ) : (
        <>
          <div className="flex flex-col items-center gap-3 animate-fade">
            {/* The code on its own white plate (scanners need the contrast), seated in a recessed tray. */}
            <div className="rounded-xl border border-ink-600 bg-ink-900/50 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- an in-memory QR data URL, nothing to optimise */}
              <img src={enroll.qrCode} alt="TOTP QR" className="size-44 rounded-lg bg-white p-2" />
            </div>
            {/* A phone can't scan its own screen: the otpauth:// link hands the
                secret straight to the installed authenticator app instead. */}
            <a href={enroll.uri} className="btn-secondary w-full justify-center pointer-fine:hidden pointer-coarse:min-h-11">
              <KeyIcon size={14} aria-hidden /> Open in authenticator app
            </a>
            <div className="w-full rounded-lg border border-ink-600 bg-ink-900/40 px-3 py-2.5 text-center">
              <div className="text-[11px] text-ink-300">Or enter key manually:</div>
              <div className="mt-1 select-all font-mono text-xs text-ink-100 [overflow-wrap:anywhere]">{enroll.secret}</div>
            </div>
            <button type="button" className="btn-ghost text-xs pointer-coarse:min-h-11" onClick={copyKey}><CopyGlyph copied={copied} size={13} /> Copy key</button>
          </div>
          <FormField label="Authenticator code" error={error}>
            {(p) => (
              <input {...p} className={CODE_INPUT} placeholder="000000" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
                onChange={(e) => { setCode(e.target.value.replace(/\D/g, '')); setError(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 6) void confirm() }} />
            )}
          </FormField>
          <button className="btn-primary w-full pointer-coarse:min-h-11" onClick={confirm} disabled={busy || code.length < 6}>{busy ? 'Verifying…' : 'Verify & continue'}</button>
        </>
      )}
    </GateCard>
  )
}

// ── Gate: create the vault master password ─────────────────────────────────────
function SetupGate({ factorId, onDone, onStartOver }: { factorId: string; onDone: (row: VaultMetaRow, key: Uint8Array) => void; onStartOver: () => void }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<{ pw?: string; pw2?: string; code?: string }>({})
  // Straight after EnrollGate the session is already at aal2. Arriving here with
  // an authenticator linked earlier (another admin's reset, an interrupted first
  // setup) it is not, and the vault's tables refuse aal1 — so ask for a code.
  const [needsCode, setNeedsCode] = useState(false)
  useEffect(() => {
    let live = true
    sessionIsAal2().then((aal2) => { if (live) setNeedsCode(!aal2) }, () => { if (live) setNeedsCode(true) })
    return () => { live = false }
  }, [])

  const create = async () => {
    if (pw.length < 8) { setErrors({ pw: 'Use at least 8 characters' }); return }
    if (pw !== pw2) { setErrors({ pw2: 'Passwords do not match' }); return }
    if (needsCode && code.length < 6) { setErrors({ code: 'Enter the code from your authenticator' }); return }
    setErrors({})
    setBusy(true)
    try {
      if (needsCode) {
        try { await verifyTotp(factorId, code) } catch { setErrors({ code: 'Invalid authenticator code' }); return }
        setNeedsCode(false)
      }
      const { meta, dataKey } = initVaultKeys(pw)
      const row = await createVaultMeta(meta)
      toast.success('Vault created')
      onDone(row, dataKey)
    } catch (e) { toast.error((e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <GateCard
      icon={KeyIcon}
      title="Create a vault master password"
      footer={<button type="button" className={GATE_LINK} onClick={onStartOver}>Start over (also unlink the authenticator)</button>}
    >
      <p className="text-sm leading-relaxed text-ink-300">This encrypts everything in the vault. It is <strong className="font-semibold text-ink-100">never sent to the server</strong> — so if you lose it, the data is <strong className="font-semibold text-rose-700 dark:text-rose-400">unrecoverable</strong>. Store it somewhere safe.</p>
      <FormField label="Master password" error={errors.pw}>
        {(p) => (
          <input {...p} type="password" className={classNames('input w-full', INPUT_INVALID)} placeholder="Master password" autoComplete="new-password" value={pw}
            onChange={(e) => { setPw(e.target.value); setErrors({}) }} autoFocus />
        )}
      </FormField>
      <FormField label="Confirm master password" error={errors.pw2}>
        {(p) => (
          <input {...p} type="password" className={classNames('input w-full', INPUT_INVALID)} placeholder="Confirm master password" autoComplete="new-password" value={pw2}
            onChange={(e) => { setPw2(e.target.value); setErrors({}) }} />
        )}
      </FormField>
      {needsCode && (
        <FormField label="Authenticator code" error={errors.code}>
          {(p) => (
            <input {...p} className={CODE_INPUT} placeholder="000000" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
              onChange={(e) => { setCode(e.target.value.replace(/\D/g, '')); setErrors({}) }} onKeyDown={(e) => e.key === 'Enter' && create()} />
          )}
        </FormField>
      )}
      <button className="btn-primary w-full pointer-coarse:min-h-11" onClick={create} disabled={busy || (needsCode && code.length < 6)}>{busy ? 'Creating…' : 'Create vault'}</button>
    </GateCard>
  )
}

// ── Gate: unlock (master password + TOTP) ──────────────────────────────────────
function UnlockGate({ factorId, access, onUnlock, onGone, onStartOver }: {
  factorId: string
  /** Revision 6: your own vault password, an invite to claim, or null (the master password). */
  access: VaultAccessKind | null
  onUnlock: (row: VaultMetaRow, key: Uint8Array) => void
  /** The active generation vanished (reset elsewhere) — re-read the phase. */
  onGone: () => void
  onStartOver: (code: string) => void
}) {
  const [pw, setPw] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'unlock' | 'recover' | 'claim'>(access === 'invite' ? 'claim' : 'unlock')
  const [errors, setErrors] = useState<{ pw?: string; pw2?: string; code?: string; invite?: string }>({})
  const [invite, setInvite] = useState('')
  const [pw2, setPw2] = useState('')
  // Owner-approval reset: the code is emailed to the vault owner, not to the
  // admin asking for it, so one admin cannot reset the vault unilaterally.
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [approval, setApproval] = useState('')

  const unlock = async () => {
    setBusy(true)
    setErrors({})
    try {
      await verifyTotp(factorId, code) // server-side 2FA
    } catch { setErrors({ code: 'Invalid authenticator code' }); setBusy(false); return }
    // The salt + wrapped key are read only now, at aal2 (migration 031 hides
    // them below it), so a password-only session can't take them offline.
    let row: VaultMetaRow | null
    try { row = await getVaultMeta() }
    catch (e) { toast.error((e as Error).message); setBusy(false); return }
    if (!row) { toast.error('The vault was reset meanwhile'); setBusy(false); onGone(); return }
    try {
      // Your own vault password first (060), then the master password: both
      // unwrap the same data key, client-side; a wrong one throws.
      let key: Uint8Array | null = null
      if (access === 'password') {
        const slot = await getMySlot(row.id).catch(() => null)
        if (slot?.kind === 'password') {
          try { key = unlockDataKey(pw, { salt: slot.salt, iterations: slot.iterations, wrappedKey: slot.wrapped_key }) } catch { /* try the master password */ }
        }
      }
      if (!key) key = unlockDataKey(pw, { salt: row.salt, iterations: row.iterations, wrappedKey: row.wrapped_key })
      onUnlock(row, key)
    } catch { setErrors({ pw: access === 'password' ? 'Wrong password' : 'Wrong master password' }) }
    finally { setBusy(false) }
  }

  // Revision 6: an invite another admin made for you — its one-time code
  // opens the data key once, and your own password wraps it from then on.
  const claim = async () => {
    if (normalizeInviteCode(invite).length !== 10) { setErrors({ invite: 'Enter the 10-character invite code' }); return }
    if (pw.length < 8) { setErrors({ pw: 'Use at least 8 characters' }); return }
    if (pw !== pw2) { setErrors({ pw2: 'Passwords do not match' }); return }
    setBusy(true)
    setErrors({})
    try {
      await verifyTotp(factorId, code)
    } catch { setErrors({ code: 'Invalid authenticator code' }); setBusy(false); return }
    try {
      const row = await getVaultMeta()
      if (!row) { toast.error('The vault was reset meanwhile'); onGone(); return }
      const slot: VaultSlotRow | null = await getMySlot(row.id)
      if (!slot) { setErrors({ invite: 'This invite was taken back. Ask an admin for a new one.' }); return }
      let key: Uint8Array
      try { key = unlockDataKey(normalizeInviteCode(invite), { salt: slot.salt, iterations: slot.iterations, wrappedKey: slot.wrapped_key }) }
      catch { setErrors({ invite: 'That invite code isn’t right' }); return }
      await saveMySlot(row.id, rewrapDataKey(key, pw), slot)
      toast.success('Your vault account is ready')
      onUnlock(row, key)
    } catch (e) { toast.error((e as Error).message) }
    finally { setBusy(false) }
  }

  const askOwner = async () => {
    setBusy(true)
    try {
      const { sentTo: to, expiresMinutes } = await requestVaultResetCode()
      setSentTo(to)
      toast.success(`Approval code sent to ${to} — valid ${expiresMinutes} minutes`)
    } catch (e) { toast.error((e as Error).message) }
    finally { setBusy(false) }
  }

  const submitApproval = async () => {
    setBusy(true)
    try {
      await confirmVaultReset(approval)          // archives server-side
      await resetVault({ factorId, code: code.length === 6 ? code : undefined })  // unlink authenticator
      toast.success('Vault archived — set it up fresh')
      setApproval(''); setSentTo(null)
      onStartOver('')
    } catch (e) { toast.error((e as Error).message) }
    finally { setBusy(false) }
  }

  if (mode === 'claim') {
    return (
      <GateCard
        key="claim"
        icon={UserPlusIcon}
        title="Set up your vault account"
        footer={<button type="button" className={GATE_LINK} onClick={() => { setMode('unlock'); setErrors({}) }}>Have the master password? Use it instead</button>}
      >
        <p className="text-sm leading-relaxed text-ink-300">An admin invited you to the vault. Enter the code they gave you, then choose your own vault password. The code works once.</p>
        <FormField label="Invite code" error={errors.invite}>
          {(p) => (
            <input {...p} className={classNames(CODE_INPUT, 'tracking-[0.2em] uppercase')} placeholder="XXXXX-XXXXX" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={13} value={invite}
              onChange={(e) => { setInvite(e.target.value); setErrors({}) }} autoFocus />
          )}
        </FormField>
        <FormField label="Your vault password" error={errors.pw}>
          {(p) => (
            <input {...p} type="password" className={classNames('input w-full', INPUT_INVALID)} placeholder="At least 8 characters" autoComplete="new-password" value={pw}
              onChange={(e) => { setPw(e.target.value); setErrors({}) }} />
          )}
        </FormField>
        <FormField label="Confirm it" error={errors.pw2}>
          {(p) => (
            <input {...p} type="password" className={classNames('input w-full', INPUT_INVALID)} placeholder="Confirm your vault password" autoComplete="new-password" value={pw2}
              onChange={(e) => { setPw2(e.target.value); setErrors({}) }} />
          )}
        </FormField>
        <FormField label="Authenticator code" error={errors.code}>
          {(p) => (
            <input {...p} className={CODE_INPUT} placeholder="000000" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
              onChange={(e) => { setCode(e.target.value.replace(/\D/g, '')); setErrors({}) }} onKeyDown={(e) => e.key === 'Enter' && claim()} />
          )}
        </FormField>
        <button className="btn-primary w-full pointer-coarse:min-h-11" onClick={claim} disabled={busy || !invite || !pw || code.length < 6}>{busy ? 'Setting up…' : 'Set up and unlock'}</button>
      </GateCard>
    )
  }

  if (mode === 'recover') {
    return (
      <GateCard
        key="recover"
        icon={EnvelopeSimpleIcon}
        title="Reset needs the owner’s approval"
        footer={
          <>
            {sentTo && <button type="button" className={GATE_LINK_BRAND} onClick={askOwner} disabled={busy}>Send a new code</button>}
            <button type="button" className={GATE_LINK} onClick={() => setMode('unlock')}>Back to unlock</button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-300">
          We email a 6-digit code to the vault owner. Enter it here and the vault is set aside so you can
          start fresh. <strong className="font-semibold text-ink-100">Your stored credentials are not deleted</strong> — they
          stay encrypted under the current master password and can be restored later if it turns up.
        </p>
        {!sentTo ? (
          <button className="btn-primary w-full pointer-coarse:min-h-11" onClick={askOwner} disabled={busy}>
            {busy ? 'Sending…' : "Email the owner an approval code"}
          </button>
        ) : (
          <div className="space-y-4">
            <Notice tone="info" icon={EnvelopeSimpleIcon}>
              <span className="text-sm text-ink-200">
                Code sent to <strong className="font-semibold text-ink-50">{sentTo}</strong>. Ask them to read it to you.
              </span>
            </Notice>
            <FormField label="Approval code">
              {(p) => (
                <input
                  {...p}
                  className={CODE_INPUT} placeholder="000000"
                  inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={approval}
                  onChange={(e) => setApproval(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => { if (e.key === 'Enter' && approval.length === 6) void submitApproval() }}
                />
              )}
            </FormField>
            <button className="btn-primary w-full pointer-coarse:min-h-11" onClick={submitApproval} disabled={busy || approval.length < 6}>
              {busy ? 'Verifying…' : 'Approve & archive the vault'}
            </button>
          </div>
        )}
      </GateCard>
    )
  }

  return (
    <GateCard
      key="unlock"
      icon={LockIcon}
      title="Unlock the Vault"
      footer={
        <>
          <button type="button" className={GATE_LINK} onClick={() => setMode('recover')}>Forgot your master password? Ask the owner to approve a reset</button>
          <button type="button" className={GATE_LINK} onClick={() => { setMode('recover'); setSentTo(null) }}>Lost your authenticator? Ask the owner to approve a reset</button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink-300">
        {access === 'password'
          ? 'Enter your own vault password (or the master password) and a code from your authenticator.'
          : 'Enter your master password and a code from your authenticator.'}
      </p>
      {access === 'invite' && (
        <button type="button" className={GATE_LINK_BRAND} onClick={() => { setMode('claim'); setErrors({}) }}>You have a vault invite — set up your own password</button>
      )}
      <FormField label={access === 'password' ? 'Vault password' : 'Master password'} error={errors.pw}>
        {(p) => (
          <input {...p} type="password" className={classNames('input w-full', INPUT_INVALID)} placeholder={access === 'password' ? 'Your vault password' : 'Master password'} autoComplete="current-password" value={pw}
            onChange={(e) => { setPw(e.target.value); if (errors.pw) setErrors({}) }} autoFocus onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && unlock()} />
        )}
      </FormField>
      <FormField label="Authenticator code" error={errors.code}>
        {(p) => (
          <input {...p} className={CODE_INPUT} placeholder="000000" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
            onChange={(e) => { setCode(e.target.value.replace(/\D/g, '')); if (errors.code) setErrors({}) }} onKeyDown={(e) => e.key === 'Enter' && unlock()} />
        )}
      </FormField>
      <button className="btn-primary w-full pointer-coarse:min-h-11" onClick={unlock} disabled={busy || !pw || code.length < 6}><SignInIcon size={14} aria-hidden /> {busy ? 'Unlocking…' : 'Unlock'}</button>
    </GateCard>
  )
}

// ── Unlocked vault ─────────────────────────────────────────────────────────────
function VaultBody({ metaId, dataKey, clientName, onLock, onRestored }: {
  metaId: string; dataKey: Uint8Array
  clientName: (id: string | null) => string | null
  onLock: () => void
  onRestored: () => void
}) {
  const [folders, setFolders] = useState<VaultFolder[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [activeFolder, setActiveFolder] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [folderModal, setFolderModal] = useState(false)
  const [editItem, setEditItem] = useState<Item | 'new' | null>(null)
  const [delFolder, setDelFolder] = useState<VaultFolder | null>(null)
  // Dialogs stay mounted so they can play their exit; these keep their
  // content (the folder / item) on screen through it.
  const shownDelFolder = useHeldWhile(delFolder, delFolder !== null)
  const itemOpen = editItem !== null && activeFolder !== null
  const shownItem = useHeldWhile(editItem, itemOpen)
  // First open this session: the folder's credentials settle in 40ms apart.
  const { ref: attachStagger, className: staggerClass } = useStagger<HTMLUListElement>('vault-items')

  const decFolder = (r: VaultFolderRow): VaultFolder => ({ id: r.id, clientId: r.client_id, name: safeDec(dataKey, r.name_enc) })
  const decItem = (r: VaultItemRow): Item => {
    let fields: Field[] = []
    try { fields = JSON.parse(decryptString(dataKey, r.data_enc)).fields ?? [] } catch { /* corrupt */ }
    return { id: r.id, folderId: r.folder_id, type: r.item_type, title: safeDec(dataKey, r.title_enc), fields }
  }

  const fetchAll = async () => {
    const [fRows, iRows] = await Promise.all([listFolders(metaId), listItems(metaId)])
    return { fs: fRows.map(decFolder), its: iRows.map(decItem) }
  }
  const apply = ({ fs, its }: { fs: VaultFolder[]; its: Item[] }) => {
    setFolders(fs)
    setItems(its)
    setActiveFolder((cur) => cur ?? fs[0]?.id ?? null)
  }
  const reload = async () => {
    setLoading(true)
    try { apply(await fetchAll()) }
    catch (e) { toast.error((e as Error).message) }
    finally { setLoading(false) }
  }
  // First load: `loading` starts true, so the effect only settles it.
  useEffect(() => {
    let live = true
    fetchAll()
      .then((r) => { if (live) apply(r) }, (e: unknown) => { if (live) toast.error((e as Error).message) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const folderItems = useMemo(() => items.filter((i) => i.folderId === activeFolder), [items, activeFolder])
  const countByFolder = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of items) m.set(i.folderId, (m.get(i.folderId) ?? 0) + 1)
    return m
  }, [items])
  const current = folders.find((f) => f.id === activeFolder) ?? null

  if (loading) return <VaultSkeleton />

  return (
    <div className="space-y-4">
    <OwnerEmailCard />
    <VaultAccountsCard metaId={metaId} dataKey={dataKey} />
    <ArchiveBanner metaId={metaId} dataKey={dataKey} onRestored={() => { void reload(); onRestored() }} />
    {/* Two panes side by side from md up. Below that a 256px folder column left
        the items pane ~70px wide, so the panes stack: a capped, scrollable folder
        list over the items, and the page scrolls instead of a fixed-height box. */}
    <div className="flex flex-col md:flex-row gap-4 md:h-[calc(100dvh-14rem)] md:min-h-[26rem]">
      {/* Folders */}
      <nav aria-label="Folders" className="md:w-64 md:shrink-0 card flex flex-col max-h-64 md:max-h-none overflow-hidden">
        <div className="flex items-center justify-between border-b border-ink-600 py-2 pl-4 pr-2">
          <span className="section-title">Folders</span>
          <button className="pressable tap-target rounded-md p-1.5 text-ink-300 hover:bg-ink-700 hover:text-ink-50" title="New folder" aria-label="New folder" onClick={() => setFolderModal(true)}><PlusIcon size={16} aria-hidden /></button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain p-1.5">
          {folders.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-3 py-6 text-center">
              <FolderSimplePlusIcon size={20} className="text-ink-400" aria-hidden />
              <p className="text-xs text-ink-300">No folders yet.</p>
            </div>
          )}
          <IndicatorGroup id="vault-folders">
            <ul className="space-y-0.5">
              {folders.map((f) => {
                const on = activeFolder === f.id
                const client = f.clientId ? clientName(f.clientId) : null
                const n = countByFolder.get(f.id) ?? 0
                return (
                  <li key={f.id}>
                    <button
                      type="button"
                      aria-current={on ? 'true' : undefined}
                      onClick={() => setActiveFolder(f.id)}
                      className={classNames(
                        'pressable relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm pointer-coarse:min-h-11',
                        on ? 'text-ink-50' : 'text-ink-200 hover:bg-ink-700/50 hover:text-ink-50',
                      )}
                      title={client ? `${f.name} — ${client}` : f.name}
                    >
                      {on && <LayoutIndicator layoutId="vault-folder" radius={6} className="absolute inset-0 bg-ink-700 dark:bg-ink-700/80" />}
                      {on
                        ? <FolderOpenIcon size={16} weight="fill" className="relative shrink-0 text-brand-600 dark:text-brand-400" aria-hidden />
                        : <FolderIcon size={16} className="relative shrink-0 text-ink-400" aria-hidden />}
                      <span className="relative min-w-0 flex-1">
                        <span className="block truncate font-medium">{f.name}</span>
                        {client && <span className="block truncate text-[11px] text-ink-300">{client}</span>}
                      </span>
                      <span className="relative shrink-0 text-[11px] tabular-nums text-ink-400">{n.toLocaleString()}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </IndicatorGroup>
        </div>
      </nav>

      {/* Items */}
      <section aria-label={current?.name ?? 'Items'} className="card flex min-h-[50dvh] min-w-0 flex-1 flex-col overflow-hidden md:min-h-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-ink-600 px-4 py-3">
          <div className="min-w-0 flex-1 basis-48">
            <h2 className="line-clamp-2 text-display text-base font-semibold text-ink-50 [overflow-wrap:anywhere]" title={current?.name}>{current?.name ?? 'Select a folder'}</h2>
            {current?.clientId && clientName(current.clientId) && (
              <p className="truncate text-xs text-ink-300">{clientName(current.clientId)}</p>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1 max-sm:-ml-2.5 max-sm:w-[calc(100%+0.625rem)]">
            <button className="btn-ghost pointer-coarse:min-h-11" onClick={onLock} title="Lock vault"><LockIcon size={14} aria-hidden /> Lock</button>
            <button className="btn-ghost tap-target px-2.5" onClick={reload} title="Refresh" aria-label="Refresh"><ArrowsClockwiseIcon size={14} aria-hidden /></button>
            {activeFolder && (
              <>
                <button className="btn-ghost text-rose-700 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-400 pointer-coarse:min-h-11" onClick={() => setDelFolder(folders.find((f) => f.id === activeFolder) ?? null)}><TrashIcon size={14} aria-hidden /> Folder</button>
                {/* Phones: the row wraps under the title; quiet actions line up
                    with it on the left, the primary one holds the right edge. */}
                <button className="btn-primary pointer-coarse:min-h-11 max-sm:ml-auto" onClick={() => setEditItem('new')}><PlusIcon size={14} aria-hidden /> Item</button>
              </>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain">
          {!activeFolder ? (
            <PaneEmpty icon={FolderSimplePlusIcon} text="Pick or create a folder to store credentials."
              action={<button className="btn-secondary pointer-coarse:min-h-11" onClick={() => setFolderModal(true)}><PlusIcon size={14} aria-hidden /> New folder</button>} />
          ) : folderItems.length === 0 ? (
            <PaneEmpty icon={KeyIcon} text="No items yet in this folder."
              action={<button className="btn-secondary pointer-coarse:min-h-11" onClick={() => setEditItem('new')}><PlusIcon size={14} aria-hidden /> Item</button>} />
          ) : (
            <ul ref={attachStagger} className={classNames('divide-y divide-ink-600', staggerClass)}>
              {folderItems.map((it) => {
                const meta = typeMeta(it.type)
                const TypeIcon = meta?.icon ?? KeyIcon
                return (
                  <li key={it.id}>
                    <button
                      type="button"
                      data-vault-item
                      onClick={() => setEditItem(it)}
                      className="pressable-card group flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-ink-700/40"
                    >
                      <IconTile icon={TypeIcon} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-ink-50" title={it.title}>{it.title}</div>
                        <div className="text-[11px] text-ink-300 tabular-nums">{it.fields.length} field{it.fields.length === 1 ? '' : 's'} · {meta?.label ?? it.type}</div>
                      </div>
                      <CaretRightIcon size={14} className="shrink-0 text-ink-400 transition-colors group-hover:text-ink-200" aria-hidden />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>

      <FolderModal open={folderModal} metaId={metaId} onClose={() => setFolderModal(false)} onCreated={() => { setFolderModal(false); void reload() }} dataKey={dataKey} />
      <ItemModal
        open={itemOpen}
        metaId={metaId}
        dataKey={dataKey}
        folderId={activeFolder ?? ''}
        item={shownItem && shownItem !== 'new' ? shownItem : null}
        onClose={() => setEditItem(null)}
        onSaved={() => { setEditItem(null); void reload() }}
      />
      </div>
      <ConfirmDialog
        open={delFolder !== null}
        title="Delete folder"
        message={shownDelFolder ? `Delete "${shownDelFolder.name}" and all its credentials? This cannot be undone.` : ''}
        confirmLabel="Delete" danger
        onConfirm={async () => {
          if (!delFolder) return
          try { await deleteFolder(delFolder.id); toast.success('Folder deleted'); setActiveFolder(null); void reload() }
          catch (e) { toast.error((e as Error).message) }
        }}
        onClose={() => setDelFolder(null)}
      />
    </div>
  )
}

/** An empty pane: its mark, one line, the action that fills it. */
function PaneEmpty({ icon: Glyph, text, action }: { icon: Icon; text: string; action: ReactNode }) {
  return (
    <div className="flex h-full min-h-56 flex-col items-center justify-center gap-4 px-6 py-10 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl border border-ink-600 bg-ink-800 text-ink-300 shadow-(--shadow-2) dark:bg-ink-700/60" aria-hidden>
        <Glyph size={22} />
      </span>
      <p className="max-w-xs text-sm text-ink-300 text-pretty">{text}</p>
      {action}
    </div>
  )
}

/** While the vault decrypts: the two panes, shaped like their rows. */
function VaultSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <p className="sr-only" role="status">Decrypting…</p>
      <div className="card flex items-center gap-3 p-3">
        <Skeleton w={16} h={16} rounded="sm" />
        <div className="flex-1 space-y-2"><Skeleton w={160} h={10} /><Skeleton w="min(24rem,100%)" h={36} /></div>
      </div>
      <div className="flex flex-col gap-4 md:h-[calc(100dvh-14rem)] md:min-h-[26rem] md:flex-row">
        <div className="card space-y-1 p-3 md:w-64 md:shrink-0">
          <Skeleton w={64} h={10} className="mb-3" />
          {[70, 55, 62].map((w) => (
            <div key={w} className="flex items-center gap-2.5 py-2"><Skeleton w={16} h={16} rounded="sm" /><Skeleton w={`${w}%`} h={12} /></div>
          ))}
        </div>
        {/* No 50dvh floor on phones: a placeholder that scrolls the page would
            leave a scroll region with nothing focusable in it. */}
        <div className="card flex-1">
          <div className="flex items-center justify-between border-b border-ink-600 px-4 py-3.5"><Skeleton w={140} h={14} /><Skeleton w={180} h={32} /></div>
          {[60, 42, 50].map((w) => (
            <div key={w} className="flex items-center gap-3 border-b border-ink-600 px-4 py-3">
              <Skeleton w={32} h={32} rounded="lg" />
              <div className="flex-1 space-y-2"><Skeleton w={`${w}%`} h={12} /><Skeleton w={80} h={10} /></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Who approves a reset ───────────────────────────────────────────────────────
/**
 * The vault owner's email. A reset sends its approval code here, so this is set
 * from inside an unlocked vault — the one place that proves the person setting
 * it already has the master password.
 */
function OwnerEmailCard() {
  const [email, setEmail] = useState('')
  const [saved, setSaved] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try { const e = await getVaultOwnerEmail(); setSaved(e); setEmail(e ?? '') }
      catch { /* non-fatal: the vault still works without it */ }
    })()
  }, [])

  const save = async () => {
    const next = email.trim()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(next)) { setError('Enter a valid email address'); return }
    setError(null)
    setBusy(true)
    try { await setVaultOwnerEmail(next); setSaved(next); toast.success('Approval address saved') }
    catch (e) { toast.error((e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <div className={classNames('card flex items-start gap-3 p-3 sm:px-4', !saved && 'border-amber-500/40 bg-amber-500/5')}>
      <EnvelopeSimpleIcon size={18} className={classNames('mt-0.5 hidden shrink-0 sm:block', saved ? 'text-ink-400' : 'text-amber-700 dark:text-amber-400')} aria-hidden />
      <div className="min-w-0 flex-1">
        <label className="mb-1.5 block text-xs text-ink-300" htmlFor="vault-owner-email">
          {saved ? 'Reset approvals are emailed to' : 'Set who approves a vault reset — until then, no reset can happen'}
        </label>
        <div className="flex max-w-lg items-center gap-2">
          <input
            id="vault-owner-email" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            className={classNames('input min-w-0 flex-1', INPUT_INVALID)} placeholder="owner@company.com"
            aria-invalid={error ? true : undefined} aria-describedby={error ? 'vault-owner-email-error' : undefined}
            value={email} onChange={(e) => { setEmail(e.target.value); setError(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter') void save() }}
          />
          <button className="btn-secondary shrink-0 pointer-coarse:min-h-11" onClick={save} disabled={busy || email.trim() === (saved ?? '')}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
        <FieldError id="vault-owner-email-error" error={error} className="mt-1.5" />
      </div>
    </div>
  )
}

// ── Vault accounts (revision 6, migration 060) ────────────────────────────────
/**
 * Each admin can open the vault with their own password and authenticator.
 * The open vault's data key is wrapped again under that password (your own
 * account) or under a one-time code (an invite another admin claims). The
 * server keeps only wrapped keys; who has access is listed without them.
 */
function VaultAccountsCard({ metaId, dataKey }: { metaId: string; dataKey: Uint8Array }) {
  const me = useCurrentUser()
  const users = useStore((s) => s.users)
  const admins = useMemo(
    () => users.filter((u) => u.role === 'admin' && !u.deactivatedAt).sort((a, b) => (a.id === me?.id ? -1 : b.id === me?.id ? 1 : a.fullName.localeCompare(b.fullName))),
    [users, me?.id],
  )
  const [access, setAccess] = useState<VaultAccessEntry[] | null>(null)
  const [mySlot, setMySlot] = useState<VaultSlotRow | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pwOpen, setPwOpen] = useState(false)
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [pwError, setPwError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [invite, setInvite] = useState<{ name: string; code: string } | null>(null)
  const [pendingRemove, setPendingRemove] = useState<{ id: string; name: string; kind: VaultAccessKind } | null>(null)
  const [copied, flashCopied] = useCopied()

  useEffect(() => {
    let live = true
    Promise.all([listVaultAccess(), getMySlot(metaId)]).then(
      ([list, slot]) => { if (live) { setAccess(list); setMySlot(slot); setLoadError(null) } },
      (e: unknown) => { if (live) setLoadError((e as Error).message) },
    )
    return () => { live = false }
  }, [metaId, reloadKey])
  const reload = () => setReloadKey((k) => k + 1)
  const kindOf = (id: string) => access?.find((a) => a.user_id === id)?.kind ?? null

  const savePassword = async () => {
    if (pw.length < 8) { setPwError('Use at least 8 characters'); return }
    if (pw !== pw2) { setPwError('Passwords do not match'); return }
    setPwError(null)
    setBusy('me')
    try {
      await saveMySlot(metaId, rewrapDataKey(dataKey, pw), mySlot)
      toast.success(mySlot ? 'Your vault password changed' : 'Your vault account is ready')
      setPwOpen(false); setPw(''); setPw2('')
      reload()
    } catch (e) { setPwError((e as Error).message) }
    finally { setBusy(null) }
  }

  const inviteAdmin = async (id: string, name: string) => {
    setBusy(id)
    try {
      if (kindOf(id) === 'invite') await removeVaultAccess(id) // a new code replaces the old one
      const code = newInviteCode()
      await createInviteSlot(metaId, id, rewrapDataKey(dataKey, normalizeInviteCode(code)))
      setInvite({ name, code })
      reload()
    } catch (e) { toast.error((e as Error).message) }
    finally { setBusy(null) }
  }

  if (loadError && !access) {
    return (
      <Notice tone="warn" icon={UsersThreeIcon} action={<button className="btn-secondary" onClick={reload}>Try again</button>}>
        <span className="text-sm text-ink-200">Vault accounts could not be loaded: {loadError}</span>
      </Notice>
    )
  }

  return (
    <details className="card group/acc p-3 sm:px-4" open={access !== null && !mySlot}>
      <summary className="pressable flex cursor-pointer list-none items-center gap-3 rounded-md">
        <UsersThreeIcon size={18} className="hidden shrink-0 text-ink-400 sm:block" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-ink-50">Vault accounts</span>
          <span className="block text-xs text-ink-300">
            {access === null ? 'Loading…' : mySlot ? 'You open the vault with your own password.' : 'Make your own vault password, so you don’t need the master one.'}
          </span>
        </span>
        <CaretRightIcon size={14} className="shrink-0 text-ink-400 transition-transform duration-150 group-open/acc:rotate-90" aria-hidden />
      </summary>

      <div className="mt-3 space-y-3 border-t border-ink-600 pt-3">
        {invite && (
          <Notice tone="info" icon={UserPlusIcon} action={<button className="btn-ghost" onClick={() => setInvite(null)}>Done</button>}>
            <div className="space-y-2 text-sm text-ink-200">
              <p>Invite code for <strong className="font-semibold text-ink-50">{invite.name}</strong>. It is shown once and works once:</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded-md border border-ink-600 bg-ink-800 px-3 py-1.5 font-mono text-base tracking-[0.15em] text-ink-50">{invite.code}</code>
                <button className="btn-secondary" onClick={() => { void navigator.clipboard?.writeText(invite.code); flashCopied() }}>
                  <CopyGlyph copied={copied} /> {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="text-xs text-ink-300">Give it to them yourself — say it or hand it over; don’t email it. They open the Vault, enter it with their authenticator code, and choose their own vault password.</p>
            </div>
          </Notice>
        )}

        <ul className="divide-y divide-ink-600">
          {admins.map((u) => {
            const mine = u.id === me?.id
            const kind = mine ? (mySlot ? 'password' : null) : kindOf(u.id)
            return (
              <li key={u.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink-50">{u.fullName}{mine && <span className="text-ink-300"> (you)</span>}</span>
                  <span className={classNames('badge mt-0.5', kind === 'password' ? 'badge-success' : kind === 'invite' ? 'badge-warn' : 'badge-neutral')}>
                    {kind === 'password' ? 'Own password' : kind === 'invite' ? 'Invite waiting' : mine ? 'Using the master password' : 'No account yet'}
                  </span>
                </span>
                {mine ? (
                  <button className="btn-secondary" onClick={() => { setPwOpen((o) => !o); setPwError(null) }} aria-expanded={pwOpen}>
                    <KeyIcon size={14} aria-hidden /> {mySlot ? 'Change my vault password' : 'Create my vault password'}
                  </button>
                ) : (
                  <span className="flex flex-wrap gap-2">
                    {kind !== 'password' && (
                      <button className="btn-secondary" disabled={busy === u.id || access === null} onClick={() => void inviteAdmin(u.id, u.fullName)}>
                        <UserPlusIcon size={14} aria-hidden /> {kind === 'invite' ? 'New invite code' : 'Invite'}
                      </button>
                    )}
                    {kind && (
                      <button className="btn-ghost text-rose-700 dark:text-rose-400" disabled={busy === u.id} onClick={() => setPendingRemove({ id: u.id, name: u.fullName, kind })}>
                        {kind === 'invite' ? 'Cancel invite' : 'Remove access'}
                      </button>
                    )}
                  </span>
                )}
                {mine && pwOpen && (
                  <form className="basis-full space-y-2" onSubmit={(e) => { e.preventDefault(); void savePassword() }}>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input type="password" className="input w-full" placeholder="New vault password" autoComplete="new-password" aria-label="New vault password" value={pw} onChange={(e) => { setPw(e.target.value); setPwError(null) }} autoFocus />
                      <input type="password" className="input w-full" placeholder="Confirm it" autoComplete="new-password" aria-label="Confirm the new vault password" value={pw2} onChange={(e) => { setPw2(e.target.value); setPwError(null) }} />
                    </div>
                    <FieldError error={pwError} />
                    <div className="flex items-center gap-2">
                      <button type="submit" className="btn-primary" disabled={busy === 'me' || !pw}>{busy === 'me' ? 'Saving…' : 'Save'}</button>
                      <span className="text-xs text-ink-300">Never sent to the server. Forget it and another admin can invite you again; the master password still works.</span>
                    </div>
                  </form>
                )}
              </li>
            )
          })}
        </ul>
        <p className="text-[11px] leading-relaxed text-ink-300">
          Removing an account stops it opening the vault from then on. Someone who has the vault open right now keeps it until they lock or reload; a vault reset cuts that off.
        </p>
      </div>

      <ConfirmDialog
        open={pendingRemove !== null}
        title={pendingRemove?.kind === 'invite' ? 'Cancel the invite' : 'Remove vault access'}
        message={pendingRemove?.kind === 'invite'
          ? `${pendingRemove?.name ?? ''}’s invite code stops working.`
          : `${pendingRemove?.name ?? ''} can no longer open the vault with their own password. The master password, if they know it, still works.`}
        confirmLabel={pendingRemove?.kind === 'invite' ? 'Cancel invite' : 'Remove access'}
        danger
        onConfirm={() => {
          if (!pendingRemove) return
          const { id } = pendingRemove
          void removeVaultAccess(id).then(() => { toast.success('Access removed'); reload() }, (e: unknown) => toast.error((e as Error).message))
        }}
        onClose={() => setPendingRemove(null)}
      />
    </details>
  )
}

// ── Archived generations ───────────────────────────────────────────────────────
/**
 * A reset archives the previous vault instead of deleting it (migration 021).
 * This surfaces what is sitting in the archive and offers the only two honest
 * endings: restore it with the old master password, or delete it on purpose.
 */
/** Archived (pre-reset) vault generations, each with its item count. */
type ArchivedMeta = VaultMetaRow & { count: number }

async function fetchArchives(): Promise<ArchivedMeta[]> {
  const metas = await listArchivedMetas()
  return Promise.all(metas.map(async (m) => ({ ...m, count: await countArchivedItems(m.id) })))
}

function ArchiveBanner({ metaId, dataKey, onRestored }: {
  metaId: string; dataKey: Uint8Array; onRestored: () => void
}) {
  const [archives, setArchives] = useState<ArchivedMeta[]>([])
  const [restoring, setRestoring] = useState<VaultMetaRow | null>(null)
  const [dropping, setDropping] = useState<ArchivedMeta | null>(null)
  // Both dialogs outlive the last archive row (a restore empties the list),
  // so they stay mounted and keep their subject through the exit.
  const shownDropping = useHeldWhile(dropping, dropping !== null)
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setArchives(await fetchArchives()) }
    catch { /* the archive is a bonus; never block the vault on it */ }
  }, [])
  useEffect(() => {
    let live = true
    fetchArchives().then((a) => { if (live) setArchives(a) }, () => { /* see load() */ })
    return () => { live = false }
  }, [])

  // Stable: this component re-renders on every character of the password.
  const closeRestore = useCallback(() => { setRestoring(null); setPw(''); setError(null) }, [])
  const restore = async () => {
    if (!restoring || !pw) return
    setBusy(true)
    setError(null)
    try {
      const n = await restoreArchivedGeneration({
        archived: restoring, oldPassword: pw, activeMetaId: metaId, activeDataKey: dataKey,
      })
      toast.success(n > 0 ? `Restored ${n} credential${n === 1 ? '' : 's'}` : 'Archive was empty — removed')
      closeRestore()
      await load()
      onRestored()
    } catch (e) {
      const msg = (e as Error).message
      setError(/invalid|tag|decrypt/i.test(msg) ? 'Wrong master password for that archive' : msg)
    } finally { setBusy(false) }
  }

  return (
    <>
      {archives.map((a) => (
        <Notice
          key={a.id}
          tone="warn"
          icon={ArchiveIcon}
          className="flex-wrap px-4 sm:flex-nowrap"
          action={
            <div className="flex shrink-0 items-center gap-1 max-sm:ml-7 max-sm:basis-full">
              <button className="btn-secondary pointer-coarse:min-h-11" onClick={() => { setRestoring(a); setPw(''); setError(null) }}>Restore</button>
              <button className="btn-ghost tap-target px-2.5 text-ink-300 hover:text-rose-700 dark:hover:text-rose-400" onClick={() => setDropping(a)} title="Delete this archive permanently" aria-label="Delete this archive permanently">
                <TrashIcon size={14} aria-hidden />
              </button>
            </div>
          }
        >
          <p className="text-sm text-ink-100">
            <span className="tabular-nums">{a.count.toLocaleString()}</span> credential{a.count === 1 ? '' : 's'} from a previous master password
            {a.archived_at ? `, archived ${fmtDate(a.archived_at)}` : ''}.
          </p>
          <p className="mt-0.5 text-xs text-ink-300">Still encrypted. Enter that password to bring them back.</p>
        </Notice>
      ))}

      <Modal
        open={restoring !== null}
        onClose={closeRestore}
        title="Restore archived credentials"
        footer={<>
          <button className="btn-ghost" onClick={closeRestore}>Cancel</button>
          <button className="btn-primary" onClick={restore} disabled={busy || !pw}>{busy ? 'Restoring…' : 'Restore'}</button>
        </>}
      >
        <p className="mb-5 text-sm leading-relaxed text-ink-300">
          Enter the master password that was in force when these were saved. They are decrypted in
          your browser and re-encrypted under the current password — nothing readable leaves this device.
        </p>
        <FormField label="Previous master password" error={error}>
          {(p) => (
            <input
              {...p}
              type="password" className={classNames('input w-full', INPUT_INVALID)} placeholder="Previous master password" autoFocus
              value={pw} onChange={(e) => { setPw(e.target.value); setError(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter' && pw) void restore() }}
            />
          )}
        </FormField>
      </Modal>

      <ConfirmDialog
        open={dropping !== null}
        title="Delete archived credentials?"
        message={shownDropping ? `Permanently delete ${shownDropping.count.toLocaleString()} archived credential(s). Without the old master password they cannot be read anyway — but this cannot be undone.` : ''}
        confirmLabel="Delete permanently" danger
        onConfirm={async () => {
          if (!dropping) return
          try { await deleteArchivedGeneration(dropping.id); toast.success('Archive deleted'); await load() }
          catch (e) { toast.error((e as Error).message) }
        }}
        onClose={() => setDropping(null)}
      />
    </>
  )
}

// ── New folder ─────────────────────────────────────────────────────────────────
function FolderModal({ open, metaId, dataKey, onClose, onCreated }: { open: boolean; metaId: string; dataKey: Uint8Array; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [clientId, setClientId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // A fresh form each time it opens (it stays mounted to play its exit).
  useResetOnChange([open], () => {
    if (!open) return
    setName(''); setClientId(''); setError(null); setBusy(false)
  })
  const save = async () => {
    if (busy) return
    if (!name.trim()) { setError('Name required'); return }
    setBusy(true)
    try { await createFolder(metaId, clientId || null, encryptString(dataKey, name.trim())); toast.success('Folder added'); onCreated() }
    catch (e) { toast.error((e as Error).message) }
    finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="New folder" footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>Create</button></>}>
      <div className="space-y-5">
        <FormField label="Folder name" error={error}>
          {(p) => (
            <input {...p} className={classNames('input w-full', INPUT_INVALID)} value={name} onChange={(e) => { setName(e.target.value); setError(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter') void save() }} placeholder="e.g. AWS, Northwind logins" autoFocus />
          )}
        </FormField>
        <FormField label="Client (optional)"><ClientSelect value={clientId} onChange={setClientId} allowNone /></FormField>
      </div>
    </Modal>
  )
}

// ── Item editor ─────────────────────────────────────────────────────────────────
function ItemModal({ open, metaId, dataKey, folderId, item, onClose, onSaved }: {
  open: boolean
  metaId: string
  dataKey: Uint8Array; folderId: string; item: Item | null; onClose: () => void; onSaved: () => void
}) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState('login')
  const [fields, setFields] = useState<Field[]>([])
  const [reveal, setReveal] = useState<Record<string, boolean>>({})
  const [del, setDel] = useState(false)
  const [titleError, setTitleError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Re-seeded on every open (it stays mounted to play its exit); secrets
  // start masked again each time.
  useResetOnChange([open, item], () => {
    if (!open) return
    setTitle(item?.title ?? '')
    setType(item?.type ?? 'login')
    setFields(item?.fields ?? ITEM_TYPES[0].seed.map((s) => ({ id: genId(), label: s.label, value: '', secret: s.secret })))
    setReveal({}); setDel(false); setTitleError(null); setBusy(false)
  })

  const applyType = (t: string) => {
    setType(t)
    if (!item) {
      const seed = ITEM_TYPES.find((x) => x.value === t)?.seed ?? []
      setFields(seed.map((s) => ({ id: genId(), label: s.label, value: '', secret: s.secret })))
    }
  }
  const setField = (id: string, patch: Partial<Field>) => setFields((fs) => fs.map((f) => f.id === id ? { ...f, ...patch } : f))
  const addField = () => setFields((fs) => [...fs, { id: genId(), label: '', value: '', secret: true }])
  const removeField = (id: string) => setFields((fs) => fs.filter((f) => f.id !== id))

  const save = async () => {
    if (busy) return
    if (!title.trim()) { setTitleError('Title required'); return }
    const clean = fields.filter((f) => f.label.trim() || f.value)
    const titleEnc = encryptString(dataKey, title.trim())
    const dataEnc = encryptString(dataKey, JSON.stringify({ fields: clean }))
    setBusy(true)
    try {
      if (item) await updateItem(item.id, { itemType: type, titleEnc, dataEnc })
      else await createItem({ metaId, folderId, itemType: type, titleEnc, dataEnc })
      toast.success(item ? 'Saved' : 'Added')
      onSaved()
    } catch (e) { toast.error((e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={item ? 'Edit item' : 'New item'} wide
      footer={<>
        {item && <button className="btn-ghost mr-auto text-rose-700 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-400" onClick={() => setDel(true)}><TrashIcon size={14} aria-hidden /> Delete</button>}
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={busy}>{item ? 'Save' : 'Add'}</button>
      </>}
    >
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
          <FormField label="Title" error={titleError}>
            {(p) => (
              <input {...p} className={classNames('input w-full', INPUT_INVALID)} value={title} onChange={(e) => { setTitle(e.target.value); setTitleError(null) }} placeholder="e.g. Production AWS root" autoFocus />
            )}
          </FormField>
          <FormField label="Type">
            {(p) => (
              <select {...p} className="input w-full" value={type} onChange={(e) => applyType(e.target.value)}>
                {ITEM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            )}
          </FormField>
        </div>

        <div className="space-y-2.5 border-t border-ink-600 pt-5">
          <div className="flex items-center justify-between"><span className="section-title">Fields</span><button className="btn-ghost -mr-2 pointer-coarse:min-h-11" onClick={addField}><PlusIcon size={14} aria-hidden /> Add field</button></div>
          {fields.length === 0 && <p className="rounded-lg border border-dashed border-ink-500 px-4 py-5 text-center text-xs text-ink-300">No fields — add username, password, API keys, tokens, etc.</p>}
          {fields.map((f) => (
            <FieldRow
              key={f.id}
              field={f}
              revealed={!!reveal[f.id]}
              onChange={(patch) => setField(f.id, patch)}
              onToggleReveal={() => setReveal((r) => ({ ...r, [f.id]: !r[f.id] }))}
              onRemove={() => removeField(f.id)}
            />
          ))}
        </div>
      </div>

      <ConfirmDialog open={del} title="Delete item" message={`Delete "${title}"? This cannot be undone.`} confirmLabel="Delete" danger
        onConfirm={async () => {
          if (!item) return
          try { await deleteItem(item.id); toast.success('Deleted'); onSaved() }
          catch (e) { toast.error((e as Error).message) }
        }} onClose={() => setDel(false)} />
    </Modal>
  )
}

/** One credential field: label, value with its secret / reveal / copy controls, remove. */
function FieldRow({ field: f, revealed, onChange, onToggleReveal, onRemove }: {
  field: Field
  revealed: boolean
  onChange: (patch: Partial<Field>) => void
  onToggleReveal: () => void
  onRemove: () => void
}) {
  const [copied, flashCopied] = useCopied()
  const copy = () => { void navigator.clipboard?.writeText(f.value); flashCopied(); toast.success('Copied') }
  const icon = 'pressable tap-target rounded-md p-1.5 text-ink-400 hover:bg-ink-700 hover:text-ink-100'
  return (
    // Phones: one boxed unit per field — label + remove on the first line,
    // the value at full width, its controls under it (overlaid controls left
    // ~10 characters of value visible at 390px).
    <div className="flex flex-wrap items-center gap-2 max-sm:rounded-lg max-sm:border max-sm:border-ink-600 max-sm:p-2 sm:flex-nowrap">
      <input className="input min-w-0 flex-1 sm:w-36 sm:flex-none" placeholder="Label" aria-label="Field label" value={f.label} onChange={(e) => onChange({ label: e.target.value })} />
      <div className="relative min-w-0 max-sm:order-last max-sm:basis-full sm:flex-1">
        <input
          className="input w-full font-mono sm:pr-24 sm:pointer-coarse:pr-36"
          type={f.secret && !revealed ? 'password' : 'text'}
          placeholder="Value"
          aria-label={f.label ? `${f.label} value` : 'Field value'}
          autoComplete="off"
          spellCheck={false}
          value={f.value}
          onChange={(e) => onChange({ value: e.target.value })}
        />
        <div className="flex items-center justify-end gap-0.5 max-sm:mt-1 sm:absolute sm:inset-y-0 sm:right-1">
          {/* Secret is a padlock (masked at rest); the eye only peeks. */}
          <button type="button" className={classNames(icon, f.secret && 'text-brand-600 dark:text-brand-400')} title={f.secret ? 'Toggle secret' : 'Mark secret'} aria-label={f.secret ? 'Mark as not secret' : 'Mark as secret'} aria-pressed={f.secret} onClick={() => onChange({ secret: !f.secret })}>
            {f.secret ? <LockSimpleIcon size={14} weight="fill" aria-hidden /> : <LockSimpleOpenIcon size={14} aria-hidden />}
          </button>
          {f.secret && <button type="button" className={icon} aria-label={revealed ? 'Hide value' : 'Show value'} onClick={onToggleReveal}>{revealed ? <EyeSlashIcon size={14} aria-hidden /> : <EyeIcon size={14} aria-hidden />}</button>}
          <button type="button" className={icon} title="Copy" aria-label="Copy value" onClick={copy}><CopyGlyph copied={copied} /></button>
        </div>
      </div>
      <button type="button" className="pressable tap-target shrink-0 rounded-md p-1.5 text-ink-400 hover:bg-rose-500/10 hover:text-rose-700 dark:hover:text-rose-400" title="Remove field" aria-label="Remove field" onClick={onRemove}><XIcon size={14} aria-hidden /></button>
    </div>
  )
}

// ── bits ─────────────────────────────────────────────────────────────────────
function Centered({ children }: { children: ReactNode }) {
  // Phones: the gate sits near the top (thumb reach, keyboard below), not
  // floating mid-screen. No side padding: main already insets 16px.
  return <div className="flex items-start justify-center pt-2 pb-6 text-sm text-ink-300 sm:min-h-[60dvh] sm:items-center sm:px-6 sm:py-6">{children}</div>
}
function safeDec(key: Uint8Array, blob: string): string {
  try { return decryptString(key, blob) } catch { return '⚠︎ decrypt error' }
}
