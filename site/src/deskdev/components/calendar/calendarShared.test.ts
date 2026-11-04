import { describe, expect, it } from 'vitest'
import type { EventOccurrence } from '../../store/useStore'
import type { EventItem } from '../../lib/types'
import {
  DEFAULT_EVENT_COLOR, EVENT_COLORS, displayColor, firstLiveId, isLiveMeeting,
} from './calendarShared'

const at = (h: number, m = 0) => new Date(2026, 9, 3, h, m).toISOString()

function occ(id: string, over: Partial<EventItem> = {}, startsAt = at(10), endsAt: string | null = at(11)): EventOccurrence {
  const end = endsAt ?? undefined
  const event = {
    id, kind: 'meeting', title: id, allDay: false, recurrence: 'none',
    startsAt, endsAt: end, createdAt: at(0), updatedAt: at(0), ...over,
  } as EventItem
  return { occurrenceId: `${id}-0`, event, startsAt, endsAt: end } as EventOccurrence
}

describe('displayColor', () => {
  it('maps the legacy full-saturation palette to its calibrated twin', () => {
    expect(displayColor('#3b82f6')).toBe('#3e6de5')
    expect(displayColor('#F43F5E')).toBe('#d84d66')
  })
  it('passes custom colours through and defaults to brand blue', () => {
    expect(displayColor('#123456')).toBe('#123456')
    expect(displayColor(undefined)).toBe(DEFAULT_EVENT_COLOR)
    expect(EVENT_COLORS[0]).toBe(DEFAULT_EVENT_COLOR)
  })
})

describe('isLiveMeeting / firstLiveId', () => {
  const now = new Date(at(10, 30)).getTime()
  it('is live only between start and end of a timed meeting', () => {
    expect(isLiveMeeting(occ('a'), now)).toBe(true)
    expect(isLiveMeeting(occ('b', {}, at(11), at(12)), now)).toBe(false)
    expect(isLiveMeeting(occ('c', {}, at(9), at(10, 30)), now)).toBe(false)
  })
  it('never marks plain events, all-day items or open-ended meetings', () => {
    expect(isLiveMeeting(occ('e', { kind: 'event' }), now)).toBe(false)
    expect(isLiveMeeting(occ('f', { allDay: true }), now)).toBe(false)
    expect(isLiveMeeting(occ('g', {}, at(10), null), now)).toBe(false)
  })
  it('picks only the first live meeting to breathe', () => {
    const list = [occ('x', {}, at(8), at(9)), occ('y'), occ('z')]
    expect(firstLiveId(list, now)).toBe('y-0')
    expect(firstLiveId([], now)).toBeUndefined()
  })
})
