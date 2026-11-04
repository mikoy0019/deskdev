import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'

// Revision 2, local mode: a task's collaborators besides its assignee.

const s = () => useStore.getState()
const task = (id: string) => s().tasks.find((t) => t.id === id)!
const notesFor = (userId: string) => s().notifications.filter((n) => n.userId === userId && n.title.includes('collaborator'))

beforeEach(() => {
  s().resetSeed()
  useStore.setState({ currentUserId: 'u-admin' })
})

describe('task collaborators', () => {
  it('a new task keeps its collaborators, without the assignee, and tells them', () => {
    const id = s().addTask({ clientId: 'cl-northwind', title: 'Pair task', assigneeId: 'u-admin', collaboratorIds: ['u-member', 'u-admin', 'u-member'] })
    expect(task(id).collaboratorIds).toEqual(['u-member'])
    expect(notesFor('u-member')).toHaveLength(1)
    expect(notesFor('u-member')[0]).toMatchObject({ type: 'task_assigned', entity: 'task', entityId: id })
  })

  it('saving the same list again is no change: no activity, no notification', () => {
    const id = s().addTask({ clientId: 'cl-northwind', title: 'Quiet', collaboratorIds: ['u-member'] })
    const activity = s().taskActivity.length
    const notes = s().notifications.length
    s().updateTask(id, { collaboratorIds: ['u-member'] })
    expect(s().taskActivity.length).toBe(activity)
    expect(s().notifications.length).toBe(notes)
  })

  it('only people newly added are told', () => {
    const id = s().addTask({ clientId: 'cl-northwind', title: 'Grow', collaboratorIds: ['u-member'] })
    useStore.setState((st) => ({ users: [...st.users, { ...st.users.find((u) => u.id === 'u-member')!, id: 'u-third', email: 'third@deskdev.local', fullName: 'Third' }] }))
    s().updateTask(id, { collaboratorIds: ['u-member', 'u-third'] })
    expect(notesFor('u-member')).toHaveLength(1)
    expect(notesFor('u-third')).toHaveLength(1)
    expect(task(id).collaboratorIds).toEqual(['u-member', 'u-third'])
  })

  it('becoming the assignee takes a person off the list', () => {
    const id = s().addTask({ clientId: 'cl-northwind', title: 'Swap', collaboratorIds: ['u-member'] })
    s().updateTask(id, { assigneeId: 'u-member' })
    expect(task(id).collaboratorIds).toEqual([])
  })

  it('refuses a deactivated or unknown person, and more than 20', () => {
    useStore.setState((st) => ({ users: st.users.map((u) => (u.id === 'u-member' ? { ...u, deactivatedAt: '2026-10-01T00:00:00Z' } : u)) }))
    expect(() => s().addTask({ clientId: 'cl-northwind', title: 'No', collaboratorIds: ['u-member'] })).toThrow(/active teammates/)
    expect(() => s().addTask({ clientId: 'cl-northwind', title: 'No', collaboratorIds: ['nobody'] })).toThrow(/active teammates/)
    const many = Array.from({ length: 21 }, (_, i) => `u-${i}`)
    expect(() => s().addTask({ clientId: 'cl-northwind', title: 'No', collaboratorIds: many })).toThrow(/at most 20/)
  })
})
