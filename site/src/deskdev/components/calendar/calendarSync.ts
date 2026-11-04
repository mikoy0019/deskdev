import type { EventItem } from '../../lib/types'

// Team calendar helpers for the event form and detail: time zones, the sync
// badge, guest addresses and the "Add to Google Calendar" link. Pure, so the
// rules are tested without a browser. The link follows googleTemplateUrl() in
// supabase/functions/google-calendar/mapping.ts; keep the two in step.

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(tz, f)
  }
  return f
}

/** A real IANA zone, as the database and Google require ('Asia/Tokyo', not 'JST+9'). */
export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false
  try {
    formatter(tz)
    return true
  } catch {
    return false
  }
}

/** The zone this browser plans in; UTC when it will not say. */
export function browserTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return isTimeZone(tz) ? tz : 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Every zone the browser knows, with `current` kept in the list even when it is an alias. */
export function timeZoneOptions(current?: string): string[] {
  let zones: string[] = []
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf
    zones = supported ? supported('timeZone') : []
  } catch {
    zones = []
  }
  const set = new Set(zones)
  set.add('UTC')
  if (current && isTimeZone(current)) set.add(current)
  return [...set].sort((a, b) => a.localeCompare(b))
}

interface WallTime { y: number; m: number; d: number; h: number; mi: number; s: number }

function wallTime(ms: number, tz: string): WallTime {
  const out: Record<string, number> = {}
  for (const p of formatter(tz).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value)
  }
  return { y: out.year, m: out.month, d: out.day, h: out.hour === 24 ? 0 : out.hour, mi: out.minute, s: out.second }
}

function offsetMinutes(ms: number, tz: string): number {
  const w = wallTime(ms, tz)
  const asUtc = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s)
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000)
}

function zonedToUtc(w: WallTime, tz: string): number {
  const naive = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s)
  const first = naive - offsetMinutes(naive, tz) * 60_000
  const second = naive - offsetMinutes(first, tz) * 60_000
  return Math.max(first, second)
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

function localDate(ms: number, tz: string): string {
  const w = wallTime(ms, tz)
  return `${pad(w.y, 4)}-${pad(w.m)}-${pad(w.d)}`
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

const basicDate = (date: string) => date.replace(/-/g, '')

function basicUtc(ms: number): string {
  const t = new Date(Math.floor(ms / 1000) * 1000)
  return `${pad(t.getUTCFullYear(), 4)}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}T${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}${pad(t.getUTCSeconds())}Z`
}

/** http(s) only: anything else (javascript:, data:, a bare host) is dropped. */
function webUrl(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  try {
    const u = new URL(s)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

const DEFAULT_DURATION_MINUTES = 60
const MAX_DESCRIPTION = 7000
const FREQ: Record<EventItem['recurrence'], string | null> = { none: null, daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY' }

type LinkEvent = Pick<
  EventItem,
  'title' | 'description' | 'startsAt' | 'endsAt' | 'allDay' | 'location' | 'meetingLink' | 'recurrence' | 'recurrenceUntil' | 'timezone' | 'addMeet'
>

/**
 * Google's own create form, prefilled: anyone can put the event in their own
 * calendar, with or without the team calendar. Times are UTC with the event's
 * zone as ctz, so the form shows the right local time and repeats in that
 * zone. Notes and the client never travel. null when the start is unreadable.
 */
export function googleTemplateUrl(e: LinkEvent, fallbackZone: string = browserTimeZone()): string | null {
  const startMs = Date.parse(e.startsAt)
  if (!Number.isFinite(startMs)) return null
  const tz = isTimeZone(e.timezone) ? e.timezone : isTimeZone(fallbackZone) ? fallbackZone : 'UTC'
  const endParsed = e.endsAt ? Date.parse(e.endsAt) : NaN

  let dates: string
  if (e.allDay) {
    // All-day is stored as local midnight → 23:59 of the last day; Google wants an exclusive end date.
    const first = localDate(startMs, tz)
    const last = Number.isFinite(endParsed) && endParsed > startMs ? localDate(endParsed, tz) : first
    dates = `${basicDate(first)}/${basicDate(addDays(last < first ? first : last, 1))}`
  } else {
    const endMs = Number.isFinite(endParsed) && endParsed > startMs ? endParsed : startMs + DEFAULT_DURATION_MINUTES * 60_000
    dates = `${basicUtc(startMs)}/${basicUtc(endMs)}`
  }

  const p = new URLSearchParams({ action: 'TEMPLATE', text: e.title.trim(), dates, ctz: tz })

  const link = webUrl(e.meetingLink)
  const isMeet = Boolean(link && /^https:\/\/meet\.google\.com\//.test(link))
  const parts: string[] = []
  const body = (e.description ?? '').trim()
  if (body) parts.push(body.length > MAX_DESCRIPTION ? `${body.slice(0, MAX_DESCRIPTION - 1)}…` : body)
  if (link && !(e.addMeet && isMeet)) parts.push(`Join: ${link}`)
  if (parts.length) p.set('details', parts.join('\n\n'))

  const loc = (e.location ?? '').trim() || link || ''
  if (loc) p.set('location', loc)

  const freq = FREQ[e.recurrence]
  if (freq) {
    let rule = `RRULE:FREQ=${freq}`
    const until = (e.recurrenceUntil ?? '').slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(until)) {
      const [y, m, d] = until.split('-').map(Number)
      // UNTIL is inclusive: the end of that day in the event's zone.
      rule += `;UNTIL=${e.allDay ? basicDate(until) : basicUtc(zonedToUtc({ y, m, d, h: 23, mi: 59, s: 59 }, tz))}`
    }
    p.set('recur', rule)
  }
  return `https://calendar.google.com/calendar/render?${p.toString()}`
}

/**
 * What the Calendar page knows about the shared Google calendar. 'unavailable'
 * = it cannot work on this build at all (local mode, 040 not applied, or the
 * status call failed). undefined while the answer is still on its way.
 */
export type TeamCalendarState = 'active' | 'revoked' | 'disconnected' | 'unavailable'

export type SyncBadgeTone = 'pending' | 'synced' | 'error' | 'offline'

export interface SyncBadge {
  tone: SyncBadgeTone
  label: string
  /** The short reason the push failed, when there is one. */
  detail?: string
}

/**
 * What to say about an event's place on the team calendar. null when it is
 * not shared there. A synced event with no status yet (just saved, or the
 * company account is not connected) reads as waiting; when the caller knows
 * the calendar is not active, it says so instead: nothing is on its way.
 */
export function syncBadge(
  e: Pick<EventItem, 'syncGoogle' | 'syncStatus' | 'syncError' | 'googleEventId'>,
  teamCalendar?: TeamCalendarState,
): SyncBadge | null {
  if (!e.syncGoogle) return null
  if (e.syncStatus === 'error') return { tone: 'error', label: 'Sync failed', detail: e.syncError?.trim() || undefined }
  if (e.syncStatus === 'synced') return { tone: 'synced', label: 'On team calendar' }
  if (teamCalendar && teamCalendar !== 'active') {
    return {
      tone: 'offline',
      label: 'Not connected',
      detail: teamCalendar === 'unavailable'
        ? 'The team calendar is not set up. Nothing was sent to Google.'
        : 'The team calendar is not connected. This is sent once an admin connects it.',
    }
  }
  return { tone: 'pending', label: 'Waiting to sync' }
}

const EMAIL_RE = /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]{2,}$/

/** One guest address, trimmed and lowercased, or null when it is not an address. */
export function guestEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase()
  return email.length <= 320 && EMAIL_RE.test(email) ? email : null
}

/** Splits a typed or pasted list ("a@x.co, b@y.co c@z.co") into good addresses and the rest. */
export function parseGuestInput(raw: string): { emails: string[]; rejected: string[] } {
  const emails: string[] = []
  const rejected: string[] = []
  for (const piece of raw.split(/[\s,;]+/)) {
    if (!piece) continue
    const email = guestEmail(piece)
    if (!email) rejected.push(piece)
    else if (!emails.includes(email)) emails.push(email)
  }
  return { emails, rejected }
}

export const RSVP_LABEL: Record<string, string> = {
  needsAction: 'No reply',
  accepted: 'Going',
  declined: 'Not going',
  tentative: 'Maybe',
}
