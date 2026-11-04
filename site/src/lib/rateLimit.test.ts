// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Worker's bindings (src/lib/platform.ts) exist only in a Worker;
// the mock is also where each test says which bindings the Worker has.
const { env } = vi.hoisted(() => ({ env: { current: {} as Record<string, unknown> } }));
vi.mock('./platform', () => ({ bindings: () => env.current }));

import { requestLog } from './guard';
import { RATE_LIMIT_WINDOW_SECONDS, rateLimited } from './rateLimit';

const limit = vi.fn();

function req(headers: Record<string, string> = {}): Request {
  return new Request('https://nixgensolutions.com/api/x', { method: 'POST', headers });
}

function warned(): Array<Record<string, unknown>> {
  return vi.mocked(console.warn).mock.calls.map(([line]) => JSON.parse(String(line)));
}

beforeEach(() => {
  limit.mockReset();
  limit.mockResolvedValue({ success: true });
  env.current = { API_LIMITER: { limit } };
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('rateLimited', () => {
  it('matches the binding declared in wrangler.jsonc', () => {
    expect(RATE_LIMIT_WINDOW_SECONDS).toBe(60);
  });

  it('lets a visitor under the limit through, keyed by scope and IP', async () => {
    expect(await rateLimited(req({ 'cf-connecting-ip': '203.0.113.9' }), 'client-errors')).toBe(false);
    expect(limit).toHaveBeenCalledExactlyOnceWith({ key: 'client-errors:203.0.113.9' });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('refuses a visitor over the limit, without a log line', async () => {
    limit.mockResolvedValue({ success: false });
    expect(await rateLimited(req({ 'cf-connecting-ip': '203.0.113.9' }), 'client-errors')).toBe(true);
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
  });

  it('keys IPv6 by its /64, so rotating the low bits is one visitor', async () => {
    await rateLimited(req({ 'cf-connecting-ip': '2001:db8:1:2:aaaa:bbbb:cccc:dddd' }), 'health');
    await rateLimited(req({ 'cf-connecting-ip': '2001:DB8:1:2::9' }), 'health');
    await rateLimited(req({ 'cf-connecting-ip': '2001:db8:1:3::9' }), 'health');
    await rateLimited(req({ 'cf-connecting-ip': '::ffff:203.0.113.9' }), 'health');
    expect(limit.mock.calls.map(([options]) => options.key)).toEqual([
      'health:2001:db8:1:2::/64',
      'health:2001:db8:1:2::/64',
      'health:2001:db8:1:3::/64',
      'health:203.0.113.9',
    ]);
  });

  it('gives callers without an IP one shared bucket per scope', async () => {
    await rateLimited(req(), 'health');
    await rateLimited(req({ 'x-forwarded-for': '203.0.113.9' }), 'client-errors');
    expect(limit.mock.calls.map(([options]) => options.key)).toEqual(['health:unknown', 'client-errors:unknown']);
  });

  it('fails open with one warn line when the binding is missing', async () => {
    for (const bindings of [{}, { API_LIMITER: undefined }, { API_LIMITER: {} }]) {
      vi.mocked(console.warn).mockClear();
      env.current = bindings;
      expect(await rateLimited(req({ 'cf-connecting-ip': '203.0.113.9' }), 'client-errors')).toBe(false);
      expect(warned()).toEqual([
        { route: 'client-errors', event: 'limiter_unavailable', scope: 'client-errors', reason: 'no_binding' },
      ]);
    }
    expect(limit).not.toHaveBeenCalled();
  });

  it('fails open with one warn line when the binding throws or rejects', async () => {
    limit.mockRejectedValueOnce(new TypeError('internal error'));
    expect(await rateLimited(req({ 'cf-connecting-ip': '203.0.113.9' }), 'health')).toBe(false);
    limit.mockImplementationOnce(() => {
      throw new RangeError('bad key');
    });
    expect(await rateLimited(req({ 'cf-connecting-ip': '203.0.113.9' }), 'health')).toBe(false);
    expect(warned()).toEqual([
      { route: 'health', event: 'limiter_unavailable', scope: 'health', reason: 'threw', error: 'TypeError' },
      { route: 'health', event: 'limiter_unavailable', scope: 'health', reason: 'threw', error: 'RangeError' },
    ]);
  });

  it('fails open when the platform itself cannot be asked', async () => {
    env.current = null as unknown as Record<string, unknown>;
    expect(await rateLimited(req(), 'health')).toBe(false);
    expect(warned()).toEqual([expect.objectContaining({ event: 'limiter_unavailable', reason: 'threw' })]);
  });

  it('treats an answer without a verdict as allowed', async () => {
    limit.mockResolvedValue(undefined);
    expect(await rateLimited(req(), 'health')).toBe(false);
  });

  it('never logs the IP or the key', async () => {
    const ip = '203.0.113.9';
    env.current = {};
    await rateLimited(req({ 'cf-connecting-ip': ip }), 'client-errors');
    env.current = { API_LIMITER: { limit } };
    limit.mockRejectedValue(new Error(`limit failed for client-errors:${ip}`));
    await rateLimited(req({ 'cf-connecting-ip': ip }), 'client-errors');
    const lines = vi.mocked(console.warn).mock.calls.map(([line]) => String(line));
    expect(lines).toHaveLength(2);
    expect(lines.join('\n')).not.toContain(ip);
    expect(lines.join('\n')).not.toContain('client-errors:');
  });

  it("writes its warn line through the request's log, with the request id", async () => {
    env.current = {};
    const request = req({ 'cf-ray': '8f1e2d3c4b5a6978-AMS' });
    expect(await rateLimited(request, 'health', requestLog('health', request))).toBe(false);
    expect(warned()).toEqual([
      {
        route: 'health',
        event: 'limiter_unavailable',
        scope: 'health',
        reason: 'no_binding',
        request_id: '8f1e2d3c4b5a6978-AMS',
      },
    ]);
  });
});
