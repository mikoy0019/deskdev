import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HANDOFF_STATE_KEY, beginHandoff, clearHandoffState, handoffIsTrusted, pendingHandoffState, readHandoff, safeNext,
  siteLoginUrl,
} from './siteLogin'

const STATE = '3f2b8c1e-9a4d-4c6b-8e2f-1a2b3c4d5e6f'

describe('safeNext', () => {
  it('keeps same-app relative paths', () => {
    expect(safeNext('/projects/abc?tab=tasks')).toBe('/projects/abc?tab=tasks')
  })

  it.each([
    null, undefined, '', 'projects', 'https://evil.com', '//evil.com', '/\\evil.com',
    // The URL parser drops tab/CR/LF, so these would resolve as //evil.com.
    '/\t/evil.com', '/\n/evil.com', '/\r/evil.com', '/a\\b', '/x\u0000y', '/x\u007Fy',
  ])(
    'falls back to / for %j',
    (value) => {
      expect(safeNext(value)).toBe('/')
    },
  )

  it('returns the original string, never a normalised one', () => {
    // Normalising '/.//evil.com' would give '//evil.com'.
    expect(safeNext('/.//evil.com')).toBe('/.//evil.com')
  })
})

describe('readHandoff', () => {
  it('reads both tokens and a safe next path', () => {
    expect(readHandoff('#dd_at=AT&dd_rt=RT&next=%2Ftasks')).toEqual({
      accessToken: 'AT',
      refreshToken: 'RT',
      next: '/tasks',
      state: null,
    })
  })

  it('reads the echoed state, and ignores one in the wrong shape', () => {
    expect(readHandoff(`#dd_at=AT&dd_rt=RT&dd_state=${STATE}`)?.state).toBe(STATE)
    expect(readHandoff('#dd_at=AT&dd_rt=RT&dd_state=short')?.state).toBeNull()
    expect(readHandoff('#dd_at=AT&dd_rt=RT&dd_state=%3Cscript%3Exxxxxxxxxxxxxxxx')?.state).toBeNull()
  })

  it('defaults next to / and rejects off-site targets', () => {
    expect(readHandoff('#dd_at=AT&dd_rt=RT')?.next).toBe('/')
    expect(readHandoff('#dd_at=AT&dd_rt=RT&next=%2F%2Fevil.com')?.next).toBe('/')
    expect(readHandoff('#dd_at=AT&dd_rt=RT&next=%2F%09%2Fevil.com')?.next).toBe('/')
  })

  it('returns null when either token is missing', () => {
    expect(readHandoff('')).toBeNull()
    expect(readHandoff('#dd_at=AT')).toBeNull()
    expect(readHandoff('#dd_rt=RT')).toBeNull()
    // Supabase's own fragment format is not a handoff.
    expect(readHandoff('#access_token=AT&refresh_token=RT')).toBeNull()
  })
})

describe('siteLoginUrl', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('points at the same-origin site login, carrying next and error', () => {
    expect(siteLoginUrl({ state: null })).toBe('/login')
    expect(siteLoginUrl({ next: '/tasks', state: null })).toBe('/login?next=%2Ftasks')
    expect(siteLoginUrl({ next: '/vault', error: 'session', state: null })).toBe(
      '/login?next=%2Fvault&error=session',
    )
    expect(siteLoginUrl({ next: '//evil.com', state: null })).toBe('/login')
  })

  it('points at the site origin from the workspace subdomain', () => {
    expect(siteLoginUrl({ next: '/tasks', state: null }, 'https://example.com')).toBe(
      'https://example.com/login?next=%2Ftasks',
    )
  })

  it('mints a one-time state into this tab and sends it along', () => {
    const url = new URL(siteLoginUrl({ next: '/tasks' }), 'https://x.test')
    const state = url.searchParams.get('state')
    expect(state).toMatch(/^[0-9a-f-]{36}$/)
    expect(url.searchParams.get('next')).toBe('/tasks')
    expect(window.sessionStorage.getItem(HANDOFF_STATE_KEY)).toBe(state)
    // A second redirect (StrictMode) reuses it instead of orphaning the first URL.
    expect(new URL(siteLoginUrl(), 'https://x.test').searchParams.get('state')).toBe(state)
  })
})

describe('handoff state', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('round-trips: minted, read without consuming, then cleared', () => {
    const state = beginHandoff()
    expect(state).toBeTruthy()
    expect(pendingHandoffState()).toBe(state)
    expect(pendingHandoffState()).toBe(state)
    clearHandoffState()
    expect(pendingHandoffState()).toBeNull()
  })

  it('ignores a stored value in the wrong shape', () => {
    window.sessionStorage.setItem(HANDOFF_STATE_KEY, 'x')
    expect(pendingHandoffState()).toBeNull()
  })

  it('survives blocked storage (no state; the callback then asks)', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    try {
      expect(beginHandoff()).toBeNull()
      expect(siteLoginUrl({ next: '/tasks' })).toBe('/login?next=%2Ftasks')
    } finally {
      spy.mockRestore()
    }
  })
})

describe('handoffIsTrusted', () => {
  const base = { handoffState: STATE, expectedState: STATE, incomingUserId: 'u1', currentUserId: null }

  it('applies a handoff this tab asked for', () => {
    expect(handoffIsTrusted(base)).toBe(true)
  })

  it('asks first when the state is missing or does not match (login CSRF)', () => {
    expect(handoffIsTrusted({ ...base, handoffState: null })).toBe(false)
    expect(handoffIsTrusted({ ...base, expectedState: null })).toBe(false)
    expect(handoffIsTrusted({ ...base, handoffState: null, expectedState: null })).toBe(false)
    expect(handoffIsTrusted({ ...base, handoffState: '00000000-0000-4000-8000-000000000000' })).toBe(false)
  })

  it('never silently replaces a different signed-in user, even with a matching state', () => {
    expect(handoffIsTrusted({ ...base, currentUserId: 'someone-else' })).toBe(false)
  })

  it('renews the same user without asking', () => {
    expect(handoffIsTrusted({ ...base, currentUserId: 'u1' })).toBe(true)
    expect(handoffIsTrusted({ ...base, handoffState: null, expectedState: null, currentUserId: 'u1' })).toBe(true)
  })
})

describe('siteBaseFor', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  // hosts.ts reads the env once at import, so each case re-imports.
  async function load(env: Record<string, string>) {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
    vi.resetModules()
    return (await import('./siteLogin')).siteBaseFor
  }

  it('is this origin when DeskDev is a route of the site', async () => {
    const siteBaseFor = await load({ NEXT_PUBLIC_SITE_URL: '', NEXT_PUBLIC_APP_URL: '' })
    expect(siteBaseFor('localhost:6969')).toBe('')
  })

  it('is the site URL on the workspace subdomain', async () => {
    const siteBaseFor = await load({
      NEXT_PUBLIC_SITE_URL: 'https://example.com/',
      NEXT_PUBLIC_APP_URL: 'https://workspace.example.com',
    })
    expect(siteBaseFor('workspace.example.com')).toBe('https://example.com')
    expect(siteBaseFor('example.com')).toBe('')
  })

  it('is unknown on the subdomain when the site URL is unset — never a looping /login', async () => {
    const siteBaseFor = await load({ NEXT_PUBLIC_SITE_URL: '', NEXT_PUBLIC_APP_URL: 'https://workspace.example.com' })
    expect(siteBaseFor('workspace.example.com')).toBeNull()
  })
})
