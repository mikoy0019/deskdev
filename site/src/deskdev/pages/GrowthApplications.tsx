import { useRef, useState } from 'react'
import { toast } from 'sonner'
import Layout from '../components/Layout'
import { useCurrentUser, useStore } from '../store/useStore'
import { can } from '../lib/permissions'
import { oljLinks, prepareApplication } from '../lib/applications'
import { webHref } from '../lib/links'
import type { JobPosting } from '../lib/types'

function ApplicationEditor({ job, canEdit }: { job: JobPosting; canEdit: boolean }) {
  const save = useStore((s) => s.saveJobApplication)
  const [posting, setPosting] = useState(job.description ?? '')
  const [cv, setCv] = useState(job.application?.cv ?? '')
  const [draft, setDraft] = useState(job.application?.draft ?? '')
  const [analysis, setAnalysis] = useState(job.application?.analysis ?? '')
  const [status, setStatus] = useState<NonNullable<JobPosting['application']>['status']>(job.application?.status ?? 'queued')
  const [question, setQuestion] = useState('')
  const [conversation, setConversation] = useState<{ question: string; answer: string }[]>([])
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const ask = (text: string) => {
    if (!posting.trim() || !cv.trim()) { toast.error('Paste the job description and your source CV first'); return }
    const result = prepareApplication(posting, cv)
    const answer = /cv|draft|prepare|tailor/i.test(text) ? result.draft : /missing|gap/i.test(text) ? `Not evidenced in your source CV: ${result.gaps.join(', ') || 'None of the recognized topics'}. Review the full listing as well.` : result.analysis
    setAnalysis(result.analysis)
    if (/cv|draft|prepare|tailor/i.test(text)) setDraft(result.draft)
    setConversation((previous) => [...previous, { question: text, answer }]); setQuestion('')
  }
  return <section className="card p-4 space-y-4" aria-label={`Prepare application: ${job.title}`}>
    <div className="flex flex-wrap items-center gap-3"><h2 className="flex-1 font-semibold">{job.title}</h2>{webHref(job.url) && <a className="btn-secondary" href={job.url} target="_blank" rel="noopener noreferrer">Open posting</a>}</div>
    <p className="text-xs text-ink-300">Paste the listing and a factual CV. The local assistant highlights matching evidence and prepares an editable draft; review it before applying. Saved drafts are shared with teammates who have Growth access.</p>
    <div className="grid gap-4 lg:grid-cols-2">
      <label className="text-sm">Job description<textarea aria-label="Job description" className="input mt-1 min-h-48 w-full" value={posting} maxLength={40000} readOnly={!canEdit || busy} onChange={(e) => setPosting(e.target.value)} /></label>
      <label className="text-sm">Source CV<textarea aria-label="Source CV" className="input mt-1 min-h-48 w-full" value={cv} maxLength={40000} readOnly={!canEdit || busy} onChange={(e) => setCv(e.target.value)} placeholder="Your real experience, skills and qualifications" /></label>
    </div>
    {canEdit && <div className="space-y-3">
      <h3 className="section-title">Application assistant</h3>
      <p className="text-xs text-ink-300">Analyzes the text you supply. It does not retrieve listings or submit applications.</p>
      <div className="flex flex-wrap gap-2">{['Analyze fit', 'What evidence is missing?', 'Prepare CV draft'].map((text) => <button key={text} type="button" className="btn-secondary" disabled={busy} onClick={() => ask(text)}>{text}</button>)}</div>
      {conversation.map((turn, i) => <div key={i} className="border-l-2 border-brand-500 pl-3 text-sm"><p className="font-medium">{turn.question}</p><p className="mt-1 whitespace-pre-wrap text-ink-200">{turn.answer}</p></div>)}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (question.trim()) ask(question) }}><input aria-label="Ask the application assistant" className="input min-w-0 flex-1" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about fit, missing evidence or preparing the CV" disabled={busy} /><button className="btn-secondary" disabled={busy || !question.trim()}>Ask</button></form>
    </div>}
    {analysis && <p className="whitespace-pre-wrap text-sm text-ink-200">{analysis}</p>}
    <label className="block text-sm">CV draft<textarea aria-label="CV draft" className="input mt-1 min-h-64 w-full" value={draft} maxLength={100000} readOnly={!canEdit || busy} onChange={(e) => setDraft(e.target.value)} /></label>
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn-secondary" disabled={!draft} onClick={() => {
        const url = URL.createObjectURL(new Blob([draft], { type: 'text/plain;charset=utf-8' }))
        const a = document.createElement('a'); a.href = url; a.download = 'application-cv.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
      }}>Download CV draft</button>
      {canEdit && <>
        <label className="text-sm">Status <select aria-label="Application status" className="input" value={status} disabled={busy} onChange={(e) => setStatus(e.target.value as typeof status)}>{['queued', 'reviewing', 'ready', 'applied'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <button type="button" className="btn-primary ml-auto" disabled={busy} onClick={async () => {
          if (busyRef.current) return
          busyRef.current = true; setBusy(true)
          try {
            if (await save(job.id, { description: posting, application: { cv, draft, analysis, status } })) toast.success('Application saved')
            else toast.error('Application could not be saved. Your draft is still here.')
          } finally { busyRef.current = false; setBusy(false) }
        }}>{busy ? 'Saving…' : 'Save application'}</button>
      </>}
    </div>
  </section>
}

export default function GrowthApplications() {
  const user = useCurrentUser()
  const canEdit = can(user, 'growth', 'edit')
  const jobs = useStore((s) => s.jobPostings)
  const importLinks = useStore((s) => s.importOljLinks)
  const hydrated = useStore((s) => s.hydrated)
  const [links, setLinks] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const importRef = useRef(false)
  const applications = jobs.filter((job) => job.source === 'onlinejobs.ph' && !job.dismissed)
  const job = applications.find((item) => item.id === selected)
  return <Layout title="OLJ Applications" subtitle="Collect postings, review fit and prepare factual CV drafts">
    <div className="mx-auto max-w-6xl space-y-5">
      {canEdit && <section className="card p-4 space-y-3"><label className="block text-sm font-medium">Paste OnlineJobs.ph posting links<textarea className="input mt-2 min-h-28 w-full font-mono text-xs" value={links} readOnly={importing} onChange={(e) => setLinks(e.target.value)} placeholder="One job posting link per line (up to 50)" /></label>
        <button type="button" className="btn-primary" disabled={importing || !links.trim() || !hydrated} onClick={async () => {
          if (importRef.current) return
          const parsed = oljLinks(links)
          if (parsed.invalid.length || !parsed.urls.length || parsed.urls.length > 50) { toast.error('Use up to 50 valid HTTPS OnlineJobs.ph job posting links.'); return }
          importRef.current = true; setImporting(true)
          try {
            const result = await importLinks(parsed.urls)
            if (result.failed) toast.error(`${result.added} added, ${result.skipped} already queued, ${result.failed} could not be saved. Retry the links to save the remainder.`)
            else { toast.success(`${result.added} added, ${result.skipped} already queued`); setLinks('') }
          } finally { importRef.current = false; setImporting(false) }
        }}>{importing ? 'Adding…' : 'Add posting links'}</button>
      </section>}
      <div className="grid items-start gap-4 lg:grid-cols-[260px_1fr]">
        <nav className="card p-2 space-y-1" aria-label="Application queue">{!hydrated ? <p className="p-3 text-sm">Loading applications…</p> : applications.length === 0 ? <p className="p-3 text-sm text-ink-300">No applications queued yet.</p> : applications.map((item) => <button key={item.id} type="button" className="btn-ghost block w-full text-left" aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}><span className="block truncate">{item.title}</span><span className="text-xs text-ink-300">{item.application?.status ?? 'queued'}</span></button>)}</nav>
        {job ? <ApplicationEditor key={job.id} job={job} canEdit={canEdit} /> : <p className="p-6 text-sm text-ink-300">Choose a posting to prepare an application.</p>}
      </div>
    </div>
  </Layout>
}
