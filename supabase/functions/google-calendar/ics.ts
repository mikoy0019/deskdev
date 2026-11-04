// DeskDev Studio — personal calendar feed (C1b): calendar_feed() JSON → iCalendar.
//
// Pure (./time.ts and ./mapping.ts only), so it runs under Deno and under
// Node's test runner (ics.test.ts). The feed is subscribed to from Google,
// Apple or Outlook with a secret URL; see README.md.
//
// - Timed one-off events are written in UTC (nothing to interpret).
// - Timed recurring events are written in their IANA zone with a VTIMEZONE
//   built from Intl, so a weekly 9:00 stays 9:00 across DST in every client.
// - All-day events are DATE values with an exclusive end.
// - Meeting notes and colours never reach the feed (calendar_feed() leaves
//   them out); descriptions and join links do.

import { basicDate, basicLocal, basicUtc, formatOffset, offsetMinutes, transitions } from "./time.ts";
import { descriptionFor, eventTimeZone, eventTimes, rrule, webUrl, type EventRow } from "./mapping.ts";

export interface FeedEvent extends EventRow {
  created_at?: string | null;
  updated_at?: string | null;
}

/** What public.calendar_feed(token) returns. */
export interface FeedData {
  owner: string;
  scope: "mine" | "all";
  default_time_zone: string;
  events: FeedEvent[];
}

const enc = new TextEncoder();

/** RFC 5545 TEXT escaping. */
export function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Fold a content line at 75 octets without splitting a UTF-8 character. */
export function foldLine(line: string): string {
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (curBytes + b > limit) {
      out.push(cur);
      cur = "";
      curBytes = 0;
      limit = 74; // continuation lines start with a space
    }
    cur += ch;
    curBytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

/** A VTIMEZONE for `tz` covering [fromMs, toMs], one observance per offset change. */
export function vtimezone(tz: string, fromMs: number, toMs: number): string[] {
  const lines = ["BEGIN:VTIMEZONE", `TZID:${tz}`];
  const initial = offsetMinutes(fromMs, tz);
  const changes = transitions(tz, fromMs, toMs);
  const offsets = [initial, ...changes.map((c) => c.to)];
  const max = Math.max(...offsets);
  const min = Math.min(...offsets);
  const kind = (o: number) => (o === max && max !== min ? "DAYLIGHT" : "STANDARD");

  lines.push(
    `BEGIN:${kind(initial)}`,
    `DTSTART:${basicLocal(fromMs, tz)}`,
    `TZOFFSETFROM:${formatOffset(initial)}`,
    `TZOFFSETTO:${formatOffset(initial)}`,
    `END:${kind(initial)}`,
  );
  for (const c of changes) {
    // DTSTART is the local time of the onset, read in the offset before it.
    const local = basicUtc(c.at + c.from * 60_000).replace("Z", "");
    lines.push(
      `BEGIN:${kind(c.to)}`,
      `DTSTART:${local}`,
      `TZOFFSETFROM:${formatOffset(c.from)}`,
      `TZOFFSETTO:${formatOffset(c.to)}`,
      `END:${kind(c.to)}`,
    );
  }
  lines.push("END:VTIMEZONE");
  return lines;
}

function veventLines(e: FeedEvent, nowMs: number, zones: Set<string>): string[] | null {
  const tz = eventTimeZone(e);
  let times;
  try {
    times = eventTimes(e, tz);
  } catch {
    return null; // a row without a valid start is skipped, not fatal
  }
  const rule = rrule(e, tz);
  const stampMs = Date.parse(e.updated_at ?? "") || nowMs;
  const lines = ["BEGIN:VEVENT", `UID:${e.id}@deskdev`, `DTSTAMP:${basicUtc(stampMs)}`, `LAST-MODIFIED:${basicUtc(stampMs)}`];
  const created = Date.parse(e.created_at ?? "");
  if (Number.isFinite(created)) lines.push(`CREATED:${basicUtc(created)}`);

  if (times.start.date) {
    lines.push(`DTSTART;VALUE=DATE:${basicDate(times.start.date)}`, `DTEND;VALUE=DATE:${basicDate(times.end.date!)}`);
  } else {
    const s = Date.parse(times.start.dateTime!);
    const en = Date.parse(times.end.dateTime!);
    if (rule && tz !== "UTC") {
      zones.add(tz);
      lines.push(`DTSTART;TZID=${tz}:${basicLocal(s, tz)}`, `DTEND;TZID=${tz}:${basicLocal(en, tz)}`);
    } else {
      lines.push(`DTSTART:${basicUtc(s)}`, `DTEND:${basicUtc(en)}`);
    }
  }
  if (rule) lines.push(rule);

  lines.push(`SUMMARY:${escapeText((e.title ?? "").trim() || "(untitled)")}`);
  const description = descriptionFor(e);
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  const location = (e.location ?? "").trim();
  if (location) lines.push(`LOCATION:${escapeText(location)}`);
  const link = webUrl(e.meeting_link);
  if (link) lines.push(`URL:${link}`);
  lines.push("STATUS:CONFIRMED", "TRANSP:OPAQUE", "END:VEVENT");
  return lines;
}

/** The whole feed as an iCalendar document (CRLF line ends, folded). */
export function buildIcs(feed: FeedData, nowMs: number = Date.now()): string {
  const zones = new Set<string>();
  const events: string[] = [];
  let earliest = nowMs;
  for (const e of feed.events ?? []) {
    const lines = veventLines(e, nowMs, zones);
    if (!lines) continue;
    events.push(...lines);
    const s = Date.parse(e.starts_at);
    if (Number.isFinite(s) && s < earliest) earliest = s;
  }

  const name = `DeskDev · ${(feed.owner ?? "").trim() || "Calendar"}`;
  const head = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DeskDev//Calendar feed//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
    `NAME:${escapeText(name)}`,
    `X-WR-TIMEZONE:${feed.default_time_zone || "UTC"}`,
    // Polling hint for clients that honour it (Google polls on its own clock).
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  // Zone rules from a year before the earliest event to three years ahead.
  const from = Math.max(earliest, nowMs - 5 * 365 * 86_400_000) - 366 * 86_400_000;
  const to = nowMs + 3 * 366 * 86_400_000;
  const tz: string[] = [];
  for (const z of [...zones].sort()) tz.push(...vtimezone(z, from, to));

  return [...head, ...tz, ...events, "END:VCALENDAR"].map(foldLine).join("\r\n") + "\r\n";
}
