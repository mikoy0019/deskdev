import { describe, expect, it } from 'vitest'
import { can } from './permissions'
import type { User } from './types'

const admin: User = { id: 'a', fullName: 'Admin', role: 'admin', permissions: {}, createdAt: '' }
const member: User = {
  id: 'm',
  fullName: 'Member',
  role: 'member',
  permissions: { projects: 'edit', tasks: 'view', clients: 'none' },
  createdAt: '',
}

describe('can()', () => {
  it('grants admins everything', () => {
    expect(can(admin, 'crm', 'edit')).toBe(true)
    expect(can(admin, 'meetings', 'view')).toBe(true)
  })

  it('denies a null user', () => {
    expect(can(null, 'projects', 'view')).toBe(false)
    expect(can(undefined, 'projects', 'edit')).toBe(false)
  })

  it("treats a member's edit as satisfying view", () => {
    expect(can(member, 'projects', 'view')).toBe(true)
    expect(can(member, 'projects', 'edit')).toBe(true)
  })

  it("does not let a member's view satisfy edit", () => {
    expect(can(member, 'tasks', 'view')).toBe(true)
    expect(can(member, 'tasks', 'edit')).toBe(false)
  })

  it('denies explicit none', () => {
    expect(can(member, 'clients', 'view')).toBe(false)
    expect(can(member, 'clients', 'edit')).toBe(false)
  })

  it('defaults an unspecified feature to none', () => {
    expect(can(member, 'crm', 'view')).toBe(false)
    expect(can(member, 'calendar', 'edit')).toBe(false)
  })
})
