import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  CalendarCheckIcon, CalendarPlusIcon, CaretDownIcon, ChatCircleIcon, ClipboardTextIcon, EnvelopeSimpleIcon,
  EraserIcon, FileTextIcon, FireIcon, PaperPlaneTiltIcon, PhoneCallIcon, ProhibitIcon, TrashIcon, UserPlusIcon,
  UsersIcon, VideoCameraIcon, XIcon, type Icon,
} from '@phosphor-icons/react'
import ConfirmDialog from '../ConfirmDialog'
import Popover, { MenuItem } from '../crm/Popover'
import { DateField } from '../pickers'
import { OverlayRoot, Presence, Scrim, SheetHandle, SheetPanel, Skeleton } from '../motion'
import {
  CopyGlyph, FieldError, FormField, INPUT_INVALID, Notice, useCopied, useHeldWhile,
} from '../settings/formKit'
import FormModal from '../forms/FormModal'
import ShareFormDialog from '../forms/ShareFormDialog'
import EmailThreads from '../email/EmailThreads'
import { useStore, useCurrentUser, type LeadTouchAction } from '../../store/useStore'
import { useMediaQuery } from '../../pwa/useMediaQuery'
import { activeUsers, can, isAdmin } from '../../lib/permissions'
import { classNames, fmtDate, fmtDateTime, fmtMoney, fmtRelative } from '../../lib/format'
import { HOT_SCORE, budgetBandLabel, leadTouches, scoreLead, serviceLabel, timelineLabel } from '../../lib/leads'
import { DISCOVERY_FORM, discoveryPrefill, formProgress } from '../../lib/forms'
import { quickFormState } from '../../lib/quickForm'
import type { Lead, LeadActivity, LeadLostReason, LeadSource, LeadStage } from '../../lib/types'
import BookingLinkDialog from './BookingLinkDialog'
import ConvertLeadModal from './ConvertLeadModal'
import {
  LEAD_ACTION_LABEL, LEAD_TOUCHES, activitySummary, attributionRows, humanize, resubmittedFields, scoreRows,
  slaLabel, spamReasonLabel, type SlaLabel,
} from './LeadTimeline'
import {
  InlineEmpty, LOST_REASONS, LOST_REASON_LABEL, SOURCES, SOURCE_LABEL, STAGES, STAGE_LABEL, UNNAMED_LEAD, httpUrl,
  useNow,
} from './shared'

/** Where the drawer becomes a bottom sheet (Tailwind's `sm`, as Modal). */
const SHEET_QUERY = '(max-width: 639.98px)'

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

const NO_ACCESS = 'You don’t have access to change this lead.'

const TOUCH_ICON: Record<LeadTouchAction, Icon> = {
  contacted: ChatCircleIcon,
  call_logged: PhoneCallIcon,
  email_sent: EnvelopeSimpleIcon,
  proposal_sent: FileTextIcon,
  meeting_booked: CalendarCheckIcon,
  booking_link_sent: CalendarCheckIcon,
}

const SLA_BADGE: Record<SlaLabel['state'], string> = {
  none: 'badge-neutral',
  met: 'badge-success',
  ok: 'badge-neutral',
  due_soon: 'badge-warn',
  breached: 'badge-danger',
}

/** The reply clock as a badge; nothing for a lead without one. */
export function SlaBadge({ lead, now, className }: { lead: Lead; now: number; className?: string }) {
  const sla = slaLabel(lead, now)
  if (!sla) return null
  return <span className={classNames('badge whitespace-nowrap text-[11px]', SLA_BADGE[sla.state], className)}>{sla.text}</span>
}

/**
 * One lead, in full: the enquiry, the pipeline fields, the score and why,
 * where it came from, and its history. A right-hand drawer from 640px up, a
 * bottom sheet below (drag the grabber down to dismiss). `leadId` null =
 * closed. Opened from a row or from /growth/leads?lead=<id> (notifications).
 *
 * Portaled to <body>, as Modal: a transformed ancestor would trap the fixed
 * overlay.
 */
export default function LeadDrawer({
  leadId, loading, onClose,
}: {
  leadId: string | null
  /** The store is still rehydrating: show the skeleton, not "not found". */
  loading?: boolean
  onClose: () => void
}) {
  const open = leadId !== null
  const shownId = useHeldWhile(leadId, open)
  const liveLead = useStore((s) => (shownId ? s.leads.find((l) => l.id === shownId) : undefined))
  // Held while it closes: deleting the lead must not flash "not found" on the way out.
  const lead = useHeldWhile(liveLead, open)
  const sheet = useMediaQuery(SHEET_QUERY)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus({ preventScroll: true })

    // A dialog or menu opened from the drawer (convert, delete, log a touch)
    // sits above it and owns the keyboard until it closes.
    const covered = () => {
      const panel = panelRef.current
      return Array.from(document.querySelectorAll('[role="dialog"], [role="menu"]'))
        .some((el) => el !== panel && !panel?.contains(el))
    }
    const onKey = (e: KeyboardEvent) => {
      const panel = panelRef.current
      if (!panel || covered()) return
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const focusables = panel.querySelectorAll<HTMLElement>(FOCUSABLE)
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true })
    }
  }, [open, onClose])

  if (typeof document === 'undefined') return null

  const label = lead ? lead.name || UNNAMED_LEAD : 'Lead'
  const body = loading
    ? <DrawerSkeleton onClose={onClose} sheet={sheet} />
    : lead
      ? <LeadBody key={lead.id} lead={lead} sheet={sheet} onClose={onClose} />
      : <DrawerMissing onClose={onClose} sheet={sheet} />

  return createPortal(
    <Presence>
      {open && (
        <OverlayRoot
          key="lead-drawer"
          // Desktop sits at z-40, level with Popover: the "Log a touch" menu opens above it.
          className={classNames('fixed inset-0 flex', sheet ? 'z-50 items-end bottom-auto h-(--app-h)' : 'z-40 justify-end')}
        >
          <Scrim onClick={onClose} />
          <SheetPanel
            ref={panelRef}
            edge={sheet ? 'bottom' : 'right'}
            // Desktop: no drag. A mouse drag across the enquiry is a text selection.
            draggable={sheet}
            onDismiss={onClose}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            aria-busy={loading || undefined}
            className={classNames(
              'relative flex w-full flex-col bg-ink-800 outline-hidden focus-visible:ring-0 shadow-(--shadow-3)',
              sheet
                ? 'max-h-[calc(var(--app-h)_-_var(--safe-top)_-_0.5rem)] rounded-t-2xl border-t border-ink-600 pb-(--safe-bottom)'
                : 'h-full max-w-[31rem] border-l border-ink-600',
            )}
          >
            {body}
          </SheetPanel>
        </OverlayRoot>
      )}
    </Presence>,
    document.body,
  )
}

// ─── Frame ──────────────────────────────────────────────────────────────────

/** The drawer's fixed top: grabber on a sheet, then the title block and Close. */
function DrawerHeader({ sheet, onClose, children }: { sheet: boolean; onClose: () => void; children: ReactNode }) {
  const inner = (
    <div className="flex items-start justify-between gap-3 px-5 pb-4 pt-4 max-sm:pt-2.5">
      <div className="min-w-0 flex-1">{children}</div>
      <button
        type="button"
        className="pressable -mr-1.5 shrink-0 rounded-md p-1.5 text-ink-300 hover:bg-ink-700 hover:text-ink-50 pointer-coarse:-m-[10px] pointer-coarse:p-[14px]"
        onClick={onClose}
        aria-label="Close"
      >
        <XIcon size={16} aria-hidden />
      </button>
    </div>
  )
  return sheet ? (
    <SheetHandle className="shrink-0 select-none border-b border-ink-600">
      <span aria-hidden className="mx-auto mt-2 block h-1 w-9 rounded-full bg-ink-500" />
      {inner}
    </SheetHandle>
  ) : (
    <div className="shrink-0 border-b border-ink-600">{inner}</div>
  )
}

function DrawerSkeleton({ sheet, onClose }: { sheet: boolean; onClose: () => void }) {
  return (
    <>
      <DrawerHeader sheet={sheet} onClose={onClose}>
        <Skeleton w="55%" h={20} />
        <Skeleton w="40%" h={12} className="mt-2.5" />
      </DrawerHeader>
      <div className="flex-1 space-y-7 overflow-hidden px-5 py-5" aria-hidden>
        <div className="flex gap-2">
          <Skeleton w={132} h={34} />
          <Skeleton w={108} h={34} />
        </div>
        <div className="space-y-2">
          <Skeleton w={64} h={10} />
          <Skeleton h={12} />
          <Skeleton h={12} />
          <Skeleton w="70%" h={12} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton w={56} h={10} />
              <Skeleton h={36} />
            </div>
          ))}
        </div>
        <div className="space-y-3">
          <Skeleton w={64} h={10} />
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} w={`${80 - i * 14}%`} h={12} />)}
        </div>
      </div>
    </>
  )
}

function DrawerMissing({ sheet, onClose }: { sheet: boolean; onClose: () => void }) {
  return (
    <>
      <DrawerHeader sheet={sheet} onClose={onClose}>
        <h2 className="text-display text-lg font-semibold text-ink-50">Lead</h2>
      </DrawerHeader>
      <div className="flex flex-1 items-center justify-center px-5 py-10">
        <InlineEmpty
          title="Lead not found"
          description="It may have been deleted, or you no longer have access to it."
          action={<button type="button" className="btn-secondary" onClick={onClose}>Back to leads</button>}
        />
      </div>
    </>
  )
}

// ─── Pieces ─────────────────────────────────────────────────────────────────

function Block({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-ink-600 px-5 py-5 first:border-t-0">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="section-title text-[11px]">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** Label / value rows on hairlines: the drawer's read-only facts. */
function Facts({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-ink-600 border-y border-ink-600 text-sm">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 py-2">
          <dt className="text-ink-300">{r.label}</dt>
          <dd className="min-w-0 text-ink-50 [overflow-wrap:anywhere]" dir="auto">{r.value}</dd>
        </div>
      ))}
    </dl>
  )
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * A text field that edits a draft and commits when focus leaves (Enter
 * commits too), so a name isn't written to the server once per keystroke.
 * `check` returns an error to refuse the value: the draft stays, the error
 * shows under the field.
 */
function DraftField({
  label, value, onCommit, check, type = 'text', inputMode, autoComplete, multiline, placeholder,
}: {
  label: string
  value: string
  onCommit: (value: string) => void
  check?: (value: string) => string | null
  type?: 'text' | 'email' | 'tel'
  inputMode?: 'text' | 'email' | 'tel' | 'decimal'
  autoComplete?: string
  multiline?: boolean
  placeholder?: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const next = draft.trim()
    const problem = check?.(next) ?? null
    setError(problem)
    if (problem) return
    if (next !== value) onCommit(next)
    setDraft(null)
  }
  const shared = {
    className: classNames('input w-full', INPUT_INVALID),
    value: draft ?? value,
    placeholder,
    dir: 'auto' as const,
    onBlur: commit,
  }
  return (
    <FormField label={label} error={error} className={multiline ? 'col-span-full' : undefined}>
      {(control) => multiline ? (
        <textarea
          {...control}
          {...shared}
          rows={3}
          className={classNames(shared.className, 'resize-y leading-relaxed')}
          onChange={(e) => setDraft(e.target.value)}
        />
      ) : (
        <input
          {...control}
          {...shared}
          type={type}
          inputMode={inputMode}
          autoComplete={autoComplete ?? 'off'}
          onChange={(e) => { setDraft(e.target.value); if (error) setError(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
        />
      )}
    </FormField>
  )
}

function TimelineRow({ a, userName }: { a: LeadActivity; userName: (id: string) => string | undefined }) {
  const summary = activitySummary(a, userName)
  const claimed = a.action === 'resubmitted' ? resubmittedFields(a.detail) : []
  const who = a.actorId ? userName(a.actorId) ?? 'A teammate' : 'System'
  return (
    <li className="relative pb-4 pl-5 last:pb-0">
      {/* The rail: a hairline between events, a dot on each. */}
      <span aria-hidden className="absolute left-[3px] top-[7px] size-[7px] rounded-full bg-ink-400" />
      <span aria-hidden className="absolute bottom-0 left-[6px] top-[18px] w-px bg-ink-600 [li:last-child>&]:hidden" />
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 text-sm font-medium text-ink-50">{LEAD_ACTION_LABEL[a.action] ?? 'Update'}</p>
        <time
          dateTime={a.createdAt}
          title={fmtDateTime(a.createdAt)}
          className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-ink-300"
        >
          {fmtRelative(a.createdAt)}
        </time>
      </div>
      <p className="mt-0.5 text-xs leading-relaxed text-ink-300 [overflow-wrap:anywhere]" dir="auto">
        {summary ? <><span className="text-ink-100">{summary}</span> · {who}</> : who}
      </p>
      {a.action === 'resubmitted' && (
        claimed.length > 0 ? (
          <div className="mt-2">
            <p className="mb-1.5 text-[11px] leading-relaxed text-ink-300">
              The new submission said this. The lead was not changed: check it, then update the fields by hand.
            </p>
            <dl className="divide-y divide-ink-600 border-y border-ink-600 text-xs">
              {claimed.map((r) => (
                <div key={r.label} className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3 py-1.5">
                  <dt className="text-ink-300">{r.label}</dt>
                  <dd className="min-w-0 whitespace-pre-wrap text-ink-100 [overflow-wrap:anywhere]" dir="auto">{r.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null
      )}
    </li>
  )
}

/**
 * The discovery form for this lead: filled in during the first meeting, or
 * sent to them as a quick form (/f/<token>). Its timeline, budget and
 * services write back onto the lead when completed.
 */
function DiscoveryRow({ lead, canEdit }: { lead: Lead; canEdit: boolean }) {
  const response = useStore((s) => s.formResponses.find((r) => r.form === DISCOVERY_FORM.key && r.leadId === lead.id && !r.projectId))
  const [open, setOpen] = useState<'form' | 'share' | null>(null)
  const link = quickFormState(response)
  const done = response?.status === 'submitted'
  const progress = formProgress(DISCOVERY_FORM, response?.answers ?? {})
  const prefill = discoveryPrefill(lead)
  const first = lead.name?.split(/\s+/)[0] || 'The lead'

  const state = done
    ? `Completed ${fmtDate(response?.submittedAt)}`
    : link === 'answered'
      ? `${first} sent their answers ${fmtRelative(response?.customerSubmittedAt)} — review and complete`
      : link === 'open'
        ? `Sent to ${response?.sharedTo ?? first} · open until ${fmtDate(response?.shareExpiresAt)}`
        : response
          ? `Draft · ${progress.done} of ${progress.required} required`
          : 'Not started'

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-ink-600 px-3 py-2.5">
      <ClipboardTextIcon size={16} className="shrink-0 text-ink-300" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-sm text-ink-50">{DISCOVERY_FORM.title}</div>
        <div className={classNames('text-[11px]', link === 'answered' && !done ? 'text-sky-700 dark:text-sky-400' : 'text-ink-300')}>{state}</div>
      </div>
      {canEdit && !done && link !== 'answered' && (
        <button type="button" className="btn-ghost px-2! py-1! text-xs pointer-coarse:min-h-11" onClick={() => setOpen('share')}>
          <PaperPlaneTiltIcon size={13} aria-hidden /> {link === 'open' ? 'Resend' : 'Send to lead'}
        </button>
      )}
      <button type="button" className="btn-secondary px-2.5! py-1! text-xs pointer-coarse:min-h-11" onClick={() => setOpen('form')}>
        {done || link === 'answered' || !canEdit ? 'Open' : response ? 'Continue' : 'Fill in'}
      </button>
      {open === 'form' && (
        <FormModal
          template={DISCOVERY_FORM}
          leadId={lead.id}
          prefill={prefill}
          prefillNote={lead.form ? 'What their website enquiry told us is filled in already.' : undefined}
          completeLabel="Complete discovery"
          completedToast="Discovery complete — lead updated"
          customerName={lead.name}
          onClose={() => setOpen(null)}
        />
      )}
      {open === 'share' && (
        <ShareFormDialog
          form={DISCOVERY_FORM.key}
          leadId={lead.id}
          defaultTo={lead.email}
          name={lead.name}
          answers={prefill}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}

/** Meetings about this lead: booked on the website's /book page (048) or linked in DeskDev. */
function LeadMeetings({ leadId, now }: { leadId: string; now: number }) {
  const events = useStore((s) => s.events)
  const meetings = useMemo(
    () => events.filter((e) => e.leadId === leadId).sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [events, leadId],
  )
  if (meetings.length === 0) return null
  return (
    <Block title="Meetings" aside={<span className="text-[11px] tabular-nums text-ink-300">{meetings.length}</span>}>
      <ul className="space-y-1.5">
        {meetings.map((m) => {
          const past = new Date(m.endsAt ?? m.startsAt).getTime() < now
          const meet = httpUrl(m.meetingLink)
          return (
            <li key={m.id} className={classNames('flex flex-wrap items-center gap-2 rounded-lg border border-ink-600 px-3 py-2', past && 'opacity-70')}>
              <VideoCameraIcon size={15} className="shrink-0 text-ink-300" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink-50" dir="auto">{m.title}</span>
                <span className="block text-[11px] text-ink-300">
                  {fmtDateTime(m.startsAt)}
                  {m.bookedVia === 'website' ? ' · booked on the website' : ''}
                  {m.syncStatus === 'error' ? ' · Google sync failed' : ''}
                </span>
              </span>
              {meet && !past && (
                <a href={meet} target="_blank" rel="noreferrer" className="btn-secondary px-2! py-1! text-xs pointer-coarse:min-h-11">
                  Join
                </a>
              )}
            </li>
          )
        })}
      </ul>
    </Block>
  )
}

// ─── The lead ───────────────────────────────────────────────────────────────

function LeadBody({ lead, sheet, onClose }: { lead: Lead; sheet: boolean; onClose: () => void }) {
  const user = useCurrentUser()
  const canEdit = can(user, 'growth', 'edit')
  const canConvert = isAdmin(user) || (canEdit && can(user, 'clients', 'edit'))
  const canSeeClients = can(user, 'clients', 'view')

  const users = useStore((s) => s.users)
  const allActivity = useStore((s) => s.leadActivity)
  const bookingUrl = useStore((s) => httpUrl(s.workspaceSettings.growthBookingUrl))
  const bookingEnabled = useStore((s) => s.workspaceSettings.bookingEnabled)
  const allEmails = useStore((s) => s.emails)
  const existingClient = useStore((s) => s.clients.find((c) => c.id === lead.existingClientId))
  const updateLead = useStore((s) => s.updateLead)
  const moveLeadStage = useStore((s) => s.moveLeadStage)
  const assignLead = useStore((s) => s.assignLead)
  const setLeadFollowUp = useStore((s) => s.setLeadFollowUp)
  const setLeadSpam = useStore((s) => s.setLeadSpam)
  const logLeadTouch = useStore((s) => s.logLeadTouch)
  const deleteLead = useStore((s) => s.deleteLead)
  const now = useNow(30_000)

  const [touchAnchor, setTouchAnchor] = useState<HTMLElement | null>(null)
  const [converting, setConverting] = useState(false)
  // Stable: Modal re-runs its focus effect when onClose changes identity.
  const closeConvert = useCallback(() => setConverting(false), [])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const closeDelete = useCallback(() => setConfirmDelete(false), [])
  const [bookingOpen, setBookingOpen] = useState(false)
  // "Lost" is picked first and committed with its reason, so no lead is ever
  // lost for no recorded reason.
  const [askingLost, setAskingLost] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [copied, flashCopied] = useCopied()

  const activity = useMemo(
    () => allActivity.filter((a) => a.leadId === lead.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [allActivity, lead.id],
  )
  const leadEmails = useMemo(() => allEmails.filter((e) => e.leadId === lead.id), [allEmails, lead.id])
  const userName = (id: string) => users.find((u) => u.id === id)?.fullName
  // Owners: active people who can work leads. A current owner who has since
  // been deactivated stays listed, so the field doesn't read "Unassigned".
  const owners = activeUsers(users).filter((u) => can(u, 'growth', 'edit'))
  const staleOwner = lead.ownerId && !owners.some((u) => u.id === lead.ownerId)
    ? users.find((u) => u.id === lead.ownerId)
    : undefined

  const scrubbed = !!lead.piiScrubbedAt
  const spam = !!lead.spam
  const editable = canEdit && !scrubbed
  const closed = lead.stage === 'won' || lead.stage === 'lost'
  const showConvert = editable && !spam && canConvert && !lead.clientId
  const showTouch = editable && !spam && !closed
  const showClient = !!lead.clientId && canSeeClients

  // The server's breakdown when it set one; else the same rules, run here.
  const computed = scoreLead(lead)
  const score = lead.score ?? computed.score
  const rules = scoreRows(lead.scoreBreakdown ?? computed.breakdown)
  const hot = !spam && (lead.hot || score >= HOT_SCORE)

  // Either shape: intake keeps the first touch at the top level and the last
  // under `last` (034's lead_clean_attribution); older rows nest both.
  const touches = leadTouches(lead.attribution)
  const first = attributionRows(touches.first)
  const last = attributionRows(touches.last)
  const ref = typeof lead.attribution?.ref === 'string' ? lead.attribution.ref.slice(0, 200) : undefined

  /** Run a store action that answers false when it was refused. */
  const guarded = (ok: boolean): boolean => {
    setActionError(ok ? null : NO_ACCESS)
    return ok
  }

  const logTouch = (action: LeadTouchAction) => {
    if (guarded(logLeadTouch(lead.id, action))) toast.success(LEAD_ACTION_LABEL[action])
  }

  const copyBooking = async () => {
    if (!bookingUrl) return
    try {
      await navigator.clipboard.writeText(bookingUrl)
    } catch {
      setActionError(`Could not copy the link. Copy it by hand: ${bookingUrl}`)
      return
    }
    flashCopied()
    if (guarded(logLeadTouch(lead.id, 'booking_link_sent'))) toast.success('Booking link copied')
  }

  const onStage = (stage: LeadStage) => {
    if (stage === 'lost') {
      setAskingLost(true)
      return
    }
    setAskingLost(false)
    moveLeadStage(lead.id, stage)
  }

  const onLostReason = (reason: LeadLostReason) => {
    if (lead.stage === 'lost') updateLead(lead.id, { lostReason: reason })
    else moveLeadStage(lead.id, 'lost', reason)
    setAskingLost(false)
  }

  const enquiry = [
    lead.services?.length ? { label: 'Services', value: lead.services.map((s) => serviceLabel(s)).join(', ') } : null,
    lead.budgetBand ? { label: 'Budget', value: budgetBandLabel(lead.budgetBand) } : null,
    lead.timeline ? { label: 'Timeline', value: timelineLabel(lead.timeline) } : null,
    lead.form ? { label: 'Form', value: humanize(lead.form) } : null,
    lead.lastSubmittedAt ? { label: 'Submitted', value: fmtDateTime(lead.lastSubmittedAt) } : null,
    (lead.submissionCount ?? 1) > 1 ? { label: 'Submissions', value: String(lead.submissionCount) } : null,
    lead.form || lead.consentAt
      ? { label: 'Consent', value: lead.consentAt ? `Given ${fmtDate(lead.consentAt)}` : 'Not recorded' }
      : null,
  ].filter((r): r is { label: string; value: string } => r !== null)

  const select = 'input w-full'

  return (
    <>
      <DrawerHeader sheet={sheet} onClose={onClose}>
        <h2 className="text-display text-lg font-semibold text-ink-50 [overflow-wrap:anywhere]" dir="auto">
          {lead.name || UNNAMED_LEAD}
        </h2>
        <p className="mt-0.5 text-xs text-ink-300 [overflow-wrap:anywhere]">
          {lead.company && lead.company !== lead.name && <><span dir="auto">{lead.company}</span> · </>}
          {SOURCE_LABEL[lead.source]} · added {fmtRelative(lead.createdAt)}
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 empty:hidden">
          {spam && <span className="badge badge-danger text-[11px]">Spam</span>}
          {hot && (
            <span className="badge badge-warn text-[11px]">
              <FireIcon size={12} weight="fill" aria-hidden /> Hot
            </span>
          )}
          {!spam && (lead.score !== undefined || rules.length > 0) && (
            <span className="badge badge-neutral text-[11px]">Score {score}</span>
          )}
          {!closed && <SlaBadge lead={lead} now={now} />}
          {lead.clientId && <span className="badge badge-success text-[11px]">Client</span>}
        </div>
      </DrawerHeader>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {/* State and actions: what this lead is, and what to do next. */}
        <div className="space-y-3 px-5 py-4 empty:hidden">
          {scrubbed && (
            <Notice tone="info" icon={EraserIcon}>Details removed under the retention policy</Notice>
          )}
          {spam && (
            <Notice
              tone="danger"
              icon={ProhibitIcon}
              action={canEdit ? (
                <button
                  type="button"
                  className="btn-secondary shrink-0 px-2.5! py-1.5! text-xs pointer-coarse:min-h-11"
                  onClick={() => { if (guarded(setLeadSpam(lead.id, false))) toast.success('Moved out of quarantine') }}
                >
                  Not spam
                </button>
              ) : undefined}
            >
              In quarantine: {spamReasonLabel(lead.spamReason)}. Spam is deleted automatically after 30 days.
            </Notice>
          )}
          {lead.existingClientId && (
            <Notice tone="info" icon={UsersIcon}>
              This enquiry came from an{' '}
              {canSeeClients ? (
                <Link
                  to={`/clients/${lead.existingClientId}`}
                  className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300"
                >
                  existing client
                </Link>
              ) : 'existing client'}
              {existingClient ? <> ({existingClient.company?.trim() || existingClient.name})</> : null}.
            </Notice>
          )}

          {(showConvert || showTouch || showClient) && (
            <div className="flex flex-wrap gap-2 max-sm:[&>*]:min-h-11 max-sm:[&>*]:flex-1">
              {showConvert && (
                <button type="button" className="btn-primary" onClick={() => setConverting(true)}>
                  <UserPlusIcon size={16} aria-hidden /> Convert to client
                </button>
              )}
              {showTouch && (
                <button
                  type="button"
                  className="btn-secondary"
                  aria-haspopup="menu"
                  aria-expanded={touchAnchor !== null}
                  onClick={(e) => setTouchAnchor(e.currentTarget)}
                >
                  Log a touch <CaretDownIcon size={12} aria-hidden />
                </button>
              )}
              {showTouch && (
                <button type="button" className="btn-secondary" onClick={() => setBookingOpen(true)}>
                  <CalendarPlusIcon size={16} aria-hidden /> Send booking link
                </button>
              )}
              {showTouch && bookingUrl && (
                <button type="button" className="btn-secondary" onClick={copyBooking}>
                  <CopyGlyph copied={copied} /> Copy booking link
                </button>
              )}
              {showClient && (
                <Link to={`/clients/${lead.clientId}`} className="btn-secondary">Open client</Link>
              )}
            </div>
          )}
          {showTouch && !bookingUrl && !bookingEnabled && (
            <p className="text-[11px] leading-relaxed text-ink-300">
              Online booking is off and there is no booking link yet. An admin sets either up in Settings, under Growth.
            </p>
          )}
          <FieldError error={actionError} />
        </div>

        {(lead.message || enquiry.length > 0) && (
          <Block title="Enquiry">
            {lead.message && (
              <blockquote
                dir="auto"
                className="mb-4 whitespace-pre-wrap border-l-2 border-ink-500 pl-3 text-sm leading-relaxed text-ink-100 [overflow-wrap:anywhere]"
              >
                {lead.message}
              </blockquote>
            )}
            {enquiry.length > 0 && <Facts rows={enquiry} />}
          </Block>
        )}

        <Block title="Pipeline">
          {editable && !spam ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-4 max-[380px]:grid-cols-1">
              <FormField label="Stage">
                {(control) => (
                  <select
                    {...control}
                    className={select}
                    value={askingLost ? 'lost' : lead.stage}
                    onChange={(e) => onStage(e.target.value as LeadStage)}
                  >
                    {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                  </select>
                )}
              </FormField>
              <FormField label="Owner">
                {(control) => (
                  <select
                    {...control}
                    className={select}
                    value={lead.ownerId ?? ''}
                    onChange={(e) => guarded(assignLead(lead.id, e.target.value || undefined))}
                  >
                    <option value="">Unassigned</option>
                    {staleOwner && <option value={staleOwner.id}>{staleOwner.fullName} (inactive)</option>}
                    {owners.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
                  </select>
                )}
              </FormField>
              {(askingLost || lead.stage === 'lost') && (
                <FormField
                  label="Why was it lost?"
                  className="col-span-full"
                  error={askingLost ? 'Pick a reason to mark this lead lost.' : null}
                >
                  {(control) => (
                    <select
                      {...control}
                      className={classNames(select, INPUT_INVALID)}
                      value={askingLost ? '' : lead.lostReason ?? 'other'}
                      onChange={(e) => { if (e.target.value) onLostReason(e.target.value as LeadLostReason) }}
                    >
                      {askingLost && <option value="">Choose a reason</option>}
                      {LOST_REASONS.map((r) => <option key={r} value={r}>{LOST_REASON_LABEL[r]}</option>)}
                    </select>
                  )}
                </FormField>
              )}
              <FormField label="Follow-up">
                <DateField
                  value={lead.followUp}
                  onChange={(date) => guarded(setLeadFollowUp(lead.id, date))}
                />
              </FormField>
              <DraftField
                label="Value (USD)"
                inputMode="decimal"
                value={lead.value ? String(lead.value) : ''}
                placeholder="0"
                check={(v) => (v && !/^\d+(\.\d+)?$/.test(v) ? 'Enter a number, digits only.' : null)}
                onCommit={(v) => updateLead(lead.id, { value: Math.max(0, parseFloat(v) || 0) })}
              />
            </div>
          ) : (
            <Facts
              rows={[
                { label: 'Stage', value: lead.stage === 'lost' && lead.lostReason ? `${STAGE_LABEL.lost} · ${LOST_REASON_LABEL[lead.lostReason]}` : STAGE_LABEL[lead.stage] },
                { label: 'Owner', value: lead.ownerId ? userName(lead.ownerId) ?? 'A teammate' : 'Unassigned' },
                { label: 'Follow-up', value: lead.followUp ? fmtDate(lead.followUp) : '—' },
                { label: 'Value', value: <span className="tabular-nums">{fmtMoney(lead.value)}</span> },
              ]}
            />
          )}
        </Block>

        {!scrubbed && (
          <Block title="Contact">
            {editable ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-4 max-[380px]:grid-cols-1">
                <DraftField
                  label="Name"
                  value={lead.name}
                  autoComplete="off"
                  check={(v) => (v ? null : 'A lead needs a name.')}
                  onCommit={(name) => updateLead(lead.id, { name })}
                />
                <DraftField
                  label="Company"
                  value={lead.company ?? ''}
                  onCommit={(v) => updateLead(lead.id, { company: v || undefined })}
                />
                <DraftField
                  label="Email"
                  type="email"
                  inputMode="email"
                  value={lead.email ?? ''}
                  check={(v) => (v && !EMAIL.test(v) ? 'Enter a full email address, like name@company.com.' : null)}
                  onCommit={(v) => updateLead(lead.id, { email: v || undefined })}
                />
                <DraftField
                  label="Phone"
                  type="tel"
                  inputMode="tel"
                  value={lead.phone ?? ''}
                  onCommit={(v) => updateLead(lead.id, { phone: v || undefined })}
                />
                <FormField label="Source">
                  {(control) => (
                    <select
                      {...control}
                      className={select}
                      value={lead.source}
                      onChange={(e) => updateLead(lead.id, { source: e.target.value as LeadSource })}
                    >
                      {SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
                    </select>
                  )}
                </FormField>
                <DraftField
                  label="Notes"
                  multiline
                  value={lead.notes ?? ''}
                  onCommit={(v) => updateLead(lead.id, { notes: v || undefined })}
                />
              </div>
            ) : (
              <Facts
                rows={[
                  { label: 'Company', value: lead.company || '—' },
                  { label: 'Email', value: lead.email || '—' },
                  { label: 'Phone', value: lead.phone || '—' },
                  { label: 'Source', value: SOURCE_LABEL[lead.source] },
                  ...(lead.notes ? [{ label: 'Notes', value: <span className="whitespace-pre-wrap">{lead.notes}</span> }] : []),
                ]}
              />
            )}
          </Block>
        )}

        {!spam && (
          <Block
            title="Score"
            aside={
              <span className="text-sm font-semibold tabular-nums text-ink-50">
                {score}<span className="font-normal text-ink-300"> / 100</span>
              </span>
            }
          >
            {rules.length === 0 ? (
              <p className="text-sm text-ink-300">Nothing has scored yet. Budget, timeline and contact details add points.</p>
            ) : (
              <ul className="divide-y divide-ink-600 border-y border-ink-600 text-sm">
                {rules.map((r) => (
                  <li key={r.key} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 text-ink-100">{r.label}</span>
                    <span className="shrink-0 tabular-nums text-ink-50">+{r.points}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-ink-300">
              <span className="tabular-nums">{HOT_SCORE}</span> or more is hot.
            </p>
          </Block>
        )}

        {(first.length > 0 || last.length > 0 || ref) && (
          <Block title="Where it came from">
            <div className="space-y-4">
              {first.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-ink-200">First visit</p>
                  <Facts rows={first} />
                </div>
              )}
              {last.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-ink-200">Last visit</p>
                  <Facts rows={last} />
                </div>
              )}
              {ref && <Facts rows={[{ label: 'Started from', value: ref }]} />}
            </div>
          </Block>
        )}

        <LeadMeetings leadId={lead.id} now={now} />

        {/* Email (049): sent from the studio's Gmail by n8n; their replies land here. */}
        {!spam && !scrubbed && (
          <Block title="Email">
            <EmailThreads
              emails={leadEmails}
              leadId={lead.id}
              person={{ name: lead.name, email: lead.email }}
              canSend={editable}
            />
          </Block>
        )}

        {/* Forms: discovery in the meeting, or sent to the lead as a quick form. */}
        {!spam && !scrubbed && (
          <Block title="Forms">
            <DiscoveryRow lead={lead} canEdit={editable} />
          </Block>
        )}

        <Block title="History" aside={<span className="text-[11px] tabular-nums text-ink-300">{activity.length}</span>}>
          {activity.length === 0 ? (
            <p className="text-sm text-ink-300">No history yet. Stage changes and touches show up here.</p>
          ) : (
            <ol>
              {activity.map((a) => <TimelineRow key={a.id} a={a} userName={userName} />)}
            </ol>
          )}
        </Block>

        {canEdit && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-600 px-5 py-4">
            {!spam && !lead.clientId ? (
              <button
                type="button"
                className="btn-ghost text-xs pointer-coarse:min-h-11"
                onClick={() => { if (guarded(setLeadSpam(lead.id, true, 'manual'))) toast.success('Moved to quarantine') }}
              >
                <ProhibitIcon size={14} aria-hidden /> Mark as spam
              </button>
            ) : <span />}
            <button
              type="button"
              className="btn-ghost text-xs text-rose-700 hover:bg-rose-500/10 dark:text-rose-400 pointer-coarse:min-h-11"
              onClick={() => setConfirmDelete(true)}
            >
              <TrashIcon size={14} aria-hidden /> Delete lead
            </button>
          </div>
        )}
      </div>

      <Popover
        anchor={touchAnchor}
        onClose={() => setTouchAnchor(null)}
        role="menu"
        label="Log a touch"
      >
        {LEAD_TOUCHES.map((t) => (
          <MenuItem
            key={t.action}
            icon={TOUCH_ICON[t.action]}
            label={t.label}
            onClick={() => { logTouch(t.action); setTouchAnchor(null) }}
          />
        ))}
      </Popover>

      <ConvertLeadModal lead={converting ? lead : null} onClose={closeConvert} />

      {bookingOpen && <BookingLinkDialog lead={lead} onClose={() => setBookingOpen(false)} />}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete lead"
        message={`Delete ${lead.name || 'this lead'}? Its activity history goes with it.`}
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          deleteLead(lead.id)
          toast.success('Lead deleted')
          onClose()
        }}
        onClose={closeDelete}
      />
    </>
  )
}
