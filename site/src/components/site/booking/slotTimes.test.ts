import { describe, expect, it } from 'vitest';
import { groupByLocalDay, localDateKey, slotEnd, timeLabel, timeRangeLabel, zoneLabel } from './slotTimes';

// 9:00 and 9:30 on Thu 8 Oct in Manila (UTC+8) are 01:00 / 01:30 UTC — and
// still Wednesday 7 Oct, 21:00 / 21:30, in New York (UTC−4 in October).
const DAYS = [
  { date: '2026-10-08', slots: ['2026-10-08T01:00:00.000Z', '2026-10-08T01:30:00.000Z', '2026-10-08T06:00:00.000Z'] },
  { date: '2026-10-09', slots: ['2026-10-09T01:00:00.000Z'] },
];

describe('slot times', () => {
  it('regroups slots by the visitor’s own calendar day', () => {
    const ny = groupByLocalDay(DAYS, 'America/New_York');
    expect(ny.map((d) => d.key)).toEqual(['2026-10-07', '2026-10-08']);
    expect(ny[0]).toMatchObject({ weekday: 'Wed', date: 'Oct 7', slots: ['2026-10-08T01:00:00.000Z', '2026-10-08T01:30:00.000Z'] });
    expect(ny[1].slots).toEqual(['2026-10-08T06:00:00.000Z', '2026-10-09T01:00:00.000Z']);

    const manila = groupByLocalDay(DAYS, 'Asia/Manila');
    expect(manila.map((d) => `${d.weekday} ${d.date}`)).toEqual(['Thu Oct 8', 'Fri Oct 9']);
  });

  it('labels times in the zone it is given', () => {
    expect(timeLabel('2026-10-08T01:00:00.000Z', 'Asia/Manila')).toBe('9:00 AM');
    expect(timeLabel('2026-10-08T01:00:00.000Z', 'America/New_York')).toBe('9:00 PM');
    expect(localDateKey('2026-10-08T01:00:00.000Z', 'America/New_York')).toBe('2026-10-07');
  });

  it('follows daylight saving: the same UTC hour is an hour apart across the switch', () => {
    // New York leaves DST on 1 Nov 2026.
    expect(timeLabel('2026-10-30T13:00:00.000Z', 'America/New_York')).toBe('9:00 AM');
    expect(timeLabel('2026-11-06T13:00:00.000Z', 'America/New_York')).toBe('8:00 AM');
  });

  it('formats a range and a slot end', () => {
    const end = slotEnd('2026-10-08T01:00:00.000Z', 30);
    expect(end).toBe('2026-10-08T01:30:00.000Z');
    const label = timeRangeLabel('2026-10-08T01:00:00.000Z', end, 'Asia/Manila');
    expect(label.replace(/\s/g, ' ')).toMatch(/^9:00 – 9:30 AM$|^9:00 AM – 9:30 AM$/);
  });

  it('names a zone by its city and short name', () => {
    expect(zoneLabel('America/New_York', new Date('2026-10-08T00:00:00Z'))).toBe('New York (EDT)');
    expect(zoneLabel('Asia/Manila', new Date('2026-10-08T00:00:00Z'))).toMatch(/^Manila \((GMT\+8|PHT|PST)\)$/);
    expect(zoneLabel('UTC')).toBe('UTC');
  });
});
