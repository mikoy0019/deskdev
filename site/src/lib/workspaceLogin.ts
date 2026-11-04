// The site's links into DeskDev, and the Team login's one-time hop through it.
//
// It imports only src/lib/hosts.ts, which is import-free, on purpose: the
// Navbar on every page uses workspaceLoginUrl(), and src/lib/deskdev.ts
// (which creates a Supabase client) must stay on the login page alone.

import { WORKSPACE_ORIGIN } from './hosts';

// DeskDev's own origin when it is split onto its subdomain (src/lib/hosts.ts),
// otherwise the same-origin path. Never the app URL's host when DeskDev shares
// the site's host: one build answers on nixgensolutions.com and on the
// workers.dev address, and a sign-in started on one must not land on the other.
export const APP_URL = WORKSPACE_ORIGIN ?? '/workspace';

/**
 * Only same-app relative paths survive the round-trip — never `//evil.com`.
 * Control characters and backslashes are refused: the URL parser drops
 * tab/newline, so '/\t/evil.com' would otherwise resolve as '//evil.com'.
 * Same rule as safeNext in src/deskdev/lib/siteLogin.ts.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || /[\u0000-\u001F\u007F\\]/.test(next)) return '/';
  return next;
}

/**
 * Where the site's "Team login" links point: DeskDev's /login, not this site's.
 * Someone already signed in there goes straight in; anyone else is sent back
 * to the Team login carrying DeskDev's one-time ?state=, so the handoff lands
 * without the "Continue as …?" question a login started here would need.
 */
export function workspaceLoginUrl(next?: string | null): string {
  const path = safeNext(next);
  return `${APP_URL}/login${path === '/' ? '' : `?next=${encodeURIComponent(path)}`}`;
}

// A login opened here directly (a bookmark, an old link) has no state. It
// takes one hop through workspaceLoginUrl() to pick it up, at most once per
// window: if DeskDev can't mint state (its storage is blocked) it sends the
// visitor back without one, and the form is shown instead of looping.
export const LOGIN_HOP_KEY = 'nx_login_hop';
const HOP_WINDOW_MS = 60_000;

type HopStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Whether this visit to /login should hop through DeskDev first, recording the
 * hop when it should. Never when DeskDev sent the visitor here (state or error
 * present), and never when storage is blocked (the guard couldn't hold).
 * Only meaningful with team sign-in configured; the caller checks that.
 */
export function claimLoginHop(
  params: { state: string | null; error: string | null },
  storage: HopStorage | null,
  now = Date.now(),
): boolean {
  if (!storage) return false;
  try {
    if (params.state) {
      storage.removeItem(LOGIN_HOP_KEY);
      return false;
    }
    if (params.error) return false;
    const last = Number(storage.getItem(LOGIN_HOP_KEY));
    if (last && now - last < HOP_WINDOW_MS) return false;
    storage.setItem(LOGIN_HOP_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}
