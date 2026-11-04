import { useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  ArrowSquareOutIcon, CheckCircleIcon, CircleIcon, CircleNotchIcon, EyeSlashIcon, ImageIcon, PlusIcon,
  RocketLaunchIcon, TrashIcon, UploadSimpleIcon, XIcon,
} from '@phosphor-icons/react'
import Modal from '../Modal'
import ConfirmDialog from '../ConfirmDialog'
import { Field } from '../tasks/formBits'
import { useCurrentUser, useStore, type ShowcasePatch } from '../../store/useStore'
import { can, isAdmin } from '../../lib/permissions'
import { classNames, fmtDate } from '../../lib/format'
import {
  MAX_SHOWCASE_SUMMARY, consentAllowsPublishing, isHttpsUrl, publishChecklist, showcaseStatusError,
} from '../../lib/showcase'
import { SHOWCASE_MAX_BYTES, showcaseImageUrl } from '../../lib/showcaseImages'
import { SITE_ORIGIN } from '../../../lib/hosts'
import type { ShowcaseCaseStudy, ShowcaseConsent, ShowcaseItem, ShowcaseKind, ShowcaseStatus } from '../../lib/types'
import { CONSENT_LABEL, KIND_LABEL, STATUS_LABEL, StatusBadge } from './showcaseBits'

// One portfolio entry, as the developer fills it in once a project is done and
// as an admin publishes it. Everything public lives here: the card on
// nixgensolutions.com/portfolio and the case study at /portfolio/<slug>
// (site/src/lib/showcase.ts reads published rows). The rules are 037's:
// drafting and "ready for review" need showcase:edit; publishing and
// unpublishing are admin-only and need the client's consent.

const SITE = SITE_ORIGIN ?? 'https://nixgensolutions.com'
const MAX_METRICS = 4

/** The fields this form edits, as text where the input is text. */
interface Form {
  title: string
  kind: ShowcaseKind
  url: string
  linkPublic: boolean
  industry: string
  summary: string
  resultTag: string
  stack: string
  launchedOn: string
  imageAlt: string
  featured: boolean
  homeFeatured: boolean
  sortOrder: string
  consent: ShowcaseConsent
  consentNote: string
  challenge: string
  approach: string
  outcome: string
  metrics: { label: string; value: string }[]
  quote: string
  author: string
  role: string
}

function formOf(item: ShowcaseItem): Form {
  const cs = item.caseStudy ?? {}
  return {
    title: item.title,
    kind: item.kind,
    url: item.url ?? '',
    linkPublic: item.linkPublic,
    industry: item.industry ?? '',
    summary: item.summary ?? '',
    resultTag: item.resultTag ?? '',
    stack: item.stack.join(', '),
    launchedOn: item.launchedOn ?? '',
    imageAlt: item.imageAlt ?? '',
    featured: item.featured,
    homeFeatured: item.homeFeatured,
    sortOrder: String(item.sortOrder),
    consent: item.consent,
    consentNote: item.consentNote ?? '',
    challenge: cs.challenge ?? '',
    approach: cs.approach ?? '',
    outcome: cs.outcome ?? '',
    metrics: (cs.metrics ?? []).map((m) => ({ label: m.label, value: m.value })),
    quote: cs.quote?.text ?? '',
    author: cs.quote?.author ?? '',
    role: cs.quote?.role ?? '',
  }
}

const opt = (v: string) => v.trim() || undefined

/** The patch for updateShowcaseItem; an empty case study is stored as none. */
function patchOf(f: Form): ShowcasePatch {
  const metrics = f.metrics
    .map((m) => ({ label: m.label.trim(), value: m.value.trim() }))
    .filter((m) => m.label && m.value)
  // The site shows a quote only with both the text and who said it.
  const quote = f.quote.trim()
    ? { text: f.quote.trim(), author: f.author.trim(), role: opt(f.role) }
    : undefined
  const caseStudy: ShowcaseCaseStudy = {
    challenge: opt(f.challenge),
    approach: opt(f.approach),
    outcome: opt(f.outcome),
    ...(metrics.length ? { metrics } : {}),
    ...(quote ? { quote } : {}),
  }
  const hasCaseStudy = Object.values(caseStudy).some((v) => v !== undefined)
  const sort = Number(f.sortOrder)
  return {
    title: f.title.trim(),
    kind: f.kind,
    url: opt(f.url),
    linkPublic: f.linkPublic,
    industry: opt(f.industry),
    summary: opt(f.summary),
    resultTag: opt(f.resultTag),
    stack: [...new Set(f.stack.split(',').map((s) => s.trim()).filter(Boolean))].slice(0, 12),
    launchedOn: opt(f.launchedOn),
    imageAlt: opt(f.imageAlt),
    featured: f.featured,
    homeFeatured: f.homeFeatured,
    sortOrder: Number.isFinite(sort) ? Math.round(sort) : 0,
    consent: f.consent,
    consentNote: opt(f.consentNote),
    caseStudy: hasCaseStudy ? caseStudy : undefined,
  }
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="section-title">{title}</h3>
        {hint && <p className="mt-0.5 text-[11px] leading-snug text-ink-400">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink-100 pointer-coarse:min-h-11">
      <input type="checkbox" className="size-4 accent-brand-600" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

export default function ShowcaseEditor({ item, onClose }: { item: ShowcaseItem; onClose: () => void }) {
  const user = useCurrentUser()
  const canEdit = can(user, 'showcase', 'edit')
  const admin = isAdmin(user)
  const updateShowcaseItem = useStore((s) => s.updateShowcaseItem)
  const setShowcaseStatus = useStore((s) => s.setShowcaseStatus)
  const setShowcaseImage = useStore((s) => s.setShowcaseImage)
  const deleteShowcaseItem = useStore((s) => s.deleteShowcaseItem)
  const project = useStore((s) => (item.projectId ? s.projects.find((p) => p.id === item.projectId) : undefined))
  const client = useStore((s) => (item.clientId ? s.clients.find((c) => c.id === item.clientId) : undefined))

  const [form, setForm] = useState<Form>(() => formOf(item))
  const [saved, setSaved] = useState<Form>(() => formOf(item))
  const [uploading, setUploading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }))
  const dirty = JSON.stringify(form) !== JSON.stringify(saved)
  const urlError = form.url.trim() && !isHttpsUrl(form.url.trim()) ? 'Use the full https:// address' : null
  const titleError = form.title.trim() ? null : 'A title is required'
  const summaryLength = form.summary.trim().length
  const disabled = !canEdit

  // The checklist judges what the form shows now, plus what only the server knows.
  const preview = { ...item, ...patchOf(form) }
  const checklist = publishChecklist(preview)
  const done = checklist.filter((c) => c.ok).length
  const clientConsent = client?.showcaseConsent ?? 'unknown'
  const imageUrl = showcaseImageUrl(item.imageKeySmall ?? item.imageKey)

  /** Saves the form; false (with a toast) when it can't. */
  const save = (): boolean => {
    if (titleError || urlError) {
      toast.error(titleError ?? urlError ?? 'Check the form')
      return false
    }
    if (!dirty) return true
    if (!updateShowcaseItem(item.id, patchOf(form))) {
      toast.error('Could not save this entry')
      return false
    }
    setSaved(form)
    return true
  }

  const move = (to: ShowcaseStatus, success: string) => {
    if (!save()) return
    // The store re-checks the same rules (and the database a third time).
    const reason = showcaseStatusError(user, { status: item.status, consent: form.consent }, to)
    if (reason) {
      toast.error(reason)
      return
    }
    const result = setShowcaseStatus(item.id, to)
    if (result.ok) toast.success(success)
    else toast.error(result.error ?? 'Could not change the status')
  }

  const upload = async (file: File | undefined) => {
    if (!file) return
    if (file.size > SHOWCASE_MAX_BYTES) {
      toast.error('That image is over 5 MB')
      return
    }
    setUploading(true)
    const result = await setShowcaseImage(item.id, file, form.imageAlt.trim() || undefined)
    setUploading(false)
    if (result.ok) toast.success('Screenshot uploaded')
    else toast.error(result.error ?? 'Upload failed')
  }

  const canPublish = admin && consentAllowsPublishing(form.consent)

  return (
    <>
      <Modal
        open
        wide
        onClose={() => {
          if (dirty && canEdit && !save()) return
          onClose()
        }}
        title={item.title || 'Portfolio entry'}
        footer={
          canEdit ? (
            <>
              {(item.status !== 'published' || admin) && (
                <button type="button" className="btn-ghost mr-auto text-rose-600 dark:text-rose-400" onClick={() => setConfirmDelete(true)}>
                  <TrashIcon size={14} aria-hidden /> Delete
                </button>
              )}
              {item.status === 'draft' && (
                <button type="button" className="btn-secondary" onClick={() => move('ready', 'Sent for review')}>
                  <CheckCircleIcon size={14} aria-hidden /> Ready for review
                </button>
              )}
              {admin && item.status === 'published' && (
                <button type="button" className="btn-secondary" onClick={() => move('hidden', 'Taken off the site')}>
                  <EyeSlashIcon size={14} aria-hidden /> Unpublish
                </button>
              )}
              {admin && item.status !== 'published' && (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!canPublish}
                  title={canPublish ? undefined : 'Needs the client’s consent first'}
                  onClick={() => move('published', 'Published to nixgensolutions.com')}
                >
                  <RocketLaunchIcon size={14} aria-hidden /> Publish
                </button>
              )}
              <button type="button" className={item.status === 'published' || !admin ? 'btn-primary' : 'btn-secondary'} disabled={!dirty} onClick={() => save() && toast.success('Saved')}>
                Save
              </button>
            </>
          ) : undefined
        }
      >
        <div className="space-y-6">
          {/* Where it stands */}
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={item.status} />
            <span className={classNames('badge', consentAllowsPublishing(form.consent) ? 'badge-success' : 'badge-warn')}>
              Consent: {CONSENT_LABEL[form.consent]}
            </span>
            <span className="badge badge-neutral">{done}/{checklist.length} ready</span>
            {item.status === 'published' && (
              <a
                href={`${SITE}/portfolio/${item.slug}`}
                target="_blank"
                rel="noreferrer"
                className="badge badge-info hover:underline"
              >
                <ArrowSquareOutIcon size={11} aria-hidden /> View on site
              </a>
            )}
            {project && <span className="text-[11px] text-ink-400">From project “{project.title}”{client ? ` · ${client.name}` : ''}</span>}
          </div>

          <Group title="Publish checklist" hint="Only consent is enforced; the rest keeps the public page from looking unfinished.">
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {checklist.map((c) => (
                <li key={c.key} className="flex items-center gap-2 text-[13px] text-ink-100">
                  {c.ok ? (
                    <CheckCircleIcon size={15} weight="fill" className="shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                  ) : (
                    <CircleIcon size={15} className="shrink-0 text-ink-400" aria-hidden />
                  )}
                  <span className={c.ok ? undefined : 'text-ink-300'}>{c.label}</span>
                  <span className="sr-only">{c.ok ? '(done)' : '(missing)'}</span>
                </li>
              ))}
            </ul>
          </Group>

          <Group title="The project">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Title *" error={titleError}>
                <input className="input w-full" value={form.title} disabled={disabled} onChange={(e) => set('title', e.target.value)} />
              </Field>
              <Field label="Kind">
                <select className="input w-full" value={form.kind} disabled={disabled} onChange={(e) => set('kind', e.target.value as ShowcaseKind)}>
                  {(Object.keys(KIND_LABEL) as ShowcaseKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </select>
              </Field>
              <Field label="Live URL" error={urlError}>
                <input type="url" inputMode="url" autoCapitalize="none" spellCheck={false} className="input w-full" placeholder="https://" value={form.url} disabled={disabled} onChange={(e) => set('url', e.target.value)} />
              </Field>
              <Field label="Industry">
                <input className="input w-full" placeholder="e.g. Dental clinic" value={form.industry} disabled={disabled} onChange={(e) => set('industry', e.target.value)} />
              </Field>
              <Field label="Launched on">
                <input type="date" className="input w-full" value={form.launchedOn} disabled={disabled} onChange={(e) => set('launchedOn', e.target.value)} />
              </Field>
              <Field label="Result tag" hint={<p className="text-[11px] text-ink-400">One short line on the card, e.g. “+42% bookings”.</p>}>
                <input className="input w-full" maxLength={60} value={form.resultTag} disabled={disabled} onChange={(e) => set('resultTag', e.target.value)} />
              </Field>
            </div>
            <Toggle checked={form.linkPublic} onChange={(v) => set('linkPublic', v)} disabled={disabled} label="Show the live link publicly (off: card only)" />
            <Field
              label="Summary"
              hint={
                <p className={classNames('text-[11px] tabular-nums', summaryLength > MAX_SHOWCASE_SUMMARY ? 'text-rose-600 dark:text-rose-400' : 'text-ink-400')}>
                  {summaryLength}/{MAX_SHOWCASE_SUMMARY} — what was built and for whom, in two or three sentences.
                </p>
              }
            >
              <textarea className="input w-full min-h-[84px] resize-y" value={form.summary} disabled={disabled} onChange={(e) => set('summary', e.target.value)} />
            </Field>
            <Field label="Stack" hint={<p className="text-[11px] text-ink-400">Comma separated, e.g. Next.js, Supabase, n8n.</p>}>
              <input className="input w-full" value={form.stack} disabled={disabled} onChange={(e) => set('stack', e.target.value)} />
            </Field>
          </Group>

          <Group title="Screenshot" hint="PNG, JPEG or WebP up to 5 MB. It's resized to 1280 px and 640 px WebP for the site.">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="aspect-[16/10] w-full shrink-0 overflow-hidden rounded-lg border border-ink-600 bg-ink-850 sm:w-56">
                {imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- client-only SPA; a Supabase Storage URL already sized to 640px
                  <img src={imageUrl} alt={form.imageAlt || ''} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-ink-400">
                    <ImageIcon size={28} aria-hidden />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                <Field label="Alt text" hint={<p className="text-[11px] text-ink-400">What the screenshot shows, for screen readers and search.</p>}>
                  <input className="input w-full" value={form.imageAlt} disabled={disabled} onChange={(e) => set('imageAlt', e.target.value)} />
                </Field>
                {canEdit && (
                  <>
                    <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = '' }} />
                    <button type="button" className="btn-secondary" disabled={uploading} onClick={() => fileRef.current?.click()}>
                      {uploading ? <CircleNotchIcon size={14} className="animate-spin" aria-hidden /> : <UploadSimpleIcon size={14} aria-hidden />}
                      {uploading ? 'Uploading…' : imageUrl ? 'Replace screenshot' : 'Upload screenshot'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </Group>

          <Group title="Case study" hint="Optional. Filled in, it becomes the page at /portfolio/<slug>; featured entries should have one.">
            <Field label="The challenge">
              <textarea className="input w-full min-h-[70px] resize-y" value={form.challenge} disabled={disabled} onChange={(e) => set('challenge', e.target.value)} />
            </Field>
            <Field label="What we built">
              <textarea className="input w-full min-h-[70px] resize-y" value={form.approach} disabled={disabled} onChange={(e) => set('approach', e.target.value)} />
            </Field>
            <Field label="The outcome">
              <textarea className="input w-full min-h-[70px] resize-y" value={form.outcome} disabled={disabled} onChange={(e) => set('outcome', e.target.value)} />
            </Field>
            <div className="space-y-2">
              <span className="text-xs font-medium text-ink-200">Results in numbers</span>
              {form.metrics.map((m, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input className="input w-28 shrink-0 tabular-nums" placeholder="+42%" aria-label={`Result ${i + 1} value`} value={m.value} disabled={disabled}
                    onChange={(e) => set('metrics', form.metrics.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                  <input className="input min-w-0 flex-1" placeholder="online bookings" aria-label={`Result ${i + 1} label`} value={m.label} disabled={disabled}
                    onChange={(e) => set('metrics', form.metrics.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                  {canEdit && (
                    <button type="button" className="tap-target rounded-sm p-1 text-ink-400 hover:text-rose-500" aria-label={`Remove result ${i + 1}`} onClick={() => set('metrics', form.metrics.filter((_, j) => j !== i))}>
                      <XIcon size={14} aria-hidden />
                    </button>
                  )}
                </div>
              ))}
              {canEdit && form.metrics.length < MAX_METRICS && (
                <button type="button" className="btn-ghost px-2! py-1! text-xs" onClick={() => set('metrics', [...form.metrics, { label: '', value: '' }])}>
                  <PlusIcon size={13} aria-hidden /> Add a result
                </button>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
              <Field label="Client quote">
                <input className="input w-full" value={form.quote} disabled={disabled} onChange={(e) => set('quote', e.target.value)} />
              </Field>
              <Field label="Who said it">
                <input className="input w-full" value={form.author} disabled={disabled} onChange={(e) => set('author', e.target.value)} />
              </Field>
              <Field label="Their role">
                <input className="input w-full" value={form.role} disabled={disabled} onChange={(e) => set('role', e.target.value)} />
              </Field>
            </div>
          </Group>

          <Group title="Placement">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <Toggle checked={form.featured} onChange={(v) => set('featured', v)} disabled={disabled} label="Featured on /portfolio" />
              <Toggle checked={form.homeFeatured} onChange={(v) => set('homeFeatured', v)} disabled={disabled} label="On the home page" />
              <label className="flex items-center gap-2 text-sm text-ink-100">
                Order
                <input type="number" className="input w-20 tabular-nums" value={form.sortOrder} disabled={disabled} onChange={(e) => set('sortOrder', e.target.value)} />
              </label>
            </div>
          </Group>

          <Group title="Client consent" hint="Nothing goes on the public site without it (the database refuses).">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Consent">
                <select className="input w-full" value={form.consent} disabled={disabled} onChange={(e) => set('consent', e.target.value as ShowcaseConsent)}>
                  {(Object.keys(CONSENT_LABEL) as ShowcaseConsent[]).map((c) => <option key={c} value={c}>{CONSENT_LABEL[c]}</option>)}
                </select>
              </Field>
              <Field label="Note" hint={<p className="text-[11px] text-ink-400">How and when they agreed, e.g. “Onboarding form, 6 Oct”.</p>}>
                <input className="input w-full" value={form.consentNote} disabled={disabled} onChange={(e) => set('consentNote', e.target.value)} />
              </Field>
            </div>
            {client && clientConsent !== 'unknown' && clientConsent !== form.consent && canEdit && (
              <p className="text-[13px] text-ink-200">
                {client.name}’s client record says <strong className="text-ink-50">{CONSENT_LABEL[clientConsent]}</strong>.{' '}
                <button type="button" className="font-medium text-brand-600 dark:text-brand-400 hover:underline" onClick={() => set('consent', clientConsent)}>
                  Use that
                </button>
              </p>
            )}
          </Group>

          <p className="text-[11px] text-ink-400">
            Public address: <span className="font-mono">{SITE.replace(/^https?:\/\//, '')}/portfolio/{item.slug}</span>
            {item.publishedAt && <> · published {fmtDate(item.publishedAt)}</>}
            {' · '}{STATUS_LABEL[item.status]}
          </p>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete portfolio entry"
        message={`Delete “${item.title}”${item.status === 'published' ? ' and take it off the website' : ''}? Its screenshots are deleted too.`}
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (deleteShowcaseItem(item.id)) {
            toast.success('Entry deleted')
            onClose()
          } else {
            toast.error('Could not delete this entry')
          }
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  )
}
