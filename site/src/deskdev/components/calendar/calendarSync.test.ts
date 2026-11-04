import { describe, expect, it } from 'vitest'
import { googleTemplateUrl, guestEmail, isTimeZone, parseGuestInput, syncBadge, timeZoneOptions } from './calendarSync'

const base = {
  title: 'Kickoff',
  startsAt: '2026-03-02T14:00:00.000Z',
  allDay: false,
  recurrence: 'none' as const,
}

const params = (url: string | null) => new URL(url ?? '').searchParams

describe('isTimeZone', () => {
  it('accepts IANA zones and refuses abbreviations and offsets', () => {
    expect(isTimeZone('Europe/Berlin')).toBe(true)
    expect(isTimeZone('UTC')).toBe(true)
    expect(isTimeZone('Mars/Olympus')).toBe(false)
    expect(isTimeZone('')).toBe(false)
    expect(isTimeZone(undefined)).toBe(false)
  })

  it('keeps the current zone in the picker list', () => {
    const zones = timeZoneOptions('Europe/Berlin')
    expect(zones).toContain('Europe/Berlin')
    expect(zones).toContain('UTC')
    expect(timeZoneOptions('Not/AZone')).not.toContain('Not/AZone')
  })
})

describe('googleTemplateUrl', () => {
  it('sends UTC times with the event zone as ctz, and a one-hour default end', () => {
    const p = params(googleTemplateUrl({ ...base, timezone: 'America/New_York' }))
    expect(p.get('action')).toBe('TEMPLATE')
    expect(p.get('text')).toBe('Kickoff')
    expect(p.get('dates')).toBe('20260302T140000Z/20260302T150000Z')
    expect(p.get('ctz')).toBe('America/New_York')
    expect(p.get('recur')).toBeNull()
  })

  it('falls back to the given zone when the event has none or a bad one', () => {
    expect(params(googleTemplateUrl(base, 'Asia/Tokyo')).get('ctz')).toBe('Asia/Tokyo')
    expect(params(googleTemplateUrl({ ...base, timezone: 'Nope' }, 'Asia/Tokyo')).get('ctz')).toBe('Asia/Tokyo')
    expect(params(googleTemplateUrl(base, 'Nope')).get('ctz')).toBe('UTC')
  })

  it('all-day events are dates with an exclusive end', () => {
    const p = params(googleTemplateUrl({
      ...base, allDay: true, timezone: 'UTC',
      startsAt: '2026-03-02T00:00:00.000Z', endsAt: '2026-03-03T23:59:00.000Z',
    }))
    expect(p.get('dates')).toBe('20260302/20260304')
  })

  it('repeats until the end of the last day in the event zone', () => {
    const p = params(googleTemplateUrl({
      ...base, timezone: 'America/New_York', recurrence: 'weekly', recurrenceUntil: '2026-06-30',
    }))
    // 23:59:59 in New York (UTC-4 in June) is 03:59:59 the next day in UTC.
    expect(p.get('recur')).toBe('RRULE:FREQ=WEEKLY;UNTIL=20260701T035959Z')
  })

  it('puts the join link in the details and the place, never notes', () => {
    const p = params(googleTemplateUrl({
      ...base, timezone: 'UTC', description: 'Agenda', meetingLink: 'https://zoom.us/j/1',
    }))
    expect(p.get('details')).toBe('Agenda\n\nJoin: https://zoom.us/j/1')
    expect(p.get('location')).toBe('https://zoom.us/j/1')
  })

  it('leaves a Meet link Google made out of the details, and drops other schemes', () => {
    const meet = params(googleTemplateUrl({ ...base, timezone: 'UTC', addMeet: true, meetingLink: 'https://meet.google.com/abc' }))
    expect(meet.get('details')).toBeNull()
    const bad = params(googleTemplateUrl({ ...base, timezone: 'UTC', meetingLink: 'javascript:alert(1)' }))
    expect(bad.get('details')).toBeNull()
    expect(bad.get('location')).toBeNull()
  })

  it('is null for an unreadable start', () => {
    expect(googleTemplateUrl({ ...base, startsAt: 'soon' })).toBeNull()
  })
})

describe('syncBadge', () => {
  it('says nothing for an event that is not shared', () => {
    expect(syncBadge({})).toBeNull()
    expect(syncBadge({ syncGoogle: false, syncStatus: 'synced' })).toBeNull()
  })

  it('reads the status the sync function wrote', () => {
    expect(syncBadge({ syncGoogle: true })?.tone).toBe('pending')
    expect(syncBadge({ syncGoogle: true, syncStatus: 'pending' })?.tone).toBe('pending')
    expect(syncBadge({ syncGoogle: true, syncStatus: 'synced' })?.tone).toBe('synced')
    expect(syncBadge({ syncGoogle: true, syncStatus: 'error', syncError: ' Bad time ' })).toEqual({
      tone: 'error', label: 'Sync failed', detail: 'Bad time',
    })
  })

  it('does not promise a sync when the team calendar is not active', () => {
    expect(syncBadge({ syncGoogle: true }, 'active')?.label).toBe('Waiting to sync')
    for (const state of ['unavailable', 'disconnected', 'revoked'] as const) {
      expect(syncBadge({ syncGoogle: true }, state)).toMatchObject({ tone: 'offline', label: 'Not connected' })
    }
    // What already happened still reads as it happened.
    expect(syncBadge({ syncGoogle: true, syncStatus: 'synced' }, 'disconnected')?.tone).toBe('synced')
    expect(syncBadge({ syncGoogle: false }, 'unavailable')).toBeNull()
  })
})

describe('guests', () => {
  it('normalises one address', () => {
    expect(guestEmail('  Ana@Example.COM ')).toBe('ana@example.com')
    expect(guestEmail('ana@example')).toBeNull()
    expect(guestEmail('ana example.com')).toBeNull()
  })

  it('splits a pasted list, drops repeats and reports what is not an address', () => {
    expect(parseGuestInput('a@x.co, b@y.co;A@x.co  nope')).toEqual({ emails: ['a@x.co', 'b@y.co'], rejected: ['nope'] })
    expect(parseGuestInput('   ')).toEqual({ emails: [], rejected: [] })
  })
})
