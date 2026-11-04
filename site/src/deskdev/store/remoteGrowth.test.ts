import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Client, Lead, LeadActivity, Project, Task, User, WorkspaceSettings } from '../lib/types'

// Remote mode with the data layer faked: convertLead goes through the
// convert_lead RPC (036) and pulls back only what it created, falls back to
// the client-side path while 036 isn't applied, and workspace_settings (033)
// takes over from the browser-local Growth values on the first pull.

const h = vi.hoisted(() => ({
  convertLead: vi.fn(),
  fetchWhere: vi.fn(),
  fetchAllWithStatus: vi.fn(),
  updateWorkspaceSettings: vi.fn(),
  insert: vi.fn(),
  missingTables: new Set<string>(),
}))

vi.mock('../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'u-admin' } } }, error: null }) } },
}))
vi.mock('../lib/db', () => ({
  flush: () => Promise.resolve(),
  fetchAllWithStatus: (...a: unknown[]) => h.fetchAllWithStatus(...a),
  fetchWhere: (...a: unknown[]) => h.fetchWhere(...a),
  convertLead: (...a: unknown[]) => h.convertLead(...a),
  updateWorkspaceSettings: (...a: unknown[]) => h.updateWorkspaceSettings(...a),
  isTableMissing: (t: string) => h.missingTables.has(t),
  insert: (...a: unknown[]) => h.insert(...a),
  update: () => Promise.resolve(),
  remove: () => Promise.resolve(),
  setWriteErrorHandler: () => {},
  setCurrentUserGetter: () => {},
}))

import { useStore } from './useStore'
import { DEFAULT_WORKSPACE_SETTINGS } from '../lib/mappers'

const s = () => useStore.getState()
const NOW = '2026-10-03T00:00:00.000Z'

const admin: User = { id: 'u-admin', fullName: 'Admin', role: 'admin', permissions: {}, createdAt: NOW }
const member: User = { id: 'u-member', fullName: 'Member', role: 'member', permissions: { growth: 'edit', clients: 'edit' }, createdAt: NOW }
const lead: Lead = {
  id: 'lead-1', name: 'Maya', company: 'Kalye Coffee', stage: 'proposal', value: 0, source: 'website', hot: false,
  services: ['website'], createdAt: NOW, updatedAt: NOW,
}

beforeEach(() => {
  for (const fn of [h.convertLead, h.fetchWhere, h.fetchAllWithStatus, h.updateWorkspaceSettings, h.insert]) fn.mockReset()
  h.insert.mockResolvedValue(undefined)
  h.updateWorkspaceSettings.mockResolvedValue(undefined)
  h.missingTables.clear()
  useStore.setState({
    currentUserId: 'u-admin',
    users: [admin, member],
    leads: [lead],
    leadActivity: [],
    clients: [],
    projects: [],
    tasks: [],
    notifications: [],
    workspaceSettings: { ...DEFAULT_WORKSPACE_SETTINGS },
    settings: { autoArchiveDays: 30, workspaceName: 'DeskDev Studio' },
  })
})

describe('convertLead (remote)', () => {
  it('runs the RPC and merges just the rows it created', async () => {
    const client: Client = { id: 'c-1', name: 'Maya', engagement: 'gig_on_call', status: 'active', createdAt: NOW, updatedAt: NOW }
    const project: Project = { id: 'p-1', clientId: 'c-1', title: 'Kalye Coffee - Website', status: 'planning', position: 0, createdAt: NOW, updatedAt: NOW }
    const task: Task = {
      id: 't-1', clientId: 'c-1', projectId: 'p-1', title: 'Kickoff call with Kalye Coffee', status: 'todo', priority: 'high',
      position: 0, archived: false, createdAt: NOW, updatedAt: NOW,
    }
    const won: Lead = { ...lead, stage: 'won', clientId: 'c-1', updatedAt: '2026-10-03T00:01:00.000Z' }
    const act: LeadActivity = { id: 'a-1', leadId: 'lead-1', action: 'converted', detail: { client_id: 'c-1' }, createdAt: NOW }
    h.convertLead.mockResolvedValue({ ok: true, clientId: 'c-1', projectId: 'p-1' })
    h.fetchWhere.mockImplementation(async (key: string) =>
      ({ clients: [client], projects: [project], tasks: [task], leads: [won], leadActivity: [act] } as Record<string, unknown[]>)[key])

    const res = await s().convertLead('lead-1', 'Website')
    expect(res).toEqual({ ok: true, clientId: 'c-1', projectId: 'p-1' })
    // The service is normalized the way convert_lead does it.
    expect(h.convertLead).toHaveBeenCalledWith('lead-1', 'website')
    expect(h.fetchWhere.mock.calls).toEqual(expect.arrayContaining([
      ['clients', 'id', 'c-1'], ['projects', 'id', 'p-1'], ['tasks', 'project_id', 'p-1'],
      ['leads', 'id', 'lead-1'], ['leadActivity', 'lead_id', 'lead-1'],
    ]))
    expect(s().clients).toEqual([client])
    expect(s().projects).toEqual([project])
    expect(s().tasks).toEqual([task])
    expect(s().leads).toEqual([won])
    expect(s().leadActivity).toEqual([act])
    // Nothing was written from the client side.
    expect(h.insert).not.toHaveBeenCalled()
  })

  it('falls back to the client-side path while convert_lead is not applied', async () => {
    h.convertLead.mockResolvedValue({ ok: false, missing: true })
    const res = await s().convertLead('lead-1')
    expect(res.ok).toBe(true)
    expect(s().clients).toHaveLength(1)
    expect(s().projects[0].title).toBe('Kalye Coffee - Website')
    const tables = h.insert.mock.calls.map((c) => c[0])
    expect(tables).toEqual(expect.arrayContaining(['clients', 'projects', 'tasks', 'leadActivity']))
  })

  it('reports a refusal from the server and changes nothing', async () => {
    h.convertLead.mockResolvedValue({ ok: false, error: 'Converting a lead needs Growth and Clients edit access' })
    const res = await s().convertLead('lead-1')
    expect(res).toEqual({ ok: false, error: 'Converting a lead needs Growth and Clients edit access' })
    expect(s().clients).toEqual([])
    expect(h.fetchWhere).not.toHaveBeenCalled()
  })

  it('never calls the server without growth:edit and clients:edit', async () => {
    useStore.setState({ currentUserId: 'u-member', users: [admin, { ...member, permissions: { growth: 'edit' } }] })
    expect((await s().convertLead('lead-1')).ok).toBe(false)
    expect(h.convertLead).not.toHaveBeenCalled()
  })
})

describe('workspace_settings on the first pull', () => {
  const pull = (ws: Partial<WorkspaceSettings> | undefined) => {
    h.fetchAllWithStatus.mockResolvedValue({
      data: { users: [admin, member], ...(ws ? { workspaceSettings: { ...DEFAULT_WORKSPACE_SETTINGS, ...ws } } : {}) },
      failed: [],
    })
    return s().hydrate()
  }

  it('an admin’s browser carries its old local values up once, while nobody has saved settings', async () => {
    useStore.setState({ settings: { autoArchiveDays: 30, workspaceName: 'X', staleLeadDays: 10, monthlyClientTarget: 6 } })
    await pull({})
    expect(h.updateWorkspaceSettings).toHaveBeenCalledWith({ growthStaleDays: 10, growthMonthlyClientTarget: 6, updatedBy: 'u-admin' })
    expect(s().workspaceSettings).toMatchObject({ growthStaleDays: 10, growthMonthlyClientTarget: 6 })
    expect(s().settings).toMatchObject({ growthSettingsMigrated: true, staleLeadDays: 10, monthlyClientTarget: 6 })
    h.updateWorkspaceSettings.mockClear()
    await pull({ growthStaleDays: 10, growthMonthlyClientTarget: 6, updatedBy: 'u-admin' })
    expect(h.updateWorkspaceSettings).not.toHaveBeenCalled()
  })

  it('never overwrites settings someone already saved', async () => {
    useStore.setState({ settings: { autoArchiveDays: 30, workspaceName: 'X', staleLeadDays: 10 } })
    await pull({ growthStaleDays: 21, updatedBy: 'u-member' })
    expect(h.updateWorkspaceSettings).not.toHaveBeenCalled()
    expect(s().workspaceSettings.growthStaleDays).toBe(21)
    // The legacy field now mirrors the server.
    expect(s().settings.staleLeadDays).toBe(21)
    expect(s().settings.growthSettingsMigrated).toBe(true)
  })

  it('a member’s browser only reads', async () => {
    useStore.setState({ currentUserId: 'u-member', settings: { autoArchiveDays: 30, workspaceName: 'X', staleLeadDays: 10 } })
    await pull({})
    expect(h.updateWorkspaceSettings).not.toHaveBeenCalled()
    expect(s().workspaceSettings.growthStaleDays).toBe(DEFAULT_WORKSPACE_SETTINGS.growthStaleDays)
    expect(s().settings.growthSettingsMigrated).toBeUndefined()
  })

  it('without 033 applied, the local values keep ruling and nothing is written', async () => {
    h.missingTables.add('workspace_settings')
    useStore.setState({ settings: { autoArchiveDays: 30, workspaceName: 'X', staleLeadDays: 10, monthlyClientTarget: 3 } })
    await pull(undefined)
    expect(s().workspaceSettings).toMatchObject({ growthStaleDays: 10, growthMonthlyClientTarget: 3 })
    expect(s().updateWorkspaceSettings({ growthSlaMinutes: 30 })).toBe(true)
    expect(h.updateWorkspaceSettings).not.toHaveBeenCalled()
  })

  it('an admin save goes to the server', () => {
    expect(s().updateWorkspaceSettings({ growthAutoReply: true })).toBe(true)
    expect(h.updateWorkspaceSettings).toHaveBeenCalledWith({ growthAutoReply: true, updatedBy: 'u-admin' })
  })
})

describe('remote mode never invents a score', () => {
  it('addLead leaves scoring to leads_apply_score', () => {
    const id = s().addLead({ name: 'X', budgetBand: '15k_plus', timeline: 'asap' })
    const row = h.insert.mock.calls.find((c) => c[0] === 'leads')![1] as Lead
    expect(row.id).toBe(id)
    expect(row.score).toBeUndefined()
    expect(row.hot).toBe(false)
  })
})
