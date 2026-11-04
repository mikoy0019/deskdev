import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthRetryableFetchError } from '@supabase/supabase-js'

// What db.gate() makes of getSession(), and what fetchAllWithStatus() makes
// of a table that won't load.
const h = vi.hoisted(() => ({
  session: null as unknown,
  sessionError: null as unknown,
  failTables: new Set<string>(),
}))

vi.mock('./supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: { getSession: async () => ({ data: { session: h.session }, error: h.sessionError }) },
    from: (table: string) => {
      const result = () =>
        Promise.resolve(
          h.failTables.has(table)
            ? { data: null, error: { message: `${table} failed` } }
            : { data: [], error: null },
        )
      const query = {
        select: () => query,
        order: () => query,
        range: result,
        // The workspace_settings singleton is read with .limit(1).maybeSingle().
        limit: () => ({
          maybeSingle: () =>
            Promise.resolve(
              h.failTables.has(table)
                ? { data: null, error: { message: `${table} failed` } }
                : { data: null, error: null },
            ),
        }),
        insert: result,
        update: () => ({ eq: () => ({ select: () => Promise.resolve({ data: [{ id: 'x' }], error: null }) }) }),
      }
      return query
    },
  },
}))

import * as db from './db'

const errors: { table: string; op: string; message: string }[] = []

beforeEach(() => {
  h.session = { user: { id: 'u1' } }
  h.sessionError = null
  h.failTables.clear()
  errors.length = 0
  db.setWriteErrorHandler((info) => errors.push(info))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  db.setWriteErrorHandler(null)
  vi.restoreAllMocks()
})

describe('writes without a usable session', () => {
  it('a token that could not refresh for want of a network says offline, not signed out', async () => {
    h.session = null
    h.sessionError = new AuthRetryableFetchError('Failed to fetch', 0)
    await db.insert('clients', { id: 'c1', name: 'Acme' })
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toMatch(/offline/i)
    expect(errors[0].message).not.toMatch(/session has ended/i)
  })

  it('a real sign-out still says the session ended', async () => {
    h.session = null
    await db.insert('clients', { id: 'c1', name: 'Acme' })
    expect(errors[0].message).toMatch(/session has ended/i)
  })
})

describe('writes after another account signed in on this browser', () => {
  afterEach(() => db.setCurrentUserGetter(null))

  it('are stopped with a reload message instead of reaching RLS as the old user', async () => {
    // The app still thinks u1 is here; another tab signed u2 in.
    db.setCurrentUserGetter(() => 'u1')
    h.session = { user: { id: 'u2' } }
    await db.insert('channelReads', { id: 'r1', channelId: 'ch', userId: 'u1', lastReadAt: '2026-10-06T13:10:00Z' })
    expect(errors).toEqual([
      { table: 'channel_reads', op: 'insert', message: expect.stringMatching(/different account.*Reload/) },
    ])
    expect(await db.remoteGate()).toBe('account-changed')
  })

  it('go ahead when the app and the session agree, or before anyone is adopted', async () => {
    db.setCurrentUserGetter(() => 'u1')
    expect(await db.remoteGate()).toBe('ok')
    // Between a handoff's setSession and adoptSession the app has nobody yet.
    db.setCurrentUserGetter(() => null)
    h.session = { user: { id: 'u2' } }
    expect(await db.remoteGate()).toBe('ok')
    await db.insert('clients', { id: 'c1', name: 'Acme' })
    expect(errors).toEqual([])
  })
})

describe('fetchAllWithStatus', () => {
  it('keeps the tables that loaded and names the ones that failed', async () => {
    h.failTables.add('messages')
    h.failTables.add('clients')
    const result = await db.fetchAllWithStatus()
    expect(result).not.toBeNull()
    expect(result!.failed).toEqual(['clients', 'messages'])
    expect(result!.data.clients).toBeUndefined()
    expect(result!.data.projects).toEqual([])
    // fetchAll() is the same pull without the list.
    expect(await db.fetchAll()).toEqual(result!.data)
  })

  it('names the settings singleton when it fails, and leaves its slice alone', async () => {
    h.failTables.add('workspace_settings')
    const result = await db.fetchAllWithStatus()
    expect(result!.failed).toEqual(['workspaceSettings'])
    expect(result!.data.workspaceSettings).toBeUndefined()
    expect(result!.data.leads).toEqual([])
  })

  it('is null offline, so hydrate() keeps what it has', async () => {
    h.session = null
    h.sessionError = new AuthRetryableFetchError('Failed to fetch', 0)
    expect(await db.fetchAllWithStatus()).toBeNull()
  })
})
