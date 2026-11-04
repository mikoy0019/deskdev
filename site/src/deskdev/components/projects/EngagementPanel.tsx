import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Link } from 'react-router-dom'
import { useCurrentUser, useStore } from '../../store/useStore'
import { isAdmin } from '../../lib/permissions'
import { isSupabaseConfigured } from '../../lib/supabase'
import { isTableMissing } from '../../lib/db'
import { ENGAGEMENT_CURRENCIES, emptyEngagementTerms, engagementGate, engagementTotals, parseMoney } from '../../lib/engagements'
import type { EngagementTerms, Project, ProjectEngagement } from '../../lib/types'
import { SkeletonBlock, SkeletonLine } from '../ui-foundation'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block min-w-0 space-y-1 text-xs text-ink-200"><span>{label}</span>{children}</label>
}

export default function EngagementPanel({ project }: { project: Project }) {
  const user = useCurrentUser()
  const record = useStore((s) => s.projectEngagements.find((e) => e.projectId === project.id))
  const hydrated = useStore((s) => s.hydrated)
  const failed = useStore((s) => s.loadError?.includes('projectEngagements'))
  const hydrate = useStore((s) => s.hydrate)
  const sourceLeadId = useStore((s) => s.projectEngagements.find((e) => e.projectId === project.id)?.leadId ?? s.leadActivity.find((a) => a.action === 'converted' && a.detail.project_id === project.id)?.leadId)
  if (!isAdmin(user)) return null
  if (!hydrated) return <section className="card mt-8 space-y-4 p-5" aria-busy="true" aria-label="Loading engagement"><SkeletonBlock w={160} h={24} /><SkeletonLine /><SkeletonLine w="65%" /></section>
  if (failed || (isSupabaseConfigured && isTableMissing('project_engagements'))) {
    return <section className="card mt-8 space-y-3 p-5" role="status"><h2 className="text-display text-lg font-semibold">Engagement</h2>
      <p className="text-sm text-ink-200">{failed ? 'Engagement records could not be loaded.' : 'Engagement tracking is not enabled for this workspace yet.'}</p>
      <button type="button" className="btn-secondary" onClick={() => void hydrate()}>Retry</button></section>
  }
  return <><EngagementEditor key={project.id} project={project} record={record} />
    {sourceLeadId && <Link className="mt-4 inline-block text-sm text-brand-600 hover:underline" to={`/growth/leads?lead=${encodeURIComponent(sourceLeadId)}`}>View originating lead</Link>}</>
}

function EngagementEditor({ project, record }: { project: Project; record?: ProjectEngagement }) {
  const save = useStore((s) => s.saveEngagement)
  const hydrate = useStore((s) => s.hydrate)
  const [terms, setTerms] = useState<EngagementTerms>(() => structuredClone(record?.terms ?? emptyEngagementTerms()))
  const [version, setVersion] = useState(record?.version ?? 0)
  const [fee, setFee] = useState((terms.feeMinor / 100).toFixed(2))
  const [deposit, setDeposit] = useState((terms.depositMinor / 100).toFixed(2))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const [milestoneTitle, setMilestoneTitle] = useState('')
  const [milestoneDate, setMilestoneDate] = useState('')
  const [invoiceReference, setInvoiceReference] = useState('')
  const [invoiceAmount, setInvoiceAmount] = useState('')
  const [invoiceDate, setInvoiceDate] = useState('')
  const [paymentInvoice, setPaymentInvoice] = useState('')
  const [paymentReference, setPaymentReference] = useState('')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentDate, setPaymentDate] = useState('')
  const stale = version !== (record?.version ?? 0)
  const accepted = Boolean(record?.terms.acceptedOn)
  const deliveryLocked = record?.terms.phase === 'completed'
  const today = new Date().toISOString().slice(0, 10)
  const patch = (value: Partial<EngagementTerms>) => setTerms((t) => ({ ...t, ...value }))
  const totals = engagementTotals(terms)
  const displayMoney = (minor: number) => new Intl.NumberFormat('en', { style: 'currency', currency: terms.currency }).format(minor / 100)
  const gate = engagementGate(terms)

  const reload = () => {
    const next = structuredClone(record?.terms ?? emptyEngagementTerms())
    setTerms(next)
    setVersion(record?.version ?? 0)
    setFee((next.feeMinor / 100).toFixed(2))
    setDeposit((next.depositMinor / 100).toFixed(2))
    setError('')
  }
  const commit = async (phase = terms.phase) => {
    if (saving.current) return
    const feeMinor = parseMoney(fee), depositMinor = parseMoney(deposit)
    if (feeMinor === null || depositMinor === null) {
      setError('Enter amounts with no more than two decimal places.')
      return
    }
    saving.current = true
    setBusy(true)
    setError('')
    try {
      const result = await save(project.id, version, { ...terms, feeMinor, depositMinor, phase })
      if (!result.ok) {
        setError(result.error ?? 'Could not save engagement.')
        return
      }
      const saved = useStore.getState().projectEngagements.find((e) => e.projectId === project.id)!
      setTerms(structuredClone(saved.terms))
      setVersion(saved.version)
      toast.success('Engagement saved')
    } catch { setError('Could not save engagement. Retry after checking your connection.') }
    finally {
      saving.current = false
      setBusy(false)
    }
  }
  const addMilestone = (event: FormEvent) => {
    event.preventDefault()
    if (!milestoneTitle.trim() || !milestoneDate) return
    patch({ milestones: [...terms.milestones, { id: crypto.randomUUID(), title: milestoneTitle.trim(), dueDate: milestoneDate, status: 'planned', approvalEvidence: '' }] })
    setMilestoneTitle('')
    setMilestoneDate('')
  }
  const addInvoice = (event: FormEvent) => {
    event.preventDefault()
    const amount = parseMoney(invoiceAmount)
    if (amount === null || amount === 0) {
      setError('Enter a positive invoice amount with up to two decimals.')
      return
    }
    patch({ invoices: [...terms.invoices, { id: crypto.randomUUID(), reference: invoiceReference.trim(), amountMinor: amount, dueDate: invoiceDate }] })
    setInvoiceReference('')
    setInvoiceAmount('')
    setInvoiceDate('')
  }
  const addPayment = (event: FormEvent) => {
    event.preventDefault()
    const amount = parseMoney(paymentAmount)
    if (amount === null || amount === 0) {
      setError('Enter a positive receipt amount with up to two decimals.')
      return
    }
    patch({ payments: [...terms.payments, { id: crypto.randomUUID(), invoiceId: paymentInvoice, reference: paymentReference.trim(), amountMinor: amount, receivedOn: paymentDate }] })
    setPaymentReference('')
    setPaymentAmount('')
    setPaymentDate('')
  }

  return <section aria-labelledby="engagement-title" className="mt-10 space-y-6 border-t border-ink-600 pt-8">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="engagement-title" className="text-display text-xl font-semibold">Engagement</h2>
      <span className="badge badge-info capitalize">{terms.phase}</span></div>
    <p className="max-w-3xl text-sm text-ink-200">Keep the agreed scope, client approvals, invoices, and receipts together. Record evidence from your contract and payment tools. These records do not send invoices, collect money, or sign agreements.</p>
    {stale && <div role="alert" className="card space-y-2 p-4"><p className="text-sm">Another admin changed this engagement. Reload to replace your draft with the latest saved version.</p><button className="btn-secondary" type="button" onClick={reload} disabled={busy}>Reload saved engagement</button></div>}
    <fieldset disabled={busy || stale} className="min-w-0 space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Currency"><select className="input w-full" value={terms.currency} disabled={accepted} onChange={(e) => patch({ currency: e.target.value as EngagementTerms['currency'] })}>{ENGAGEMENT_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Agreed fee"><input className="input w-full" inputMode="decimal" value={fee} disabled={accepted} onChange={(e) => {
          setFee(e.target.value)
          const v = parseMoney(e.target.value)
          if (v !== null) patch({ feeMinor: v })
        }} /></Field>
        <Field label="Required deposit"><input className="input w-full" inputMode="decimal" value={deposit} disabled={accepted} onChange={(e) => {
          setDeposit(e.target.value)
          const v = parseMoney(e.target.value)
          if (v !== null) patch({ depositMinor: v })
        }} /></Field>
      </div>
      <Field label="Agreed scope and deliverables"><textarea rows={4} maxLength={12000} className="input w-full" value={terms.scope} disabled={accepted} onChange={(e) => patch({ scope: e.target.value })} /></Field>
      <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
        <Field label="Acceptance date"><input type="date" max={today} className="input w-full" value={terms.acceptedOn} disabled={accepted} onChange={(e) => patch({ acceptedOn: e.target.value })} /></Field>
        <Field label="Acceptance evidence (document reference or client confirmation)"><input maxLength={2000} className="input w-full" value={terms.acceptanceEvidence} disabled={accepted} onChange={(e) => patch({ acceptanceEvidence: e.target.value })} /></Field>
      </div>
      {accepted && <p className="text-xs text-ink-300">Accepted terms are locked. Scope amendments must be managed in your contract tool.</p>}
      <dl className="grid gap-4 border-y border-ink-600 py-4 sm:grid-cols-4">{[
        ['Invoiced', totals.invoiced], ['Collected', totals.collected], ['Outstanding', totals.outstanding], ['Not invoiced', totals.uninvoiced],
      ].map(([label, amount]) => <div key={label}><dt className="text-xs text-ink-300">{label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{displayMoney(amount as number)}</dd></div>)}</dl>
      <div className="space-y-3"><h3 className="section-title">Delivery milestones</h3>
        {terms.milestones.length === 0 && <p className="text-sm text-ink-300">Add the deliverables that require client approval.</p>}
        {terms.milestones.map((m) => <div key={m.id} className="card grid gap-3 p-4 sm:grid-cols-2">
          <div><p className="text-sm font-medium [overflow-wrap:anywhere]">{m.title}</p><p className="text-xs text-ink-300">Due {m.dueDate}</p></div>
          <Field label={`Status for ${m.title}`}><select disabled={deliveryLocked} className="input w-full" value={m.status} onChange={(e) => patch({ milestones: terms.milestones.map((item) => item.id === m.id ? { ...item, status: e.target.value as typeof m.status } : item) })}><option value="planned">Planned</option><option value="review">Client review</option><option value="approved">Approved</option></select></Field>
          <div className="sm:col-span-2"><Field label={`Approval evidence for ${m.title}`}><input disabled={deliveryLocked} maxLength={2000} className="input w-full" value={m.approvalEvidence} onChange={(e) => patch({ milestones: terms.milestones.map((item) => item.id === m.id ? { ...item, approvalEvidence: e.target.value } : item) })} /></Field></div>
        </div>)}
        {!deliveryLocked && <form onSubmit={addMilestone} className="grid items-end gap-3 sm:grid-cols-[1fr_12rem_auto]">
          <Field label="New milestone"><input required maxLength={200} className="input w-full" value={milestoneTitle} onChange={(e) => setMilestoneTitle(e.target.value)} /></Field>
          <Field label="Milestone due date"><input required type="date" className="input w-full" value={milestoneDate} onChange={(e) => setMilestoneDate(e.target.value)} /></Field>
          <button className="btn-secondary" type="submit">Add milestone</button>
        </form>}
      </div>
      <div className="space-y-3"><h3 className="section-title">Invoices</h3>
        {terms.invoices.length === 0 && <p className="text-sm text-ink-300">No invoices recorded.</p>}
        {terms.invoices.map((i) => {
          const paid = terms.payments.filter((p) => p.invoiceId === i.id).reduce((sum, p) => sum + p.amountMinor, 0)
          return <div className="flex flex-wrap justify-between gap-2 border-b border-ink-600 pb-3 text-sm" key={i.id}><span className="[overflow-wrap:anywhere]">{i.reference} · due {i.dueDate}</span><span className="tabular-nums">{displayMoney(i.amountMinor)} · {paid === i.amountMinor ? 'Paid' : i.dueDate < today ? 'Overdue' : 'Open'} · {displayMoney(i.amountMinor - paid)} outstanding</span></div>
        })}
        <form onSubmit={addInvoice} className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_10rem_12rem_auto]">
          <Field label="Invoice reference"><input required maxLength={200} className="input w-full" value={invoiceReference} onChange={(e) => setInvoiceReference(e.target.value)} /></Field>
          <Field label="Invoice amount"><input required inputMode="decimal" className="input w-full" value={invoiceAmount} onChange={(e) => setInvoiceAmount(e.target.value)} /></Field>
          <Field label="Invoice due date"><input required type="date" className="input w-full" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></Field>
          <button className="btn-secondary" type="submit">Add invoice</button>
        </form>
      </div>
      <div className="space-y-3"><h3 className="section-title">Payment receipts</h3>
        {terms.payments.length === 0 && <p className="text-sm text-ink-300">No payments recorded. Add only money confirmed as received.</p>}
        {terms.payments.map((p) => <div className="flex flex-wrap justify-between gap-2 border-b border-ink-600 pb-3 text-sm" key={p.id}><span className="[overflow-wrap:anywhere]">{p.reference} · {terms.invoices.find((i) => i.id === p.invoiceId)?.reference} · {p.receivedOn}</span><span className="tabular-nums">{displayMoney(p.amountMinor)}</span></div>)}
        {terms.invoices.length > 0 && <form onSubmit={addPayment} className="grid items-end gap-3 sm:grid-cols-2">
          <Field label="Receipt invoice"><select required className="input w-full" value={paymentInvoice} onChange={(e) => setPaymentInvoice(e.target.value)}><option value="">Choose invoice</option>{terms.invoices.map((i) => <option key={i.id} value={i.id}>{i.reference}</option>)}</select></Field>
          <Field label="Payment reference"><input required maxLength={200} className="input w-full" value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} /></Field>
          <Field label="Amount received"><input required inputMode="decimal" className="input w-full" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} /></Field>
          <Field label="Received on"><input required type="date" max={today} className="input w-full" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} /></Field>
          <button className="btn-secondary justify-self-start" type="submit">Add receipt</button>
        </form>}
      </div>
      <p className="text-xs text-ink-300">Added records remain in your draft until you save. Saved invoices and receipts are permanent; check their references and amounts before saving.</p>
      {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-400">{error} <button type="button" className="underline" onClick={() => void hydrate()}>Refresh saved data</button></p>}
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-primary" onClick={() => void commit()}>{busy ? 'Saving...' : 'Save engagement'}</button>
        {terms.phase === 'planning' && <button type="button" className="btn-secondary" onClick={() => void commit('active')}>Save and start delivery</button>}
        {terms.phase === 'active' && <button type="button" className="btn-secondary" onClick={() => void commit('completed')}>Save and complete delivery</button>}
        <button type="button" className="btn-ghost" onClick={reload}>Discard draft</button>
      </div>
      {terms.phase === 'planning' && <p className="text-xs text-ink-300">{gate ?? 'Scope accepted and deposit requirement met. Ready for kickoff.'}</p>}
    </fieldset>
  </section>
}
