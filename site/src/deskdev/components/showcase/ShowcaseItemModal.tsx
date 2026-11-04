import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ArrowSquareOutIcon, CheckCircleIcon, CircleDashedIcon, InfoIcon, LockIcon, PlusIcon, TrashIcon,
  UploadSimpleIcon, WarningIcon, XIcon,
} from '@phosphor-icons/react'
import Modal from '../Modal'
import ConfirmDialog from '../ConfirmDialog'
import { ClientSelect } from '../pickers'
import { IndicatorGroup, LayoutIndicator } from '../motion'
import {
  FieldError, focusFirstInvalid, FormField, INPUT_INVALID, Notice, Switch, useHeldWhile,
} from '../settings/formKit'
import { useStore, useCurrentUser } from '../../store/useStore'
import { can, isAdmin } from '../../lib/permissions'
import { classNames, fmtDate, fmtRelative } from '../../lib/format'
import { MAX_SHOWCASE_SUMMARY, publishChecklist } from '../../lib/showcase'
import type {
  ShowcaseConsent, ShowcaseImageSource, ShowcaseItem, ShowcaseKind, ShowcaseStatus,
} from '../../lib/types'
import {
  CONSENT_LABELS, IMAGE_SOURCE_LABELS, KIND_LABELS, ShowcaseStatusBadge, ShowcaseThumb, STATUS_LABELS,
} from './showcaseBits'
import {
  draftFromItem, isDirty, MAX_METRICS, patchFromDraft, validateDraft, type DraftErrors, type ShowcaseDraft,
} from './showcaseForm'

type Tab = 'details' | 'case'

const INPUT = classNames('input w-full', INPUT_INVALID)

/** A titled group of fields inside the editor: a hairline above, no box. */
function Group({ title, children, first }: { title: string; children: ReactNode; first?: boolean }) {
  return (
    <section className={classNames('space-y-4', !first && 'border-t border-ink-600 pt-5')}>
      <h3 className="section-title">{title}</h3>
      {children}
    </section>
  )
}

/** A switch with its label and hint on the left: one row of a ruled list. */
function SwitchRow({
  label, hint, on, onChange, disabled,
}: {
  label: string
  hint: string
  on: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="text-sm text-ink-50">{label}</div>
        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-300">{hint}</p>
      </div>
      <Switch on={on} onChange={onChange} label={label} disabled={disabled} />
    </div>
  )
}

/** Where an item can go from its status, for this person. */
function movesFor(status: ShowcaseStatus, admin: boolean): { to: ShowcaseStatus; label: string; primary?: boolean }[] {
  const publish = { to: 'published' as const, label: 'Publish', primary: true }
  const archive = { to: 'archived' as const, label: 'Archive' }
  switch (status) {
    case 'draft':
      return [
        ...(admin ? [publish] : []),
        { to: 'ready', label: 'Mark ready for review', primary: !admin },
        archive,
      ]
    case 'ready':
      return [...(admin ? [publish] : []), { to: 'draft', label: 'Back to draft' }, archive]
    case 'published':
      return admin ? [{ to: 'hidden', label: 'Unpublish' }] : []
    case 'hidden':
      return [...(admin ? [publish] : []), { to: 'draft', label: 'Back to draft' }, archive]
    case 'archived':
      return [{ to: 'draft', label: 'Restore to draft' }]
  }
}

const MOVED: Record<ShowcaseStatus, string> = {
  draft: 'Moved to draft',
  ready: 'Marked ready for review',
  published: 'Published',
  hidden: 'Unpublished',
  archived: 'Archived',
}

/**
 * The showcase editor. With an item: status and publish checklist, the
 * screenshot, the card's fields, consent, placement and the case study.
 * Without one: the few fields a draft needs, then it opens the new draft.
 * A centred dialog on desktop, a bottom sheet under 640px (Modal).
 */
export default function ShowcaseItemModal({
  open, itemId, onClose, onCreated,
}: {
  open: boolean
  /** The item to edit, or null to create one. */
  itemId: string | null
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const user = useCurrentUser()
  const liveItem = useStore((s) => (itemId ? s.showcaseItems.find((i) => i.id === itemId) : undefined))
  const autoPublish = useStore((s) => s.workspaceSettings.showcaseAutoPublish)
  const projects = useStore((s) => s.projects)
  const addShowcaseItem = useStore((s) => s.addShowcaseItem)
  const updateShowcaseItem = useStore((s) => s.updateShowcaseItem)
  const setShowcaseStatus = useStore((s) => s.setShowcaseStatus)
  const deleteShowcaseItem = useStore((s) => s.deleteShowcaseItem)
  const setShowcaseImage = useStore((s) => s.setShowcaseImage)

  // Through the exit the URL has already dropped the id: keep showing what was open.
  const item = useHeldWhile<ShowcaseItem | null>(liveItem ?? null, open)
  const creating = useHeldWhile(itemId === null, open)

  const admin = isAdmin(user)
  const canEdit = can(user, 'showcase', 'edit')
  // What is live on the site is an admin's to change (037's guard trigger).
  const liveLocked = Boolean(item) && item?.status === 'published' && !admin
  const readOnly = !canEdit || liveLocked

  const [draft, setDraft] = useState<ShowcaseDraft>(() => draftFromItem(null))
  const [errors, setErrors] = useState<DraftErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [tab, setTab] = useState<Tab>('details')
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmPublish, setConfirmPublish] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // One modal serves every item (and "new", then the draft it made): load the
  // form when what it is showing changes, not on every store echo.
  const key = open ? itemId ?? 'new' : null
  const [draftFor, setDraftFor] = useState<string | null>(null)
  if (key !== draftFor) {
    setDraftFor(key)
    if (key) {
      setDraft(draftFromItem(liveItem))
      setErrors({})
      setFormError(null)
      setStatusError(null)
      setUploadError(null)
      setTab('details')
    }
  }

  const set = <K extends keyof ShowcaseDraft>(field: K, value: ShowcaseDraft[K]) => {
    setDraft((d) => ({ ...d, [field]: value }))
    setFormError(null)
    setStatusError(null)
  }
  const clear = (field: keyof DraftErrors) => {
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }))
  }

  const dirty = creating
    ? Boolean(draft.title.trim() || draft.url.trim())
    : Boolean(item) && !readOnly && isDirty(draft, item)

  // One identity for the life of the editor. Modal re-runs its focus effect
  // when onClose changes, and this one depends on the form (dirty): rebuilt on
  // a keystroke, it pulled focus out of the field after every character.
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = () => {
      if (dirty) setConfirmDiscard(true)
      else onClose()
    }
  })
  const requestClose = useCallback(() => closeRef.current(), [])

  const create = () => {
    const all = validateDraft(draft)
    const found: DraftErrors = { title: all.title, url: all.url }
    setErrors(found)
    if (found.title || found.url) {
      focusFirstInvalid()
      return
    }
    const id = addShowcaseItem({
      title: draft.title.trim(),
      kind: draft.kind,
      url: draft.url.trim() || undefined,
      clientId: draft.clientId || undefined,
    })
    if (!id) {
      setFormError('The draft was not created. You need edit access to the Showcase.')
      return
    }
    toast.success('Draft created')
    onCreated(id)
  }

  const save = () => {
    if (!item) return
    const found = validateDraft(draft, item.status)
    setErrors(found)
    if (Object.values(found).some(Boolean)) {
      // Show the tab the first problem is on, then put focus on it.
      const onCase = !Object.entries(found).some(([k, v]) => v && k !== 'quote' && k !== 'metrics')
      setTab(onCase ? 'case' : 'details')
      focusFirstInvalid()
      return
    }
    if (!updateShowcaseItem(item.id, patchFromDraft(draft, item))) {
      setFormError(
        liveLocked
          ? 'Only an admin can edit an item that is live on the site.'
          : 'This change was not allowed. Check the link and your access, then try again.',
      )
      return
    }
    // Reload from what was stored (trimmed text, a de-duplicated slug), so the form is clean again.
    setDraft(draftFromItem(useStore.getState().showcaseItems.find((i) => i.id === item.id)))
    setFormError(null)
    toast.success('Showcase item saved')
  }

  const applyMove = (to: ShowcaseStatus) => {
    if (!item) return
    const res = setShowcaseStatus(item.id, to)
    if (!res.ok) {
      setStatusError(res.error ?? 'The status was not changed.')
      return
    }
    setStatusError(null)
    toast.success(MOVED[to])
  }

  const move = (to: ShowcaseStatus) => {
    if (!item) return
    // Publishing puts the card on the public site: always asked first, and the
    // dialog names what the checklist still misses. Without consent the store
    // refuses anyway, so that goes straight through to its inline error.
    if (to === 'published' && publishChecklist(item).find((c) => c.key === 'consent')?.ok) {
      setStatusError(null)
      setConfirmPublish(true)
      return
    }
    applyMove(to)
  }

  const upload = async (file: File) => {
    if (!item) return
    setUploadError(null)
    setUploading(true)
    const res = await setShowcaseImage(item.id, file, draft.imageAlt.trim() || undefined)
    setUploading(false)
    if (!res.ok) {
      setUploadError(res.error ?? 'Could not upload the image.')
      return
    }
    // The store filed it as an upload; keep the form in step so a later save does not undo that.
    setDraft((d) => ({ ...d, imageSource: 'upload' }))
    toast.success('Screenshot updated')
  }

  const remove = () => {
    if (!item) return
    if (!deleteShowcaseItem(item.id)) {
      setFormError(
        item.status === 'published'
          ? 'Only an admin can delete an item that is live on the site.'
          : 'The item was not deleted. You need edit access to the Showcase.',
      )
      return
    }
    toast.success('Showcase item deleted')
    onClose()
  }

  // ── Create ────────────────────────────────────────────────────────────
  if (creating) {
    return (
      <>
        <Modal
          open={open}
          onClose={requestClose}
          title="New showcase item"
          footer={
            <>
              <button type="button" className="btn-ghost" onClick={requestClose}>Cancel</button>
              <button type="submit" form="showcase-new" className="btn-primary">Create draft</button>
            </>
          }
        >
          <form
            id="showcase-new"
            className="space-y-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              create()
            }}
          >
            <FormField label="Title" error={errors.title}>
              {(c) => (
                <input
                  {...c}
                  className={INPUT}
                  value={draft.title}
                  maxLength={160}
                  autoFocus
                  onChange={(e) => { set('title', e.target.value); clear('title') }}
                />
              )}
            </FormField>
            <FormField label="Live link" hint="Optional for now. It must start with https://." error={errors.url}>
              {(c) => (
                <input
                  {...c}
                  type="url"
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="https://"
                  className={INPUT}
                  value={draft.url}
                  onChange={(e) => { set('url', e.target.value); clear('url') }}
                />
              )}
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Kind">
                {(c) => (
                  <select {...c} className={INPUT} value={draft.kind} onChange={(e) => set('kind', e.target.value as ShowcaseKind)}>
                    {(Object.keys(KIND_LABELS) as ShowcaseKind[]).map((k) => (
                      <option key={k} value={k}>{KIND_LABELS[k]}</option>
                    ))}
                  </select>
                )}
              </FormField>
              <FormField label="Client">
                <ClientSelect value={draft.clientId} onChange={(v) => set('clientId', v)} allowNone />
              </FormField>
            </div>
            <p className="text-xs leading-relaxed text-ink-300">
              A new item starts as a draft. It reaches the site only when an admin publishes it.
            </p>
            <FieldError error={formError} />
          </form>
        </Modal>
        <ConfirmDialog
          open={confirmDiscard}
          title="Discard this draft?"
          message="What you typed will be lost."
          confirmLabel="Discard"
          danger
          onConfirm={onClose}
          onClose={() => setConfirmDiscard(false)}
        />
      </>
    )
  }

  // ── Edit ──────────────────────────────────────────────────────────────
  if (!item) return null

  const checklist = publishChecklist({ ...item })
  const done = checklist.filter((c) => c.ok).length
  const moves = canEdit ? movesFor(item.status, admin) : []
  const project = item.projectId ? projects.find((p) => p.id === item.projectId) : undefined
  const summaryLength = draft.summary.trim().length
  const canDelete = canEdit && (item.status !== 'published' || admin)
  const waitingOnLinkCheck = item.status === 'ready' && item.consent === 'granted' && autoPublish
  const missing = checklist.filter((c) => !c.ok).map((c) => c.label.replace(/ \(.*\)$/, ''))

  const statusPanel = (
    <section aria-label="Status" className="rounded-lg border border-ink-600 bg-ink-850/40">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
        <ShowcaseStatusBadge status={item.status} />
        <span className="text-xs text-ink-300">
          {item.status === 'published' && item.publishedAt
            ? <>Live since <span className="tabular-nums">{fmtDate(item.publishedAt)}</span></>
            : item.status === 'ready'
              ? 'Waiting for an admin to publish it.'
              : item.status === 'hidden'
                ? 'Kept, but not on the site.'
                : item.status === 'archived'
                  ? 'Put away. Restore it to work on it again.'
                  : 'Not on the site yet.'}
        </span>
        <span className="ml-auto text-xs tabular-nums text-ink-300">
          {done}/{checklist.length} checks
        </span>
      </div>
      <ul className="grid gap-x-4 border-t border-ink-600 px-4 py-3 sm:grid-cols-2">
        {checklist.map((c) => (
          <li key={c.key} className="flex items-start gap-2 py-1 text-xs leading-relaxed">
            {c.ok ? (
              <CheckCircleIcon size={15} className="mt-px shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden />
            ) : (
              <CircleDashedIcon size={15} className="mt-px shrink-0 text-ink-400" aria-hidden />
            )}
            <span className={c.ok ? 'text-ink-100' : 'text-ink-300'}>
              {c.label}
              <span className="sr-only">{c.ok ? ' (done)' : ' (missing)'}</span>
            </span>
          </li>
        ))}
      </ul>
      {(moves.length > 0 || statusError) && (
        <div className="border-t border-ink-600 px-4 py-3">
          <div className="flex flex-wrap gap-2 [&>button]:whitespace-nowrap max-sm:[&>button]:min-h-11 max-sm:[&>button]:grow">
            {moves.map((m) => (
              <button
                key={m.to}
                type="button"
                className={m.primary ? 'btn-primary' : 'btn-secondary'}
                disabled={dirty}
                onClick={() => move(m.to)}
              >
                {m.label}
              </button>
            ))}
          </div>
          {dirty && moves.length > 0 && (
            <p className="mt-2 text-[11px] leading-relaxed text-ink-300">Save your changes before changing the status.</p>
          )}
          <FieldError error={statusError} className="mt-2" />
        </div>
      )}
    </section>
  )

  const details = (
    <div className="space-y-5">
      {!canEdit ? (
        <Notice tone="info" icon={LockIcon}>You can view the Showcase. Editing needs edit access.</Notice>
      ) : liveLocked ? (
        <Notice tone="info" icon={LockIcon}>This item is live on the site. Only an admin can edit or unpublish it.</Notice>
      ) : null}
      {item.linkStatus === 'down' && (
        <Notice tone="warn" icon={WarningIcon}>
          The link check failed, so this card is off the site until it passes. Its status is unchanged.
          {item.linkCheckedAt && <> Last checked {fmtRelative(item.linkCheckedAt)}.</>}
        </Notice>
      )}
      {waitingOnLinkCheck && (
        <Notice tone="info" icon={InfoIcon}>
          Consent is granted and auto-publish is on: this goes live once its link check passes. Until that check runs,
          an admin publishes it by hand.
        </Notice>
      )}
      {item.status === 'hidden' && item.consentNote && (
        <Notice tone="warn" icon={InfoIcon}>{item.consentNote}</Notice>
      )}

      {statusPanel}

      <fieldset disabled={readOnly} className="min-w-0 space-y-5 border-0 p-0">
        <Group title="Screenshot">
          <div className="grid gap-4 sm:grid-cols-[13rem_minmax(0,1fr)]">
            <div className="relative">
              <ShowcaseThumb item={item} large className="w-full rounded-lg" />
              {uploading && <span aria-hidden className="skeleton absolute inset-0 rounded-lg opacity-80" />}
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              {!readOnly && (
                <div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                    className="sr-only"
                    tabIndex={-1}
                    aria-hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (file) void upload(file)
                    }}
                  />
                  <button
                    type="button"
                    className="btn-secondary max-sm:min-h-11 max-sm:w-full"
                    disabled={uploading}
                    aria-busy={uploading || undefined}
                    onClick={() => fileRef.current?.click()}
                  >
                    <UploadSimpleIcon size={16} aria-hidden />
                    {uploading ? 'Uploading…' : item.imageKey ? 'Replace screenshot' : 'Upload screenshot'}
                  </button>
                  <p className="mt-2 text-[11px] leading-relaxed text-ink-300">
                    PNG, JPEG, WebP, GIF or AVIF. Resized to 1280 and 640 pixels wide, 5 MB at most.
                  </p>
                  <FieldError error={uploadError} className="mt-2" />
                </div>
              )}
              <FormField label="Alt text" hint="What the screenshot shows, for people who cannot see it.">
                {(c) => (
                  <input {...c} className={INPUT} value={draft.imageAlt} maxLength={300} onChange={(e) => set('imageAlt', e.target.value)} />
                )}
              </FormField>
            </div>
          </div>
          <FormField label="Picture on the site" hint="What the card shows when no screenshot is stored.">
            {(c) => (
              <select
                {...c}
                className={classNames(INPUT, 'sm:max-w-xs')}
                value={draft.imageSource}
                onChange={(e) => set('imageSource', e.target.value as ShowcaseImageSource | '')}
              >
                <option value="">Not set</option>
                {(Object.keys(IMAGE_SOURCE_LABELS) as ShowcaseImageSource[]).map((k) => (
                  <option key={k} value={k}>{IMAGE_SOURCE_LABELS[k]}</option>
                ))}
              </select>
            )}
          </FormField>
        </Group>

        <Group title="Card">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Title" error={errors.title}>
              {(c) => (
                <input {...c} className={INPUT} value={draft.title} maxLength={160} onChange={(e) => { set('title', e.target.value); clear('title') }} />
              )}
            </FormField>
            <FormField label="Slug" hint="The address under /portfolio. A taken slug gets a number added.">
              {(c) => (
                <input
                  {...c}
                  className={classNames(INPUT, 'font-mono')}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={draft.slug}
                  maxLength={80}
                  onChange={(e) => set('slug', e.target.value)}
                />
              )}
            </FormField>
            <FormField label="Live link" hint="Must start with https://." error={errors.url} className="sm:col-span-2">
              {(c) => (
                <div className="flex gap-2">
                  <input
                    {...c}
                    type="url"
                    inputMode="url"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="https://"
                    className={classNames(INPUT, 'min-w-0 flex-1')}
                    value={draft.url}
                    onChange={(e) => { set('url', e.target.value); clear('url') }}
                  />
                  {item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-secondary tap-target shrink-0 px-2.5"
                      aria-label="Open the live link in a new tab"
                      title="Open the live link"
                    >
                      <ArrowSquareOutIcon size={16} aria-hidden />
                    </a>
                  )}
                </div>
              )}
            </FormField>
            <FormField label="Kind">
              {(c) => (
                <select {...c} className={INPUT} value={draft.kind} onChange={(e) => set('kind', e.target.value as ShowcaseKind)}>
                  {(Object.keys(KIND_LABELS) as ShowcaseKind[]).map((k) => (
                    <option key={k} value={k}>{KIND_LABELS[k]}</option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField label="Industry">
              {(c) => <input {...c} className={INPUT} value={draft.industry} maxLength={80} onChange={(e) => set('industry', e.target.value)} />}
            </FormField>
            <FormField
              label="Summary"
              className="sm:col-span-2"
              error={errors.summary}
              hint={
                <span className={classNames('tabular-nums', summaryLength > MAX_SHOWCASE_SUMMARY && 'text-rose-700 dark:text-rose-400')}>
                  {summaryLength}/{MAX_SHOWCASE_SUMMARY}
                </span>
              }
            >
              {(c) => (
                <textarea
                  {...c}
                  rows={3}
                  className={classNames(INPUT, 'resize-y leading-relaxed')}
                  value={draft.summary}
                  onChange={(e) => { set('summary', e.target.value); clear('summary') }}
                />
              )}
            </FormField>
            <FormField label="Result tag" hint="A short outcome shown on the card.">
              {(c) => <input {...c} className={INPUT} value={draft.resultTag} maxLength={60} onChange={(e) => set('resultTag', e.target.value)} />}
            </FormField>
            <FormField label="Launched on">
              {(c) => <input {...c} type="date" className={classNames(INPUT, 'tabular-nums')} value={draft.launchedOn} onChange={(e) => set('launchedOn', e.target.value)} />}
            </FormField>
            <FormField label="Stack" hint="Separate with commas." className="sm:col-span-2">
              {(c) => <input {...c} className={INPUT} value={draft.stack} placeholder="Next.js, Supabase" onChange={(e) => set('stack', e.target.value)} />}
            </FormField>
          </div>
        </Group>

        <Group title="Consent">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Client consent"
              error={errors.consent}
              hint="Publishing needs Granted, Legacy portfolio or Our own product."
            >
              {(c) => (
                <select
                  {...c}
                  className={INPUT}
                  value={draft.consent}
                  onChange={(e) => { set('consent', e.target.value as ShowcaseConsent); clear('consent') }}
                >
                  {(Object.keys(CONSENT_LABELS) as ShowcaseConsent[]).map((k) => (
                    <option key={k} value={k}>{CONSENT_LABELS[k]}</option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField label="Client">
              <ClientSelect value={draft.clientId} onChange={(v) => set('clientId', v)} allowNone />
            </FormField>
            <FormField
              label="Consent note"
              className="sm:col-span-2"
              error={errors.consentNote}
              hint={item.consentAt ? <>Consent last recorded <span className="tabular-nums">{fmtDate(item.consentAt)}</span>.</> : 'Who agreed, how and to what.'}
            >
              {(c) => (
                <textarea
                  {...c}
                  rows={2}
                  className={classNames(INPUT, 'resize-y leading-relaxed')}
                  value={draft.consentNote}
                  onChange={(e) => { set('consentNote', e.target.value); clear('consentNote') }}
                />
              )}
            </FormField>
          </div>
        </Group>

        <Group title="Placement">
          <div className="divide-y divide-ink-600 border-y border-ink-600">
            <SwitchRow
              label="Show the live link"
              hint="Off: the card shows on the site without a link to the project."
              on={draft.linkPublic}
              onChange={(v) => set('linkPublic', v)}
              disabled={readOnly}
            />
            <SwitchRow
              label="Featured"
              hint="Listed first on the portfolio page."
              on={draft.featured}
              onChange={(v) => set('featured', v)}
              disabled={readOnly}
            />
            <SwitchRow
              label="On the home page"
              hint="Included in the home page selection."
              on={draft.homeFeatured}
              onChange={(v) => set('homeFeatured', v)}
              disabled={readOnly}
            />
          </div>
          <FormField label="Order" hint="Lower numbers come first, after featured items." error={errors.sortOrder} className="sm:max-w-40">
            {(c) => (
              <input
                {...c}
                inputMode="numeric"
                className={classNames(INPUT, 'tabular-nums')}
                value={draft.sortOrder}
                onChange={(e) => { set('sortOrder', e.target.value); clear('sortOrder') }}
              />
            )}
          </FormField>
        </Group>
      </fieldset>

      {project && (
        <p className="border-t border-ink-600 pt-4 text-xs text-ink-300">
          Drafted from the project{' '}
          <Link to={`/projects/${project.id}`} className="font-medium text-brand-700 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300">
            {project.title}
          </Link>
          .
        </p>
      )}
    </div>
  )

  const caseStudy = (
    <fieldset disabled={readOnly} className="min-w-0 space-y-5 border-0 p-0">
      <p className="text-xs leading-relaxed text-ink-300">
        The case study shows on the item&rsquo;s own page. Leave a part empty to leave it out.
      </p>
      <Group title="Story" first>
        {(['challenge', 'approach', 'outcome'] as const).map((field) => (
          <FormField key={field} label={field === 'challenge' ? 'Challenge' : field === 'approach' ? 'Approach' : 'Outcome'}>
            {(c) => (
              <textarea
                {...c}
                rows={3}
                className={classNames(INPUT, 'resize-y leading-relaxed')}
                value={draft[field]}
                onChange={(e) => set(field, e.target.value)}
              />
            )}
          </FormField>
        ))}
      </Group>

      <Group title={`Metrics (${draft.metrics.length}/${MAX_METRICS})`}>
        {draft.metrics.length === 0 ? (
          <p className="text-sm text-ink-300">No metrics yet.</p>
        ) : (
          <ul className="space-y-2">
            {draft.metrics.map((metric, i) => (
              <li key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
                <input
                  className={INPUT}
                  placeholder="Label"
                  aria-label={`Metric ${i + 1} label`}
                  aria-invalid={errors.metrics && !metric.label.trim() ? true : undefined}
                  value={metric.label}
                  onChange={(e) => {
                    set('metrics', draft.metrics.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                    clear('metrics')
                  }}
                />
                <input
                  className={classNames(INPUT, 'tabular-nums')}
                  placeholder="Value"
                  aria-label={`Metric ${i + 1} value`}
                  aria-invalid={errors.metrics && !metric.value.trim() ? true : undefined}
                  value={metric.value}
                  onChange={(e) => {
                    set('metrics', draft.metrics.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
                    clear('metrics')
                  }}
                />
                <button
                  type="button"
                  className="pressable tap-target rounded-md p-2 text-ink-300 hover:bg-ink-700 hover:text-ink-50 disabled:opacity-50"
                  aria-label={`Remove metric ${i + 1}`}
                  onClick={() => {
                    set('metrics', draft.metrics.filter((_, j) => j !== i))
                    clear('metrics')
                  }}
                >
                  <XIcon size={14} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <FieldError error={errors.metrics} />
        {!readOnly && (
          <button
            type="button"
            className="btn-secondary max-sm:min-h-11"
            disabled={draft.metrics.length >= MAX_METRICS}
            onClick={() => set('metrics', [...draft.metrics, { label: '', value: '' }])}
          >
            <PlusIcon size={16} aria-hidden />
            Add metric
          </button>
        )}
      </Group>

      <Group title="Quote">
        <FormField label="Quote" hint="Shown only with both the text and who said it." error={errors.quote}>
          {(c) => (
            <textarea
              {...c}
              rows={3}
              className={classNames(INPUT, 'resize-y leading-relaxed')}
              value={draft.quoteText}
              onChange={(e) => { set('quoteText', e.target.value); clear('quote') }}
            />
          )}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Who said it">
            {(c) => (
              <input
                {...c}
                className={INPUT}
                aria-invalid={errors.quote && !draft.quoteAuthor.trim() ? true : undefined}
                value={draft.quoteAuthor}
                onChange={(e) => { set('quoteAuthor', e.target.value); clear('quote') }}
              />
            )}
          </FormField>
          <FormField label="Their role">
            {(c) => <input {...c} className={INPUT} value={draft.quoteRole} onChange={(e) => set('quoteRole', e.target.value)} />}
          </FormField>
        </div>
      </Group>
    </fieldset>
  )

  return (
    <>
      <Modal
        open={open}
        onClose={requestClose}
        title={item.title}
        wide
        footer={
          <>
            {canDelete && (
              <button
                type="button"
                className="btn-ghost text-rose-700 hover:bg-rose-500/10 hover:text-rose-800 max-sm:flex-none! sm:mr-auto dark:text-rose-400 dark:hover:text-rose-300"
                onClick={() => setConfirmDelete(true)}
              >
                <TrashIcon size={16} aria-hidden />
                Delete
              </button>
            )}
            <button type="button" className="btn-ghost" onClick={requestClose}>{readOnly ? 'Close' : 'Cancel'}</button>
            {!readOnly && (
              <button type="button" className="btn-primary whitespace-nowrap" disabled={!dirty} onClick={save}>Save changes</button>
            )}
          </>
        }
      >
        <div className="space-y-5">
          <IndicatorGroup id="showcase-editor-tabs">
            <div role="tablist" aria-label="Item sections" className="flex gap-1 rounded-lg border border-ink-600 bg-ink-850/60 p-1 sm:inline-flex">
              {([['details', 'Details'], ['case', 'Case study']] as [Tab, string][]).map(([value, label]) => {
                const active = tab === value
                return (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={classNames(
                      'pressable relative rounded-md px-3 py-1.5 text-xs font-medium leading-tight pointer-coarse:min-h-11 max-sm:grow',
                      active ? 'text-ink-50' : 'text-ink-200 hover:text-ink-50',
                    )}
                    onClick={() => setTab(value)}
                  >
                    {active && (
                      <LayoutIndicator
                        layoutId="showcase-editor-tabs"
                        radius={6}
                        className="absolute inset-0 border border-ink-500 bg-ink-700 shadow-(--shadow-1)"
                      />
                    )}
                    <span className="relative">{label}</span>
                  </button>
                )
              })}
            </div>
          </IndicatorGroup>
          <div role="tabpanel" aria-label={tab === 'details' ? 'Details' : 'Case study'}>
            {tab === 'details' ? details : caseStudy}
          </div>
          <FieldError error={formError} />
          <span className="sr-only" aria-live="polite">{STATUS_LABELS[item.status]}</span>
        </div>
      </Modal>
      <ConfirmDialog
        open={confirmDiscard}
        title="Discard your changes?"
        message="The edits you have not saved will be lost."
        confirmLabel="Discard"
        danger
        onConfirm={onClose}
        onClose={() => setConfirmDiscard(false)}
      />
      <ConfirmDialog
        open={confirmPublish}
        title={missing.length > 0 ? 'Publish with checks missing?' : 'Publish this item?'}
        message={
          missing.length > 0
            ? `"${item.title}" goes live on the public site. Still missing: ${missing.join(', ')}.`
            : `"${item.title}" goes live on the public site.`
        }
        confirmLabel={missing.length > 0 ? 'Publish anyway' : 'Publish'}
        onConfirm={() => applyMove('published')}
        onClose={() => setConfirmPublish(false)}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this showcase item?"
        message={
          item.status === 'published'
            ? `"${item.title}" comes off the site and its screenshot is removed. This cannot be undone.`
            : `"${item.title}" and its screenshot are removed. This cannot be undone.`
        }
        confirmLabel="Delete"
        danger
        onConfirm={remove}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  )
}

