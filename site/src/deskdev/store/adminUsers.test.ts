import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the edge-function wrapper so the dual-mode admin user actions can be
// exercised without a network: `remote.enabled` flips local/remote mode and
// the api mocks stand in for the admin-users edge function.
const remote = vi.hoisted(() => ({ enabled: true }))
const api = vi.hoisted(() => ({
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
}))

vi.mock('../lib/adminUsers', () => ({
  isRemoteMode: () => remote.enabled,
  createUser: api.createUser,
  updateUser: api.updateUser,
  deleteUser: api.deleteUser,
}))

import { useStore } from './useStore'

const s = () => useStore.getState()

beforeEach(() => {
  remote.enabled = true
  vi.clearAllMocks()
  useStore.getState().resetSeed()
})

describe('local mode delegation', () => {
  it('adminCreateUser adds a local user without calling the edge function', async () => {
    remote.enabled = false
    const before = s().users.length
    const res = await s().adminCreateUser({
      fullName: 'Loc Al',
      email: 'loc@x.com',
      password: 'pw12',
    })
    expect(res.ok).toBe(true)
    expect(s().users.length).toBe(before + 1)
    expect(api.createUser).not.toHaveBeenCalled()
    // Local mode keeps the password so the seed-style login works
    expect(s().users.find((u) => u.id === res.id)!.password).toBe('pw12')
  })

  it('adminUpdateUser and adminDeleteUser stay store-only in local mode', async () => {
    remote.enabled = false
    const target = s().users.find((u) => u.id === 'u-member')!
    await s().adminUpdateUser(target.id, { fullName: 'Renamed' })
    expect(s().users.find((u) => u.id === target.id)!.fullName).toBe('Renamed')
    await s().adminDeleteUser(target.id)
    expect(s().users.find((u) => u.id === target.id)).toBeUndefined()
    expect(api.updateUser).not.toHaveBeenCalled()
    expect(api.deleteUser).not.toHaveBeenCalled()
  })
})

describe('remote create', () => {
  it('stores the user under the server-issued id and never keeps the password', async () => {
    api.createUser.mockResolvedValue({ ok: true, userId: 'server-1' })
    const res = await s().adminCreateUser({
      fullName: 'Rem Ote',
      email: 'rem@x.com',
      password: 'secret123',
      role: 'member',
      permissions: { tasks: 'edit' },
    })
    expect(res).toEqual({ ok: true, id: 'server-1' })
    expect(api.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'rem@x.com',
        password: 'secret123',
        fullName: 'Rem Ote',
      }),
    )
    const created = s().users.find((u) => u.id === 'server-1')!
    expect(created.fullName).toBe('Rem Ote')
    expect(created.permissions).toEqual({ tasks: 'edit' })
    expect(created.password).toBeUndefined()
  })

  it('leaves the store untouched when the edge function fails', async () => {
    api.createUser.mockResolvedValue({ ok: false, error: 'email taken' })
    const before = s().users.length
    const res = await s().adminCreateUser({
      fullName: 'Nope',
      email: 'dup@x.com',
      password: 'secret123',
    })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('email taken')
    expect(s().users.length).toBe(before)
  })

  it('rejects a create without a password before hitting the network', async () => {
    const res = await s().adminCreateUser({ fullName: 'No Pw', email: 'nopw@x.com' })
    expect(res.ok).toBe(false)
    expect(api.createUser).not.toHaveBeenCalled()
  })
})

describe('remote update', () => {
  it('applies the patch optimistically and keeps it on success', async () => {
    api.updateUser.mockResolvedValue({ ok: true, userId: 'u-member' })
    const res = await s().adminUpdateUser('u-member', { fullName: 'Alexandra Cruz' })
    expect(res.ok).toBe(true)
    expect(s().users.find((u) => u.id === 'u-member')!.fullName).toBe('Alexandra Cruz')
  })

  it('rolls the patch back on failure', async () => {
    api.updateUser.mockResolvedValue({ ok: false, error: 'Admin access required' })
    const res = await s().adminUpdateUser('u-member', { fullName: 'Changed', title: 'CTO' })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('Admin access required')
    const after = s().users.find((u) => u.id === 'u-member')!
    expect(after.fullName).toBe('Alex Cruz')
    expect(after.title).toBe('Developer')
  })

  it('sends passwords to the edge function but never into the store', async () => {
    api.updateUser.mockResolvedValue({ ok: true, userId: 'u-member' })
    await s().adminUpdateUser('u-member', { password: 'newsecret' })
    expect(api.updateUser).toHaveBeenCalledWith(
      'u-member',
      expect.objectContaining({ password: 'newsecret' }),
    )
    // seed password untouched — the optimistic patch strips it
    expect(s().users.find((u) => u.id === 'u-member')!.password).toBe('member')
  })

  it('translates explicit undefined into null so remote fields clear', async () => {
    api.updateUser.mockResolvedValue({ ok: true, userId: 'u-member' })
    await s().adminUpdateUser('u-member', { phone: undefined, title: undefined })
    expect(api.updateUser).toHaveBeenCalledWith(
      'u-member',
      expect.objectContaining({ phone: null, title: null }),
    )
  })
})

describe('remote delete', () => {
  it('removes the user on success', async () => {
    api.deleteUser.mockResolvedValue({ ok: true, userId: 'u-member' })
    const res = await s().adminDeleteUser('u-member')
    expect(res.ok).toBe(true)
    expect(api.deleteUser).toHaveBeenCalledWith('u-member')
    expect(s().users.find((u) => u.id === 'u-member')).toBeUndefined()
  })

  it('restores the user and their notifications on failure', async () => {
    api.deleteUser.mockResolvedValue({ ok: false, error: 'Cannot delete your own account' })
    const usersBefore = s().users.length
    const notifsBefore = s().notifications.filter((n) => n.userId === 'u-member').length
    const res = await s().adminDeleteUser('u-member')
    expect(res.ok).toBe(false)
    expect(res.error).toBe('Cannot delete your own account')
    expect(s().users.length).toBe(usersBefore)
    expect(s().users.find((u) => u.id === 'u-member')).toBeDefined()
    expect(s().notifications.filter((n) => n.userId === 'u-member').length).toBe(notifsBefore)
  })
})
