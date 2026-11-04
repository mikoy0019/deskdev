import { useEffect, useId, useState } from 'react'
import { CheckIcon, RepeatIcon, VideoCameraIcon } from '@phosphor-icons/react'
import { useStore, type EventOccurrence } from '../../store/useStore'
import { classNames, fmtTime, isoDate } from '../../lib/format'
import type { EventItem } from '../../lib/types'
import { Skeleton, StatusDot } from '../motion'

/**
 * Event swatches, calibrated: the same eight hues the calendar always offered,
 * pulled under 80% HSL saturation so they sit beside the brand accent instead
 * of shouting over it. Brand first (it is the default colour).
 */
export const EVENT_SWATCHES: readonly { value: string; name: string }[] = [
  { value: '#3e6de5', name: 'Blue' },
  { value: '#7c64d4', name: 'Violet' },
  { value: '#2b95c9', name: 'Sky' },
  { value: '#1f9e92', name: 'Teal' },
  { value: '#2a9d6e', name: 'Green' },
  { value: '#d4962b', name: 'Amber' },
  { value: '#dd7433', name: 'Orange' },
  { value: '#d84d66', name: 'Rose' },
]

/** Swatch values offered in the event and meeting forms. */
export const EVENT_COLORS: string[] = EVENT_SWATCHES.map((s) => s.value)

/** Brand blue — the colour of an event that has none. */
export const DEFAULT_EVENT_COLOR = EVENT_COLORS[0]

// Rows saved with the old full-saturation palette (and the mobile app, which
// still writes it) render as their calibrated twin, so a calendar never shows
// two blues. Any other value — a custom hex — passes through untouched.
const LEGACY_COLORS: Record<string, string> = {
  '#3b82f6': '#3e6de5',
  '#8b5cf6': '#7c64d4',
  '#0ea5e9': '#2b95c9',
  '#14b8a6': '#1f9e92',
  '#10b981': '#2a9d6e',
  '#f59e0b': '#d4962b',
  '#f97316': '#dd7433',
  '#f43f5e': '#d84d66',
}

// Cells sit on the grid's hairline colour (gap-px), so every cell fill must be
// opaque: a translucent tint would mix with the line colour and read grey.
// Today is the brand hue mixed into the card surface instead.
export const TODAY_BG = 'bg-[color-mix(in_srgb,var(--color-brand-500)_7%,rgb(var(--ink-800)))]'

/** A stored colour as it renders (legacy palette → calibrated swatch). */
export function displayColor(c?: string): string {
  if (!c) return DEFAULT_EVENT_COLOR
  return LEGACY_COLORS[c.toLowerCase()] ?? c
}

export function eventColor(e: EventItem): string {
  return displayColor(e.color)
}

/** Background tint of an event pill: the event's hue at 14% over the surface. */
export function eventTint(color: string, pct = 14): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`
}

export function isRecurring(e: EventItem): boolean {
  return e.recurrence !== 'none'
}

/** 'All day' or '9:00 AM – 10:30 AM' */
export function occTimeLabel(occ: EventOccurrence): string {
  if (occ.event.allDay) return 'All day'
  return `${fmtTime(occ.startsAt)}${occ.endsAt ? ` – ${fmtTime(occ.endsAt)}` : ''}`
}

/** Group occurrences by local calendar day ('YYYY-MM-DD' of startsAt). */
export function groupByDay(occs: EventOccurrence[]): Map<string, EventOccurrence[]> {
  const map = new Map<string, EventOccurrence[]>()
  for (const occ of occs) {
    const key = isoDate(occ.startsAt)
    const arr = map.get(key)
    if (arr) arr.push(occ)
    else map.set(key, [occ])
  }
  return map
}

/**
 * The current time, re-read every 30s — enough for "in progress" to switch on
 * and off at the right minute without re-rendering a view every second.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

/** A timed meeting happening right now (it has started and not yet ended). */
export function isLiveMeeting(occ: EventOccurrence, now: number): boolean {
  if (occ.event.kind !== 'meeting' || occ.event.allDay || !occ.endsAt) return false
  return new Date(occ.startsAt).getTime() <= now && now < new Date(occ.endsAt).getTime()
}

/**
 * The one occurrence in a list that gets the breathing "live" halo: the first
 * meeting in progress. Perpetual motion is reserved for live state, and only
 * once per region, so a second overlapping meeting gets a still dot.
 */
export function firstLiveId(occs: EventOccurrence[], now: number): string | undefined {
  return occs.find((o) => isLiveMeeting(o, now))?.occurrenceId
}

/** Stacked occurrence card used by the Week and Day views. */
export function OccurrenceCard({
  occ, onClick, dense, live, breathe,
}: {
  occ: EventOccurrence
  onClick: () => void
  /** Compact variant for week columns */
  dense?: boolean
  /** The meeting is in progress (a red dot beside the time). */
  live?: boolean
  /** This is the region's one breathing live marker. */
  breathe?: boolean
}) {
  const e = occ.event
  const color = eventColor(e)
  const client = useStore((s) =>
    e.clientId ? s.clients.find((c) => c.id === e.clientId) : undefined,
  )
  return (
    <button
      type="button"
      className={classNames(
        'pressable-card card-hover relative w-full text-left rounded-lg border border-ink-600 bg-ink-800 shadow-(--shadow-1)',
        'pl-3.5 pr-2.5 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500',
        dense ? 'py-2' : 'py-2.5',
      )}
      onClick={onClick}
    >
      {/* The event's colour as a rule down the leading edge, inset so the
          card's own hairline and radius stay intact. */}
      <span
        aria-hidden
        className="absolute left-1 inset-y-1.5 w-[3px] rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="flex items-center gap-1.5 tabular-nums text-[11px] text-ink-300">
        {live && <StatusDot tone="live" size="xs" breathe={breathe} label="In progress" />}
        {/* A week column is ~120px: the start time alone fits; the range is
            in the tooltip and the detail dialog. */}
        <span className="truncate" title={dense ? occTimeLabel(occ) : undefined}>
          {dense && !e.allDay ? fmtTime(occ.startsAt) : occTimeLabel(occ)}
        </span>
        {e.kind === 'meeting' && (
          <VideoCameraIcon size={12} className="shrink-0 text-ink-300" aria-label="Meeting" />
        )}
        {isRecurring(e) && (
          <RepeatIcon size={12} className="shrink-0 text-ink-300" aria-label="Recurring" />
        )}
      </span>
      <span
        className={classNames(
          'mt-0.5 block font-medium text-ink-50 [overflow-wrap:anywhere]',
          dense ? 'text-xs line-clamp-2' : 'text-sm line-clamp-2',
        )}
        title={e.title}
      >
        {e.title}
      </span>
      {!dense && (client || e.location) && (
        // Truncated at the card edge; the full line is in the tooltip and the detail dialog.
        <span
          className="mt-0.5 block truncate text-xs text-ink-300"
          title={[client?.name, e.location].filter(Boolean).join(' · ')}
        >
          {[client?.name, e.location].filter(Boolean).join(' · ')}
        </span>
      )}
    </button>
  )
}

export interface Swatch {
  value: string
  name: string
}

/** One colour-picker target: 36px for a mouse, 44px under a finger (tap-target). */
export const SWATCH_TARGET =
  'pressable tap-target relative inline-flex size-9 cursor-pointer items-center justify-center rounded-full'
/** The 28px dot inside it; set `--sw` to its colour so the chosen ring can use it. */
export const SWATCH_DOT =
  'inline-flex size-7 items-center justify-center rounded-full text-on-swatch ring-1 ring-inset ring-ink-900/10 transition-[box-shadow] duration-150 ease-[ease]'
export const SWATCH_DOT_ON = 'shadow-[0_0_0_2px_rgb(var(--ink-800)),0_0_0_4px_var(--sw)]'

/**
 * The colour picker of every form (events, meetings, clients, client
 * categories, CRM tables): real radio inputs (arrow keys move the choice, the
 * group has a name, each colour is announced by name), drawn as swatches. The
 * chosen one gets a ring in its own hue and a check, so it reads without
 * colour too. 28px dots in a 36px target, 44px under a finger.
 */
export function ColorSwatches({
  value, onChange, labelledBy, label = 'Color', swatches = EVENT_SWATCHES,
}: {
  value?: string
  onChange: (c: string) => void
  /** id of the visible "Color" label; without one the group is named by `label` */
  labelledBy?: string
  label?: string
  /** The palette to offer. Default: the event colours (legacy values map to their calibrated twin). */
  swatches?: readonly Swatch[]
}) {
  const name = useId()
  const current = swatches === EVENT_SWATCHES ? displayColor(value) : value
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      className={classNames(
        // Phones: two even rows (four or five across), never a stray one.
        '-mx-1 grid justify-start gap-x-2 gap-y-1 sm:flex sm:flex-wrap sm:items-center sm:gap-0.5',
        swatches.length > 8 ? 'grid-cols-[repeat(5,auto)]' : 'grid-cols-[repeat(4,auto)]',
      )}
    >
      {swatches.map((s) => {
        const selected = current === s.value
        return (
          <label
            key={s.value}
            className={classNames(SWATCH_TARGET, 'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500')}
          >
            <input
              type="radio"
              name={name}
              value={s.value}
              checked={selected}
              onChange={() => onChange(s.value)}
              aria-label={s.name}
              className="sr-only"
            />
            <span
              aria-hidden
              className={classNames(SWATCH_DOT, selected && SWATCH_DOT_ON)}
              style={{ backgroundColor: s.value, ['--sw' as string]: s.value }}
            >
              {selected && <CheckIcon size={14} aria-hidden />}
            </span>
          </label>
        )
      })}
    </div>
  )
}

// Which cells of the loading grid carry a placeholder pill, and how wide —
// fixed, so the skeleton is the same on every load (no random flicker).
const SKELETON_PILLS: Record<number, string[]> = {
  2: ['72%'], 4: ['58%', '80%'], 9: ['66%'], 11: ['84%'], 15: ['52%', '70%'],
  17: ['76%'], 22: ['62%'], 24: ['80%', '48%'], 29: ['68%'], 31: ['56%'],
}

/**
 * Loading state of the calendar, shaped like the view it stands in for: the
 * month grid (weekday header, 35 cells, a few pill bars) or the day list.
 */
export function CalendarSkeleton({ view }: { view: 'month' | 'week' | 'day' }) {
  if (view === 'day') {
    return (
      <div className="max-w-3xl space-y-5" aria-busy="true" aria-label="Loading calendar">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3">
            <div className="w-14 sm:w-16 shrink-0 pt-2.5 flex justify-end">
              <Skeleton w={34} h={10} rounded="sm" />
            </div>
            <div className="flex-1 min-w-0 border-l border-ink-600 pl-3">
              <div className="card px-3.5 py-3 space-y-2">
                <Skeleton w={96} h={10} rounded="sm" />
                <Skeleton w={i === 1 ? '64%' : '42%'} h={12} rounded="sm" />
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="card overflow-hidden" aria-busy="true" aria-label="Loading calendar">
      <div className="grid grid-cols-7 gap-px bg-ink-600">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={`h${i}`} className="bg-ink-850 px-2 py-2 flex justify-center">
            <Skeleton w={24} h={9} rounded="sm" />
          </div>
        ))}
        {Array.from({ length: 35 }, (_, i) => (
          <div key={i} className="bg-ink-800 min-h-[60px] sm:min-h-[112px] p-1.5 sm:p-2 space-y-1.5">
            <Skeleton w={14} h={10} rounded="sm" className="max-sm:ml-auto" />
            {(SKELETON_PILLS[i] ?? []).map((w, j) => (
              <Skeleton key={j} w={w} h={16} rounded="sm" className="max-sm:hidden" />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
