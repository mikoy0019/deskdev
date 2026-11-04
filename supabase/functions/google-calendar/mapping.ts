// DeskDev Studio — DeskDev event → Google Calendar event (Team Calendar, C1).
//
// Pure and import-free apart from ./time.ts, so it runs under Deno and under
// Node's test runner (mapping.test.ts). The worker (worker.ts) decides WHEN
// to call Google; this file decides WHAT to send.
//
// Rules that keep guests from being spammed and recurrences from drifting:
// - The Google id is derived from the DeskDev id (googleEventId), so a
//   retried insert after a lost response answers 409 instead of creating a
//   duplicate and sending every guest a second invitation.
// - A timed event carries its IANA zone, and recurrences are expanded by
//   Google in that zone: a weekly 9:00 stays 9:00 across DST.
// - All-day events are dates (end exclusive), never midnight timestamps.
// - Only material changes (time, recurrence, title, place, guest list,
//   Meet on/off, a cancelled event coming back) notify guests; a typo fix
//   in the description does not.
// - Client-facing text never names DeskDev or the team's location; the
//   DeskDev id travels in extendedProperties.private, which guests never see.

import { addDays, basicDate, basicUtc, endOfLocalDay, isTimeZone, localDate } from "./time.ts";

export type Recurrence = "none" | "daily" | "weekly" | "monthly";

/** One guest, as google_sync_claim returns it. */
export interface AttendeeRow {
  email: string;
  display_name?: string | null;
  optional?: boolean | null;
  profile_id?: string | null;
}

/** The event as google_sync_claim returns it (notes and colour are never included). */
export interface EventRow {
  id: string;
  kind: "event" | "meeting";
  title: string;
  description?: string | null;
  starts_at: string;
  ends_at?: string | null;
  all_day?: boolean | null;
  location?: string | null;
  meeting_link?: string | null;
  recurrence?: Recurrence | null;
  recurrence_until?: string | null; // 'YYYY-MM-DD', inclusive
  timezone?: string | null;
  sync_google?: boolean | null;
  add_meet?: boolean | null;
  google_event_id?: string | null;
  google_etag?: string | null;
  default_time_zone?: string | null;
  attendees?: AttendeeRow[] | null;
}

export interface GoogleDate {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GoogleAttendee {
  email: string;
  displayName?: string;
  optional?: boolean;
  responseStatus?: string;
  organizer?: boolean;
  self?: boolean;
  resource?: boolean;
}

export interface GoogleConferenceData {
  createRequest?: { requestId: string; conferenceSolutionKey: { type: string } };
  conferenceSolution?: { key?: { type?: string } };
  entryPoints?: { entryPointType?: string; uri?: string }[];
  conferenceId?: string;
}

/** The subset of a Google Calendar event this sync reads and writes. */
export interface GoogleEvent {
  id?: string;
  etag?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleDate;
  end?: GoogleDate;
  recurrence?: string[];
  attendees?: GoogleAttendee[];
  conferenceData?: GoogleConferenceData | null;
  hangoutLink?: string;
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
  reminders?: { useDefault: boolean };
  guestsCanModify?: boolean;
}

export const TEAM_CALENDAR_NAME = "NixGen Team";
/** A timed event saved without an end lasts this long on Google (Google needs an end). */
export const DEFAULT_DURATION_MINUTES = 60;
const MAX_TITLE = 500;
const MAX_DESCRIPTION = 7000; // Google's cap is 8192; leave room for the join line
const MAX_LOCATION = 500;
const MAX_ATTENDEES = 100;
const EMAIL_RE = /^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$/;

/**
 * The id Google stores a DeskDev event under. Google ids use base32hex
 * (a–v, 0–9), 5–1024 characters; a uuid's hex digits are a subset.
 * Mirrors public.google_calendar_event_id() in migration 040.
 */
export function googleEventId(deskdevId: string): string {
  return "dd" + deskdevId.toLowerCase().replace(/-/g, "");
}

/** The zone an event is planned in: its own, else the workspace default, else UTC. */
export function eventTimeZone(e: Pick<EventRow, "timezone" | "default_time_zone">): string {
  if (isTimeZone(e.timezone)) return e.timezone;
  if (isTimeZone(e.default_time_zone)) return e.default_time_zone;
  return "UTC";
}

/** http(s) only: anything else (javascript:, data:, a bare host) is dropped. */
export function webUrl(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function isMeetUrl(raw: string | null | undefined): boolean {
  const u = webUrl(raw);
  return Boolean(u && /^https:\/\/meet\.google\.com\//.test(u));
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/**
 * The RRULE for a DeskDev recurrence, or null. Google infers BYDAY /
 * BYMONTHDAY from the start, in the event's zone. UNTIL is inclusive: the
 * end of that day in the event's zone (UTC form for timed events, as RFC
 * 5545 requires when the start has a zone; a DATE for all-day events).
 * A monthly event on the 29th–31st skips months without that day (RFC
 * behaviour), where DeskDev's own expansion rolls into the next month.
 */
export function rrule(e: Pick<EventRow, "recurrence" | "recurrence_until" | "all_day">, tz: string): string | null {
  const FREQ: Record<Recurrence, string | null> = { none: null, daily: "DAILY", weekly: "WEEKLY", monthly: "MONTHLY" };
  const freq = FREQ[e.recurrence ?? "none"] ?? null;
  if (!freq) return null;
  let rule = `RRULE:FREQ=${freq}`;
  const until = (e.recurrence_until ?? "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(until)) {
    rule += `;UNTIL=${e.all_day ? basicDate(until) : basicUtc(endOfLocalDay(until, tz))}`;
  }
  return rule;
}

/** Start and end as Google wants them. */
export function eventTimes(e: Pick<EventRow, "starts_at" | "ends_at" | "all_day">, tz: string): { start: GoogleDate; end: GoogleDate } {
  const startMs = Date.parse(e.starts_at);
  if (!Number.isFinite(startMs)) throw new Error("event has no valid start");
  const endParsed = e.ends_at ? Date.parse(e.ends_at) : NaN;

  if (e.all_day) {
    // DeskDev stores all-day as local midnight → 23:59 of the last day.
    const first = localDate(startMs, tz);
    const last = Number.isFinite(endParsed) && endParsed > startMs ? localDate(endParsed, tz) : first;
    const endExclusive = addDays(last < first ? first : last, 1);
    return { start: { date: first }, end: { date: endExclusive } };
  }

  const endMs = Number.isFinite(endParsed) && endParsed > startMs
    ? endParsed
    : startMs + DEFAULT_DURATION_MINUTES * 60_000;
  return {
    start: { dateTime: new Date(startMs).toISOString(), timeZone: tz },
    end: { dateTime: new Date(endMs).toISOString(), timeZone: tz },
  };
}

/** Guests, deduplicated by address (first wins), invalid addresses dropped. */
export function attendeesFor(rows: AttendeeRow[] | null | undefined): GoogleAttendee[] {
  const seen = new Set<string>();
  const out: GoogleAttendee[] = [];
  for (const a of rows ?? []) {
    const email = (a.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 320 || seen.has(email)) continue;
    seen.add(email);
    const g: GoogleAttendee = { email };
    const name = (a.display_name ?? "").trim();
    if (name) g.displayName = clip(name, 200);
    if (a.optional) g.optional = true;
    out.push(g);
    if (out.length >= MAX_ATTENDEES) break;
  }
  return out;
}

/** The description guests see: the event's own text plus a typed (non-Meet) join link. */
export function descriptionFor(e: Pick<EventRow, "description" | "meeting_link" | "add_meet">): string {
  const parts: string[] = [];
  const body = (e.description ?? "").trim();
  if (body) parts.push(clip(body, MAX_DESCRIPTION));
  const link = webUrl(e.meeting_link);
  // A Meet link Google made is shown by Google itself (the conference block).
  if (link && !(e.add_meet && isMeetUrl(link))) parts.push(`Join: ${link}`);
  return parts.join("\n\n");
}

export interface MapOptions {
  /** Request id for a new Meet; omit to not ask for one. */
  meetRequestId?: string;
}

/**
 * The full Google body for a DeskDev event (insert, or the base of an
 * update). Conference data is only a create request here; keeping or
 * dropping an existing Meet is mergeForUpdate's job.
 */
export function toGoogleEvent(e: EventRow, opts: MapOptions = {}): GoogleEvent {
  const tz = eventTimeZone(e);
  const { start, end } = eventTimes(e, tz);
  const rule = rrule(e, tz);
  const link = webUrl(e.meeting_link);
  const location = (e.location ?? "").trim()
    || (link && !(e.add_meet && isMeetUrl(link)) ? link : "");

  const g: GoogleEvent = {
    id: e.google_event_id || googleEventId(e.id),
    status: "confirmed",
    summary: clip((e.title ?? "").trim() || "(untitled)", MAX_TITLE),
    description: descriptionFor(e),
    location: clip(location, MAX_LOCATION),
    start,
    end,
    recurrence: rule ? [rule] : [],
    attendees: attendeesFor(e.attendees),
    reminders: { useDefault: true },
    guestsCanModify: false,
    extendedProperties: { private: { deskdevId: e.id, deskdevKind: e.kind } },
  };
  if (e.add_meet && opts.meetRequestId) {
    g.conferenceData = {
      createRequest: { requestId: opts.meetRequestId, conferenceSolutionKey: { type: "hangoutsMeet" } },
    };
  }
  return g;
}

/** Does this Google event carry a Google Meet? */
export function hasMeet(g: GoogleEvent | null | undefined): boolean {
  if (!g) return false;
  if (g.hangoutLink) return true;
  const cd = g.conferenceData;
  return Boolean(cd && (cd.conferenceSolution?.key?.type === "hangoutsMeet" || cd.createRequest));
}

/** The Meet join URL Google created, if any. */
export function meetUrl(g: GoogleEvent | null | undefined): string | null {
  if (!g) return null;
  const candidates = [g.hangoutLink, ...(g.conferenceData?.entryPoints ?? []).filter((p) => p.entryPointType === "video").map((p) => p.uri)];
  for (const c of candidates) if (isMeetUrl(c)) return webUrl(c);
  return null;
}

/**
 * The PUT body for an existing Google event: the fresh mapping, with
 * - each remaining guest's RSVP kept (Google owns RSVPs),
 * - an existing Meet kept while add_meet is on, a new one requested when it
 *   was just switched on, and none when it is off (a PUT without
 *   conferenceData and with conferenceDataVersion=1 removes it).
 */
export function mergeForUpdate(next: GoogleEvent, prev: GoogleEvent, wantMeet: boolean, newMeetRequestId: string): GoogleEvent {
  const rsvp = new Map((prev.attendees ?? []).map((a) => [a.email.toLowerCase(), a.responseStatus]));
  const body: GoogleEvent = {
    ...next,
    attendees: (next.attendees ?? []).map((a) => {
      const r = rsvp.get(a.email.toLowerCase());
      return r ? { ...a, responseStatus: r } : a;
    }),
  };
  delete body.conferenceData;
  if (wantMeet) {
    body.conferenceData = hasMeet(prev) && prev.conferenceData
      ? prev.conferenceData
      : { createRequest: { requestId: newMeetRequestId, conferenceSolutionKey: { type: "hangoutsMeet" } } };
  }
  return body;
}

function sameTime(a: GoogleDate | undefined, b: GoogleDate | undefined, recurring: boolean): boolean {
  if (!a || !b) return a === b;
  if (a.date || b.date) return (a.date ?? null) === (b.date ?? null);
  if (Date.parse(a.dateTime ?? "") !== Date.parse(b.dateTime ?? "")) return false;
  // The zone only changes what guests see when it moves the repeats.
  return !recurring || (a.timeZone ?? "") === (b.timeZone ?? "");
}

const emails = (list: GoogleAttendee[] | undefined) =>
  (list ?? []).filter((a) => !a.organizer && !a.resource).map((a) => a.email.toLowerCase()).sort().join(",");

/** Would guests care? Time, repeats, title, place, guest list, Meet, or a cancelled event returning. */
export function isMaterialChange(prev: GoogleEvent, next: GoogleEvent, wantMeet: boolean): boolean {
  if (prev.status === "cancelled") return true;
  const recurring = (next.recurrence ?? []).length > 0 || (prev.recurrence ?? []).length > 0;
  if (!sameTime(prev.start, next.start, recurring) || !sameTime(prev.end, next.end, recurring)) return true;
  if ((prev.recurrence ?? []).join("\n") !== (next.recurrence ?? []).join("\n")) return true;
  if ((prev.summary ?? "") !== (next.summary ?? "")) return true;
  if ((prev.location ?? "") !== (next.location ?? "")) return true;
  if (emails(prev.attendees) !== emails(next.attendees)) return true;
  if (hasMeet(prev) !== wantMeet) return true;
  return false;
}

export type SendUpdates = "all" | "none";

/** sendUpdates for an update: 'all' only for a material change to an event with guests. */
export function sendUpdatesFor(prev: GoogleEvent, next: GoogleEvent, wantMeet: boolean): SendUpdates {
  const guests = (prev.attendees ?? []).length > 0 || (next.attendees ?? []).length > 0;
  return guests && isMaterialChange(prev, next, wantMeet) ? "all" : "none";
}

/** sendUpdates for an insert: invite only when there is someone to invite. */
export function sendUpdatesForInsert(next: GoogleEvent): SendUpdates {
  return (next.attendees ?? []).length > 0 ? "all" : "none";
}

// ---------------------------------------------------------------- errors

export type ErrorKind =
  | "conflict" // 409: the deterministic id exists → update instead
  | "not_found" // 404
  | "gone" // 410
  | "unauthorized" // 401: refresh the access token once
  | "revoked" // the grant no longer covers the calendar (scope removed)
  | "retry" // transient: 412, 429, 5xx, rate limits, network
  | "failed"; // permanent for this event: Google refuses the content

export interface ClassifiedError {
  kind: ErrorKind;
  /** Safe for events.sync_error (shown to staff): status + Google's short reason. */
  message: string;
}

interface GoogleErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    errors?: { reason?: string; message?: string }[];
    details?: { reason?: string }[];
  };
}

const RATE_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "dailyLimitExceeded", "backendError"]);
const SCOPE_REASONS = new Set(["insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT", "authError"]);

/** Turn a Google API failure into what the worker should do with the outbox row. */
export function classifyGoogleError(status: number, body: unknown): ClassifiedError {
  const err = (body && typeof body === "object" ? (body as GoogleErrorBody).error : undefined) ?? {};
  const reasons = [
    ...(err.errors ?? []).map((x) => x.reason ?? ""),
    ...(err.details ?? []).map((x) => x.reason ?? ""),
    err.status ?? "",
  ].filter(Boolean);
  const short = clip(String(err.message ?? "").replace(/\s+/g, " ").trim(), 200);
  const message = `Google Calendar ${status}${short ? `: ${short}` : ""}`;

  if (status === 409) return { kind: "conflict", message };
  if (status === 404) return { kind: "not_found", message };
  if (status === 410) return { kind: "gone", message };
  if (status === 401) return { kind: "unauthorized", message };
  if (status === 403) {
    if (reasons.some((r) => RATE_REASONS.has(r))) return { kind: "retry", message };
    if (reasons.some((r) => SCOPE_REASONS.has(r))) return { kind: "revoked", message };
    return { kind: "failed", message };
  }
  if (status === 412 || status === 408 || status === 429 || status >= 500 || status === 0) return { kind: "retry", message };
  return { kind: "failed", message };
}

/**
 * Minutes until the next attempt after `attempts` failures: 1, 2, 4 … capped
 * at 6 hours. Mirrors public.google_sync_backoff() (the database applies it;
 * this copy is for status text).
 */
export function retryDelayMinutes(attempts: number): number {
  return Math.min(360, 2 ** (Math.max(1, Math.floor(attempts || 1)) - 1));
}

// ---------------------------------------------------------------- "Add to Google Calendar"

/**
 * A no-scope "Add to Google Calendar" link for one event (C1b): opens
 * Google's own create form, prefilled. Times are UTC with the event's zone
 * as ctz, so the form shows the right local time and repeats in that zone.
 */
export function googleTemplateUrl(e: EventRow): string {
  const tz = eventTimeZone(e);
  const { start, end } = eventTimes(e, tz);
  const dates = start.date
    ? `${basicDate(start.date)}/${basicDate(end.date!)}`
    : `${basicUtc(Date.parse(start.dateTime!))}/${basicUtc(Date.parse(end.dateTime!))}`;
  const p = new URLSearchParams({ action: "TEMPLATE", text: (e.title ?? "").trim(), dates, ctz: tz });
  const details = descriptionFor(e);
  if (details) p.set("details", details);
  const loc = (e.location ?? "").trim() || webUrl(e.meeting_link) || "";
  if (loc) p.set("location", loc);
  const rule = rrule(e, tz);
  if (rule) p.set("recur", rule);
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}
