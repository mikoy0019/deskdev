// The google-calendar Edge Function's pure logic (supabase/functions/google-calendar/logic.ts):
// booking slots, recurrence expansion (in parity with the app's own), the
// Google event body and the request checks. index.ts only does I/O around these.

import { describe, expect, it } from 'vitest'
import {
  addDays,
  bearerToken,
  blocksBooking,
  bookingPayload,
  bookingSettingsFromRow,
  type BookingSettings,
  bookReason,
  busyFromEvents,
  busyFromFreeBusy,
  type ClaimedEvent,
  classifyGoogleError,
  constantTimeEqual,
  eventBody,
  expandOccurrences,
  generateSlots,
  googleEventId,
  isoWeekday,
  isSlotFree,
  isValidTimeZone,
  meetRequestId,
  meetUrlOf,
  parseAction,
  parseBookInput,
  retryDelayMinutes,
  rrule,
  sendUpdatesFor,
  slotOffered,
  zonedWallToUtc,
} from '../../../../supabase/functions/google-calendar/logic'
import { getEventOccurrences } from '../store/useStore'
import type { EventItem } from '../lib/types'

const Z = (iso: string) => Date.parse(iso)
const NY = 'America/New_York'
const enc = (s: string) => new TextEncoder().encode(s)

function settings(over: Partial<BookingSettings> = {}): BookingSettings {
  return {
    enabled: true,
    title: 'Discovery call',
    minutes: 60,
    noticeMinutes: 0,
    daysAhead: 2,
    bufferMinutes: 0,
    hostId: null,
    hours: { tz: NY, days: [1, 2, 3, 4, 5, 6, 7], start: '09:00', end: '12:00' },
    ...over,
  }
}

// ─── ids, backoff, request checks ───────────────────────────────────────────

describe('ids and backoff (mirrors of 040)', () => {
  it("googleEventId is 040's google_calendar_event_id: 'dd' + the uuid's hex, base32hex-safe", () => {
    const id = googleEventId('3F2B8C1E-9A4D-4C6B-8E2F-1A2B3C4D5E6F')
    expect(id).toBe('dd3f2b8c1e9a4d4c6b8e2f1a2b3c4d5e6f')
    expect(id).toMatch(/^[a-v0-9]{5,1024}$/)
  })

  it("retryDelayMinutes is google_sync_backoff: 1, 2, 4 … capped at 6 hours", () => {
    expect([1, 2, 3, 4, 9, 10, 20].map(retryDelayMinutes)).toEqual([1, 2, 4, 8, 256, 360, 360])
    expect(retryDelayMinutes(0)).toBe(1)
  })

  it('asks Google for one Meet per event, whatever the retries', () => {
    expect(meetRequestId('a-b')).toBe(meetRequestId('a-b'))
    expect(meetRequestId('a-b')).not.toBe(meetRequestId('a-c'))
  })
})

describe('request checks', () => {
  it('compares secrets in constant time, length included', () => {
    expect(constantTimeEqual(enc('secret'), enc('secret'))).toBe(true)
    expect(constantTimeEqual(enc('secret'), enc('secreT'))).toBe(false)
    expect(constantTimeEqual(enc('secret'), enc('secret2'))).toBe(false)
    expect(constantTimeEqual(enc(''), enc(''))).toBe(true)
  })

  it('reads a bearer token and the action', () => {
    expect(bearerToken('Bearer abc.def')).toBe('abc.def')
    expect(bearerToken('bearer   xyz ')).toBe('xyz')
    expect(bearerToken('Basic abc')).toBe('')
    expect(bearerToken(null)).toBe('')
    expect(parseAction({ action: 'drain' })).toBe('drain')
    expect(parseAction({ action: 'slots' })).toBe('slots')
    expect(parseAction({ action: 'book' })).toBe('book')
    expect(parseAction({ action: 'export' })).toBeNull()
    expect(parseAction(null)).toBeNull()
  })
})

// ─── time zones ─────────────────────────────────────────────────────────────

describe('time zones', () => {
  it('turns a wall clock into the instant, either side of a DST change', () => {
    // New York leaves daylight time at 02:00 on Sunday 1 November 2026.
    expect(zonedWallToUtc({ y: 2026, m: 10, d: 31, h: 9 }, NY)).toBe(Z('2026-10-31T13:00:00Z'))
    expect(zonedWallToUtc({ y: 2026, m: 11, d: 1, h: 9 }, NY)).toBe(Z('2026-11-01T14:00:00Z'))
    expect(zonedWallToUtc({ y: 2026, m: 10, d: 6, h: 9, mi: 30 }, 'Asia/Manila')).toBe(Z('2026-10-06T01:30:00Z'))
  })

  it('knows IANA names only', () => {
    expect(isValidTimeZone('Asia/Manila')).toBe(true)
    expect(isValidTimeZone('UTC')).toBe(true)
    expect(isValidTimeZone('UTC+8')).toBe(false)
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
    expect(isValidTimeZone(42)).toBe(false)
  })

  it('does civil-date arithmetic without a zone', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(isoWeekday('2026-11-01')).toBe(7)
    expect(isoWeekday('2026-11-02')).toBe(1)
  })
})

// ─── booking slots ──────────────────────────────────────────────────────────

describe('generateSlots', () => {
  it('follows the business hours in the studio zone across a DST change', () => {
    const days = generateSlots({ now: Z('2026-10-31T12:00:00Z'), settings: settings(), busy: [] })
    expect(days).toEqual([
      { date: '2026-10-31', slots: ['2026-10-31T13:00:00.000Z', '2026-10-31T14:00:00.000Z', '2026-10-31T15:00:00.000Z'] },
      // Same 09:00–12:00 wall clock, an hour later in UTC after the change.
      { date: '2026-11-01', slots: ['2026-11-01T14:00:00.000Z', '2026-11-01T15:00:00.000Z', '2026-11-01T16:00:00.000Z'] },
      // Nov 2 starts after now + 2 days: out of the window.
    ])
  })

  it('keeps the notice period', () => {
    const days = generateSlots({ now: Z('2026-10-31T13:30:00Z'), settings: settings({ noticeMinutes: 60 }), busy: [] })
    expect(days[0]).toEqual({ date: '2026-10-31', slots: ['2026-10-31T15:00:00.000Z'] })
  })

  it('ends the last slot by closing time', () => {
    const s = settings({ minutes: 45, hours: { tz: NY, days: [1, 2, 3, 4, 5, 6, 7], start: '09:00', end: '10:30' } })
    const [first] = generateSlots({ now: Z('2026-10-31T12:00:00Z'), settings: s, busy: [] })
    expect(first.slots).toEqual(['2026-10-31T13:00:00.000Z', '2026-10-31T13:45:00.000Z'])
  })

  it('skips closed weekdays', () => {
    const s = settings({ daysAhead: 4, hours: { tz: NY, days: [1, 2, 3, 4, 5], start: '09:00', end: '10:00' } })
    const days = generateSlots({ now: Z('2026-10-31T12:00:00Z'), settings: s, busy: [] })
    // Sat 31 Oct and Sun 1 Nov are closed.
    expect(days.map((d) => d.date)).toEqual(['2026-11-02', '2026-11-03'])
  })

  it('leaves out busy times, with the buffer either side', () => {
    const busy = [{ start: Z('2026-10-31T14:00:00Z'), end: Z('2026-10-31T14:30:00Z') }]
    const [first] = generateSlots({ now: Z('2026-10-31T12:00:00Z'), settings: settings({ bufferMinutes: 15 }), busy })
    // 13:00–14:00 sits within 15 minutes of the busy start; 14:00 overlaps it; 15:00 is clear by 30 minutes.
    expect(first.slots).toEqual(['2026-10-31T15:00:00.000Z'])
    expect(isSlotFree(Z('2026-10-31T15:00:00Z'), 60, 30, busy)).toBe(true)
    expect(isSlotFree(Z('2026-10-31T15:00:00Z'), 60, 31, busy)).toBe(false)
  })

  it('only books what it offered', () => {
    const days = generateSlots({ now: Z('2026-10-31T12:00:00Z'), settings: settings(), busy: [] })
    expect(slotOffered(days, Z('2026-11-01T14:00:00Z'))).toBe(true)
    expect(slotOffered(days, Z('2026-11-01T14:30:00Z'))).toBe(false)
  })
})

describe('bookingSettingsFromRow', () => {
  it('reads 048 + 033, and a row from before 048 as booking off', () => {
    expect(bookingSettingsFromRow({ growth_business_hours: { tz: 'Asia/Manila', days: [1, 2], start: '08:00', end: '17:00' } }))
      .toMatchObject({ enabled: false, minutes: 30, noticeMinutes: 240, daysAhead: 14, bufferMinutes: 10, title: 'Discovery call',
        hours: { tz: 'Asia/Manila', days: [1, 2], start: '08:00', end: '17:00' } })
    expect(bookingSettingsFromRow({
      booking_enabled: true, booking_minutes: 47, booking_days_ahead: 999, booking_title: '  Intro call  ',
      booking_host_id: 'u-1', growth_business_hours: { tz: 'Nope/Zone' },
    })).toMatchObject({ enabled: true, minutes: 45, daysAhead: 60, title: 'Intro call', hostId: 'u-1', hours: { tz: 'Asia/Manila' } })
  })
})

// ─── DeskDev busy ───────────────────────────────────────────────────────────

describe('DeskDev busy', () => {
  const HOST = 'host-1'
  it("blocks the host's own and invited events, and every website booking — never all-day events", () => {
    const attended = new Set(['e-3'])
    expect(blocksBooking({ id: 'e-1', starts_at: '', created_by: HOST }, HOST, attended)).toBe(true)
    expect(blocksBooking({ id: 'e-2', starts_at: '', created_by: 'someone' }, HOST, attended)).toBe(false)
    expect(blocksBooking({ id: 'e-3', starts_at: '', created_by: 'someone' }, HOST, attended)).toBe(true)
    expect(blocksBooking({ id: 'e-4', starts_at: '', booked_via: 'website' }, null, attended)).toBe(true)
    expect(blocksBooking({ id: 'e-5', starts_at: '', created_by: HOST, all_day: true }, HOST, attended)).toBe(false)
  })

  it('gives an event without an end the default 30 minutes', () => {
    const busy = busyFromEvents(
      [{ id: 'e', starts_at: '2026-10-31T14:00:00Z', ends_at: null, recurrence: 'none' }],
      { start: Z('2026-10-31T00:00:00Z'), end: Z('2026-11-02T00:00:00Z') },
      'UTC',
    )
    expect(busy).toEqual([{ start: Z('2026-10-31T14:00:00Z'), end: Z('2026-10-31T14:30:00Z') }])
  })

  it('repeats a daily meeting at the same wall clock across DST', () => {
    const starts = expandOccurrences(
      { id: 'e', starts_at: '2026-10-30T13:00:00Z', ends_at: '2026-10-30T13:30:00Z', recurrence: 'daily', timezone: NY },
      Z('2026-10-30T00:00:00Z'), Z('2026-11-03T00:00:00Z'), 'UTC',
    )
    expect(starts.map((t) => new Date(t).toISOString())).toEqual([
      '2026-10-30T13:00:00.000Z', '2026-10-31T13:00:00.000Z', '2026-11-01T14:00:00.000Z', '2026-11-02T14:00:00.000Z',
    ])
  })

  it('expands recurrences exactly like the app (getEventOccurrences) in the same zone', () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const local = (y: number, m: number, d: number, h: number) => new Date(y, m - 1, d, h, 0).toISOString()
    const cases: EventItem[] = [
      { id: 'd', kind: 'meeting', title: 'Daily', startsAt: local(2026, 3, 1, 10), endsAt: local(2026, 3, 1, 11), allDay: false, recurrence: 'daily', recurrenceUntil: '2026-03-20' } as EventItem,
      { id: 'w', kind: 'meeting', title: 'Weekly', startsAt: local(2026, 1, 5, 9), allDay: false, recurrence: 'weekly' } as EventItem,
      // Jan 31 + 1 month → Mar 3, and it keeps that day from there (the browser's setMonth).
      { id: 'm', kind: 'meeting', title: 'Monthly', startsAt: local(2026, 1, 31, 15), allDay: false, recurrence: 'monthly', recurrenceUntil: '2026-08-31' } as EventItem,
      { id: 'o', kind: 'event', title: 'Once', startsAt: local(2026, 4, 2, 8), endsAt: local(2026, 4, 2, 9), allDay: false, recurrence: 'none' } as EventItem,
    ]
    const from = local(2026, 2, 15, 0)
    const to = local(2026, 6, 30, 23)
    for (const ev of cases) {
      const app = getEventOccurrences([ev], from, to).map((o) => Date.parse(o.startsAt))
      const fn = expandOccurrences(
        { id: ev.id, starts_at: ev.startsAt, ends_at: ev.endsAt ?? null, recurrence: ev.recurrence, recurrence_until: ev.recurrenceUntil ?? null, timezone: tz },
        Date.parse(from), Date.parse(to), 'UTC',
      )
      expect(fn, ev.title).toEqual(app)
    }
  })

  it('reads Google freebusy, including primary keyed by the address', () => {
    const r = busyFromFreeBusy({
      calendars: {
        'team@group.calendar.google.com': { busy: [{ start: '2026-10-31T14:00:00Z', end: '2026-10-31T15:00:00Z' }] },
        'owner@gmail.com': { busy: [{ start: '2026-11-01T14:00:00Z', end: '2026-11-01T14:30:00Z' }, { start: 'bad', end: 'x' }] },
      },
    }, ['primary', 'team@group.calendar.google.com'])
    expect(r.failed).toEqual([])
    expect(r.busy).toHaveLength(2)
    const e = busyFromFreeBusy({ calendars: { primary: { errors: [{ reason: 'notFound' }] } } }, ['primary'])
    expect(e.failed).toEqual(['primary'])
  })
})

// ─── the Google event ───────────────────────────────────────────────────────

const booked: ClaimedEvent = {
  id: '3f2b8c1e-9a4d-4c6b-8e2f-1a2b3c4d5e6f',
  title: 'Discovery call — Maya Santos',
  description: 'Kalye Coffee Co.\n+63 917 555 0142',
  starts_at: '2026-11-02T14:00:00Z',
  ends_at: '2026-11-02T14:30:00Z',
  all_day: false,
  recurrence: 'none',
  timezone: NY,
  add_meet: true,
  sync_google: true,
  meeting_link: null,
  attendees: [
    { email: 'host@nixgen.test', display_name: 'Bryan', profile_id: 'p-1' },
    { email: 'maya@kalyecoffee.ph', display_name: 'Maya Santos', profile_id: null },
  ],
}

describe('eventBody', () => {
  it('builds the timed event with its zone, guests, Meet and the DeskDev id', () => {
    expect(eventBody(booked, { withId: true })).toEqual({
      id: 'dd3f2b8c1e9a4d4c6b8e2f1a2b3c4d5e6f',
      summary: 'Discovery call — Maya Santos',
      description: 'Kalye Coffee Co.\n+63 917 555 0142',
      location: '',
      start: { dateTime: '2026-11-02T14:00:00.000Z', timeZone: NY },
      end: { dateTime: '2026-11-02T14:30:00.000Z', timeZone: NY },
      recurrence: [],
      attendees: [
        { email: 'host@nixgen.test', displayName: 'Bryan' },
        { email: 'maya@kalyecoffee.ph', displayName: 'Maya Santos' },
      ],
      conferenceData: {
        createRequest: { requestId: meetRequestId(booked.id), conferenceSolutionKey: { type: 'hangoutsMeet' } },
      },
      extendedProperties: { private: { deskdevEventId: booked.id } },
    })
  })

  it("doesn't ask for Meet again once a link exists, and puts a typed link in the location", () => {
    expect(eventBody({ ...booked, meeting_link: 'https://meet.google.com/abc-defg-hij' }, { withId: false }).conferenceData).toBeUndefined()
    const zoom = eventBody({ ...booked, meeting_link: 'https://zoom.us/j/1' }, { withId: false })
    expect(zoom.conferenceData).toBeUndefined()
    expect(zoom.location).toBe('https://zoom.us/j/1')
    expect(zoom.id).toBeUndefined()
  })

  it('falls back to the default zone, and to 30 minutes without an end', () => {
    const b = eventBody({ ...booked, timezone: null, default_time_zone: 'Asia/Manila', ends_at: null }, { withId: false })
    expect(b.start).toEqual({ dateTime: '2026-11-02T14:00:00.000Z', timeZone: 'Asia/Manila' })
    expect(b.end).toEqual({ dateTime: '2026-11-02T14:30:00.000Z', timeZone: 'Asia/Manila' })
  })

  it('makes an all-day event with an exclusive end date', () => {
    const b = eventBody({ ...booked, all_day: true, starts_at: '2026-11-02T05:00:00Z', ends_at: '2026-11-03T05:00:00Z' }, { withId: false })
    expect(b.start).toEqual({ date: '2026-11-02' })
    expect(b.end).toEqual({ date: '2026-11-04' })
  })

  it('writes the RRULE with UNTIL at the end of that day in the zone, in UTC', () => {
    expect(rrule({ recurrence: 'weekly', recurrence_until: '2026-12-31', all_day: false }, NY))
      .toBe('RRULE:FREQ=WEEKLY;UNTIL=20270101T045959Z')
    expect(rrule({ recurrence: 'daily', recurrence_until: null, all_day: false }, NY)).toBe('RRULE:FREQ=DAILY')
    expect(rrule({ recurrence: 'monthly', recurrence_until: '2026-12-31', all_day: true }, NY)).toBe('RRULE:FREQ=MONTHLY;UNTIL=20261231')
    expect(rrule({ recurrence: 'none', recurrence_until: null, all_day: false }, NY)).toBeNull()
    expect(eventBody({ ...booked, recurrence: 'weekly', recurrence_until: '2026-12-31' }, { withId: false }).recurrence)
      .toEqual(['RRULE:FREQ=WEEKLY;UNTIL=20270101T045959Z'])
  })

  it('emails guests only when someone outside the team is invited', () => {
    expect(sendUpdatesFor(booked)).toBe('all')
    expect(sendUpdatesFor({ attendees: [{ email: 'a@x.co', profile_id: 'p' }] })).toBe('none')
    expect(sendUpdatesFor({ attendees: null })).toBe('none')
  })

  it("reads the Meet link Google attached", () => {
    expect(meetUrlOf({ hangoutLink: 'https://meet.google.com/abc-defg-hij' })).toBe('https://meet.google.com/abc-defg-hij')
    expect(meetUrlOf({ conferenceData: { entryPoints: [{ entryPointType: 'phone', uri: 'tel:+1' }, { entryPointType: 'video', uri: 'https://meet.google.com/x-y-z' }] } }))
      .toBe('https://meet.google.com/x-y-z')
    expect(meetUrlOf({ hangoutLink: 'https://evil.example/meet' })).toBeNull()
    expect(meetUrlOf(null)).toBeNull()
  })
})

describe('classifyGoogleError', () => {
  it('retries what passes, fails what will not, releases a token problem', () => {
    expect(classifyGoogleError(429, null).result).toBe('retry')
    expect(classifyGoogleError(503, null).result).toBe('retry')
    expect(classifyGoogleError(0, null).result).toBe('retry')
    expect(classifyGoogleError(403, { error: { errors: [{ reason: 'rateLimitExceeded' }] } }).result).toBe('retry')
    expect(classifyGoogleError(403, { error: { errors: [{ reason: 'forbiddenForNonOrganizer' }] } })).toEqual({
      result: 'failed', message: 'Google 403 forbiddenForNonOrganizer',
    })
    expect(classifyGoogleError(400, null).result).toBe('failed')
    expect(classifyGoogleError(401, null).result).toBe('release')
  })
})

// ─── the booking request ────────────────────────────────────────────────────

describe('book input', () => {
  it('accepts a booking and cleans it', () => {
    const input = parseBookInput({
      start: '2026-11-02T14:00:00.000Z', name: '  Maya\u0007 Santos ', email: 'maya@kalyecoffee.ph',
      notes: 'x'.repeat(3000), customer_tz: 'Asia/Manila', ip_hash: 'abc',
    })
    expect(input).toMatchObject({ start: Z('2026-11-02T14:00:00Z'), name: 'Maya Santos', email: 'maya@kalyecoffee.ph', customerTz: 'Asia/Manila', ipHash: 'abc' })
    expect(input!.notes).toHaveLength(2000)
    expect(bookingPayload(input!, 30)).toMatchObject({
      start: '2026-11-02T14:00:00.000Z', end: '2026-11-02T14:30:00.000Z', company: null, customer_tz: 'Asia/Manila',
    })
  })

  it('refuses what cannot be a booking', () => {
    expect(parseBookInput({ start: 'tomorrow', name: 'Maya', email: 'maya@kalye.ph' })).toBeNull()
    expect(parseBookInput({ start: '2026-11-02T14:00:00Z', name: '', email: 'maya@kalye.ph' })).toBeNull()
    expect(parseBookInput({ start: '2026-11-02T14:00:00Z', name: 'Maya', email: 'maya@' })).toBeNull()
    expect(parseBookInput({ start: '2026-11-02T14:00:00Z', name: 'Maya', email: 'maya@kalye.ph', customer_tz: 'UTC+8' })!.customerTz).toBeUndefined()
  })

  it("maps booking_record's refusals, anything unknown to 'unavailable'", () => {
    expect(bookReason('slot_taken')).toBe('slot_taken')
    expect(bookReason('throttled')).toBe('throttled')
    expect(bookReason('weird')).toBe('unavailable')
  })
})
