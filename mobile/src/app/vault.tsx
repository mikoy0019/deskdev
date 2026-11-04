import { useCallback, useEffect, useMemo, useState } from 'react'
import { Feather } from '@expo/vector-icons'
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'

import { Button, Card, Input, Screen, SectionTitle } from '@/components/ui'
import { Field, FormModal, SelectField, type SelectOption } from '@/components/forms'
import { useSession } from '@/context/session-context'
import { isSupabaseConfigured } from '@/lib/supabase'
import { fonts, useTheme } from '@/lib/theme'
import { useStore } from '@/store/useStore'
import {
  initVaultKeys, unlockDataKey, encryptString, decryptString,
} from '@/lib/vaultCrypto'
import {
  getVaultMeta, vaultHasActiveMeta, sessionIsAal2, createVaultMeta, listFolders, createFolder, deleteFolder,
  listItems, createItem, updateItem, deleteItem, getVerifiedTotpFactorId, enrollTotp, verifyTotp,
  type VaultFolderRow, type VaultItemRow, type VaultMetaRow, type TotpEnrollment,
} from '@/lib/vault'

type Phase = 'loading' | 'no-admin' | 'no-backend' | 'enroll' | 'setup' | 'locked' | 'unlocked'
interface VField { id: string; label: string; value: string; secret: boolean }
interface Folder { id: string; clientId: string | null; name: string }
interface Item { id: string; folderId: string; type: string; title: string; fields: VField[] }

const ITEM_TYPES: { value: string; label: string; seed: { label: string; secret: boolean }[] }[] = [
  { value: 'login', label: 'Login', seed: [{ label: 'Username', secret: false }, { label: 'Password', secret: true }] },
  { value: 'api', label: 'API Key', seed: [{ label: 'API Key', secret: true }] },
  { value: 'oauth', label: 'OAuth', seed: [{ label: 'Client ID', secret: false }, { label: 'Client Secret', secret: true }] },
  { value: 'database', label: 'Database', seed: [{ label: 'Host', secret: false }, { label: 'Username', secret: false }, { label: 'Password', secret: true }] },
  { value: 'server', label: 'Server / SSH', seed: [{ label: 'Host', secret: false }, { label: 'Username', secret: false }, { label: 'Password', secret: true }] },
  { value: 'note', label: 'Secure Note', seed: [] },
]
const genId = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const safeDec = (key: Uint8Array, blob: string) => { try { return decryptString(key, blob) } catch { return '⚠︎ decrypt error' } }

export default function Vault() {
  const p = useTheme()
  const { user } = useSession()
  const isAdmin = user?.role === 'admin'

  const [phase, setPhase] = useState<Phase>('loading')
  // Whether an active generation exists; its salt + wrapped key are read only
  // after the TOTP step (UnlockGate).
  const [hasMeta, setHasMeta] = useState(false)
  const [factorId, setFactorId] = useState<string | null>(null)
  const [dataKey, setDataKey] = useState<Uint8Array | null>(null)
  // Active generation: everything written from here is tagged with its id.
  const [metaRow, setMetaRow] = useState<VaultMetaRow | null>(null)

  const bootstrap = useCallback(async () => {
    setDataKey(null)
    if (!isSupabaseConfigured) { setPhase('no-backend'); return }
    if (!isAdmin) { setPhase('no-admin'); return }
    setPhase('loading')
    try {
      const [fid, active] = await Promise.all([getVerifiedTotpFactorId(), vaultHasActiveMeta()])
      setFactorId(fid)
      setMetaRow(null)
      setHasMeta(active)
      setPhase(!fid ? 'enroll' : !active ? 'setup' : 'locked')
    } catch (e) { Alert.alert('Vault', (e as Error).message) }
  }, [isAdmin])

  useEffect(() => { void bootstrap() }, [bootstrap])

  // A reset needs a code emailed to the vault owner, and the code-entry flow
  // lives in the web app. Nothing is deleted either way: a reset archives.
  const startOver = () => {
    Alert.alert(
      'Reset needs owner approval',
      'A vault reset now requires an approval code emailed to the vault owner. Do it from the DeskDev web app — your stored credentials are archived, never deleted.',
      [{ text: 'OK' }],
    )
  }

  if (phase === 'loading') return <Screen><Center><ActivityIndicator color={p.brand} /></Center></Screen>
  if (phase === 'no-backend') return <Screen><Center><Text style={{ color: p.textMuted }}>The Vault requires the Supabase backend.</Text></Center></Screen>
  if (phase === 'no-admin') return <Screen><Center><Text style={{ color: p.textMuted }}>The Vault is available to admins only.</Text></Center></Screen>

  if (phase === 'enroll') return <Screen scroll><EnrollGate onDone={(fid) => { setFactorId(fid); setPhase(hasMeta ? 'locked' : 'setup') }} /></Screen>
  if (phase === 'setup' && factorId) return <Screen scroll><SetupGate factorId={factorId} onDone={(row, key) => { setHasMeta(true); setMetaRow(row); setDataKey(key); setPhase('unlocked') }} onStartOver={startOver} /></Screen>
  if (phase === 'locked' && factorId) return <Screen scroll><UnlockGate factorId={factorId} email={user?.email ?? ''} onUnlock={(row, key) => { setMetaRow(row); setDataKey(key); setPhase('unlocked') }} onGone={() => void bootstrap()} onStartOver={startOver} /></Screen>
  if (phase === 'unlocked' && dataKey && metaRow) return <VaultBody metaId={metaRow.id} dataKey={dataKey} onLock={() => { setDataKey(null); setMetaRow(null); setPhase('locked') }} />
  return null
}

// ── Gate: enrollment ────────────────────────────────────────────────────────
function EnrollGate({ onDone }: { onDone: (factorId: string) => void }) {
  const p = useTheme()
  const [enroll, setEnroll] = useState<TotpEnrollment | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  const start = async () => {
    setBusy(true)
    try { setEnroll(await enrollTotp()) } catch (e) { Alert.alert('Vault', (e as Error).message) } finally { setBusy(false) }
  }
  const confirm = async () => {
    if (!enroll) return
    setBusy(true)
    try { await verifyTotp(enroll.factorId, code); onDone(enroll.factorId) }
    catch { Alert.alert('Vault', 'Invalid code — try again') } finally { setBusy(false) }
  }
  return (
    <Card style={{ gap: 12 }}>
      <Text style={{ fontSize: 16, fontFamily: fonts.display, color: p.textHigh }}>Set up 2-factor auth</Text>
      <Text style={{ fontSize: 13, color: p.textMuted }}>The Vault asks for an authenticator code every time it opens. Add this key to Google Authenticator / Authy, then enter the 6-digit code.</Text>
      {!enroll ? (
        <Button title={busy ? 'Preparing…' : 'Begin setup'} onPress={start} disabled={busy} />
      ) : (
        <>
          <View style={{ backgroundColor: p.hover, borderRadius: 10, padding: 12 }}>
            <Text style={{ fontSize: 11, color: p.textMuted, marginBottom: 4 }}>Setup key (enter in your authenticator)</Text>
            <Text selectable style={{ fontSize: 14, fontFamily: fonts.mono, color: p.textHigh }}>{enroll.secret}</Text>
          </View>
          <Input value={code} onChangeText={(t) => setCode(t.replace(/\D/g, ''))} placeholder="000000" keyboardType="number-pad" maxLength={6} style={{ textAlign: 'center', letterSpacing: 6, fontFamily: fonts.mono }} />
          <Button title={busy ? 'Verifying…' : 'Verify & continue'} onPress={confirm} disabled={busy || code.length < 6} />
        </>
      )}
    </Card>
  )
}

// ── Gate: create master password ────────────────────────────────────────────
function SetupGate({ factorId, onDone, onStartOver }: { factorId: string; onDone: (row: VaultMetaRow, key: Uint8Array) => void; onStartOver: () => void }) {
  const p = useTheme()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  // Right after EnrollGate the session is at aal2 already. With an authenticator
  // linked earlier it is not, and the vault tables refuse aal1: ask for a code.
  const [needsCode, setNeedsCode] = useState(false)
  useEffect(() => {
    let live = true
    sessionIsAal2().then((aal2) => { if (live) setNeedsCode(!aal2) }, () => { if (live) setNeedsCode(true) })
    return () => { live = false }
  }, [])
  const create = async () => {
    if (pw.length < 8) { Alert.alert('Vault', 'Use at least 8 characters'); return }
    if (pw !== pw2) { Alert.alert('Vault', 'Passwords do not match'); return }
    if (needsCode && code.length < 6) { Alert.alert('Vault', 'Enter the code from your authenticator'); return }
    setBusy(true)
    try {
      if (needsCode) {
        try { await verifyTotp(factorId, code) } catch { Alert.alert('Vault', 'Invalid authenticator code'); return }
        setNeedsCode(false)
      }
      const { meta, dataKey } = initVaultKeys(pw); const row = await createVaultMeta(meta); onDone(row, dataKey)
    }
    catch (e) { Alert.alert('Vault', (e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Card style={{ gap: 12 }}>
      <Text style={{ fontSize: 16, fontFamily: fonts.display, color: p.textHigh }}>Create a vault master password</Text>
      <Text style={{ fontSize: 13, color: p.textMuted }}>This encrypts everything and is never sent to the server. If you lose it, the data is unrecoverable.</Text>
      <Input value={pw} onChangeText={setPw} placeholder="Master password" secureTextEntry autoCapitalize="none" />
      <Input value={pw2} onChangeText={setPw2} placeholder="Confirm master password" secureTextEntry autoCapitalize="none" />
      {needsCode && (
        <Input value={code} onChangeText={(t) => setCode(t.replace(/\D/g, ''))} placeholder="000000" keyboardType="number-pad" maxLength={6} style={{ textAlign: 'center', letterSpacing: 6, fontFamily: fonts.mono }} />
      )}
      <Button title={busy ? 'Creating…' : 'Create vault'} onPress={create} disabled={busy || (needsCode && code.length < 6)} />
      <Pressable onPress={onStartOver} style={{ alignSelf: 'center', paddingTop: 4 }}><Text style={{ fontSize: 12, color: p.textMuted }}>Start over (also unlink the authenticator)</Text></Pressable>
    </Card>
  )
}

// ── Gate: unlock ────────────────────────────────────────────────────────────
function UnlockGate({ factorId, email, onUnlock, onGone, onStartOver }: {
  factorId: string; email: string
  onUnlock: (row: VaultMetaRow, key: Uint8Array) => void
  /** The active generation vanished (reset elsewhere): re-read the phase. */
  onGone: () => void
  onStartOver: (code: string) => void
}) {
  const p = useTheme()
  const [pw, setPw] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  const unlock = async () => {
    setBusy(true)
    try { await verifyTotp(factorId, code) } catch { Alert.alert('Vault', 'Invalid authenticator code'); setBusy(false); return }
    // Salt + wrapped key are read only now, at aal2 (031 hides them below it).
    let row: VaultMetaRow | null
    try { row = await getVaultMeta() } catch (e) { Alert.alert('Vault', (e as Error).message); setBusy(false); return }
    if (!row) { Alert.alert('Vault', 'The vault was reset meanwhile'); setBusy(false); onGone(); return }
    const m = row
    try { onUnlock(m, unlockDataKey(pw, { salt: m.salt, iterations: m.iterations, wrappedKey: m.wrapped_key })) } catch { Alert.alert('Vault', 'Wrong master password') } finally { setBusy(false) }
  }
  const recoverViaEmail = () => {
    Alert.alert('Recover via email', `Email recovery runs on the web app. Open DeskDev in a browser${email ? ` (signed in as ${email})` : ''} → Vault → Unlock → "Recover via email". It resets the shared vault for every device.`, [{ text: 'OK' }])
  }

  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Feather name="lock" size={18} color={p.brandText} />
        <Text style={{ fontSize: 16, fontFamily: fonts.display, color: p.textHigh }}>Unlock the Vault</Text>
      </View>
      <Text style={{ fontSize: 13, color: p.textMuted }}>Enter your master password and a code from your authenticator.</Text>
      <Input value={pw} onChangeText={setPw} placeholder="Master password" secureTextEntry autoCapitalize="none" />
      <Input value={code} onChangeText={(t) => setCode(t.replace(/\D/g, ''))} placeholder="000000" keyboardType="number-pad" maxLength={6} style={{ textAlign: 'center', letterSpacing: 6, fontFamily: fonts.mono }} />
      <Button title={busy ? 'Unlocking…' : 'Unlock'} icon="unlock" onPress={unlock} disabled={busy || !pw || code.length < 6} />
      <Pressable onPress={() => code.length === 6 ? onStartOver(code) : Alert.alert('Vault', 'Enter a 6-digit code from your authenticator first, then reset')} style={{ alignSelf: 'center', paddingTop: 4 }}><Text style={{ fontSize: 12, color: p.textMuted }}>Forgot your master password? Reset &amp; start over</Text></Pressable>
      <Pressable onPress={recoverViaEmail} style={{ alignSelf: 'center' }}><Text style={{ fontSize: 12, color: p.brandText }}>Lost your authenticator? Recover via email</Text></Pressable>
    </Card>
  )
}

// ── Unlocked ────────────────────────────────────────────────────────────────
function VaultBody({ metaId, dataKey, onLock }: { metaId: string; dataKey: Uint8Array; onLock: () => void }) {
  const p = useTheme()
  const clients = useStore((s) => s.clients)
  const [folders, setFolders] = useState<Folder[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [folderModal, setFolderModal] = useState(false)
  const [editItem, setEditItem] = useState<Item | 'new' | null>(null)

  const clientName = (id: string | null) => clients.find((c) => c.id === id)?.name ?? null
  const decItem = (r: VaultItemRow): Item => {
    let fields: VField[] = []
    try { fields = JSON.parse(decryptString(dataKey, r.data_enc)).fields ?? [] } catch { /* ignore */ }
    return { id: r.id, folderId: r.folder_id, type: r.item_type, title: safeDec(dataKey, r.title_enc), fields }
  }
  const reload = async () => {
    setLoading(true)
    try {
      const [fRows, iRows] = await Promise.all([listFolders(metaId), listItems(metaId)])
      const fs: Folder[] = fRows.map((r: VaultFolderRow) => ({ id: r.id, clientId: r.client_id, name: safeDec(dataKey, r.name_enc) }))
      setFolders(fs); setItems(iRows.map(decItem))
      setActive((cur) => cur ?? fs[0]?.id ?? null)
    } catch (e) { Alert.alert('Vault', (e as Error).message) } finally { setLoading(false) }
  }
  useEffect(() => { void reload() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const folderItems = useMemo(() => items.filter((i) => i.folderId === active), [items, active])
  const confirmDeleteFolder = () => {
    const f = folders.find((x) => x.id === active); if (!f) return
    Alert.alert('Delete folder?', `"${f.name}" and its credentials will be permanently removed.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteFolder(f.id); setActive(null); void reload() } },
    ])
  }

  return (
    <Screen padded={false}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderBottomWidth: 1, borderBottomColor: p.border }}>
        <Text style={{ fontSize: 12, color: p.textMuted }}>{folders.length} folders</Text>
        <Pressable onPress={onLock} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Feather name="lock" size={14} color={p.brandText} />
          <Text style={{ fontSize: 13, color: p.brandText, fontFamily: fonts.sansSemibold }}>Lock</Text>
        </Pressable>
      </View>

      {loading ? <Center><ActivityIndicator color={p.brand} /></Center> : (
        <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            {folders.map((f) => {
              const on = active === f.id
              return (
                <Pressable key={f.id} onPress={() => setActive(f.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, backgroundColor: on ? p.brand : p.card, borderColor: on ? p.brand : p.border }}>
                  <Feather name="folder" size={12} color={on ? '#fff' : p.brandText} />
                  <Text style={{ fontSize: 12, fontFamily: fonts.sansSemibold, color: on ? '#fff' : p.textSecondary }}>{f.name}</Text>
                </Pressable>
              )
            })}
            <Pressable onPress={() => setFolderModal(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: p.border, borderStyle: 'dashed' }}>
              <Feather name="plus" size={13} color={p.brandText} />
              <Text style={{ fontSize: 12, fontFamily: fonts.sansSemibold, color: p.brandText }}>Folder</Text>
            </Pressable>
          </View>

          {!active ? (
            <Card><Text style={{ color: p.textMuted, fontSize: 13 }}>Create a folder to store credentials.</Text></Card>
          ) : (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <SectionTitle>{clientName(folders.find((f) => f.id === active)?.clientId ?? null) ?? 'Items'} ({folderItems.length})</SectionTitle>
                <Pressable onPress={confirmDeleteFolder} hitSlop={8}><Feather name="trash-2" size={15} color={p.iconMuted} /></Pressable>
              </View>
              <View style={{ gap: 8 }}>
                {folderItems.length === 0 ? <Card><Text style={{ color: p.textMuted, fontSize: 13 }}>No items yet.</Text></Card> :
                  folderItems.map((it) => (
                    <Card key={it.id} onPress={() => setEditItem(it)}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <Feather name="key" size={15} color={p.brandText} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 14, fontFamily: fonts.sansSemibold, color: p.textHigh }}>{it.title}</Text>
                          <Text style={{ fontSize: 11, color: p.textMuted }}>{it.fields.length} fields · {it.type}</Text>
                        </View>
                        <Feather name="chevron-right" size={16} color={p.iconMuted} />
                      </View>
                    </Card>
                  ))}
              </View>
              <Button title="Add item" icon="plus" onPress={() => setEditItem('new')} style={{ marginTop: 12 }} />
            </>
          )}
        </ScrollView>
      )}

      <FolderModal visible={folderModal} metaId={metaId} dataKey={dataKey} clients={clients} onClose={() => setFolderModal(false)} onSaved={() => { setFolderModal(false); void reload() }} />
      {active ? (
        <ItemModal visible={editItem !== null} metaId={metaId} dataKey={dataKey} folderId={active} item={editItem === 'new' ? null : editItem} onClose={() => setEditItem(null)} onSaved={() => { setEditItem(null); void reload() }} />
      ) : null}
    </Screen>
  )
}

function FolderModal({ visible, metaId, dataKey, clients, onClose, onSaved }: {
  metaId: string
  visible: boolean; dataKey: Uint8Array; clients: { id: string; name: string; color?: string }[]; onClose: () => void; onSaved: () => void
}) {
  const [wasVisible, setWasVisible] = useState(false)
  const [name, setName] = useState('')
  const [clientId, setClientId] = useState<string | undefined>(undefined)
  if (visible !== wasVisible) { setWasVisible(visible); if (visible) { setName(''); setClientId(undefined) } }
  const clientOptions: SelectOption[] = clients.map((c) => ({ label: c.name, value: c.id, dot: c.color }))
  const save = async () => {
    if (!name.trim()) { Alert.alert('Vault', 'Name required'); return }
    try { await createFolder(metaId, clientId ?? null, encryptString(dataKey, name.trim())); onSaved() } catch (e) { Alert.alert('Vault', (e as Error).message) }
  }
  return (
    <FormModal visible={visible} title="New folder" onClose={onClose} onSubmit={save} submitLabel="Create">
      <Field label="Folder name"><Input value={name} onChangeText={setName} placeholder="e.g. AWS, Northwind logins" autoFocus /></Field>
      <Field label="Client (optional)"><SelectField value={clientId} options={clientOptions} onChange={setClientId} allowNone noneLabel="No client" placeholder="No client" /></Field>
    </FormModal>
  )
}

function ItemModal({ visible, metaId, dataKey, folderId, item, onClose, onSaved }: {
  metaId: string
  visible: boolean; dataKey: Uint8Array; folderId: string; item: Item | null; onClose: () => void; onSaved: () => void
}) {
  const p = useTheme()
  const [wasVisible, setWasVisible] = useState(false)
  const [title, setTitle] = useState('')
  const [type, setType] = useState('login')
  const [fields, setFields] = useState<VField[]>([])
  const [reveal, setReveal] = useState<Record<string, boolean>>({})

  if (visible !== wasVisible) {
    setWasVisible(visible)
    if (visible) {
      setTitle(item?.title ?? '')
      setType(item?.type ?? 'login')
      setFields(item?.fields ?? ITEM_TYPES[0].seed.map((s) => ({ id: genId(), label: s.label, value: '', secret: s.secret })))
      setReveal({})
    }
  }

  const typeOptions: SelectOption[] = ITEM_TYPES.map((t) => ({ label: t.label, value: t.value }))
  const applyType = (t: string | undefined) => {
    const v = t ?? 'login'; setType(v)
    if (!item) setFields((ITEM_TYPES.find((x) => x.value === v)?.seed ?? []).map((s) => ({ id: genId(), label: s.label, value: '', secret: s.secret })))
  }
  const setField = (id: string, patch: Partial<VField>) => setFields((fs) => fs.map((f) => f.id === id ? { ...f, ...patch } : f))
  const addField = () => setFields((fs) => [...fs, { id: genId(), label: '', value: '', secret: true }])
  const copy = (v: string) => { void Clipboard.setStringAsync(v); Alert.alert('Vault', 'Copied to clipboard') }

  const save = async () => {
    if (!title.trim()) { Alert.alert('Vault', 'Title required'); return }
    const clean = fields.filter((f) => f.label.trim() || f.value)
    const titleEnc = encryptString(dataKey, title.trim())
    const dataEnc = encryptString(dataKey, JSON.stringify({ fields: clean }))
    try {
      if (item) await updateItem(item.id, { itemType: type, titleEnc, dataEnc })
      else await createItem({ metaId, folderId, itemType: type, titleEnc, dataEnc })
      onSaved()
    } catch (e) { Alert.alert('Vault', (e as Error).message) }
  }
  const confirmDelete = () => {
    if (!item) return
    Alert.alert('Delete item?', `"${item.title}" will be permanently removed.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteItem(item.id); onSaved() } },
    ])
  }

  return (
    <FormModal
      visible={visible}
      title={item ? 'Edit item' : 'New item'}
      onClose={onClose}
      onSubmit={save}
      submitLabel={item ? 'Save' : 'Add'}
      footerLeft={item ? <Pressable onPress={confirmDelete} hitSlop={8} style={{ padding: 10 }}><Feather name="trash-2" size={20} color={p.danger} /></Pressable> : undefined}
    >
      <Field label="Title"><Input value={title} onChangeText={setTitle} placeholder="e.g. Production AWS root" autoFocus={!item} /></Field>
      <Field label="Type"><SelectField value={type} options={typeOptions} onChange={applyType} /></Field>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 12, fontFamily: fonts.sansSemibold, color: p.textSecondary }}>FIELDS</Text>
        <Pressable onPress={addField} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Feather name="plus" size={13} color={p.brandText} /><Text style={{ fontSize: 12, color: p.brandText, fontFamily: fonts.sansSemibold }}>Add field</Text>
        </Pressable>
      </View>
      {fields.map((f) => (
        <View key={f.id} style={{ gap: 6, backgroundColor: p.card, borderWidth: 1, borderColor: p.border, borderRadius: 10, padding: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Input value={f.label} onChangeText={(t) => setField(f.id, { label: t })} placeholder="Label" style={{ flex: 1 }} />
            <Pressable onPress={() => setFields((fs) => fs.filter((x) => x.id !== f.id))} hitSlop={8}><Feather name="x" size={16} color={p.iconMuted} /></Pressable>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Input value={f.value} onChangeText={(t) => setField(f.id, { value: t })} placeholder="Value" secureTextEntry={f.secret && !reveal[f.id]} autoCapitalize="none" style={{ flex: 1, fontFamily: fonts.mono }} />
            <Pressable onPress={() => setField(f.id, { secret: !f.secret })} hitSlop={6}><Feather name="shield" size={16} color={f.secret ? p.brandText : p.iconMuted} /></Pressable>
            {f.secret ? <Pressable onPress={() => setReveal((r) => ({ ...r, [f.id]: !r[f.id] }))} hitSlop={6}><Feather name={reveal[f.id] ? 'eye-off' : 'eye'} size={16} color={p.iconMuted} /></Pressable> : null}
            <Pressable onPress={() => copy(f.value)} hitSlop={6}><Feather name="copy" size={16} color={p.iconMuted} /></Pressable>
          </View>
        </View>
      ))}
    </FormModal>
  )
}

function Center({ children }: { children: React.ReactNode }) {
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>{children}</View>
}
