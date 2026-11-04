import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Remote mode, with the network faked: db.fetchAllWithStatus is a deferred
// the test resolves, and sign-out / push removal record their order.
const h = vi.hoisted(() => ({
  order: [] as string[],
  fetches: 0,
  resolveFetch: null as ((value: unknown) => void) | null,
  signOut: vi.fn(),
  disablePush: vi.fn(),
  clearAppBadge: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      signOut: (...args: unknown[]) => h.signOut(...args),
      getSession: async () => ({ data: { session: null }, error: null }),
    },
    // adoptSession's profile read.
    from: () => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          single: async () => ({ data: { id, full_name: `User ${id}`, role: 'admin' }, error: null }),
        }),
      }),
    }),
  },
}))
vi.mock('../lib/db', () => ({
  flush: () => Promise.resolve(),
  fetchAllWithStatus: () => {
    h.fetches++
    return new Promise((resolve) => {
      h.resolveFetch = resolve
    })
  },
  insert: () => Promise.resolve(),
  update: () => Promise.resolve(),
  remove: () => Promise.resolve(),
  setWriteErrorHandler: () => {},
  setCurrentUserGetter: () => {},
  // Every table "exists", so the pull adopts workspace_settings from the data.
  isTableMissing: () => false,
}))
vi.mock('../pwa/push', () => ({ disablePush: (...args: unknown[]) => h.disablePush(...args) }))
vi.mock('../pwa/useAppBadge', () => ({ clearAppBadge: () => h.clearAppBadge() }))

import { useStore } from './useStore'

const s = () => useStore.getState()
const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  h.order.length = 0
  h.fetches = 0
  h.resolveFetch = null
  h.signOut.mockReset().mockImplementation(async () => {
    h.order.push('signOut')
    return { error: null }
  })
  h.disablePush.mockReset().mockImplementation(async () => {
    h.order.push('disablePush')
  })
  h.clearAppBadge.mockReset().mockImplementation(() => {
    h.order.push('clearAppBadge')
  })
  useStore.setState({ currentUserId: 'u1', hydrated: false, synced: false, loadError: null, clients: [] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('hydrate()', () => {
  it('is single-flight: calls during a pull join it', async () => {
    const a = s().hydrate()
    const b = s().hydrate()
    expect(b).toBe(a)
    await flushMicrotasks()
    expect(h.fetches).toBe(1)
    h.resolveFetch!({ data: { clients: [] }, failed: [] })
    await a
    // The next call is a new pull.
    void s().hydrate()
    await flushMicrotasks()
    expect(h.fetches).toBe(2)
    h.resolveFetch!({ data: {}, failed: [] })
  })

  it('stays unsynced through an offline start, but still renders', async () => {
    const run = s().hydrate()
    await flushMicrotasks()
    h.resolveFetch!(null)
    await run
    expect(s().hydrated).toBe(true)
    expect(s().synced).toBe(false)
  })

  it('marks synced once data arrives, and names the tables that failed', async () => {
    const run = s().hydrate()
    await flushMicrotasks()
    h.resolveFetch!({ data: { clients: [{ id: 'c1', name: 'Acme' }] }, failed: ['messages', 'notifications'] })
    await run
    expect(s().synced).toBe(true)
    expect(s().loadError).toEqual(['messages', 'notifications'])
    expect(s().clients.map((c) => c.id)).toEqual(['c1'])

    const again = s().hydrate()
    await flushMicrotasks()
    h.resolveFetch!({ data: { clients: [] }, failed: [] })
    await again
    expect(s().loadError).toBeNull()
  })

  it('a pull where every table failed is not a sync', async () => {
    const run = s().hydrate()
    await flushMicrotasks()
    h.resolveFetch!({ data: {}, failed: ['clients'] })
    await run
    expect(s().synced).toBe(false)
    expect(s().loadError).toEqual(['clients'])
  })

  it('drops a pull that finished after sign-out', async () => {
    const run = s().hydrate()
    await flushMicrotasks()
    useStore.setState({ currentUserId: null })
    h.resolveFetch!({ data: { clients: [{ id: 'c1', name: 'Leaked' }] }, failed: [] })
    await run
    expect(s().clients).toEqual([])
  })

  it('pulls again for the new user after an account switch mid-pull', async () => {
    const run = s().hydrate()
    await flushMicrotasks()
    expect(h.fetches).toBe(1)
    // SIGNED_IN started the pull under the old persisted id; adoptSession then
    // switched to the new user before the rows came back.
    useStore.setState({ currentUserId: 'u2' })
    h.resolveFetch!({ data: { clients: [{ id: 'old', name: 'Old user row' }] }, failed: [] })
    await flushMicrotasks()
    expect(h.fetches).toBe(2)
    expect(s().hydrated).toBe(false)
    // Joiners get the re-pull, not a settled empty store.
    expect(s().hydrate()).toBe(run)
    h.resolveFetch!({ data: { clients: [{ id: 'new', name: 'New user row' }] }, failed: [] })
    await run
    expect(s().clients.map((c) => c.id)).toEqual(['new'])
    expect(s().synced).toBe(true)
    expect(s().hydrated).toBe(true)
  })
})

describe('syncSessionUser()', () => {
  it('switches to the session user and drops the previous account’s workspace', async () => {
    useStore.setState({ currentUserId: 'u1', clients: [{ id: 'c1', name: 'U1 client' }] as never, hydrated: true, synced: true })
    expect(await s().syncSessionUser('u2')).toBe(true)
    expect(s().currentUserId).toBe('u2')
    expect(s().clients).toEqual([])
    expect(s().users.map((u) => u.id)).toEqual(['u2'])
    // The caller pulls again for u2.
    expect(s().hydrated).toBe(false)
    expect(s().synced).toBe(false)
  })

  it('leaves things alone when it is the same user, or nobody is signed in here', async () => {
    useStore.setState({ currentUserId: 'u1', clients: [{ id: 'c1', name: 'Mine' }] as never })
    expect(await s().syncSessionUser('u1')).toBe(false)
    expect(s().clients.map((c) => c.id)).toEqual(['c1'])
    useStore.setState({ currentUserId: null })
    // A session with nobody adopted is the login's (or the handoff's) to apply.
    expect(await s().syncSessionUser('u2')).toBe(false)
    expect(s().currentUserId).toBeNull()
  })
})

describe('logout()', () => {
  it('removes the push row first, then clears the badge, then signs out this device only', async () => {
    await s().logout()
    expect(h.order).toEqual(['disablePush', 'clearAppBadge', 'signOut'])
    expect(h.disablePush).toHaveBeenCalledWith({ unsubscribe: false })
    expect(h.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(s().currentUserId).toBeNull()
    expect(s().synced).toBe(false)
  })

  it('joins a sign-out already in progress (SIGNED_OUT calls logout again)', async () => {
    const a = s().logout()
    const b = s().logout()
    expect(b).toBe(a)
    await a
    expect(h.signOut).toHaveBeenCalledTimes(1)
  })

  it('never waits more than a few seconds on a hung push removal', async () => {
    vi.useFakeTimers()
    h.disablePush.mockImplementation(() => new Promise(() => {}))
    const done = s().logout()
    await vi.advanceTimersByTimeAsync(3000)
    await done
    expect(h.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(s().currentUserId).toBeNull()
  })
})
