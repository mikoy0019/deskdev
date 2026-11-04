// Shared protection for the site's public POST endpoints (/api/contact,
// /api/subscribe, /api/client-errors). Each route keeps its own field rules;
// the checks every public form needs live here so they cannot drift apart:
//
// - Same-origin only. A cross-site page can POST without a CORS preflight
//   (no-cors + text/plain), so Content-Type must be JSON and Sec-Fetch-Site /
//   Origin, when the browser sends them, must be this host. The Worker serves
//   several hostnames, so Origin is compared with the request's own host
//   rather than a fixed one.
// - Bounded body. The JSON is read through a byte cap before it is parsed, so
//   a huge body is refused instead of buffered.
// - Honeypot. A filled hidden field is a bot; routes answer as if it worked.
// - Turnstile. Optional until TURNSTILE_SECRET_KEY is set. The result is a
//   verdict, not a gate: /api/contact passes it to the database, which
//   quarantines a failed lead instead of losing it (PLAN Topic A).
// - Signed render timestamp (formToken.ts). Optional until FORM_TOKEN_SECRET is
//   set; a brief sent faster than a person can type is a spam signal.
// - ip_hash. A salted SHA-256 of the client IP, so the database can throttle
//   by connection without ever storing an address. It also binds the form
//   token to the network that fetched it.
//
// - Request ids. Every /api handler is wrapped in withRequestLog: the response
//   carries X-Request-Id and every log line of that request carries the same
//   value as request_id, so a report from a browser and a line in Workers
//   Logs can be matched. The answers no handler writes (405 for a method a
//   route does not export, the automatic OPTIONS, 404 for an unknown /api
//   path, the 500 after a handler threw) get the same header from
//   src/proxy.ts, which runs before the route is chosen.
//
// Secrets are read per request, never at module load: on Workers they arrive
// with the request's environment.

import { verifyFormToken, type FormTokenCheck } from './formToken';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** 64 KB: room for a 5000-character message of multibyte text plus the other fields. */
export const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

/** Siteverify budget. The contact form waits 10 s in total and the RPC has 3 s of it. */
const TURNSTILE_TIMEOUT_MS = 4_000;

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

type Level = 'info' | 'warn' | 'error';

/**
 * One JSON line per event, so Workers Observability can filter by route and
 * event. Callers pass ids, statuses and codes only, never form values.
 */
export function logEvent(route: string, level: Level, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ route, event, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}

// ---------------------------------------------------------------------------
// Request ids
// ---------------------------------------------------------------------------

/** The response header that carries the id; log lines carry it as `request_id`. */
export const REQUEST_ID_HEADER = 'X-Request-Id';

// A Cloudflare Ray ID, e.g. "8f1e2d3c4b5a6978-AMS". On Cloudflare the edge
// sets cf-ray and a caller cannot; anywhere else (local dev, tests) the header
// is whatever was sent, so only this shape is taken over into logs and headers.
const RAY_ID_RE = /^[0-9a-f]{8,32}(?:-[a-z0-9]{2,8})?$/i;

// What crypto.randomUUID() makes: the only other shape an id can have.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function rayId(request: Request): string | null {
  const ray = request.headers.get('cf-ray')?.trim();
  return ray && RAY_ID_RE.test(ray) ? ray : null;
}

/**
 * The id for this request: Cloudflare's Ray ID when there is one (the same id
 * Workers Logs files the invocation under, and the browser sees as the cf-ray
 * response header), otherwise the one src/proxy.ts made and handed over in
 * the X-Request-Id request header, otherwise a random one.
 *
 * The handed-over id is only read where there is no Ray ID, which is off
 * Cloudflare (local dev, tests). The proxy overwrites that header on every
 * /api request, so a caller's own value gets here only when a handler is
 * called without the proxy, and then only if it is shaped like a UUID.
 */
export function requestId(request: Request): string {
  const ray = rayId(request);
  if (ray) return ray;
  const handed = request.headers.get(REQUEST_ID_HEADER)?.trim();
  return handed && UUID_RE.test(handed) ? handed : crypto.randomUUID();
}

/**
 * For src/proxy.ts, which sees the request first. `id` is the Ray ID or a new
 * random id, never a value the caller sent as X-Request-Id. `handOver` is true
 * when the id was made here, so the handler cannot work it out for itself and
 * has to be given it.
 */
export function mintRequestId(request: Request): { id: string; handOver: boolean } {
  const ray = rayId(request);
  return ray ? { id: ray, handOver: false } : { id: crypto.randomUUID(), handOver: true };
}

export interface RequestLog {
  /** The request's id. */
  id: string;
  /** logEvent for this request's route, with request_id added. */
  log(level: Level, event: string, fields?: Record<string, unknown>): void;
  /** `{ 'X-Request-Id': id }`, for a response built outside withRequestLog. */
  headers: Record<string, string>;
}

export function requestLog(route: string, request: Request): RequestLog {
  const id = requestId(request);
  return {
    id,
    // Spread last, so a field that happens to be called request_id (a scrubbed
    // browser report, say) can never replace the real one.
    log: (level, event, fields = {}) => logEvent(route, level, event, { ...fields, request_id: id }),
    headers: { [REQUEST_ID_HEADER]: id },
  };
}

/**
 * Where a shared helper writes its lines: the request's log, or just a route
 * name for a caller outside a request (those lines carry no request_id).
 */
export type LogTarget = string | Pick<RequestLog, 'log'>;

export function logTo(target: LogTarget, level: Level, event: string, fields: Record<string, unknown> = {}): void {
  if (typeof target === 'string') logEvent(target, level, event, fields);
  else target.log(level, event, fields);
}

const REQUEST_LOGGED = Symbol.for('nixgen.site.withRequestLog');

/** redirect(), notFound() and friends signal by throwing; that is not a failure. */
function isFrameworkSignal(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' && (digest.startsWith('NEXT_') || digest === 'DYNAMIC_SERVER_USAGE');
}

function withRequestIdHeader(response: Response, id: string): Response {
  try {
    response.headers.set(REQUEST_ID_HEADER, id);
    return response;
  } catch {
    // Immutable headers (Response.redirect(), a fetch() response passed on).
    const copy = new Response(response.body, response);
    copy.headers.set(REQUEST_ID_HEADER, id);
    return copy;
  }
}

/**
 * Wraps a route handler: `export const POST = withRequestLog(ROUTE, async
 * (request, log) => …)`. The handler logs through `log`, and whichever
 * response it returns leaves with X-Request-Id, so no return path can forget
 * the header. A handler that throws is logged under the same id (the error's
 * name only) and rethrown for the framework to answer; that 500 is not
 * written here, so its header comes from src/proxy.ts.
 *
 * src/app/api/routes.test.ts fails for any exported method that is not wrapped.
 */
export function withRequestLog<A extends unknown[]>(
  route: string,
  handler: (request: Request, log: RequestLog, ...rest: A) => Response | Promise<Response>,
): (request: Request, ...rest: A) => Promise<Response> {
  const wrapped = async (request: Request, ...rest: A): Promise<Response> => {
    const log = requestLog(route, request);
    let response: Response;
    try {
      response = await handler(request, log, ...rest);
    } catch (err) {
      if (!isFrameworkSignal(err)) {
        log.log('error', 'handler_threw', { error: err instanceof Error ? err.name : 'unknown' });
      }
      throw err;
    }
    return withRequestIdHeader(response, log.id);
  };
  return Object.assign(wrapped, { [REQUEST_LOGGED]: true });
}

/** True for a handler made by withRequestLog. */
export function hasRequestLog(handler: unknown): boolean {
  return typeof handler === 'function' && (handler as unknown as Record<symbol, unknown>)[REQUEST_LOGGED] === true;
}

// ---------------------------------------------------------------------------
// Origin, content type and body
// ---------------------------------------------------------------------------

/** Why the request is not from this site's own pages, or null when it is. */
export function crossSiteReason(request: Request): string | null {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return `sec-fetch-site ${site}`;

  const origin = request.headers.get('origin');
  if (origin === null) return null;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return 'unparseable origin';
  }
  const hosts = new Set<string>();
  const hostHeader = request.headers.get('host');
  if (hostHeader) hosts.add(hostHeader.toLowerCase());
  try {
    hosts.add(new URL(request.url).host);
  } catch {
    // A relative request.url leaves only the Host header to compare against.
  }
  return originHost && hosts.has(originHost) ? null : `origin ${originHost || origin}`;
}

export type BodyResult = { ok: true; body: unknown } | { ok: false; status: number; error: string };

/** Reads at most `maxBytes` of the body, then parses it as JSON. */
export async function readJsonBody(request: Request, maxBytes = DEFAULT_MAX_BODY_BYTES): Promise<BodyResult> {
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > maxBytes) {
    return { ok: false, status: 413, error: 'Request too large.' };
  }
  if (!request.body) return { ok: false, status: 400, error: 'Invalid request.' };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, status: 413, error: 'Request too large.' };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, error: 'Invalid request.' };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, body: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, status: 400, error: 'Invalid request.' };
  }
}

export type GuardResult =
  | { ok: true; input: Record<string, unknown> }
  | { ok: false; status: number; error: string };

/**
 * The checks every public JSON POST runs, in order: JSON content type (415),
 * same origin (403), capped body (413/400), a plain object (400). `log` is
 * only where the refusal is written.
 */
export async function guardJsonPost(
  request: Request,
  log: LogTarget,
  maxBytes = DEFAULT_MAX_BODY_BYTES,
): Promise<GuardResult> {
  const contentType = (request.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    return { ok: false, status: 415, error: 'Send the request as JSON.' };
  }

  const crossSite = crossSiteReason(request);
  if (crossSite) {
    logTo(log, 'warn', 'cross_site_refused', { reason: crossSite });
    return { ok: false, status: 403, error: 'Forbidden.' };
  }

  const read = await readJsonBody(request, maxBytes);
  if (!read.ok) return read;
  const body = read.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, error: 'Invalid request.' };
  }
  return { ok: true, input: body as Record<string, unknown> };
}

/** True when the hidden bot-trap field (formsubmit's `_honey` by default) was filled. */
export function honeypotFilled(input: Record<string, unknown>, field = '_honey'): boolean {
  const value = input[field];
  return typeof value === 'string' && value.trim() !== '';
}

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

/** A trimmed string capped at `max` characters; '' for anything that is not a string. */
export function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

// The same shape intake_site_lead (034) and intake_subscriber (039) accept, so
// an address the route lets through is never refused by the database (which
// would turn a typo like "a@b.co." into an email fallback instead of a prompt).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@.]+$/;

export function isEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_RE.test(value);
}

// ---------------------------------------------------------------------------
// Client IP and ip_hash
// ---------------------------------------------------------------------------

/** The visitor's IP as Cloudflare reports it, or null off Cloudflare. */
export function clientIp(request: Request): string | null {
  const ip = request.headers.get('cf-connecting-ip')?.trim();
  return ip ? ip.slice(0, 64) : null;
}

/**
 * The part of an address that identifies one connection. IPv6 clients rotate
 * through their /64 at will, so only the first four hextets count; otherwise
 * one visitor could dodge the throttle by changing the low bits.
 */
export function ipNetwork(ip: string): string {
  if (!ip.includes(':')) return ip;
  // IPv4-mapped IPv6 (::ffff:203.0.113.9) is one IPv4 client.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return mapped[1];
  const [head, tail = ''] = ip.toLowerCase().split('::', 2);
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const missing = Math.max(0, 8 - left.length - right.length);
  const groups = ip.includes('::') ? [...left, ...Array(missing).fill('0'), ...right] : left;
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, '') || '0')
    .join(':')}::/64`;
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * SHA-256 of LEAD_IP_SALT plus the visitor's network, hex. Null without a
 * salt (an unsalted hash of an IPv4 address is reversible by brute force, so
 * nothing is better than that) or without an IP. /api/contact and
 * /api/subscribe refuse to run without the salt; a null from a missing IP
 * (off Cloudflare) lands in the database's one shared, tight bucket.
 */
export async function ipHash(request: Request): Promise<string | null> {
  const salt = process.env.LEAD_IP_SALT;
  const ip = clientIp(request);
  if (!salt || !ip) return null;
  const data = new TextEncoder().encode(`${salt}|${ipNetwork(ip)}`);
  return toHex(await crypto.subtle.digest('SHA-256', data));
}

// ---------------------------------------------------------------------------
// Turnstile
// ---------------------------------------------------------------------------

/**
 * - `pass`: Siteverify accepted the token.
 * - `missing`: no usable token was sent.
 * - `fail`: Siteverify rejected the token.
 * - `unavailable`: Siteverify could not be asked, or answered with its own error.
 */
export type TurnstileOutcome = 'pass' | 'missing' | 'fail' | 'unavailable';

/** Siteverify for one token. Never throws. */
export async function verifyTurnstile(
  secret: string,
  token: unknown,
  ip: string | null,
  log: LogTarget = 'guard',
): Promise<TurnstileOutcome> {
  if (typeof token !== 'string' || !token || token.length > 2048) return 'missing';
  const form = new URLSearchParams({ secret, response: token });
  if (ip) form.set('remoteip', ip);
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS),
    });
    const outcome = (await res.json()) as { success?: unknown; 'error-codes'?: unknown };
    if (outcome.success === true) return 'pass';
    const codes = Array.isArray(outcome['error-codes']) ? outcome['error-codes'].map(String) : [];
    // Cloudflare's own fault, not the visitor's.
    if (!res.ok || codes.includes('internal-error')) {
      logTo(log, 'error', 'turnstile_unavailable', { status: res.status, codes });
      return 'unavailable';
    }
    logTo(log, 'warn', 'turnstile_rejected', { codes });
    return 'fail';
  } catch (err) {
    logTo(log, 'error', 'turnstile_unavailable', { error: err instanceof Error ? err.name : 'unknown' });
    return 'unavailable';
  }
}

export type TurnstileVerdict =
  /** TURNSTILE_SECRET_KEY is not set: the check is off and nothing is implied. */
  | { configured: false; ok: null; outcome: null }
  | { configured: true; ok: boolean; outcome: TurnstileOutcome };

/** Turnstile for this request when the secret is configured. Never throws. */
export async function turnstileVerdict(
  request: Request,
  token: unknown,
  log: LogTarget = 'guard',
): Promise<TurnstileVerdict> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { configured: false, ok: null, outcome: null };
  const outcome = await verifyTurnstile(secret, token, clientIp(request), log);
  return { configured: true, ok: outcome === 'pass', outcome };
}

// ---------------------------------------------------------------------------
// Signed render timestamp
// ---------------------------------------------------------------------------

export type FormTokenVerdict = { configured: false; check: null } | { configured: true; check: FormTokenCheck };

/**
 * The minimum-fill-time check when FORM_TOKEN_SECRET is configured, for the
 * visitor `bind` names (their ipHash, or ''; the value the token was issued
 * for). Never throws.
 */
export async function formTokenVerdict(token: unknown, now = Date.now(), bind = ''): Promise<FormTokenVerdict> {
  const secret = process.env.FORM_TOKEN_SECRET;
  if (!secret) return { configured: false, check: null };
  return { configured: true, check: await verifyFormToken(secret, token, { now, bind }) };
}
