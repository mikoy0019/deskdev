import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'

const invoke = vi.fn()
const rpc = vi.fn()
const getSession = vi.fn()
vi.mock('./supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { functions: { invoke }, rpc, auth: { getSession } },
}))

const {
  GOOGLE_NOT_CONNECTED, GOOGLE_RETURN_PARAMS, calendarFeedUrl, completeGoogleReturn, connectErrorMessage, disconnectGoogle,
  exportToGoogleSheets, finishGoogleConnect, getCalendarFeedStatus, getGoogleStatus, getWorkspaceCalendarStatus,
  googleConnectUrl, normalizeGoogleStatus, retryFailedCalendarSync, rotateCalendarFeed, startGoogleConnect,
} = await import('./google')

describe('connectErrorMessage', () => {
  it('explains each reason the function sends back', () => {
    expect(connectErrorMessage('denied')).toMatch(/cancelled/)
    expect(connectErrorMessage('scope')).toMatch(/Drive/)
    expect(connectErrorMessage('browser')).toMatch(/another browser/)
    expect(connectErrorMessage('expired')).toMatch(/expired/)
  })

  it('falls back to a generic sentence', () => {
    expect(connectErrorMessage(null)).toMatch(/failed/)
    expect(connectErrorMessage('something_new')).toMatch(/failed/)
  })

  it('has its own sentence for the proxy and server reasons', () => {
    expect(connectErrorMessage('session')).toMatch(/Sign in again/)
    expect(connectErrorMessage('forbidden')).toMatch(/admin/)
    expect(connectErrorMessage('no_refresh')).toMatch(/ongoing access/)
    expect(connectErrorMessage('email')).toMatch(/email address/)
    expect(connectErrorMessage('exchange')).toMatch(/did not complete/)
    expect(connectErrorMessage('google')).toMatch(/did not complete/)
  })
})

describe('invoke wrapper', () => {
  beforeEach(() => {
    invoke.mockReset()
  })

  it('returns the data on success', async () => {
    const status = { configured: true, connected: false, email: null, connectedAt: null, driveGranted: false }
    invoke.mockResolvedValue({ data: status, error: null })
    expect(await getGoogleStatus()).toEqual({ ok: true, data: normalizeGoogleStatus(status) })
    expect(invoke).toHaveBeenCalledWith('google', { body: { action: 'status' } })
  })

  it('reads an older status on the closed side: no export, no proxy, no workspace link', () => {
    const s = normalizeGoogleStatus({ configured: true, connected: true, email: 'me@gmail.com', driveGranted: true })
    expect(s.exportAllowed).toBe(false)
    expect(s.proxied).toBe(false)
    expect(s.purpose).toBe('personal')
    expect(s.workspace).toEqual({
      available: false, connected: false, status: 'disconnected', email: null, connectedAt: null, calendarGranted: false,
    })
  })

  it('keeps the admin fields the current function sends', () => {
    const s = normalizeGoogleStatus({
      configured: true, isAdmin: true, exportAllowed: true, proxied: true,
      workspace: { available: true, connected: true, status: 'active', email: 'team@x.co', connectedAt: '2026-10-01T00:00:00Z', calendarGranted: true },
    })
    expect(s.exportAllowed).toBe(true)
    expect(s.proxied).toBe(true)
    expect(s.workspace.email).toBe('team@x.co')
  })

  it('disconnect names the purpose', async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null })
    await disconnectGoogle()
    expect(invoke).toHaveBeenLastCalledWith('google', { body: { action: 'disconnect', purpose: 'personal' } })
    await disconnectGoogle('workspace')
    expect(invoke).toHaveBeenLastCalledWith('google', { body: { action: 'disconnect', purpose: 'workspace' } })
  })

  it("surfaces the function's error and the reauth flag from a non-2xx body", async () => {
    const response = new Response(JSON.stringify({ error: 'Google access was revoked', reauth: true }), { status: 409 })
    invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(response) })
    expect(await exportToGoogleSheets(['tasks'])).toEqual({ ok: false, error: 'Google access was revoked', reauth: true })
  })

  it('turns a thrown error into a result', async () => {
    invoke.mockRejectedValue(new Error('Something else broke'))
    expect(await getGoogleStatus()).toEqual({ ok: false, error: 'Something else broke' })
  })

  it('reads a function that cannot be reached as "not connected yet", never the library sentence', async () => {
    invoke.mockResolvedValue({ data: null, error: new FunctionsFetchError(new TypeError('Failed to fetch')) })
    expect(await getGoogleStatus()).toEqual({ ok: false, error: GOOGLE_NOT_CONNECTED, unreachable: true })

    invoke.mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await getGoogleStatus()).toEqual({ ok: false, error: GOOGLE_NOT_CONNECTED, unreachable: true })
  })

  it('says an action could not reach Google when the request never got an answer', async () => {
    invoke.mockResolvedValue({ data: null, error: new FunctionsFetchError(new TypeError('Failed to fetch')) })
    const res = await exportToGoogleSheets(['tasks'])
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/could not be reached/), unreachable: true })
    expect(JSON.stringify(res)).not.toMatch(/Edge Function/)
  })
})

describe('completeGoogleReturn', () => {
  beforeEach(() => {
    invoke.mockReset()
  })

  it('is null when the URL carries no ?google=', async () => {
    expect(await completeGoogleReturn(new URLSearchParams('section=integrations'))).toBeNull()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('stores a pending grant through finish, with the caller session', async () => {
    invoke.mockResolvedValue({ data: { ok: true, email: 'me@gmail.com' }, error: null })
    const params = new URLSearchParams('section=integrations&google=pending&grant=g1.iv.ct')
    expect(await completeGoogleReturn(params)).toEqual({ ok: true })
    expect(invoke).toHaveBeenCalledWith('google', { body: { action: 'finish', grant: 'g1.iv.ct' } })
  })

  it("surfaces finish's refusal (a consent link started by another DeskDev account)", async () => {
    const response = new Response(JSON.stringify({ error: 'started from a different DeskDev account' }), { status: 403 })
    invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(response) })
    expect(await completeGoogleReturn(new URLSearchParams('google=pending&grant=g1.x.y'))).toEqual({
      ok: false,
      error: 'started from a different DeskDev account',
    })
  })

  it('maps error reasons without calling the function', async () => {
    expect(await completeGoogleReturn(new URLSearchParams('google=error&reason=denied'))).toEqual({
      ok: false,
      error: connectErrorMessage('denied'),
    })
    expect(await completeGoogleReturn(new URLSearchParams('google=pending'))).toEqual({
      ok: false,
      error: connectErrorMessage(null),
    })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('accepts ?google=connected from an older deployment of the function', async () => {
    expect(await completeGoogleReturn(new URLSearchParams('google=connected'))).toEqual({ ok: true })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('lists every param the callback adds, so the page can strip them', () => {
    expect([...GOOGLE_RETURN_PARAMS]).toEqual(['google', 'reason', 'grant'])
  })

  it('finishGoogleConnect posts the grant as is', async () => {
    invoke.mockResolvedValue({ data: { ok: true, email: 'me@gmail.com' }, error: null })
    expect(await finishGoogleConnect('g1.a.b')).toEqual({ ok: true, data: { ok: true, email: 'me@gmail.com' } })
  })
})

describe('startGoogleConnect', () => {
  const submit = vi.fn()
  let posted: { action: string; method: string; target: string; fields: Record<string, string> } | null = null

  beforeEach(() => {
    invoke.mockReset()
    getSession.mockReset()
    submit.mockReset()
    posted = null
    submit.mockImplementation(function (this: HTMLFormElement) {
      const fields: Record<string, string> = {}
      this.querySelectorAll('input').forEach((i) => {
        fields[i.name] = i.value
      })
      posted = { action: this.action, method: this.method, target: this.target, fields }
    })
    HTMLFormElement.prototype.submit = submit
  })

  it('proxied: posts the session token, purpose and returnTo to the site route as a form', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'jwt-1' } } })
    const res = await startGoogleConnect('https://app.test/settings?section=integrations', { purpose: 'workspace', proxied: true })
    expect(res.ok).toBe(true)
    expect(invoke).not.toHaveBeenCalled()
    expect(posted).not.toBeNull()
    expect(posted!.method).toBe('post')
    expect(new URL(posted!.action).pathname).toBe('/api/google/connect')
    expect(posted!.target).toBe('')
    expect(posted!.fields).toEqual({
      access_token: 'jwt-1', purpose: 'workspace', returnTo: 'https://app.test/settings?section=integrations',
    })
    // The token does not stay in the page.
    expect(document.querySelector('form')).toBeNull()
  })

  it('proxied without a session: refuses with the session sentence, posts nothing', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    const res = await startGoogleConnect('https://app.test/settings', { proxied: true })
    expect(res).toEqual({ ok: false, error: connectErrorMessage('session') })
    expect(submit).not.toHaveBeenCalled()
  })

  it('opens a browser tab when asked (installed iOS app)', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'jwt-1' } } })
    await startGoogleConnect('https://app.test/settings', { proxied: true, newTab: true })
    expect(posted!.target).toBe('_blank')
  })

  it('never starts a workspace connect through the legacy link', async () => {
    const res = await startGoogleConnect('https://app.test/settings', { purpose: 'workspace' })
    expect(res.ok).toBe(false)
    expect(invoke).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
  })

  it('the site route is same-origin when DeskDev is a route of the site', () => {
    expect(googleConnectUrl('localhost:6969')).toBe('/api/google/connect')
  })
})

describe('team calendar RPCs', () => {
  beforeEach(() => {
    rpc.mockReset()
  })

  it('returns the workspace status as sent (null for someone without calendar access)', async () => {
    rpc.mockResolvedValue({ data: { status: 'active', pending: 2, failed: 0 }, error: null })
    expect(await getWorkspaceCalendarStatus()).toEqual({ ok: true, data: { status: 'active', pending: 2, failed: 0 } })
    expect(rpc).toHaveBeenCalledWith('google_workspace_status', undefined)
    rpc.mockResolvedValue({ data: null, error: null })
    expect(await getWorkspaceCalendarStatus()).toEqual({ ok: true, data: null })
  })

  it('flags a missing function (040 not applied) instead of failing loudly', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.google_workspace_status' } })
    const res = await getWorkspaceCalendarStatus()
    expect(res.ok).toBe(false)
    expect(!res.ok && res.missing).toBe(true)
  })

  it('retry answers how many pushes were queued again', async () => {
    rpc.mockResolvedValue({ data: 3, error: null })
    expect(await retryFailedCalendarSync()).toEqual({ ok: true, data: 3 })
    expect(rpc).toHaveBeenCalledWith('google_calendar_retry_failed', undefined)
  })

  it('an unset feed reads as inactive', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    expect(await getCalendarFeedStatus()).toEqual({ ok: true, data: { active: false } })
  })

  it('rotate turns the one-time token into the .ics address', async () => {
    rpc.mockResolvedValue({ data: 'tok_abc', error: null })
    const res = await rotateCalendarFeed('all')
    expect(rpc).toHaveBeenCalledWith('calendar_feed_rotate', { p_scope: 'all' })
    expect(res.ok && res.data.url.endsWith('/functions/v1/google-calendar/feed/tok_abc.ics')).toBe(true)
  })

  it('builds the feed address from the project URL', () => {
    expect(calendarFeedUrl('t/1', 'https://ref.supabase.co/')).toBe(
      'https://ref.supabase.co/functions/v1/google-calendar/feed/t%2F1.ics',
    )
  })
})
