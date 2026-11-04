import { useMemo } from 'react'
import {
  eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, isToday,
  startOfMonth, startOfWeek,
} from 'date-fns'
import { RepeatIcon, VideoCameraIcon } from '@phosphor-icons/react'
import type { EventOccurrence } from '../../store/useStore'
import { classNames, isoDate } from '../../lib/format'
import { useMediaQuery } from '../../pwa/useMediaQuery'
import { eventColor, eventTint, groupByDay, isRecurring, TODAY_BG } from './calendarShared'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MAX_PILLS = 3
/** Below Tailwind's `sm` the cells show dots, not pills — the compact grid. */
const COMPACT_QUERY = '(max-width: 639.98px)'

/**
 * One event in a month cell. The event's colour is a tint and a leading rule;
 * the title stays in ink, so it reads at AA on every swatch in both themes
 * (amber or sky text on its own 15% tint did not).
 */
function OccurrencePill({
  occ, onClick,
}: {
  occ: EventOccurrence
  onClick: () => void
}) {
  const e = occ.event
  const color = eventColor(e)
  const meeting = e.kind === 'meeting'
  return (
    <button
      type="button"
      className="pressable w-full min-w-0 text-left flex items-center gap-1 pl-2 pr-1.5 py-[3px] rounded-[5px] text-[11px] leading-4 font-medium text-ink-50 hover:brightness-[0.97] dark:hover:brightness-125 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500"
      style={{
        backgroundColor: eventTint(color),
        boxShadow: `inset 2px 0 0 ${color}`,
      }}
      data-item-kind="calendar event" data-item-id={e.id} data-item-label={e.title}
      title={e.title}
      onClick={(ev) => {
        ev.stopPropagation()
        onClick()
      }}
    >
      {meeting && <VideoCameraIcon size={11} className="shrink-0 text-ink-200" aria-label="Meeting" />}
      {isRecurring(e) && <RepeatIcon size={11} className="shrink-0 text-ink-200" aria-label="Recurring" />}
      <span className="truncate">{e.title}</span>
    </button>
  )
}

/**
 * 7-column month grid — pills on desktop, dots + count on mobile.
 *
 * A compact cell is ~48px wide: its dots can't be told apart under a finger,
 * so there the whole cell is one button that opens the day (whose toolbar
 * creates on that date). Wider grids keep click-a-cell-to-create.
 */
export default function MonthGrid({
  cursor, occurrences, canCreate, onDayClick, onOccurrenceClick, onShowMore,
}: {
  cursor: Date
  occurrences: EventOccurrence[]
  canCreate: boolean
  onDayClick: (day: Date) => void
  onOccurrenceClick: (occ: EventOccurrence) => void
  onShowMore: (day: Date) => void
}) {
  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(startOfMonth(cursor)),
        end: endOfWeek(endOfMonth(cursor)),
      }),
    [cursor],
  )
  const byDay = useMemo(() => groupByDay(occurrences), [occurrences])
  const compact = useMediaQuery(COMPACT_QUERY)

  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-7 gap-px bg-ink-600">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="bg-ink-850 px-1 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-300"
          >
            {w}
          </div>
        ))}
        {days.map((day) => {
          const key = isoDate(day)
          const dayOccs = byDay.get(key) ?? []
          const inMonth = isSameMonth(day, cursor)
          const today = isToday(day)
          const weekend = day.getDay() === 0 || day.getDay() === 6
          const overflow = dayOccs.length - MAX_PILLS
          const count = dayOccs.length
          const interactive = compact || canCreate
          return (
            <div
              key={key}
              className={classNames(
                'min-w-0 min-h-[60px] sm:min-h-[112px] p-1 sm:p-1.5 transition-colors duration-150',
                !inMonth
                  ? 'bg-ink-900'
                  : today
                    ? TODAY_BG
                    : weekend
                      ? 'bg-ink-800 dark:bg-ink-850'
                      : 'bg-ink-800',
                interactive && 'cursor-pointer hover:bg-ink-700',
                compact &&
                  'active:bg-ink-700 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 select-none',
              )}
              onClick={
                compact ? () => onShowMore(day) : canCreate ? () => onDayClick(day) : undefined
              }
              {...(compact && {
                role: 'button',
                tabIndex: 0,
                'aria-label': `${format(day, 'EEEE, MMMM d')}${
                  count ? `, ${count} event${count === 1 ? '' : 's'}` : ''
                }`,
                onKeyDown: (e: React.KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onShowMore(day)
                  }
                },
              })}
            >
              <div className="flex justify-end sm:justify-start">
                <span
                  className={classNames(
                    'inline-flex items-center justify-center size-6 rounded-full text-[11px] tabular-nums',
                    today
                      ? 'bg-brand-600 text-white font-semibold shadow-(--shadow-1)'
                      : inMonth
                        ? 'text-ink-100'
                        : 'text-ink-300',
                  )}
                  {...(today && { 'aria-current': 'date' as const })}
                >
                  {day.getDate()}
                </span>
              </div>

              {/* Desktop: pills */}
              {dayOccs.length > 0 && (
                <div className="hidden sm:flex flex-col gap-[3px] mt-1">
                  {dayOccs.slice(0, MAX_PILLS).map((occ) => (
                    <OccurrencePill
                      key={occ.occurrenceId}
                      occ={occ}
                      onClick={() => onOccurrenceClick(occ)}
                    />
                  ))}
                  {overflow > 0 && (
                    <button
                      type="button"
                      className="pressable self-start rounded-sm px-2 py-0.5 text-[11px] font-medium tabular-nums text-ink-300 hover:text-ink-50 hover:bg-ink-700 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500"
                      onClick={(ev) => {
                        ev.stopPropagation()
                        onShowMore(day)
                      }}
                    >
                      +{overflow} more
                    </button>
                  )}
                </div>
              )}

              {/* Mobile: dots + count — a summary only; the cell itself is the target
                  (its label carries the count). */}
              {dayOccs.length > 0 && (
                <div
                  className="flex sm:hidden items-center justify-end w-full gap-0.5 mt-1 min-h-6"
                  aria-hidden
                >
                  {dayOccs.slice(0, 3).map((occ) => (
                    <span
                      key={occ.occurrenceId}
                      className="size-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: eventColor(occ.event) }}
                    />
                  ))}
                  {dayOccs.length > 3 && (
                    <span className="text-[10px] tabular-nums text-ink-300 leading-none">
                      +{dayOccs.length - 3}
                    </span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
