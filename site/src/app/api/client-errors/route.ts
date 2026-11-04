import { guardJsonPost, withRequestLog } from '../../../lib/guard';
import { RATE_LIMIT_WINDOW_SECONDS, rateLimited } from '../../../lib/rateLimit';
import { scrubClientError } from '../../../lib/scrub';

// Browser error reports from the site and DeskDev (PLAN Topic D5), written to
// the Worker's logs as one JSON line each, so Workers Observability is the
// error tracker and no third party sees anything. The reporter is
// src/lib/clientErrors.ts, called from DeskDev's AppErrorBoundary, the site's
// error pages and the window 'error' / 'unhandledrejection' listeners. DeskDev
// posts to /api/client-errors on its own host: next.config.ts lets /api/*
// through the workspace rewrite, so the call is same-origin and passes the
// guard (a post to the apex would be same-site, and refused).
//
// The report is rebuilt from known fields and scrubbed (src/lib/scrub.ts):
// no query strings or fragments, no tokens, emails or long secrets, and
// nothing but the error name and digest from the Vault screens. No
// breadcrumbs, cookies, IPs or user ids are accepted or logged.
//
// Same-origin JSON only, 16 KB cap. The body of a 204 is empty either way, so
// a reporter learns nothing it could use to probe. The origin check only stops
// browsers: a script that sends no Origin header passes it, so volume is
// bounded by the Worker itself (src/lib/rateLimit.ts), 20 reports a minute
// per network, counted before the body is read. Past that the answer is an
// empty 429 with Retry-After.

const ROUTE = 'client-errors';
const MAX_BODY_BYTES = 16 * 1024;

export const POST = withRequestLog(ROUTE, async (request, log) => {
  if (await rateLimited(request, ROUTE, log)) {
    return new Response(null, {
      status: 429,
      headers: { 'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS), 'Cache-Control': 'no-store' },
    });
  }

  const guarded = await guardJsonPost(request, log, MAX_BODY_BYTES);
  if (!guarded.ok) return new Response(null, { status: guarded.status, headers: { 'Cache-Control': 'no-store' } });

  const report = scrubClientError(guarded.input);
  log.log('error', 'client_error', report);
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
});
