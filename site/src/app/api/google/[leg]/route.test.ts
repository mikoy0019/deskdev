// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SITE = 'https://nixgensolutions.com';
const APP = 'https://workspace.nixgensolutions.com';
const SUPABASE = 'https://db.test';
const FN = `${SUPABASE}/functions/v1/google`;
const CONSENT = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=cid&state=s';
const RETURN_TO = `${APP}/settings?section=integrations`;

const fetchMock = vi.fn();

type Route = typeof import('./route');
let route: Route;

const ctx = (leg: string) => ({ params: Promise.resolve({ leg }) });

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fnCalls(): { body: Record<string, unknown>; headers: Record<string, string> }[] {
  return fetchMock.mock.calls
    .filter(([u]) => String(u) === FN)
    .map(([, init]) => ({ body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> }));
}

function formConnect(fields: Record<string, string>, headers: Record<string, string> = {}): Request {
  return new Request(`${SITE}/api/google/connect`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: APP,
      'sec-fetch-site': 'same-site',
      ...headers,
    },
    body: new URLSearchParams(fields).toString(),
  });
}

beforeEach(async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', SITE);
  vi.stubEnv('NEXT_PUBLIC_APP_URL', APP);
  vi.stubEnv('GOOGLE_FUNCTION_URL', '');
  vi.stubEnv('GOOGLE_CONNECT_ORIGINS', '');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  // hosts.ts reads NEXT_PUBLIC_* at module load.
  vi.resetModules();
  route = await import('./route');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /api/google/connect (form)', () => {
  it("checks the session through the function and sets the cookie in that same response", async () => {
    fetchMock.mockResolvedValue(reply({ url: CONSENT, flow: 'f1.k0.iv.ct', maxAge: 600 }));
    const res = await route.POST(formConnect({ access_token: 'jwt-123', purpose: 'workspace', returnTo: RETURN_TO }), ctx('connect'));

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(CONSENT);
    expect(res.headers.get('set-cookie')).toBe('dd_google_flow=f1.k0.iv.ct; Path=/api/google; Max-Age=600; HttpOnly; Secure; SameSite=Lax');
    expect(res.headers.get('cache-control')).toBe('no-store');

    const [call] = fnCalls();
    expect(call.body).toEqual({ action: 'connect', purpose: 'workspace', returnTo: RETURN_TO, via: 'proxy' });
    expect(call.headers.Authorization).toBe('Bearer jwt-123');
    expect(call.headers.apikey).toBe('anon-key');
  });

  it('refuses a missing or foreign Origin, and cross-site fetches, before calling the function', async () => {
    const noOrigin = new Request(`${SITE}/api/google/connect`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'access_token=x',
    });
    expect((await route.POST(noOrigin, ctx('connect'))).status).toBe(403);
    expect((await route.POST(formConnect({ access_token: 'x' }, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }), ctx('connect'))).status).toBe(403);
    expect((await route.POST(formConnect({ access_token: 'x' }, { 'sec-fetch-site': 'cross-site' }), ctx('connect'))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts extra origins from GOOGLE_CONNECT_ORIGINS (previews)', async () => {
    vi.stubEnv('GOOGLE_CONNECT_ORIGINS', 'https://preview.workers.dev');
    fetchMock.mockResolvedValue(reply({ url: CONSENT, flow: 'f', maxAge: 600 }));
    const res = await route.POST(formConnect({ access_token: 'x' }, { origin: 'https://preview.workers.dev', 'sec-fetch-site': 'cross-site' }), ctx('connect'));
    // sec-fetch-site cross-site is still refused: previews must serve DeskDev same-origin.
    expect(res.status).toBe(403);
    const sameOrigin = await route.POST(formConnect({ access_token: 'x' }, { origin: 'https://preview.workers.dev', 'sec-fetch-site': 'same-origin' }), ctx('connect'));
    expect(sameOrigin.status).toBe(303);
  });

  it('sends a refusal back into DeskDev as ?google=error&reason=…', async () => {
    fetchMock.mockResolvedValue(reply({ error: 'Only an admin can do that.' }, 403));
    const res = await route.POST(formConnect({ access_token: 'jwt', purpose: 'workspace', returnTo: RETURN_TO }), ctx('connect'));
    expect(res.status).toBe(303);
    const back = new URL(res.headers.get('location')!);
    expect(back.origin).toBe(APP);
    expect(back.searchParams.get('section')).toBe('integrations');
    expect(back.searchParams.get('google')).toBe('error');
    expect(back.searchParams.get('reason')).toBe('forbidden');
    expect(res.headers.get('set-cookie')).toMatch(/^dd_google_flow=; .*Max-Age=0/);
  });

  it('maps an expired session to reason=session without calling the function', async () => {
    const res = await route.POST(formConnect({ returnTo: RETURN_TO }), ctx('connect'));
    expect(new URL(res.headers.get('location')!).searchParams.get('reason')).toBe('session');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never redirects a refusal to a foreign returnTo', async () => {
    fetchMock.mockResolvedValue(reply({ error: 'nope' }, 400));
    const res = await route.POST(formConnect({ access_token: 'jwt', returnTo: 'https://evil.example/x' }), ctx('connect'));
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('content-type')).toMatch(/text\/plain/);
  });

  it('only follows a consent URL on accounts.google.com', async () => {
    fetchMock.mockResolvedValue(reply({ url: 'https://evil.example/auth', flow: 'f', maxAge: 600 }));
    const res = await route.POST(formConnect({ access_token: 'jwt', returnTo: RETURN_TO }), ctx('connect'));
    expect(new URL(res.headers.get('location')!).origin).toBe(APP);
  });

  it('answers 503 when the function is unreachable or not configured', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const res = await route.POST(formConnect({ access_token: 'jwt', returnTo: RETURN_TO }), ctx('connect'));
    expect(new URL(res.headers.get('location')!).searchParams.get('reason')).toBe('config');

    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    fetchMock.mockReset();
    const res2 = await route.POST(formConnect({ access_token: 'jwt', returnTo: RETURN_TO }), ctx('connect'));
    expect(new URL(res2.headers.get('location')!).searchParams.get('reason')).toBe('config');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses other content types and oversized bodies', async () => {
    const plain = new Request(`${SITE}/api/google/connect`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', origin: SITE, 'sec-fetch-site': 'same-origin' },
      body: 'x',
    });
    expect((await route.POST(plain, ctx('connect'))).status).toBe(415);
    const big = formConnect({ access_token: 'x'.repeat(20_000) });
    expect((await route.POST(big, ctx('connect'))).status).toBe(413);
  });
});

describe('POST /api/google/connect (JSON)', () => {
  it('returns the consent URL with the cookie and credentialed CORS for DeskDev', async () => {
    fetchMock.mockResolvedValue(reply({ url: CONSENT, flow: 'f1.k0.a.b', maxAge: 600 }));
    const req = new Request(`${SITE}/api/google/connect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer jwt-9', origin: APP, 'sec-fetch-site': 'same-site' },
      body: JSON.stringify({ returnTo: RETURN_TO }),
    });
    const res = await route.POST(req, ctx('connect'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: CONSENT });
    expect(res.headers.get('set-cookie')).toMatch(/^dd_google_flow=f1\.k0\.a\.b;/);
    expect(res.headers.get('access-control-allow-origin')).toBe(APP);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(fnCalls()[0].headers.Authorization).toBe('Bearer jwt-9');
  });

  it("passes the function's refusal through as JSON", async () => {
    fetchMock.mockResolvedValue(reply({ error: 'Sign in again to continue.' }, 401));
    const req = new Request(`${SITE}/api/google/connect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer bad', origin: SITE, 'sec-fetch-site': 'same-origin' },
      body: '{}',
    });
    const res = await route.POST(req, ctx('connect'));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Sign in again to continue.' });
  });

  it('answers the preflight only for allowed origins', async () => {
    const ok = await route.OPTIONS(new Request(`${SITE}/api/google/connect`, { method: 'OPTIONS', headers: { origin: APP } }), ctx('connect'));
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-headers')).toMatch(/authorization/);
    const no = await route.OPTIONS(new Request(`${SITE}/api/google/connect`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }), ctx('connect'));
    expect(no.status).toBe(403);
  });
});

describe('request id', () => {
  const RAY = '8f1e2d3c4b5a6978-AMS';
  const lines = (level: 'warn' | 'error') => vi.mocked(console[level]).mock.calls.map(([l]) => JSON.parse(String(l)));

  it('is on every leg, and on the lines that leg logs', async () => {
    // A redirect.
    fetchMock.mockResolvedValue(reply({ url: CONSENT, flow: 'f', maxAge: 600 }));
    const ok = await route.POST(formConnect({ access_token: 'jwt' }, { 'cf-ray': RAY }), ctx('connect'));
    expect(ok.status).toBe(303);
    expect(ok.headers.get('x-request-id')).toBe(RAY);

    // A refusal before the function is called.
    const refused = await route.POST(formConnect({ access_token: 'x' }, { origin: 'https://evil.example', 'cf-ray': RAY }), ctx('connect'));
    expect(refused.status).toBe(403);
    expect(refused.headers.get('x-request-id')).toBe(RAY);
    expect(lines('warn')).toContainEqual({ route: '/api/google', event: 'connect_cross_site', origin: 'foreign', request_id: RAY });

    // The function unreachable, on a GET leg.
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const down = await route.GET(new Request(`${SITE}/api/google/start?state=s`, { headers: { 'cf-ray': RAY } }), ctx('start'));
    expect(down.status).toBe(503);
    expect(down.headers.get('x-request-id')).toBe(RAY);
    expect(lines('error')).toContainEqual({
      route: '/api/google',
      event: 'function_unreachable',
      action: 'proxy_start',
      error: 'TypeError',
      request_id: RAY,
    });

    // 404 and the preflight.
    const missing = await route.GET(new Request(`${SITE}/api/google/finish`, { headers: { 'cf-ray': RAY } }), ctx('finish'));
    expect(missing.headers.get('x-request-id')).toBe(RAY);
    const preflight = await route.OPTIONS(
      new Request(`${SITE}/api/google/connect`, { method: 'OPTIONS', headers: { origin: APP, 'cf-ray': RAY } }),
      ctx('connect'),
    );
    expect(preflight.headers.get('x-request-id')).toBe(RAY);
  });

  it("lets DeskDev's script read the id on the cross-origin JSON connect", async () => {
    fetchMock.mockResolvedValue(reply({ error: 'Sign in again to continue.' }, 401));
    const req = new Request(`${SITE}/api/google/connect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer bad', origin: APP, 'sec-fetch-site': 'same-site' },
      body: '{}',
    });
    const res = await route.POST(req, ctx('connect'));
    expect(res.status).toBe(401);
    expect(res.headers.get('access-control-expose-headers')).toBe('X-Request-Id');
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('GET legs', () => {
  it('start: sets the cookie the function sealed and goes to Google', async () => {
    fetchMock.mockResolvedValue(reply({ kind: 'redirect', location: CONSENT, flow: { value: 'f1.k0.c.d', maxAge: 590 } }));
    const res = await route.GET(new Request(`${SITE}/api/google/start?state=k0.body.sig`), ctx('start'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(CONSENT);
    expect(res.headers.get('set-cookie')).toMatch(/^dd_google_flow=f1\.k0\.c\.d; Path=\/api\/google; Max-Age=590;/);
    expect(fnCalls()[0].body).toEqual({ action: 'proxy_start', state: 'k0.body.sig' });
  });

  it('callback: hands the cookie to the function in a header, follows its answer, clears the cookie', async () => {
    const back = `${RETURN_TO}&google=pending&grant=g2.k0.x.y`;
    fetchMock.mockResolvedValue(reply({ kind: 'redirect', location: back, flow: null }));
    const res = await route.GET(
      new Request(`${SITE}/api/google/callback?state=st&code=4%2Fabc`, { headers: { cookie: 'other=1; dd_google_flow=f1.k0.e.f' } }),
      ctx('callback'),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(back);
    expect(res.headers.get('set-cookie')).toMatch(/^dd_google_flow=; .*Max-Age=0/);
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    const [call] = fnCalls();
    expect(call.body).toEqual({ action: 'proxy_callback', query: { state: 'st', code: '4/abc', error: null } });
    expect(call.headers['x-deskdev-google-flow']).toBe('f1.k0.e.f');
    expect(call.headers.Authorization).toBe('Bearer anon-key');
  });

  it('callback: clears the cookie even when the function leaves it alone', async () => {
    fetchMock.mockResolvedValue(reply({ kind: 'redirect', location: RETURN_TO }));
    const res = await route.GET(new Request(`${SITE}/api/google/callback?state=st&code=c`), ctx('callback'));
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/);
  });

  it('shows the function text for a link that does not verify', async () => {
    fetchMock.mockResolvedValue(reply({ kind: 'text', status: 400, message: 'This Google sign-in link is not valid.' }));
    const res = await route.GET(new Request(`${SITE}/api/google/start?state=forged`), ctx('start'));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('This Google sign-in link is not valid.');
  });

  it('answers 503 text when the function fails or answers garbage', async () => {
    fetchMock.mockResolvedValue(reply({ error: 'Google is not set up on this workspace yet.' }, 503));
    const res = await route.GET(new Request(`${SITE}/api/google/callback?state=s&code=c`), ctx('callback'));
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toMatch(/text\/plain/);
    fetchMock.mockResolvedValue(reply({ kind: 'redirect', location: 'javascript:alert(1)' }));
    expect((await route.GET(new Request(`${SITE}/api/google/start?state=s`), ctx('start'))).status).toBe(503);
  });

  it('uses GOOGLE_FUNCTION_URL when set (local functions serve)', async () => {
    vi.stubEnv('GOOGLE_FUNCTION_URL', 'http://127.0.0.1:54321/functions/v1/google/');
    fetchMock.mockResolvedValue(reply({ kind: 'redirect', location: CONSENT }));
    await route.GET(new Request(`http://localhost:6969/api/google/start?state=s`), ctx('start'));
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://127.0.0.1:54321/functions/v1/google');
  });

  it('404s unknown legs', async () => {
    expect((await route.GET(new Request(`${SITE}/api/google/finish`), ctx('finish'))).status).toBe(404);
    expect((await route.POST(new Request(`${SITE}/api/google/start`, { method: 'POST' }), ctx('start'))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('omits Secure on plain-http local dev', async () => {
    fetchMock.mockResolvedValue(reply({ kind: 'redirect', location: CONSENT, flow: { value: 'f', maxAge: 600 } }));
    const res = await route.GET(new Request('http://localhost:6969/api/google/start?state=s'), ctx('start'));
    expect(res.headers.get('set-cookie')).not.toMatch(/Secure/);
  });
});
