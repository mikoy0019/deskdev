// Pure time helpers for /book. Open times arrive as UTC instants grouped by
// the studio's calendar day; the visitor sees them in THEIR zone, so a
// Manila-morning slot can sit on the previous day for someone in New York.
// Everything here is formatted with an explicit time zone, never the
// runtime's default, and in English to match the site.

export interface ApiDay {
  date: string;
  slots: string[];
}

export interface LocalDay {
  /** YYYY-MM-DD in the visitor's zone. */
  key: string;
  /** "Tue" */
  weekday: string;
  /** "Oct 7" */
  date: string;
  /** ISO UTC starts, ascending. */
  slots: string[];
}

/** The browser's zone, or UTC when the runtime can't say. */
export function visitorTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((p) => p.type === type)?.value ?? '';
}

/** YYYY-MM-DD of an instant in `tz`. */
export function localDateKey(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(
    new Date(iso),
  );
  return `${part(parts, 'year')}-${part(parts, 'month')}-${part(parts, 'day')}`;
}

/** Every slot regrouped by the visitor's own calendar day; days without slots never appear. */
export function groupByLocalDay(days: readonly ApiDay[], tz: string): LocalDay[] {
  const byKey = new Map<string, string[]>();
  for (const slot of days.flatMap((d) => d.slots)) {
    const key = localDateKey(slot, tz);
    const list = byKey.get(key);
    if (list) list.push(slot);
    else byKey.set(key, [slot]);
  }
  return [...byKey.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, slots]) => {
      const first = new Date(slots[0]);
      return {
        key,
        weekday: new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(first),
        date: new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric' }).format(first),
        slots: [...new Set(slots)].sort(),
      };
    });
}

/** "9:00 AM" in `tz`. */
export function timeLabel(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

/** "Tuesday, October 7" in `tz`. */
export function longDateLabel(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(iso));
}

/** "9:00 – 9:30 AM" (or "11:30 AM – 12:00 PM") in `tz`. */
export function timeRangeLabel(startIso: string, endIso: string, tz: string): string {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (typeof fmt.formatRange === 'function') return fmt.formatRange(start, end).replace(/\s*[–-]\s*/, ' – ');
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}

/** The end of a slot that lasts `minutes`. */
export function slotEnd(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

/** "New York (EDT)": the zone's city and its short name at `at`. */
export function zoneLabel(tz: string, at: Date = new Date()): string {
  const city = (tz.split('/').pop() ?? tz).replace(/_/g, ' ');
  let short = '';
  try {
    short = part(new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(at), 'timeZoneName');
  } catch {
    short = '';
  }
  if (tz === 'UTC' || tz === 'Etc/UTC') return 'UTC';
  return short && short !== city ? `${city} (${short})` : city;
}
