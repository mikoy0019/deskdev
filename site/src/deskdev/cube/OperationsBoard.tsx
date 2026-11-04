import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCurrentUser, useStore } from '../store/useStore'
import { isAdmin } from '../lib/permissions'
import { isSupabaseConfigured } from '../lib/supabase'
import { emptyIntake, OPERATION_DEPARTMENTS, operationHref, type CubeIntake, type OperationDepartment, type OperationState } from './operations'
import { OPERATIONS_CHANGED, configureOperations, loadOperations, runOperations, saveIntake } from './operationsApi'

export default function OperationsBoard() {
  const user = useCurrentUser()
  const users = useStore(s => s.users)
  const projects = useStore(s => s.projects)
  const [state, setState] = useState<OperationState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [department, setDepartment] = useState<'all' | OperationDepartment>('all')
  const [draft, setDraft] = useState<CubeIntake | null>(null)
  const [resolved, setResolved] = useState(false)
  const mounted = useRef(false)
  const sequence = useRef(0)
  const actionPending = useRef(false)
  const reload = useCallback(async () => {
    const request = ++sequence.current
    try {
      const value = await loadOperations()
      if (mounted.current && request === sequence.current) { setState(value); setError(null) }
    } catch (cause) {
      if (mounted.current && request === sequence.current) { setState(null); setError(cause instanceof Error ? cause.message : 'Cube operations could not be loaded.') }
    }
  }, [])
  useEffect(() => {
    mounted.current = true
    const first = window.setTimeout(() => void reload(), 0)
    const update = () => { if (!actionPending.current) void reload() }
    const timer = setInterval(update, 10_000)
    window.addEventListener(OPERATIONS_CHANGED, update)
    window.addEventListener('storage', update)
    return () => { mounted.current = false; ++sequence.current; window.clearTimeout(first); clearInterval(timer); window.removeEventListener(OPERATIONS_CHANGED, update); window.removeEventListener('storage', update) }
  }, [reload])
  const action = async (execute: () => Promise<unknown>, after?: () => void) => {
    if (actionPending.current) return
    actionPending.current = true
    setBusy(true)
    ++sequence.current
    try { await execute(); if (mounted.current) { after?.(); await reload() } }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'The Cube operation failed.') }
    finally { actionPending.current = false; if (mounted.current) setBusy(false) }
  }
  if (!isAdmin(user)) return null
  const admins = users.filter(isAdmin)
  const visible = state?.work.filter(w => (resolved || w.status === 'open') && (department === 'all' || department === w.department)) ?? []
  return <div className="space-y-5" aria-label="Cube automatic operations">
    <section className="card density-card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-display text-xl font-semibold">Automatic operations</h2><span className="badge badge-info">{state ? state.enabled ? 'Automatic routing on' : 'Paused' : 'Unavailable'}</span></div>
      <p className="text-sm text-ink-300">Cube creates and routes internal work, holds missing prerequisites, resolves cleared exceptions and escalates urgent work after 24 hours. Department admins own the queues.</p>
      <p className="text-xs text-ink-400">{isSupabaseConfigured ? 'The server evaluates every minute, even when DeskDev is closed.' : 'Local demo: evaluates while an admin has DeskDev open. Shared background operation requires the server setup.'} This board refreshes every 10 seconds. Contract acceptance, receipts and completed work require real evidence.</p>
      <p className="text-xs text-ink-400">Last successful evaluation: {state?.lastRunAt ? new Date(state.lastRunAt).toLocaleString() : 'Not yet run'}</p>
      <div className="flex flex-wrap gap-2"><button className="btn-secondary min-h-11" disabled={busy || !state} onClick={() => void action(runOperations)}>Evaluate now</button><button className="btn-secondary min-h-11" disabled={busy || !state} onClick={() => state && void action(() => configureOperations('workspace', null, !state.enabled))}>{state?.enabled ? 'Pause all operations' : 'Resume all operations'}</button><button className="btn-ghost min-h-11" disabled={busy} onClick={() => void reload()}>Refresh operations</button></div>
    </section>
    {(error || state?.error) && <div role="alert" className="card density-card text-sm">{error || state?.error}</div>}
    {state && <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{state.teams.map(team => <section key={team.code} className="card density-card space-y-3" aria-label={OPERATION_DEPARTMENTS[team.code]}>
        <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{OPERATION_DEPARTMENTS[team.code]}</h3><span className="badge badge-neutral">{state.work.filter(w => w.department === team.code && w.status === 'open').length} open</span></div>
        <label className="block text-xs text-ink-300">Department admin<select className="input mt-1 min-h-11 w-full" aria-label={`${OPERATION_DEPARTMENTS[team.code]} admin`} value={team.ownerId ?? ''} disabled={busy} onChange={e => void action(() => configureOperations(team.code, e.target.value || null, team.enabled))}><option value="">Automatic active-admin fallback</option>{admins.map(admin => <option key={admin.id} value={admin.id}>{admin.fullName}</option>)}</select></label>
        <button className="btn-secondary min-h-11" disabled={busy} onClick={() => void action(() => configureOperations(team.code, team.ownerId, !team.enabled))}>{team.enabled ? 'Pause department' : 'Resume department'}</button>
      </section>)}</div>
      <section className="card density-card space-y-4" aria-label="Project intake and contracts">
        <h3 className="text-display text-lg font-semibold">Project intake and contracts</h3><p className="text-sm text-ink-300">Prepare the intake now. Add the actual contract reference when supplied; scope, acceptance and receipts remain in the Engagement panel.</p>
        <label className="block text-xs text-ink-300">Project<select className="input mt-1 min-h-11" value={draft?.projectId ?? ''} disabled={busy} onChange={e => { const id = e.target.value; setDraft(id ? { ...(state.intakes.find(i => i.projectId === id) ?? emptyIntake(id)) } : null) }}><option value="">Choose a project</option>{projects.filter(p => p.status !== 'done').map(p => <option value={p.id} key={p.id}>{p.title}</option>)}</select></label>
        {draft && <form className="space-y-3" onSubmit={e => { e.preventDefault(); void action(() => saveIntake(draft), () => setDraft(null)) }}>
          <label className="block text-xs text-ink-300">Contract reference<input className="input mt-1" value={draft.contractReference} maxLength={2000} placeholder="Pending — add the real file or agreement reference later" onChange={e => setDraft({ ...draft, contractReference: e.target.value })} /></label>
          <div className="grid gap-3 sm:grid-cols-2">{([['briefConfirmed','Brief confirmed'],['assetsConfirmed','Assets confirmed'],['creativeRequired','Creative review required'],['creativeApproved','Creative approved'],['qaConfirmed','Delivery QA confirmed']] as const).map(([field,label]) => <label key={field} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={draft[field]} onChange={e => setDraft({ ...draft, [field]: e.target.checked })} />{label}</label>)}</div>
          <label className="block text-xs text-ink-300">Confirmation evidence<textarea className="input mt-1" maxLength={4000} value={draft.evidence} placeholder="References to the brief, assets, review or QA evidence" onChange={e => setDraft({ ...draft, evidence: e.target.value })} /></label>
          <p className="text-xs text-ink-400">Confirmations need evidence. A missing contract reference keeps the Finance prerequisite open.</p><button className="btn-primary min-h-11" disabled={busy} type="submit">Save project intake</button>
        </form>}
      </section>
      <section className="space-y-4" aria-label="Department work queue"><div className="flex flex-wrap items-center gap-4"><label className="text-xs text-ink-300">Operations department<select className="input mt-1 min-h-11" value={department} onChange={e => setDepartment(e.target.value as typeof department)}><option value="all">All departments</option>{Object.entries(OPERATION_DEPARTMENTS).map(([code,label]) => <option value={code} key={code}>{label}</option>)}</select></label><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={resolved} onChange={e => setResolved(e.target.checked)} />Include resolved work</label></div>
        {visible.map(work => { const href = operationHref(work); return <article key={work.key} className="card density-card space-y-3" aria-label={`${OPERATION_DEPARTMENTS[work.department]}: ${work.title}`}><div className="flex flex-wrap gap-2"><span className="badge badge-neutral">{OPERATION_DEPARTMENTS[work.department]}</span><span className={`badge ${work.urgency === 'urgent' ? 'badge-danger' : 'badge-info'}`}>{work.urgency}</span><span className="badge badge-neutral">{work.status}</span></div><h3 className="font-semibold">{work.title}</h3><p className="text-sm text-ink-300">{work.instruction}</p><p className="text-xs text-ink-400">Owner: {users.find(u => u.id === work.ownerId)?.fullName ?? 'Active admin required'} · Opened {new Date(work.firstSeenAt).toLocaleString()}</p>{href && <Link className="btn-secondary min-h-11 inline-flex" to={href}>Open source record</Link>}</article> })}
        {visible.length === 0 && <p className="card density-card text-sm text-ink-300">No work in this view. Only enabled departments and recorded prerequisites are evaluated.</p>}
      </section>
      <section className="card density-card space-y-3" aria-label="Automatic operation history"><h3 className="text-display text-lg font-semibold">Recent operational changes</h3><p className="text-xs text-ink-400">{isSupabaseConfigured ? 'Latest 50 server-recorded changes. Direct writes from signed-in users are blocked.' : 'Local demo history, limited to 200 changes in this browser.'}</p><div className="divide-y divide-ink-600">{[...state.history].reverse().slice(0,50).map(entry => <div key={entry.id} className="py-3"><p className="text-sm [overflow-wrap:anywhere]">{entry.action} · {state.work.find(w => w.key === entry.workKey)?.title ?? entry.workKey ?? 'Workspace configuration'}</p><p className="mt-1 text-xs text-ink-400">{new Date(entry.at).toLocaleString()}</p></div>)}</div>{!state.history.length && <p className="text-sm text-ink-300">No recorded changes yet.</p>}</section>
    </>}
  </div>
}
