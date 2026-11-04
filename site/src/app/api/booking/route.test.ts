// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

// The Worker's bindings (src/lib/platform.ts) exist only in a Worker; this test has none.
vi.mock('../../../lib/platform', () => ({ bindings: () => ({}) }));

const FN_URL = 'https://db.test/functions/v1/google-calendar';
const FUTURE = new Date(Date.now() + 3 * 864e5).toISOString();

const fetchMock = vi.fn();

function fn(body: unknown, status = 200) {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://nixgensolutions.com/api/booking', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: 'nixgensolutions.com',
      origin: 'https://nixgensolutions.com',
      'sec-fetch-site': 'same-origin',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const VALID = { start: FUTURE, name: '  Maya   Santos ', email: 'maya@kalyecoffee.ph', customerTz: 'America/New_York' };

function sentBody(): Record<string, unknown> {
  const calls = fetchMock.mock.calls.filter(([u]) => String(u) === FN_URL);
  expect(calls).toHaveLength(1);
  return JSON.parse(calls[0][1].body as string);
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://db.test');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('BOOKING_API_SECRET', 'booking-secret');
  vi.stubEnv('LEAD_IP_SALT', 'salt');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/booking', () => {
  it('books, never cached, with cleaned input and an ip_hash', async () => {
    fn({ ok: true, start: FUTURE, end: FUTURE, title: 'Discovery call', meetUrl: 'https://meet.google.com/x', invited: true });
    const res = await POST(req(VALID, { 'cf-connecting-ip': '203.0.113.7' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      ok: true,
      start: FUTURE,
      end: FUTURE,
      title: 'Discovery call',
      meetUrl: 'https://meet.google.com/x',
      invited: true,
    });
    const body = sentBody();
    expect(body).toMatchObject({ action: 'book', start: FUTURE, name: 'Maya Santos', email: 'maya@kalyecoffee.ph', customer_tz: 'America/New_York' });
    expect(body.ip_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses missing or bad name, email and start without calling the function', async () => {
    const res = await POST(req({ start: '2020-01-01T00:00:00Z', name: ' ', email: 'maya@' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, reason: 'invalid', fields: ['name', 'email', 'start'] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('drops an unknown time zone instead of forwarding it', async () => {
    fn({ ok: true, start: FUTURE, end: FUTURE, invited: false });
    await POST(req({ ...VALID, customerTz: 'Mars/Olympus' }));
    expect(sentBody()).not.toHaveProperty('customer_tz');
  });

  it('answers a filled honeypot as if it worked, and books nothing', async () => {
    const res = await POST(req({ ...VALID, _honey: 'bot' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['slot_taken', 409],
    ['throttled', 429],
    ['invalid', 400],
    ['disabled', 403],
  ] as const)('maps %s to %i', async (reason, status) => {
    fn({ ok: false, reason });
    const res = await POST(req(VALID));
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ ok: false, reason });
  });

  it('503 when not configured, 502 when the function fails, 504 when it is slow', async () => {
    vi.stubEnv('BOOKING_API_SECRET', '');
    expect((await POST(req(VALID))).status).toBe(503);
    vi.stubEnv('BOOKING_API_SECRET', 'booking-secret');

    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));
    expect((await POST(req(VALID))).status).toBe(502);

    fetchMock.mockRejectedValue(Object.assign(new Error('slow'), { name: 'TimeoutError' }));
    const slow = await POST(req(VALID));
    expect(slow.status).toBe(504);
    expect(((await slow.json()) as { error: string }).error).toMatch(/may still have gone through/);
  });

  it('503 when the function rejects our secret (401) or our request (403)', async () => {
    fn({ error: 'unauthorized' }, 401);
    expect((await POST(req(VALID))).status).toBe(503);
    fn({ error: 'forbidden' }, 403);
    expect((await POST(req(VALID))).status).toBe(503);
  });

  it("502 when the function says unavailable, on a 200 or a 503", async () => {
    fn({ ok: false, reason: 'unavailable' });
    expect((await POST(req(VALID))).status).toBe(502);
    fn({ ok: false, reason: 'unavailable' }, 503);
    const res = await POST(req(VALID));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ ok: false, reason: 'unavailable' });
  });

  it('refuses a cross-site post and a non-JSON body', async () => {
    expect((await POST(req(VALID, { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }))).status).toBe(403);
    expect((await POST(req(VALID, { 'content-type': 'text/plain' }))).status).toBe(415);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
