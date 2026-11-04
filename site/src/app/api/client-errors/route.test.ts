// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Worker's bindings (src/lib/platform.ts reads them from the Worker,
// which Node does not have). `limit` is the API_LIMITER binding's method.
const { limit } = vi.hoisted(() => ({ limit: vi.fn() }));
vi.mock('../../../lib/platform', () => ({ bindings: () => ({ API_LIMITER: { limit } }) }));

import { POST } from './route';

const URL_ = 'https://workspace.nixgensolutions.com/api/client-errors';
// What Cloudflare sends as cf-ray; the route answers with it and logs it.
const RAY = '8f1e2d3c4b5a6978-AMS';

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(URL_, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: 'workspace.nixgensolutions.com',
      origin: 'https://workspace.nixgensolutions.com',
      'cf-ray': RAY,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function lastLog(): Record<string, unknown> {
  const calls = vi.mocked(console.error).mock.calls;
  return JSON.parse(String(calls[calls.length - 1][0]));
}

function clientErrorLines(): unknown[] {
  return vi.mocked(console.error).mock.calls.filter(([l]) => String(l).includes('client_error'));
}

beforeEach(() => {
  limit.mockReset();
  limit.mockResolvedValue({ success: true });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/client-errors', () => {
  it('logs one scrubbed JSON line and answers 204 with no body', async () => {
    const res = await POST(
      req({
        kind: 'boundary',
        app: 'workspace',
        name: 'TypeError',
        message: 'Cannot read x of undefined for ada@example.com',
        stack: 'TypeError: boom\n    at f (https://workspace.nixgensolutions.com/assets/a.js?token=abc:1:2)',
        digest: '0a1b2c3d',
        url: 'https://workspace.nixgensolutions.com/projects/42?access_token=secret#frag',
        release: '2026.10.03',
        cookies: 'sid=1',
        breadcrumbs: ['clicked'],
      }),
    );
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(res.headers.get('x-request-id')).toBe(RAY);
    expect(lastLog()).toEqual({
      route: 'client-errors',
      event: 'client_error',
      kind: 'boundary',
      app: 'workspace',
      name: 'TypeError',
      message: 'Cannot read x of undefined for [email]',
      stack: 'TypeError: boom\n    at f (https://workspace.nixgensolutions.com/assets/a.js:1:2)',
      digest: '0a1b2c3d',
      path: '/projects/42',
      release: '2026.10.03',
      request_id: RAY,
    });
  });

  it('keeps only name and digest from the Vault', async () => {
    await POST(req({ name: 'Error', message: 'decrypt failed: hunter2', stack: 'x', digest: 'd1', url: '/workspace/vault/item/9' }));
    expect(lastLog()).toMatchObject({ name: 'Error', message: null, stack: null, digest: 'd1', path: '/vault' });
  });

  it('refuses cross-site, non-JSON and oversized reports without logging', async () => {
    const crossSite = await POST(req({ message: 'x' }, { origin: 'https://evil.example' }));
    expect(crossSite.status).toBe(403);
    expect(crossSite.headers.get('x-request-id')).toBe(RAY);
    expect((await POST(req({ message: 'x' }, { 'content-type': 'text/plain' }))).status).toBe(415);
    expect((await POST(req({ message: 'x'.repeat(20_000) }))).status).toBe(413);
    expect(clientErrorLines()).toHaveLength(0);
  });

  it('a report cannot replace the request id of its own log line', async () => {
    await POST(req({ name: 'Error', request_id: 'forged', route: 'forged' }));
    expect(lastLog()).toMatchObject({ event: 'client_error', request_id: RAY });
  });
});

describe('rate limit', () => {
  it('answers an empty 429 with Retry-After once the visitor is over the limit, before reading the body', async () => {
    limit.mockResolvedValue({ success: false });
    const request = req({ name: 'TypeError', message: 'boom' }, { 'cf-connecting-ip': '203.0.113.9' });
    const res = await POST(request);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-request-id')).toBe(RAY);
    expect(await res.text()).toBe('');
    expect(request.bodyUsed).toBe(false);
    expect(clientErrorLines()).toHaveLength(0);
    expect(limit).toHaveBeenCalledExactlyOnceWith({ key: 'client-errors:203.0.113.9' });
  });

  it('counts a caller that sends no Origin (a script, not a browser) like any other', async () => {
    const r = new Request(URL_, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' },
      body: '{"name":"x"}',
    });
    expect((await POST(r)).status).toBe(204);
    limit.mockResolvedValue({ success: false });
    const again = new Request(URL_, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' },
      body: '{"name":"x"}',
    });
    expect((await POST(again)).status).toBe(429);
    expect(clientErrorLines()).toHaveLength(1);
  });

  it('counts refused requests too: the limiter runs before the origin and content-type checks', async () => {
    await POST(req({ message: 'x' }, { origin: 'https://evil.example' }));
    await POST(req({ message: 'x' }, { 'content-type': 'text/plain' }));
    expect(limit).toHaveBeenCalledTimes(2);
  });

  it('still takes the report when the limiter is broken, and says so in the log', async () => {
    limit.mockRejectedValue(new Error('limiter down'));
    const res = await POST(req({ name: 'TypeError' }, { 'cf-connecting-ip': '203.0.113.9' }));
    expect(res.status).toBe(204);
    expect(clientErrorLines()).toHaveLength(1);
    const warned = vi.mocked(console.warn).mock.calls.map(([l]) => String(l));
    expect(warned.map((l) => JSON.parse(l))).toContainEqual({
      route: 'client-errors',
      event: 'limiter_unavailable',
      scope: 'client-errors',
      reason: 'threw',
      error: 'Error',
      request_id: RAY,
    });
    expect(warned.join('\n')).not.toContain('203.0.113.9');
  });
});
