// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBooking, getBookingSlots, validTimeZone } from './booking';

const SUPABASE = 'https://db.test';
const FN_URL = `${SUPABASE}/functions/v1/google-calendar`;
const START = '2026-10-07T01:00:00.000Z';

const fetchMock = vi.fn();
const logs: string[] = [];

function answer(body: unknown, status = 200) {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

function sent(): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  return { url: String(url), headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) };
}

const SLOTS = {
  ok: true,
  tz: 'Asia/Manila',
  minutes: 30,
  title: 'Discovery call',
  days: [
    { date: '2026-10-08', slots: ['2026-10-08T01:30:00Z', '2026-10-08T01:00:00Z', 'garbage'] },
    { date: '2026-10-07', slots: [START] },
    { date: 'not-a-date', slots: [START] },
  ],
  google: 'checked',
};

beforeEach(() => {
  fetchMock.mockReset();
  logs.length = 0;
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', `${SUPABASE}/`);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('BOOKING_API_SECRET', 'booking-secret');
  for (const level of ['info', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((line: string) => void logs.push(line));
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('getBookingSlots', () => {
  it('asks the function with the gateway key and the booking secret', async () => {
    answer(SLOTS);
    await getBookingSlots();
    const { url, headers, body } = sent();
    expect(url).toBe(FN_URL);
    expect(body).toEqual({ action: 'slots' });
    expect(headers).toMatchObject({
      apikey: 'anon-key',
      Authorization: 'Bearer anon-key',
      'x-booking-secret': 'booking-secret',
      'Content-Type': 'application/json',
    });
  });

  it('returns clean, sorted days and drops malformed entries', async () => {
    answer(SLOTS);
    expect(await getBookingSlots()).toEqual({
      status: 'open',
      tz: 'Asia/Manila',
      minutes: 30,
      title: 'Discovery call',
      days: [
        { date: '2026-10-07', slots: [START] },
        { date: '2026-10-08', slots: ['2026-10-08T01:00:00.000Z', '2026-10-08T01:30:00.000Z'] },
      ],
      daysAhead: null,
      google: 'checked',
    });
  });

  it('reads days_ahead when the function sends it, and defaults an unknown google state', async () => {
    answer({ ...SLOTS, days_ahead: 14, google: 'weird' });
    const r = await getBookingSlots();
    expect(r).toMatchObject({ status: 'open', daysAhead: 14, google: 'not_connected' });
  });

  it('maps disabled, a bad zone, a 5xx and a timeout', async () => {
    answer({ ok: false, reason: 'disabled' });
    expect(await getBookingSlots()).toEqual({ status: 'disabled' });

    fetchMock.mockReset();
    answer({ ...SLOTS, tz: 'Not/AZone' });
    expect(await getBookingSlots()).toEqual({ status: 'unavailable' });

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
    expect(await getBookingSlots()).toEqual({ status: 'unavailable' });

    fetchMock.mockReset();
    fetchMock.mockRejectedValue(Object.assign(new Error('slow'), { name: 'TimeoutError' }));
    expect(await getBookingSlots()).toEqual({ status: 'timeout' });
  });

  it('reads a 503 { ok: false, reason: unavailable } as unavailable', async () => {
    answer({ ok: false, reason: 'unavailable' }, 503);
    expect(await getBookingSlots()).toEqual({ status: 'unavailable' });
  });

  it.each([401, 403])('treats a %i (wrong secret / Origin header) as not configured', async (status) => {
    answer({ error: 'nope' }, status);
    expect(await getBookingSlots()).toEqual({ status: 'not_configured' });
  });

  it('never calls the function without its secret', async () => {
    vi.stubEnv('BOOKING_API_SECRET', '');
    expect(await getBookingSlots()).toEqual({ status: 'not_configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('createBooking', () => {
  const INPUT = {
    start: START,
    name: 'Maya Santos',
    email: 'maya@kalyecoffee.ph',
    company: 'Kalye Coffee Co.',
    notes: 'Online ordering',
    customerTz: 'America/New_York',
    ipHash: 'abc123',
  };

  it('sends the booking in the contract shape', async () => {
    answer({ ok: true, start: START, end: '2026-10-07T01:30:00Z', title: 'Discovery call', meetUrl: 'https://meet.google.com/abc-defg-hij', invited: true });
    const r = await createBooking(INPUT);
    expect(sent().body).toEqual({
      action: 'book',
      start: START,
      name: 'Maya Santos',
      email: 'maya@kalyecoffee.ph',
      company: 'Kalye Coffee Co.',
      notes: 'Online ordering',
      customer_tz: 'America/New_York',
      ip_hash: 'abc123',
    });
    expect(r).toEqual({
      status: 'booked',
      start: START,
      end: '2026-10-07T01:30:00.000Z',
      title: 'Discovery call',
      meetUrl: 'https://meet.google.com/abc-defg-hij',
      invited: true,
    });
  });

  it('passes on only an https Meet link', async () => {
    answer({ ok: true, start: START, end: START, meetUrl: 'javascript:alert(1)', invited: false });
    expect(await createBooking(INPUT)).toMatchObject({ meetUrl: null, invited: false });
  });

  it.each(['slot_taken', 'throttled', 'invalid', 'disabled'] as const)('maps the refusal %s (sent with a 200)', async (reason) => {
    answer({ ok: false, reason });
    expect(await createBooking(INPUT)).toEqual({ status: reason });
  });

  it("reads 'unavailable' on a 200 or a 503 as unavailable", async () => {
    answer({ ok: false, reason: 'unavailable' });
    expect(await createBooking(INPUT)).toEqual({ status: 'unavailable' });
    fetchMock.mockReset();
    answer({ ok: false, reason: 'unavailable' }, 503);
    expect(await createBooking(INPUT)).toEqual({ status: 'unavailable' });
  });

  it.each([401, 403])('treats a %i as not configured', async (status) => {
    answer({ ok: false }, status);
    expect(await createBooking(INPUT)).toEqual({ status: 'not_configured' });
  });

  it('keeps invited true when Google has not made the Meet link yet', async () => {
    answer({ ok: true, start: START, end: '2026-10-07T01:30:00Z', meetUrl: null, invited: true });
    expect(await createBooking(INPUT)).toMatchObject({ status: 'booked', meetUrl: null, invited: true });
  });

  it('treats an unknown refusal as unavailable', async () => {
    answer({ ok: false, reason: 'mystery' });
    expect(await createBooking(INPUT)).toEqual({ status: 'unavailable' });
  });

  it('never logs who booked', async () => {
    answer({ ok: true, start: START, end: START, invited: true });
    await createBooking(INPUT);
    answer({ ok: false, reason: 'slot_taken' });
    await createBooking(INPUT);
    const all = logs.join('\n');
    expect(all).not.toContain('maya');
    expect(all).not.toContain('Maya');
    expect(all).not.toContain('Kalye');
    expect(all).not.toContain('Online ordering');
  });
});

describe('validTimeZone', () => {
  it('accepts IANA zones and refuses anything else', () => {
    expect(validTimeZone('Asia/Manila')).toBe('Asia/Manila');
    expect(validTimeZone('Mars/Olympus')).toBeNull();
    expect(validTimeZone(42)).toBeNull();
    expect(validTimeZone('x'.repeat(65))).toBeNull();
  });
});
