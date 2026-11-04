import { logEvent } from './guard';

// The public booking page (/book) and the company calendar. Open times and
// bookings both come from the google-calendar edge function (phase 4): it
// knows the business hours, the Google free/busy picture and DeskDev's own
// meetings, and it records a booking as a DeskDev meeting on the lead
// (booking_record, migration 048) that is pushed to Google with a Meet link.
//
//   POST {NEXT_PUBLIC_SUPABASE_URL}/functions/v1/google-calendar
//     apikey + Authorization: Bearer <anon key>   (the Supabase gateway)
//     x-booking-secret: BOOKING_API_SECRET        (the function's own check)
//     { action: 'slots' }                         → open times
//     { action: 'book', start, name, … }          → the booking
//
// How the function answers (read the JSON body whatever the HTTP status):
//   200 { ok: true, … }
//   200 { ok: false, reason }          a business refusal: 'disabled' (slots);
//                                      'disabled' | 'invalid' | 'slot_taken' |
//                                      'throttled' | 'unavailable' (book)
//   503 { ok: false, reason: 'unavailable' }   Google free/busy or the
//                                      database failed, or it lacks its secret
//   401 wrong x-booking-secret · 403 a request with an Origin header
//        → both mean this Worker is set up wrong: 'not_configured'
//
// Server only (route handlers): it reads secrets, which on Workers arrive
// with the request's environment, so they are read per call. Logs carry
// outcomes and codes, never a name, email or note.

const ROUTE = 'booking';

/** A slot read is one Google free/busy call plus a database read. */
const SLOTS_TIMEOUT_MS = 8_000;
/** A booking may create the Google event and its Meet link before answering. */
const BOOK_TIMEOUT_MS = 8_000;

export type GoogleState = 'checked' | 'team_only' | 'not_connected';

export interface SlotDay {
  /** YYYY-MM-DD in the studio's time zone. */
  date: string;
  /** ISO UTC start of each open slot, ascending. */
  slots: string[];
}

export interface OpenSlots {
  status: 'open';
  /** The studio's IANA time zone (business hours are in it). */
  tz: string;
  /** Length of one call. */
  minutes: number;
  /** e.g. "Discovery call". */
  title: string;
  days: SlotDay[];
  /** How far ahead the page offers times, when the function says. */
  daysAhead: number | null;
  google: GoogleState;
}

export type SlotsRead =
  | OpenSlots
  | { status: 'disabled' }
  | { status: 'not_configured' }
  | { status: 'unavailable' }
  | { status: 'timeout' };

export interface BookingInput {
  start: string;
  name: string;
  email: string;
  company?: string;
  phone?: string;
  notes?: string;
  customerTz?: string;
  ipHash?: string | null;
}

export interface Booked {
  status: 'booked';
  start: string;
  end: string;
  title: string;
  /** https Meet link, when Google already made one (often null: the invite carries it). */
  meetUrl: string | null;
  /**
   * The customer will get a Google Calendar invite (sent by the inline push or
   * the worker's retry). The Meet link may not exist yet even when true.
   */
  invited: boolean;
}

export type BookingResult =
  | Booked
  | { status: 'slot_taken' }
  | { status: 'throttled' }
  | { status: 'invalid' }
  | { status: 'disabled' }
  | { status: 'not_configured' }
  | { status: 'unavailable' }
  | { status: 'timeout' };

interface Config {
  url: string;
  anonKey: string;
  secret: string;
}

function config(): Config | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret = process.env.BOOKING_API_SECRET;
  if (!url || !anonKey || !secret) {
    logEvent(ROUTE, 'error', 'not_configured', { url: Boolean(url), anonKey: Boolean(anonKey), secret: Boolean(secret) });
    return null;
  }
  return { url: url.replace(/\/+$/, ''), anonKey, secret };
}

type CallResult =
  | { kind: 'ok'; body: Record<string, unknown> }
  | { kind: 'not_configured' }
  | { kind: 'unavailable' }
  | { kind: 'timeout' };

/**
 * One call to the function. 401 / 403 mean our secret or request shape is
 * wrong ('not_configured'). Otherwise a JSON object answer is returned
 * whatever the HTTP status, so an `{ ok: false, reason }` refusal reads the
 * same on a 200 or a 503; anything else (no JSON, a bare 5xx, network) is
 * 'unavailable'.
 */
async function call(cfg: Config, body: Record<string, unknown>, timeoutMs: number): Promise<CallResult> {
  const action = String(body.action);
  try {
    const res = await fetch(`${cfg.url}/functions/v1/google-calendar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: cfg.anonKey,
        Authorization: `Bearer ${cfg.anonKey}`,
        'x-booking-secret': cfg.secret,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 401 || res.status === 403) {
      logEvent(ROUTE, 'error', `${action}_rejected`, { status: res.status });
      return { kind: 'not_configured' };
    }
    const parsed = (await res.json().catch(() => null)) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const answer = parsed as Record<string, unknown>;
      if (res.ok || answer.ok === false) {
        if (!res.ok) logEvent(ROUTE, 'warn', `${action}_refused`, { status: res.status, reason: String(answer.reason ?? '') });
        return { kind: 'ok', body: answer };
      }
    }
    logEvent(ROUTE, 'error', `${action}_failed`, { status: res.status });
    return { kind: 'unavailable' };
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    logEvent(ROUTE, 'error', timedOut ? `${action}_timeout` : `${action}_unreachable`);
    return { kind: timedOut ? 'timeout' : 'unavailable' };
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIso(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));
}

/** An IANA zone this runtime knows, else null. */
export function validTimeZone(tz: unknown): string | null {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

function daysOf(v: unknown): SlotDay[] {
  if (!Array.isArray(v)) return [];
  const out: SlotDay[] = [];
  for (const d of v) {
    if (!d || typeof d !== 'object') continue;
    const { date, slots } = d as { date?: unknown; slots?: unknown };
    if (typeof date !== 'string' || !DATE.test(date) || !Array.isArray(slots)) continue;
    const clean = slots
      .filter(isIso)
      .map((s) => new Date(s).toISOString())
      .sort();
    out.push({ date, slots: [...new Set(clean)] });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Open times, as the page needs them. Never throws. */
export async function getBookingSlots(): Promise<SlotsRead> {
  const cfg = config();
  if (!cfg) return { status: 'not_configured' };
  const result = await call(cfg, { action: 'slots' }, SLOTS_TIMEOUT_MS);
  if (result.kind !== 'ok') return { status: result.kind };
  const b = result.body;
  if (b.ok !== true) return b.reason === 'disabled' ? { status: 'disabled' } : { status: 'unavailable' };

  const tz = validTimeZone(b.tz);
  const minutes = typeof b.minutes === 'number' && Number.isFinite(b.minutes) && b.minutes > 0 ? Math.round(b.minutes) : null;
  if (!tz || !minutes) {
    logEvent(ROUTE, 'error', 'slots_bad_answer');
    return { status: 'unavailable' };
  }
  const ahead = b.days_ahead ?? b.daysAhead;
  return {
    status: 'open',
    tz,
    minutes,
    title: typeof b.title === 'string' && b.title.trim() ? b.title.trim().slice(0, 80) : 'Discovery call',
    days: daysOf(b.days),
    daysAhead: typeof ahead === 'number' && ahead > 0 ? Math.round(ahead) : null,
    google: b.google === 'checked' || b.google === 'team_only' ? b.google : 'not_connected',
  };
}

const REASONS = new Set(['slot_taken', 'throttled', 'invalid', 'disabled']);

/** Only an https Meet (or other https) link is handed to the page. */
function safeMeetUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Book `input.start`. The input must already be validated by the route. Never throws. */
export async function createBooking(input: BookingInput): Promise<BookingResult> {
  const cfg = config();
  if (!cfg) return { status: 'not_configured' };
  const result = await call(
    cfg,
    {
      action: 'book',
      start: input.start,
      name: input.name,
      email: input.email,
      ...(input.company ? { company: input.company } : {}),
      ...(input.phone ? { phone: input.phone } : {}),
      ...(input.notes ? { notes: input.notes } : {}),
      ...(input.customerTz ? { customer_tz: input.customerTz } : {}),
      ...(input.ipHash ? { ip_hash: input.ipHash } : {}),
    },
    BOOK_TIMEOUT_MS,
  );
  if (result.kind !== 'ok') return { status: result.kind };
  const b = result.body;

  if (b.ok !== true) {
    const reason = typeof b.reason === 'string' && REASONS.has(b.reason) ? (b.reason as 'slot_taken' | 'throttled' | 'invalid' | 'disabled') : null;
    logEvent(ROUTE, 'info', `book_${reason ?? 'unavailable'}`);
    return reason ? { status: reason } : { status: 'unavailable' };
  }
  if (!isIso(b.start) || !isIso(b.end)) {
    // It said yes but not when: the booking exists, the page just can't show it.
    logEvent(ROUTE, 'error', 'book_bad_answer');
  }
  const start = isIso(b.start) ? new Date(b.start).toISOString() : input.start;
  logEvent(ROUTE, 'info', 'booked', { invited: b.invited === true, meet: Boolean(b.meetUrl) });
  return {
    status: 'booked',
    start,
    end: isIso(b.end) ? new Date(b.end).toISOString() : start,
    title: typeof b.title === 'string' && b.title.trim() ? b.title.trim().slice(0, 80) : 'Discovery call',
    meetUrl: safeMeetUrl(b.meetUrl),
    invited: b.invited === true,
  };
}
