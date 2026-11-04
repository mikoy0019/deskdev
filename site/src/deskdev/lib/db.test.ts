import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A fake Supabase client whose per-table latency the test controls, so a
// parent insert can be made deliberately slower than its child's.
const fake = vi.hoisted(() => {
  const state = {
    delay: {} as Record<string, number>,
    fail: new Set<string>(),
    committed: [] as string[],
  }
  const run = (table: string) =>
    new Promise<{ data: { id: string }[]; error: { message: string } | null }>((resolve) => {
      setTimeout(() => {
        if (state.fail.has(table)) {
          resolve({ data: [], error: { message: `${table} rejected` } })
          return
        }
        state.committed.push(table)
        resolve({ data: [{ id: 'row' }], error: null })
      }, state.delay[table] ?? 0)
    })
  return { state, run }
})

vi.mock('./supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
    from: (table: string) => ({
      insert: () => fake.run(table),
      update: () => ({ eq: () => ({ select: () => fake.run(table) }) }),
      delete: () => ({ eq: () => ({ select: () => fake.run(table) }) }),
    }),
  },
}))

import * as db from './db'

beforeEach(() => {
  fake.state.delay = {}
  fake.state.fail.clear()
  fake.state.committed = []
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  db.setWriteErrorHandler(null)
  vi.restoreAllMocks()
})

describe('db write ordering', () => {
  it('commits a parent row before the child that references it, even when the parent is slower', async () => {
    // This is the addTask shape: the task insert and its 'created' activity
    // insert are fired back-to-back. Unordered, the fast child lands first
    // and Postgres rejects it on task_activity_task_id_fkey.
    fake.state.delay = { tasks: 40, task_activity: 0 }
    await Promise.all([
      db.insert('tasks', { id: 't1', clientId: 'c1', title: 'Parent' }),
      db.insert('taskActivity', { id: 'a1', taskId: 't1', clientId: 'c1', action: 'created' }),
    ])
    expect(fake.state.committed).toEqual(['tasks', 'task_activity'])
  })

  it('keeps inserts, updates and deletes in issue order across tables', async () => {
    fake.state.delay = { leads: 30, lead_activity: 0, tasks: 10 }
    await Promise.all([
      db.insert('leads', { id: 'l1', name: 'Lead' }),
      db.insert('leadActivity', { id: 'la1', leadId: 'l1', action: 'created' }),
      db.update('tasks', 't1', { title: 'Renamed' }),
      db.remove('leadActivity', 'la1'),
    ])
    expect(fake.state.committed).toEqual(['leads', 'lead_activity', 'tasks', 'lead_activity'])
  })

  it('reports a failed write and still runs the writes queued behind it', async () => {
    const onError = vi.fn()
    db.setWriteErrorHandler(onError)
    fake.state.fail.add('tasks')
    await Promise.all([
      db.insert('tasks', { id: 't1', clientId: 'c1', title: 'Doomed' }),
      db.insert('taskActivity', { id: 'a1', taskId: 't1', clientId: 'c1', action: 'created' }),
    ])
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith({
      table: 'tasks',
      op: 'insert',
      message: 'tasks rejected',
    })
    expect(fake.state.committed).toEqual(['task_activity'])
  })
})
