import { describe, expect, it } from 'vitest'
import { aggregatePresence, groupPeople, PRESENCE_EXPIRES_MS } from './presence'
import type { User } from './types'

const person = (id: string, fullName: string, extra: Partial<User> = {}): User =>
  ({ id, fullName, email: `${id}@x.test`, role: 'member', permissions: {}, ...extra }) as User

describe('aggregatePresence', () => {
  it('expires a disconnected tab while keeping another tab for the same user', () => {
    const now = Date.now()
    const old = new Date(now - PRESENCE_EXPIRES_MS - 1).toISOString()
    const fresh = new Date(now).toISOString()
    expect(aggregatePresence({ a: [{ status: 'active', at: old }], b: [{ status: 'active', at: old }, { status: 'away', at: fresh }], c: [{ status: 'active', at: 'invalid' }] }, now)).toEqual({ b: 'away' })
  })
  it('a person is active when any of their tabs is', () => {
    expect(aggregatePresence({
      a: [{ status: 'away' }, { status: 'active' }],
      b: [{ status: 'away' }],
      c: [],
      d: [{ status: 'bogus' }],
    })).toEqual({ a: 'active', b: 'away', d: 'away' })
  })
})

describe('groupPeople', () => {
  it('sorts active accounts into active, away and offline, you first', () => {
    const users = [person('z', 'Zed'), person('me', 'Me'), person('b', 'Bea'), person('gone', 'Gone', { deactivatedAt: '2026-01-01T00:00:00Z' }), person('o', 'Olly')]
    const g = groupPeople(users, { z: 'active', me: 'active', b: 'away', gone: 'active' }, 'me')
    expect(g.active.map((u) => u.id)).toEqual(['me', 'z'])
    expect(g.away.map((u) => u.id)).toEqual(['b'])
    expect(g.offline.map((u) => u.id)).toEqual(['o'])
  })
})
