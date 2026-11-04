import { describe, expect, it } from 'vitest'
import { nameScore, parseDay, respond, type AssistantData, type Can } from './assistant'
import type { Client, EventItem, Lead, Project, Task, User } from './types'

const TODAY = '2026-10-07' // a Wednesday

const user = (id: string, fullName: string, extra: Partial<User> = {}): User =>
  ({ id, fullName, email: `${id}@x.test`, role: 'member', permissions: {}, ...extra }) as User
const task = (id: string, title: string, extra: Partial<Task> = {}): Task =>
  ({ id, title, clientId: 'c-nw', status: 'todo', priority: 'med', position: 0, archived: false, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', ...extra }) as Task

const data: AssistantData = {
  me: user('u-me', 'Maykie', { role: 'admin' }),
  users: [user('u-me', 'Maykie', { role: 'admin' }), user('u-alex', 'Alex Cruz'), user('u-old', 'Gone Person', { deactivatedAt: '2026-01-01T00:00:00Z' })],
  clients: [
    { id: 'c-nw', name: 'Northwind Digital', status: 'active' } as Client,
    { id: 'c-bl', name: 'BrightLoop', status: 'active' } as Client,
  ],
  projects: [
    { id: 'p-portal', clientId: 'c-nw', title: 'Client portal redesign', status: 'in_progress', dueDate: '2026-10-09', assigneeId: 'u-alex' } as Project,
    { id: 'p-app', clientId: 'c-bl', title: 'iOS app v2', status: 'done' } as Project,
  ],
  tasks: [
    task('t-dash', 'Ship dashboard layout', { projectId: 'p-portal', assigneeId: 'u-me', dueDate: '2026-10-07', status: 'in_progress' }),
    task('t-auth', 'Wire up auth flow', { projectId: 'p-portal', assigneeId: 'u-alex', dueDate: '2026-10-05' }),
    task('t-crash', 'Fix crash on payment screen', { clientId: 'c-bl', status: 'blocked', assigneeId: 'u-alex', collaboratorIds: ['u-me'] }),
    task('t-done', 'Old work', { status: 'done', assigneeId: 'u-me' }),
  ],
  leads: [
    { id: 'l-1', name: 'Ana', company: 'Acme', stage: 'new', value: 0, source: 'website', hot: true } as Lead,
    { id: 'l-2', name: 'Ben', stage: 'contacted', value: 0, source: 'seo', hot: false, followUp: '2026-10-06' } as Lead,
    { id: 'l-3', name: 'Spam', stage: 'new', value: 0, source: 'other', hot: false, spam: true } as Lead,
  ],
  events: [
    { id: 'e-1', kind: 'meeting', title: 'Northwind weekly', clientId: 'c-nw', startsAt: '2026-10-07T09:00:00Z' } as EventItem,
    { id: 'e-2', kind: 'meeting', title: 'BrightLoop review', startsAt: '2026-10-08T10:00:00Z' } as EventItem,
  ],
  today: TODAY,
}
const all: Can = () => true
const viewOnly: Can = (_f, level) => level === 'view'
const none: Can = () => false
const ids = (r: ReturnType<typeof respond>) => (r.items ?? []).map((i) => i.id)

describe('dates', () => {
  it('reads plain words as days', () => {
    expect(parseDay('today', TODAY)).toBe('2026-10-07')
    expect(parseDay('tomorrow', TODAY)).toBe('2026-10-08')
    expect(parseDay('Friday', TODAY)).toBe('2026-10-09')
    expect(parseDay('next friday', TODAY)).toBe('2026-10-16')
    expect(parseDay('wednesday', TODAY)).toBe('2026-10-14')
    expect(parseDay('in 3 days', TODAY)).toBe('2026-10-10')
    expect(parseDay('in 2 weeks', TODAY)).toBe('2026-10-21')
    expect(parseDay('2026-11-02', TODAY)).toBe('2026-11-02')
    expect(parseDay('Oct 20', TODAY)).toBe('2026-10-20')
    expect(parseDay('20 october', TODAY)).toBe('2026-10-20')
    expect(parseDay('someday', TODAY)).toBeNull()
  })
})

describe('names', () => {
  it('scores exact, prefix, part and word matches', () => {
    expect(nameScore('Northwind Digital', 'Northwind Digital')).toBe(100)
    expect(nameScore('northwind', 'Northwind Digital')).toBeGreaterThanOrEqual(80)
    expect(nameScore('portal', 'Client portal redesign')).toBeGreaterThanOrEqual(50)
    expect(nameScore('zebra', 'Client portal redesign')).toBe(0)
  })
})

describe('questions', () => {
  it('my tasks today includes collaborations and leaves done work out', () => {
    expect(ids(respond('What’s on my plate today?', data, all))).toEqual(['t-dash'])
    expect(ids(respond('my tasks', data, all)).sort()).toEqual(['t-crash', 't-dash'])
  })

  it('overdue, blocked, and someone else’s work', () => {
    expect(ids(respond('overdue tasks', data, all))).toEqual(['t-auth'])
    expect(ids(respond('blocked', data, all))).toEqual(['t-crash'])
    expect(ids(respond('what is Alex working on?', data, all)).sort()).toEqual(['t-auth', 't-crash'])
    expect(ids(respond('tasks for the portal redesign', data, all)).sort()).toEqual(['t-auth', 't-dash'])
  })

  it('projects: due this week, launched, and one project’s status', () => {
    expect(ids(respond('projects due this week', data, all))).toEqual(['p-portal'])
    expect(ids(respond('launched projects', data, all))).toEqual(['p-app'])
    const status = respond('status of the client portal', data, all)
    expect(status.text).toMatch(/Client portal redesign is in progress, due Fri, Oct 9, 0 of 2 tasks done, 1 overdue/)
  })

  it('leads, meetings and clients', () => {
    expect(ids(respond('new leads', data, all))).toEqual(['l-1'])
    expect(ids(respond('leads to follow up', data, all))).toEqual(['l-2'])
    expect(ids(respond('meetings today', data, all))).toEqual(['e-1'])
    expect(ids(respond('meetings this week', data, all))).toEqual(['e-1', 'e-2'])
    expect(respond('client northwind', data, all).text).toMatch(/Northwind Digital: 1 active project, 2 open tasks/)
  })

  it('a summary, help, and a polite miss', () => {
    expect(respond('summary', data, all).text).toMatch(/2 open tasks for you, 1 due today or earlier/)
    expect(respond('help', data, all).suggestions?.length).toBeGreaterThan(0)
    expect(respond('sing me a song', data, all).text).toMatch(/didn’t catch that/)
  })

  it('only answers from what the person may see', () => {
    expect(respond('overdue tasks', data, none).text).toMatch(/don’t have access to tasks/)
    expect(respond('new leads', data, none).text).toMatch(/don’t have access to leads/)
  })
})

describe('changes are proposals to review', () => {
  it('creates a task with its project, assignee, due date and priority', () => {
    const r = respond('create a task Update pricing page for the portal redesign due Friday assign to Alex priority high', data, all)
    expect(r.review?.action).toEqual({
      kind: 'create_task', title: 'Update pricing page', clientId: 'c-nw', projectId: 'p-portal', assigneeId: 'u-alex', dueDate: '2026-10-09', priority: 'high',
    })
    expect(r.review?.lines.map((l) => l.label)).toEqual(['Title', 'Project', 'Assignee', 'Due', 'Priority'])
  })

  it('reads "due in 3 days" and asks which client when it can’t tell', () => {
    expect(respond('add task Call the printer for BrightLoop due in 3 days', data, all).review?.action).toMatchObject({ clientId: 'c-bl', dueDate: '2026-10-10' })
    expect(respond('create a task Plan the launch', data, all).review).toBeUndefined()
    expect(respond('create a task Plan the launch', data, all).text).toMatch(/Which client or project/)
  })

  it('assigns, completes, blocks and reschedules existing tasks', () => {
    expect(respond('assign the auth flow to me', data, all).review?.action).toEqual({ kind: 'update_task', taskId: 't-auth', patch: { assigneeId: 'u-me' } })
    expect(respond('mark ship dashboard layout as done', data, all).review?.action).toEqual({ kind: 'update_task', taskId: 't-dash', patch: { status: 'done' } })
    expect(respond('block wire up auth flow', data, all).review?.action).toMatchObject({ patch: { status: 'blocked' } })
    expect(respond('set the due date of auth flow to next monday', data, all).review?.action).toMatchObject({ patch: { dueDate: '2026-10-19' } })
    expect(respond('assign auth flow to Gone Person', data, all).review).toBeUndefined()
  })

  it('adds a client, but not one that already exists', () => {
    expect(respond('add client Casa Palma', data, all).review?.action).toEqual({ kind: 'create_client', name: 'Casa Palma' })
    expect(respond('add client northwind digital', data, all).review).toBeUndefined()
  })

  it('offers nothing to change without edit access', () => {
    expect(respond('create a task Anything for BrightLoop', data, viewOnly).text).toMatch(/can’t change tasks/)
    expect(respond('mark wire up auth flow as done', data, viewOnly).review).toBeUndefined()
  })
})
