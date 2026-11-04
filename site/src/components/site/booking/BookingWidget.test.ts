import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { BookingWidget, type SlotsPayload } from './BookingWidget';

// Server-render smoke tests with injected open times (the page itself loads
// them in the browser). Labels depend on the runtime's zone, so these check
// structure, not clock times.

const SLOTS: SlotsPayload = {
  tz: 'Asia/Manila',
  minutes: 30,
  title: 'Discovery call',
  days: [
    { date: '2026-10-08', slots: ['2026-10-08T01:00:00.000Z', '2026-10-08T01:30:00.000Z', '2026-10-08T02:00:00.000Z'] },
    { date: '2026-10-12', slots: ['2026-10-12T01:00:00.000Z'] },
  ],
  daysAhead: 14,
  google: 'checked',
};

const render = (props: Parameters<typeof BookingWidget>[0]) => renderToString(createElement(BookingWidget, props));

describe('BookingWidget', () => {
  it('shows days and times as radio groups, the zone note, and the details form', () => {
    const html = render({ initial: SLOTS });
    expect(html).toContain('role="radiogroup" aria-label="Day"');
    expect(html).toMatch(/role="radiogroup" aria-label="Times on /);
    // The first day is selected by default; its three times are offered.
    expect(html.match(/role="radio"/g)?.length).toBeGreaterThanOrEqual(2 + 3);
    expect(html).toContain('Times in');
    expect(html).toContain('Pick a day and a time above.');
    expect(html).toContain('name="_honey"');
    expect(html).toContain('Confirm booking');
    expect(html).toContain('Google Calendar invite with the video call link');
  });

  it('prefills name and email from the link', () => {
    const html = render({ initial: SLOTS, prefill: { name: 'Maya Santos', email: 'maya@kalyecoffee.ph' } });
    expect(html).toContain('value="Maya Santos"');
    expect(html).toContain('value="maya@kalyecoffee.ph"');
  });

  it('offers a brief instead when there are no open times', () => {
    const html = render({ initial: { ...SLOTS, days: [] } });
    expect(html).toContain('No open times');
    expect(html).toContain('in the next 14 days');
    expect(html).toContain('href="/contact"');
  });

  it('says invites go by email when Google is not connected', () => {
    const html = render({ initial: { ...SLOTS, google: 'not_connected' } });
    expect(html).toContain('We confirm by email right after you book.');
  });

  it('starts on a loading skeleton without injected times', () => {
    expect(render({})).toContain('aria-label="Loading open times"');
  });
});
