// Which hostname serves what. One Worker answers both:
//
//   NEXT_PUBLIC_SITE_URL  https://nixgensolutions.com            → the site
//   NEXT_PUBLIC_APP_URL   https://workspace.nixgensolutions.com  → DeskDev, at its root
//
// next.config.ts rewrites every page request on the workspace host to /workspace/*
// and redirects the site host's /workspace/* there. Leave a variable unset (or
// relative) and that half of the split is off — local dev and workers.dev
// previews serve DeskDev same-origin at /workspace.
//
// Pure and import-free: next.config.ts, route handlers and client code all use
// these, so the rewrite and the code that reacts to it can't disagree.

function originOf(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null; // relative, e.g. the old '/workspace' default
  }
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * DeskDev's own origin, or null when the app URL names a host that cannot be
 * split off. One hostname cannot be both the site and DeskDev: the rewrite in
 * next.config.ts would turn every site page into a DeskDev page and the site
 * would be gone. So an app URL on the site's hostname (the workers.dev address
 * before the domain exists, written as https://<host>/workspace) means "no
 * split", and so does a bare loopback host when no site URL is set, which is
 * local dev, where the site is on that same host.
 */
function splitOrigin(appOrigin: string | null, siteHostname: string | null): string | null {
  if (!appOrigin) return null;
  const hostname = new URL(appOrigin).hostname;
  if (hostname === siteHostname) return null;
  if (siteHostname === null && LOOPBACK_HOSTNAMES.has(hostname)) return null;
  return appOrigin;
}

// Literal `process.env.NEXT_PUBLIC_*` so the build can inline them.
export const SITE_ORIGIN = originOf(process.env.NEXT_PUBLIC_SITE_URL);
export const SITE_HOSTNAME = SITE_ORIGIN && new URL(SITE_ORIGIN).hostname;

export const WORKSPACE_ORIGIN = splitOrigin(originOf(process.env.NEXT_PUBLIC_APP_URL), SITE_HOSTNAME);
export const WORKSPACE_HOSTNAME = WORKSPACE_ORIGIN && new URL(WORKSPACE_ORIGIN).hostname;

/**
 * The one hostname search engines may index. A build that names any other
 * site URL, or none (the workers.dev address before the DNS cutover, a
 * preview, local dev), tells them to stay out: robots.ts and the
 * X-Robots-Tag header in next.config.ts both read this.
 */
export const PRODUCTION_SITE_HOSTNAME = 'nixgensolutions.com';
export const INDEXABLE = SITE_HOSTNAME === PRODUCTION_SITE_HOSTNAME;

/**
 * The `source` of the workspace host's rewrite to /workspace/:path
 * (next.config.ts): every path except the ones that are already real there.
 * /_next/* is client chunks, /workspace/* is public/workspace files and the
 * workspace route handlers, and /api/* is the site's route handlers. Without
 * api/ in the list, DeskDev's same-origin POST to /api/client-errors would
 * land on /workspace/api/... (404), and posting to the site host instead is
 * refused as same-site by guard.ts.
 */
export const WORKSPACE_REWRITE_SOURCE = '/:path((?!_next/|workspace(?:/|$)|api/).*)';

/** A Host header or hostname as Next.js's `has: host` sees it: lowercased, no port. */
export function normalizeHost(host: string | null | undefined): string {
  return (host ?? '').split(':', 1)[0].toLowerCase();
}

/** True on DeskDev's own hostname — pass `request.headers.get('host')` or `location.host`. */
export function isWorkspaceHost(host: string | null | undefined): boolean {
  return WORKSPACE_HOSTNAME !== null && normalizeHost(host) === WORKSPACE_HOSTNAME;
}
