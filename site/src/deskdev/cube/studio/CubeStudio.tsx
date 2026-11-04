import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ClipboardTextIcon, PlusIcon } from '@phosphor-icons/react'
import { can, isAdmin } from '../../lib/permissions'
import { isSupabaseConfigured } from '../../lib/supabase'
import { useCurrentUser, useStore } from '../../store/useStore'
import Modal from '../../components/Modal'
import EmptyState from '../../components/EmptyState'
import { cubeDate } from '../engine'
import { adWebUrl } from '../ads/model'
import {
  CASE_TYPES, DEPARTMENTS, approveStudioContent, emptyStudioBook, parseStudioBook,
  recordStudioPublication, saveStudioCase, saveStudioContent, studioKey, transitionStudioCase,
  type CaseInput, type CaseStatus, type ContentInput, type StudioBook, type StudioCase, type StudioContent,
} from './model'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block space-y-1 text-xs text-ink-300"><span>{label}</span>{children}</label>
}
function Source({ url, label = 'Open source' }: { url: string; label?: string }) {
  let href: string
  try { href = adWebUrl(url) } catch { return <span className="text-xs text-ink-400">No public source link recorded</span> }
  return <a className="btn-secondary min-h-11" href={href} target="_blank" rel="noopener noreferrer">{label}</a>
}

export default function CubeStudio() {
  const user = useCurrentUser()
  if (!isAdmin(user)) return <EmptyState icon={ClipboardTextIcon} title="Admin access required" description="Workflow planning and content controls are available to active admins." />
  return <StudioWorkspace key={`${isSupabaseConfigured}:${user?.id}`} />
}

function StudioWorkspace() {
  const user = useCurrentUser()
  const users = useStore((state) => state.users)
  const jobs = useStore((state) => state.jobPostings)
  const timezone = useStore((state) => state.workspaceSettings.growthBusinessHours.tz)
  const loadError = useStore((state) => state.loadError)
  const [book, setBook] = useState<StudioBook>(emptyStudioBook)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'cases' | 'content' | 'jobs' | 'reports'>('cases')
  const [now, setNow] = useState(new Date().toISOString())
  const [caseEditor, setCaseEditor] = useState<CaseInput | StudioCase | null>(null)
  const [contentEditor, setContentEditor] = useState<StudioContent | 'new' | null>(null)
  const [outcome, setOutcome] = useState<{ row: StudioCase; status: CaseStatus } | null>(null)
  const [publication, setPublication] = useState<StudioContent | null>(null)
  const [jobQuery, setJobQuery] = useState('')
  const key = studioKey(isSupabaseConfigured ? 'remote' : 'local', user?.id ?? '')
  let today = ''
  try { today = cubeDate(now, timezone) } catch { /* Keep the workspace readable while timezone is corrected. */ }
  const visibleCase = (row: StudioCase) => can(user, CASE_TYPES[row.kind].feature, 'view') && (row.department !== 'Finance' || (user?.role === 'admin' && !user.deactivatedAt))
  const cases = book.cases.filter(visibleCase)
  const content = can(user, 'growth', 'view') ? book.content : []
  const events = book.events.filter((entry) => can(user, entry.feature, 'view') && (entry.entity === 'content' ? content.some((row) => row.id === entry.entityId) : cases.some((row) => row.id === entry.entityId)))

  const reload = useCallback(() => {
    if (!isAdmin(user)) { setBook(emptyStudioBook()); setReady(false); return }
    try { setBook(parseStudioBook(localStorage.getItem(key))); setReady(true); setError(null) }
    catch { setBook(emptyStudioBook()); setReady(false); setError('Local workflow records could not be read. Existing browser data was preserved; saving is disabled.') }
  }, [key, user?.id, user?.deactivatedAt])
  useEffect(() => {
    const first = window.setTimeout(reload, 0)
    const changed = (event: StorageEvent) => { if (event.key === key || event.key === null) reload() }
    window.addEventListener('storage', changed)
    const timer = window.setInterval(() => setNow(new Date().toISOString()), 60000)
    return () => { window.clearTimeout(first); window.removeEventListener('storage', changed); window.clearInterval(timer) }
  }, [key, reload])

  const write = (change: (current: StudioBook, actor: NonNullable<typeof user>, stamp: string) => StudioBook) => {
    const state = useStore.getState()
    const actor = state.users.find((row) => row.id === state.currentUserId)
    if (!ready || !actor || actor.id !== user?.id || !isAdmin(actor)) throw new Error('Reload an active admin account before saving workflow records.')
    const stamp = new Date().toISOString()
    const updated = change(parseStudioBook(localStorage.getItem(key)), actor, stamp)
    localStorage.setItem(key, JSON.stringify(updated))
    setBook(updated)
    setNow(stamp)
    setError(null)
  }
  const run = (action: () => void) => {
    try { action() } catch (cause) { setError(cause instanceof Error ? cause.message : 'The workflow action could not be saved.') }
  }
  const newCase = (sourceUrl = '', title = '', nextStep = '') => {
    const kind = sourceUrl ? 'opportunity' : Object.keys(CASE_TYPES).find((value) => can(user, CASE_TYPES[value as keyof typeof CASE_TYPES].feature, 'edit')) as keyof typeof CASE_TYPES | undefined
    if (!kind) return
    setCaseEditor({ kind, title, department: kind === 'opportunity' ? 'Growth' : 'Delivery', ownerId: user!.id, nextStep, reviewOn: today, sourceUrl })
  }
  const download = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), cases, content, events }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'cube-local-review-data.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return <div className="space-y-4">
    <section className="card density-card space-y-3">
      <h2 className="text-display text-lg font-semibold">Plan, review, and verify the outcome</h2>
      <p className="text-sm text-ink-300">Coordinate department cases, prepare content, and review job opportunities with named owners and recorded evidence.</p>
      <p className="text-xs text-ink-400">Local planning workspace: records belong to this account and browser. Acceptance, contact, and publication are recorded manually; no team notifications or external actions are performed.</p>
    </section>
    <nav className="flex flex-wrap gap-2" aria-label="Workflow views">
      <button type="button" className={`${tab === 'cases' ? 'btn-primary' : 'btn-secondary'} min-h-11`} onClick={() => setTab('cases')}>Department cases</button>
      {can(user, 'growth', 'view') && <><button type="button" className={`${tab === 'content' ? 'btn-primary' : 'btn-secondary'} min-h-11`} onClick={() => setTab('content')}>Content calendar</button><button type="button" className={`${tab === 'jobs' ? 'btn-primary' : 'btn-secondary'} min-h-11`} onClick={() => setTab('jobs')}>Job opportunities</button></>}
      <button type="button" className={`${tab === 'reports' ? 'btn-primary' : 'btn-secondary'} min-h-11`} onClick={() => setTab('reports')}>Outcomes</button>
    </nav>
    {error && <div className="card density-card" role="alert"><p className="text-sm">{error}</p><button type="button" className="btn-secondary mt-3 min-h-11" onClick={reload}>Reload workflows</button></div>}
    {!today && <p className="card density-card text-sm" role="alert">A valid workspace business timezone is required for review dates.</p>}

    {tab === 'cases' && <>
      <button type="button" className="btn-primary min-h-11" disabled={!ready || !today || !Object.values(CASE_TYPES).some((item) => can(user, item.feature, 'edit'))} onClick={() => newCase()}><PlusIcon size={16} aria-hidden />Create case</button>
      {cases.map((row) => <article key={row.id} className="card density-card space-y-3" aria-label={row.title}>
        <div className="flex flex-wrap gap-2"><span className="badge badge-neutral">{row.department}</span><span className={`badge ${row.status === 'resolved' ? 'badge-success' : row.status === 'waiting' ? 'badge-warn' : 'badge-info'}`}>{row.status}</span>{row.reviewOn < today && !['resolved', 'dismissed'].includes(row.status) && <span className="badge badge-warn">Review overdue</span>}</div>
        <h3 className="text-display text-lg font-semibold [overflow-wrap:anywhere]">{row.title}</h3>
        <p className="text-xs text-ink-400">{CASE_TYPES[row.kind].title} · Owner: {users.find((actor) => actor.id === row.ownerId && !actor.deactivatedAt)?.fullName || 'Owner unavailable'} · Review {row.reviewOn}</p>
        <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{row.nextStep}</p>
        {row.evidence && <p className="whitespace-pre-wrap text-sm text-ink-300 [overflow-wrap:anywhere]">Recorded evidence: {row.evidence}</p>}
        <div className="flex flex-wrap gap-2">{row.sourceUrl && <Source url={row.sourceUrl} />}{can(user, CASE_TYPES[row.kind].feature, 'edit') && row.status !== 'resolved' && <>
          <button type="button" className="btn-secondary min-h-11" onClick={() => setCaseEditor(row)}>Edit next step</button>
          {(['accepted', 'waiting', 'resolved', 'dismissed'] as const).filter((status) => status !== row.status).map((status) => <button type="button" key={status} className="btn-secondary min-h-11" onClick={() => setOutcome({ row, status })}>{status === 'accepted' ? 'Record acceptance' : status === 'waiting' ? 'Record blocker' : status === 'resolved' ? 'Verify resolution' : 'Dismiss with reason'}</button>)}
        </>}</div>
      </article>)}
      {!cases.length && <EmptyState icon={ClipboardTextIcon} title="No department cases yet" description="Capture a handoff or exception with an accountable owner, next step, and review date." />}
    </>}

    {tab === 'content' && can(user, 'growth', 'view') && <>
      {can(user, 'growth', 'edit') && <button type="button" className="btn-primary min-h-11" disabled={!ready} onClick={() => setContentEditor('new')}><PlusIcon size={16} aria-hidden />Create content draft</button>}
      {[...content].sort((a, b) => (a.scheduleAt || '9999').localeCompare(b.scheduleAt || '9999')).map((row) => <article className="card density-card space-y-3" key={row.id} aria-label={row.title}>
        <div className="flex flex-wrap gap-2"><span className="badge badge-neutral">{row.channel} · {row.account}</span><span className="badge badge-info">{row.status === 'published' ? 'Publication recorded' : row.status === 'approved' ? 'Approved version' : 'Draft'}</span>{row.status === 'approved' && row.scheduleAt && Date.parse(row.scheduleAt) <= Date.parse(now) && <span className="badge badge-warn">Due for manual publishing</span>}</div>
        <h3 className="text-display text-lg font-semibold [overflow-wrap:anywhere]">{row.title}</h3>
        <p className="text-sm text-ink-300">Objective: {row.objective}</p>
        <pre className="whitespace-pre-wrap font-sans text-sm [overflow-wrap:anywhere]">{row.caption}</pre>
        <p className="text-xs text-ink-400">{row.scheduleAt ? `Planned publication: ${new Date(row.scheduleAt).toLocaleString()}` : 'No publication time set'} · Version {row.version}</p>
        <div className="flex flex-wrap gap-2">{row.assetUrl && <Source url={row.assetUrl} label="Review asset" />}{row.publishedUrl && <Source url={row.publishedUrl} label="View recorded publication" />}
          {can(user, 'growth', 'edit') && row.status !== 'published' && <><button type="button" className="btn-secondary min-h-11" onClick={() => setContentEditor(row)}>Edit draft</button>{row.status === 'draft' ? <button type="button" className="btn-primary min-h-11" onClick={() => run(() => write((current, actor, stamp) => approveStudioContent(current, row, actor, stamp)))}>Approve exact version</button> : <button type="button" className="btn-primary min-h-11" onClick={() => setPublication(row)}>Record publication link</button>}</>}
        </div>
        <p className="text-xs text-ink-400">Approval confirms your review of the caption, assets, claims, consent, account, and timing. Changing any draft field requires a new approval.</p>
      </article>)}
      {!content.length && <EmptyState icon={ClipboardTextIcon} title="No content drafts yet" description="Prepare an objective, caption, asset link, destination account, and publication time." />}
    </>}

    {tab === 'jobs' && can(user, 'growth', 'view') && <>
      <section className="card density-card space-y-3"><h3 className="text-display text-lg font-semibold">Review opportunities from the existing job feed</h3><p className="text-sm text-ink-300">A vacancy is a hiring signal. Confirm whether the company wants an individual applicant or welcomes agency support before preparing a pitch.</p><div className="flex flex-wrap gap-2"><Source url="https://www.onlinejobs.ph/" label="OnlineJobs.ph" /><Source url="https://www.linkedin.com/jobs/" label="LinkedIn jobs" /></div><p className="text-xs text-ink-400">These links open the platforms for manual discovery. Cube does not scrape them or send applications.</p></section>
      <Field label="Filter job opportunities"><input className="input min-h-11" value={jobQuery} onChange={(event) => setJobQuery(event.target.value)} placeholder="Role, company, or service keyword" /></Field>
      {loadError?.includes('jobPostings') && <p role="status" className="card density-card text-sm">Job records could not be loaded. Refresh DeskDev records before assessing the feed.</p>}
      {!loadError?.includes('jobPostings') && jobs.filter((job) => !job.dismissed && `${job.title} ${job.company ?? ''} ${job.description ?? ''}`.toLowerCase().includes(jobQuery.toLowerCase())).map((job) => <article key={job.id} className="card density-card space-y-3" aria-label={job.title}>
        <h3 className="text-display text-lg font-semibold">{job.title}</h3><p className="text-sm text-ink-300">{job.company || 'Company not recorded'} · Source: {job.source} · {job.postedAt ? `Posted ${job.postedAt}` : 'Posting date unknown'}</p><p className="line-clamp-4 whitespace-pre-wrap text-sm text-ink-300">{job.description || 'Review the original listing for requirements.'}</p><div className="flex flex-wrap gap-2"><Source url={job.url} label="Review job listing" />{can(user, 'growth', 'edit') && <button type="button" className="btn-primary min-h-11" disabled={!ready || !today} onClick={() => newCase(job.url, `${job.company || 'Opportunity'}: ${job.title}`, 'Review the listing, verify service fit and agency eligibility, and choose an application or outreach route.')}>Create opportunity review</button>}</div>
      </article>)}
      {can(user, 'growth', 'edit') && <button type="button" className="btn-secondary min-h-11" disabled={!ready || !today} onClick={() => setCaseEditor({ kind: 'opportunity', title: '', department: 'Growth', ownerId: user!.id, nextStep: 'Review service fit and whether agency support is welcome.', sourceUrl: '', reviewOn: today })}>Add a manually found opportunity</button>}
    </>}

    {tab === 'reports' && <section className="card density-card space-y-4" aria-label="Local workflow outcomes">
      <h2 className="text-display text-lg font-semibold">Local workflow outcomes</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">{[['Open cases', cases.filter((row) => !['resolved', 'dismissed'].includes(row.status)).length], ['Resolved cases', cases.filter((row) => row.status === 'resolved').length], ['Approved drafts', content.filter((row) => row.status === 'approved').length], ['Recorded publications', content.filter((row) => row.status === 'published').length]].map(([label, count]) => <div key={label}><p className="text-xs text-ink-400">{label}</p><p className="text-display text-2xl tabular-nums">{count}</p></div>)}</div>
      <p className="text-sm text-ink-300">Counts reflect your local records. Campaign performance and shared team response times require connected analytics and shared execution records.</p>
      <button type="button" className="btn-secondary min-h-11" onClick={download}>Export local review dataset</button>
      <div className="divide-y divide-ink-600">{[...events].reverse().slice(0, 30).map((entry) => <p key={entry.id} className="py-3 text-sm text-ink-300">{entry.entity} · {entry.action} · {new Date(entry.at).toLocaleString()}</p>)}</div>
    </section>}

    {caseEditor && <CaseEditor input={caseEditor} users={users} today={today} onClose={() => setCaseEditor(null)} onSave={(input) => {
      write((current, actor, stamp) => saveStudioCase(current, input, actor, useStore.getState().users, stamp, 'id' in caseEditor ? caseEditor : undefined))
      setCaseEditor(null)
      setTab('cases')
    }} />}
    {contentEditor && <ContentEditor initial={contentEditor === 'new' ? undefined : contentEditor} onClose={() => setContentEditor(null)} onSave={(input) => {
      write((current, actor, stamp) => saveStudioContent(current, input, actor, stamp, contentEditor === 'new' ? undefined : contentEditor))
      setContentEditor(null)
    }} />}
    {outcome && <EvidenceDialog title={`Record ${outcome.status}`} label="Acceptance, blocker, resolution, or rejection evidence" onClose={() => setOutcome(null)} onSave={(evidence) => {
      write((current, actor, stamp) => transitionStudioCase(current, outcome.row, outcome.status, evidence, actor, stamp))
      setOutcome(null)
    }} />}
    {publication && <EvidenceDialog title="Record manual publication" label="Published post URL" onClose={() => setPublication(null)} onSave={(url) => {
      write((current, actor, stamp) => recordStudioPublication(current, publication, url, actor, stamp))
      setPublication(null)
    }} />}
  </div>
}

function CaseEditor({ input: initial, users, today, onClose, onSave }: { input: CaseInput; users: ReturnType<typeof useStore.getState>['users']; today: string; onClose: () => void; onSave: (input: CaseInput) => void }) {
  const [input, setInput] = useState(initial)
  const [error, setError] = useState('')
  const currentUser = useCurrentUser()
  const update = (field: keyof CaseInput, value: string) => setInput((current) => ({ ...current, [field]: value }))
  return <Modal open title="Department case" onClose={onClose} onSubmit={() => { try { onSave(input) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save case.') } }} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="submit" className="btn-primary">Save case</button></>}>
    <div className="space-y-4">{error && <p role="alert" className="text-sm">{error}</p>}
      <Field label="Case type"><select className="input min-h-11" value={input.kind} onChange={(event) => update('kind', event.target.value)}>{Object.entries(CASE_TYPES).filter(([, item]) => can(currentUser, item.feature, 'edit')).map(([key, item]) => <option value={key} key={key}>{item.title}</option>)}</select></Field>
      <Field label="Case title"><input className="input min-h-11" required maxLength={200} value={input.title} onChange={(event) => update('title', event.target.value)} /></Field>
      <Field label="Receiving department"><select className="input min-h-11" value={input.department} onChange={(event) => update('department', event.target.value)}>{DEPARTMENTS.filter((department) => department !== 'Finance' || currentUser?.role === 'admin').map((department) => <option key={department}>{department}</option>)}</select></Field>
      <Field label="Accountable owner"><select className="input min-h-11" value={input.ownerId} onChange={(event) => update('ownerId', event.target.value)}><option value="">Choose an owner</option>{users.filter((user) => can(user, CASE_TYPES[input.kind].feature, 'edit') && (input.department !== 'Finance' || user.role === 'admin')).map((user) => <option value={user.id} key={user.id}>{user.fullName}</option>)}</select></Field>
      <Field label="Next step"><textarea className="input" required maxLength={2000} rows={3} value={input.nextStep} onChange={(event) => update('nextStep', event.target.value)} /></Field>
      <Field label="Review date"><input className="input min-h-11" type="date" required value={input.reviewOn || today} onChange={(event) => update('reviewOn', event.target.value)} /></Field>
      <Field label="Public source link"><input className="input min-h-11" type="url" maxLength={2000} value={input.sourceUrl} onChange={(event) => update('sourceUrl', event.target.value)} /></Field>
    </div>
  </Modal>
}

function ContentEditor({ initial, onClose, onSave }: { initial?: StudioContent; onClose: () => void; onSave: (input: ContentInput) => void }) {
  const [input, setInput] = useState<ContentInput>(() => initial ?? { title: '', channel: 'LinkedIn', account: '', objective: '', caption: '', assetUrl: '', scheduleAt: '' })
  const [error, setError] = useState('')
  const update = (field: keyof ContentInput, value: string) => setInput((current) => ({ ...current, [field]: value }))
  return <Modal open title="Content draft" onClose={onClose} onSubmit={() => { try { onSave(input) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save draft.') } }} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="submit" className="btn-primary">Save draft</button></>}>
    <div className="space-y-4">{error && <p role="alert" className="text-sm">{error}</p>}
      <Field label="Content title"><input className="input min-h-11" required maxLength={200} value={input.title} onChange={(event) => update('title', event.target.value)} /></Field>
      <Field label="Channel"><select className="input min-h-11" value={input.channel} onChange={(event) => update('channel', event.target.value)}>{['Facebook', 'Instagram', 'LinkedIn', 'Other'].map((channel) => <option key={channel}>{channel}</option>)}</select></Field>
      <Field label="Destination account"><input className="input min-h-11" required maxLength={160} value={input.account} onChange={(event) => update('account', event.target.value)} /></Field>
      <Field label="Content objective"><input className="input min-h-11" required maxLength={1000} value={input.objective} onChange={(event) => update('objective', event.target.value)} /></Field>
      <Field label="Caption"><textarea className="input" required rows={5} maxLength={12000} value={input.caption} onChange={(event) => update('caption', event.target.value)} /></Field>
      <Field label="Asset review link"><input className="input min-h-11" type="url" value={input.assetUrl} onChange={(event) => update('assetUrl', event.target.value)} /></Field>
      <Field label="Planned publication time (your device timezone)"><input className="input min-h-11" type="datetime-local" value={input.scheduleAt ? new Date(Date.parse(input.scheduleAt) - new Date(input.scheduleAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''} onChange={(event) => update('scheduleAt', event.target.value ? new Date(event.target.value).toISOString() : '')} /></Field>
      {initial?.status === 'approved' && <p className="text-xs text-ink-400">Saving changes removes the previous approval.</p>}
    </div>
  </Modal>
}

function EvidenceDialog({ title, label, onClose, onSave }: { title: string; label: string; onClose: () => void; onSave: (value: string) => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  return <Modal open title={title} onClose={onClose} onSubmit={() => { try { onSave(value) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save evidence.') } }} footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="submit" className="btn-primary">Save evidence</button></>}>
    {error && <p role="alert" className="mb-3 text-sm">{error}</p>}<Field label={label}><textarea className="input" required rows={4} maxLength={2000} value={value} onChange={(event) => setValue(event.target.value)} /></Field>
  </Modal>
}
