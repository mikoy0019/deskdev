import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { useStore } from './useStore'
import * as db from '../lib/db'

const state = () => useStore.getState()
beforeEach(() => {
  state().resetSeed()
  useStore.setState({ currentUserId: 'u-admin', notifications: [], conversations: [], messages: [], jobPostings: [] })
})
afterEach(() => { vi.restoreAllMocks() })

describe('whiteboard revision persistence', () => {
  it('saves a task comment and notifies the mentioned teammate once', async () => {
    expect(await state().addTaskComment('t-auth', 'Review this <@u-member> <@u-member>')).toBe(true)
    expect(state().taskActivity.filter((row) => row.detail.comment)).toHaveLength(1)
    expect(state().notifications).toHaveLength(1)
    expect(state().notifications[0]).toMatchObject({ userId: 'u-member', entityId: 't-auth', type: 'task_updated' })
  })

  it('a failed comment write creates neither a local comment nor notifications', async () => {
    vi.spyOn(db, 'insert').mockResolvedValue(false)
    expect(await state().addTaskComment('t-auth', 'Review this <@u-member>')).toBe(false)
    expect(state().taskActivity.filter((row) => row.detail.comment)).toHaveLength(0)
    expect(state().notifications).toHaveLength(0)
  })

  it('refuses task comments without edit permission', async () => {
    const me = state().users.find((u) => u.id === 'u-member')!
    useStore.setState({ currentUserId: me.id, users: state().users.map((u) => u.id === me.id ? { ...u, permissions: { ...u.permissions, tasks: 'view' } } : u) })
    expect(await state().addTaskComment('t-auth', 'Read only')).toBe(false)
  })

  it('replies stay in their conversation and preserve their target', async () => {
    const first = state().startConversation(['u-member'])!
    const original = await state().sendMessageConfirmed(first, 'Original')
    const reply = await state().sendMessageConfirmed(first, 'Reply', original!)
    expect(state().messages.find((m) => m.id === reply)?.replyToId).toBe(original)
    const other = state().addUser({ fullName: 'Another member', email: 'another@example.test' })
    const second = state().startConversation([other])!
    expect(await state().sendMessageConfirmed(second, 'Wrong conversation', original!)).toBeNull()
  })

  it('deduplicates imported links and keeps the saved application across hydration in local mode', async () => {
    const url = 'https://www.onlinejobs.ph/jobseekers/job/Developer-123'
    expect(await state().importOljLinks([url, url])).toEqual({ added: 1, skipped: 1, failed: 0 })
    const job = state().jobPostings[0]
    expect(await state().saveJobApplication(job.id, { description: 'Real posting', application: { cv: 'Real work experience', draft: 'Reviewed draft', status: 'ready' } })).toBe(true)
    await state().hydrate()
    expect(state().jobPostings.find((j) => j.id === job.id)?.application).toMatchObject({ status: 'ready', draft: 'Reviewed draft' })
  })

  it('does not display failed imports or application saves as successful', async () => {
    vi.spyOn(db, 'insert').mockResolvedValue(false)
    expect(await state().importOljLinks(['https://onlinejobs.ph/jobseekers/job/Developer-123'])).toEqual({ added: 0, skipped: 0, failed: 1 })
    expect(state().jobPostings).toHaveLength(0)
  })

  it('ordinary channel posts notify readers without duplicating mention notifications', async () => {
    const channel = state().createChannel({ name: 'revisions' })!
    state().sendChannelMessage(channel, 'A normal post')
    expect(state().notifications.filter((n) => n.entityId === channel)).toHaveLength(1)
    expect(state().notifications[0].title).toContain('posted in #revisions')
    useStore.setState({ notifications: [] })
    state().sendChannelMessage(channel, 'Hello <@u-member>')
    expect(state().notifications.filter((n) => n.entityId === channel)).toHaveLength(1)
    expect(state().notifications[0].title).toContain('mentioned you')
  })
})
