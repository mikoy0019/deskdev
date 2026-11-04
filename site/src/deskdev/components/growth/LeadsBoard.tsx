import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowsOutSimpleIcon, CalendarBlankIcon, CaretRightIcon, DotsThreeIcon, FireIcon, PhoneCallIcon,
  PlusIcon, TrashIcon, UserPlusIcon,
} from '@phosphor-icons/react'
import ConfirmDialog from '../ConfirmDialog'
import { IndicatorGroup, LayoutIndicator, TWEEN, m, useInputModality, useStagger } from '../motion'
import Popover, { MenuItem, POPOVER_ROW } from '../crm/Popover'
import { useStore, useCurrentUser } from '../../store/useStore'
import { PHONE_QUERY, useMediaQuery } from '../../pwa/useMediaQuery'
import { classNames, fmtDate, fmtMoney, fmtRelative } from '../../lib/format'
import { HOT_SCORE, budgetBandLabel, compareBySla, inboxTab, serviceLabel, slaState, type LeadInboxTab } from '../../lib/leads'
import { can, isAdmin } from '../../lib/permissions'
import type { Lead, LeadSource, LeadStage } from '../../lib/types'
import ConvertLeadModal from './ConvertLeadModal'
import { SlaBadge } from './LeadDrawer'
import { spamReasonLabel } from './LeadTimeline'
import {
  STAGES, STAGE_LABEL, SOURCES, SOURCE_LABEL, GHOST_CUE, GHOST_FIELD, GhostSelect, GhostText,
  LOST_REASONS, LOST_REASON_LABEL, UNNAMED_LEAD, InlineEmpty, useGrowthMetrics, useNow,
} from './shared'

// Row actions: 28px icon buttons for a mouse, 44px under a finger (they sit
// side by side, and Delete is one of them).
const ROW_ACTION = 'pressable tap-target p-1.5 rounded-md text-ink-400 hover:bg-ink-700'

type BoardTab = 'all' | LeadInboxTab

const TABS: [BoardTab, string][] = [
  ['all', 'All'],
  ['new', 'New'],
  ['pipeline', 'Pipeline'],
  ['closed', 'Closed'],
  ['quarantine', 'Quarantine'],
]

const TAB_EMPTY: Record<BoardTab, { title: string; description: string }> = {
  all: { title: 'No leads yet', description: 'Add one, or let inbound and the job finder fill this in.' },
  new: { title: 'No new leads', description: 'Leads from the website form wait here until someone replies.' },
  pipeline: { title: 'Nothing in the pipeline', description: 'A lead moves here after the first reply.' },
  closed: { title: 'No closed leads', description: 'Won and lost leads end up here.' },
  quarantine: {
    title: 'Quarantine is empty',
    description: 'Submissions that fail the spam checks wait here. Spam is deleted automatically after 30 days.',
  },
}

const NO_ACCESS = 'You don’t have access to change this lead.'

/** The stage as a dot: only the outcomes carry a status colour. */
const STAGE_DOT: Record<LeadStage, string> = {
  new: 'bg-ink-400',
  contacted: 'bg-brand-500',
  proposal: 'bg-brand-500',
  won: 'bg-emerald-500',
  lost: 'bg-rose-500',
}

// The lead column stays put while the rest scrolls sideways; it needs its own
// opaque surface for that, and a hairline edge where the table scrolls under
// it. The edge is a container query on the scroller: it shows exactly when
// the scroller is narrower than the table's minimum (64rem), which is the
// only time anything can scroll under the column.
const STICKY = 'sticky left-0 z-[1] bg-ink-800 @max-5xl:shadow-[inset_-1px_0_0_rgb(var(--ink-600))]'
const TH = 'py-2.5 px-2 font-semibold whitespace-nowrap'

/** A field's caption on a phone row, where there is no table header to name it. */
const CARD_LABEL = 'block section-title text-[11px]'

/**
 * The follow-up date. At rest it reads as the rest of the page writes dates
 * ("Oct 6, 2026"), or a muted dash when unset, never the browser's mm/dd/yyyy
 * mask: the native value is transparent until the field has focus. The
 * browser's calendar glyph is swapped for ours (`date-ghost`, index.css).
 */
function FollowUpField({
  value, label, overdue, onChange,
}: { value?: string; label: string; overdue: boolean; onChange: (value?: string) => void }) {
  return (
    <div className="relative">
      <input
        type="date"
        aria-label={label}
        className={classNames(
          GHOST_FIELD,
          'date-ghost peer pr-7 tabular-nums not-focus:text-transparent',
          overdue && 'text-rose-700 dark:text-rose-400',
        )}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
      />
      <span
        className={classNames(
          // Where the field's own text sits: its 1px border, then its padding.
          'pointer-events-none absolute left-[calc(0.5rem+1px)] right-7 top-1/2 -translate-y-1/2 truncate text-sm tabular-nums pointer-coarse:text-base peer-focus:opacity-0',
          !value ? 'text-ink-400' : overdue ? 'text-rose-700 dark:text-rose-400' : 'text-ink-50',
        )}
        aria-hidden
      >
        {value ? fmtDate(value) : '—'}
      </span>
      <CalendarBlankIcon size={14} className={GHOST_CUE} aria-hidden />
    </div>
  )
}

/** Where `id` sits in a held order; a row that arrived since goes last. */
function rank(order: string[], id: string): number {
  const i = order.indexOf(id)
  return i === -1 ? order.length : i
}

/**
 * A deal value: "7,200" at rest, like every other figure on the page, and
 * plain digits while it is being typed (a number input can't show the
 * separators). Anything that isn't a digit or a point is dropped as typed.
 * It saves on leaving the field or on Enter, never per key: a half-typed
 * figure must not reach the pipeline total. Left empty, the old value comes
 * back (type 0 to clear one); Escape cancels the edit.
 */
function ValueField({
  value, label, onCommit,
}: { value: number; label: string; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const plain = (n: number) => (n === 0 ? '' : String(n))
  const negative = draft !== null && draft.includes('-')
  /** Saves a readable draft and returns what the field now holds. */
  const settle = (): number => {
    // parseFloat, not Number: a stray second point ("1.2.") keeps 1.2.
    // A minus is not a typo to drop quietly ("-500" was saved as 500): the
    // field is marked invalid while it is there and the old value comes back.
    const n = draft === null || negative ? NaN : parseFloat(draft)
    if (!Number.isFinite(n)) return value
    if (n !== value) onCommit(n)
    return n
  }
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-ink-400" aria-hidden>$</span>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-label={label}
        aria-invalid={negative || undefined}
        title={negative ? 'A value cannot be negative' : undefined}
        className={classNames(GHOST_FIELD, 'pl-5 tabular-nums aria-invalid:border-rose-500 aria-invalid:focus:border-rose-500 aria-invalid:focus:ring-rose-500/20')}
        value={draft ?? value.toLocaleString('en-US')}
        onFocus={(e) => {
          setDraft(plain(value))
          const field = e.currentTarget
          requestAnimationFrame(() => field.select())
        }}
        onBlur={() => {
          settle()
          setDraft(null)
        }}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d.-]/g, ''))}
        onKeyDown={(e) => {
          const cancel = e.key === 'Escape' && draft !== null && draft !== plain(value)
          if (e.key !== 'Enter' && !cancel) return
          // Only this edit is cancelled, not whatever else Escape would close.
          if (cancel) e.stopPropagation()
          setDraft(plain(cancel ? value : settle()))
          // Selected again, as on focus: the next key types over the figure.
          const field = e.currentTarget
          requestAnimationFrame(() => field.select())
        }}
      />
    </div>
  )
}

/** The editable leads table — Growth's own CRM (separate from Operations CRM). */
export default function LeadsBoard({
  canEdit, onOpen, focusId,
}: {
  canEdit: boolean
  /** Open a lead's drawer. */
  onOpen: (id: string) => void
  /** The lead a deep link asked for: the board starts on its tab. */
  focusId?: string | null
}) {
  const user = useCurrentUser()
  // Converting makes a client and a project: admins, or Growth + Clients editors.
  const canConvert = isAdmin(user) || (canEdit && can(user, 'clients', 'edit'))
  const leads = useStore((s) => s.leads)
  const addLead = useStore((s) => s.addLead)
  const updateLead = useStore((s) => s.updateLead)
  const moveLeadStage = useStore((s) => s.moveLeadStage)
  const logLeadTouch = useStore((s) => s.logLeadTouch)
  const setLeadFollowUp = useStore((s) => s.setLeadFollowUp)
  const setLeadSpam = useStore((s) => s.setLeadSpam)
  const deleteLead = useStore((s) => s.deleteLead)
  const g = useGrowthMetrics()
  const now = useNow()

  // When a lead is moved to 'lost' we ask why — capturing 'no decision' is the
  // whole point: it's the largest loss bucket and the only one you can coach.
  // Asked in a small menu at the stage field (a sheet on phones), not inline:
  // six chips in a narrow cell tripled the row's height.
  const [askingReason, setAskingReason] = useState<{ lead: Lead; anchor: HTMLElement } | null>(null)
  // Delete asks first: it removes the lead and its activity history for good.
  const [pendingDelete, setPendingDelete] = useState<Lead | null>(null)

  // First load of the table this session: rows arrive 40ms apart, once —
  // never on a stage change, a new lead or a revisit.
  const { ref: attachStagger, className: staggerClass } = useStagger<HTMLElement>('growth-leads')
  // From md up: the table. Below it: stacked rows, like Projects and Clients —
  // a 65rem table in a 358px scroller showed two of its seven columns.
  const phone = useMediaQuery(PHONE_QUERY)
  // Phones: the row actions sit behind one overflow button (a sheet).
  const [menu, setMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null)
  const menuLead = menu ? leads.find((l) => l.id === menu.id) ?? null : null

  // Quarantined spam is not part of "All": it never reaches the pipeline.
  const inTab = (l: Lead, t: BoardTab) => (t === 'all' ? !l.spam : inboxTab(l) === t)
  const counts = Object.fromEntries(
    TABS.map(([t]) => [t, leads.filter((l) => inTab(l, t)).length]),
  ) as Record<BoardTab, number>
  // Opens on what needs a reply; a deep link opens on its lead's tab.
  const [tab, setTab] = useState<BoardTab>(() => {
    const focus = focusId ? leads.find((l) => l.id === focusId) : undefined
    if (focus) return inboxTab(focus)
    return leads.some((l) => inboxTab(l) === 'new') ? 'new' : 'all'
  })
  const [converting, setConverting] = useState<Lead | null>(null)
  const visible = leads.filter((l) => inTab(l, tab))

  const natural = [...visible].sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage) || b.value - a.value)
  // While a field in the table has focus the order holds still: typing a value
  // or picking a stage would otherwise re-sort the row out from under the
  // cursor on every keystroke. It settles when focus leaves the table, and the
  // rows glide to their places (180ms ease-in-out) so you can see where one
  // went. Left by the keyboard, they simply land; reduced motion drops the glide.
  const [held, setHeld] = useState<string[] | null>(null)
  const sorted = tab === 'new'
    ? [...visible].sort((a, b) => compareBySla(a, b, now))
    : tab === 'quarantine'
      ? [...visible].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      : held
        ? [...natural].sort((a, b) => rank(held, a.id) - rank(held, b.id))
        : natural
  const glide = useInputModality() !== 'keyboard'

  // "Add lead" puts the cursor in the new row's name, selected, ready to type over.
  const focusNew = useRef<string | null>(null)
  useEffect(() => {
    const id = focusNew.current
    if (!id) return
    focusNew.current = null
    const field = document.querySelector<HTMLInputElement>(`[data-lead-name="${CSS.escape(id)}"]`)
    if (!field) return
    field.focus({ preventScroll: true })
    field.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    field.select()
  }, [leads])

  const add = () => {
    // The new row is typed into in the table, so show the tab that has it.
    setTab('all')
    focusNew.current = addLead({ name: 'New lead' })
  }

  const canConvertLead = (l: Lead) => canConvert && !l.spam && !l.clientId && !l.piiScrubbedAt

  const onStageChange = (l: Lead, stage: LeadStage, anchor: HTMLElement) => {
    if (stage === 'lost') { setAskingReason({ lead: l, anchor }); return }
    moveLeadStage(l.id, stage)
  }

  // A touch logged "in the future" (clock skew, an import) reads as today, never "-1d".
  const daysCold = (l: Lead) => Math.max(0, Math.floor((now - new Date(g.lastTouchOf(l)).getTime()) / 864e5))

  const isOpen = (l: Lead) => l.stage !== 'won' && l.stage !== 'lost'
  const isOverdue = (l: Lead) => isOpen(l) && !!l.followUp && l.followUp < g.today
  const logTouch = (l: Lead) => {
    if (logLeadTouch(l.id, 'contacted')) toast.success('Touch logged')
    else toast.error(NO_ACCESS)
  }
  const notSpam = (l: Lead) => {
    if (setLeadSpam(l.id, false)) toast.success('Moved out of quarantine')
    else toast.error(NO_ACCESS)
  }

  const isHot = (l: Lead) => isOpen(l) && !l.spam && (l.hot || (l.score ?? 0) >= HOT_SCORE)
  const hotMark = (
    <span className="inline-flex shrink-0 text-amber-700 dark:text-amber-400" title="Hot lead">
      <FireIcon size={13} aria-hidden />
      <span className="sr-only">Hot</span>
    </span>
  )

  /** Hot and reply-clock marks beside a lead: only what needs attention. */
  const marks = (l: Lead) => {
    const sla = slaState(l, now)
    const late = isOpen(l) && (sla === 'due_soon' || sla === 'breached')
    // A flame alone would add a line to the row for one glyph: it rides
    // along only where a company or a reply clock already makes that line.
    const hasLine = late || (!!l.company && l.company !== l.name)
    if (!late && !(isHot(l) && hasLine)) return null
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5">
        {isHot(l) && hotMark}
        {late && <SlaBadge lead={l} now={now} />}
      </span>
    )
  }

  /** What the enquiry asked for, on one line. */
  const wants = (l: Lead) => [
    l.company && l.company !== l.name ? l.company : '',
    (l.services ?? []).map((s) => serviceLabel(s)).join(', '),
    budgetBandLabel(l.budgetBand) ?? '',
  ].filter(Boolean).join(' · ')

  // The fields, shared by the table (md up) and the stacked rows (phones).
  const nameField = (l: Lead) => canEdit ? (
    <GhostText
      className="-ml-2 font-medium"
      data-lead-name={l.id}
      // Says whose name it is: nine fields all called "Lead name" tell a screen reader nothing.
      aria-label={`Lead name: ${l.name || 'unnamed'}`}
      dir="auto"
      title={l.name || undefined}
      value={l.name}
      onCommit={(name) => updateLead(l.id, { name })}
    />
  ) : (
    <span className="block truncate font-medium text-ink-50" title={l.name}>{l.name}</span>
  )

  const stageField = (l: Lead) => (
    <>
      <div className="flex items-center gap-1.5">
        <span className={classNames('size-2 shrink-0 rounded-full', STAGE_DOT[l.stage])} aria-hidden />
        {canEdit ? (
          <GhostSelect
            aria-label={`Stage: ${l.name || 'lead'}`}
            value={l.stage}
            // Anchored on the select itself, so focus comes back to it when the menu closes.
            onChange={(e) => onStageChange(l, e.target.value as LeadStage, e.currentTarget as unknown as HTMLElement)}
          >
            {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          </GhostSelect>
        ) : (
          <span className="text-ink-100">{STAGE_LABEL[l.stage]}</span>
        )}
      </div>
      {l.stage === 'lost' && l.lostReason && (
        <div className="mt-0.5 pl-3.5 text-[11px] text-ink-300">{LOST_REASON_LABEL[l.lostReason]}</div>
      )}
    </>
  )

  const valueField = (l: Lead) => canEdit ? (
    <ValueField
      value={l.value}
      label={`Value: ${l.name || 'lead'}`}
      onCommit={(value) => updateLead(l.id, { value })}
    />
  ) : (
    <span className="block tabular-nums text-ink-100">{fmtMoney(l.value)}</span>
  )

  const sourceField = (l: Lead) => canEdit ? (
    <GhostSelect
      aria-label={`Source: ${l.name || 'lead'}`}
      value={l.source}
      onChange={(e) => updateLead(l.id, { source: e.target.value as LeadSource })}
    >
      {SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
    </GhostSelect>
  ) : (
    <span className="text-ink-200">{SOURCE_LABEL[l.source]}</span>
  )

  const followUpField = (l: Lead) => canEdit ? (
    <FollowUpField
      value={l.followUp}
      label={`Follow-up: ${l.name || 'lead'}`}
      overdue={isOverdue(l)}
      onChange={(followUp) => { if (!setLeadFollowUp(l.id, followUp)) toast.error(NO_ACCESS) }}
    />
  ) : (
    <span className={classNames('tabular-nums', isOverdue(l) ? 'text-rose-700 dark:text-rose-400' : 'text-ink-300')}>
      {l.followUp ? fmtDate(l.followUp) : '—'}
    </span>
  )

  const lastTouch = (l: Lead, mono?: boolean) => !isOpen(l) ? (
    <span className="text-ink-400 text-xs">—</span>
  ) : (
    <span
      className={classNames(
        'tabular-nums whitespace-nowrap',
        mono ? 'text-[11px]' : 'text-xs',
        daysCold(l) >= g.staleDays ? 'text-amber-700 dark:text-amber-400' : 'text-ink-300',
      )}
      title={`Last touch ${fmtDate(g.lastTouchOf(l))}`}
    >
      {daysCold(l)}d ago · {g.touchesByLead.get(l.id) ?? 0}×
    </span>
  )

  // Holds the row order while a field inside has focus (see `held`).
  const holdOrder = {
    onFocus: () => { if (!held) setHeld(sorted.map((l) => l.id)) },
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(null)
    },
  }

  return (
    <section aria-labelledby="leads-board-title">
      <div className="flex items-end justify-between gap-3 mb-2.5">
        <div className="min-w-0">
          <h2 id="leads-board-title" className="text-display text-base font-semibold text-ink-50">Leads</h2>
          <p className="mt-0.5 text-xs text-ink-300">
            <span className="tabular-nums">{counts.all.toLocaleString()}</span> total · Growth’s own pipeline
          </p>
        </div>
        {canEdit && (
          <button className="btn-secondary px-2.5! py-1.5! pointer-coarse:min-h-11 text-xs shrink-0" onClick={add}>
            <PlusIcon size={14} aria-hidden /> Add lead
          </button>
        )}
      </div>

      {/* Inbox tabs: the active marker glides to the new tab (instant from the keyboard). */}
      <IndicatorGroup id="leads-tabs">
        <div className="mb-2.5 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5" role="group" aria-label="Filter leads">
          {TABS.map(([value, label]) => {
            const active = tab === value
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                className={classNames(
                  'chip pressable relative min-h-8 px-3 whitespace-nowrap pointer-coarse:min-h-11 pointer-coarse:px-3.5',
                  active
                    ? 'border-transparent text-brand-700 dark:text-brand-300'
                    : 'border-ink-600 text-ink-200 hover:text-ink-50 hover:border-ink-500',
                )}
                onClick={() => { setHeld(null); setTab(value) }}
              >
                {active && (
                  <LayoutIndicator
                    layoutId="leads-tabs"
                    radius={999}
                    className="absolute -inset-px border border-brand-500/35 bg-brand-500/12"
                  />
                )}
                <span className="relative inline-flex items-center gap-1.5">
                  {label}
                  <span className="tabular-nums text-[11px] opacity-75">{counts[value]}</span>
                </span>
              </button>
            )
          })}
        </div>
      </IndicatorGroup>

      <div className="card overflow-hidden">
        {sorted.length === 0 ? (
          // No leads at all is a blank slate with a next step; an empty tab is a
          // filter that matched nothing (the magnifier).
          <InlineEmpty
            title={TAB_EMPTY[tab].title}
            description={TAB_EMPTY[tab].description}
            glyph={tab === 'all' ? 'crm' : 'search-empty'}
            action={tab === 'all' && canEdit ? (
              <button type="button" className="btn-secondary pointer-coarse:min-h-11" onClick={add}>
                <PlusIcon size={16} aria-hidden /> Add lead
              </button>
            ) : undefined}
          />
        ) : tab === 'new' ? (
          // The inbox: read, then open. Soonest reply deadline first.
          <ul ref={attachStagger} className={classNames('divide-y divide-ink-600', staggerClass)}>
            {sorted.map((l) => (
              <li data-item-kind="lead" data-item-id={l.id} data-item-label={l.name} key={l.id}>
                <button
                  type="button"
                  className="pressable-card flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 ease-[ease] hover:bg-ink-700/40 focus-visible:bg-ink-700/40"
                  onClick={() => onOpen(l.id)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 truncate text-sm font-medium text-ink-50" dir="auto">{l.name || UNNAMED_LEAD}</span>
                      {isHot(l) && hotMark}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-ink-300" dir="auto">
                      {wants(l) || SOURCE_LABEL[l.source]}
                    </span>
                  </span>
                  {l.score !== undefined && (
                    <span className="hidden w-16 shrink-0 text-right text-xs text-ink-300 sm:block">
                      Score <span className="tabular-nums text-ink-50">{l.score}</span>
                    </span>
                  )}
                  <span className="flex shrink-0 flex-col items-end gap-1 sm:w-40">
                    <SlaBadge lead={l} now={now} />
                    <span className="whitespace-nowrap text-[11px] tabular-nums text-ink-300">{fmtRelative(l.createdAt)}</span>
                  </span>
                  <CaretRightIcon size={14} className="shrink-0 text-ink-400" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : tab === 'quarantine' ? (
          <>
            <p className="border-b border-ink-600 px-4 py-2.5 text-xs text-ink-300">
              Spam is deleted automatically after 30 days.
            </p>
            <ul className="divide-y divide-ink-600">
              {sorted.map((l) => (
                <li data-item-kind="lead" data-item-id={l.id} data-item-label={l.name} key={l.id} className="flex items-center gap-2 pr-3">
                  <button
                    type="button"
                    className="pressable-card min-w-0 flex-1 px-4 py-3 text-left transition-colors duration-150 ease-[ease] hover:bg-ink-700/40 focus-visible:bg-ink-700/40"
                    onClick={() => onOpen(l.id)}
                  >
                    <span className="block truncate text-sm font-medium text-ink-50" dir="auto">{l.name || UNNAMED_LEAD}</span>
                    <span className="mt-0.5 block truncate text-xs text-ink-300">
                      {spamReasonLabel(l.spamReason)} · <span className="tabular-nums">{fmtRelative(l.createdAt)}</span>
                      {l.email ? <> · <span dir="auto">{l.email}</span></> : null}
                    </span>
                  </button>
                  {canEdit && (
                    <>
                      <button
                        type="button"
                        className="btn-secondary shrink-0 px-2.5! py-1.5! text-xs pointer-coarse:min-h-11"
                        onClick={() => notSpam(l)}
                      >
                        Not spam
                      </button>
                      <button
                        type="button"
                        className={classNames(ROW_ACTION, 'shrink-0 hover:text-rose-600 dark:hover:text-rose-400')}
                        title="Delete"
                        aria-label={`Delete: ${l.name || 'lead'}`}
                        onClick={() => setPendingDelete(l)}
                      >
                        <TrashIcon size={16} aria-hidden />
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </>
        ) : phone ? (
          <ul ref={attachStagger} className={classNames('divide-y divide-ink-600', staggerClass)} {...holdOrder}>
            {sorted.map((l) => (
              <m.li
                key={l.id}
                data-item-kind="lead" data-item-id={l.id} data-item-label={l.name}
                layout={glide ? 'position' : false}
                transition={TWEEN.move}
                className="group/row px-4 pt-2 pb-2.5"
              >
                {/* Line 1: who (and how cold). Line 2: stage and value. Line 3: follow-up and source. */}
                <div className="flex items-start gap-1">
                  <div className="min-w-0 flex-1">
                    {nameField(l)}
                    <div className="flex items-center gap-2 text-xs text-ink-300">
                      {l.company && l.company !== l.name && (
                        <span className="min-w-0 truncate" title={l.company}>{l.company}</span>
                      )}
                      {l.clientId && <span className="badge badge-success shrink-0 text-[11px]">Client</span>}
                      <span className="shrink-0">{lastTouch(l, true)}</span>
                      {marks(l)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={classNames(ROW_ACTION, 'shrink-0', !canEdit && '-mr-2.5')}
                    aria-label={`Open lead: ${l.name || 'lead'}`}
                    onClick={() => onOpen(l.id)}
                  >
                    <ArrowsOutSimpleIcon size={18} aria-hidden />
                  </button>
                  {canEdit && (
                    <button
                      type="button"
                      className={classNames(ROW_ACTION, '-mr-2.5 shrink-0')}
                      aria-haspopup="menu"
                      aria-label={`Actions: ${l.name || 'lead'}`}
                      onClick={(e) => setMenu({ id: l.id, anchor: e.currentTarget })}
                    >
                      <DotsThreeIcon size={20} weight="bold" aria-hidden />
                    </button>
                  )}
                </div>
                {/* Each field under its caption (the controls carry their own names,
                    so the captions are for the eye). An editable field is pulled
                    left by its padding, so its text starts under the caption. */}
                <div className="mt-2 grid grid-cols-2 items-start gap-x-3 gap-y-1.5 text-sm">
                  <div className="min-w-0">
                    <span className={CARD_LABEL} aria-hidden>Stage</span>
                    {stageField(l)}
                  </div>
                  <div className="min-w-0">
                    <span className={CARD_LABEL} aria-hidden>Value</span>
                    <div className={canEdit ? '-ml-2' : undefined}>{valueField(l)}</div>
                  </div>
                  <div className="min-w-0">
                    <span className={CARD_LABEL} aria-hidden>Follow-up</span>
                    <div className={canEdit ? '-ml-2' : undefined}>{followUpField(l)}</div>
                  </div>
                  <div className="min-w-0">
                    <span className={CARD_LABEL} aria-hidden>Source</span>
                    <div className={classNames('flex', canEdit && '-ml-2')}>{sourceField(l)}</div>
                  </div>
                </div>
              </m.li>
            ))}
          </ul>
        ) : (
          // `relative`: the header's screen-reader-only label is absolutely placed,
          // and without a positioned scroller it escapes the clip and widens the page.
          <div className="@container relative overflow-x-auto overscroll-x-contain">
            {/* The six fixed columns take 53rem and the lead column what is left
                (11rem at the 64rem minimum). At 1440 the card is wider than the
                minimum, so nothing scrolls and nothing slides under the sticky column. */}
            <table className="w-full table-fixed text-sm min-w-[64rem] border-separate border-spacing-0">
              <thead>
                <tr className="text-left section-title text-[11px]">
                  <th className={classNames(TH, STICKY, 'pl-4 border-b border-ink-600')}>Lead</th>
                  <th className={classNames(TH, 'w-40 border-b border-ink-600')}>Stage</th>
                  <th className={classNames(TH, 'w-32 border-b border-ink-600')}>Value</th>
                  <th className={classNames(TH, 'w-32 border-b border-ink-600')}>Source</th>
                  <th className={classNames(TH, 'w-40 border-b border-ink-600')}>Follow-up</th>
                  <th className={classNames(TH, 'w-28 border-b border-ink-600')}>Last touch</th>
                  <th className={classNames(TH, 'w-40 pr-4 border-b border-ink-600 text-right')}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody ref={attachStagger} className={staggerClass} {...holdOrder}>
                {sorted.map((l) => {
                  const open = isOpen(l)
                  const cell = 'py-2 px-2 border-b border-ink-600 align-middle'
                  return (
                    <m.tr
                      key={l.id}
                      data-item-kind="lead" data-item-id={l.id} data-item-label={l.name}
                      layout={glide ? 'position' : false}
                      transition={TWEEN.move}
                      className="group/row [&:last-child>td]:border-b-0"
                    >
                      <td className={classNames(cell, STICKY, 'pl-4')}>
                        {nameField(l)}
                        {((l.company && l.company !== l.name) || marks(l)) && (
                          <div className="flex items-center gap-2 text-xs text-ink-300">
                            {l.company && l.company !== l.name && (
                              <span className="min-w-0 truncate" title={l.company}>{l.company}</span>
                            )}
                            {marks(l)}
                          </div>
                        )}
                      </td>
                      <td className={cell}>{stageField(l)}</td>
                      <td className={cell}>{valueField(l)}</td>
                      <td className={cell}><div className="flex">{sourceField(l)}</div></td>
                      <td className={cell}>{followUpField(l)}</td>
                      <td className={classNames(cell, 'whitespace-nowrap')}>{lastTouch(l)}</td>
                      <td className={classNames(cell, 'pr-4')}>
                        <div className="flex items-center justify-end gap-0.5 pointer-coarse:gap-1">
                          {l.clientId && <span className="badge badge-success mr-1 text-[11px]">Client</span>}
                          <button className={classNames(ROW_ACTION, 'hover:text-ink-50')} title="Open lead" aria-label={`Open lead: ${l.name || 'lead'}`} onClick={() => onOpen(l.id)}>
                            <ArrowsOutSimpleIcon size={16} aria-hidden />
                          </button>
                          {canEdit && open && (
                            <button className={classNames(ROW_ACTION, 'hover:text-brand-600 dark:hover:text-brand-400')} title="Log a touch (follow-up)" aria-label={`Log a touch: ${l.name || 'lead'}`} onClick={() => logTouch(l)}>
                              <PhoneCallIcon size={16} aria-hidden />
                            </button>
                          )}
                          {canConvertLead(l) && (
                            <button className={classNames(ROW_ACTION, 'hover:text-emerald-700 dark:hover:text-emerald-400')} title="Convert to client" aria-label={`Convert to client: ${l.name || 'lead'}`} onClick={() => setConverting(l)}>
                              <UserPlusIcon size={16} aria-hidden />
                            </button>
                          )}
                          {canEdit && (
                            <button className={classNames(ROW_ACTION, 'hover:text-rose-600 dark:hover:text-rose-400')} title="Delete lead" aria-label={`Delete lead: ${l.name || 'lead'}`} onClick={() => setPendingDelete(l)}>
                              <TrashIcon size={16} aria-hidden />
                            </button>
                          )}
                        </div>
                      </td>
                    </m.tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Popover
        anchor={askingReason?.anchor ?? null}
        onClose={() => setAskingReason(null)}
        role="menu"
        label="Why was it lost?"
      >
        {askingReason && (
          <>
            {LOST_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                role="menuitem"
                className={classNames(POPOVER_ROW, 'text-ink-100 hover:bg-ink-700 hover:text-ink-50')}
                onClick={() => { moveLeadStage(askingReason.lead.id, 'lost', r); setAskingReason(null) }}
              >
                {LOST_REASON_LABEL[r]}
              </button>
            ))}
            <button
              type="button"
              role="menuitem"
              className={classNames(POPOVER_ROW, 'mt-1 border-t border-ink-600 text-xs text-ink-300 hover:bg-ink-700 hover:text-ink-100')}
              onClick={() => setAskingReason(null)}
            >
              Cancel
            </button>
          </>
        )}
      </Popover>

      {/* Phones: the row actions, as a sheet. */}
      <Popover
        anchor={menuLead ? menu?.anchor ?? null : null}
        onClose={() => setMenu(null)}
        role="menu"
        align="right"
        label={menuLead?.name || UNNAMED_LEAD}
      >
        {menuLead && (
          <>
            {isOpen(menuLead) && (
              <MenuItem icon={PhoneCallIcon} label="Log a touch (follow-up)" onClick={() => { logTouch(menuLead); setMenu(null) }} />
            )}
            {canConvertLead(menuLead) && (
              <MenuItem icon={UserPlusIcon} label="Convert to client" onClick={() => { setConverting(menuLead); setMenu(null) }} />
            )}
            <MenuItem icon={TrashIcon} label="Delete lead" danger onClick={() => { setPendingDelete(menuLead); setMenu(null) }} />
          </>
        )}
      </Popover>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete lead"
        message={`Delete ${pendingDelete?.name || 'this lead'}? Its activity history goes with it.`}
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (!pendingDelete) return
          deleteLead(pendingDelete.id)
          toast.success('Lead deleted')
        }}
        onClose={() => setPendingDelete(null)}
      />

      <ConvertLeadModal lead={converting} onClose={() => setConverting(null)} />
    </section>
  )
}
