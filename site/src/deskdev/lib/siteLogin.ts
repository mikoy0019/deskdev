// Web-only (not mirrored to mobile): the NixGen site's Team login hands its
// Supabase session to this app at /auth/callback#dd_at=…&dd_rt=…&next=…&dd_state=….
// The other half lives in src/lib/deskdev.ts — keep the param names in sync.
// They deliberately differ from Supabase's own `access_token` fragment so the
// client's detectSessionInUrl leaves them alone.

import { SITE_ORIGIN, isWorkspaceHost } from '../../lib/hosts'
import { isSupabaseConfigured } from './supabase'

/**
 * Where the site lives, seen from `host`. DeskDev at /workspace is a route of
 * the site, so that's this origin (''). On its own subdomain the site is
 * NEXT_PUBLIC_SITE_URL — or unknown (null) when that's unset, since a relative
 * /login there is DeskDev's own route and would loop.
 */
export function siteBaseFor(host: string): string | null {
  return isWorkspaceHost(host) ? SITE_ORIGIN : ''
}

const SITE_BASE = typeof window !== 'undefined' ? siteBaseFor(window.location.host) : ''

/**
 * Remote mode with a site to go to → sign-in happens on the site's Team login.
 * Local mode has no Supabase session to hand over, so it keeps the in-app form
 * with the demo accounts.
 */
export const usesSiteLogin = isSupabaseConfigured && SITE_BASE !== null

/**
 * Only same-app relative paths survive the round-trip — never `//evil.com`.
 * Control characters and backslashes are refused outright: the URL parser
 * drops tab/newline, so '/\t/evil.com' would otherwise resolve as
 * '//evil.com'. The original string is returned, never a normalised one
 * ('/.//evil.com' normalises to '//evil.com').
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || /[\u0000-\u001F\u007F\\]/.test(next)) return '/'
  return next
}

// ── Handoff state ─────────────────────────────────────────────────────────────
// Login CSRF guard: a handoff is applied without asking only when it carries
// the one-time value THIS tab minted before it went to the site's login. It
// lives in DeskDev's own sessionStorage (per origin, per tab, survives the
// round-trip through the site), so a link someone else crafted can't match it.

export const HANDOFF_STATE_KEY = 'dd_handoff_state'
const STATE_FORMAT = /^[A-Za-z0-9-]{16,64}$/

/** A state value in the shape this app mints (the site checks the same shape). */
export function isHandoffState(value: unknown): value is string {
  return typeof value === 'string' && STATE_FORMAT.test(value)
}

/** The state this tab is waiting for, or null. Doesn't consume it. */
export function pendingHandoffState(): string | null {
  try {
    const value = window.sessionStorage.getItem(HANDOFF_STATE_KEY)
    return isHandoffState(value) ? value : null
  } catch {
    return null
  }
}

/** Forget the pending state (the callback calls this whatever the outcome). */
export function clearHandoffState(): void {
  try {
    window.sessionStorage.removeItem(HANDOFF_STATE_KEY)
  } catch {
    // storage blocked: nothing was stored either
  }
}

/**
 * The state for the next trip to the site's login: the one this tab is
 * already waiting for, else a fresh one. Reusing it keeps a double redirect
 * (StrictMode effects) from leaving storage and URL out of step. null when
 * storage is blocked; the callback then asks before signing in.
 */
export function beginHandoff(): string | null {
  const pending = pendingHandoffState()
  if (pending) return pending
  try {
    const state = crypto.randomUUID()
    window.sessionStorage.setItem(HANDOFF_STATE_KEY, state)
    return state
  } catch {
    return null
  }
}

/**
 * The site's Team login, carrying `next`, `error` and the handoff state.
 * `state` defaults to beginHandoff(); pass null to leave it out.
 */
export function siteLoginUrl(
  opts: { next?: string; error?: string; state?: string | null } = {},
  base = SITE_BASE ?? '',
): string {
  const params = new URLSearchParams()
  const next = safeNext(opts.next)
  if (next !== '/') params.set('next', next)
  if (opts.error) params.set('error', opts.error)
  const state = opts.state === undefined ? beginHandoff() : opts.state
  if (isHandoffState(state)) params.set('state', state)
  const query = params.toString()
  return `${base}/login${query ? `?${query}` : ''}`
}

export interface Handoff {
  accessToken: string
  refreshToken: string
  next: string
  /** The state the site echoed back (dd_state), or null for a login started on the site. */
  state: string | null
}

/** Parses the callback fragment; null when either token is missing. */
export function readHandoff(hash: string): Handoff | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const accessToken = params.get('dd_at')
  const refreshToken = params.get('dd_rt')
  if (!accessToken || !refreshToken) return null
  const state = params.get('dd_state')
  return {
    accessToken,
    refreshToken,
    next: safeNext(params.get('next')),
    state: isHandoffState(state) ? state : null,
  }
}

/**
 * Whether a handoff may be applied without asking. Never when it would replace
 * a different signed-in user. Otherwise when it renews the session of the user
 * already signed in here (nothing changes hands), or when it carries the state
 * this tab minted before it left for the site's login.
 */
export function handoffIsTrusted(opts: {
  handoffState: string | null
  expectedState: string | null
  incomingUserId: string
  currentUserId: string | null
}): boolean {
  const { handoffState, expectedState, incomingUserId, currentUserId } = opts
  if (currentUserId !== null) return currentUserId === incomingUserId
  return Boolean(handoffState && expectedState && handoffState === expectedState)
}
