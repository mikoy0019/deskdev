import { beforeEach, describe, expect, it } from 'vitest'
import { migratePersistedState, useStore } from './useStore'
import { DEFAULT_WORKSPACE_SETTINGS } from '../lib/mappers'

// workspace_settings (033) replaces the browser-local Growth values
// (Settings.staleLeadDays / monthlyClientTarget). Local mode keeps it in the
// store; these cover the persist migration, the admin-only write path with
// 033's CHECKs mirrored, and the legacy Settings mirror screens still read.

const s = () => useStore.getState()

beforeEach(() => {
  s().resetSeed()
  useStore.setState({ currentUserId: 'u-admin' })
})

describe('persist migration v1 → v2', () => {
  it('carries the old local Growth values into workspaceSettings (local mode)', () => {
    const v1 = { settings: { autoArchiveDays: 30, workspaceName: 'X', staleLeadDays: 10, monthlyClientTarget: 6 }, leads: [] }
    const out = migratePersistedState(v1, 1, true) as Record<string, unknown>
    expect(out.workspaceSettings).toEqual({ ...DEFAULT_WORKSPACE_SETTINGS, growthStaleDays: 10, growthMonthlyClientTarget: 6 })
    expect(out.settings).toMatchObject({ staleLeadDays: 10, monthlyClientTarget: 6, growthSettingsMigrated: true })
    // Nothing else is touched.
    expect(out.leads).toEqual([])
  })

  it('uses the old app defaults when the browser never changed them', () => {
    const out = migratePersistedState({ settings: {} }, 1, true) as { workspaceSettings: { growthStaleDays: number; growthMonthlyClientTarget: number } }
    expect(out.workspaceSettings.growthStaleDays).toBe(7)
    expect(out.workspaceSettings.growthMonthlyClientTarget).toBe(4)
  })

  it('leaves remote mode to the first pull (only an admin may write the server row)', () => {
    const v1 = { settings: { staleLeadDays: 10 } }
    expect(migratePersistedState(v1, 1, false)).toEqual(v1)
  })

  it('is a no-op for a current store or nothing at all', () => {
    const v2 = { settings: {}, workspaceSettings: { ...DEFAULT_WORKSPACE_SETTINGS, growthStaleDays: 3 } }
    expect(migratePersistedState(v2, 2, true)).toEqual(v2)
    expect(migratePersistedState(undefined, 1, true)).toBeUndefined()
  })

  it('is wired into persist, at version 2', () => {
    const options = useStore.persist.getOptions()
    expect(options.version).toBe(2)
    expect(typeof options.migrate).toBe('function')
  })
})

describe('updateWorkspaceSettings', () => {
  it('is admin-only', () => {
    useStore.setState({ currentUserId: 'u-member' })
    const before = s().workspaceSettings
    expect(s().updateWorkspaceSettings({ growthSlaMinutes: 30 })).toBe(false)
    expect(s().workspaceSettings).toBe(before)
  })

  it('stamps who saved it and mirrors the legacy fields', () => {
    expect(s().updateWorkspaceSettings({ growthStaleDays: 21, growthMonthlyClientTarget: 8 })).toBe(true)
    expect(s().workspaceSettings).toMatchObject({ growthStaleDays: 21, growthMonthlyClientTarget: 8, updatedBy: 'u-admin' })
    expect(s().settings).toMatchObject({ staleLeadDays: 21, monthlyClientTarget: 8 })
  })

  it('clamps counts to the CHECK ranges', () => {
    s().updateWorkspaceSettings({ growthSlaMinutes: 1, growthEscalateMinutes: 99999, growthStaleDays: 0.4 })
    expect(s().workspaceSettings).toMatchObject({ growthSlaMinutes: 5, growthEscalateMinutes: 43200, growthStaleDays: 1 })
  })

  it('refuses an escalation earlier than the SLA', () => {
    expect(s().updateWorkspaceSettings({ growthSlaMinutes: 120, growthEscalateMinutes: 60 })).toBe(false)
    expect(s().workspaceSettings.growthSlaMinutes).toBe(60)
  })

  it('refuses bad business hours and non-https booking links', () => {
    expect(s().updateWorkspaceSettings({ growthBusinessHours: { tz: 'Nowhere/City', days: [1], start: '09:00', end: '17:00' } })).toBe(false)
    expect(s().updateWorkspaceSettings({ growthBookingUrl: 'http://cal.example/me' })).toBe(false)
    expect(s().updateWorkspaceSettings({ growthBookingUrl: ' https://calendar.app.google/abc ' })).toBe(true)
    expect(s().workspaceSettings.growthBookingUrl).toBe('https://calendar.app.google/abc')
    expect(s().updateWorkspaceSettings({ growthBookingUrl: '' })).toBe(true)
    expect(s().workspaceSettings.growthBookingUrl).toBeUndefined()
  })

  it('keeps the owner pool in order, without duplicates, strangers or leavers', () => {
    useStore.setState((st) => ({
      users: [...st.users, { ...st.users[1], id: 'u-gone', deactivatedAt: '2026-10-01T00:00:00Z' }],
    }))
    s().updateWorkspaceSettings({ growthOwnerPool: ['u-member', 'u-admin', 'u-member', 'u-gone', 'u-ghost'] })
    expect(s().workspaceSettings.growthOwnerPool).toEqual(['u-member', 'u-admin'])
  })

  it('updateSettings forwards the legacy Growth fields', () => {
    s().updateSettings({ staleLeadDays: 12 })
    expect(s().workspaceSettings.growthStaleDays).toBe(12)
    s().updateSettings({ weeklyOutreachTarget: 70 })
    expect(s().settings.weeklyOutreachTarget).toBe(70)
  })

  it('resetSeed restores the local demo values', () => {
    s().updateWorkspaceSettings({ growthStaleDays: 30 })
    s().resetSeed()
    expect(s().workspaceSettings).toMatchObject({ growthStaleDays: 7, growthMonthlyClientTarget: 4 })
    expect(s().settings.staleLeadDays).toBe(7)
  })
})
