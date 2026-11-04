// DeskDev Studio — google-calendar: the booking page's pure logic.
//
// What DECIDES for the booking page (migration 048) lives here — time zones,
// booking settings, free slots, recurrence expansion, Google free/busy, the
// book request — with no Deno, npm or env access, so the site's Vitest suite
// imports this file directly (site/src/deskdev/pwa/googleCalendarLogic.test.ts).
// index.ts does the I/O.
//
// The Team Calendar push (040's drain) is NOT decided here: index.ts runs
// worker.ts, which maps events with mapping.ts (040's mirror of
// google_calendar_event_id() and google_sync_backoff(), tested under Node).
// The sections marked "unused by the function" below are this file's own
// copy of that drain and its request checks, written in parallel with
// worker.ts / mapping.ts. The function no longer calls them; they stay only
// while googleCalendarLogic.test.ts still tests them. Remove both together.
//
// Mirrors kept in step on purpose:
//   expandOccurrences  ↔ site/src/deskdev/store/useStore.ts getEventOccurrences
//                        (same stepping, in the event's zone instead of the browser's)
//   blocksBooking      ↔ 048 booking_overlaps() (which events block the host)

// ---------------------------------------------------------------- constants

// Unused by the function (mapping.ts's TEAM_CALENDAR_NAME names the calendar).
export const TEAM_CALENDAR_NAME = 'NixGen Team'
export const TEAM_CALENDAR_DESCRIPTION = 'Meetings and events from DeskDev Studio. Managed by DeskDev: edit them there.'
/** An event saved without an end still blocks booking for this long (048's booking_overlaps: 30 minutes). */
export const DEFAULT_EVENT_MINUTES = 30
const MINUTE = 60_000
const DAY = 86_400_000

// ---------------------------------------------------------------- ids and backoff
// Unused by the function: mapping.ts holds 040's mirrors.

/** The id Google stores a DeskDev event under: 'dd' + the uuid's hex (base32hex-safe). */
export function googleEventId(eventId: string): string {
  return `dd${eventId.replace(/-/g, '').toLowerCase()}`
}

/** 1, 2, 4 … minutes, capped at 6 hours (040's google_sync_backoff). */
export function retryDelayMinutes(attempts: number): number {
  return Math.min(360, 2 ** (Math.max(1, Math.floor(attempts || 1)) - 1))
}

/**
 * The Meet createRequest id. Deterministic per event, so a retried insert or a
 * later patch never asks Google for a second conference.
 */
export function meetRequestId(eventId: string): string {
  return `dd-meet-${eventId.replace(/-/g, '').toLowerCase()}`
}

// ---------------------------------------------------------------- request auth + shape
// Unused by the function: index.ts compares secrets with sameSecret and
// routes on the x-booking-secret header.

/** Constant-time byte compare (callers hash both sides first, so length leaks nothing either). */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

/** "Bearer <token>" → token; anything else → ''. */
export function bearerToken(header: string | null | undefined): string {
  const m = /^Bearer\s+(.+)$/i.exec((header ?? '').trim())
  return m ? m[1].trim() : ''
}

export type Action = 'drain' | 'slots' | 'book'

export function parseAction(body: unknown): Action | null {
  const a = (body as { action?: unknown } | null)?.action
  return a === 'drain' || a === 'slots' || a === 'book' ? a : null
}

// ---------------------------------------------------------------- time zones

/** IANA names only (040's is_valid_time_zone shape), and one the runtime knows. */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length > 64 || !/^(UTC|[A-Za-z]+(\/[A-Za-z0-9_+-]+){1,2})$/.test(tz)) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export interface Wall {
  y: number
  /** 1–12 */
  m: number
  d: number
  h: number
  mi: number
  s: number
}

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

/** The wall clock in `tz` at an instant (ms). */
export function wallInZone(instant: number, tz: string): Wall {
  const parts: Record<string, string> = {}
  for (const p of formatter(tz).formatToParts(new Date(instant))) parts[p.type] = p.value
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    // Some engines still print midnight as "24" under h23.
    h: Number(parts.hour) % 24,
    mi: Number(parts.minute),
    s: Number(parts.second),
  }
}

/** How far `tz` is ahead of UTC at an instant, in ms (Manila → +8 h). */
export function tzOffsetMs(instant: number, tz: string): number {
  const w = wallInZone(instant, tz)
  const whole = instant - (((instant % 1000) + 1000) % 1000)
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - whole
}

/**
 * The instant a wall-clock time in `tz` happens. Two passes settle the offset
 * either side of a DST change; a time skipped by the change lands just after
 * it, an ambiguous one on its first occurrence.
 */
export function zonedWallToUtc(w: Pick<Wall, 'y' | 'm' | 'd'> & Partial<Pick<Wall, 'h' | 'mi' | 's'>>, tz: string): number {
  const guess = Date.UTC(w.y, w.m - 1, w.d, w.h ?? 0, w.mi ?? 0, w.s ?? 0)
  const first = tzOffsetMs(guess, tz)
  let t = guess - first
  const second = tzOffsetMs(t, tz)
  if (second !== first) t = guess - second
  return t
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** 'YYYY-MM-DD' of an instant in `tz`. */
export function isoDateInZone(instant: number, tz: string): string {
  const w = wallInZone(instant, tz)
  return `${pad(w.y, 4)}-${pad(w.m)}-${pad(w.d)}`
}

function parseDate(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number)
  return { y, m, d }
}

/** A civil date plus n days (no zone involved). */
export function addDays(date: string, n: number): string {
  const { y, m, d } = parseDate(date)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/** ISO weekday of a civil date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const { y, m, d } = parseDate(date)
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return js === 0 ? 7 : js
}

function parseHhMm(v: string): { h: number; mi: number } | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v)
  return m ? { h: Number(m[1]), mi: Number(m[2]) } : null
}

// ---------------------------------------------------------------- booking settings

export interface BusinessHours {
  tz: string
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  days: number[]
  start: string
  end: string
}

export interface BookingSettings {
  enabled: boolean
  title: string
  minutes: number
  noticeMinutes: number
  daysAhead: number
  bufferMinutes: number
  hostId: string | null
  hours: BusinessHours
}

const DEFAULT_HOURS: BusinessHours = { tz: 'Asia/Manila', days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' }

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
}

/**
 * workspace_settings (033 + 048) → what the booking page works with. The
 * database CHECKs already hold these bounds; clamping again means a row from
 * before 048 (no booking_* columns) reads as "booking off" with defaults.
 */
export function bookingSettingsFromRow(row: Record<string, unknown> | null | undefined): BookingSettings {
  const r = row ?? {}
  const h = (r.growth_business_hours ?? {}) as Partial<BusinessHours>
  const days = Array.isArray(h.days) ? h.days.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7) : []
  const hours: BusinessHours = {
    tz: isValidTimeZone(h.tz) ? h.tz : DEFAULT_HOURS.tz,
    days: days.length ? [...new Set(days)].sort() : DEFAULT_HOURS.days,
    start: typeof h.start === 'string' && parseHhMm(h.start) ? h.start : DEFAULT_HOURS.start,
    end: typeof h.end === 'string' && parseHhMm(h.end) ? h.end : DEFAULT_HOURS.end,
  }
  const minutes = clampInt(r.booking_minutes, 15, 180, 30)
  const title = typeof r.booking_title === 'string' && r.booking_title.trim() ? r.booking_title.trim().slice(0, 80) : 'Discovery call'
  return {
    enabled: r.booking_enabled === true,
    title,
    minutes: minutes - (minutes % 5),
    noticeMinutes: clampInt(r.booking_notice_minutes, 0, 20160, 240),
    daysAhead: clampInt(r.booking_days_ahead, 1, 60, 14),
    bufferMinutes: clampInt(r.booking_buffer_minutes, 0, 120, 10),
    hostId: typeof r.booking_host_id === 'string' && r.booking_host_id ? r.booking_host_id : null,
    hours,
  }
}

// ---------------------------------------------------------------- slots

export interface Interval {
  /** ms since epoch, inclusive */
  start: number
  /** ms since epoch, exclusive */
  end: number
}

export interface BookingDay {
  date: string
  /** ISO UTC starts, ascending. */
  slots: string[]
}

/** The range availability has to cover (busy times are read for exactly this). */
export function slotWindow(now: number, s: Pick<BookingSettings, 'daysAhead' | 'bufferMinutes'>): Interval {
  return { start: now - s.bufferMinutes * MINUTE, end: now + (s.daysAhead + 1) * DAY + s.bufferMinutes * MINUTE }
}

/** Free when [start − buffer, end + buffer) touches no busy interval. */
export function isSlotFree(start: number, minutes: number, bufferMinutes: number, busy: readonly Interval[]): boolean {
  const from = start - bufferMinutes * MINUTE
  const to = start + (minutes + bufferMinutes) * MINUTE
  return busy.every((b) => b.end <= from || b.start >= to)
}

/**
 * Bookable starts: every business day in the studio's zone, from now +
 * notice to now + daysAhead days, every `minutes` from opening while the slot
 * still ends by closing, minus anything busy (with the buffer either side).
 * Days without a free slot are left out.
 */
export function generateSlots(input: { now: number; settings: BookingSettings; busy: readonly Interval[] }): BookingDay[] {
  const { now, settings, busy } = input
  const { hours, minutes, noticeMinutes, daysAhead, bufferMinutes } = settings
  const open = parseHhMm(hours.start)
  const close = parseHhMm(hours.end)
  if (!open || !close || minutes <= 0) return []
  const earliest = now + noticeMinutes * MINUTE
  const latest = now + daysAhead * DAY
  const today = isoDateInZone(now, hours.tz)
  const out: BookingDay[] = []

  for (let i = 0; i <= daysAhead; i++) {
    const date = addDays(today, i)
    if (!hours.days.includes(isoWeekday(date))) continue
    const { y, m, d } = parseDate(date)
    const opensAt = zonedWallToUtc({ y, m, d, h: open.h, mi: open.mi }, hours.tz)
    const closesAt = zonedWallToUtc({ y, m, d, h: close.h, mi: close.mi }, hours.tz)
    const slots: string[] = []
    for (let t = opensAt; t + minutes * MINUTE <= closesAt; t += minutes * MINUTE) {
      if (t < earliest || t >= latest) continue
      if (!isSlotFree(t, minutes, bufferMinutes, busy)) continue
      slots.push(new Date(t).toISOString())
    }
    if (slots.length) out.push({ date, slots })
  }
  return out
}

/** Whether `start` (ms) is one of the offered slots. */
export function slotOffered(days: readonly BookingDay[], start: number): boolean {
  const iso = new Date(start).toISOString()
  return days.some((d) => d.slots.includes(iso))
}

// ---------------------------------------------------------------- DeskDev busy (recurrences)

export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly'

export interface BusyEventRow {
  id: string
  starts_at: string
  ends_at?: string | null
  all_day?: boolean | null
  recurrence?: string | null
  recurrence_until?: string | null
  timezone?: string | null
  created_by?: string | null
  booked_via?: string | null
}

/** Which DeskDev events block the host's booking slots (048's rule). */
export function blocksBooking(ev: BusyEventRow, hostId: string | null, hostEventIds: ReadonlySet<string>): boolean {
  if (ev.all_day) return false
  if (ev.booked_via === 'website') return true
  if (!hostId) return false
  return ev.created_by === hostId || hostEventIds.has(ev.id)
}

function stepWall(w: Wall, recurrence: Recurrence): Wall {
  // Date.UTC normalises overflow exactly like the browser's setDate/setMonth
  // (Jan 31 + 1 month → Mar 3, and the next step continues from there).
  const t = new Date(Date.UTC(
    w.y,
    w.m - 1 + (recurrence === 'monthly' ? 1 : 0),
    w.d + (recurrence === 'daily' ? 1 : recurrence === 'weekly' ? 7 : 0),
    w.h, w.mi, w.s,
  ))
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), h: w.h, mi: w.mi, s: w.s }
}

/**
 * Occurrence starts (ms) of an event inside [from, to], the way DeskDev's
 * getEventOccurrences materializes them: the first start, then the same wall
 * clock every day / 7 days / month, until the end of `recurrence_until` —
 * all in the event's zone (the browser uses its own; equal when they match).
 */
export function expandOccurrences(ev: BusyEventRow, from: number, to: number, defaultTz: string): number[] {
  const first = Date.parse(ev.starts_at)
  if (!Number.isFinite(first)) return []
  const duration = ev.ends_at ? Math.max(0, Date.parse(ev.ends_at) - first) : 0
  const recurrence = (ev.recurrence ?? 'none') as Recurrence
  if (recurrence === 'none' || !['daily', 'weekly', 'monthly'].includes(recurrence)) {
    return first + duration >= from && first <= to ? [first] : []
  }
  const tz = isValidTimeZone(ev.timezone) ? ev.timezone : defaultTz
  const until = ev.recurrence_until && /^\d{4}-\d{2}-\d{2}$/.test(ev.recurrence_until)
    ? zonedWallToUtc({ ...parseDate(ev.recurrence_until), h: 23, mi: 59, s: 59 }, tz)
    : to
  const limit = Math.min(to, until)
  const out: number[] = []
  let wall = wallInZone(first, tz)
  let cursor = first
  for (let guard = 0; cursor <= limit && guard < 1000; guard++) {
    if (cursor + duration >= from) out.push(cursor)
    wall = stepWall(wall, recurrence)
    cursor = zonedWallToUtc(wall, tz)
  }
  return out
}

/** Busy intervals from DeskDev events (an event without an end blocks DEFAULT_EVENT_MINUTES). */
export function busyFromEvents(rows: readonly BusyEventRow[], window: Interval, defaultTz: string): Interval[] {
  const out: Interval[] = []
  for (const ev of rows) {
    const first = Date.parse(ev.starts_at)
    const end = ev.ends_at ? Date.parse(ev.ends_at) : NaN
    const duration = Number.isFinite(end) && end > first ? end - first : DEFAULT_EVENT_MINUTES * MINUTE
    for (const start of expandOccurrences(ev, window.start - duration, window.end, defaultTz)) {
      out.push({ start, end: start + duration })
    }
  }
  return out
}

export interface FreeBusyResponse {
  calendars?: Record<string, { busy?: { start?: string; end?: string }[]; errors?: { reason?: string }[] }>
}

/**
 * Google freebusy → busy intervals, and which requested calendars Google could
 * not read. Google answers under the ids it was asked for; 'primary' is looked
 * up under that name, then under any key that wasn't requested (some
 * responses key it by the account's address).
 */
export function busyFromFreeBusy(data: FreeBusyResponse | null | undefined, ids: readonly string[]): { busy: Interval[]; failed: string[] } {
  const calendars = data?.calendars ?? {}
  const busy: Interval[] = []
  const failed: string[] = []
  const extra = Object.keys(calendars).filter((k) => !ids.includes(k))
  for (const id of ids) {
    const cal = calendars[id] ?? (id === 'primary' && extra.length === 1 ? calendars[extra[0]] : undefined)
    if (!cal || (cal.errors && cal.errors.length)) {
      failed.push(id)
      continue
    }
    for (const b of cal.busy ?? []) {
      const start = Date.parse(b.start ?? '')
      const end = Date.parse(b.end ?? '')
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) busy.push({ start, end })
    }
  }
  return { busy, failed }
}

// ---------------------------------------------------------------- the Google event
// Unused by the function: worker.ts pushes events with mapping.ts's toGoogleEvent.

export interface ClaimedAttendee {
  email: string
  display_name?: string | null
  optional?: boolean | null
  profile_id?: string | null
}

/** The event as google_sync_claim hands it over (snake_case, minus notes/colour). */
export interface ClaimedEvent extends BusyEventRow {
  kind?: string | null
  title: string
  description?: string | null
  location?: string | null
  meeting_link?: string | null
  add_meet?: boolean | null
  sync_google?: boolean | null
  google_event_id?: string | null
  default_time_zone?: string | null
  attendees?: ClaimedAttendee[] | null
}

export function isMeetUrl(v: unknown): v is string {
  return typeof v === 'string' && /^https:\/\/meet\.google\.com\//.test(v)
}

export function eventTimeZone(ev: Pick<ClaimedEvent, 'timezone' | 'default_time_zone'>): string {
  if (isValidTimeZone(ev.timezone)) return ev.timezone
  if (isValidTimeZone(ev.default_time_zone)) return ev.default_time_zone
  return 'UTC'
}

/** RRULE "YYYYMMDDTHHMMSSZ". */
function rruleUtc(t: number): string {
  return new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

/**
 * The RRULE for a repeating event, or null. UNTIL is the end of the
 * recurrence_until day in the event's zone, in UTC (RFC 5545 wants UTC when
 * the start carries a zone); an all-day event gets a DATE.
 */
export function rrule(ev: Pick<ClaimedEvent, 'recurrence' | 'recurrence_until' | 'all_day'>, tz: string): string | null {
  const freq = ev.recurrence === 'daily' ? 'DAILY' : ev.recurrence === 'weekly' ? 'WEEKLY' : ev.recurrence === 'monthly' ? 'MONTHLY' : null
  if (!freq) return null
  let rule = `RRULE:FREQ=${freq}`
  if (ev.recurrence_until && /^\d{4}-\d{2}-\d{2}$/.test(ev.recurrence_until)) {
    rule += ev.all_day
      ? `;UNTIL=${ev.recurrence_until.replace(/-/g, '')}`
      : `;UNTIL=${rruleUtc(zonedWallToUtc({ ...parseDate(ev.recurrence_until), h: 23, mi: 59, s: 59 }, tz))}`
  }
  return rule
}

/**
 * Guests hear about it ('all') when someone outside the team is invited — a
 * customer who booked, a client — so Google sends them the invitation, the
 * changes and the cancellation. Teammates-only events stay quiet ('none').
 */
export function sendUpdatesFor(ev: Pick<ClaimedEvent, 'attendees'>): 'all' | 'none' {
  return (ev.attendees ?? []).some((a) => !a.profile_id) ? 'all' : 'none'
}

export interface GoogleEventBody {
  id?: string
  summary: string
  description: string
  location: string
  start: { dateTime: string; timeZone: string } | { date: string }
  end: { dateTime: string; timeZone: string } | { date: string }
  recurrence: string[]
  attendees: { email: string; displayName?: string; optional?: boolean }[]
  conferenceData?: { createRequest: { requestId: string; conferenceSolutionKey: { type: 'hangoutsMeet' } } }
  extendedProperties: { private: { deskdevEventId: string } }
}

/**
 * What Google gets for an event. `withId` on the first insert (the
 * deterministic id makes a retried insert answer 409 instead of inviting
 * everyone twice). Meet is requested only when asked for and no other link
 * was typed; Google's Meet link comes back through google_sync_complete,
 * which fills meeting_link, so later pushes don't ask again.
 */
export function eventBody(ev: ClaimedEvent, opts: { withId: boolean }): GoogleEventBody {
  const tz = eventTimeZone(ev)
  const start = Date.parse(ev.starts_at)
  const endRaw = ev.ends_at ? Date.parse(ev.ends_at) : NaN
  const end = Number.isFinite(endRaw) && endRaw > start ? endRaw : start + DEFAULT_EVENT_MINUTES * MINUTE

  let when: Pick<GoogleEventBody, 'start' | 'end'>
  if (ev.all_day) {
    const startDate = isoDateInZone(start, tz)
    const lastDate = Number.isFinite(endRaw) ? isoDateInZone(endRaw, tz) : startDate
    // Google's all-day end is exclusive.
    when = { start: { date: startDate }, end: { date: addDays(lastDate < startDate ? startDate : lastDate, 1) } }
  } else {
    when = {
      start: { dateTime: new Date(start).toISOString(), timeZone: tz },
      end: { dateTime: new Date(end).toISOString(), timeZone: tz },
    }
  }

  const typedLink = ev.meeting_link && !isMeetUrl(ev.meeting_link) ? ev.meeting_link : null
  const rule = rrule(ev, tz)
  const body: GoogleEventBody = {
    ...(opts.withId ? { id: googleEventId(ev.id) } : {}),
    summary: (ev.title || 'Untitled').slice(0, 1024),
    description: (ev.description ?? '').slice(0, 8000),
    location: (ev.location || typedLink || '').slice(0, 1024),
    ...when,
    recurrence: rule ? [rule] : [],
    attendees: (ev.attendees ?? []).map((a) => ({
      email: a.email,
      ...(a.display_name ? { displayName: a.display_name } : {}),
      ...(a.optional ? { optional: true } : {}),
    })),
    extendedProperties: { private: { deskdevEventId: ev.id } },
  }
  if (ev.add_meet && !ev.meeting_link) {
    body.conferenceData = { createRequest: { requestId: meetRequestId(ev.id), conferenceSolutionKey: { type: 'hangoutsMeet' } } }
  }
  return body
}

export interface GoogleEventResponse {
  id?: string
  etag?: string
  hangoutLink?: string
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] }
}

/** The Meet link Google attached, if any. */
export function meetUrlOf(g: GoogleEventResponse | null | undefined): string | null {
  if (isMeetUrl(g?.hangoutLink)) return g!.hangoutLink!
  const video = g?.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri
  return isMeetUrl(video) ? video : null
}

// ---------------------------------------------------------------- Google errors
// Unused by the function: worker.ts and index.ts use mapping.ts's classifyGoogleError.

/**
 * What to do with a failed Google call (google_sync_complete's p_result, or
 * 'release' when the grant itself is the problem). 404/410 and 409 are
 * handled by the caller before this (recreate / patch instead).
 */
export function classifyGoogleError(status: number, body: unknown): { result: 'retry' | 'failed' | 'release'; message: string } {
  const err = (body as { error?: { message?: string; errors?: { reason?: string }[]; status?: string } } | null)?.error
  const reason = err?.errors?.[0]?.reason ?? err?.status ?? ''
  const message = `Google ${status || 'unreachable'}${reason ? ` ${reason}` : ''}`.slice(0, 200)
  if (status === 401) return { result: 'release', message }
  if (status === 0 || status === 408 || status === 412 || status === 429 || status >= 500) return { result: 'retry', message }
  if (status === 403 && /rateLimit|quotaExceeded|userRateLimit/i.test(reason)) return { result: 'retry', message }
  return { result: 'failed', message }
}

// ---------------------------------------------------------------- the booking request

export interface BookInput {
  start: number
  name: string
  email: string
  company?: string
  phone?: string
  notes?: string
  customerTz?: string
  ipHash?: string
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s.]+$/

function text(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined
  // Stripping control characters is the point here.
  // deno-lint-ignore no-control-regex
  const t = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim()
  return t ? t.slice(0, max) : undefined
}

/** The book action's body, checked; null when it can't be a booking. booking_record checks again. */
export function parseBookInput(body: unknown): BookInput | null {
  const b = (body ?? {}) as Record<string, unknown>
  const start = typeof b.start === 'string' ? Date.parse(b.start) : NaN
  const name = text(b.name, 120)
  const email = text(b.email, 254)
  if (!Number.isFinite(start) || !name || !email || !EMAIL.test(email)) return null
  return {
    start,
    name,
    email,
    company: text(b.company, 160),
    phone: text(b.phone, 40),
    notes: text(b.notes, 2000),
    customerTz: isValidTimeZone(b.customer_tz) ? b.customer_tz : undefined,
    ipHash: text(b.ip_hash, 128),
  }
}

/** booking_record's payload for an offered slot. */
export function bookingPayload(input: BookInput, minutes: number): Record<string, unknown> {
  return {
    start: new Date(input.start).toISOString(),
    end: new Date(input.start + minutes * MINUTE).toISOString(),
    name: input.name,
    email: input.email,
    company: input.company ?? null,
    phone: input.phone ?? null,
    notes: input.notes ?? null,
    customer_tz: input.customerTz ?? null,
    ip_hash: input.ipHash ?? null,
  }
}

export const BOOK_REASONS = ['disabled', 'invalid', 'slot_taken', 'throttled', 'unavailable'] as const
export type BookReason = (typeof BOOK_REASONS)[number]

/** booking_record's refusal → the book action's reason (anything unknown is 'unavailable'). */
export function bookReason(raw: unknown): BookReason {
  return (BOOK_REASONS as readonly string[]).includes(raw as string) ? (raw as BookReason) : 'unavailable'
}
