// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

// The Worker's bindings (src/lib/platform.ts) exist only in a Worker; this test has none.
vi.mock('../../../../lib/platform', () => ({ bindings: () => ({}) }));

const fetchMock = vi.fn();

function req(headers: Record<string, string> = {}): Request {
  return new Request('https://nixgensolutions.com/api/booking/slots', {
    headers: { host: 'nixgensolutions.com', 'sec-fetch-site': 'same-origin', ...headers },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://db.test');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('BOOKING_API_SECRET', 'booking-secret');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /api/booking/slots', () => {
  it('passes open times through, never cached', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, tz: 'Asia/Manila', minutes: 30, title: 'Discovery call', days: [{ date: '2026-10-07', slots: ['2026-10-07T01:00:00Z'] }], google: 'team_only' }),
      ),
    );
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      ok: true,
      tz: 'Asia/Manila',
      minutes: 30,
      title: 'Discovery call',
      days: [{ date: '2026-10-07', slots: ['2026-10-07T01:00:00.000Z'] }],
      daysAhead: null,
      google: 'team_only',
    });
  });

  it('says disabled with a 200, so the page can explain', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: false, reason: 'disabled' })));
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, reason: 'disabled' });
  });

  it('503 / 502 / 504 for not configured, failing and slow', async () => {
    vi.stubEnv('BOOKING_API_SECRET', '');
    expect((await GET(req())).status).toBe(503);
    vi.stubEnv('BOOKING_API_SECRET', 'booking-secret');
    fetchMock.mockResolvedValue(new Response('x', { status: 500 }));
    expect((await GET(req())).status).toBe(502);
    fetchMock.mockRejectedValue(Object.assign(new Error('slow'), { name: 'TimeoutError' }));
    expect((await GET(req())).status).toBe(504);
  });

  it('maps the function’s 503 unavailable to 502, and its 401 to 503', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: false, reason: 'unavailable' }), { status: 503 }));
    expect((await GET(req())).status).toBe(502);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'no' }), { status: 401 }));
    expect((await GET(req())).status).toBe(503);
  });

  it('refuses another site', async () => {
    const res = await GET(req({ 'sec-fetch-site': 'cross-site' }));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
