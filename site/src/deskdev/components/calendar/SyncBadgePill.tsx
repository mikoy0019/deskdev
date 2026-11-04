import { ArrowsClockwiseIcon, CheckIcon, PlugsIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { classNames } from '../../lib/format'
import type { EventItem } from '../../lib/types'
import { syncBadge, type SyncBadgeTone, type TeamCalendarState } from './calendarSync'

const TONE: Record<SyncBadgeTone, string> = {
  synced: 'badge-success',
  pending: 'badge-neutral',
  error: 'badge-danger',
  offline: 'badge-neutral',
}

const GLYPH = { synced: CheckIcon, pending: ArrowsClockwiseIcon, error: WarningCircleIcon, offline: PlugsIcon } as const

/**
 * Where an event stands on the team calendar: an icon and words, so the state
 * never rests on colour. Renders nothing for an event that is not shared.
 */
export function SyncBadgePill({
  event, teamCalendar, className,
}: {
  event: Pick<EventItem, 'syncGoogle' | 'syncStatus' | 'syncError' | 'googleEventId'>
  /** When known and not active, an unsent event reads "Not connected", not "Waiting to sync". */
  teamCalendar?: TeamCalendarState
  className?: string
}) {
  const badge = syncBadge(event, teamCalendar)
  if (!badge) return null
  const Glyph = GLYPH[badge.tone]
  return (
    <span className={classNames('badge shrink-0 whitespace-nowrap', TONE[badge.tone], className)} title={badge.detail}>
      <Glyph size={11} aria-hidden />
      {badge.label}
    </span>
  )
}
