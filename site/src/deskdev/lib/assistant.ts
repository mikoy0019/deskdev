import type { Client, EventItem, Lead, Priority, Project, Task, TaskStatus, User } from './types'

/**
 * The DeskDev Assistant (revision 10): a chat that answers questions about
 * the workspace's own data and does small jobs — with no language model, so
 * nothing is paid for and nothing leaves DeskDev. It is a set of plain
 * rules: recognise what was asked, look it up in the data the person may
 * see, and say so. A request to change something never runs here: it comes
 * back as a proposal the person reviews and confirms (pages/Assistant.tsx).
 */

export type Feature = 'tasks' | 'projects' | 'clients' | 'growth' | 'meetings'
export type Can = (feature: Feature, level: 'view' | 'edit') => boolean

export interface AssistantData {
  me: User | null
  users: User[]
  clients: Client[]
  projects: Project[]
  tasks: Task[]
  leads: Lead[]
  events: EventItem[]
  /** YYYY-MM-DD, the person's local date. */
  today: string
}

export interface AnswerItem {
  id: string
  label: string
  detail?: string
  /** An in-app path to open it. */
  to?: string
}

export type ProposedAction =
  | {
      kind: 'create_task'
      title: string
      clientId: string
      projectId?: string
      assigneeId?: string
      dueDate?: string
      priority?: Priority
    }
  | { kind: 'update_task'; taskId: string; patch: { status?: TaskStatus; assigneeId?: string; dueDate?: string; priority?: Priority } }
  | { kind: 'create_client'; name: string }

export interface AssistantReply {
  text: string
  items?: AnswerItem[]
  /** A change waiting for the person's yes: what will happen, line by line. */
  review?: { title: string; lines: { label: string; value: string }[]; action: ProposedAction }
  suggestions?: string[]
}

export const STARTERS = [
  'What’s on my plate today?',
  'Overdue tasks',
  'Projects due this week',
  'Meetings this week',
  'New leads',
  'Create a task',
]

// ─── Text helpers ────────────────────────────────────────────────────────────

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** Words that name nothing on their own ("the auth flow task"). */
const FILLER = new Set(['the', 'a', 'an', 'of', 'for', 'my', 'our', 'to', 'on', 'in', 'at', 'task', 'project', 'client', 'please'])
const words = (s: string) => norm(s).split(' ').filter((w) => w && !FILLER.has(w)).join(' ')

/** How well `query` names `name`, 0–100. */
export function nameScore(query: string, name: string): number {
  const q = words(query) || norm(query)
  const n = words(name) || norm(name)
  if (!q || !n) return 0
  if (q === n) return 100
  if (n.startsWith(q) || q.startsWith(n)) return 85
  if (n.includes(q) || q.includes(n)) return 70
  const qt = q.split(' ').filter((w) => w.length > 1)
  const nt = new Set(n.split(' '))
  if (qt.length === 0) return 0
  const hit = qt.filter((w) => nt.has(w) || [...nt].some((t) => t.startsWith(w))).length
  return Math.round((hit / qt.length) * 60)
}

type Match<T> = { one: T } | { many: T[] } | { none: true }

/** The thing a phrase names, if one stands out. */
function pick<T>(query: string, rows: T[], nameOf: (r: T) => string): Match<T> {
  const scored = rows
    .map((r) => ({ r, s: nameScore(query, nameOf(r)) }))
    .filter((x) => x.s >= 50)
    .sort((a, b) => b.s - a.s)
  if (scored.length === 0) return { none: true }
  if (scored.length === 1 || scored[0].s - scored[1].s >= 15) return { one: scored[0].r }
  return { many: scored.slice(0, 4).map((x) => x.r) }
}

// ─── Dates ───────────────────────────────────────────────────────────────────

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

const toDay = (iso: string) => new Date(`${iso}T00:00:00Z`)
const fromDay = (d: Date) => d.toISOString().slice(0, 10)
export const addDays = (iso: string, n: number) => fromDay(new Date(toDay(iso).getTime() + n * 86_400_000))

/** A day named in plain words — today, Friday, next Monday, in 3 days, 2026-10-20, Oct 20 — or null. */
export function parseDay(text: string, today: string): string | null {
  const t = text.toLowerCase().trim().replace(/[.,]$/, '')
  if (/^today$|^tonight$|^eod$/.test(t)) return today
  if (/^tomorrow$|^tmr$/.test(t)) return addDays(today, 1)
  if (/^yesterday$/.test(t)) return addDays(today, -1)
  const inN = /^in (\d{1,3}) (day|days|week|weeks)$/.exec(t)
  if (inN) return addDays(today, Number(inN[1]) * (inN[2].startsWith('week') ? 7 : 1))
  if (/^next week$/.test(t)) return addDays(today, 7)
  const wd = /^(next |this )?(sun|mon|tue|wed|thu|fri|sat)[a-z]*$/.exec(t)
  if (wd) {
    // "Friday" is the coming one (a week on, said on a Friday); "next Friday"
    // is the one in the following week.
    const target = WEEKDAYS.findIndex((d) => d.startsWith(wd[2]))
    const ahead = ((target - toDay(today).getUTCDay() + 7) % 7) || 7
    return addDays(today, wd[1] === 'next ' && ahead < 7 ? ahead + 7 : ahead)
  }
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
  if (iso) return fromDay(new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3])))
  const mdy = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(t)
  if (mdy) {
    const y = mdy[3] ? (mdy[3].length === 2 ? 2000 + +mdy[3] : +mdy[3]) : +today.slice(0, 4)
    return fromDay(new Date(Date.UTC(y, +mdy[1] - 1, +mdy[2])))
  }
  const named = /^(?:(\d{1,2}) ([a-z]{3})[a-z]*|([a-z]{3})[a-z]* (\d{1,2}))(?:,? (\d{4}))?$/.exec(t)
  if (named) {
    const mon = MONTHS.indexOf((named[2] ?? named[3]).slice(0, 3))
    const day = +(named[1] ?? named[4])
    if (mon >= 0) return fromDay(new Date(Date.UTC(named[5] ? +named[5] : +today.slice(0, 4), mon, day)))
  }
  return null
}

const fmtDay = (iso: string, today: string): string => {
  if (iso === today) return 'today'
  if (iso === addDays(today, 1)) return 'tomorrow'
  if (iso === addDays(today, -1)) return 'yesterday'
  const d = toDay(iso)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** Monday-to-Sunday week of `today`. */
const weekOf = (today: string) => {
  const dow = (toDay(today).getUTCDay() + 6) % 7
  const start = addDays(today, -dow)
  return { start, end: addDays(start, 6) }
}

// ─── Labels ──────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<TaskStatus, string> = { todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', done: 'Done' }
const PRIORITY_LABEL: Record<Priority, string> = { low: 'Low', med: 'Medium', high: 'High' }
const STAGE_LABEL: Record<Lead['stage'], string> = { new: 'New', contacted: 'Contacted', proposal: 'Proposal', won: 'Won', lost: 'Lost' }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// ─── The rules ───────────────────────────────────────────────────────────────

export function respond(input: string, data: AssistantData, can: Can): AssistantReply {
  const text = input.trim()
  const q = text.toLowerCase()
  if (!text) return help()

  const userName = (id?: string) => data.users.find((u) => u.id === id)?.fullName
  const clientName = (id?: string) => data.clients.find((c) => c.id === id)?.name
  const openTasks = data.tasks.filter((t) => !t.archived && !t.parentTaskId && t.status !== 'done')
  const taskItem = (t: Task): AnswerItem => ({
    id: t.id,
    label: t.title,
    detail: [
      STATUS_LABEL[t.status],
      t.dueDate ? `due ${fmtDay(t.dueDate, data.today)}` : undefined,
      userName(t.assigneeId),
      data.projects.find((p) => p.id === t.projectId)?.title ?? clientName(t.clientId),
    ].filter(Boolean).join(' · '),
    to: `/tasks?task=${t.id}`,
  })
  const listTasks = (rows: Task[], heading: string, empty: string): AssistantReply => {
    if (!can('tasks', 'view')) return noAccess('tasks')
    const sorted = [...rows].sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
    if (sorted.length === 0) return { text: empty }
    return { text: `${heading} (${sorted.length}):`, items: sorted.slice(0, 12).map(taskItem), suggestions: sorted.length > 12 ? ['Open the task board'] : undefined }
  }

  if (/^(help|\?|what can you do|commands|hi|hello|hey)\b/.test(q)) return help()
  if (/^open the task board$/.test(q)) return { text: 'Here is the board.', items: [{ id: 'board', label: 'Task board', to: '/tasks' }] }

  // ── Changes: always a proposal to review ──────────────────────────────────
  const createTask = /^(?:please\s+)?(?:create|add|new|make|log)\s+(?:a\s+|an\s+)?(?:new\s+)?task\b[:\s]*(.*)$/i.exec(text)
  if (createTask) return proposeTask(createTask[1], data, can)

  const createClient = /^(?:please\s+)?(?:create|add|new)\s+(?:a\s+)?client\b[:\s]*(.*)$/i.exec(text)
  if (createClient) {
    if (!can('clients', 'edit')) return noEdit('clients')
    const name = createClient[1].replace(/^(called|named)\s+/i, '').replace(/^["“](.*)["”]$/, '$1').trim()
    if (!name) return { text: 'What is the client called? For example: “add client Northwind Digital”.' }
    const same = data.clients.find((c) => norm(c.name) === norm(name))
    if (same) return { text: `${same.name} is already a client.`, items: [{ id: same.id, label: same.name, to: `/clients/${same.id}` }] }
    return { text: 'Here is what I’ll do. Confirm to go ahead.', review: { title: 'Add a client', lines: [{ label: 'Name', value: name }], action: { kind: 'create_client', name } } }
  }

  const assign = /^(?:please\s+)?(?:assign|give|hand)\s+(.+?)\s+to\s+(.+)$/i.exec(text)
  if (assign) return proposeUpdate(assign[1], data, can, (t) => {
    const who = resolvePerson(assign[2], data)
    if ('ask' in who) return who.ask
    return { patch: { assigneeId: who.user.id }, lines: [{ label: 'Assignee', value: `${userName(t.assigneeId) ?? 'Unassigned'} → ${who.user.fullName}` }] }
  })

  const due = /^(?:please\s+)?(?:set|change|move|push)\s+(?:the\s+)?(?:due\s*(?:date)?|deadline)\s+(?:of|for|on)\s+(.+?)\s+to\s+(.+)$/i.exec(text)
    ?? /^(?:please\s+)?(?:set|move|push)\s+(.+?)\s+(?:due|deadline)\s+(?:to\s+)?(.+)$/i.exec(text)
  if (due) return proposeUpdate(due[1], data, can, (t) => {
    const day = parseDay(due[2], data.today)
    if (!day) return { text: `I couldn’t read “${due[2]}” as a date. Try “Friday”, “in 3 days” or “2026-10-20”.` }
    return { patch: { dueDate: day }, lines: [{ label: 'Due date', value: `${t.dueDate ? fmtDay(t.dueDate, data.today) : 'none'} → ${fmtDay(day, data.today)}` }] }
  })

  const status =
    /^(?:please\s+)?(?:mark|set|move)\s+(.+?)\s+(?:as\s+|to\s+)?(done|complete|completed|finished|in progress|started|blocked|to ?do|open)$/i.exec(text)
  const verb = /^(?:please\s+)?(complete|finish|close|start|begin|block|reopen)\s+(?:the\s+)?(?:task\s+)?(.+)$/i.exec(text)
  if (status || verb) {
    const word = (status ? status[2] : verb![1]).toLowerCase()
    const target: TaskStatus = /done|complete|finish|close/.test(word) ? 'done' : /progress|start|begin/.test(word) ? 'in_progress' : /block/.test(word) ? 'blocked' : 'todo'
    return proposeUpdate(status ? status[1] : verb![2], data, can, (t) => {
      if (t.status === target) return { text: `“${t.title}” is already ${STATUS_LABEL[target].toLowerCase()}.` }
      return { patch: { status: target }, lines: [{ label: 'Status', value: `${STATUS_LABEL[t.status]} → ${STATUS_LABEL[target]}` }] }
    })
  }

  // ── Questions ─────────────────────────────────────────────────────────────
  const me = data.me
  const mine = (t: Task) => !!me && (t.assigneeId === me.id || (t.collaboratorIds ?? []).includes(me.id))

  if (/\b(overdue|late|past due|behind)\b/.test(q) && !/\blead/.test(q)) {
    const rows = openTasks.filter((t) => t.dueDate && t.dueDate < data.today && (!/\b(my|mine|me)\b/.test(q) || mine(t)))
    return listTasks(rows, 'Overdue tasks', 'Nothing is overdue. Nice.')
  }
  if (/\bblocked\b/.test(q)) return listTasks(openTasks.filter((t) => t.status === 'blocked'), 'Blocked tasks', 'No task is blocked.')

  if (/\bprojects?\b/.test(q) || /\b(status of|how is|how's|hows)\b/.test(q)) {
    if (!can('projects', 'view')) return noAccess('projects')
    const about = /(?:status of|how is|how's|hows|project)\s+(?:the\s+)?(.+?)\??$/i.exec(text)
    if (about && !/\b(projects|due|this week|launched|active|all)\b/i.test(about[1])) {
      const p = pick(about[1], data.projects, (x) => x.title)
      if ('one' in p) return projectStatus(p.one, data)
      if ('many' in p) return { text: 'Which project?', suggestions: p.many.map((x) => `Status of ${x.title}`) }
    }
    let rows = data.projects.filter((p) => p.status !== 'done')
    let heading = 'Active projects'
    if (/\blaunched|done|finished\b/.test(q)) {
      rows = data.projects.filter((p) => p.status === 'done')
      heading = 'Launched projects'
    } else if (/\b(due|deadline)\b|this week/.test(q)) {
      const w = weekOf(data.today)
      rows = rows.filter((p) => p.dueDate && p.dueDate <= w.end)
      heading = 'Projects due this week or earlier'
    }
    if (rows.length === 0) return { text: `No ${heading.toLowerCase()}.` }
    return {
      text: `${heading} (${rows.length}):`,
      items: rows.slice(0, 12).map((p) => ({
        id: p.id,
        label: p.title,
        detail: [clientName(p.clientId), p.dueDate ? `due ${fmtDay(p.dueDate, data.today)}` : undefined, userName(p.assigneeId)].filter(Boolean).join(' · '),
        to: `/projects/${p.id}`,
      })),
    }
  }

  const wantsMine = /\b(my|mine|i have|for me|on my plate|should i|assigned to me)\b/.test(q)
  if (/\b(task|tasks|todo|to-dos|work|working|plate|due)\b/.test(q) || wantsMine) {
    const when = /\btomorrow\b/.test(q) ? 'tomorrow' : /\bthis week\b|\bweek\b/.test(q) ? 'week' : /\btoday\b/.test(q) ? 'today' : null
    const forWhom = /(?:what is|what's|whats)\s+(.+?)\s+working on/i.exec(text) ?? /\btasks?\s+(?:of|for|assigned to)\s+(.+)$/i.exec(text)
    let rows = openTasks
    let heading = 'Open tasks'
    if (forWhom) {
      const person = resolvePerson(forWhom[1], data)
      const place = 'user' in person ? null : resolveWorkPlace(forWhom[1], data)
      if ('user' in person) {
        rows = rows.filter((t) => t.assigneeId === person.user.id || (t.collaboratorIds ?? []).includes(person.user.id))
        heading = `${person.user.fullName}’s open tasks`
      } else if (place && 'project' in place) {
        rows = rows.filter((t) => t.projectId === place.project.id)
        heading = `Open tasks in ${place.project.title}`
      } else if (place && 'client' in place) {
        rows = rows.filter((t) => t.clientId === place.client.id)
        heading = `Open tasks for ${place.client.name}`
      } else {
        return person.ask
      }
    } else if (wantsMine) {
      if (!me) return { text: 'Sign in first, then I can tell you what’s yours.' }
      rows = rows.filter(mine)
      heading = 'Your open tasks'
    }
    if (when === 'today') {
      rows = rows.filter((t) => t.dueDate && t.dueDate <= data.today)
      heading += ' due today or earlier'
    } else if (when === 'tomorrow') {
      rows = rows.filter((t) => t.dueDate === addDays(data.today, 1))
      heading += ' due tomorrow'
    } else if (when === 'week') {
      const w = weekOf(data.today)
      rows = rows.filter((t) => t.dueDate && t.dueDate <= w.end)
      heading += ' due this week'
    }
    return listTasks(rows, heading, wantsMine ? 'Nothing open is yours for that. Want to pick something up?' : 'No open tasks match that.')
  }

  if (/\bleads?\b/.test(q)) {
    if (!can('growth', 'view')) return noAccess('leads')
    const live = data.leads.filter((l) => !l.spam && l.stage !== 'won' && l.stage !== 'lost')
    let rows = live
    let heading = 'Open leads'
    if (/\bnew\b/.test(q)) {
      rows = live.filter((l) => l.stage === 'new')
      heading = 'New leads'
    } else if (/follow|due|overdue/.test(q)) {
      rows = live.filter((l) => l.followUp && l.followUp <= data.today)
      heading = 'Leads due a follow-up'
    } else if (/\bhot\b/.test(q)) {
      rows = live.filter((l) => l.hot)
      heading = 'Hot leads'
    }
    if (rows.length === 0) return { text: `No ${heading.toLowerCase()} right now.` }
    return {
      text: `${heading} (${rows.length}):`,
      items: rows.slice(0, 12).map((l) => ({
        id: l.id,
        label: l.company ? `${l.name} — ${l.company}` : l.name,
        detail: [STAGE_LABEL[l.stage], l.followUp ? `follow up ${fmtDay(l.followUp, data.today)}` : undefined, userName(l.ownerId)].filter(Boolean).join(' · '),
        to: `/growth/leads?lead=${l.id}`,
      })),
    }
  }

  if (/\b(meeting|meetings|call|calls|calendar|schedule)\b/.test(q)) {
    if (!can('meetings', 'view')) return noAccess('meetings')
    const w = weekOf(data.today)
    const range = /\btomorrow\b/.test(q) ? [addDays(data.today, 1), addDays(data.today, 1)] : /\btoday\b/.test(q) ? [data.today, data.today] : [data.today, w.end]
    const label = /\btomorrow\b/.test(q) ? 'tomorrow' : /\btoday\b/.test(q) ? 'today' : 'this week'
    const rows = data.events
      .filter((e) => e.kind === 'meeting' && e.startsAt.slice(0, 10) >= range[0] && e.startsAt.slice(0, 10) <= range[1])
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    if (rows.length === 0) return { text: `No meetings ${label}.` }
    return {
      text: `Meetings ${label} (${rows.length}):`,
      items: rows.map((e) => ({
        id: e.id,
        label: e.title,
        detail: [fmtDay(e.startsAt.slice(0, 10), data.today), new Date(e.startsAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }), clientName(e.clientId)].filter(Boolean).join(' · '),
        to: '/meetings',
      })),
    }
  }

  if (/\bclients?\b/.test(q)) {
    if (!can('clients', 'view')) return noAccess('clients')
    const about = /client\s+(.+?)\??$/i.exec(text)
    if (about && !/^(list|all|count)$/i.test(about[1])) {
      const c = pick(about[1], data.clients, (x) => x.name)
      if ('one' in c) {
        const open = openTasks.filter((t) => t.clientId === c.one.id).length
        const active = data.projects.filter((p) => p.clientId === c.one.id && p.status !== 'done').length
        return { text: `${c.one.name}: ${plural(active, 'active project')}, ${plural(open, 'open task')}.`, items: [{ id: c.one.id, label: c.one.name, to: `/clients/${c.one.id}` }] }
      }
    }
    const active = data.clients.filter((c) => c.status !== 'ended')
    return { text: `You have ${plural(active.length, 'active client')} (${data.clients.length} in all).`, items: active.slice(0, 12).map((c) => ({ id: c.id, label: c.name, to: `/clients/${c.id}` })) }
  }

  if (/\b(summary|overview|brief|today|what's up|whats up|status|how are we|dashboard)\b/.test(q)) return summary(data, can, mine)

  return {
    text: 'I didn’t catch that. I answer questions about tasks, projects, leads, meetings and clients, and I can create or update tasks — always asking you first.',
    suggestions: STARTERS,
  }
}

function help(): AssistantReply {
  return {
    text:
      'I’m the DeskDev Assistant. I read your workspace and answer from it — no AI service, nothing leaves DeskDev. Ask things like “my tasks this week”, “overdue tasks”, “status of the portal redesign”, “new leads” or “meetings tomorrow”. I can also create a task, assign one, move it to done or change its due date: I show you exactly what will change and wait for your OK.',
    suggestions: STARTERS,
  }
}

const noAccess = (what: string): AssistantReply => ({ text: `You don’t have access to ${what}, so I can’t look that up for you.` })
const noEdit = (what: string): AssistantReply => ({ text: `You can’t change ${what} with your access. An admin can give you edit rights.` })

type Person = { user: User } | { ask: AssistantReply }

function resolvePerson(phrase: string, data: AssistantData): Person {
  const raw = phrase.replace(/^@/, '').trim()
  if (/^(me|myself|i)$/i.test(raw) && data.me) return { user: data.me }
  const people = data.users.filter((u) => !u.deactivatedAt)
  const m = pick(raw, people, (u) => u.fullName)
  if ('one' in m) return { user: m.one }
  if ('many' in m) return { ask: { text: `Who do you mean: ${m.many.map((u) => u.fullName).join(', ')}?` } }
  return { ask: { text: `I don’t know anyone called “${raw}” here.` } }
}

function resolveWorkPlace(phrase: string, data: AssistantData): { project: Project } | { client: Client } | null {
  const p = pick(phrase, data.projects, (x) => x.title)
  if ('one' in p) return { project: p.one }
  const c = pick(phrase, data.clients, (x) => x.name)
  if ('one' in c) return { client: c.one }
  return null
}

function resolveTask(phrase: string, data: AssistantData): { task: Task } | { ask: AssistantReply } {
  const clean = phrase.replace(/^(the\s+)?task\s+/i, '').replace(/^["“](.*)["”]$/, '$1').trim()
  const live = data.tasks.filter((t) => !t.archived)
  const m = pick(clean, live, (t) => t.title)
  if ('one' in m) return { task: m.one }
  if ('many' in m) return { ask: { text: 'Which task do you mean?', items: m.many.map((t) => ({ id: t.id, label: t.title, to: `/tasks?task=${t.id}` })) } }
  return { ask: { text: `I couldn’t find a task called “${clean}”.` } }
}

type UpdatePlan = { patch: { status?: TaskStatus; assigneeId?: string; dueDate?: string; priority?: Priority }; lines: { label: string; value: string }[] } | AssistantReply

function proposeUpdate(phrase: string, data: AssistantData, can: Can, plan: (t: Task) => UpdatePlan): AssistantReply {
  if (!can('tasks', 'edit')) return noEdit('tasks')
  const found = resolveTask(phrase, data)
  if ('ask' in found) return found.ask
  const result = plan(found.task)
  if (!('patch' in result)) return result
  return {
    text: 'Here is what I’ll change. Confirm to go ahead.',
    review: {
      title: `Update “${found.task.title}”`,
      lines: result.lines,
      action: { kind: 'update_task', taskId: found.task.id, patch: result.patch },
    },
  }
}

/** "create a task Fix the footer for Northwind due Friday assign to Alex priority high" */
function proposeTask(rest: string, data: AssistantData, can: Can): AssistantReply {
  if (!can('tasks', 'edit')) return noEdit('tasks')
  let s = ` ${rest.trim()} `
  const take = (re: RegExp): string | undefined => {
    const m = re.exec(s)
    if (!m) return undefined
    s = s.replace(m[0], ' ')
    return (m.slice(1).find((g) => g !== undefined) ?? '').trim()
  }
  const priorityWord = take(/\s(?:priority\s+(high|medium|med|low)|(high|low)\s+priority|(urgent))\s/i)
  const priority: Priority | undefined = priorityWord
    ? /high|urgent/i.test(priorityWord) ? 'high' : /low/i.test(priorityWord) ? 'low' : 'med'
    : /\s(urgent)\s/i.test(rest) ? 'high' : undefined
  const assigneePhrase = take(/\s(?:assign(?:ed)?\s+to|for\s+@)\s*([^,]+?)(?=\s(?:due|by|for|priority)\s|\s*$)/i)
  const duePhrase = take(/\s(?:due|by)\s+(in\s+\d{1,3}\s+(?:days?|weeks?)|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{1,2}\s+[a-z]{3,9}|next\s+[a-z]+|[a-z]{3,9}\s+\d{1,2}(?!\d)|[a-z]+)(?=\s|$)/i)
  const forPhrase = take(/\s(?:for|on|in|under)\s+([^,]+?)(?=\s(?:due|by|assign|priority)\s|\s*$)/i)
  const title = s.replace(/^\s*[:\-–]\s*/, '').replace(/^["“](.*)["”]$/, '$1').replace(/\s+/g, ' ').trim()
  if (!title) {
    return { text: 'What should the task be? For example: “create a task Update the pricing page for Northwind due Friday”.' }
  }

  let clientId: string | undefined
  let projectId: string | undefined
  if (forPhrase) {
    const place = resolveWorkPlace(forPhrase, data)
    if (place && 'project' in place) {
      projectId = place.project.id
      clientId = place.project.clientId
    } else if (place && 'client' in place) {
      clientId = place.client.id
    } else {
      return { text: `I couldn’t find a project or client called “${forPhrase}”. Which one is it for?`, suggestions: data.clients.slice(0, 4).map((c) => `create a task ${title} for ${c.name}`) }
    }
  } else if (data.clients.length === 1) {
    clientId = data.clients[0].id
  }
  if (!clientId) {
    return { text: 'Which client or project is it for?', suggestions: data.clients.slice(0, 4).map((c) => `create a task ${title} for ${c.name}`) }
  }

  let assigneeId: string | undefined
  if (assigneePhrase) {
    const who = resolvePerson(assigneePhrase, data)
    if ('ask' in who) return who.ask
    assigneeId = who.user.id
  }
  let dueDate: string | undefined
  if (duePhrase) {
    const day = parseDay(duePhrase, data.today)
    if (!day) return { text: `I couldn’t read “${duePhrase}” as a date. Try “Friday”, “in 3 days” or “2026-10-20”.` }
    dueDate = day
  }

  const project = data.projects.find((p) => p.id === projectId)
  const client = data.clients.find((c) => c.id === clientId)
  const lines = [
    { label: 'Title', value: title },
    { label: project ? 'Project' : 'Client', value: project ? `${project.title} (${client?.name ?? 'client'})` : client?.name ?? '—' },
    { label: 'Assignee', value: assigneeId ? data.users.find((u) => u.id === assigneeId)?.fullName ?? '—' : 'Unassigned' },
    { label: 'Due', value: dueDate ? fmtDay(dueDate, data.today) : 'No date' },
    { label: 'Priority', value: PRIORITY_LABEL[priority ?? 'med'] },
  ]
  return {
    text: 'Here is the task I’ll create. Confirm to go ahead.',
    review: { title: 'Create a task', lines, action: { kind: 'create_task', title, clientId, projectId, assigneeId, dueDate, priority } },
  }
}

function projectStatus(p: Project, data: AssistantData): AssistantReply {
  const tasks = data.tasks.filter((t) => t.projectId === p.id && !t.archived && !t.parentTaskId)
  const done = tasks.filter((t) => t.status === 'done').length
  const blocked = tasks.filter((t) => t.status === 'blocked').length
  const overdue = tasks.filter((t) => t.status !== 'done' && t.dueDate && t.dueDate < data.today).length
  const statusWord = { backlog: 'in the backlog', planning: 'in planning', in_progress: 'in progress', waiting: 'waiting', done: 'launched' }[p.status]
  const parts = [
    `${p.title} is ${statusWord}`,
    p.dueDate ? `due ${fmtDay(p.dueDate, data.today)}` : undefined,
    tasks.length ? `${done} of ${tasks.length} tasks done` : 'no tasks yet',
    blocked ? `${blocked} blocked` : undefined,
    overdue ? `${overdue} overdue` : undefined,
  ].filter(Boolean)
  return { text: `${parts.join(', ')}.`, items: [{ id: p.id, label: p.title, to: `/projects/${p.id}` }] }
}

function summary(data: AssistantData, can: Can, mine: (t: Task) => boolean): AssistantReply {
  const lines: string[] = []
  const open = data.tasks.filter((t) => !t.archived && !t.parentTaskId && t.status !== 'done')
  if (can('tasks', 'view')) {
    const yours = open.filter(mine)
    const dueToday = yours.filter((t) => t.dueDate && t.dueDate <= data.today).length
    const overdue = open.filter((t) => t.dueDate && t.dueDate < data.today).length
    lines.push(`${plural(yours.length, 'open task')} for you${dueToday ? `, ${dueToday} due today or earlier` : ''}.`)
    if (overdue) lines.push(`${plural(overdue, 'task')} overdue across the team.`)
    const blocked = open.filter((t) => t.status === 'blocked').length
    if (blocked) lines.push(`${plural(blocked, 'task')} blocked.`)
  }
  if (can('meetings', 'view')) {
    const today = data.events.filter((e) => e.kind === 'meeting' && e.startsAt.slice(0, 10) === data.today).length
    lines.push(today ? `${plural(today, 'meeting')} today.` : 'No meetings today.')
  }
  if (can('growth', 'view')) {
    const fresh = data.leads.filter((l) => !l.spam && l.stage === 'new').length
    const follow = data.leads.filter((l) => !l.spam && l.stage !== 'won' && l.stage !== 'lost' && l.followUp && l.followUp <= data.today).length
    if (fresh || follow) lines.push(`${plural(fresh, 'new lead')}${follow ? `, ${follow} due a follow-up` : ''}.`)
  }
  if (can('projects', 'view')) {
    const w = weekOf(data.today)
    const dueWeek = data.projects.filter((p) => p.status !== 'done' && p.dueDate && p.dueDate <= w.end).length
    if (dueWeek) lines.push(`${plural(dueWeek, 'project')} due this week.`)
  }
  return { text: lines.length ? lines.join(' ') : 'There’s nothing I can show you yet.', suggestions: ['My tasks today', 'Overdue tasks', 'Meetings today'] }
}
