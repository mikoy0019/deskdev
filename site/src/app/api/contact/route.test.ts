// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueFormToken } from '../../../lib/formToken';
import { ipHash } from '../../../lib/guard';

// The Worker's bindings (src/lib/platform.ts reads them from the Worker,
// which Node does not have). `limit` is the API_LIMITER binding's method.
const { limit } = vi.hoisted(() => ({ limit: vi.fn() }));
vi.mock('../../../lib/platform', () => ({ bindings: () => ({ API_LIMITER: { limit } }) }));

import { GET, POST } from './route';

const URL_ = 'https://nixgensolutions.com/api/contact';
const SUPABASE = 'https://db.test';
const RPC_URL = `${SUPABASE}/rest/v1/rpc/intake_site_lead`;
// What Cloudflare sends as cf-ray; the route answers with it and logs it.
const RAY = '8f1e2d3c4b5a6978-AMS';
const LEAD = { name: 'Ada', email: 'ada@example.com', company: 'Acme', system: 'Website', budget: '$5K — $10K', message: 'Hello' };

const fetchMock = vi.fn();

function req(
  body: unknown,
  headers: Record<string, string> = {},
  opts: { raw?: BodyInit; url?: string } = {},
): Request {
  return new Request(opts.url ?? URL_, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: 'nixgensolutions.com',
      origin: 'https://nixgensolutions.com',
      'sec-fetch-site': 'same-origin',
      'cf-ray': RAY,
      ...headers,
    },
    body: opts.raw ?? JSON.stringify(body),
    // Needed by Node's undici when the body is a stream.
    ...(opts.raw instanceof ReadableStream ? { duplex: 'half' } : {}),
  } as RequestInit);
}

function rpcCalls() {
  return fetchMock.mock.calls.filter(([u]) => String(u) === RPC_URL);
}

/** The p_payload of the only RPC call. */
function sentPayload(): Record<string, unknown> {
  const calls = rpcCalls();
  expect(calls).toHaveLength(1);
  return JSON.parse(calls[0][1].body as string).p_payload;
}

function rpcAnswers(body: unknown, status = 200) {
  fetchMock.mockImplementation(async (u: string) =>
    String(u).includes('siteverify')
      ? new Response(JSON.stringify({ success: true }))
      : new Response(JSON.stringify(body), { status }),
  );
}

function logged(level: 'warn' | 'error' | 'info'): Array<Record<string, unknown>> {
  return vi.mocked(console[level]).mock.calls.map(([line]) => JSON.parse(String(line)));
}

beforeEach(() => {
  limit.mockReset();
  limit.mockResolvedValue({ success: true });
  fetchMock.mockReset();
  rpcAnswers({ ok: true, lead_id: '11111111-1111-1111-1111-111111111111', status: 'created' });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('LEAD_INTAKE_SECRET', 'intake-secret');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', `${SUPABASE}/`);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('TURNSTILE_SECRET_KEY', '');
  vi.stubEnv('FORM_TOKEN_SECRET', '');
  vi.stubEnv('LEAD_IP_SALT', 'salt');
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

describe('POST /api/contact → intake_site_lead', () => {
  it('calls the RPC with the anon key and the intake secret, and answers recorded', async () => {
    const res = await POST(req(LEAD));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ success: true, lead: 'recorded', fallback: false });

    const [, init] = rpcCalls()[0];
    const headers = init.headers as Record<string, string>;
    expect(headers.apikey).toBe('anon-key');
    expect(headers.Authorization).toBe('Bearer anon-key');
    expect(JSON.parse(init.body as string).p_secret).toBe('intake-secret');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('maps the legacy form fields into the payload contract', async () => {
    await POST(req(LEAD));
    expect(sentPayload()).toEqual({
      name: 'Ada',
      email: 'ada@example.com',
      phone: '',
      company: 'Acme',
      services: ['Website'],
      budget_band: '$5K — $10K',
      timeline: '',
      message: 'Hello',
      form: 'contact',
      source: 'website',
      consent: false,
      attribution: null,
      ip_hash: null,
      turnstile_ok: null,
      signals: [],
      fill_ms: null,
    });
  });

  it('drops the legacy "Not selected" placeholders', async () => {
    await POST(req({ ...LEAD, system: 'Not selected', budget: 'Not selected' }));
    const p = sentPayload();
    expect(p.services).toEqual([]);
    expect(p.budget_band).toBe('');
  });

  it('sends the new fields: services, phone, timeline, consent, attribution', async () => {
    await POST(
      req({
        name: 'Ada',
        email: 'ada@example.com',
        phone: '+1 555 0100',
        services: ['Website', 'Automation & AI', 'Website', 7, ''],
        budget_band: '$10K+',
        timeline: 'ASAP',
        message: 'Hi',
        consent: true,
        attribution: {
          first: { utm_source: 'google', landing: '/', evil: 'x' },
          last: { referrer: 'https://news.example/post' },
        },
      }),
    );
    const p = sentPayload();
    expect(p.services).toEqual(['Website', 'Automation & AI']);
    expect(p).toMatchObject({ phone: '+1 555 0100', budget_band: '$10K+', timeline: 'ASAP', consent: true });
    expect(p.attribution).toEqual({
      first: { utm_source: 'google', landing_page: '/' },
      last: { referrer: 'https://news.example/post' },
    });
    // utm_source with no medium says "a campaign", not which channel.
    expect(p.source).toBe('other');
  });

  it('names the channel from the first touch, in the vocabulary intake_site_lead accepts', async () => {
    await POST(req({ ...LEAD, attribution: { first: { referrer: 'https://www.linkedin.com/feed' } } }));
    expect(sentPayload().source).toBe('linkedin');
  });

  it('only a literal true is consent', async () => {
    await POST(req({ ...LEAD, consent: 'yes' }));
    expect(sentPayload().consent).toBe(false);
  });

  it('caps every field and the number of services', async () => {
    const services = Array.from({ length: 20 }, (_, i) => `s${i}`);
    await POST(req({ ...LEAD, message: 'é'.repeat(6000), name: 'n'.repeat(500), services }));
    const p = sentPayload();
    expect(p.message as string).toHaveLength(5000);
    expect(p.name as string).toHaveLength(120);
    expect(p.services as string[]).toHaveLength(8);
  });

  it('sends a salted ip_hash, never the IP', async () => {
    await POST(req(LEAD, { 'cf-connecting-ip': '203.0.113.9' }));
    const body = rpcCalls()[0][1].body as string;
    expect(JSON.parse(body).p_payload.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(body).not.toContain('203.0.113.9');
  });

  it('treats merged and quarantined as recorded, without revealing quarantine', async () => {
    for (const status of ['merged', 'quarantined']) {
      rpcAnswers({ ok: true, lead_id: 'x', status });
      const res = await POST(req(LEAD));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, lead: 'recorded', fallback: false });
    }
  });

  it('answers 429 without a fallback when this visitor is throttled', async () => {
    for (const body of [{ ok: false, status: 'throttled', reason: 'visitor' }, { ok: false, status: 'throttled' }]) {
      rpcAnswers(body);
      const res = await POST(req(LEAD));
      expect(res.status).toBe(429);
      // The shorter of the database's two windows (10 minutes), in seconds.
      expect(res.headers.get('retry-after')).toBe('600');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toMatchObject({ success: false, lead: 'throttled', fallback: false, error: expect.any(String) });
    }
  });

  it('answers 429 WITH the email fallback when the address or the overall cap is full', async () => {
    // Someone else's flood must not cost this sender their brief.
    for (const reason of ['address', 'global']) {
      rpcAnswers({ ok: false, lead_id: null, status: 'throttled', reason });
      const res = await POST(req(LEAD));
      expect(res.status).toBe(429);
      expect(res.headers.get('retry-after')).toBe('600');
      expect(await res.json()).toMatchObject({ success: false, lead: 'throttled', fallback: true });
      expect(logged('warn')).toContainEqual({ route: 'contact', event: 'lead_throttled', reason, request_id: RAY });
    }
  });

  it('refuses a flood from one network before the body is read or the database is asked', async () => {
    limit.mockResolvedValue({ success: false });
    const flood = req(LEAD, { 'cf-connecting-ip': '203.0.113.9' });
    const res = await POST(flood);
    expect(res.status).toBe(429);
    // The limiter's own window, not the database's ten minutes.
    expect(res.headers.get('retry-after')).toBe('60');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-request-id')).toBe(RAY);
    // The sender caused it: the form shows the message and does not email the brief.
    expect(await res.json()).toMatchObject({ success: false, lead: 'throttled', fallback: false, error: expect.any(String) });
    expect(limit).toHaveBeenCalledExactlyOnceWith({ key: 'contact:203.0.113.9' });
    expect(flood.bodyUsed).toBe(false);
    expect(rpcCalls()).toHaveLength(0);
  });

  it('records the brief when the limiter is missing or broken', async () => {
    limit.mockRejectedValue(new Error('limiter down'));
    const res = await POST(req(LEAD));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, lead: 'recorded' });
    expect(rpcCalls()).toHaveLength(1);
    expect(logged('warn')).toContainEqual(
      expect.objectContaining({ route: 'contact', event: 'limiter_unavailable', scope: 'contact', reason: 'threw' }),
    );
  });

  it('sends Retry-After on a 429 only', async () => {
    expect((await POST(req(LEAD))).headers.get('retry-after')).toBeNull();
    expect((await POST(req({ ...LEAD, email: 'nope' }))).headers.get('retry-after')).toBeNull();
    rpcAnswers({ code: 'P0001' }, 400);
    expect((await POST(req(LEAD))).headers.get('retry-after')).toBeNull();
  });

  it('accepts a request without Origin or Sec-Fetch-Site (non-browser clients, older browsers)', async () => {
    const r = new Request(URL_, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(LEAD),
    });
    expect((await POST(r)).status).toBe(200);
    expect(rpcCalls()).toHaveLength(1);
  });

  it('accepts the workspace subdomain posting to itself', async () => {
    const res = await POST(
      req(LEAD, { host: 'workspace.nixgensolutions.com', origin: 'https://workspace.nixgensolutions.com' }, {
        url: 'https://workspace.nixgensolutions.com/api/contact',
      }),
    );
    expect(res.status).toBe(200);
  });
});

describe('intake failures tell the form to fall back to email', () => {
  it('503 + fallback when the secret or Supabase settings are missing, before any call', async () => {
    // LEAD_IP_SALT is required: without it every caller would share the
    // database's one no-ip_hash bucket.
    for (const name of ['LEAD_INTAKE_SECRET', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'LEAD_IP_SALT']) {
      vi.stubEnv(name, '');
      vi.stubEnv('TURNSTILE_SECRET_KEY', 'ts');
      const res = await POST(req(LEAD));
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ success: false, lead: 'failed', fallback: true });
      vi.unstubAllEnvs();
      vi.stubEnv('LEAD_INTAKE_SECRET', 'intake-secret');
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE);
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
      vi.stubEnv('LEAD_IP_SALT', 'salt');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('502 + fallback on a PostgREST error, logging only its code', async () => {
    rpcAnswers({ code: 'P0001', message: 'secret mismatch for ada@example.com' }, 400);
    const res = await POST(req(LEAD));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ lead: 'failed', fallback: true });
    const line = logged('error').find((l) => l.event === 'intake_rpc_failed');
    expect(line).toEqual({ route: 'contact', event: 'intake_rpc_failed', status: 400, code: 'P0001', request_id: RAY });
  });

  it('502 + fallback when the secret is rejected (42501), logged as intake_secret_rejected', async () => {
    rpcAnswers({ code: '42501', message: 'forbidden' }, 401);
    const res = await POST(req(LEAD));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ lead: 'failed', fallback: true });
    expect(logged('error')).toContainEqual({
      route: 'contact',
      event: 'intake_secret_rejected',
      status: 401,
      code: '42501',
      request_id: RAY,
    });
    // The secret never reaches a log line.
    const all = [...logged('error'), ...logged('warn'), ...logged('info')].map((l) => JSON.stringify(l)).join('\n');
    expect(all).not.toContain('intake-secret');
  });

  it('400 invalid without a fallback when the database refuses the name or email (22023)', async () => {
    rpcAnswers({ code: '22023', message: 'invalid lead' }, 400);
    const res = await POST(req(LEAD));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, lead: 'invalid', fallback: false, error: expect.any(String) });
  });

  it('502 + fallback on a 5xx with a non-JSON body', async () => {
    fetchMock.mockResolvedValue(new Response('<html>bad gateway', { status: 502 }));
    const res = await POST(req(LEAD));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ lead: 'failed', fallback: true });
  });

  it('502 + fallback when the function answers ok:false or an unknown status', async () => {
    for (const body of [{ ok: false }, { ok: true, status: 'weird' }, null]) {
      rpcAnswers(body);
      const res = await POST(req(LEAD));
      expect(res.status).toBe(502);
      expect(await res.json()).toMatchObject({ lead: 'failed', fallback: true });
    }
  });

  it('502 + fallback when Supabase is unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const res = await POST(req(LEAD));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ lead: 'failed', fallback: true });
  });

  it('504 unconfirmed + fallback when the RPC exceeds its 3 s timeout', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    fetchMock.mockImplementation(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });
    const res = await POST(req(LEAD));
    expect(res.status).toBe(504);
    expect(await res.json()).toMatchObject({ success: false, lead: 'unconfirmed', fallback: true });
    expect(timeout).toHaveBeenCalledWith(3_000);
  });
});

describe('request id', () => {
  it('answers every outcome with X-Request-Id, and logs the same value as request_id', async () => {
    const ok = await POST(req(LEAD));
    expect(ok.headers.get('x-request-id')).toBe(RAY);
    expect(logged('info')).toContainEqual(expect.objectContaining({ event: 'lead_created', request_id: RAY }));

    // Refusals and failures as well: 415, 403, 400, 429, 502, 503, and the GET.
    expect((await POST(req(LEAD, { 'content-type': 'text/plain' }))).headers.get('x-request-id')).toBe(RAY);
    expect((await POST(req(LEAD, { 'sec-fetch-site': 'cross-site' }))).headers.get('x-request-id')).toBe(RAY);
    expect(logged('warn')).toContainEqual(expect.objectContaining({ event: 'cross_site_refused', request_id: RAY }));
    expect((await POST(req({ ...LEAD, email: 'nope' }))).headers.get('x-request-id')).toBe(RAY);
    rpcAnswers({ ok: false, status: 'throttled' });
    expect((await POST(req(LEAD))).headers.get('x-request-id')).toBe(RAY);
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    expect((await POST(req(LEAD))).headers.get('x-request-id')).toBe(RAY);
    vi.stubEnv('LEAD_INTAKE_SECRET', '');
    expect((await POST(req(LEAD))).headers.get('x-request-id')).toBe(RAY);
    const get = await GET(new Request(URL_, { headers: { host: 'nixgensolutions.com', 'cf-ray': RAY } }));
    expect(get.headers.get('x-request-id')).toBe(RAY);
  });

  it('carries the id on the Turnstile lines too', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'ts-secret');
    fetchMock.mockImplementation(async (u: string) =>
      String(u).includes('siteverify')
        ? new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }))
        : new Response(JSON.stringify({ ok: true, lead_id: 'x', status: 'quarantined' })),
    );
    await POST(req({ ...LEAD, turnstileToken: 'bad' }));
    expect(logged('warn')).toContainEqual({
      route: 'contact',
      event: 'turnstile_rejected',
      codes: ['invalid-input-response'],
      request_id: RAY,
    });
  });

  it('makes up an id when Cloudflare sent none, the same one in the header and the log', async () => {
    const res = await POST(req(LEAD, { 'cf-ray': '' }));
    const id = res.headers.get('x-request-id');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(logged('info')).toContainEqual(expect.objectContaining({ event: 'lead_created', request_id: id }));
  });
});

describe('cross-site and content-type checks', () => {
  it('refuses a no-cors text/plain POST with 415 and does not call the RPC', async () => {
    const res = await POST(req(LEAD, { 'content-type': 'text/plain;charset=UTF-8' }));
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ success: false, lead: 'invalid', fallback: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a missing content-type', async () => {
    const r = new Request(URL_, { method: 'POST', body: new Blob([JSON.stringify(LEAD)]) });
    expect((await POST(r)).status).toBe(415);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses Sec-Fetch-Site cross-site and same-site', async () => {
    for (const site of ['cross-site', 'same-site', 'none']) {
      expect((await POST(req(LEAD, { 'sec-fetch-site': site }))).status).toBe(403);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a foreign Origin even without Sec-Fetch-Site', async () => {
    const r = new Request(URL_, {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'nixgensolutions.com', origin: 'https://evil.example' },
      body: JSON.stringify(LEAD),
    });
    expect((await POST(r)).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses Origin: null', async () => {
    expect((await POST(req(LEAD, { origin: 'null' }))).status).toBe(403);
  });
});

describe('body size cap', () => {
  it('rejects a declared Content-Length over 64 KB with 413 before reading', async () => {
    expect((await POST(req(LEAD, { 'content-length': String(10 * 1024 * 1024) }))).status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a streamed body over 64 KB without a Content-Length, and stops reading', async () => {
    let pulled = 0;
    const chunk = new Uint8Array(16 * 1024).fill(0x41);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        if (pulled > 1000) controller.close();
        else controller.enqueue(chunk);
      },
    });
    expect((await POST(req(null, {}, { raw: stream }))).status).toBe(413);
    expect(pulled).toBeLessThan(10);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON and non-object bodies with 400', async () => {
    expect((await POST(req(null, {}, { raw: '{nope' }))).status).toBe(400);
    expect((await POST(req([LEAD]))).status).toBe(400);
    expect((await POST(req('text'))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('validation', () => {
  it('400s on missing required fields and a bad email, without a fallback', async () => {
    for (const body of [
      { ...LEAD, message: ' ' },
      { ...LEAD, name: '' },
      { ...LEAD, email: 'nope' },
      { ...LEAD, email: 'ada@example.com.' },
    ]) {
      const res = await POST(req(body));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ lead: 'invalid', fallback: false });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('honeypot', () => {
  it('fakes success and does not call the RPC when _honey is filled', async () => {
    const res = await POST(req({ ...LEAD, _honey: 'http://spam.example' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, lead: 'recorded', fallback: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('records when _honey is empty, without passing it on', async () => {
    expect((await POST(req({ ...LEAD, _honey: '' }))).status).toBe(200);
    expect(sentPayload()).not.toHaveProperty('_honey');
  });
});

describe('Turnstile → turnstile_ok, never a 403', () => {
  it('is skipped while TURNSTILE_SECRET_KEY is unset (turnstile_ok null)', async () => {
    await POST(req(LEAD));
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('siteverify'))).toBe(false);
    expect(sentPayload().turnstile_ok).toBeNull();
  });

  it('passes turnstile_ok:true when Siteverify passes, sending the secret, token and client IP', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'ts-secret');
    const res = await POST(req({ ...LEAD, turnstileToken: 'tok' }, { 'cf-connecting-ip': '203.0.113.9' }));
    expect(res.status).toBe(200);
    const verify = fetchMock.mock.calls.find(([u]) => String(u).includes('siteverify'))!;
    const form = verify[1].body as URLSearchParams;
    expect(form.get('secret')).toBe('ts-secret');
    expect(form.get('response')).toBe('tok');
    expect(form.get('remoteip')).toBe('203.0.113.9');
    expect(sentPayload()).toMatchObject({ turnstile_ok: true, signals: [] });
  });

  it('records a lead with a missing token as turnstile_ok:false (quarantine), not 403', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'ts-secret');
    const res = await POST(req(LEAD));
    expect(res.status).toBe(200);
    expect(sentPayload()).toMatchObject({ turnstile_ok: false, signals: ['turnstile_missing'] });
  });

  it('records a rejected token as turnstile_ok:false', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'ts-secret');
    fetchMock.mockImplementation(async (u: string) =>
      String(u).includes('siteverify')
        ? new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }))
        : new Response(JSON.stringify({ ok: true, lead_id: 'x', status: 'quarantined' })),
    );
    const res = await POST(req({ ...LEAD, turnstileToken: 'bad' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ lead: 'recorded' });
    expect(sentPayload()).toMatchObject({ turnstile_ok: false, signals: ['turnstile_fail'] });
  });

  it('records the lead during a Siteverify outage as turnstile_ok:false, turnstile_unavailable', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'ts-secret');
    fetchMock.mockImplementation(async (u: string) => {
      if (String(u).includes('siteverify')) throw new TypeError('network');
      return new Response(JSON.stringify({ ok: true, lead_id: 'x', status: 'quarantined' }));
    });
    const res = await POST(req({ ...LEAD, turnstileToken: 'tok' }));
    expect(res.status).toBe(200);
    expect(sentPayload()).toMatchObject({ turnstile_ok: false, signals: ['turnstile_unavailable'] });
  });
});

describe('signed render timestamp', () => {
  const T0 = 1_780_000_000_000;

  it('is ignored while FORM_TOKEN_SECRET is unset', async () => {
    await POST(req({ ...LEAD, formToken: 'garbage' }));
    expect(sentPayload()).toMatchObject({ signals: [], fill_ms: null });
  });

  it('sends fill_ms for a token older than 3 s', async () => {
    vi.stubEnv('FORM_TOKEN_SECRET', 'ft');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0 + 45_000);
    const formToken = await issueFormToken('ft', T0);
    await POST(req({ ...LEAD, formToken }));
    expect(sentPayload()).toMatchObject({ signals: [], fill_ms: 45_000 });
  });

  it('flags a brief filled in under 3 s, and a missing or forged token', async () => {
    vi.stubEnv('FORM_TOKEN_SECRET', 'ft');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0 + 900);
    const cases: Array<[unknown, string]> = [
      [await issueFormToken('ft', T0), 'form_token_too_fast'],
      [undefined, 'form_token_missing'],
      [await issueFormToken('wrong', T0 - 60_000), 'form_token_bad_signature'],
    ];
    for (const [formToken, signal] of cases) {
      fetchMock.mockClear();
      const res = await POST(req({ ...LEAD, formToken }));
      expect(res.status).toBe(200);
      expect(sentPayload().signals).toEqual([signal]);
    }
  });

  it('binds the token to the network that fetched it', async () => {
    vi.stubEnv('FORM_TOKEN_SECRET', 'ft');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const binding = await ipHash(req({}, { 'cf-connecting-ip': '203.0.113.9' }));
    const token = await issueFormToken('ft', T0, binding ?? '');
    vi.setSystemTime(T0 + 30_000);

    await POST(req({ ...LEAD, formToken: token }, { 'cf-connecting-ip': '203.0.113.9' }));
    expect(sentPayload()).toMatchObject({ signals: [], fill_ms: 30_000 });

    // The same token replayed from another network (a script that fetched one
    // token and reuses it) is a spam signal.
    fetchMock.mockClear();
    await POST(req({ ...LEAD, formToken: token }, { 'cf-connecting-ip': '198.51.100.7' }));
    expect(sentPayload().signals).toEqual(['form_token_bad_signature']);
  });

  it('flags a token older than four hours as expired', async () => {
    vi.stubEnv('FORM_TOKEN_SECRET', 'ft');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0 + 4 * 60 * 60 * 1000 + 1);
    await POST(req({ ...LEAD, formToken: await issueFormToken('ft', T0) }));
    expect(sentPayload().signals).toEqual(['form_token_expired']);
  });

  it('accepts a browser token after a network change but rejects a missing or different browser cookie', async () => {
    vi.stubEnv('FORM_TOKEN_SECRET', 'ft');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const response = await GET(new Request(URL_, { headers: { 'cf-connecting-ip': '203.0.113.9' } }));
    const { token } = await response.json();
    const cookie = response.headers.get('set-cookie')!.split(';')[0];
    vi.setSystemTime(T0 + 30_000);

    await POST(req({ ...LEAD, formToken: token }, { cookie, 'cf-connecting-ip': '198.51.100.7' }));
    expect(sentPayload()).toMatchObject({ signals: [], fill_ms: 30_000 });

    const otherBrowsers: Record<string, string>[] = [{}, { cookie: 'nixgen_contact_browser=00000000-0000-0000-0000-000000000000' }];
    for (const headers of otherBrowsers) {
      fetchMock.mockClear();
      await POST(req({ ...LEAD, formToken: token }, headers));
      expect(sentPayload().signals).toEqual(['form_token_bad_signature']);
    }
  });
});

describe('content signals', () => {
  it('flags a message with four or more links (the database threshold), not three', async () => {
    const links = (n: number) => Array.from({ length: n }, (_, i) => `https://spam${i}.example`).join(' ');
    await POST(req({ ...LEAD, message: links(3) }));
    expect(sentPayload().signals).toEqual([]);
    fetchMock.mockClear();
    await POST(req({ ...LEAD, message: links(4) }));
    expect(sentPayload().signals).toEqual(['many_links']);
  });
});

describe('GET /api/contact (form token)', () => {
  function getReq(headers: Record<string, string> = {}) {
    return new Request(URL_, { headers: { host: 'nixgensolutions.com', 'sec-fetch-site': 'same-origin', ...headers } });
  }

  it('returns null while FORM_TOKEN_SECRET is unset', async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: null });
  });

  it('returns a fresh signed token, uncached', async () => {
    vi.stubEnv('FORM_TOKEN_SECRET', 'ft');
    const res = await GET(getReq());
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { token } = (await res.json()) as { token: string };
    expect(token).toMatch(/^browser\.\d+\.[A-Za-z0-9_-]{43}$/);
    const cookie = res.headers.get('set-cookie');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=strict');
    expect(cookie).toContain('Path=/api/contact');
  });

  it('keeps the browser binding when another tab renews its token', async () => {
    vi.stubEnv('FORM_TOKEN_SECRET', 'ft');
    const first = await GET(getReq());
    const cookie = first.headers.get('set-cookie')!.split(';')[0];
    const second = await GET(getReq({ cookie }));
    expect(second.headers.get('set-cookie')!.split(';')[0]).toBe(cookie);
  });

  it('refuses a cross-site GET', async () => {
    expect((await GET(getReq({ 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
  });
});
