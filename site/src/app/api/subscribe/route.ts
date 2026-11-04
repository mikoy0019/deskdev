import { NextResponse } from 'next/server';
import { cleanText, guardJsonPost, honeypotFilled, ipHash, isEmail, turnstileVerdict, withRequestLog } from '../../../lib/guard';
import { RATE_LIMIT_WINDOW_SECONDS, rateLimited } from '../../../lib/rateLimit';

// The footer's newsletter box. Records the address in DeskDev (Growth →
// Subscribers) through the database function intake_subscriber (migration
// 039), called with the anon key plus LEAD_INTAKE_SECRET, which the function
// checks against the Vault secret 'lead_intake_secret'. Nothing is sent to
// subscribers yet (PLAN Q8); the list is captured with consent for later.
//
// Same guard as /api/contact (src/lib/guard.ts), with a 4 KB body cap. Unlike
// a lead, a subscription has no quarantine, so a Turnstile rejection refuses
// it; a Siteverify outage still lets it through as turnstile_ok null (the
// database refuses an explicit false, and it throttles either way). Set
// TURNSTILE_SECRET_KEY only once the footer form sends a token as well.
//
// Consent is explicit: the form must send consent: true (a ticked box, or a
// button whose label says what the visitor is signing up for). Anything else
// is a 400 here, before the database is asked.
//
// LEAD_IP_SALT is required, as for /api/contact: without it every caller
// would share the database's one no-ip_hash bucket.
//
// Response: { success, error? }. Whether the address was already on the list
// (or had unsubscribed) is never revealed ('subscribed' and 'already' answer
// the same), so the endpoint cannot be used to test addresses.

const ROUTE = 'subscribe';
const MAX_BODY_BYTES = 4 * 1024;
const RPC_TIMEOUT_MS = 3_000;

const INVALID_EMAIL = 'Enter a valid email address.';
const VERIFY_FAILED = 'Verification failed. Please try again.';
const UNAVAILABLE = 'Could not subscribe you right now. Please try again later.';

/**
 * Retry-After for a throttled signup. intake_subscriber (039) counts over 10
 * minutes, an hour (per address) and a day, and does not say which limit was
 * hit, so this is the shortest window: by then the 10-minute counts have
 * emptied. A caller held by the hourly or daily cap is throttled again on the
 * retry.
 */
const THROTTLE_RETRY_AFTER_SECONDS = 10 * 60;

function reply(status: number, error?: string, retryAfterSeconds = THROTTLE_RETRY_AFTER_SECONDS) {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  if (status === 429) headers['Retry-After'] = String(retryAfterSeconds);
  return NextResponse.json({ success: status === 200, ...(error ? { error } : {}) }, { status, headers });
}

/** Where the box sits, e.g. 'footer' or 'blog'; the same slug rule as intake_subscriber (039), or the default. */
function sourceOf(value: unknown): string {
  const source = cleanText(value, 64).toLowerCase();
  return /^[a-z0-9_-]{1,32}$/.test(source) ? source : 'footer';
}

export const POST = withRequestLog(ROUTE, async (request, log) => {
  // A ceiling in front of the database, as on /api/contact: the throttle in
  // intake_subscriber (039) costs a database call to ask, and a workers.dev
  // address has no WAF rule. Refused before the body is read.
  if (await rateLimited(request, ROUTE, log)) {
    return reply(429, 'Too many requests. Please try again in a minute.', RATE_LIMIT_WINDOW_SECONDS);
  }

  const guarded = await guardJsonPost(request, log, MAX_BODY_BYTES);
  if (!guarded.ok) return reply(guarded.status, guarded.error);
  const input = guarded.input;

  if (honeypotFilled(input)) {
    log.log('warn', 'honeypot_filled');
    return reply(200);
  }

  const email = cleanText(input.email, 254);
  if (!email || !isEmail(email)) return reply(400, INVALID_EMAIL);
  if (input.consent !== true) return reply(400, 'Confirm you would like to receive our emails.');

  const secret = process.env.LEAD_INTAKE_SECRET;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const ipSalt = process.env.LEAD_IP_SALT;
  if (!secret || !supabaseUrl || !anonKey || !ipSalt) {
    log.log('error', 'intake_not_configured', {
      secret: Boolean(secret),
      url: Boolean(supabaseUrl),
      anonKey: Boolean(anonKey),
      ipSalt: Boolean(ipSalt),
    });
    return reply(503, 'Subscriptions are not available right now.');
  }

  const turnstile = await turnstileVerdict(request, input.turnstileToken, log);
  if (turnstile.configured && (turnstile.outcome === 'fail' || turnstile.outcome === 'missing')) {
    return reply(403, VERIFY_FAILED);
  }

  const payload = {
    email,
    source: sourceOf(input.source),
    consent: true,
    ip_hash: await ipHash(request),
    // An outage is "unknown" (null), not a failure: intake_subscriber refuses
    // turnstile_ok false outright, and Cloudflare's fault is not the visitor's.
    turnstile_ok: turnstile.configured && turnstile.outcome !== 'unavailable' ? turnstile.ok : null,
  };

  let result: { ok?: unknown; status?: unknown };
  try {
    const res = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/intake_subscriber`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      body: JSON.stringify({ p_secret: secret, p_payload: payload }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
    if (!res.ok) {
      const code = await res
        .json()
        .then((b: unknown) => {
          const code = (b as { code?: unknown } | null)?.code;
          return typeof code === 'string' ? code : null;
        })
        .catch(() => null);
      // 42501: LEAD_INTAKE_SECRET does not match the Vault row (or it is missing).
      log.log('error', code === '42501' ? 'intake_secret_rejected' : 'intake_rpc_failed', {
        status: res.status,
        code,
      });
      return reply(502, UNAVAILABLE);
    }
    result = (await res.json()) ?? {};
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    log.log('error', timedOut ? 'intake_rpc_timeout' : 'intake_rpc_unreachable', {
      error: err instanceof Error ? err.name : 'unknown',
    });
    return reply(502, UNAVAILABLE);
  }

  // intake_subscriber (039): ok true for subscribed | already;
  // ok false for throttled | invalid | unverified.
  const status = typeof result.status === 'string' ? result.status : null;
  if (result.ok === true) {
    log.log('info', 'subscriber_recorded', { status });
    return reply(200);
  }
  if (status === 'throttled') {
    log.log('warn', 'subscriber_throttled');
    return reply(429, 'Too many requests. Please try again later.');
  }
  if (status === 'invalid') {
    log.log('warn', 'subscriber_invalid');
    return reply(400, INVALID_EMAIL);
  }
  if (status === 'unverified') {
    log.log('warn', 'subscriber_unverified');
    return reply(403, VERIFY_FAILED);
  }
  log.log('error', 'intake_rpc_refused', { status });
  return reply(502, UNAVAILABLE);
});
