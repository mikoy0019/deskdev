import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'
import { emptyEngagementTerms } from '../lib/engagements'

const state = () => useStore.getState()
beforeEach(() => {
  state().resetSeed()
  useStore.setState({ currentUserId: state().users.find((u) => u.role === 'admin')!.id })
})

describe('engagement records', () => {
  it('saves a versioned record and rejects a stale tab without overwriting it', async () => {
    const project = state().projects[0]
    expect(await state().saveEngagement(project.id, 0, emptyEngagementTerms())).toEqual({ ok: true })
    expect(state().projectEngagements[0].version).toBe(1)
    expect((await state().saveEngagement(project.id, 0, { ...emptyEngagementTerms(), scope: 'Stale edit' })).ok).toBe(false)
    expect(state().projectEngagements[0].terms.scope).toBe('')
    expect(await state().saveEngagement(project.id, 1, { ...emptyEngagementTerms(), scope: 'Current edit' })).toEqual({ ok: true })
    expect(state().projectEngagements[0].version).toBe(2)
  })
  it('refuses members, deactivated admins, and unknown projects', async () => {
    const project = state().projects[0]
    useStore.setState({ currentUserId: state().users.find((u) => u.role === 'member')!.id })
    expect((await state().saveEngagement(project.id, 0, emptyEngagementTerms())).ok).toBe(false)
    const admin = state().users.find((u) => u.role === 'admin')!
    useStore.setState({ currentUserId: admin.id, users: state().users.map((u) => u.id === admin.id ? { ...u, deactivatedAt: '2026-01-01' } : u) })
    expect((await state().saveEngagement(project.id, 0, emptyEngagementTerms())).ok).toBe(false)
    state().resetSeed()
    expect((await state().saveEngagement('missing', 0, emptyEngagementTerms())).ok).toBe(false)
  })
  it('keeps a project and client that have a financial record', async () => {
    const project = state().projects[0]
    await state().saveEngagement(project.id, 0, emptyEngagementTerms())
    state().deleteProject(project.id)
    state().deleteClient(project.clientId)
    expect(state().projects.some((p) => p.id === project.id)).toBe(true)
    expect(state().clients.some((c) => c.id === project.clientId)).toBe(true)
  })
})
