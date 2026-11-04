import { Fragment, useMemo } from 'react'
import { format, isToday, startOfHour } from 'date-fns'
import { PlusIcon } from '@phosphor-icons/react'
import type { EventOccurrence } from '../../store/useStore'
import { EmptyState } from '../ui-foundation'
import { fmtTime } from '../../lib/format'
import { firstLiveId, isLiveMeeting, OccurrenceCard, useNow } from './calendarShared'

/**
 * Chronological day list grouped by hour, with an all-day section on top.
 * On today, a hairline marks the current time between the hours.
 */
export default function DayView({
  day, occurrences, onOccurrenceClick, canCreate, onCreate, createLabel = 'New event',
}: {
  /** The day shown — today gets the current-time rule. */
  day?: Date
  occurrences: EventOccurrence[]
  onOccurrenceClick: (occ: EventOccurrence) => void
  canCreate?: boolean
  onCreate?: () => void
  /** What the empty day's button creates: 'New meeting' for meetings-only members. */
  createLabel?: string
}) {
  const now = useNow()
  const allDay = useMemo(
    () => occurrences.filter((o) => o.event.allDay),
    [occurrences],
  )
  const hourGroups = useMemo(() => {
    const map = new Map<number, EventOccurrence[]>()
    for (const occ of occurrences) {
      if (occ.event.allDay) continue
      const key = startOfHour(new Date(occ.startsAt)).getTime()
      const arr = map.get(key)
      if (arr) arr.push(occ)
      else map.set(key, [occ])
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0])
  }, [occurrences])
  const breatheId = firstLiveId(occurrences, now)

  if (occurrences.length === 0) {
    return (
      <EmptyState
        glyph="calendar"
        title="Nothing scheduled"
        description="No events or meetings on this day."
        action={
          canCreate && onCreate ? (
            <button className="btn-primary" onClick={onCreate}>
              <PlusIcon size={14} aria-hidden />
              {createLabel}
            </button>
          ) : undefined
        }
      />
    )
  }

  // Where the current-time rule goes: before the first hour that hasn't
  // started yet (or after the last one).
  const showNow = day ? isToday(day) && hourGroups.length > 0 : false
  const nowHour = startOfHour(now).getTime()
  const nowIndex = showNow ? hourGroups.findIndex(([h]) => h > nowHour) : -1
  const nowAt = showNow ? (nowIndex === -1 ? hourGroups.length : nowIndex) : -1
  const nowRule = (
    <div className="flex items-center gap-3" aria-hidden>
      <div className="w-14 sm:w-16 shrink-0 whitespace-nowrap text-right tabular-nums text-[11px] font-semibold text-rose-700 dark:text-rose-400">
        {fmtTime(new Date(now).toISOString())}
      </div>
      <div className="relative flex-1 h-px bg-rose-600/60 dark:bg-rose-400/60">
        <span className="absolute -left-[3px] -top-[3px] size-[7px] rounded-full bg-rose-600 dark:bg-rose-400" />
      </div>
    </div>
  )

  return (
    // Full width, like Month and Week: capped at 768px it left the right third
    // of the page empty under a full-width toolbar.
    <div className="space-y-5">
      {allDay.length > 0 && (
        <section>
          <h2 className="section-title mb-2">All day</h2>
          <div className="space-y-2">
            {allDay.map((occ) => (
              <OccurrenceCard
                key={occ.occurrenceId}
                occ={occ}
                onClick={() => onOccurrenceClick(occ)}
              />
            ))}
          </div>
        </section>
      )}

      {hourGroups.map(([hour, occs], i) => (
        <Fragment key={hour}>
          {i === nowAt && nowRule}
          <div className="flex gap-3">
            {/* "12:45 PM" (the now rule) fits in 56px; 64px once there is room to spare. */}
            <div className="w-14 sm:w-16 shrink-0 pt-2.5 text-right tabular-nums text-[11px] font-medium text-ink-300">
              {format(hour, 'h a')}
            </div>
            <div className="flex-1 min-w-0 space-y-2 border-l border-ink-600 pl-3">
              {occs.map((occ) => (
                <OccurrenceCard
                  key={occ.occurrenceId}
                  occ={occ}
                  live={isLiveMeeting(occ, now)}
                  breathe={occ.occurrenceId === breatheId}
                  onClick={() => onOccurrenceClick(occ)}
                />
              ))}
            </div>
          </div>
        </Fragment>
      ))}
      {nowAt === hourGroups.length && nowRule}
    </div>
  )
}
