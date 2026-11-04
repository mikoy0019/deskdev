import { createClient } from '@supabase/supabase-js';
import { APP_URL, safeNext } from './workspaceLogin';

export { APP_URL, safeNext };

// Team login → DeskDev handoff.
//
// DeskDev is a route of this same app at /workspace (src/app/workspace), which
// production serves at the root of its own subdomain (src/lib/hosts.ts) — a
// different origin, so its Supabase session can't simply be shared. The site signs in against DeskDev's Supabase project, then hands the session
// to the app at `${APP_URL}/auth/callback#dd_at=…&dd_rt=…&next=…`.
// Tokens ride in the URL fragment, which is never sent to a server or leaked
// in a Referer; the app strips it from history before doing anything else.
// The param names deliberately differ from Supabase's own `access_token`
// fragment so the app's client doesn't try to auto-detect them.
//
// The site never keeps the session: no storage, no auto-refresh. DeskDev is
// the only holder of the refresh token, so rotation can't race between the
// two. Never call auth.signOut() here — it would revoke the session the app
// just received.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isAuthConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isAuthConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
  : null;

/** DeskDev's one-time login state (?state=…), echoed back untouched. Same shape check as the app's. */
export function safeState(state: string | null | undefined): string | null {
  return state && /^[A-Za-z0-9-]{16,64}$/.test(state) ? state : null;
}

/**
 * Where to send the browser once signed in. `state` is the value DeskDev put on
 * ?state= when it sent the visitor here; echoing it lets DeskDev apply the
 * session without asking. Without it (a login started on this site) DeskDev
 * asks "Continue as …?" first, so a crafted link can't silently switch accounts.
 */
export function handoffUrl(accessToken: string, refreshToken: string, next: string, state?: string | null): string {
  const fragment = new URLSearchParams({ dd_at: accessToken, dd_rt: refreshToken, next: safeNext(next) });
  const echoed = safeState(state);
  if (echoed) fragment.set('dd_state', echoed);
  return `${APP_URL}/auth/callback#${fragment.toString()}`;
}

/** Where a password-reset email lands — DeskDev's own reset page (absolute, for Supabase). */
export function resetRedirect(): string {
  return new URL(`${APP_URL}/reset-password`, window.location.origin).toString();
}
