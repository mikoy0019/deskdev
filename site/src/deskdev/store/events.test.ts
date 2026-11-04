import { describe, expect, it } from 'vitest'
import { getEventOccurrences } from './useStore'
import type { EventItem } from '../lib/types'

// Local-time (no Z) strings so occurrence counts are deterministic across
// whatever timezone the test host runs in.
const base = (over: Partial<EventItem>): EventItem => ({
  id: 'e1',
  kind: 'event',
  title: 'E',
  startsAt: '2026-01-01T09:00:00',
  allDay: false,
  recurrence: 'none',
  createdAt: '',
  updatedAt: '',
  ...over,
})

describe('getEventOccurrences()', () => {
  it('returns a single non-recurring event inside the range', () => {
    const occ = getEventOccurrences([base({})], '2026-01-01T00:00:00', '2026-01-02T00:00:00')
    expect(occ).toHaveLength(1)
  })

  it('excludes events outside the range', () => {
    const occ = getEventOccurrences([base({})], '2026-02-01T00:00:00', '2026-02-05T00:00:00')
    expect(occ).toHaveLength(0)
  })

  it('materializes a daily recurrence across the window', () => {
    const occ = getEventOccurrences(
      [base({ recurrence: 'daily' })],
      '2026-01-01T00:00:00',
      '2026-01-05T23:59:59',
    )
    expect(occ).toHaveLength(5) // Jan 1..5
  })

  it('stops a recurrence at recurrenceUntil', () => {
    const occ = getEventOccurrences(
      [base({ recurrence: 'daily', recurrenceUntil: '2026-01-03' })],
      '2026-01-01T00:00:00',
      '2026-01-10T00:00:00',
    )
    expect(occ).toHaveLength(3) // Jan 1, 2, 3
  })

  it('gives every occurrence a stable, unique id', () => {
    const occ = getEventOccurrences(
      [base({ recurrence: 'weekly' })],
      '2026-01-01T00:00:00',
      '2026-01-31T23:59:59',
    )
    const ids = new Set(occ.map((o) => o.occurrenceId))
    expect(ids.size).toBe(occ.length)
  })
})
