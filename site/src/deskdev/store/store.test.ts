import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'
import { isoDate } from '../lib/format'
import type { TaskStatus } from '../lib/types'

const s = () => useStore.getState()

beforeEach(() => {
  useStore.getState().resetSeed()
  // Destructive actions are permission-guarded; act as the seed admin.
  useStore.setState({ currentUserId: useStore.getState().users[0].id, notifications: [], remindedIds: [], lastReminderCheck: null })
})

describe('clients', () => {
  it('adds a client with sensible defaults', () => {
    const before = s().clients.length
    const id = s().addClient({ name: 'Acme Co' })
    expect(s().clients.length).toBe(before + 1)
    const c = s().clients.find((x) => x.id === id)!
    expect(c.name).toBe('Acme Co')
    expect(c.engagement).toBe('gig_on_call')
    expect(c.status).toBe('active')
  })

  it('updates a client', () => {
    const id = s().addClient({ name: 'Acme' })
    s().updateClient(id, { name: 'Acme Corp', status: 'paused' })
    const c = s().clients.find((x) => x.id === id)!
    expect(c.name).toBe('Acme Corp')
    expect(c.status).toBe('paused')
  })

  it('deletes a client and cascades to its projects and tasks', () => {
    const clientId = s().addClient({ name: 'Temp' })
    const projId = s().addProject({ clientId, title: 'P1' })
    const taskId = s().addTask({ clientId, title: 'T1' })
    s().deleteClient(clientId)
    expect(s().clients.find((c) => c.id === clientId)).toBeUndefined()
    expect(s().projects.find((p) => p.id === projId)).toBeUndefined()
    expect(s().tasks.find((t) => t.id === taskId)).toBeUndefined()
  })
})

describe('projects & task categories', () => {
  it('deleteProject detaches its tasks instead of deleting them', () => {
    const clientId = s().addClient({ name: 'C' })
    const projId = s().addProject({ clientId, title: 'P' })
    const taskId = s().addTask({ clientId, projectId: projId, title: 'T' })
    s().deleteProject(projId)
    expect(s().projects.find((p) => p.id === projId)).toBeUndefined()
    const t = s().tasks.find((x) => x.id === taskId)!
    expect(t).toBeDefined()
    expect(t.projectId).toBeUndefined()
  })

  it('deleteProjectCategory detaches both projects and tasks', () => {
    const clientId = s().addClient({ name: 'C' })
    const catId = s().addProjectCategory({ clientId, name: 'Cat' })
    const projId = s().addProject({ clientId, title: 'P', categoryId: catId })
    const taskId = s().addTask({ clientId, title: 'T', categoryId: catId })
    s().deleteProjectCategory(catId)
    expect(s().projectCategories.find((c) => c.id === catId)).toBeUndefined()
    expect(s().projects.find((p) => p.id === projId)!.categoryId).toBeUndefined()
    expect(s().tasks.find((t) => t.id === taskId)!.categoryId).toBeUndefined()
  })
})

describe('tasks', () => {
  it('setTaskStatus to done stamps completedAt, and clears it when reopened', () => {
    const clientId = s().addClient({ name: 'C' })
    const taskId = s().addTask({ clientId, title: 'T' })
    s().setTaskStatus(taskId, 'done')
    expect(s().tasks.find((t) => t.id === taskId)!.completedAt).toBeTruthy()
    s().setTaskStatus(taskId, 'todo')
    expect(s().tasks.find((t) => t.id === taskId)!.completedAt).toBeUndefined()
  })

  it('deleteTask removes the task', () => {
    const clientId = s().addClient({ name: 'C' })
    const taskId = s().addTask({ clientId, title: 'Gone' })
    s().deleteTask(taskId)
    expect(s().tasks.find((t) => t.id === taskId)).toBeUndefined()
  })
})

describe('subtasks', () => {
  /** A parent with two open subtasks. */
  const withSubtasks = () => {
    const clientId = s().addClient({ name: 'C' })
    const parentId = s().addTask({ clientId, title: 'Parent' })
    const a = s().addTask({ clientId, parentTaskId: parentId, title: 'Step 1' })
    const b = s().addTask({ clientId, parentTaskId: parentId, title: 'Step 2' })
    return { clientId, parentId, a, b }
  }
  const status = (id: string) => s().tasks.find((t) => t.id === id)!.status

  it('blocks the parent from done until every subtask is done', () => {
    const { parentId, a, b } = withSubtasks()

    expect(s().setTaskStatus(parentId, 'done')).toBe(false)
    expect(status(parentId)).toBe('todo')

    s().setTaskStatus(a, 'done')
    expect(s().setTaskStatus(parentId, 'done')).toBe(false)

    s().setTaskStatus(b, 'done')
    expect(s().setTaskStatus(parentId, 'done')).toBe(true)
    expect(status(parentId)).toBe('done')
  })

  it('lets the parent move to any status other than done', () => {
    const { parentId } = withSubtasks()
    expect(s().setTaskStatus(parentId, 'in_progress')).toBe(true)
    expect(status(parentId)).toBe('in_progress')
  })

  it('archived subtasks stop gating the parent', () => {
    const { parentId, a, b } = withSubtasks()
    s().setTaskStatus(a, 'done')
    s().updateTask(b, { archived: true })
    expect(s().setTaskStatus(parentId, 'done')).toBe(true)
  })

  it('moveTask refuses a blocked parent and leaves it where it was', () => {
    const { parentId } = withSubtasks()
    const before = s().tasks.find((t) => t.id === parentId)!.position
    expect(s().moveTask(parentId, 'done', 0)).toBe(false)
    const after = s().tasks.find((t) => t.id === parentId)!
    expect(after.status).toBe('todo')
    expect(after.position).toBe(before)
  })

  it('reopens a done parent when new open work is added under it', () => {
    const clientId = s().addClient({ name: 'C' })
    const parentId = s().addTask({ clientId, title: 'Parent' })
    s().setTaskStatus(parentId, 'done')
    expect(status(parentId)).toBe('done')
    s().addTask({ clientId, parentTaskId: parentId, title: 'One more thing' })
    expect(status(parentId)).toBe('in_progress')
  })

  it('deletes subtasks along with their parent', () => {
    const { parentId, a, b } = withSubtasks()
    s().deleteTask(parentId)
    expect(s().tasks.find((t) => t.id === parentId)).toBeUndefined()
    expect(s().tasks.find((t) => t.id === a)).toBeUndefined()
    expect(s().tasks.find((t) => t.id === b)).toBeUndefined()
  })

  it('orders subtasks under their parent, not in the board column', () => {
    const { clientId, parentId, a, b } = withSubtasks()
    // Subtasks number from 0 within the parent…
    expect(s().tasks.find((t) => t.id === a)!.position).toBe(0)
    expect(s().tasks.find((t) => t.id === b)!.position).toBe(1)
    // …and the next board card ignores them: Parent took 0, this takes 1.
    const sibling = s().addTask({ clientId, title: 'Other card' })
    expect(s().tasks.find((t) => t.id === parentId)!.position).toBe(0)
    expect(s().tasks.find((t) => t.id === sibling)!.position).toBe(1)
  })
})

describe('kanban ordering (moveTask)', () => {
  const pos = (id: string) => s().tasks.find((t) => t.id === id)!.position
  /** Column of a client's board, in display order (mirrors Tasks.tsx sort). */
  const column = (clientId: string, status: TaskStatus) =>
    s()
      .tasks.filter((t) => t.clientId === clientId && t.status === status)
      .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt))
      .map((t) => t.id)
  /** Append index within the task's client board column (mirrors handleMove). */
  const appendAt = (clientId: string, status: TaskStatus, id: string) =>
    s().tasks.filter((t) => t.clientId === clientId && t.status === status && t.id !== id).length

  it('keeps orderings independent and gapless across two clients\' boards', () => {
    const a = s().addClient({ name: 'Client A' })
    const b = s().addClient({ name: 'Client B' })
    const a1 = s().addTask({ clientId: a, title: 'a1' })
    const a2 = s().addTask({ clientId: a, title: 'a2' })
    const a3 = s().addTask({ clientId: a, title: 'a3' })
    const b1 = s().addTask({ clientId: b, title: 'b1' })
    const b2 = s().addTask({ clientId: b, title: 'b2' })

    // New tasks number per client board column, not across clients
    expect([pos(a1), pos(a2), pos(a3)]).toEqual([0, 1, 2])
    expect([pos(b1), pos(b2)]).toEqual([0, 1])

    s().moveTask(a1, 'in_progress', appendAt(a, 'in_progress', a1))
    s().moveTask(a2, 'in_progress', appendAt(a, 'in_progress', a2))
    s().moveTask(b1, 'in_progress', appendAt(b, 'in_progress', b1))

    // Each client's in_progress column is ordered independently from 0
    expect(column(a, 'in_progress')).toEqual([a1, a2])
    expect([pos(a1), pos(a2)]).toEqual([0, 1])
    expect(column(b, 'in_progress')).toEqual([b1])
    expect(pos(b1)).toBe(0)

    // Source columns are renumbered gaplessly
    expect(column(a, 'todo')).toEqual([a3])
    expect(pos(a3)).toBe(0)
    expect(column(b, 'todo')).toEqual([b2])
    expect(pos(b2)).toBe(0)
  })

  it('reorders within a column and keeps positions gapless', () => {
    const c = s().addClient({ name: 'C' })
    const t1 = s().addTask({ clientId: c, title: 't1' })
    const t2 = s().addTask({ clientId: c, title: 't2' })
    const t3 = s().addTask({ clientId: c, title: 't3' })

    s().moveTask(t3, 'todo', 0) // drag t3 to the top
    expect(column(c, 'todo')).toEqual([t3, t1, t2])
    expect([pos(t3), pos(t1), pos(t2)]).toEqual([0, 1, 2])

    s().moveTask(t3, 'todo', 1) // then back down one slot
    expect(column(c, 'todo')).toEqual([t1, t3, t2])
    expect([pos(t1), pos(t3), pos(t2)]).toEqual([0, 1, 2])
  })

  it('clamps an out-of-range position to the end of the target column', () => {
    const c = s().addClient({ name: 'C' })
    const t1 = s().addTask({ clientId: c, title: 't1' })
    const t2 = s().addTask({ clientId: c, title: 't2' })

    s().moveTask(t1, 'blocked', 99)
    expect(pos(t1)).toBe(0)
    expect(s().tasks.find((t) => t.id === t1)!.status).toBe('blocked')
    expect(column(c, 'todo')).toEqual([t2])
    expect(pos(t2)).toBe(0)
  })
})

describe('automation', () => {
  it('sweepAutoArchive archives old done tasks past the cutoff', () => {
    const clientId = s().addClient({ name: 'C' })
    const taskId = s().addTask({ clientId, title: 'Old' })
    const old = new Date(Date.now() - 40 * 864e5).toISOString()
    useStore.setState((st) => ({
      tasks: st.tasks.map((t) =>
        t.id === taskId ? { ...t, status: 'done' as const, completedAt: old, archived: false } : t,
      ),
    }))
    s().sweepAutoArchive() // default window is 30 days
    expect(s().tasks.find((t) => t.id === taskId)!.archived).toBe(true)
  })

  it('checkDueReminders notifies the assignee of a task due today', () => {
    const clientId = s().addClient({ name: 'C' })
    const assigneeId = s().users[0].id
    const taskId = s().addTask({ clientId, title: 'Due today', assigneeId, dueDate: isoDate() })
    s().checkDueReminders()
    const notif = s().notifications.find((n) => n.type === 'due_reminder' && n.entityId === taskId)
    expect(notif).toBeTruthy()
  })
})
