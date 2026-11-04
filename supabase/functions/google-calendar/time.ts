// DeskDev Studio — time-zone arithmetic for the Team Calendar sync and the
// personal ICS feeds.
//
// Import-free on purpose (only Intl and Date), so the same file runs in the
// Edge Runtime, Deno and Node's test runner (`node --test`, see README.md).
// Every function takes an IANA zone name; the database refuses anything else
// (040's is_valid_time_zone), so a bad zone here is a programming error.

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

export interface WallTime {
  y: number;
  m: number; // 1-12
  d: number;
  h: number;
  mi: number;
  s: number;
}

/** True when Intl knows the zone (Deno, Node and browsers ship the full IANA set). */
export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock time an instant shows in a zone. */
export function wallTime(ms: number, tz: string): WallTime {
  const out: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return { y: out.year, m: out.month, d: out.day, h: out.hour === 24 ? 0 : out.hour, mi: out.minute, s: out.second };
}

/** The zone's UTC offset at an instant, in minutes (Manila: +480). */
export function offsetMinutes(ms: number, tz: string): number {
  const w = wallTime(ms, tz);
  const asUtc = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

/**
 * The instant a wall-clock time happens in a zone. A time skipped by a DST
 * jump resolves to the moment after the jump; a repeated one to its first
 * occurrence (what calendar apps do).
 */
export function zonedToUtc(w: WallTime, tz: string): number {
  const naive = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
  const first = naive - offsetMinutes(naive, tz) * 60_000;
  const second = naive - offsetMinutes(first, tz) * 60_000;
  if (first === second) return first;
  // Two candidates straddle a transition: prefer one that really shows w.
  const shows = (t: number) => {
    const x = wallTime(t, tz);
    return x.y === w.y && x.m === w.m && x.d === w.d && x.h === w.h && x.mi === w.mi;
  };
  if (shows(Math.min(first, second))) return Math.min(first, second);
  if (shows(Math.max(first, second))) return Math.max(first, second);
  return Math.max(first, second); // in the gap: after the jump
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** 'YYYY-MM-DD' of an instant in a zone. */
export function localDate(ms: number, tz: string): string {
  const w = wallTime(ms, tz);
  return `${pad(w.y, 4)}-${pad(w.m)}-${pad(w.d)}`;
}

/** 'YYYY-MM-DD' + n days (calendar arithmetic, no zone involved). */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 'YYYY-MM-DD' → 'YYYYMMDD' (iCalendar DATE). */
export function basicDate(date: string): string {
  return date.replace(/-/g, "");
}

/** An instant as iCalendar UTC: 'YYYYMMDDTHHMMSSZ'. */
export function basicUtc(ms: number): string {
  const t = new Date(Math.floor(ms / 1000) * 1000);
  return `${pad(t.getUTCFullYear(), 4)}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}T${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}${pad(t.getUTCSeconds())}Z`;
}

/** An instant as iCalendar local time in a zone: 'YYYYMMDDTHHMMSS' (no Z). */
export function basicLocal(ms: number, tz: string): string {
  const w = wallTime(ms, tz);
  return `${pad(w.y, 4)}${pad(w.m)}${pad(w.d)}T${pad(w.h)}${pad(w.mi)}${pad(w.s)}`;
}

/** The last second of a calendar day in a zone, as an instant. */
export function endOfLocalDay(date: string, tz: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return zonedToUtc({ y, m, d, h: 23, mi: 59, s: 59 }, tz);
}

export interface Transition {
  /** The instant the new offset starts. */
  at: number;
  from: number; // minutes
  to: number; // minutes
}

/**
 * Every UTC-offset change of a zone between two instants. Scans day by day
 * and narrows each change to the minute, so it needs nothing but Intl.
 */
export function transitions(tz: string, fromMs: number, toMs: number): Transition[] {
  const DAY = 86_400_000;
  const out: Transition[] = [];
  let t = fromMs;
  let off = offsetMinutes(t, tz);
  while (t < toMs) {
    const next = Math.min(t + DAY, toMs);
    const nextOff = offsetMinutes(next, tz);
    if (nextOff !== off) {
      let lo = t;
      let hi = next;
      while (hi - lo > 60_000) {
        const mid = Math.floor((lo + hi) / 2 / 60_000) * 60_000;
        if (mid <= lo) break;
        if (offsetMinutes(mid, tz) === off) lo = mid;
        else hi = mid;
      }
      out.push({ at: hi, from: off, to: nextOff });
      off = nextOff;
    }
    t = next;
  }
  return out;
}

/** '+0800' / '-0430' (iCalendar UTC-OFFSET). */
export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const a = Math.abs(minutes);
  return `${sign}${pad(Math.floor(a / 60))}${pad(a % 60)}`;
}
