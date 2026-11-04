import { describe, expect, it } from 'vitest'
import { AUDIT_GROUPS, auditActor, auditDetail, auditGroup, auditIsSensitive, auditLabel, auditTarget } from './auditLabels'
import type { AuditLogEntry } from '../../lib/types'

const row = (action: string, extra: Partial<AuditLogEntry> = {}): AuditLogEntry => ({
  id: 1, at: '2026-10-01T10:00:00Z', action, entity: auditGroup(action), detail: {}, ...extra,
})

const names: Record<string, string> = { u1: 'Ana Reyes', u2: 'Ben Cole' }
const nameOf = (id: string) => names[id]

// Every action the backend writes (PART2 brief, section 9).
const ACTIONS = [
  'profile.created', 'profile.deleted', 'profile.role_changed', 'profile.permissions_changed', 'profile.email_changed',
  'profile.deactivated', 'profile.reactivated',
  'vault.reset_requested', 'vault.reset_approved', 'vault.archived', 'vault.generation_deleted', 'vault.owner_changed',
  'vault.access_created', 'vault.access_invited', 'vault.access_claimed', 'vault.access_removed', 'vault.password_changed',
  'settings.updated',
  'showcase.published', 'showcase.unpublished', 'showcase.deleted', 'showcase.seeded',
  'subscriber.deleted',
  'retention.run',
  'auth.user_created', 'auth.password_set', 'auth.user_deleted', 'auth.sign_in_blocked', 'auth.sign_in_restored',
  'google.export', 'google.revoked', 'google.keys_rotated', 'google.workspace_connected', 'google.workspace_disconnected',
  'google.workspace_revoked',
]

describe('auditLabel', () => {
  it('has words for every action the backend writes, and a filter group for each', () => {
    const groups = new Set<string>(AUDIT_GROUPS.map((g) => g.id))
    for (const action of ACTIONS) {
      expect(auditLabel(action), action).toMatch(/^[A-Z]/)
      expect(groups.has(auditGroup(action)), action).toBe(true)
    }
  })

  it('words the actions whose names would mislead', () => {
    expect(auditLabel('auth.user_deleted')).toBe('Account deleted')
    expect(auditLabel('google.workspace_revoked')).toBe('Company Google access revoked')
    expect(auditLabel('google.export')).toBe('Exported to Google Sheets')
  })

  it('spells out an action it does not know', () => {
    expect(auditLabel('billing.plan_changed')).toBe('Billing plan changed')
    expect(auditLabel('')).toBe('Unknown action')
  })

  it('marks the actions that remove access', () => {
    expect(auditIsSensitive('profile.deactivated')).toBe(true)
    expect(auditIsSensitive('auth.user_deleted')).toBe(true)
    expect(auditIsSensitive('google.workspace_revoked')).toBe(true)
    expect(auditIsSensitive('profile.reactivated')).toBe(false)
    expect(auditIsSensitive('settings.updated')).toBe(false)
  })
})

describe('auditActor / auditTarget', () => {
  it('names the admin, and says System for a row the database wrote alone', () => {
    expect(auditActor(row('profile.deactivated', { actorId: 'u1' }), nameOf)).toBe('Ana Reyes')
    expect(auditActor(row('profile.deleted'), nameOf)).toBe('System')
    expect(auditActor(row('profile.deleted', { actorId: 'gone' }), nameOf)).toBe('A removed account')
  })

  it('names the person by their current name, else what the row kept', () => {
    expect(auditTarget(row('profile.deactivated', { entityId: 'u2' }), nameOf)).toBe('Ben Cole')
    const deleted = row('auth.user_deleted', { entityId: 'gone', detail: { full_name: 'Old Hand', email: 'old@x.co' } })
    expect(auditTarget(deleted, nameOf)).toBe('Old Hand')
    expect(auditTarget(row('profile.deleted', { entityId: 'gone', detail: { email: 'old@x.co' } }), nameOf)).toBe('old@x.co')
    expect(auditTarget(row('profile.deleted', { entityId: 'gone' }), nameOf)).toBe('A removed account')
  })

  it('names the Google account, and nothing for workspace-wide rows', () => {
    expect(auditTarget(row('google.workspace_connected', { detail: { google_email: 'team@x.co' } }), nameOf)).toBe('team@x.co')
    expect(auditTarget(row('settings.updated'), nameOf)).toBeNull()
  })
})

describe('auditDetail', () => {
  it('shows a role or email change as from → to', () => {
    expect(auditDetail(row('profile.role_changed', { detail: { from: 'member', to: 'admin', full_name: 'Ben' } }))).toBe('member → admin')
  })

  it('lists only the permissions that changed', () => {
    const detail = { from: { tasks: 'view', vault: 'edit', crm: 'view' }, to: { tasks: 'edit', crm: 'view' } }
    expect(auditDetail(row('profile.permissions_changed', { detail }))).toBe('tasks view → edit, vault edit → none')
    expect(auditDetail(row('profile.permissions_changed', { detail: { from: {}, to: {} } }))).toBeNull()
  })

  it('says who set a password', () => {
    expect(auditDetail(row('auth.password_set', { detail: { self: true } }))).toBe('Own password')
    expect(auditDetail(row('auth.password_set', { detail: { self: false } }))).toBe('Set by an admin')
  })

  it('lists the exported tabs and the changed settings', () => {
    expect(auditDetail(row('google.export', { detail: { tabs: [{ tab: 'tasks', rows: 3 }, { tab: 'leads', rows: 1 }] } }))).toBe('tasks, leads')
    expect(auditDetail(row('settings.updated', { detail: { growth_sla_minutes: { from: 5, to: 10 }, brand: {} } }))).toBe('brand, growth_sla_minutes')
  })

  it('falls back to plain values and leaves ids and blobs out', () => {
    const detail = { client_id: 'abc', kept: 12, purged: 3, nested: { a: 1 } }
    expect(auditDetail(row('retention.run', { detail }))).toBe('kept 12 · purged 3')
    expect(auditDetail(row('vault.archived'))).toBeNull()
  })
})
