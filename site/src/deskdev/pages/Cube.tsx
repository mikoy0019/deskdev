import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRightIcon, CubeIcon, ArrowsClockwiseIcon } from '@phosphor-icons/react'
import Layout from '../components/Layout'
import EmptyState from '../components/EmptyState'
import { SkeletonList } from '../components/ui-foundation'
import { useCurrentUser, useStore } from '../store/useStore'
import { isSupabaseConfigured } from '../lib/supabase'
import { can, isAdmin } from '../lib/permissions'
import { CUBE_PLAYBOOKS, canReviewCubeDecision, cubeDecisionHref, cubePlaybookVisible, evaluateCube, type CubeDecision, type CubeDepartment, type CubePlaybookId } from '../cube/engine'
import { cubeJournalKey, cubeReviewState, emptyCubeJournal, parseCubeJournal, reviewCubeDecision, type CubeJournal, type CubeReviewAction } from '../cube/journal'
import { cubeSnapshot, useCubeSnapshot } from '../cube/useCube'
import AdOpportunities from '../cube/ads/AdOpportunities'
import CubeStudio from '../cube/studio/CubeStudio'
import OperationsBoard from '../cube/OperationsBoard'
import ReferencePages from '../cube/ReferencePages'

const DEPARTMENTS: Record<CubeDepartment, string> = { growth: 'Growth', delivery: 'Delivery', finance: 'Finance' }
const REVIEW_LABELS = { acknowledged: 'Acknowledged', snoozed: 'Snoozed for 24 hours', reopened: 'Reopened' }

export default function Cube() {
  const user = useCurrentUser()
  return <CubeWorkspace key={`${isSupabaseConfigured ? 'remote' : 'local'}:${user?.id}`} userId={user?.id ?? ''} />
}

function CubeWorkspace({ userId }: { userId: string }) {
  const [now, setNow] = useState(() => new Date().toISOString())
  const snapshot = useCubeSnapshot(now)
  const hydrated = useStore((state) => state.hydrated)
  const hydrate = useStore((state) => state.hydrate)
  const key = cubeJournalKey(isSupabaseConfigured ? 'remote' : 'local', userId)
  const [journal, setJournal] = useState<CubeJournal>(emptyCubeJournal)
  const [error, setError] = useState<string | null>(null)
  const [storageReady, setStorageReady] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [tab, setTab] = useState<'inbox' | 'playbooks' | 'history' | 'ads' | 'studio' | 'operations'>('inbox')
  const [department, setDepartment] = useState<'all' | CubeDepartment>('all')
  const [stateFilter, setStateFilter] = useState<'pending' | 'all'>('pending')

  const readJournal = useCallback(() => {
    try {
      setJournal(parseCubeJournal(localStorage.getItem(key), userId))
      setStorageReady(true)
      setError(null)
    } catch {
      setStorageReady(false)
      setError('Personal review history could not be loaded. Recommendations remain available; reviews are disabled until history can be read.')
    }
  }, [key, userId])
  useEffect(() => {
    const first = window.setTimeout(readJournal, 0)
    const onStorage = (event: StorageEvent) => { if (event.key === key || event.key === null) readJournal() }
    window.addEventListener('storage', onStorage)
    const timer = window.setInterval(() => setNow(new Date().toISOString()), 60_000)
    return () => { window.clearTimeout(first); window.removeEventListener('storage', onStorage); window.clearInterval(timer) }
  }, [key, readJournal])

  const evaluation = useMemo(() => {
    try { return { decisions: evaluateCube(snapshot), error: null } }
    catch { return { decisions: [] as CubeDecision[], error: 'Cube could not evaluate the records. Check the workspace business timezone in Settings and refresh.' } }
  }, [snapshot])
  const playbooks = CUBE_PLAYBOOKS.filter((playbook) => cubePlaybookVisible(snapshot.user, playbook.id))
  const decisions = evaluation.decisions.filter((decision) => !journal.paused.includes(decision.playbookId))
  const pending = decisions.filter((decision) => cubeReviewState(journal, decision, now) === 'pending')
  const filtered = decisions.filter((decision) => (department === 'all' || decision.department === department) && (stateFilter === 'all' || cubeReviewState(journal, decision, now) === 'pending'))
  const visibleHistory = [...journal.reviews].reverse().filter((review) => cubePlaybookVisible(snapshot.user, review.playbookId))

  const saveJournal = (change: (current: CubeJournal) => CubeJournal) => {
    try {
      if (!storageReady) throw new Error('Read personal review history before making changes.')
      // Read again so another tab's latest reviews are not replaced by this tab's old copy.
      const updated = change(parseCubeJournal(localStorage.getItem(key), userId))
      localStorage.setItem(key, JSON.stringify(updated))
      setJournal(updated)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The review could not be saved. Try again.')
    }
  }
  const review = (decision: CubeDecision, action: CubeReviewAction) => {
    const at = new Date().toISOString()
    saveJournal((current) => {
      const latest = cubeSnapshot(at)
      if (latest.user?.id !== userId) throw new Error('Your account changed. Reload Cube before reviewing.')
      return reviewCubeDecision(current, decision, evaluateCube(latest), latest.user, action, at)
    })
    setNow(at)
  }
  const togglePlaybook = (id: CubePlaybookId) => saveJournal((current) => {
    const latest = cubeSnapshot(new Date().toISOString())
    const playbook = CUBE_PLAYBOOKS.find((item) => item.id === id)!
    if (latest.user?.id !== userId || !cubePlaybookVisible(latest.user, id) || !can(latest.user, playbook.feature, 'edit')) throw new Error('Your permissions changed. Reload Cube before changing this playbook.')
    return { ...current, paused: current.paused.includes(id) ? current.paused.filter((item) => item !== id) : [...current.paused, id] }
  })
  const refresh = async () => {
    setRefreshing(true)
    try { await hydrate(); setNow(new Date().toISOString()) }
    catch { setError('DeskDev records could not be refreshed. Try again.') }
    finally { setRefreshing(false) }
  }

  return (
    <Layout title="Cube" subtitle="Operational decisions, grounded in your records">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="card density-card" aria-label="Cube overview">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <CubeIcon size={28} className="shrink-0 text-brand-500" aria-hidden />
              <div>
                <div className="flex flex-wrap items-center gap-2"><h2 className="text-display text-xl font-semibold">Your next operational move</h2><span className="badge badge-info">{tab === 'operations' ? 'Department operations' : 'Recommendations'}</span></div>
                <p className="mt-2 max-w-2xl text-sm text-ink-300">{tab === 'operations' ? 'Cube automatically organizes departmental work around recorded prerequisites, responsible admins and unresolved exceptions.' : 'Cube checks leads, blocked work, and engagement readiness. Review the evidence, then carry out the next step in its source record.'}</p>
                <p className="mt-2 text-xs text-ink-400">{tab === 'operations' ? 'Use Operations for automatic shared queues. The decision inbox retains its personal acknowledgement and snooze workflow.' : 'Acknowledgements and snoozes are personal to this browser. They do not complete work, send messages, or change business records.'}</p>
              </div>
            </div>
            <button type="button" className="btn-secondary min-h-11" onClick={refresh} disabled={refreshing}><ArrowsClockwiseIcon size={16} aria-hidden />{refreshing ? 'Refreshing…' : 'Refresh records'}</button>
          </div>
          {tab !== 'operations' && hydrated && !evaluation.error && <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[['Needs review', pending.length], ['Urgent', pending.filter((decision) => decision.severity === 'urgent').length], ['Visible playbooks', playbooks.length], ['Personal reviews', visibleHistory.length]].map(([label, value]) => <div key={label} className="border-t border-ink-600 pt-3"><p className="text-xs text-ink-300">{label}</p><p className="mt-1 text-display text-2xl font-semibold tabular-nums">{value}</p></div>)}
          </div>}
        </section>

        {(error || evaluation.error) && <div role="alert" className="card density-card space-y-3"><p className="text-sm text-ink-100">{error || evaluation.error}</p>{error && <button type="button" className="btn-secondary min-h-11" onClick={readJournal}>Retry history</button>}{evaluation.error && <Link className="btn-secondary min-h-11" to="/settings">Open settings</Link>}</div>}
        {snapshot.unavailable.length > 0 && hydrated && <div role="status" className="card density-card text-sm text-ink-200">Some source records are unavailable. Cube skips their checks rather than treating missing data as a completed prerequisite. Refresh records to retry.</div>}

        <nav aria-label="Cube views" className="flex flex-wrap gap-2">
          {isAdmin(snapshot.user) && <button type="button" aria-pressed={tab === 'operations'} className={`${tab === 'operations' ? 'btn-primary' : 'btn-secondary'} min-h-11`} onClick={() => setTab('operations')}>Operations</button>}
          {(['inbox', 'playbooks', 'history'] as const).map((view) => <button key={view} type="button" aria-pressed={tab === view} className={`${tab === view ? 'btn-primary' : 'btn-secondary'} min-h-11`} onClick={() => setTab(view)}>{view === 'inbox' ? 'Decision inbox' : view === 'playbooks' ? 'Playbooks' : 'Review history'}</button>)}
          {isAdmin(snapshot.user) && <><button type="button" aria-pressed={tab === 'ads'} className={`${tab === 'ads' ? 'btn-primary' : 'btn-secondary'} min-h-11`} onClick={() => setTab('ads')}>Ad opportunities</button><button type="button" aria-pressed={tab === 'studio'} className={`${tab === 'studio' ? 'btn-primary' : 'btn-secondary'} min-h-11`} onClick={() => setTab('studio')}>Workflow studio</button></>}
        </nav>

        {isAdmin(snapshot.user) && <ReferencePages />}

        {!hydrated ? <div aria-busy="true" aria-label="Loading Cube records"><SkeletonList count={3} /></div> : tab === 'operations' ? <OperationsBoard /> : tab === 'ads' ? <AdOpportunities /> : tab === 'studio' ? <CubeStudio /> : tab === 'inbox' ? <>
          <div className="flex flex-wrap gap-4">
            <label className="text-xs text-ink-300">Department<select className="input mt-1 min-h-11" value={department} onChange={(event) => setDepartment(event.target.value as typeof department)}><option value="all">All departments</option>{playbooks.map((playbook) => <option key={playbook.department} value={playbook.department}>{DEPARTMENTS[playbook.department]}</option>)}</select></label>
            <label className="text-xs text-ink-300">Review status<select className="input mt-1 min-h-11" value={stateFilter} onChange={(event) => setStateFilter(event.target.value as typeof stateFilter)}><option value="pending">Needs review</option><option value="all">All current recommendations</option></select></label>
          </div>
          <div className="space-y-4">
            {filtered.map((decision) => {
              const state = cubeReviewState(journal, decision, now)
              const editable = canReviewCubeDecision(snapshot.user, decision)
              return <article key={decision.id} className="card density-card" aria-label={decision.title}>
                <div className="flex flex-wrap items-center gap-2 text-xs"><span className="badge badge-neutral">{DEPARTMENTS[decision.department]}</span><span className={`badge ${decision.severity === 'urgent' ? 'badge-danger' : 'badge-warn'}`}>{decision.severity === 'urgent' ? 'Urgent' : 'Attention'}</span>{state !== 'pending' && <span className="badge badge-info">{state === 'acknowledged' ? 'Acknowledged' : 'Snoozed'}</span>}</div>
                <h3 className="mt-3 text-display text-lg font-semibold [overflow-wrap:anywhere]">{decision.title}</h3>
                <p className="mt-1 text-sm text-ink-200">{decision.summary}</p>
                <div className="mt-4 border-l-2 border-brand-500 pl-3"><p className="text-xs font-medium text-ink-300">Next step · {decision.ownerLabel}</p><p className="mt-1 text-sm text-ink-100">{decision.nextAction}</p></div>
                <details className="mt-4"><summary className="cursor-pointer py-3 text-sm text-brand-500">Evidence and matched rules</summary><dl className="grid gap-3 text-sm sm:grid-cols-2">{decision.evidence.map((evidence) => <div key={evidence.label}><dt className="text-xs text-ink-400">{evidence.label}</dt><dd className="mt-1 whitespace-pre-wrap text-ink-200 [overflow-wrap:anywhere]">{evidence.value}</dd></div>)}</dl><p className="mt-3 break-words font-mono text-xs text-ink-400">{decision.playbookId} v{decision.playbookVersion} · {decision.reasonCodes.join(', ')}</p></details>
                <div className="mt-4 flex flex-wrap gap-2"><Link className="btn-primary min-h-11" to={cubeDecisionHref(decision)}>Open record<ArrowRightIcon size={14} aria-hidden /></Link>{editable && <>{state === 'pending' ? <><button type="button" className="btn-secondary min-h-11" disabled={!storageReady} onClick={() => review(decision, 'acknowledged')}>Acknowledge</button><button type="button" className="btn-ghost min-h-11" disabled={!storageReady} onClick={() => review(decision, 'snoozed')}>Snooze 24 hours</button></> : <button type="button" className="btn-secondary min-h-11" disabled={!storageReady} onClick={() => review(decision, 'reopened')}>Reopen review</button>}</>}</div>
                {!editable && <p className="mt-2 text-xs text-ink-400">View only. An editor can acknowledge or snooze this recommendation.</p>}
              </article>
            })}
            {filtered.length === 0 && <EmptyState icon={CubeIcon} title={evaluation.error || snapshot.unavailable.length ? 'Evaluation is incomplete' : 'No recommendations in this view'} description={evaluation.error || snapshot.unavailable.length ? 'Refresh the source records to complete the available checks.' : 'Only the enabled playbooks and records you can view are checked. Acknowledged items remain under All current recommendations.'} action={<button type="button" className="btn-secondary min-h-11" onClick={() => { setDepartment('all'); setStateFilter('all') }}>Show all current recommendations</button>} />}
          </div>
        </> : tab === 'playbooks' ? <div className="grid gap-4 md:grid-cols-3">
          {playbooks.map((playbook) => <section key={playbook.id} className="card density-card"><span className="badge badge-neutral">{DEPARTMENTS[playbook.department]}</span><h3 className="mt-3 text-display text-lg font-semibold">{playbook.title}</h3><p className="mt-2 text-sm text-ink-300">{playbook.description}</p><p className="mt-4 text-xs text-ink-400">Version 1 · {playbook.adminOnly ? 'Active admins' : 'Existing feature permissions'} · Recommendation only</p><p className="mt-2 text-xs text-ink-400">Pause applies to your personal inbox in this browser.</p><button type="button" className="btn-secondary mt-4 min-h-11" disabled={!storageReady || !can(snapshot.user, playbook.feature, 'edit')} onClick={() => togglePlaybook(playbook.id)}>{journal.paused.includes(playbook.id) ? 'Resume playbook' : 'Pause playbook'}</button></section>)}
          {playbooks.length === 0 && <EmptyState icon={CubeIcon} title="No playbooks available" description="Your current permissions do not include Cube's source features." />}
        </div> : <section className="card density-card" aria-label="Personal review history"><h2 className="text-display text-lg font-semibold">Personal review history</h2><p className="mt-2 text-sm text-ink-300">Latest 200 review events on this browser. This is a personal activity record, not a shared audit log.</p><div className="mt-4 divide-y divide-ink-600">{visibleHistory.map((entry) => {
          const current = evaluation.decisions.find((decision) => decision.id === entry.decisionId)
          return <div key={entry.id} className="py-4"><p className="text-sm font-medium">{REVIEW_LABELS[entry.action]} · {CUBE_PLAYBOOKS.find((playbook) => playbook.id === entry.playbookId)?.title}</p><p className="mt-1 text-xs text-ink-400">{new Date(entry.at).toLocaleString()} {entry.until ? `· Until ${new Date(entry.until).toLocaleString()}` : ''}</p>{current ? <Link to={cubeDecisionHref(current)} className="mt-2 inline-flex min-h-11 items-center text-sm text-brand-500 [overflow-wrap:anywhere]">{current.title}</Link> : <p className="mt-2 text-sm text-ink-300">Source no longer produces a visible recommendation.</p>}</div>
        })}{visibleHistory.length === 0 && <p className="py-6 text-sm text-ink-300">No personal reviews recorded yet.</p>}</div></section>}
      </div>
    </Layout>
  )
}
