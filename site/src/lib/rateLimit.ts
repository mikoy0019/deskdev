// A per-visitor ceiling in front of the public endpoints. /api/client-errors
// and /api/health?deep=1 have no other limit. /api/contact and /api/subscribe
// are throttled properly by their database functions (034, 039), which decide
// who has sent too much; here they only get a cap on how often one network
// can make the database answer that question.
//
// The counter is the Workers rate-limit binding API_LIMITER declared in
// wrangler.jsonc: 20 calls per 60 seconds per key. It needs no zone, so
// it works on the workers.dev address, where a WAF rate rule cannot exist.
// Cloudflare counts per location and loosely, so it is a ceiling against a
// flood, not an exact quota.
//
// It fails open. A missing binding or one that throws lets the request through
// and writes one warn line, because an endpoint that answers is worth more
// than the limiter, and the line makes the gap visible in Workers Logs.

import { clientIp, ipNetwork, logTo, type LogTarget } from './guard';
import { bindings } from './platform';

/** API_LIMITER's period in wrangler.jsonc: what a 429 sends as Retry-After. */
export const RATE_LIMIT_WINDOW_SECONDS = 60;

/**
 * True when this visitor is over the limit for `scope` and the route should
 * answer 429. Each scope counts separately. The visitor is their network (an
 * IPv6 /64, see ipNetwork); callers without an IP, which only happens off
 * Cloudflare, share one bucket per scope.
 *
 * Neither the key nor the IP is ever logged. A refusal is not logged either:
 * the 429 is already in the invocation log, and a line per refused call would
 * hand a flood the log volume the limiter exists to cap.
 */
export async function rateLimited(request: Request, scope: string, log: LogTarget = scope): Promise<boolean> {
  const ip = clientIp(request);
  const key = `${scope}:${ip ? ipNetwork(ip) : 'unknown'}`;
  try {
    const limiter = bindings().API_LIMITER;
    if (!limiter || typeof limiter.limit !== 'function') {
      logTo(log, 'warn', 'limiter_unavailable', { scope, reason: 'no_binding' });
      return false;
    }
    const outcome = await limiter.limit({ key });
    return outcome?.success === false;
  } catch (err) {
    logTo(log, 'warn', 'limiter_unavailable', {
      scope,
      reason: 'threw',
      error: err instanceof Error ? err.name : 'unknown',
    });
    return false;
  }
}
