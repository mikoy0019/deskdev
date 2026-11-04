import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WORKSPACE_SETTINGS, TABLE_FOR, leadToRow, rowToAuditLogEntry, rowToLead, rowToShowcaseItem,
  rowToSiteSubscriber, rowToUser, rowToWorkspaceSettings, showcaseItemToRow, siteSubscriberToRow, toRow,
  userToRow, workspaceSettingsToRow, eventToRow,
} from './mappers'

// The Round 2 tables (032–040): the right table names, the database-owned
// columns kept out of every write, and safe defaults on the way in.

describe('table names', () => {
  it('maps the new entities to their tables', () => {
    expect(TABLE_FOR.showcaseItems).toBe('showcase_items')
    expect(TABLE_FOR.eventAttendees).toBe('event_attendees')
    expect(TABLE_FOR.siteSubscribers).toBe('site_subscribers')
    expect(TABLE_FOR.auditLog).toBe('audit_log')
    expect(TABLE_FOR.workspaceSettings).toBe('workspace_settings')
  })
})

describe('profiles (032)', () => {
  it('reads the deactivation stamps', () => {
    const u = rowToUser({ id: 'u', full_name: 'A', role: 'member', permissions: {}, deactivated_at: '2026-10-01T00:00:00Z', deactivated_by: 'a', created_at: 'x' })
    expect(u.deactivatedAt).toBe('2026-10-01T00:00:00Z')
    expect(u.deactivatedBy).toBe('a')
  })

  it('never writes them, nor the local password', () => {
    const row = userToRow({ fullName: 'A', password: 'pw', deactivatedAt: 'x', deactivatedBy: 'y' })
    expect(row).toEqual({ full_name: 'A' })
  })
})

describe('leads (034 / 039)', () => {
  it('reads the intake columns', () => {
    const l = rowToLead({
      id: 'l', name: 'Maya', email_norm: 'maya@x.io', budget_band: '3k_7k', score_breakdown: { budget: 20 },
      sla_due_at: '2026-10-03T10:00:00Z', existing_client_id: null, services: ['website'], attribution: { first: { utm_source: 'google' } },
    })
    expect(l.emailNorm).toBe('maya@x.io')
    expect(l.budgetBand).toBe('3k_7k')
    expect(l.scoreBreakdown).toEqual({ budget: 20 })
    expect(l.existingClientId).toBeUndefined()
    // jsonb passes through untouched — the keys keep their URL spelling.
    expect(l.attribution).toEqual({ first: { utm_source: 'google' } })
  })

  it('never writes the generated email_norm or the retention stamp', () => {
    const row = leadToRow({ name: 'Maya', emailNorm: 'x', piiScrubbedAt: 'y', slaDueAt: 'z', spam: true })
    expect(row).toEqual({ name: 'Maya', sla_due_at: 'z', spam: true })
    expect(toRow('leads', { emailNorm: 'x', budgetBand: 'unsure' })).toEqual({ budget_band: 'unsure' })
  })
})

describe('showcase_items (037)', () => {
  it('fills NOT NULL defaults a partial row lacks', () => {
    const i = rowToShowcaseItem({ id: 's', slug: 'a', kind: 'website', title: 'A', status: 'draft', created_at: 'x', updated_at: 'x' })
    expect(i).toMatchObject({
      stack: [], linkPublic: true, featured: false, homeFeatured: false, sortOrder: 0,
      linkStatus: 'unknown', linkFailCount: 0, consent: 'unknown',
    })
  })

  it('keeps what the row has', () => {
    const i = rowToShowcaseItem({ id: 's', stack: ['Next.js'], link_public: false, public_url: null, consent: 'legacy', image_key_small: 'k' })
    expect(i.stack).toEqual(['Next.js'])
    expect(i.linkPublic).toBe(false)
    expect(i.publicUrl).toBeUndefined()
    expect(i.imageKeySmall).toBe('k')
  })

  it('leaves the trigger-stamped columns out of a write', () => {
    const row = showcaseItemToRow({
      title: 'A', publishedAt: 'x', publishedBy: 'y', publicUrl: 'https://z.io', homeFeatured: true, caseStudy: { outcome: 'More calls' },
    })
    expect(row).toEqual({ title: 'A', home_featured: true, case_study: { outcome: 'More calls' } })
  })
})

describe('site_subscribers (039)', () => {
  it('writes only unsubscribed_at, the column staff may change', () => {
    expect(siteSubscriberToRow({ unsubscribedAt: '2026-10-03T00:00:00Z', email: 'x@y.z', emailNorm: 'x' })).toEqual({
      unsubscribed_at: '2026-10-03T00:00:00Z',
    })
    expect(siteSubscriberToRow({ unsubscribedAt: undefined })).toEqual({ unsubscribed_at: null })
    expect(toRow('siteSubscribers', { email: 'x@y.z' })).toEqual({})
  })

  it('reads a row', () => {
    const s = rowToSiteSubscriber({ id: 's', email: 'X@y.z', email_norm: 'x@y.z', source: 'footer', unsubscribed_at: null, created_at: 'c' })
    expect(s).toMatchObject({ email: 'X@y.z', emailNorm: 'x@y.z', source: 'footer', createdAt: 'c' })
    expect(s.unsubscribedAt).toBeUndefined()
  })
})

describe('audit_log (032)', () => {
  it('keeps the numeric id and defaults a missing detail', () => {
    const e = rowToAuditLogEntry({ id: 42, at: 'a', actor_id: null, action: 'profile.deactivated', entity: 'profile', entity_id: 'u', detail: null })
    expect(e).toEqual({ id: 42, at: 'a', actorId: undefined, action: 'profile.deactivated', entity: 'profile', entityId: 'u', detail: {} })
  })
})

describe('workspace_settings (033)', () => {
  it('drops the singleton id and fills unset columns with the SQL defaults', () => {
    const w = rowToWorkspaceSettings({ id: true, growth_sla_minutes: 30, growth_owner_pool: ['u1'], growth_booking_url: null })
    expect(w).toEqual({ ...DEFAULT_WORKSPACE_SETTINGS, growthSlaMinutes: 30, growthOwnerPool: ['u1'] })
    expect('id' in w).toBe(false)
  })

  it('an empty row is the defaults', () => {
    expect(rowToWorkspaceSettings({})).toEqual(DEFAULT_WORKSPACE_SETTINGS)
  })

  it('keeps business hours as jsonb with their own key spelling', () => {
    const hours = { tz: 'Europe/London', days: [1, 2], start: '08:00', end: '16:00' }
    expect(rowToWorkspaceSettings({ growth_business_hours: hours }).growthBusinessHours).toEqual(hours)
    expect(workspaceSettingsToRow({ growthBusinessHours: hours }).growth_business_hours).toEqual(hours)
  })

  it('never writes id or updated_at, but does write updated_by', () => {
    expect(workspaceSettingsToRow({ growthStaleDays: 10, updatedAt: 'x', updatedBy: 'u' })).toEqual({
      growth_stale_days: 10, updated_by: 'u',
    })
  })
})

describe('events (040)', () => {
  it('leaves the Google sync columns to the sync function', () => {
    const row = eventToRow({ title: 'Call', syncGoogle: true, addMeet: true, timezone: 'Asia/Manila', googleEventId: 'g', googleEtag: 'e', syncStatus: 's', syncError: 'x' })
    expect(row).toEqual({ title: 'Call', sync_google: true, add_meet: true, timezone: 'Asia/Manila' })
  })
})
