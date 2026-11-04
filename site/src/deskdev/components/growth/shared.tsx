import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useStore } from '../../store/useStore'
import { classNames, fmtDate, fmtMoney, fmtPercent, fmtNumber, isoDate } from '../../lib/format'
import { isOpenLead } from '../../lib/leads'
import type { Campaign, CampaignChannel, Lead, LeadActivity, LeadLostReason, LeadSource, LeadStage } from '../../lib/types'
import { CaretDownIcon, FireIcon, type Icon } from '@phosphor-icons/react'
import EmptyState from '../EmptyState'
import { SkeletonBlock, SkeletonLine } from '../ui-foundation'
import type { GlyphName } from '../ui-foundation/glyphs'

// ─── Stage / source / channel metadata ──────────────────────────────────────

export const STAGES: LeadStage[] = ['new', 'contacted', 'proposal', 'won', 'lost']
export const STAGE_LABEL: Record<LeadStage, string> = {
  new: 'New', contacted: 'Contacted', proposal: 'Proposal', won: 'Won', lost: 'Lost',
}
/** Bar fills for the funnel. One accent for the open stages; only the two
 *  outcomes carry a status colour (won / lost), so colour always means something. */
export const STAGE_COLOR: Record<LeadStage, string> = {
  new: 'rgb(var(--ink-400))', contacted: 'var(--color-brand-500)', proposal: 'var(--color-brand-500)',
  won: 'var(--color-emerald-500)', lost: 'var(--color-rose-500)',
}
export const SOURCES: LeadSource[] = ['seo', 'referral', 'linkedin', 'outbound', 'website', 'other']
export const SOURCE_LABEL: Record<LeadSource, string> = {
  seo: 'SEO', referral: 'Referral', linkedin: 'LinkedIn', outbound: 'Outbound', website: 'Website', other: 'Other',
}
export const CHANNEL_LABEL: Record<CampaignChannel, string> = {
  email: 'Email', linkedin: 'LinkedIn', cold_call: 'Cold call',
}

export const LOST_REASONS: LeadLostReason[] = [
  'no_decision', 'competitor', 'price', 'timing', 'unresponsive', 'other',
]
export const LOST_REASON_LABEL: Record<LeadLostReason, string> = {
  no_decision: 'No decision', competitor: 'Competitor', price: 'Price',
  timing: 'Timing', unresponsive: 'Went quiet', other: 'Other',
}
/** No-decision is amber: it's indecision to fix, not a clean loss, and the
 *  one reason worth singling out. The rest share the neutral bar. */
export const LOST_REASON_COLOR: Record<LeadLostReason, string> = {
  no_decision: 'var(--color-amber-500)', competitor: 'rgb(var(--ink-400))', price: 'rgb(var(--ink-400))',
  timing: 'rgb(var(--ink-400))', unresponsive: 'rgb(var(--ink-400))', other: 'rgb(var(--ink-400))',
}

/** `url` when it is an absolute http(s) URL, else undefined — for links built from imported data. */
export function httpUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined
  } catch {
    return undefined
  }
}

const COMPACT_MONEY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 })
const COMPACT_COUNT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

/** Money for a narrow stat cell: exact up to $999,999, then "$13.5M" — a
 *  figure is never clipped to "$13,485…". */
export function fmtMoneyFit(n: number): string {
  return Math.abs(n) >= 1_000_000 ? COMPACT_MONEY.format(n) : fmtMoney(n)
}

/** A count for a cramped caption: "1,284" exact, "1.3M" from a million up. */
export function fmtCountFit(n: number): string {
  return Math.abs(n) >= 1_000_000 ? COMPACT_COUNT.format(n) : fmtNumber(n)
}

/** What a lead with no name is called, everywhere it is listed. */
export const UNNAMED_LEAD = 'Unnamed lead'

export const isWon = (l: Lead) => l.stage === 'won'
export const isLost = (l: Lead) => l.stage === 'lost'

// ─── Viz primitives (hand-built — no charting lib) ──────────────────────────

const TONE = {
  brand: 'bg-brand-500', emerald: 'bg-emerald-500', amber: 'bg-amber-500', rose: 'bg-rose-500',
} as const

/**
 * A bar's fill: a full-width strip slid left by its empty share inside a
 * clipped track. Transform only (never a width animation), and the rounded
 * end stays round. A real change glides (180ms ease-in-out: something already
 * on screen moving); the first paint simply lands. Reduced motion: it jumps.
 */
function Fill({ pct, className, color }: { pct: number; className?: string; color?: string }) {
  return (
    <div
      className={classNames(
        'h-full w-full rounded-full transition-[transform,opacity] duration-(--dur-popover) ease-in-out',
        className,
      )}
      // At 0 the strip sits fully outside the track, but its anti-aliased
      // rounded edge can still bleed a pixel in: hide it outright.
      style={{ transform: `translateX(${pct - 100}%)`, opacity: pct > 0 ? 1 : 0, backgroundColor: color }}
    />
  )
}

/** Any non-zero share keeps a readable sliver, so "1 of 400" never vanishes. */
const sliver = (pct: number) => (pct <= 0 ? 0 : Math.max(3, Math.min(100, pct)))

export function Meter({
  value, max, tone = 'brand', label,
}: {
  value: number
  max: number
  tone?: keyof typeof TONE
  /** The meter's accessible name (the visible caption beside it). */
  label: string
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div
      className="h-1.5 rounded-full bg-ink-700 overflow-hidden"
      role="meter"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={Math.max(max, value)}
    >
      <Fill pct={sliver(pct)} className={TONE[tone]} />
    </div>
  )
}

export function RateBar({ label, ratio }: { label: string; ratio: number }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className="text-xs text-ink-300 truncate">{label}</span>
        <span className="text-xs tabular-nums text-ink-50">{fmtPercent(ratio)}</span>
      </div>
      <Meter value={Math.round(ratio * 100)} max={100} label={`${label} rate`} />
    </div>
  )
}

export function Bars({
  items, format = (n: number) => fmtNumber(n),
}: {
  items: { label: string; value: number; color?: string }[]
  format?: (n: number) => string
}) {
  const max = Math.max(1, ...items.map((i) => i.value))
  // A quiet line, like every other empty block in a Section (not a glyph tile).
  if (items.length === 0) return <p className="text-sm text-ink-300">No data yet</p>
  return (
    <ul className="space-y-3">
      {items.map((it) => (
        <li key={it.label}>
          <div className="flex items-baseline justify-between gap-3 mb-1.5">
            <span className="min-w-0 text-xs text-ink-200 truncate">{it.label}</span>
            <span className="shrink-0 text-xs tabular-nums text-ink-50">{format(it.value)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-ink-700 overflow-hidden" aria-hidden>
            <Fill
              pct={sliver(Math.round((it.value / max) * 100))}
              className={it.color ? undefined : 'bg-brand-500'}
              color={it.color}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

/**
 * Headline figures across the top of a Section: ruled cells, never boxes
 * inside the card. Bleeds to the card edge so the hairlines meet its border.
 */
export function Figures({
  items,
}: {
  items: { value: ReactNode; label: string; tone?: 'warn' }[]
}) {
  return (
    <dl
      className="-mx-(--card-p) -mt-(--card-p) mb-5 grid border-b border-ink-600 divide-x divide-ink-600"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((f) => (
        <div key={f.label} className="min-w-0 px-(--card-p) py-3.5 flex flex-col-reverse gap-1.5">
          <dt className="text-xs text-ink-300 truncate">{f.label}</dt>
          <dd
            className={classNames(
              'text-metric text-xl sm:text-2xl font-medium leading-none truncate',
              f.tone === 'warn' ? 'text-amber-700 dark:text-amber-400' : 'text-ink-50',
            )}
          >
            {f.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** A ruled list that runs edge to edge inside a Section card. */
export const SECTION_LIST = '-mx-(--card-p) divide-y divide-ink-600'
/** One row of a SECTION_LIST. */
export const SECTION_ROW = 'flex items-center gap-3 px-(--card-p) py-2.5 min-w-0'

/**
 * The shared EmptyState, flattened for use inside a card that already frames
 * it (a Section or the leads table) — no second border, shadow or surface.
 */
export function InlineEmpty({
  title, description, glyph = 'search-empty', action,
}: {
  title: string
  description?: string
  glyph?: GlyphName
  action?: React.ReactNode
}) {
  return (
    <EmptyState
      glyph={glyph}
      title={title}
      description={description}
      action={action}
      className="border-0! bg-transparent! shadow-none! py-6! px-2!"
    />
  )
}

/**
 * A titled block. The heading sits on the page (as on Home) and the content
 * in one card under it: no icon tile, no box inside a box.
 */
export function Section({
  icon: Icon, title, hint, action, children,
}: {
  icon: Icon
  title: string
  hint?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  const headingId = `growth-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return (
    <section aria-labelledby={headingId}>
      <div className="flex items-end justify-between gap-3 mb-2.5 min-w-0">
        <div className="min-w-0">
          <h2 id={headingId} className="flex items-center gap-2 text-display text-base font-semibold text-ink-50">
            <Icon size={16} className="shrink-0 text-ink-400" aria-hidden />
            <span className="truncate">{title}</span>
          </h2>
          {hint && <p className="mt-0.5 text-xs text-ink-300 text-pretty">{hint}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="card density-card overflow-hidden">{children}</div>
    </section>
  )
}

/** "Manage →" style link in a Section heading: 44px tall under a finger. */
export const SECTION_LINK =
  'inline-flex items-center gap-1 text-xs font-medium text-brand-700 dark:text-brand-400 hover:text-brand-600 dark:hover:text-brand-300 transition-colors duration-150 ease-[ease] pointer-coarse:-my-2.5 pointer-coarse:py-3.5 [-webkit-touch-callout:none]'

// ─── Clock ──────────────────────────────────────────────────────────────────

/**
 * Wall-clock time, re-read every `stepMs`. Rolling cutoffs ("7 days ago",
 * "days cold") need "now", and reading Date.now() during render is impure:
 * the value would differ between renders and never refresh on an open tab.
 */
export function useNow(stepMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), stepMs)
    return () => window.clearInterval(id)
  }, [stepMs])
  return now
}

// ─── Shared metrics hook (leads + campaigns) ────────────────────────────────

/**
 * Every Growth headline figure, from one snapshot. Pure, so the rules (what
 * counts as a lead, what a missing target means) are testable without a store.
 */
export function growthMetrics({
  now, leads: allLeads, leadActivity, campaigns, staleDays, monthlyTarget, weeklyTarget,
}: {
  now: number
  leads: Lead[]
  leadActivity: LeadActivity[]
  campaigns: Campaign[]
  staleDays: number
  /** Clients to win per month; undefined = no target set. */
  monthlyTarget: number | undefined
  weeklyTarget: number
}) {
  // Quarantined spam is not a lead: it stays out of every figure here, as it
  // does in Reports and in the inbox tabs (where it has its own tab). It is
  // kept (034: spam = true) so a false positive can be released.
  const leads = allLeads.filter((l) => !l.spam)
  const quarantined = allLeads.filter((l) => l.spam)
  const isOpen = isOpenLead
  const today = isoDate(new Date(now))
  const sevenDaysAgo = new Date(now - 7 * 864e5).toISOString()
  const weekAgoDay = isoDate(new Date(now - 7 * 864e5))
  const monthKey = today.slice(0, 7)

  const won = leads.filter(isWon)
  const lost = leads.filter(isLost)
  const open = leads.filter(isOpen)

  // Date wins by the 'won' EVENT, never by updatedAt: updatedAt is bumped by
  // any edit, so renaming a lead won in May used to re-date it into today's
  // month and silently inflate the goal meter. Leads with no won event (rows
  // predating the event log) fall back to updatedAt — the old, lossy behaviour.
  const wonEventMonth = new Map<string, string>()
  for (const a of leadActivity) {
    if (a.action === 'won') wonEventMonth.set(a.leadId, a.createdAt.slice(0, 7))
  }
  const wonMtd = won.filter((l) => (wonEventMonth.get(l.id) ?? l.updatedAt.slice(0, 7)) === monthKey)

  const newThisWeek = leads.filter((l) => l.createdAt >= sevenDaysAgo)
  const closed = won.length + lost.length

  // campaigns, current week
  const wk = campaigns.filter((c) => c.weekOf >= weekAgoDay)
  const sum = (k: 'contacted' | 'opens' | 'replies' | 'positive') => wk.reduce((s, c) => s + (c[k] || 0), 0)
  const contacted = sum('contacted')
  const replies = sum('replies')

  // source breakdown + ROI
  const count = new Map<LeadSource, number>()
  const roi = new Map<LeadSource, number>()
  for (const l of leads) {
    count.set(l.source, (count.get(l.source) ?? 0) + 1)
    if (isWon(l)) roi.set(l.source, (roi.get(l.source) ?? 0) + l.value)
  }
  const toItems = (map: Map<LeadSource, number>) =>
    [...map.entries()].map(([s, value]) => ({ label: SOURCE_LABEL[s], value })).sort((a, b) => b.value - a.value)

  const radar = leads
    .filter((l) => isOpen(l) && (l.hot || (l.followUp && l.followUp <= today)))
    .sort((a, b) => (a.followUp ?? '9999').localeCompare(b.followUp ?? '9999'))

  const funnel = STAGES.map((s) => ({ label: STAGE_LABEL[s], value: leads.filter((l) => l.stage === s).length, color: STAGE_COLOR[s] }))

  // ── Speed to lead: created → first response ──
  const responseMsList = leads
    .filter((l) => l.firstRespondedAt)
    .map((l) => new Date(l.firstRespondedAt as string).getTime() - new Date(l.createdAt).getTime())
    .filter((ms) => ms >= 0)
    .sort((a, b) => a - b)
  const medianResponseMs = responseMsList.length
    ? responseMsList[Math.floor(responseMsList.length / 2)]
    : null
  // Open leads nobody has replied to yet — the most actionable list on the page.
  const awaitingFirstReply = open
    .filter((l) => !l.firstRespondedAt)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  // ── Going cold: open leads untouched for longer than the threshold ──
  const staleCutoff = now - staleDays * 864e5
  const lastTouchOf = (l: Lead) => l.lastTouchAt ?? l.createdAt
  const goingCold = open
    .filter((l) => new Date(lastTouchOf(l)).getTime() < staleCutoff)
    .sort((a, b) => lastTouchOf(a).localeCompare(lastTouchOf(b)))

  // ── Touches per lead (persistence) ──
  const touchesByLead = new Map<string, number>()
  for (const a of leadActivity) {
    if (a.action === 'contacted' || a.action === 'note' || a.action === 'stage_changed') {
      touchesByLead.set(a.leadId, (touchesByLead.get(a.leadId) ?? 0) + 1)
    }
  }

  // ── Loss reasons (how much pipeline dies to indecision vs a competitor) ──
  const lossCount = new Map<LeadLostReason, number>()
  const lossValue = new Map<LeadLostReason, number>()
  for (const l of lost) {
    const r = l.lostReason ?? 'other'
    lossCount.set(r, (lossCount.get(r) ?? 0) + 1)
    lossValue.set(r, (lossValue.get(r) ?? 0) + l.value)
  }
  const lossReasons = [...lossCount.entries()]
    .map(([r, value]) => ({ label: LOST_REASON_LABEL[r], value, color: LOST_REASON_COLOR[r] }))
    .sort((a, b) => b.value - a.value)
  const noDecisionValue = lossValue.get('no_decision') ?? 0

  return {
    today,
    leads, quarantined, campaigns, leadActivity,
    medianResponseMs, awaitingFirstReply,
    goingCold, staleDays, lastTouchOf,
    touchesByLead,
    lossReasons, noDecisionValue,
    won, lost, open, wonMtd, newThisWeek,
    pipelineValue: open.reduce((s, l) => s + l.value, 0),
    wonValue: won.reduce((s, l) => s + l.value, 0),
    /** Value of wins dated to THIS month — pairs with wonMtd.length. */
    wonMtdValue: wonMtd.reduce((s, l) => s + l.value, 0),
    conversion: closed > 0 ? won.length / closed : 0,
    outbound: {
      contacted,
      openRate: contacted > 0 ? sum('opens') / contacted : 0,
      replyRate: contacted > 0 ? replies / contacted : 0,
      opens: sum('opens'),
      replies,
      positive: sum('positive'),
      positiveRate: replies > 0 ? sum('positive') / replies : 0,
    },
    sources: { breakdown: toItems(count), roi: toItems(roi) },
    radar,
    funnel,
    monthlyTarget,
    weeklyTarget,
    goalRatio: monthlyTarget && monthlyTarget > 0 ? wonMtd.length / monthlyTarget : 0,
  }
}

export function useGrowthMetrics() {
  const now = useNow()
  const leads = useStore((s) => s.leads)
  const leadActivity = useStore((s) => s.leadActivity)
  const campaigns = useStore((s) => s.campaigns)
  // The workspace's own Growth settings (038), not the browser-local mirror:
  // an empty target there means "no target", never a default.
  const staleDays = useStore((s) => s.workspaceSettings.growthStaleDays)
  const monthlyTarget = useStore((s) => s.workspaceSettings.growthMonthlyClientTarget)
  const weeklyTarget = useStore((s) => s.settings.weeklyOutreachTarget) ?? 50

  return useMemo(
    () => growthMetrics({ now, leads, leadActivity, campaigns, staleDays, monthlyTarget, weeklyTarget }),
    [now, leads, leadActivity, campaigns, staleDays, monthlyTarget, weeklyTarget],
  )
}

// ─── Inline-edit field ──────────────────────────────────────────────────────

/**
 * A table cell's input that reads as text until it is pointed at or focused:
 * hairline on hover, brand border + halo on focus. Keeps a dense editable grid
 * calm instead of a wall of boxed fields. 44px tall under a finger. A long
 * value ends in an ellipsis at rest; number fields drop the browser's spinner
 * (it ate a third of a narrow cell — arrow keys still step).
 */
export const GHOST_FIELD =
  'text-ellipsis [&[type=number]]:[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-ink-50 placeholder:text-ink-400 pointer-coarse:min-h-11 transition-[border-color,background-color,box-shadow] duration-150 ease-[ease] hover:border-ink-500 focus:outline-hidden focus:border-brand-500 focus:bg-ink-850 focus:ring-3 focus:ring-brand-500/20 disabled:opacity-60'

/**
 * The cue on a ghost field (a caret, a calendar): out of the way until its row
 * (`group/row`) is hovered or holds focus; always there under a finger, where
 * nothing hovers.
 */
export const GHOST_CUE =
  'pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 transition-opacity duration-150 ease-out pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100 pointer-fine:group-focus-within/row:opacity-100'

/** A ghost select: no native arrow, a 12px caret as its cue. */
export function GhostSelect({
  className, wrapClassName = 'flex-1', children, ...rest
}: React.ComponentProps<'select'> & {
  /** How the field sits in its row: fills it by default. */
  wrapClassName?: string
}) {
  return (
    <div className={classNames('relative min-w-0', wrapClassName)}>
      <select className={classNames(GHOST_FIELD, 'appearance-none pr-6', className)} {...rest}>
        {children}
      </select>
      <CaretDownIcon size={12} className={GHOST_CUE} aria-hidden />
    </div>
  )
}

/**
 * A ghost text field that saves when it is left (or on Enter), not on every
 * key: one write per edit, and a sorted list holds still while a name is
 * typed. Escape puts the old text back, and so does leaving it empty — a row
 * never ends up without a name.
 */
export function GhostText({
  value, onCommit, className, ...rest
}: Omit<React.ComponentProps<'input'>, 'value' | 'onChange' | 'onBlur' | 'onKeyDown'> & {
  value: string
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const settle = () => {
    const next = draft?.trim()
    if (next && next !== value) onCommit(next)
    setDraft(null)
  }
  return (
    <input
      {...rest}
      className={classNames(GHOST_FIELD, className)}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={settle}
      onKeyDown={(e) => {
        if (e.key === 'Enter') settle()
        if (e.key === 'Escape' && draft !== null) {
          // Only this edit is cancelled, not whatever else Escape would close.
          e.stopPropagation()
          setDraft(null)
        }
      }}
    />
  )
}

/** The largest count a ghost field keeps: a pasted 999999999999 is a slip, not a figure. */
const MAX_COUNT = 1_000_000

/**
 * A ghost count (whole, never negative, at most a million). The draft is text while it is typed,
 * so clearing the field leaves it empty instead of snapping to 0 (and "05" on
 * the next key); it saves on leaving or Enter. Left empty or unreadable, the
 * old number comes back.
 */
export function GhostCount({
  value, onCommit, className, ...rest
}: Omit<React.ComponentProps<'input'>, 'value' | 'onChange' | 'onBlur' | 'onKeyDown' | 'type'> & {
  value: number
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const settle = () => {
    const n = draft === null || draft.trim() === '' ? NaN : Number(draft)
    if (Number.isFinite(n)) {
      const next = Math.min(MAX_COUNT, Math.max(0, Math.round(n)))
      if (next !== value) onCommit(next)
    }
    setDraft(null)
  }
  return (
    <input
      {...rest}
      type="number"
      inputMode="numeric"
      min={0}
      max={MAX_COUNT}
      className={classNames(GHOST_FIELD, className)}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={settle}
      onKeyDown={(e) => {
        if (e.key === 'Enter') settle()
        if (e.key === 'Escape' && draft !== null) {
          e.stopPropagation()
          setDraft(null)
        }
      }}
    />
  )
}

// ─── Loading ────────────────────────────────────────────────────────────────

/** A stat cell while the store rehydrates (the StatStrip cell's own shape). */
export function StatCellSkeleton() {
  return (
    <div className="density-card max-sm:p-3 flex flex-col justify-between border-r border-b border-ink-600" aria-hidden>
      <div className="flex items-center justify-between">
        <SkeletonLine w="52%" className="h-3" />
        <SkeletonBlock w={16} h={16} rounded="md" />
      </div>
      <div className="mt-auto pt-2 sm:pt-4">
        <SkeletonBlock w={64} h={24} rounded="md" />
      </div>
    </div>
  )
}

/** A Section while loading: heading on the page, ruled rows in the card. */
export function SectionSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-hidden>
      <div className="mb-2.5 space-y-1.5">
        <SkeletonLine w={148} className="h-4" />
        <SkeletonLine w={208} className="h-3" />
      </div>
      <div className="card density-card space-y-4">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <div className="flex justify-between">
              <SkeletonLine w={`${30 + ((i * 17) % 35)}%`} className="h-3" />
              <SkeletonLine w={28} className="h-3" />
            </div>
            <SkeletonLine className="h-1.5" />
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Follow-up radar rows (Hub + Leads) ─────────────────────────────────────

/**
 * Overdue follow-ups + hot leads as ruled rows: name, then due date and stage.
 * With `onOpen`, a row opens that lead (the lead drawer).
 */
export function RadarList({
  leads, today, limit, onOpen,
}: { leads: Lead[]; today: string; limit?: number; onOpen?: (id: string) => void }) {
  const shown = limit ? leads.slice(0, limit) : leads
  return (
    <ul className={SECTION_LIST}>
      {shown.map((l) => {
        const overdue = !!l.followUp && l.followUp < today
        const body = (
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-sm text-ink-50 min-w-0">
              {/* A flag that is on: the one place this list uses the filled weight. */}
              {l.hot && <FireIcon size={14} weight="fill" className="shrink-0 text-rose-600 dark:text-rose-400" role="img" aria-label="Hot lead" />}
              <span className="truncate" dir="auto" title={l.name || undefined}>{l.name || UNNAMED_LEAD}</span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs">
              {l.followUp && (
                <span className={classNames('badge tabular-nums', overdue ? 'badge-danger' : 'badge-neutral')}>
                  {overdue ? 'Overdue' : 'Due'} {fmtDate(l.followUp)}
                </span>
              )}
              <span className="text-ink-300">{STAGE_LABEL[l.stage]}</span>
            </div>
          </div>
        )
        return onOpen ? (
          <li key={l.id}>
            <button
              type="button"
              onClick={() => onOpen(l.id)}
              className={classNames(
                SECTION_ROW,
                'w-full text-left transition-colors duration-150 ease-[ease] hover:bg-ink-700/40 active:bg-ink-700/70',
              )}
            >
              {body}
            </button>
          </li>
        ) : (
          <li key={l.id} className={SECTION_ROW}>{body}</li>
        )
      })}
    </ul>
  )
}
