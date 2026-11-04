import { NextResponse } from 'next/server';
import { REQUEST_ID_HEADER, withRequestLog, type RequestLog } from '../../../../lib/guard';
import { SITE_ORIGIN, WORKSPACE_ORIGIN } from '../../../../lib/hosts';

// Google OAuth legs on the apex host: nixgensolutions.com/api/google/[leg].
//
// The `google` Edge Function (supabase/functions/google) does all the work and
// holds every secret; this route only makes the browser-facing half of the
// flow first-party:
// - Google's redirect URI is https://nixgensolutions.com/api/google/callback,
//   a domain the OAuth consent screen can verify, instead of *.supabase.co.
// - The browser-flow cookie (nonce + PKCE verifier, sealed by the function)
//   lives on this host, path /api/google, HttpOnly, SameSite=Lax.
//
// Legs:
//   POST /api/google/connect   DeskDev starts a connection. Either a top-level
//                              form POST (fields access_token, purpose,
//                              returnTo → 303 to Google) or a JSON fetch
//                              (Authorization: Bearer …, body {purpose,
//                              returnTo} → {url}). The function checks the
//                              session and returns the consent URL AND the
//                              sealed cookie value, so the cookie is set in the
//                              same response that checked the session.
//   GET  /api/google/start     The older client's start link
//                              (?state=…): sets the cookie, 302 to Google.
//   GET  /api/google/callback  Google lands here. The cookie travels to the
//                              function in a header; the function answers with
//                              where to send the browser (DeskDev's
//                              ?google=pending&grant=… or ?google=error&reason=…).
//
// No privileged secret on the Worker (PLAN rule 5): the route calls the
// function with the public anon key, and with the person's own access token
// for `connect`. On the workspace host every path is rewritten into DeskDev
// (next.config.ts), so these legs are reached on the apex host, or same-origin
// in local dev and workers.dev previews.
//
// Env: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and optionally
// GOOGLE_FUNCTION_URL (the function's URL, for `supabase functions serve`).
// The function needs GOOGLE_REDIRECT_BASE=https://<this host>/api/google.
//
// Log lines go through the request's log (src/lib/guard.ts), one JSON line per
// event with the request id; never tokens, codes, cookies or states.

const ROUTE = '/api/google';
const FLOW_COOKIE = 'dd_google_flow';
const COOKIE_PATH = '/api/google';
const FLOW_HEADER = 'x-deskdev-google-flow';
const MAX_BODY_BYTES = 16 * 1024;
const FUNCTION_TIMEOUT_MS = 25_000;
const GOOGLE_CONSENT = 'https://accounts.google.com/';

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

const NO_STORE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } as const;

function cookie(request: Request, value: string, maxAgeSeconds: number): string {
  const secure = new URL(request.url).protocol === 'https:' ? ' Secure;' : '';
  const maxAge = Math.max(0, Math.min(Math.floor(maxAgeSeconds), 600));
  return `${FLOW_COOKIE}=${value}; Path=${COOKIE_PATH}; Max-Age=${maxAge}; HttpOnly;${secure} SameSite=Lax`;
}

const clearCookie = (request: Request) => cookie(request, '', 0);

function text(request: Request, status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { ...NO_STORE, 'Content-Type': 'text/plain; charset=utf-8', 'Set-Cookie': clearCookie(request) },
  });
}

function redirect(location: string, status: 302 | 303, setCookie?: string): Response {
  const headers: Record<string, string> = { ...NO_STORE, Location: location };
  if (setCookie) headers['Set-Cookie'] = setCookie;
  return new Response(null, { status, headers });
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('cookie') ?? '').split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return null;
}

function isHttpUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The google function
// ---------------------------------------------------------------------------

function functionConfig(): { url: string; anonKey: string } | null {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const base = process.env.GOOGLE_FUNCTION_URL?.trim() ||
    (process.env.NEXT_PUBLIC_SUPABASE_URL ? `${process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/google` : '');
  if (!anonKey || !base) return null;
  return { url: base.replace(/\/+$/, ''), anonKey };
}

type FunctionReply = { status: number; data: Record<string, unknown> | null };

async function callFunction(
  log: RequestLog,
  body: Record<string, unknown>,
  opts: { bearer?: string; flow?: string | null } = {},
): Promise<FunctionReply | null> {
  const fn = functionConfig();
  if (!fn) {
    log.log('error', 'not_configured');
    return null;
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: fn.anonKey,
    Authorization: `Bearer ${opts.bearer ?? fn.anonKey}`,
  };
  if (opts.flow) headers[FLOW_HEADER] = opts.flow;
  try {
    const res = await fetch(fn.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FUNCTION_TIMEOUT_MS),
    });
    const data = await res.json().then((d: unknown) => (d && typeof d === 'object' ? (d as Record<string, unknown>) : null)).catch(() => null);
    return { status: res.status, data };
  } catch (err) {
    log.log('error', 'function_unreachable', { action: body.action, error: err instanceof Error ? err.name : 'unknown' });
    return null;
  }
}

/** Renders a browser leg the function described ({kind:'redirect'|'text'}). */
function renderLeg(request: Request, reply: FunctionReply | null, log: RequestLog): Response {
  const leg = reply?.data;
  if (!reply || !leg) return text(request, 503, 'Google sign-in is unavailable right now. Go back to DeskDev and try again.');
  if (leg.kind === 'redirect' && isHttpUrl(leg.location)) {
    const flow = leg.flow as { value?: unknown; maxAge?: unknown } | null | undefined;
    let setCookie: string | undefined;
    if (flow === null) setCookie = clearCookie(request);
    else if (flow && typeof flow.value === 'string' && typeof flow.maxAge === 'number') {
      setCookie = cookie(request, flow.value, flow.maxAge);
    }
    return redirect(leg.location, 302, setCookie);
  }
  if (leg.kind === 'text' && typeof leg.message === 'string') {
    return text(request, typeof leg.status === 'number' ? leg.status : 400, leg.message);
  }
  log.log('error', 'function_refused', { status: reply.status });
  return text(request, 503, 'Google sign-in is unavailable right now. Go back to DeskDev and try again.');
}

// ---------------------------------------------------------------------------
// connect: origin, body
// ---------------------------------------------------------------------------

/** Origins allowed to start a connection: this host, the site, DeskDev, and GOOGLE_CONNECT_ORIGINS. */
function connectOrigins(request: Request): string[] {
  const out = [new URL(request.url).origin];
  if (SITE_ORIGIN) out.push(SITE_ORIGIN);
  if (WORKSPACE_ORIGIN) out.push(WORKSPACE_ORIGIN);
  for (const raw of (process.env.GOOGLE_CONNECT_ORIGINS ?? '').split(',')) {
    try {
      if (raw.trim()) out.push(new URL(raw.trim()).origin);
    } catch {
      // ignore junk
    }
  }
  return out;
}

/** The caller's Origin when it may start a connection, else null. */
function allowedOrigin(request: Request): string | null {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site') return null;
  const origin = request.headers.get('origin');
  if (!origin) return null; // every browser sends Origin on a POST
  return connectOrigins(request).includes(origin) ? origin : null;
}

function corsFor(origin: string, request: Request): Record<string, string> {
  return origin === new URL(request.url).origin
    ? {}
    : {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        // Without this DeskDev's script cannot read the id of a call that failed.
        'Access-Control-Expose-Headers': REQUEST_ID_HEADER,
        Vary: 'Origin',
      };
}

async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return null;
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

interface ConnectInput {
  mode: 'form' | 'json';
  token: string;
  purpose: string | undefined;
  returnTo: string | undefined;
}

function str(v: unknown, max: number): string | undefined {
  return typeof v === 'string' && v.length <= max ? v : undefined;
}

async function connectInput(request: Request): Promise<ConnectInput | { error: string; status: number }> {
  const type = (request.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded' && type !== 'application/json') {
    return { error: 'Unsupported content type.', status: 415 };
  }
  const raw = await readBody(request);
  if (raw === null) return { error: 'Request too large.', status: 413 };

  if (type === 'application/x-www-form-urlencoded') {
    const form = new URLSearchParams(raw);
    return {
      mode: 'form',
      token: str(form.get('access_token'), 8192) ?? '',
      purpose: str(form.get('purpose'), 32),
      returnTo: str(form.get('returnTo'), 500),
    };
  }
  let body: Record<string, unknown> = {};
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed;
  } catch {
    return { error: 'Invalid JSON.', status: 400 };
  }
  return {
    mode: 'json',
    token: (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').slice(0, 8192),
    purpose: str(body.purpose, 32),
    returnTo: str(body.returnTo, 500),
  };
}

/** ?google=error&reason=… for a refused form connect. */
function reasonFor(status: number): string {
  if (status === 401) return 'session';
  if (status === 403) return 'forbidden';
  if (status === 503) return 'config';
  return 'google';
}

/** returnTo only when it is on an origin allowed to connect (never an open redirect). */
function safeReturn(request: Request, raw: string | undefined): URL | null {
  if (!isHttpUrl(raw)) return null;
  const u = new URL(raw);
  return connectOrigins(request).includes(u.origin) ? u : null;
}

async function connect(request: Request, log: RequestLog): Promise<Response> {
  const origin = allowedOrigin(request);
  if (!origin) {
    log.log('warn', 'connect_cross_site', { origin: request.headers.get('origin') ? 'foreign' : 'missing' });
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403, headers: NO_STORE });
  }
  const cors = corsFor(origin, request);
  const input = await connectInput(request);
  if ('error' in input) return NextResponse.json({ error: input.error }, { status: input.status, headers: { ...NO_STORE, ...cors } });

  const fail = (status: number, error: string): Response => {
    if (input.mode === 'json') return NextResponse.json({ error }, { status, headers: { ...NO_STORE, ...cors } });
    const back = safeReturn(request, input.returnTo);
    if (!back) return text(request, status, error);
    back.searchParams.set('google', 'error');
    back.searchParams.set('reason', reasonFor(status));
    return redirect(back.toString(), 303, clearCookie(request));
  };

  if (!input.token) return fail(401, 'Sign in again to continue.');

  const reply = await callFunction(
    log,
    { action: 'connect', purpose: input.purpose, returnTo: input.returnTo, via: 'proxy' },
    { bearer: input.token },
  );
  if (!reply) return fail(503, 'Google is not available right now.');
  const data = reply.data ?? {};
  if (reply.status !== 200 || typeof data.url !== 'string' || !data.url.startsWith(GOOGLE_CONSENT) || typeof data.flow !== 'string') {
    const error = typeof data.error === 'string' ? data.error : 'Google could not be connected.';
    log.log(reply.status >= 500 ? 'error' : 'warn', 'connect_refused', { status: reply.status });
    return fail(reply.status >= 400 ? reply.status : 502, error);
  }

  const setCookie = cookie(request, data.flow, typeof data.maxAge === 'number' ? data.maxAge : 600);
  if (input.mode === 'form') return redirect(data.url, 303, setCookie);
  return NextResponse.json({ url: data.url }, { headers: { ...NO_STORE, ...cors, 'Set-Cookie': setCookie } });
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

type Ctx = { params: Promise<{ leg: string }> };

async function legOf(request: Request, ctx: Ctx | undefined): Promise<string> {
  const fromParams = ctx?.params ? (await ctx.params)?.leg : undefined;
  return fromParams ?? new URL(request.url).pathname.replace(/\/+$/, '').split('/').pop() ?? '';
}

export const GET = withRequestLog(ROUTE, async (request, log, ctx: Ctx): Promise<Response> => {
  const leg = await legOf(request, ctx);
  const q = new URL(request.url).searchParams;

  if (leg === 'start') {
    return renderLeg(request, await callFunction(log, { action: 'proxy_start', state: q.get('state') }), log);
  }
  if (leg === 'callback') {
    const reply = await callFunction(
      log,
      { action: 'proxy_callback', query: { state: q.get('state'), code: q.get('code'), error: q.get('error') } },
      { flow: readCookie(request, FLOW_COOKIE) },
    );
    const res = renderLeg(request, reply, log);
    // Single use: the cookie is cleared whatever the outcome.
    if (!res.headers.has('Set-Cookie')) res.headers.set('Set-Cookie', clearCookie(request));
    return res;
  }
  return NextResponse.json({ error: 'Not found.' }, { status: 404, headers: NO_STORE });
});

export const POST = withRequestLog(ROUTE, async (request, log, ctx: Ctx): Promise<Response> => {
  const leg = await legOf(request, ctx);
  if (leg === 'connect') return connect(request, log);
  return NextResponse.json({ error: 'Not found.' }, { status: 404, headers: NO_STORE });
});

/** Preflight for the JSON connect from DeskDev's own host (credentialed CORS). */
export const OPTIONS = withRequestLog(ROUTE, async (request, _log, ctx: Ctx): Promise<Response> => {
  const leg = await legOf(request, ctx);
  const origin = request.headers.get('origin');
  if (leg !== 'connect' || !origin || !connectOrigins(request).includes(origin)) {
    return new Response(null, { status: 403, headers: NO_STORE });
  }
  return new Response(null, {
    status: 204,
    headers: {
      ...NO_STORE,
      ...corsFor(origin, request),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Max-Age': '600',
    },
  });
});
