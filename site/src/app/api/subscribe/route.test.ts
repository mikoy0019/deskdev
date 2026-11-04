// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Worker's bindings (src/lib/platform.ts reads them from the Worker,
// which Node does not have). `limit` is the API_LIMITER binding's method.
const { limit } = vi.hoisted(() => ({ limit: vi.fn() }));
vi.mock('../../../lib/platform', () => ({ bindings: () => ({ API_LIMITER: { limit } }) }));

import { POST } from './route';

const URL_ = 'https://nixgensolutions.com/api/subscribe';
const RPC_URL = 'https://db.test/rest/v1/rpc/intake_subscriber';
const SUB = { email: 'ada@example.com', consent: true };
// What Cloudflare sends as cf-ray; the route answers with it and logs it.
const RAY = '8f1e2d3c4b5a6978-AMS';
const fetchMock = vi.fn();

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(URL_, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: 'nixgensolutions.com',
      'sec-fetch-site': 'same-origin',
      'cf-ray': RAY,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function rpcAnswers(body: unknown, status = 200) {
  fetchMock.mockImplementation(async (u: string) =>
    String(u).includes('siteverify')
      ? new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }))
      : new Response(JSON.stringify(body), { status }),
  );
}

function rpcCalls() {
  return fetchMock.mock.calls.filter(([u]) => String(u) === RPC_URL);
}

beforeEach(() => {
  limit.mockReset();
  limit.mockResolvedValue({ success: true });
  fetchMock.mockReset();
  rpcAnswers({ ok: true, status: 'subscribed' });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('LEAD_INTAKE_SECRET', 'intake-secret');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://db.test');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('TURNSTILE_SECRET_KEY', '');
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

describe('POST /api/subscribe', () => {
  it('calls intake_subscriber with the anon key, secret and a clean payload', async () => {
    const res = await POST(req({ email: ' ada@example.com ', consent: true, source: 'Footer' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    const [, init] = rpcCalls()[0];
    expect((init.headers as Record<string, string>).apikey).toBe('anon-key');
    expect(JSON.parse(init.body as string)).toEqual({
      p_secret: 'intake-secret',
      p_payload: { email: 'ada@example.com', source: 'footer', consent: true, ip_hash: null, turnstile_ok: null },
    });
  });

  it('defaults an odd source to footer', async () => {
    await POST(req({ email: 'ada@example.com', consent: true, source: '<script>' }));
    // Longer than the database's 32-character slug.
    await POST(req({ email: 'ada@example.com', consent: true, source: 'b'.repeat(33) }));
    await POST(req({ email: 'ada@example.com', consent: true, source: 'Blog_Sidebar' }));
    const sources = rpcCalls().map(([, init]) => JSON.parse(init.body as string).p_payload.source);
    expect(sources).toEqual(['footer', 'footer', 'blog_sidebar']);
  });

  it('answers the same for subscribed and already (no address oracle)', async () => {
    for (const status of ['subscribed', 'already']) {
      rpcAnswers({ ok: true, status });
      const res = await POST(req(SUB));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
    }
  });

  it('fakes success on the honeypot, 400s a bad email', async () => {
    expect(await (await POST(req({ ...SUB, _honey: 'x' }))).json()).toEqual({ success: true });
    expect((await POST(req({ ...SUB, email: 'nope' }))).status).toBe(400);
    expect((await POST(req({ ...SUB, email: 'ada@example.com.' }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('400s without an explicit consent: true, before any call', async () => {
    for (const consent of [undefined, false, 'yes', 1]) {
      const res = await POST(req({ email: 'ada@example.com', consent }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ success: false, error: expect.any(String) });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('runs the shared guard (JSON, same origin, 4 KB cap)', async () => {
    expect((await POST(req(SUB, { 'content-type': 'text/plain' }))).status).toBe(415);
    expect((await POST(req(SUB, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
    expect((await POST(req({ ...SUB, pad: 'x'.repeat(5000) }))).status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('503s when not configured, before any call', async () => {
    vi.stubEnv('LEAD_INTAKE_SECRET', '');
    expect((await POST(req(SUB))).status).toBe(503);
    vi.stubEnv('LEAD_INTAKE_SECRET', 'intake-secret');
    // The salt is required too: without it every caller shares one bucket.
    vi.stubEnv('LEAD_IP_SALT', '');
    expect((await POST(req(SUB))).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a rejected or missing Turnstile token when configured', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'ts');
    expect((await POST(req({ ...SUB, turnstileToken: 'bad' }))).status).toBe(403);
    expect((await POST(req(SUB))).status).toBe(403);
    expect(rpcCalls()).toHaveLength(0);
  });

  it('sends turnstile_ok true on a pass, and null (not false) during a Siteverify outage', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'ts');
    fetchMock.mockImplementation(async (u: string) =>
      String(u).includes('siteverify')
        ? new Response(JSON.stringify({ success: true }))
        : new Response(JSON.stringify({ ok: true, status: 'subscribed' })),
    );
    expect((await POST(req({ ...SUB, turnstileToken: 'tok' }))).status).toBe(200);
    expect(JSON.parse(rpcCalls()[0][1].body as string).p_payload.turnstile_ok).toBe(true);

    fetchMock.mockReset();
    fetchMock.mockImplementation(async (u: string) => {
      if (String(u).includes('siteverify')) throw new TypeError('network');
      return new Response(JSON.stringify({ ok: true, status: 'subscribed' }));
    });
    expect((await POST(req({ ...SUB, turnstileToken: 'tok' }))).status).toBe(200);
    expect(JSON.parse(rpcCalls()[0][1].body as string).p_payload.turnstile_ok).toBeNull();
  });

  it('refuses a flood from one network before the body is read or the database is asked', async () => {
    limit.mockResolvedValue({ success: false });
    const flood = req(SUB, { 'cf-connecting-ip': '2001:db8:1:2:aaaa:bbbb:cccc:dddd' });
    const res = await POST(flood);
    expect(res.status).toBe(429);
    // The limiter's own window, not the database's ten minutes.
    expect(res.headers.get('retry-after')).toBe('60');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ success: false, error: expect.any(String) });
    // One IPv6 visitor is their /64, whatever the low bits say.
    expect(limit).toHaveBeenCalledExactlyOnceWith({ key: 'subscribe:2001:db8:1:2::/64' });
    expect(flood.bodyUsed).toBe(false);
    expect(rpcCalls()).toHaveLength(0);
  });

  it('subscribes when the limiter is missing or broken', async () => {
    limit.mockRejectedValue(new Error('limiter down'));
    expect((await POST(req(SUB))).status).toBe(200);
    expect(rpcCalls()).toHaveLength(1);
  });

  it('maps the database refusals: throttled 429, invalid 400, unverified 403', async () => {
    const cases: Array<[string, number]> = [
      ['throttled', 429],
      ['invalid', 400],
      ['unverified', 403],
    ];
    for (const [status, code] of cases) {
      rpcAnswers({ ok: false, status });
      const res = await POST(req(SUB));
      expect(res.status).toBe(code);
      // Only the throttle says when to come back: the shortest database window (10 minutes).
      expect(res.headers.get('retry-after')).toBe(code === 429 ? '600' : null);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toMatchObject({ success: false, error: expect.any(String) });
    }
  });

  it('answers every outcome with X-Request-Id, and logs the same value as request_id', async () => {
    const ok = await POST(req(SUB));
    expect(ok.headers.get('x-request-id')).toBe(RAY);
    expect(ok.headers.get('retry-after')).toBeNull();
    expect(JSON.parse(String(vi.mocked(console.info).mock.calls[0][0]))).toEqual({
      route: 'subscribe',
      event: 'subscriber_recorded',
      status: 'subscribed',
      request_id: RAY,
    });

    expect((await POST(req(SUB, { 'content-type': 'text/plain' }))).headers.get('x-request-id')).toBe(RAY);
    expect((await POST(req({ ...SUB, email: 'nope' }))).headers.get('x-request-id')).toBe(RAY);
    rpcAnswers({ ok: false, status: 'throttled' });
    expect((await POST(req(SUB))).headers.get('x-request-id')).toBe(RAY);
    expect(vi.mocked(console.warn).mock.calls.map(([l]) => JSON.parse(String(l)))).toContainEqual({
      route: 'subscribe',
      event: 'subscriber_throttled',
      request_id: RAY,
    });
    fetchMock.mockRejectedValue(new TypeError('network'));
    expect((await POST(req(SUB))).headers.get('x-request-id')).toBe(RAY);

    // No cf-ray (off Cloudflare): a made-up id, still on the response.
    const local = await POST(req(SUB, { 'cf-ray': '' }));
    expect(local.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('502 on RPC errors, unknown refusals, network failure and timeout', async () => {
    rpcAnswers({ code: '42883' }, 404);
    expect((await POST(req(SUB))).status).toBe(502);
    rpcAnswers({ ok: false });
    expect((await POST(req(SUB))).status).toBe(502);
    rpcAnswers(null);
    expect((await POST(req(SUB))).status).toBe(502);
    fetchMock.mockRejectedValue(new TypeError('network'));
    expect((await POST(req(SUB))).status).toBe(502);
    fetchMock.mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
    expect((await POST(req(SUB))).status).toBe(502);
    const events = vi.mocked(console.error).mock.calls.map(([l]) => JSON.parse(String(l)).event);
    expect(events).toEqual(
      expect.arrayContaining(['intake_rpc_failed', 'intake_rpc_refused', 'intake_rpc_unreachable', 'intake_rpc_timeout']),
    );
  });

  it('logs a rejected secret (42501) by name, never the secret itself', async () => {
    rpcAnswers({ code: '42501', message: 'forbidden' }, 401);
    expect((await POST(req(SUB))).status).toBe(502);
    const lines = vi.mocked(console.error).mock.calls.map(([l]) => String(l));
    expect(lines.map((l) => JSON.parse(l).event)).toContain('intake_secret_rejected');
    expect(lines.join(' ')).not.toContain('intake-secret');
  });
});
