import { beforeEach, expect, it, vi } from 'vitest'
import { emptyEngagementTerms } from '../lib/engagements'

const remote = vi.hoisted(() => ({ save: vi.fn(), remove: vi.fn() }))
vi.mock('../lib/supabase', () => ({ isSupabaseConfigured: true, supabase: { auth: { getSession: async () => ({ data: { session: null }, error: null }) } } }))
vi.mock('../lib/db', () => ({ saveProjectEngagement: (...args: unknown[]) => remote.save(...args), removeConfirmed: (...args: unknown[]) => remote.remove(...args), setCurrentUserGetter: () => {} }))
import { useStore } from './useStore'
import type { ProjectEngagement, User, Project } from '../lib/types'

const admin: User = { id: 'u1', role: 'admin', permissions: {}, fullName: 'Admin', createdAt: '2026-01-01' }
const project: Project = { id: 'p1', clientId: 'c1', title: 'Project', status: 'planning', position: 0, createdAt: '2026-01-01', updatedAt: '2026-01-01' }
const record: ProjectEngagement = { id: 'e1', projectId: 'p1', version: 1, terms: emptyEngagementTerms(), createdAt: '2026-01-01', updatedAt: '2026-01-01' }
beforeEach(() => {
  remote.save.mockReset()
  remote.remove.mockReset()
  useStore.setState({ users: [admin], currentUserId: admin.id, projects: [project], projectEngagements: [] })
})

it('does not show a financial record until the server confirms it', async () => {
  let resolve!: (value: unknown) => void
  remote.save.mockImplementation(() => new Promise((done) => { resolve = done }))
  const pending = useStore.getState().saveEngagement('p1', 0, emptyEngagementTerms())
  expect(useStore.getState().projectEngagements).toEqual([])
  resolve({ record })
  expect(await pending).toEqual({ ok: true })
  expect(useStore.getState().projectEngagements).toEqual([record])
})

it('keeps the previous saved record on a network error or stale server response', async () => {
  useStore.setState({ projectEngagements: [record] })
  remote.save.mockResolvedValue({ error: 'Changed on the server' })
  expect((await useStore.getState().saveEngagement('p1', 1, { ...record.terms, scope: 'Unsaved' })).ok).toBe(false)
  expect(useStore.getState().projectEngagements).toEqual([record])
})

it('does not adopt a response belonging to a previous session', async () => {
  let resolve!: (value: unknown) => void
  remote.save.mockImplementation(() => new Promise((done) => { resolve = done }))
  const pending = useStore.getState().saveEngagement('p1', 0, emptyEngagementTerms())
  useStore.setState({ currentUserId: null })
  resolve({ record })
  expect((await pending).ok).toBe(false)
  expect(useStore.getState().projectEngagements).toEqual([])
})

it('retains the project when the server refuses a delete of hidden engagement history', async () => {
  remote.remove.mockResolvedValue({ ok: false, error: 'Retained engagement history' })
  expect((await useStore.getState().deleteProject('p1')).ok).toBe(false)
  expect(useStore.getState().projects).toEqual([project])
})
