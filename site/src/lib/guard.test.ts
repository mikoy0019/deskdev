// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueFormToken } from './formToken';
import {
  cleanText,
  clientIp,
  crossSiteReason,
  formTokenVerdict,
  guardJsonPost,
  hasRequestLog,
  honeypotFilled,
  ipHash,
  ipNetwork,
  isEmail,
  logEvent,
  logTo,
  mintRequestId,
  readJsonBody,
  requestId,
  requestLog,
  turnstileVerdict,
  verifyTurnstile,
  withRequestLog,
} from './guard';

const URL_ = 'https://nixgensolutions.com/api/x';
const fetchMock = vi.fn();

function req(headers: Record<string, string> = {}, body: BodyInit | null = '{"a":1}'): Request {
  return new Request(URL_, {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'nixgensolutions.com', ...headers },
    body,
    ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
  } as RequestInit);
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('logEvent', () => {
  it('writes one JSON line at the right level', () => {
    logEvent('contact', 'warn', 'x', { n: 1 });
    logEvent('contact', 'error', 'y');
    logEvent('contact', 'info', 'z');
    expect(JSON.parse(vi.mocked(console.warn).mock.calls[0][0] as string)).toEqual({ route: 'contact', event: 'x', n: 1 });
    expect(JSON.parse(vi.mocked(console.error).mock.calls[0][0] as string)).toEqual({ route: 'contact', event: 'y' });
    expect(JSON.parse(vi.mocked(console.info).mock.calls[0][0] as string)).toEqual({ route: 'contact', event: 'z' });
  });
});

describe('request ids', () => {
  const RAY = '8f1e2d3c4b5a6978-AMS';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const lines = (level: 'info' | 'warn' | 'error') =>
    vi.mocked(console[level]).mock.calls.map(([line]) => JSON.parse(line as string));

  it("uses Cloudflare's Ray ID when there is one, otherwise a random id", () => {
    expect(requestId(req({ 'cf-ray': RAY }))).toBe(RAY);
    expect(requestId(req({ 'cf-ray': ' 8f1e2d3c4b5a6978 ' }))).toBe('8f1e2d3c4b5a6978');
    const a = requestId(req());
    expect(a).toMatch(UUID);
    expect(requestId(req())).not.toBe(a);
  });

  it('does not take over a cf-ray that is not shaped like one', () => {
    // Off Cloudflare the header is the caller's to set; it ends up in logs and a response header.
    for (const forged of ['', 'x', '"},{"event":"forged', 'a b', '<script>', 'f'.repeat(200), '8f1e2d3c4b5a6978-AMS-extra']) {
      expect(requestId(req({ 'cf-ray': forged }))).toMatch(UUID);
    }
  });

  it('takes the id src/proxy.ts handed over when there is no Ray ID', () => {
    const HANDED = '0b6f6f4e-9d2c-4c35-8f0e-2a1d6a3b7c11';
    expect(requestId(req({ 'x-request-id': HANDED }))).toBe(HANDED);
    // On Cloudflare the Ray ID is the id, whatever that header says.
    expect(requestId(req({ 'cf-ray': RAY, 'x-request-id': HANDED }))).toBe(RAY);
    // The proxy only ever hands over a UUID; anything else came from a caller.
    for (const forged of ['x', '"},{"event":"forged', RAY, `${HANDED}-extra`, 'f'.repeat(200)]) {
      const id = requestId(req({ 'x-request-id': forged }));
      expect(id).toMatch(UUID);
      expect(id).not.toBe(forged);
    }
  });

  it('mintRequestId never takes a caller\'s X-Request-Id, and says when the id has to be handed over', () => {
    const SENT = '0b6f6f4e-9d2c-4c35-8f0e-2a1d6a3b7c11';
    expect(mintRequestId(req({ 'cf-ray': RAY, 'x-request-id': SENT }))).toEqual({ id: RAY, handOver: false });
    const made = mintRequestId(req({ 'x-request-id': SENT }));
    expect(made.handOver).toBe(true);
    expect(made.id).toMatch(UUID);
    expect(made.id).not.toBe(SENT);
    expect(mintRequestId(req({ 'cf-ray': '<script>' }))).toMatchObject({ handOver: true });
  });

  it('requestLog adds request_id to every line and offers the response header', () => {
    const log = requestLog('contact', req({ 'cf-ray': RAY }));
    expect(log.id).toBe(RAY);
    expect(log.headers).toEqual({ 'X-Request-Id': RAY });
    log.log('warn', 'x', { n: 1 });
    log.log('error', 'y');
    log.log('info', 'z');
    expect(lines('warn')).toEqual([{ route: 'contact', event: 'x', n: 1, request_id: RAY }]);
    expect(lines('error')).toEqual([{ route: 'contact', event: 'y', request_id: RAY }]);
    expect(lines('info')).toEqual([{ route: 'contact', event: 'z', request_id: RAY }]);
  });

  it('a field called request_id cannot replace the real one', () => {
    requestLog('client-errors', req({ 'cf-ray': RAY })).log('error', 'client_error', { request_id: 'forged' });
    expect(lines('error')).toEqual([{ route: 'client-errors', event: 'client_error', request_id: RAY }]);
  });

  it('logTo writes to a request log, or to a bare route name without an id', () => {
    logTo(requestLog('subscribe', req({ 'cf-ray': RAY })), 'warn', 'a', { n: 1 });
    logTo('cron', 'warn', 'b');
    expect(lines('warn')).toEqual([
      { route: 'subscribe', event: 'a', n: 1, request_id: RAY },
      { route: 'cron', event: 'b' },
    ]);
  });

  it('the shared helpers log under the request id they are handed', async () => {
    const log = requestLog('contact', req({ 'cf-ray': RAY }));
    await guardJsonPost(req({ 'sec-fetch-site': 'cross-site' }), log);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: false, 'error-codes': ['timeout-or-duplicate'] })));
    await verifyTurnstile('s', 'tok', null, log);
    vi.stubEnv('TURNSTILE_SECRET_KEY', 's');
    fetchMock.mockRejectedValue(new TypeError('network'));
    await turnstileVerdict(req(), 'tok', log);
    expect(lines('warn')).toEqual([
      { route: 'contact', event: 'cross_site_refused', reason: 'sec-fetch-site cross-site', request_id: RAY },
      { route: 'contact', event: 'turnstile_rejected', codes: ['timeout-or-duplicate'], request_id: RAY },
    ]);
    expect(lines('error')).toEqual([{ route: 'contact', event: 'turnstile_unavailable', error: 'TypeError', request_id: RAY }]);
  });
});

describe('withRequestLog', () => {
  const RAY = '8f1e2d3c4b5a6978-AMS';

  it('hands the handler the request log and stamps X-Request-Id on what it returns', async () => {
    const handler = withRequestLog('t', async (request, log) => {
      log.log('info', 'seen', { method: request.method });
      return new Response('ok', { status: 201, headers: { 'Cache-Control': 'no-store' } });
    });
    const res = await handler(req({ 'cf-ray': RAY }));
    expect(res.status).toBe(201);
    expect(res.headers.get('x-request-id')).toBe(RAY);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toBe('ok');
    expect(JSON.parse(vi.mocked(console.info).mock.calls[0][0] as string)).toEqual({
      route: 't',
      event: 'seen',
      method: 'POST',
      request_id: RAY,
    });
  });

  it('gives each request its own id', async () => {
    const handler = withRequestLog('t', () => new Response(null, { status: 204 }));
    const a = (await handler(req())).headers.get('x-request-id');
    const b = (await handler(req())).headers.get('x-request-id');
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it('passes the route context through', async () => {
    const handler = withRequestLog('t', async (_request, _log, ctx: { params: Promise<{ leg: string }> }) => {
      return new Response((await ctx.params).leg);
    });
    expect(await (await handler(req(), { params: Promise.resolve({ leg: 'start' }) })).text()).toBe('start');
  });

  it('stamps a response whose headers cannot be changed', async () => {
    const handler = withRequestLog('t', () => Response.redirect('https://nixgensolutions.com/next', 302));
    const res = await handler(req({ 'cf-ray': RAY }));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://nixgensolutions.com/next');
    expect(res.headers.get('x-request-id')).toBe(RAY);
  });

  it('logs a handler that throws under the request id, by error name only, and rethrows', async () => {
    const handler = withRequestLog('t', async () => {
      throw new RangeError('secret detail for ada@example.com');
    });
    await expect(handler(req({ 'cf-ray': RAY }))).rejects.toThrow(RangeError);
    expect(vi.mocked(console.error).mock.calls.map(([l]) => JSON.parse(l as string))).toEqual([
      { route: 't', event: 'handler_threw', error: 'RangeError', request_id: RAY },
    ]);
  });

  it("does not report the framework's own signals (redirect, notFound) as failures", async () => {
    const signal = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/contact;307;' });
    const handler = withRequestLog('t', async () => {
      throw signal;
    });
    await expect(handler(req())).rejects.toBe(signal);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('marks its handlers, so routes.test.ts can tell a bare one', () => {
    expect(hasRequestLog(withRequestLog('t', () => new Response(null)))).toBe(true);
    expect(hasRequestLog(async () => new Response(null))).toBe(false);
    expect(hasRequestLog(undefined)).toBe(false);
  });
});

describe('crossSiteReason', () => {
  it('allows same-origin, a missing Origin, and the request host', () => {
    expect(crossSiteReason(req({ 'sec-fetch-site': 'same-origin', origin: 'https://nixgensolutions.com' }))).toBeNull();
    expect(crossSiteReason(req())).toBeNull();
  });

  it('names the reason for anything else', () => {
    expect(crossSiteReason(req({ 'sec-fetch-site': 'cross-site' }))).toBe('sec-fetch-site cross-site');
    expect(crossSiteReason(req({ origin: 'https://evil.example' }))).toBe('origin evil.example');
    expect(crossSiteReason(req({ origin: 'null' }))).toMatch(/origin|unparseable/);
  });
});

describe('readJsonBody / guardJsonPost', () => {
  it('parses a small JSON body', async () => {
    expect(await readJsonBody(req())).toEqual({ ok: true, body: { a: 1 } });
  });

  it('honours a custom cap, declared or streamed', async () => {
    expect(await readJsonBody(req({ 'content-length': '5000' }), 4096)).toMatchObject({ ok: false, status: 413 });
    const big = JSON.stringify({ s: 'x'.repeat(5000) });
    expect(await readJsonBody(req({}, big), 4096)).toMatchObject({ ok: false, status: 413 });
  });

  it('refuses in order: 415, 403, 413, 400', async () => {
    expect(await guardJsonPost(req({ 'content-type': 'text/plain' }), 't')).toMatchObject({ ok: false, status: 415 });
    expect(await guardJsonPost(req({ 'sec-fetch-site': 'cross-site' }), 't')).toMatchObject({ ok: false, status: 403 });
    expect(await guardJsonPost(req({ 'content-length': String(1e7) }), 't')).toMatchObject({ ok: false, status: 413 });
    expect(await guardJsonPost(req({}, '[1]'), 't')).toMatchObject({ ok: false, status: 400 });
    expect(await guardJsonPost(req({}, '{bad'), 't')).toMatchObject({ ok: false, status: 400 });
    expect(await guardJsonPost(req(), 't')).toEqual({ ok: true, input: { a: 1 } });
  });
});

describe('field helpers', () => {
  it('honeypotFilled only for a non-blank string', () => {
    expect(honeypotFilled({ _honey: 'x' })).toBe(true);
    expect(honeypotFilled({ _honey: '  ' })).toBe(false);
    expect(honeypotFilled({ _honey: 1 })).toBe(false);
    expect(honeypotFilled({ trap: 'x' }, 'trap')).toBe(true);
  });

  it('cleanText trims and caps; isEmail checks shape and length', () => {
    expect(cleanText('  hi  ', 10)).toBe('hi');
    expect(cleanText('abcdef', 3)).toBe('abc');
    expect(cleanText(5, 3)).toBe('');
    expect(isEmail('a@b.co')).toBe(true);
    expect(isEmail('nope')).toBe(false);
    expect(isEmail(`${'a'.repeat(250)}@b.co`)).toBe(false);
    // Same shape as the database: the last label may not be empty or contain a dot.
    expect(isEmail('a@b.c.d')).toBe(true);
    expect(isEmail('a@b.co.')).toBe(false);
    expect(isEmail('a@b')).toBe(false);
    expect(isEmail('a b@c.de')).toBe(false);
  });
});

describe('ip_hash', () => {
  it('reads cf-connecting-ip only', () => {
    expect(clientIp(req({ 'cf-connecting-ip': ' 203.0.113.9 ' }))).toBe('203.0.113.9');
    expect(clientIp(req({ 'x-forwarded-for': '203.0.113.9' }))).toBeNull();
  });

  it('reduces IPv6 to its /64 and unwraps IPv4-mapped addresses', () => {
    expect(ipNetwork('203.0.113.9')).toBe('203.0.113.9');
    expect(ipNetwork('2001:db8:0001:0002:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(ipNetwork('2001:DB8:1:2::9')).toBe('2001:db8:1:2::/64');
    expect(ipNetwork('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(ipNetwork('::1')).toBe('0:0:0:0::/64');
    expect(ipNetwork('::ffff:203.0.113.9')).toBe('203.0.113.9');
  });

  it('is null without a salt or an IP, and a stable salted hex hash otherwise', async () => {
    expect(await ipHash(req({ 'cf-connecting-ip': '203.0.113.9' }))).toBeNull();
    vi.stubEnv('LEAD_IP_SALT', 'salt');
    expect(await ipHash(req())).toBeNull();
    const a = await ipHash(req({ 'cf-connecting-ip': '203.0.113.9' }));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await ipHash(req({ 'cf-connecting-ip': '203.0.113.9' }))).toBe(a);
    expect(await ipHash(req({ 'cf-connecting-ip': '203.0.113.10' }))).not.toBe(a);
    // Same /64, same hash.
    expect(await ipHash(req({ 'cf-connecting-ip': '2001:db8:1:2::1' }))).toBe(
      await ipHash(req({ 'cf-connecting-ip': '2001:db8:1:2:ffff::9' })),
    );
    vi.stubEnv('LEAD_IP_SALT', 'other');
    expect(await ipHash(req({ 'cf-connecting-ip': '203.0.113.9' }))).not.toBe(a);
  });
});

describe('Turnstile', () => {
  const siteverify = (body: unknown, status = 200) => fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));

  it('missing or oversized token: no Siteverify call', async () => {
    expect(await verifyTurnstile('s', undefined, null)).toBe('missing');
    expect(await verifyTurnstile('s', 'x'.repeat(2049), null)).toBe('missing');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pass sends secret, token and IP', async () => {
    siteverify({ success: true });
    expect(await verifyTurnstile('s', 'tok', '203.0.113.9')).toBe('pass');
    const form = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(Object.fromEntries(form)).toEqual({ secret: 's', response: 'tok', remoteip: '203.0.113.9' });
  });

  it('fail on a rejected token; unavailable on internal-error, 5xx, bad JSON or network', async () => {
    siteverify({ success: false, 'error-codes': ['invalid-input-response'] });
    expect(await verifyTurnstile('s', 'tok', null)).toBe('fail');
    siteverify({ success: false, 'error-codes': ['internal-error'] });
    expect(await verifyTurnstile('s', 'tok', null)).toBe('unavailable');
    siteverify({ success: false }, 503);
    expect(await verifyTurnstile('s', 'tok', null)).toBe('unavailable');
    fetchMock.mockResolvedValue(new Response('<html>', { status: 200 }));
    expect(await verifyTurnstile('s', 'tok', null)).toBe('unavailable');
    fetchMock.mockRejectedValue(new TypeError('network'));
    expect(await verifyTurnstile('s', 'tok', null)).toBe('unavailable');
  });

  it('turnstileVerdict is off without the secret', async () => {
    expect(await turnstileVerdict(req(), 'tok')).toEqual({ configured: false, ok: null, outcome: null });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.stubEnv('TURNSTILE_SECRET_KEY', 's');
    siteverify({ success: true });
    expect(await turnstileVerdict(req(), 'tok')).toEqual({ configured: true, ok: true, outcome: 'pass' });
    expect(await turnstileVerdict(req(), '')).toEqual({ configured: true, ok: false, outcome: 'missing' });
  });
});

describe('formTokenVerdict', () => {
  it('is off without FORM_TOKEN_SECRET, and checks the token with it', async () => {
    expect(await formTokenVerdict('anything')).toEqual({ configured: false, check: null });
    vi.stubEnv('FORM_TOKEN_SECRET', 'k');
    const token = await issueFormToken('k', 1_000_000);
    expect(await formTokenVerdict(token, 1_010_000)).toEqual({ configured: true, check: { ok: true, ageMs: 10_000 } });
    expect(await formTokenVerdict(token, 1_001_000)).toMatchObject({ configured: true, check: { ok: false, reason: 'too_fast' } });
  });
});
