import { NextResponse, type NextRequest } from 'next/server';
// Relative, like the rest of src/lib.
import { REQUEST_ID_HEADER, mintRequestId } from './lib/guard';
import { SITE_HOSTNAME, WORKSPACE_ORIGIN, normalizeHost } from './lib/hosts';

// Two jobs, told apart by the path (see `matcher` at the bottom).

/**
 * /api/*: the request id, on the answers no route handler writes.
 *
 * A handler puts X-Request-Id on its own response (withRequestLog in
 * src/lib/guard.ts). The framework answers some requests without calling one:
 * 405 for a method the route does not export, the automatic OPTIONS, 404 for
 * an unknown /api path, and the 500 after a handler threw. This runs before
 * the route is chosen and its response headers are added to whatever is sent,
 * so those answers carry the id too.
 *
 * On Cloudflare the id is the Ray ID and the handler reads the same one from
 * the request, so nothing is handed over and the request is left as it came.
 * Anywhere else it is made here and passed on in a request header, or the
 * header and the handler's log lines would name two different ids.
 */
function withRequestId(request: NextRequest) {
  const { id, handOver } = mintRequestId(request);
  let response: NextResponse;
  if (handOver) {
    const headers = new Headers(request.headers);
    headers.set(REQUEST_ID_HEADER, id);
    response = NextResponse.next({ request: { headers } });
  } else {
    response = NextResponse.next();
  }
  response.headers.set(REQUEST_ID_HEADER, id);
  return response;
}

// /workspace/*: DeskDev on its own subdomain (src/lib/hosts.ts). The site's
// /workspace/* moves there, query intact: links like /workspace/login?direct=1
// or /workspace/settings?section=integrations depend on it. The proxy runs on
// these paths anyway, so the redirect lives here, next to its host check.
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === '/api' || pathname.startsWith('/api/')) return withRequestId(request);

  if (!SITE_HOSTNAME || !WORKSPACE_ORIGIN) return NextResponse.next();
  if (normalizeHost(request.headers.get('host')) !== SITE_HOSTNAME) return NextResponse.next();

  const path = pathname.replace(/^\/workspace/, '') || '/';
  return NextResponse.redirect(`${WORKSPACE_ORIGIN}${path}${search}`, 307);
}

export const config = {
  matcher: ['/workspace', '/workspace/:path*', '/api/:path*'],
};
