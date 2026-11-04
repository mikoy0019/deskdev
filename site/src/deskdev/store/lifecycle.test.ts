import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'
import { activeUsers, can, isAdmin } from '../lib/permissions'

// Offboarding (032) in local mode: deactivate keeps the person's history but
// takes away sign-in and every permission, reactivate lets them back in as a
// member with nothing granted, and both leave an audit row an admin can read.

const s = () => useStore.getState()
const user = (id: string) => s().users.find((u) => u.id === id)!

beforeEach(() => {
  s().resetSeed()
  useStore.setState({ currentUserId: 'u-admin' })
})

describe('adminDeactivateUser / adminReactivateUser', () => {
  it('strips role and permissions, stamps who and when, and audits it', async () => {
    const res = await s().adminDeactivateUser('u-member')
    expect(res).toEqual({ ok: true, id: 'u-member' })
    expect(user('u-member')).toMatchObject({ role: 'member', permissions: {}, deactivatedBy: 'u-admin' })
    expect(user('u-member').deactivatedAt).toBeDefined()
    expect(s().auditLog[0]).toMatchObject({ action: 'profile.deactivated', entity: 'profile', entityId: 'u-member', actorId: 'u-admin' })
  })

  it('blocks their sign-in and hides them from pickers', async () => {
    await s().adminDeactivateUser('u-member')
    useStore.setState({ currentUserId: null })
    expect(await s().login('member@deskdev.local', 'member')).toEqual({ ok: false, error: 'This account has been deactivated' })
    expect(activeUsers(s().users).map((u) => u.id)).not.toContain('u-member')
  })

  it('a deactivated account can do nothing, even with a stale admin role', () => {
    const stale = { ...user('u-admin'), deactivatedAt: '2026-10-01T00:00:00Z' }
    expect(can(stale, 'projects', 'view')).toBe(false)
    expect(isAdmin(stale)).toBe(false)
  })

  it('reactivates as a member with no permissions', async () => {
    await s().adminDeactivateUser('u-member')
    expect(await s().adminReactivateUser('u-member')).toEqual({ ok: true, id: 'u-member' })
    expect(user('u-member')).toMatchObject({ role: 'member', permissions: {} })
    expect(user('u-member').deactivatedAt).toBeUndefined()
    expect(s().auditLog[0].action).toBe('profile.reactivated')
    useStore.setState({ currentUserId: null })
    expect((await s().login('member@deskdev.local', 'member')).ok).toBe(true)
  })

  it('refuses self-deactivation, the last admin, and non-admins', async () => {
    expect((await s().adminDeactivateUser('u-admin')).ok).toBe(false)
    useStore.setState((st) => ({ users: st.users.map((u) => (u.id === 'u-member' ? { ...u, role: 'admin' as const } : u)) }))
    useStore.setState({ currentUserId: 'u-member' })
    // u-member (admin) may deactivate u-admin while another admin remains…
    expect((await s().adminDeactivateUser('u-admin')).ok).toBe(true)
    useStore.setState({ currentUserId: 'u-admin' })
    // …and the now-deactivated u-admin can do nothing.
    expect((await s().adminReactivateUser('u-admin')).ok).toBe(false)
    expect((await s().adminDeactivateUser('u-member')).ok).toBe(false)
  })

  it('a deactivated admin no longer receives admin notifications', async () => {
    useStore.setState((st) => ({
      users: [...st.users, { ...st.users[0], id: 'u-admin-2', email: 'two@deskdev.local' }],
    }))
    await s().adminDeactivateUser('u-admin-2')
    // Creating a client needs clients:edit, as it does in the database.
    useStore.setState((st) => ({
      currentUserId: 'u-member',
      users: st.users.map((u) => (u.id === 'u-member' ? { ...u, permissions: { clients: 'edit' as const } } : u)),
    }))
    s().addClient({ name: 'New Co' })
    expect(s().notifications.filter((n) => n.title.includes('New Co')).map((n) => n.userId)).toEqual(['u-admin'])
  })

  it('is idempotent', async () => {
    await s().adminDeactivateUser('u-member')
    const rows = s().auditLog.length
    expect((await s().adminDeactivateUser('u-member')).ok).toBe(true)
    expect(s().auditLog).toHaveLength(rows)
  })
})

describe('audit log (local)', () => {
  it('records role and permission changes made through Settings → Users', async () => {
    await s().adminUpdateUser('u-member', { role: 'admin' })
    await s().adminUpdateUser('u-member', { permissions: { growth: 'edit' } })
    expect(s().auditLog.slice(0, 2).map((e) => e.action)).toEqual(['profile.permissions_changed', 'profile.role_changed'])
    expect(s().auditLog[1].detail).toEqual({ from: 'member', to: 'admin' })
  })

  it('numbers rows newest first', async () => {
    await s().adminDeactivateUser('u-member')
    await s().adminReactivateUser('u-member')
    expect(s().auditLog.map((e) => e.id)).toEqual([2, 1])
  })

  it('loadAuditLog is admin-only and has nothing to fetch locally', async () => {
    expect(await s().loadAuditLog()).toEqual({ ok: true, hasMore: false })
    useStore.setState({ currentUserId: 'u-member' })
    expect((await s().loadAuditLog()).ok).toBe(false)
  })
})

describe('site subscribers (local)', () => {
  const sub = { id: 'sub-1', email: 'a@b.co', source: 'footer', consentAt: '2026-10-01T00:00:00Z', createdAt: '2026-10-01T00:00:00Z' }

  it('unsubscribes (keeping the row) and deletes on request with growth:edit', () => {
    useStore.setState({ siteSubscribers: [sub] })
    expect(s().unsubscribeSubscriber('sub-1')).toBe(true)
    expect(s().siteSubscribers[0].unsubscribedAt).toBeDefined()
    expect(s().resubscribeSubscriber('sub-1')).toBe(true)
    expect(s().siteSubscribers[0].unsubscribedAt).toBeUndefined()
    expect(s().auditLog[0]).toMatchObject({ action: 'subscriber.resubscribed', entityId: 'sub-1' })
    expect(s().deleteSubscriber('sub-1')).toBe(true)
    expect(s().siteSubscribers).toEqual([])
    expect(s().auditLog[0]).toMatchObject({ action: 'subscriber.deleted', entity: 'site_subscriber', entityId: 'sub-1' })
  })

  it('refuses without growth:edit', () => {
    useStore.setState({ siteSubscribers: [sub], currentUserId: 'u-member' })
    expect(s().unsubscribeSubscriber('sub-1')).toBe(false)
    expect(s().deleteSubscriber('sub-1')).toBe(false)
    expect(s().siteSubscribers).toHaveLength(1)
  })
})
