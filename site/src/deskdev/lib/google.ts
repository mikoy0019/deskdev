import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from './supabase'
import { siteBaseFor } from './siteLogin'

// Typed wrapper around the `google` edge function (supabase/functions/google)
// and the team calendar RPCs of migration 040.
//
// A connection has a purpose. `personal`: each person's OWN Google account,
// drive.file only, for exports. `workspace`: the company account that owns
// the shared team calendar, admins only. The server, never the browser, holds
// the grants and talks to Google.
//
//   { action: 'status' }                       → GoogleStatus
//   { action: 'connect', returnTo, purpose }   → { url }  (legacy start link, personal only)
//   form POST <site>/api/google/connect        → 303 to Google (the proxied path; required for `workspace`)
//   { action: 'finish', grant }                → { ok, email }  (stores the grant from ?google=pending&grant=…)
//   { action: 'disconnect', purpose }          → { ok }
//   { action: 'export', tabs }                 → ExportResult  (a new spreadsheet in Drive → "DeskDev Exports")
//   { action: 'revoke_user', userId }          → admins: drop someone's personal grant
//   { action: 'rotate_tokens' }                → admins: re-seal every stored token with the current key

export type GooglePurpose = 'personal' | 'workspace'

export type ExportTab = 'clients' | 'projects' | 'tasks' | 'time_entries' | 'leads' | 'eod_reports'

export const EXPORT_TABS: { id: ExportTab; label: string }[] = [
  { id: 'clients', label: 'Clients' },
  { id: 'projects', label: 'Projects' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'time_entries', label: 'Time entries' },
  { id: 'leads', label: 'Leads' },
  { id: 'eod_reports', label: 'EOD reports' },
]

/** The company account behind the team calendar. Filled for admins only. */
export interface GoogleWorkspaceLink {
  /** False for non-admins and on a function that predates the team calendar. */
  available: boolean
  connected: boolean
  /** 'active' | 'revoked' | 'disconnected' */
  status: string
  email: string | null
  connectedAt: string | null
  /** calendar.app.created: the Team Calendar can be written. */
  calendarGranted: boolean
  /**
   * calendar.freebusy (optional, 048): the booking page also sees the
   * account's own busy times. Unset from a function that predates booking.
   */
  freebusyGranted?: boolean
}

/** The workspace link under the name the booking screens first used. */
export type WorkspaceStatus = GoogleWorkspaceLink

export interface GoogleStatus {
  /** False until an admin has set the OAuth client + key secrets on the function. */
  configured: boolean
  connected: boolean
  email: string | null
  connectedAt: string | null
  driveGranted: boolean
  /** Which grant the top-level fields describe. */
  purpose: GooglePurpose
  isAdmin: boolean
  /** Exports are for admins; nobody else is shown the control. */
  exportAllowed: boolean
  /** True when Connect goes through the site's /api/google proxy (a form POST, not a start link). */
  proxied: boolean
  workspace: GoogleWorkspaceLink
}

const NO_WORKSPACE: GoogleWorkspaceLink = {
  available: false,
  connected: false,
  status: 'disconnected',
  email: null,
  connectedAt: null,
  calendarGranted: false,
}

/**
 * Fills what an older deployment of the function leaves out, on the closed
 * side: no export, no proxy, no workspace link.
 */
export function normalizeGoogleStatus(raw: Partial<GoogleStatus> | null | undefined): GoogleStatus {
  const r = raw ?? {}
  return {
    configured: Boolean(r.configured),
    connected: Boolean(r.connected),
    email: r.email ?? null,
    connectedAt: r.connectedAt ?? null,
    driveGranted: Boolean(r.driveGranted),
    purpose: r.purpose === 'workspace' ? 'workspace' : 'personal',
    isAdmin: Boolean(r.isAdmin),
    exportAllowed: Boolean(r.exportAllowed),
    proxied: Boolean(r.proxied),
    workspace: { ...NO_WORKSPACE, ...(r.workspace ?? {}) },
  }
}

export interface ExportResult {
  url: string
  title: string
  tabs: { tab: ExportTab; rows: number; truncated: boolean }[]
  skipped: { tab: ExportTab; reason: string }[]
}

export type GoogleResult<T> =
  | { ok: true; data: T }
  | {
      ok: false
      error: string
      /** The grant is gone; show Connect again. */
      reauth?: boolean
      /** The google function gave no answer at all: it is not deployed here yet, or the network is down. */
      unreachable?: boolean
    }

/** What the status check says when the google function cannot be reached. */
export const GOOGLE_NOT_CONNECTED = 'Google isn’t connected to this workspace yet.'
const UNREACHABLE = 'Google could not be reached. Check your connection and try again.'

/**
 * No answer from the function: the request failed in the browser (an
 * undeployed function answers without CORS headers, so it looks the same as
 * being offline) or at the relay in front of it. The library's own sentence
 * for this ("Failed to send a request to the Edge Function") is not for people.
 */
function isUnreachable(error: unknown): boolean {
  if (error instanceof TypeError) return true
  const name = (error as { name?: unknown } | null)?.name
  return name === 'FunctionsFetchError' || name === 'FunctionsRelayError'
}

async function invoke<T>(body: Record<string, unknown>): Promise<GoogleResult<T>> {
  if (!isSupabaseConfigured) return { ok: false, error: 'Google needs the Supabase backend' }
  try {
    const { data, error } = await supabase.functions.invoke<T & { error?: string }>('google', { body })
    if (error) {
      if (isUnreachable(error)) return { ok: false, error: UNREACHABLE, unreachable: true }
      let message = error.message || 'Request failed'
      let reauth = false
      // Non-2xx responses carry the function's { error, reauth? } body on the context.
      if (error instanceof FunctionsHttpError) {
        try {
          const payload = (await error.context.json()) as { error?: string; reauth?: boolean }
          if (payload?.error) message = payload.error
          reauth = Boolean(payload?.reauth)
        } catch {
          // keep the generic message
        }
      }
      return { ok: false, error: message, reauth }
    }
    if (!data) return { ok: false, error: 'Empty response' }
    return { ok: true, data }
  } catch (err) {
    if (isUnreachable(err)) return { ok: false, error: UNREACHABLE, unreachable: true }
    return { ok: false, error: err instanceof Error ? err.message : 'Request failed' }
  }
}

export async function getGoogleStatus(): Promise<GoogleResult<GoogleStatus>> {
  const res = await invoke<Partial<GoogleStatus>>({ action: 'status' })
  if (res.ok) return { ok: true, data: normalizeGoogleStatus(res.data) }
  // For the status check, "no answer" reads as the state it leaves the screen in.
  return res.unreachable ? { ...res, error: GOOGLE_NOT_CONNECTED } : res
}

export interface ConnectOptions {
  purpose?: GooglePurpose
  /** `status.proxied`: connect through the site's /api/google proxy. */
  proxied?: boolean
  /**
   * Open Google in a browser tab. An installed iOS app has no address bar and
   * Google's sign-in refuses embedded views, so the consent screen has to
   * leave the app there.
   */
  newTab?: boolean
}

/** The site's connect route, or null when this host cannot name the site (NEXT_PUBLIC_SITE_URL unset). */
export function googleConnectUrl(host: string): string | null {
  const base = siteBaseFor(host)
  return base === null ? null : `${base}/api/google/connect`
}

/**
 * Leaves the app for Google's consent screen. `returnTo` must be on one of
 * the function's APP_ORIGINS; Google's answer comes back as
 * ?google=pending&grant=… (or ?google=error&reason=…), which
 * `completeGoogleReturn` settles.
 *
 * Proxied: a top-level form POST to the site, which checks the session, sets
 * the flow cookie in that same response and answers 303 to Google. No link
 * exists that could be forwarded, and the `workspace` purpose only starts
 * this way. Otherwise: the legacy signed start link (personal only).
 */
export async function startGoogleConnect(
  returnTo: string,
  opts: ConnectOptions = {},
): Promise<GoogleResult<{ url: string }>> {
  const purpose = opts.purpose ?? 'personal'
  if (!isSupabaseConfigured) return { ok: false, error: 'Google needs the Supabase backend' }

  const action = opts.proxied ? googleConnectUrl(window.location.host) : null
  if (action) {
    let token: string | undefined
    try {
      token = (await supabase.auth.getSession()).data.session?.access_token
    } catch {
      token = undefined
    }
    if (!token) return { ok: false, error: connectErrorMessage('session') }
    const form = document.createElement('form')
    form.method = 'POST'
    form.action = action
    form.style.display = 'none'
    if (opts.newTab) form.target = '_blank'
    for (const [name, value] of Object.entries({ access_token: token, purpose, returnTo })) {
      const input = document.createElement('input')
      input.type = 'hidden'
      input.name = name
      input.value = value
      form.appendChild(input)
    }
    document.body.appendChild(form)
    form.submit()
    form.remove()
    return { ok: true, data: { url: action } }
  }

  // The function refuses a workspace connect that does not come through the proxy.
  if (purpose === 'workspace') {
    return { ok: false, error: 'The team calendar connects through the site, which is not set up for this address yet.' }
  }
  const res = await invoke<{ url: string }>({ action: 'connect', returnTo, purpose })
  if (res.ok) {
    if (opts.newTab) window.open(res.data.url, '_blank', 'noopener')
    else window.location.assign(res.data.url)
  }
  return res
}

/**
 * Stores the sealed grant the callback handed back. The function accepts it
 * only from the DeskDev user who pressed Connect, so a consent link opened by
 * someone else (a forwarded link) never lands on the wrong account.
 */
export function finishGoogleConnect(grant: string): Promise<GoogleResult<{ ok: true; email: string; purpose?: GooglePurpose }>> {
  return invoke<{ ok: true; email: string; purpose?: GooglePurpose }>({ action: 'finish', grant })
}

/** The query params the function's callback adds to returnTo. Remove them once handled. */
export const GOOGLE_RETURN_PARAMS = ['google', 'reason', 'grant'] as const

export type GoogleReturnOutcome = { ok: true; purpose?: GooglePurpose } | { ok: false; error: string }

/**
 * Settles ?google=… after Google sends the browser back: `pending` is stored
 * with `finish`, `error` becomes a sentence, and `connected` (sent by an older
 * deployment of the function) is taken as is. null when the URL carries none.
 * Read the params BEFORE removing them; the call itself does not touch the URL.
 */
export async function completeGoogleReturn(params: URLSearchParams): Promise<GoogleReturnOutcome | null> {
  const outcome = params.get('google')
  if (!outcome) return null
  if (outcome === 'connected') return { ok: true }
  if (outcome === 'pending') {
    const grant = params.get('grant')
    if (!grant) return { ok: false, error: connectErrorMessage(null) }
    const res = await finishGoogleConnect(grant)
    if (!res.ok) return { ok: false, error: res.error }
    return res.data.purpose ? { ok: true, purpose: res.data.purpose } : { ok: true }
  }
  return { ok: false, error: connectErrorMessage(params.get('reason')) }
}

/** Removes the grant, then revokes it at Google. `workspace` is admins only. */
export function disconnectGoogle(purpose: GooglePurpose = 'personal'): Promise<GoogleResult<{ ok: true }>> {
  return invoke<{ ok: true }>({ action: 'disconnect', purpose })
}

/**
 * Admins: connect the company Google account (purpose 'workspace') — the
 * Team Calendar every synced meeting goes to, and the free/busy the booking
 * page checks. A workspace connect only starts through the site's proxy, so
 * this is startGoogleConnect with both set; `finish` knows the purpose from
 * the signed state, so completeGoogleReturn settles it.
 */
export function startWorkspaceConnect(returnTo: string, opts: Pick<ConnectOptions, 'newTab'> = {}): Promise<GoogleResult<{ url: string }>> {
  return startGoogleConnect(returnTo, { ...opts, purpose: 'workspace', proxied: true })
}

export function disconnectWorkspace(): Promise<GoogleResult<{ ok: true }>> {
  return disconnectGoogle('workspace')
}

export function exportToGoogleSheets(tabs: ExportTab[]): Promise<GoogleResult<ExportResult>> {
  return invoke<ExportResult>({ action: 'export', tabs })
}

export interface RevokeUserResult {
  ok: true
  removed: boolean
  revokedAtGoogle: boolean
  skipped?: string
}

/** Admins: drop one person's personal Google grant (offboarding; audited as google.revoked). */
export function revokeGoogleUser(userId: string): Promise<GoogleResult<RevokeUserResult>> {
  return invoke<RevokeUserResult>({ action: 'revoke_user', userId })
}

export interface RotateTokensResult {
  ok: true
  key: string
  resealed: number
  current: number
  failed: number
}

/** Admins: re-seal every stored token with the current key (audited as google.keys_rotated). */
export function rotateGoogleTokens(): Promise<GoogleResult<RotateTokensResult>> {
  return invoke<RotateTokensResult>({ action: 'rotate_tokens' })
}

/** The sentence for ?google=error&reason=… when Google sends the browser back. */
export function connectErrorMessage(reason: string | null): string {
  switch (reason) {
    case 'denied':
      return 'Google sign-in was cancelled.'
    case 'scope':
      return 'Google Drive access was not granted. Connect again and leave the Drive box ticked.'
    case 'browser':
      return 'The sign-in finished in another browser, or this browser blocked its cookie. Start again here.'
    case 'expired':
      return 'The sign-in link expired after 10 minutes. Start again.'
    case 'config':
      return 'Google is not fully set up on the server yet. Ask an admin to finish the setup.'
    case 'session':
      return 'Your DeskDev session expired. Sign in again, then connect Google.'
    case 'forbidden':
      return 'Only an admin can connect the company Google account.'
    case 'no_refresh':
      return 'Google did not grant ongoing access. Remove DeskDev from your Google account’s connected apps, then connect again.'
    case 'email':
      return 'Google did not share the account’s email address. Connect again and allow it.'
    case 'exchange':
    case 'google':
      return 'Google did not complete the sign-in. Try again; if it keeps failing, check the google function logs.'
    default:
      return 'Google sign-in failed. Try again; if it keeps failing, check the google function logs.'
  }
}

// ─── Team calendar (040) ────────────────────────────────────────────────────

export type CalendarResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; /** 040 is not applied yet. */ missing?: boolean }

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<CalendarResult<T>> {
  if (!isSupabaseConfigured) return { ok: false, error: 'The team calendar needs the Supabase backend' }
  try {
    const { data, error } = await supabase.rpc(fn, args)
    if (error) {
      const missing =
        error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(error.message ?? '')
      return missing
        ? { ok: false, error: error.message || 'Request failed', missing }
        : { ok: false, error: error.message || 'Request failed' }
    }
    return { ok: true, data: data as T }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Request failed' }
  }
}

/** What google_workspace_status() answers: admins get every field, calendar viewers only `status`. */
export interface WorkspaceCalendarStatus {
  /** 'active' | 'revoked' | 'disconnected' */
  status: string
  googleEmail?: string | null
  calendarReady?: boolean
  calendarTimeZone?: string | null
  connectedAt?: string | null
  revokedAt?: string | null
  revokedReason?: string | null
  lastSyncAt?: string | null
  lastError?: string | null
  /** Changes waiting to be pushed. */
  pending?: number
  /** Pushes that gave up in the last 7 days. */
  failed?: number
}

/** null for someone with neither calendar nor meetings access. */
export function getWorkspaceCalendarStatus(): Promise<CalendarResult<WorkspaceCalendarStatus | null>> {
  return rpc<WorkspaceCalendarStatus | null>('google_workspace_status')
}

/** Admins: queue the failed pushes of the last 7 days again. Resolves with how many. */
export async function retryFailedCalendarSync(): Promise<CalendarResult<number>> {
  const res = await rpc<number>('google_calendar_retry_failed')
  return res.ok ? { ok: true, data: Number(res.data) || 0 } : res
}

export type CalendarFeedScope = 'mine' | 'all'

export interface CalendarFeedStatus {
  active: boolean
  scope?: CalendarFeedScope
  /** The last characters of the token, to tell one feed from the next. */
  hint?: string | null
  createdAt?: string | null
  lastUsedAt?: string | null
}

export async function getCalendarFeedStatus(): Promise<CalendarResult<CalendarFeedStatus>> {
  const res = await rpc<CalendarFeedStatus | null>('calendar_feed_status')
  return res.ok ? { ok: true, data: res.data ?? { active: false } } : res
}

/**
 * Makes a new secret feed address; the old one stops working. The token is
 * answered once and never stored readable. Resolves with the full .ics URL.
 */
export async function rotateCalendarFeed(scope: CalendarFeedScope): Promise<CalendarResult<{ url: string }>> {
  const res = await rpc<string>('calendar_feed_rotate', { p_scope: scope })
  if (!res.ok) return res
  if (typeof res.data !== 'string' || !res.data) return { ok: false, error: 'The server did not return a feed address.' }
  return { ok: true, data: { url: calendarFeedUrl(res.data) } }
}

export async function revokeCalendarFeed(): Promise<CalendarResult<true>> {
  const res = await rpc<null>('calendar_feed_revoke')
  return res.ok ? { ok: true, data: true } : res
}

/** https://<ref>.supabase.co/functions/v1/google-calendar/feed/<token>.ics */
export function calendarFeedUrl(token: string, base: string = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''): string {
  return `${base.replace(/\/+$/, '')}/functions/v1/google-calendar/feed/${encodeURIComponent(token)}.ics`
}

/** False in local mode, where every call in this file answers "needs the Supabase backend". */
export const isGoogleAvailable = isSupabaseConfigured
