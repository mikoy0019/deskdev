import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowSquareOutIcon, MagnifyingGlassIcon, PlusIcon } from '@phosphor-icons/react'
import { can, isAdmin } from '../../lib/permissions'
import { isSupabaseConfigured } from '../../lib/supabase'
import { useCurrentUser, useStore } from '../../store/useStore'
import EmptyState from '../../components/EmptyState'
import Modal from '../../components/Modal'
import { cubeDate } from '../engine'
import {
  AD_SIGNALS, AD_SOURCES, adBookKey, adOutreachDraft, adReviewBlocker, emptyAdBook,
  existingAdRelationship, parseAdBook, reviewAdOpportunity, saveAdOpportunity,
  type AdBook, type AdInput, type AdOpportunity, type AdStatus,
} from './model'

const STATUS_LABELS: Record<AdStatus, string> = {
  needs_review: 'Needs review', approved: 'Approved draft', contacted: 'Contact recorded',
  dismissed: 'Dismissed', do_not_contact: 'Do not contact',
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className="btn-secondary min-h-11">
    {children}<ArrowSquareOutIcon size={14} aria-hidden />
  </a>
}

export default function AdOpportunities() {
  const user = useCurrentUser()
  if (!isAdmin(user)) return <EmptyState icon={MagnifyingGlassIcon} title="Admin access required" description="Ad discovery and outreach controls are available to active admins." />
  return <OpportunityInbox key={`${isSupabaseConfigured}:${user?.id}`} />
}

function OpportunityInbox() {
  const user = useCurrentUser()
  const leads = useStore((state) => state.leads)
  const clients = useStore((state) => state.clients)
  const hydrated = useStore((state) => state.hydrated)
  const synced = useStore((state) => state.synced)
  const failures = useStore((state) => state.loadError)
  const timezone = useStore((state) => state.workspaceSettings.growthBusinessHours.tz)
  const [book, setBook] = useState<AdBook>(emptyAdBook)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<'all' | AdStatus>('needs_review')
  const [editing, setEditing] = useState<AdOpportunity | 'new' | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date().toISOString())
  const visible = isAdmin(user)
  const editable = isAdmin(user)
  const key = adBookKey(isSupabaseConfigured ? 'remote' : 'local', user?.id ?? '')
  let today = ''
  try { today = cubeDate(now, timezone) } catch { /* A missing timezone blocks review, not stored evidence. */ }
  const available = hydrated && (!isSupabaseConfigured || synced) && can(user, 'clients', 'view') && !failures?.some((item) => ['leads', 'clients'].includes(item))

  const reload = useCallback(() => {
    if (!visible || !user) { setBook(emptyAdBook()); setReady(false); return }
    try {
      setBook(parseAdBook(localStorage.getItem(key), user.id))
      setReady(true)
      setError(null)
    } catch {
      setBook(emptyAdBook())
      setReady(false)
      setError('Opportunity history could not be read. Existing browser data has been preserved; saving is disabled.')
    }
  }, [key, visible, user?.id])
  useEffect(() => {
    const first = window.setTimeout(reload, 0)
    const onStorage = (event: StorageEvent) => { if (event.key === key || event.key === null) reload() }
    window.addEventListener('storage', onStorage)
    const timer = window.setInterval(() => setNow(new Date().toISOString()), 60_000)
    return () => { window.clearTimeout(first); window.removeEventListener('storage', onStorage); window.clearInterval(timer) }
  }, [key, reload])

  const write = (change: (current: AdBook, currentUser: NonNullable<typeof user>, stamp: string, day: string) => AdBook) => {
    const state = useStore.getState()
    const currentUser = state.users.find((row) => row.id === state.currentUserId)
    if (!ready || !currentUser || currentUser.id !== user?.id || !isAdmin(currentUser)) throw new Error('Reload the inbox with an active admin account before saving.')
    const stamp = new Date().toISOString()
    const day = cubeDate(stamp, state.workspaceSettings.growthBusinessHours.tz)
    const next = change(parseAdBook(localStorage.getItem(key), currentUser.id), currentUser, stamp, day)
    localStorage.setItem(key, JSON.stringify(next))
    setBook(next)
    setCopiedId(null)
    setError(null)
    setNow(stamp)
  }
  const review = (row: AdOpportunity, nextStatus: Exclude<AdStatus, 'needs_review'>) => {
    try {
      write((current, actor, stamp, day) => {
        const state = useStore.getState()
        const loaded = state.hydrated && (!isSupabaseConfigured || state.synced) && can(actor, 'clients', 'view') && !state.loadError?.some((item) => ['leads', 'clients'].includes(item))
        const match = existingAdRelationship(row, state.leads, can(actor, 'clients', 'view') ? state.clients : [])
        return reviewAdOpportunity(current, row, nextStatus, actor, stamp, day, match, loaded)
      })
      if (nextStatus === 'approved') setStatus('approved')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The review could not be saved.') }
  }
  const copyDraft = async (row: AdOpportunity) => {
    try {
      const state = useStore.getState()
      const actor = state.users.find((item) => item.id === state.currentUserId)
      const current = parseAdBook(localStorage.getItem(key), user!.id).opportunities.find((item) => item.id === row.id)
      const loaded = state.hydrated && (!isSupabaseConfigured || state.synced) && can(actor, 'clients', 'view') && !state.loadError?.some((item) => ['leads', 'clients'].includes(item))
      if (!actor || actor.id !== user?.id || !isAdmin(actor) || !current || JSON.stringify(current) !== JSON.stringify(row) || current.status !== 'approved' || current.approvedRevision !== current.revision) throw new Error('An active admin must approve the current version before copying outreach.')
      const blocker = adReviewBlocker(current, cubeDate(new Date().toISOString(), state.workspaceSettings.growthBusinessHours.tz), existingAdRelationship(current, state.leads, can(actor, 'clients', 'view') ? state.clients : []), loaded)
      if (blocker) throw new Error(blocker)
      await navigator.clipboard.writeText(adOutreachDraft(current))
      setCopiedId(row.id)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The draft could not be copied.') }
  }

  if (!visible) return <EmptyState icon={MagnifyingGlassIcon} title="Growth access required" description="Ad opportunities follow your existing Growth permissions." />

  const rows = book.opportunities.filter((row) => status === 'all' || row.status === status)
  return <div className="space-y-4">
    <section className="card density-card space-y-4" aria-label="Ad discovery sources">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="text-display text-lg font-semibold">Find a business you can help</h2>
          <p className="mt-2 text-sm text-ink-300">Review public ads and their destinations. Save a specific observation, then assess whether your services could help.</p>
          <p className="mt-2 text-xs text-ink-400">This inbox uses links and observations you enter. It does not collect ads automatically or send outreach. Records are personal to this account and browser.</p>
        </div>
        {editable && <button type="button" className="btn-primary min-h-11" disabled={!ready || !today} onClick={() => setEditing('new')}><PlusIcon size={16} aria-hidden />Add opportunity</button>}
      </div>
      <div className="flex flex-wrap gap-2">{Object.entries(AD_SOURCES).filter(([, source]) => source.url).map(([id, source]) => <ExternalLink key={id} href={source.url}>{source.label} ad library</ExternalLink>)}</div>
    </section>
    {error && <div role="alert" className="card density-card"><p className="text-sm">{error}</p><button type="button" className="btn-secondary mt-3 min-h-11" onClick={reload}>Reload opportunities</button></div>}
    {!today && <p role="alert" className="card density-card text-sm">Set a valid workspace business timezone before recording or approving opportunities.</p>}
    {!available && <p role="status" className="card density-card text-sm text-ink-300">Outreach approval requires loaded Growth and client records plus client view permission, so Cube can check existing relationships.</p>}
    <label className="block max-w-xs text-xs text-ink-300">Opportunity status
      <select className="input mt-1 min-h-11" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
        <option value="all">All opportunities</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
    {rows.map((row) => {
      const match = existingAdRelationship(row, leads, can(user, 'clients', 'view') ? clients : [])
      const blocker = today ? adReviewBlocker(row, today, match, available) : 'A valid business timezone is required.'
      return <article key={row.id} className="card density-card space-y-4" aria-label={row.business}>
        <div className="flex flex-wrap gap-2"><span className="badge badge-neutral">{AD_SOURCES[row.source].label}</span><span className={`badge ${row.status === 'do_not_contact' ? 'badge-danger' : row.status === 'approved' ? 'badge-success' : 'badge-info'}`}>{STATUS_LABELS[row.status]}</span></div>
        <h3 className="text-display text-lg font-semibold [overflow-wrap:anywhere]">{row.business}</h3>
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-ink-400">Observed fact · {row.observedOn}</dt><dd className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{row.evidence}</dd></div>
          <div><dt className="text-xs text-ink-400">Possible service fit</dt><dd className="mt-1">{AD_SIGNALS[row.signal].service}</dd><p className="mt-2 text-xs text-ink-400">Budget, actual results, and interest in agency help remain unconfirmed.</p></div>
        </dl>
        <div className="flex flex-wrap gap-2"><ExternalLink href={row.adUrl}>Source ad</ExternalLink><ExternalLink href={row.landingUrl}>Ad destination</ExternalLink>{row.contactUrl && <ExternalLink href={row.contactUrl}>Business contact page</ExternalLink>}</div>
        {blocker && <p className="text-sm text-ink-300">{blocker}</p>}
        {match && <Link className="inline-flex min-h-11 items-center text-sm text-brand-500" to={match.kind === 'lead' ? `/growth/leads?lead=${encodeURIComponent(match.id)}` : `/clients/${encodeURIComponent(match.id)}`}>Review existing {match.kind}</Link>}
        <details><summary className="cursor-pointer py-3 text-sm text-brand-500">Outreach draft for review</summary><pre className="mt-2 whitespace-pre-wrap rounded-lg border border-ink-600 p-4 font-sans text-sm [overflow-wrap:anywhere]">{adOutreachDraft(row)}</pre><p className="mt-2 text-xs text-ink-400">Draft based on your recorded observation. Check accuracy before approval; no message is sent by Cube.</p></details>
        {editable && <div className="flex flex-wrap gap-2">
          {!['contacted', 'do_not_contact'].includes(row.status) && <button type="button" className="btn-secondary min-h-11" disabled={!ready} onClick={() => setEditing(row)}>Edit evidence</button>}
          {row.status === 'needs_review' && <button type="button" className="btn-primary min-h-11" disabled={!ready || Boolean(blocker)} onClick={() => review(row, 'approved')}>Approve draft</button>}
          {row.status === 'approved' && <><button type="button" className="btn-primary min-h-11" disabled={!ready || Boolean(blocker)} onClick={() => copyDraft(row)}>{copiedId === row.id ? 'Draft copied' : 'Copy approved draft'}</button><button type="button" className="btn-secondary min-h-11" disabled={!ready || Boolean(blocker)} onClick={() => review(row, 'contacted')}>Record contact made</button></>}
          {row.status === 'needs_review' && <button type="button" className="btn-ghost min-h-11" disabled={!ready} onClick={() => review(row, 'dismissed')}>Dismiss</button>}
          {row.status !== 'do_not_contact' && <button type="button" className="btn-ghost min-h-11" disabled={!ready} onClick={() => review(row, 'do_not_contact')}>Mark do not contact</button>}
        </div>}
        {row.contactedAt && <p className="text-xs text-ink-400">Contact manually recorded {new Date(row.contactedAt).toLocaleString()}.</p>}
      </article>
    })}
    {!rows.length && ready && <EmptyState icon={MagnifyingGlassIcon} title="No opportunities in this view" description="Start with an ad you reviewed and an observable need. An active ad alone does not establish a service need." />}
    {editing && <OpportunityEditor key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? undefined : editing} today={today} onClose={() => setEditing(null)} onSave={(input) => {
      write((current, actor, stamp, day) => saveAdOpportunity(current, input, actor, stamp, day, editing === 'new' ? undefined : editing))
      setEditing(null)
      setStatus('needs_review')
    }} />}
  </div>
}

function OpportunityEditor({ initial, today, onClose, onSave }: { initial?: AdOpportunity; today: string; onClose: () => void; onSave: (input: AdInput) => void }) {
  const [input, setInput] = useState<AdInput>(() => initial ?? { business: '', source: 'meta', adUrl: '', landingUrl: '', signal: 'broken_destination', evidence: '', observedOn: today, contactUrl: '' })
  const [error, setError] = useState<string | null>(null)
  const field = (name: keyof AdInput, value: string) => setInput((current) => ({ ...current, [name]: value }))
  const submit = () => {
    try { onSave(input) } catch (cause) { setError(cause instanceof Error ? cause.message : 'The opportunity could not be saved.') }
  }
  return <Modal open onClose={onClose} title={initial ? 'Edit ad opportunity' : 'Add ad opportunity'} onSubmit={submit} footer={<><button type="button" className="btn-secondary min-h-11" onClick={onClose}>Cancel</button><button type="submit" className="btn-primary min-h-11">Save opportunity</button></>}>
    <div className="space-y-4">
      {error && <p role="alert" className="text-sm text-ink-100">{error}</p>}
      <label className="block text-xs text-ink-300">Business name<input className="input mt-1 min-h-11" required maxLength={160} value={input.business} onChange={(event) => field('business', event.target.value)} /></label>
      <label className="block text-xs text-ink-300">Ad source<select className="input mt-1 min-h-11" value={input.source} onChange={(event) => field('source', event.target.value)}>{Object.entries(AD_SOURCES).map(([value, source]) => <option key={value} value={value}>{source.label}</option>)}</select></label>
      <label className="block text-xs text-ink-300">Source ad link<input className="input mt-1 min-h-11" type="url" required maxLength={2000} value={input.adUrl} onChange={(event) => field('adUrl', event.target.value)} /></label>
      <label className="block text-xs text-ink-300">Ad destination link<input className="input mt-1 min-h-11" type="url" required maxLength={2000} value={input.landingUrl} onChange={(event) => field('landingUrl', event.target.value)} /></label>
      <label className="block text-xs text-ink-300">Observed signal<select className="input mt-1 min-h-11" value={input.signal} onChange={(event) => field('signal', event.target.value)}>{Object.entries(AD_SIGNALS).map(([value, signal]) => <option key={value} value={value}>{signal.label}</option>)}</select></label>
      <label className="block text-xs text-ink-300">Observed fact<textarea className="input mt-1" required minLength={15} maxLength={2000} rows={4} value={input.evidence} onChange={(event) => field('evidence', event.target.value)} /></label>
      <p className="text-xs text-ink-400">Record what you actually observed and how to reproduce it. Avoid assuming poor ad results or submitting fake enquiries.</p>
      <label className="block text-xs text-ink-300">Observation date<input className="input mt-1 min-h-11" type="date" required max={today} value={input.observedOn} onChange={(event) => field('observedOn', event.target.value)} /></label>
      <label className="block text-xs text-ink-300">Public business contact page<input className="input mt-1 min-h-11" type="url" maxLength={2000} value={input.contactUrl} onChange={(event) => field('contactUrl', event.target.value)} /></label>
      {initial?.status === 'approved' && <p className="text-sm text-ink-300">Saving changes returns this opportunity to review and invalidates the previous approval.</p>}
    </div>
  </Modal>
}
