import { NextResponse } from 'next/server';
import { attributionForIntake, leadSourceOf, sanitizeAttribution } from '../../../lib/attribution';
import { issueFormToken } from '../../../lib/formToken';
import {
  cleanText,
  crossSiteReason,
  formTokenVerdict,
  guardJsonPost,
  honeypotFilled,
  ipHash,
  isEmail,
  turnstileVerdict,
  withRequestLog,
} from '../../../lib/guard';
import { RATE_LIMIT_WINDOW_SECONDS, rateLimited } from '../../../lib/rateLimit';

// The contact form's lead hand-off to DeskDev's Growth Hub. The browser posts
// here (same origin) and this route records the enquiry through the database
// function intake_site_lead (migration 034), called with the public anon key
// plus LEAD_INTAKE_SECRET. The function checks that secret against the
// Supabase Vault row 'lead_intake_secret', so the anon key alone cannot write
// leads, and the Worker never holds a service-role key (PLAN §3 rule 5).
// Everything after the insert (owner, SLA, notifications, the n8n auto-reply
// and Sheets row) happens in the database and its triggers.
//
// Worker settings on nixgen-site (how to set them: site/README.md, "Worker secrets"):
// - LEAD_INTAKE_SECRET   required; the same value as the Vault secret.
// - LEAD_IP_SALT         required; the per-visitor throttle depends on it.
//                        Without it the route
//                        answers 'failed' (email fallback) rather than let
//                        every caller share one anonymous bucket.
// - TURNSTILE_SECRET_KEY optional; set it once ContactForm renders the widget,
//                        or every lead lands in Quarantine.
// - FORM_TOKEN_SECRET    optional; set it once ContactForm posts `formToken`
//                        (GET this route for one), or every lead lands in Quarantine.
// NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are build values.
//
// Abuse controls, in order (the generic ones live in src/lib/guard.ts):
// - The Worker's limiter (src/lib/rateLimit.ts, the API_LIMITER binding): 20
//   posts a minute per network, counted before the body is read. Past it the
//   answer is 429 with Retry-After: 60 and no email fallback, because the
//   sender caused it. It needs no zone, so it also works on the workers.dev
//   address, where a WAF rate rule cannot exist. It fails open: if the binding
//   is missing or throws, the brief goes on to the checks below.
// - JSON only, same origin only, 64 KB body cap, honeypot (fake success).
// - Signed render timestamp: a brief sent under 3 s after the form appeared,
//   or with a missing, forged or expired (MAX_AGE_MS) token, or one fetched
//   from another browser (bound to an HttpOnly cookie), is a spam signal.
// - Turnstile: a failed or unreachable Siteverify is a spam signal too. None
//   of these reject the brief: the database quarantines it (spam = true, no
//   notifications, no auto-reply) where Growth can release it, because a
//   real lead must never be lost to a false positive.
// - Throttle: the database counts recent briefs per ip_hash, per email and
//   overall, and says which limit was hit. The 429 carries Retry-After. This
//   is what decides who has sent too many briefs; the limiter at the top only
//   caps how often one network can make the database answer that question.
//
// Response contract with ContactForm, which decides the formsubmit.co fallback:
//   { success, lead, fallback, error? }
//   lead: 'recorded'    the brief is in DeskDev (200)
//         'throttled'   too many recent briefs (429). From this connection
//                       ('visitor'): the form shows `error`. For this address
//                       or overall ('address' / 'global'): the sender did
//                       nothing wrong, so fallback is true and the brief is
//                       emailed instead of lost.
//         'invalid'     the form shows `error` (400/403/413/415); includes the
//                       database refusing the name or email (22023)
//         'failed'      intake is down or not configured (502/503)
//         'unconfirmed' the database did not answer within 3 s; it may still land (504)
//   fallback: true when the form should email the brief through formsubmit.co
//   so it is not lost. The email is the safety net for 'failed', 'unconfirmed'
//   and a throttle the sender did not cause.

const ROUTE = 'contact';

const BROWSER_COOKIE = 'nixgen_contact_browser';
const BROWSER_TOKEN_PREFIX = 'browser.';

function browserBinding(request: Request): string | null {
  const value = request.headers.get('cookie')?.split(';')
    .map((part) => part.trim()).find((part) => part.startsWith(`${BROWSER_COOKIE}=`))
    ?.slice(BROWSER_COOKIE.length + 1);
  return value && /^[a-f0-9-]{36}$/.test(value) ? value : null;
}

/** The database answers in well under a second; past this, the form falls back to email. */
const RPC_TIMEOUT_MS = 3_000;

// Every field is capped here and again in the database, so one request cannot
// push an arbitrarily large row into the leads table.
const LIMITS = {
  name: 120,
  email: 254,
  phone: 40,
  company: 160,
  budget_band: 80,
  timeline: 80,
  message: 5000,
} as const;
const MAX_SERVICES = 8;
const MAX_SERVICE = 80;

/** The legacy pickers send this when nothing was chosen. */
const NOT_SELECTED = 'not selected';

/**
 * Retry-After for a throttled brief. intake_site_lead (034) counts over 10
 * minutes and over a day, and names the limit that was hit (visitor, address,
 * global) but not the window, so this is the shorter one: by then the
 * 10-minute count has emptied. A sender held by a daily cap is throttled
 * again on the retry.
 */
const THROTTLE_RETRY_AFTER_SECONDS = 10 * 60;

/** Shown when the Worker's own limiter (src/lib/rateLimit.ts) refuses a brief. */
const TOO_FAST = 'Too many briefs were sent from this connection in the last minute. Please wait a minute and try again.';

type LeadStatus = 'recorded' | 'throttled' | 'invalid' | 'failed' | 'unconfirmed';

function reply(
  status: number,
  lead: LeadStatus,
  error?: string,
  fallbackOverride?: boolean,
  retryAfterSeconds = THROTTLE_RETRY_AFTER_SECONDS,
) {
  const fallback = fallbackOverride ?? (lead === 'failed' || lead === 'unconfirmed');
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  if (status === 429) headers['Retry-After'] = String(retryAfterSeconds);
  return NextResponse.json(
    { success: lead === 'recorded', lead, fallback, ...(error ? { error } : {}) },
    { status, headers },
  );
}

function chosen(value: unknown, max: number): string {
  const text = cleanText(value, max);
  return text.toLowerCase() === NOT_SELECTED ? '' : text;
}

/** Services as an array: the new multi-select `services`, or the legacy single `system` picker. */
function servicesOf(input: Record<string, unknown>): string[] {
  const raw = Array.isArray(input.services) ? input.services : [input.system];
  const out: string[] = [];
  for (const item of raw) {
    const service = chosen(item, MAX_SERVICE);
    if (service && !out.includes(service)) out.push(service);
    if (out.length === MAX_SERVICES) break;
  }
  return out;
}

const URL_RE = /https?:\/\//gi;
const MANY_LINKS = 4;

/**
 * GET hands the form a signed render timestamp (formToken.ts). The contact
 * page may be statically rendered, so a timestamp baked into its HTML would
 * be the build time; the form fetches one on mount instead.
 */
export const GET = withRequestLog(ROUTE, async (request, log) => {
  const crossSite = crossSiteReason(request);
  if (crossSite) {
    log.log('warn', 'cross_site_refused', { reason: crossSite, method: 'GET' });
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }
  const secret = process.env.FORM_TOKEN_SECRET;
  // Keep the proof bound to this browser when mobile networks, VPNs or IPv4/
  // IPv6 routing change between rendering and submitting the form. The IP
  // hash still independently limits submissions in the database.
  const binding = browserBinding(request) ?? crypto.randomUUID();
  const token = secret ? BROWSER_TOKEN_PREFIX + await issueFormToken(secret, Date.now(), binding) : null;
  const response = NextResponse.json({ token }, { headers: { 'Cache-Control': 'no-store' } });
  if (secret) response.cookies.set(BROWSER_COOKIE, binding, {
    httpOnly: true,
    secure: new URL(request.url).protocol === 'https:',
    sameSite: 'strict',
    path: '/api/contact',
    maxAge: 24 * 60 * 60,
  });
  return response;
});

export const POST = withRequestLog(ROUTE, async (request, log) => {
  // A ceiling in front of the database. Its own throttle (034) decides who has
  // sent too many briefs, but asking it costs a database call, and on a
  // workers.dev address no WAF rule can stand in front. Twenty posts a minute
  // from one network is far more than anyone filling in a form sends. Past
  // that the brief is refused here, before the body is read, and the form
  // shows the message (no email fallback: the sender caused it).
  if (await rateLimited(request, ROUTE, log)) {
    return reply(429, 'throttled', TOO_FAST, false, RATE_LIMIT_WINDOW_SECONDS);
  }

  const guarded = await guardJsonPost(request, log);
  if (!guarded.ok) {
    const error = guarded.status === 415 ? 'Send the enquiry as JSON.' : guarded.error;
    return reply(guarded.status, 'invalid', error);
  }
  const input = guarded.input;

  // A filled honeypot is a bot. Answer as if it worked so it learns nothing.
  if (honeypotFilled(input)) {
    log.log('warn', 'honeypot_filled');
    return reply(200, 'recorded');
  }

  const lead = {
    name: cleanText(input.name, LIMITS.name),
    email: cleanText(input.email, LIMITS.email),
    phone: cleanText(input.phone, LIMITS.phone),
    company: cleanText(input.company, LIMITS.company),
    services: servicesOf(input),
    budget_band: chosen(input.budget_band ?? input.budget, LIMITS.budget_band),
    timeline: chosen(input.timeline, LIMITS.timeline),
    message: cleanText(input.message, LIMITS.message),
  };

  if (!lead.name || !lead.email || !lead.message) {
    return reply(400, 'invalid', 'Name, email, and message are required.');
  }
  if (!isEmail(lead.email)) {
    return reply(400, 'invalid', 'Enter a valid email address.');
  }

  // Checked before Siteverify, which would be wasted on a brief that cannot be stored.
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
    return reply(503, 'failed', 'Lead capture is not configured.');
  }
  // Null off Cloudflare (no cf-connecting-ip, e.g. local dev); the database
  // gives those calls one shared, tight bucket.
  const visitor = await ipHash(request);

  // Spam signals. Each one quarantines the lead in the database; none rejects it.
  const signals: string[] = [];

  const browserToken = typeof input.formToken === 'string' && input.formToken.startsWith(BROWSER_TOKEN_PREFIX);
  // Existing open tabs can finish with the previous network-bound token.
  const form = await formTokenVerdict(
    browserToken ? (input.formToken as string).slice(BROWSER_TOKEN_PREFIX.length) : input.formToken,
    Date.now(),
    browserToken ? browserBinding(request) ?? '' : visitor ?? '',
  );
  if (form.configured && !form.check.ok) signals.push(`form_token_${form.check.reason}`);

  const turnstile = await turnstileVerdict(request, input.turnstileToken, log);
  if (turnstile.configured && !turnstile.ok) signals.push(`turnstile_${turnstile.outcome}`);

  // The same threshold intake_site_lead (034) applies; flagged here as well so
  // the log line names it.
  if ((lead.message.match(URL_RE)?.length ?? 0) >= MANY_LINKS) signals.push('many_links');

  const attribution = sanitizeAttribution(input.attribution);
  // Key names are intake_site_lead's (034): it reads `signals` and `source`,
  // and keeps attribution keys it knows only (landing_page, not landing).
  const payload = {
    ...lead,
    form: 'contact',
    source: leadSourceOf(attribution),
    consent: input.consent === true,
    attribution: attributionForIntake(attribution),
    ip_hash: visitor,
    // null: Turnstile is not configured, so it says nothing either way.
    turnstile_ok: turnstile.ok,
    signals,
    fill_ms: form.configured ? form.check.ageMs : null,
  };

  let result: { ok?: unknown; lead_id?: unknown; status?: unknown; reason?: unknown };
  try {
    const res = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/intake_site_lead`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({ p_secret: secret, p_payload: payload }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
    if (!res.ok) {
      // PostgREST's error code only (e.g. 42883 missing function, P0001 raise);
      // its message can echo input.
      const code = await res
        .json()
        .then((b: unknown) => {
          const code = (b as { code?: unknown } | null)?.code;
          return typeof code === 'string' ? code : null;
        })
        .catch(() => null);
      // 22023: the function found no usable name or email after its own
      // cleaning (a name of control characters only, say). The visitor can
      // fix that, so it is a prompt, not an email fallback.
      if (code === '22023') {
        log.log('warn', 'intake_rpc_invalid', { status: res.status, code });
        return reply(400, 'invalid', 'Check your name and email address, then send again.');
      }
      // 42501: LEAD_INTAKE_SECRET does not match the Vault row (or the row is
      // missing). Named separately so the alert says what to fix.
      log.log('error', code === '42501' ? 'intake_secret_rejected' : 'intake_rpc_failed', {
        status: res.status,
        code,
      });
      return reply(502, 'failed', 'Could not record the enquiry.');
    }
    result = (await res.json()) ?? {};
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    log.log('error', timedOut ? 'intake_rpc_timeout' : 'intake_rpc_unreachable', {
      error: err instanceof Error ? err.name : 'unknown',
    });
    return timedOut
      ? reply(504, 'unconfirmed', 'Could not confirm the enquiry.')
      : reply(502, 'failed', 'Could not record the enquiry.');
  }

  const status = typeof result.status === 'string' ? result.status : null;
  const leadId = typeof result.lead_id === 'string' ? result.lead_id : null;

  if (result.ok === true && (status === 'created' || status === 'merged' || status === 'quarantined')) {
    // Quarantine is not revealed to the sender: a bot learns nothing from the answer.
    log.log(status === 'quarantined' ? 'warn' : 'info', `lead_${status}`, { lead_id: leadId, signals });
    return reply(200, 'recorded');
  }
  if (status === 'throttled') {
    const reason = result.reason === 'address' || result.reason === 'global' ? result.reason : 'visitor';
    log.log('warn', 'lead_throttled', { reason });
    if (reason !== 'visitor') {
      // Someone else's flood (another connection, or briefs sent in this
      // address's name) must not cost this sender their brief: email it.
      return reply(429, 'throttled', 'Could not record the enquiry right now.', true);
    }
    return reply(
      429,
      'throttled',
      'Too many briefs were sent from this connection recently. Please try again later, or email nixgensolutions@gmail.com.',
    );
  }
  log.log('error', 'intake_rpc_refused', { ok: result.ok === true, status });
  return reply(502, 'failed', 'Could not record the enquiry.');
});
