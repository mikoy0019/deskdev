import { useMemo } from 'react'
import { eachDayOfInterval, endOfWeek, format, isToday, startOfWeek } from 'date-fns'
import { PlusIcon } from '@phosphor-icons/react'
import type { EventOccurrence } from '../../store/useStore'
import { classNames, isoDate } from '../../lib/format'
import {
  eventColor, eventTint, firstLiveId, groupByDay, isLiveMeeting, OccurrenceCard, TODAY_BG, useNow,
} from './calendarShared'

/**
 * 7-column week — all-day row on top, stacked occurrence cards per day.
 * Needs ~840px, so CalendarPage only offers it from the md breakpoint up.
 */
export default function WeekView({
  cursor, occurrences, canCreate, onDayClick, onOccurrenceClick,
}: {
  cursor: Date
  occurrences: EventOccurrence[]
  canCreate: boolean
  onDayClick: (day: Date) => void
  onOccurrenceClick: (occ: EventOccurrence) => void
}) {
  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(cursor),
        end: endOfWeek(cursor),
      }),
    [cursor],
  )
  const byDay = useMemo(() => groupByDay(occurrences), [occurrences])
  const hasAllDay = occurrences.some((o) => o.event.allDay)
  const now = useNow()
  const breatheId = firstLiveId(occurrences, now)

  return (
    <div className="card overflow-x-auto overscroll-x-contain">
      <div className="min-w-[840px]">
        {/* Day headers */}
        <div className="grid grid-cols-7 gap-px bg-ink-600 border-b border-ink-600">
          {days.map((day) => {
            const today = isToday(day)
            return (
              <div
                key={isoDate(day)}
                className={classNames(
                  'flex items-center justify-center gap-2 px-2 py-2.5',
                  today ? TODAY_BG : 'bg-ink-850',
                )}
                {...(today && { 'aria-current': 'date' as const })}
              >
                <span
                  className={classNames(
                    'text-[11px] font-semibold uppercase tracking-[0.06em]',
                    today ? 'text-brand-700 dark:text-brand-400' : 'text-ink-300',
                  )}
                >
                  {format(day, 'EEE')}
                </span>
                <span
                  className={classNames(
                    'inline-flex items-center justify-center size-7 rounded-full text-sm tabular-nums',
                    today
                      ? 'bg-brand-600 text-white font-semibold shadow-(--shadow-1)'
                      : 'text-ink-100',
                  )}
                >
                  {day.getDate()}
                </span>
              </div>
            )
          })}
        </div>

        {/* All-day row */}
        {hasAllDay && (
          <div className="grid grid-cols-7 gap-px bg-ink-600 border-b border-ink-600">
            {days.map((day) => {
              const allDay = (byDay.get(isoDate(day)) ?? []).filter((o) => o.event.allDay)
              return (
                <div key={isoDate(day)} className="min-w-0 bg-ink-800 p-1.5 space-y-1 min-h-[36px]">
                  {allDay.map((occ) => {
                    const color = eventColor(occ.event)
                    return (
                      <button
                        type="button"
                        key={occ.occurrenceId}
                        className="pressable block w-full truncate text-left pl-2 pr-1.5 py-[3px] rounded-[5px] text-[11px] leading-4 font-medium text-ink-50 hover:brightness-[0.97] dark:hover:brightness-125 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500"
                        style={{ backgroundColor: eventTint(color), boxShadow: `inset 2px 0 0 ${color}` }}
                        title={occ.event.title}
                        onClick={() => onOccurrenceClick(occ)}
                      >
                        {occ.event.title}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}

        {/* Timed occurrence columns */}
        <div className="grid grid-cols-7 gap-px bg-ink-600">
          {days.map((day) => {
            const timed = (byDay.get(isoDate(day)) ?? []).filter((o) => !o.event.allDay)
            return (
              <div
                key={isoDate(day)}
                className={classNames(
                  'min-w-0 flex flex-col gap-1.5 p-1.5 min-h-[300px]',
                  isToday(day) ? TODAY_BG : 'bg-ink-800',
                )}
              >
                {timed.map((occ) => (
                  <OccurrenceCard
                    key={occ.occurrenceId}
                    occ={occ}
                    dense
                    live={isLiveMeeting(occ, now)}
                    breathe={occ.occurrenceId === breatheId}
                    onClick={() => onOccurrenceClick(occ)}
                  />
                ))}
                {canCreate && (
                  <button
                    type="button"
                    className="pressable mt-auto w-full flex items-center justify-center gap-1 rounded-md py-1.5 pointer-coarse:py-2.5 text-[11px] font-medium text-ink-300 hover:text-ink-50 hover:bg-ink-700/70 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500"
                    aria-label={`Add an event on ${format(day, 'EEEE, MMMM d')}`}
                    onClick={() => onDayClick(day)}
                  >
                    <PlusIcon size={12} aria-hidden />
                    Add
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
