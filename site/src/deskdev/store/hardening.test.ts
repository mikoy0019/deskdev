import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'

const s = () => useStore.getState()
let admin: string
let member: string
const signIn = (id: string) => useStore.setState({ currentUserId: id })

beforeEach(() => {
  s().resetSeed()
  useStore.setState({ notifications: [], lastReminderCheck: null, remindedIds: [] })
  ;[admin, member] = s().users.map((u) => u.id)
  signIn(admin)
})

describe('destructive actions are permission-guarded', () => {
  it('a view-only member cannot delete a client or move a task', () => {
    s().updateUser(member, { permissions: { clients: 'view', tasks: 'view' } })
    signIn(member)
    const clientId = s().clients[0].id
    const before = s().clients.length
    s().deleteClient(clientId)
    expect(s().clients).toHaveLength(before)
    const task = s().tasks.find((t) => t.status === 'todo' && !t.parentTaskId)!
    expect(s().setTaskStatus(task.id, 'in_progress')).toBe(false)
    expect(s().tasks.find((t) => t.id === task.id)?.status).toBe('todo')
  })

  it('an editor still can', () => {
    s().updateUser(member, { permissions: { tasks: 'edit' } })
    signIn(member)
    const task = s().tasks.find((t) => t.status === 'todo' && !t.parentTaskId)!
    expect(s().setTaskStatus(task.id, 'in_progress')).toBe(true)
  })
})

describe('pictures (052): admins only', () => {
  const PIC = 'data:image/webp;base64,UklGRg=='

  it('an admin sets and clears their own picture and a client’s', () => {
    expect(s().setPicture({ kind: 'profiles', id: admin }, PIC)).toEqual({ ok: true })
    expect(s().users.find((u) => u.id === admin)?.avatarKey).toBe(PIC)
    const clientId = s().clients[0].id
    expect(s().setPicture({ kind: 'clients', id: clientId }, PIC)).toEqual({ ok: true })
    expect(s().clients.find((c) => c.id === clientId)?.avatarKey).toBe(PIC)
    expect(s().setPicture({ kind: 'clients', id: clientId }, null)).toEqual({ ok: true })
    expect(s().clients.find((c) => c.id === clientId)?.avatarKey).toBeUndefined()
  })

  it('a member can set neither, not even through a client edit', () => {
    s().updateUser(member, { permissions: { clients: 'edit' } })
    signIn(member)
    const clientId = s().clients[0].id
    expect(s().setPicture({ kind: 'profiles', id: member }, PIC).ok).toBe(false)
    expect(s().setPicture({ kind: 'clients', id: clientId }, PIC).ok).toBe(false)
    s().updateClient(clientId, { avatarKey: PIC, notes: 'still saved' })
    const client = s().clients.find((c) => c.id === clientId)!
    expect(client.avatarKey).toBeUndefined()
    expect(client.notes).toBe('still saved')
    expect(s().users.find((u) => u.id === member)?.avatarKey).toBeUndefined()
  })

  it('refuses an owner that is not in the workspace', () => {
    expect(s().setPicture({ kind: 'clients', id: 'nope' }, PIC).ok).toBe(false)
    expect(s().setPicture({ kind: 'profiles', id: 'nope' }, PIC).ok).toBe(false)
  })
})

describe('task notifications', () => {
  it('does not notify an admin assignee twice for one assignment', () => {
    signIn(member)
    s().updateUser(member, { permissions: { tasks: 'edit' } })
    const clientId = s().clients[0].id
    s().addTask({ title: 'One', clientId, assigneeId: admin })
    const mine = s().notifications.filter((n) => n.userId === admin)
    expect(mine).toHaveLength(1)
    expect(mine[0].type).toBe('task_assigned')
  })

  it('a save that changes nothing notifies nobody', () => {
    const task = s().tasks[0]
    const before = s().notifications.length
    const activity = s().taskActivity.length
    s().updateTask(task.id, { title: task.title, priority: task.priority })
    expect(s().notifications).toHaveLength(before)
    expect(s().taskActivity).toHaveLength(activity)
  })
})

describe('due reminders', () => {
  it('carry the actor, target only the signed-in user, and never duplicate', () => {
    s().checkDueReminders()
    const mine = s().notifications.filter((n) => n.type === 'due_reminder')
    expect(mine.length).toBeGreaterThan(0)
    expect(mine.every((n) => n.userId === admin && n.actorId === admin)).toBe(true)
    const count = mine.length
    // A second device of the same user (fresh remindedIds) sees the rows and stays quiet.
    useStore.setState({ remindedIds: [], lastReminderCheck: null })
    s().checkDueReminders()
    expect(s().notifications.filter((n) => n.type === 'due_reminder')).toHaveLength(count)
  })

  it('a dismissed reminder is not written again the same day', () => {
    s().checkDueReminders()
    const reminders = () => s().notifications.filter((n) => n.type === 'due_reminder')
    const count = reminders().length
    expect(count).toBeGreaterThan(0)
    const gone = reminders()[0]
    // The reminded key is not on this device (another device wrote the row).
    useStore.setState({ remindedIds: [] })
    s().deleteNotification(gone.id)
    s().checkDueReminders()
    expect(reminders()).toHaveLength(count - 1)
    expect(reminders().some((n) => n.entityId === gone.entityId)).toBe(false)
  })
})
