// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Worker's bindings (src/lib/platform.ts reads them from the Worker,
// which Node does not have); each test sets the ones it needs.
const { env } = vi.hoisted(() => ({ env: { current: {} as Record<string, unknown> } }));
vi.mock('../../../lib/platform', () => ({ bindings: () => env.current }));

import { GET, HEAD } from './route';

const URL_ = 'https://nixgensolutions.com/api/health';
const SUPABASE = 'https://db.test';
const VERSION = 'f1e2d3c4-0000-4000-8000-123456789abc';
const RAY = '8f1e2d3c4b5a6978-AMS';
const ANON_JWT = 'eyJhbGciOiJIUzI1NiJ9.e30.sig';

const fetchMock = vi.fn();
const limit = vi.fn();

function req(query = '', init: RequestInit = {}): Request {
  return new Request(`${URL_}${query}`, { ...init, headers: { 'cf-ray': RAY, ...(init.headers as Record<string, string>) } });
}

function logged(level: 'warn' | 'error'): Array<Record<string, unknown>> {
  return vi.mocked(console[level]).mock.calls.map(([line]) => JSON.parse(String(line)));
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response('[{"id":"1"}]', { status: 200 }));
  limit.mockReset();
  limit.mockResolvedValue({ success: true });
  env.current = { API_LIMITER: { limit }, CF_VERSION_METADATA: { id: VERSION, tag: '', timestamp: '2026-10-04T00:00:00Z' } };
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', `${SUPABASE}/`);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', ANON_JWT);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('GET /api/health', () => {
  it('answers 200 with the service, the deployed version and the time, never cached', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-04T12:00:00.000Z'));
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(res.headers.get('x-request-id')).toBe(RAY);
    expect(await res.json()).toEqual({
      ok: true,
      service: 'nixgen-site',
      version: VERSION,
      time: '2026-10-04T12:00:00.000Z',
    });
  });

  it('asks neither the database nor the limiter on the plain check', async () => {
    await GET(req());
    await GET(req('?deep=0'));
    await GET(req('?deep=true'));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(limit).not.toHaveBeenCalled();
  });

  it('reports version null when the binding is absent or has no id', async () => {
    for (const bindings of [{}, { CF_VERSION_METADATA: {} }, { CF_VERSION_METADATA: { id: '' } }, { CF_VERSION_METADATA: { id: 7 } }]) {
      env.current = bindings;
      const body = (await (await GET(req())).json()) as Record<string, unknown>;
      expect(body).toMatchObject({ ok: true, version: null });
    }
    // The platform itself missing must not take the endpoint down either.
    env.current = null as unknown as Record<string, unknown>;
    expect(await (await GET(req())).json()).toMatchObject({ ok: true, version: null });
  });

  it('says nothing about configuration: no env names, keys or addresses', async () => {
    vi.stubEnv('LEAD_INTAKE_SECRET', 'intake-secret-value');
    for (const query of ['', '?deep=1']) {
      const res = await GET(req(query));
      const text = await res.text();
      expect(Object.keys(JSON.parse(text)).sort()).toEqual(
        query ? ['checks', 'ok', 'service', 'time', 'version'] : ['ok', 'service', 'time', 'version'],
      );
      expect(text).not.toContain(ANON_JWT);
      expect(text).not.toContain('db.test');
      expect(text).not.toContain('intake-secret-value');
      expect(text).not.toMatch(/SUPABASE|SECRET|NEXT_PUBLIC/i);
    }
  });
});

describe('GET /api/health?deep=1', () => {
  it('reads one showcase_items id with the anon key, 2 s at most, and reports ok', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const res = await GET(req('?deep=1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ ok: true, version: VERSION, checks: { database: 'ok' } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${SUPABASE}/rest/v1/showcase_items?select=id&limit=1`);
    expect(init.method ?? 'GET').toBe('GET');
    expect(init.headers).toEqual({ apikey: ANON_JWT, Accept: 'application/json', Authorization: `Bearer ${ANON_JWT}` });
    expect(init.cache).toBe('no-store');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(timeout).toHaveBeenCalledWith(2_000);
  });

  it('keeps a publishable key out of Authorization, as the showcase read does', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'sb_publishable_abc');
    await GET(req('?deep=1'));
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ apikey: 'sb_publishable_abc', Accept: 'application/json' });
  });

  it('counts zero rows as an answer', async () => {
    fetchMock.mockResolvedValue(new Response('[]', { status: 200 }));
    expect(await (await GET(req('?deep=1'))).json()).toMatchObject({ ok: true, checks: { database: 'ok' } });
  });

  it('answers 503 with database down on an error status, logging the status only', async () => {
    fetchMock.mockResolvedValue(new Response('{"code":"42501","message":"permission denied"}', { status: 401 }));
    const res = await GET(req('?deep=1'));
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-request-id')).toBe(RAY);
    expect(await res.json()).toMatchObject({ ok: false, service: 'nixgen-site', version: VERSION, checks: { database: 'down' } });
    expect(logged('error')).toEqual([{ route: 'health', event: 'database_down', status: 401, request_id: RAY }]);
  });

  it('answers 503 when the database is unreachable or too slow, logging the error name only', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError(`fetch failed for ${SUPABASE}`));
    expect((await GET(req('?deep=1'))).status).toBe(503);
    fetchMock.mockRejectedValueOnce(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    const slow = await GET(req('?deep=1'));
    expect(slow.status).toBe(503);
    expect(await slow.json()).toMatchObject({ ok: false, checks: { database: 'down' } });
    expect(logged('error')).toEqual([
      { route: 'health', event: 'database_down', error: 'TypeError', request_id: RAY },
      { route: 'health', event: 'database_down', error: 'TimeoutError', request_id: RAY },
    ]);
    expect(vi.mocked(console.error).mock.calls.join('\n')).not.toContain('db.test');
  });

  it('answers 503 for an address that is not a URL, without calling out', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'not a url');
    const res = await GET(req('?deep=1'));
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports unconfigured, still 200, on a build without Supabase values', async () => {
    for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
      vi.stubEnv(name, ' ');
      const res = await GET(req('?deep=1'));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, checks: { database: 'unconfigured' } });
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE);
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', ANON_JWT);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('answers 429 with Retry-After past the limit, before the database is asked', async () => {
    limit.mockResolvedValue({ success: false });
    const res = await GET(req('?deep=1', { headers: { 'cf-connecting-ip': '203.0.113.9' } }));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-request-id')).toBe(RAY);
    expect(await res.json()).toEqual({ ok: false, service: 'nixgen-site', error: 'Too many requests.' });
    expect(limit).toHaveBeenCalledExactlyOnceWith({ key: 'health:203.0.113.9' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still runs the check when the limiter is missing, and says so in the log', async () => {
    env.current = {};
    const res = await GET(req('?deep=1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, version: null, checks: { database: 'ok' } });
    expect(logged('warn')).toEqual([
      { route: 'health', event: 'limiter_unavailable', scope: 'health', reason: 'no_binding', request_id: RAY },
    ]);
  });
});

describe('HEAD /api/health', () => {
  it('answers like GET, without a body', async () => {
    const res = await HEAD(req('', { method: 'HEAD' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-request-id')).toBe(RAY);
    expect(await res.text()).toBe('');
  });

  it('carries the deep verdict in the status: 503 when the database is down, 429 past the limit', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));
    const down = await HEAD(req('?deep=1', { method: 'HEAD' }));
    expect(down.status).toBe(503);
    expect(await down.text()).toBe('');

    limit.mockResolvedValue({ success: false });
    const limited = await HEAD(req('?deep=1', { method: 'HEAD' }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expect(await limited.text()).toBe('');
  });
});
