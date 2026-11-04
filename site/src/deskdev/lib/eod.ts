import type {
  Client, Task, TaskActivity, EventItem, TimeEntry, User,
} from './types'
import { fmtMinutes, fmtTime, fmtDate, isoDate } from './format'

// End-of-Day report engine. Produces a plaintext, copy-paste ready report
// for one client + one date. Section headers are stable; a section is
// skipped only when it has nothing to say.

export interface EodInput {
  client: Client
  /** YYYY-MM-DD */
  date: string
  tasks: Task[]
  activity: TaskActivity[]
  events: EventItem[]
  timeEntries: TimeEntry[]
  users: User[]
}

// ─── Date helpers ────────────────────────────────────────────────────────────

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return isoDate(new Date(y, m - 1, d + n))
}

function dayOfWeek(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}

/** Tomorrow, or the following Monday when tomorrow lands on a weekend. */
function nextBusinessDay(date: string): string {
  let next = addDays(date, 1)
  while (dayOfWeek(next) === 0 || dayOfWeek(next) === 6) next = addDays(next, 1)
  return next
}

// ─── Report builder ──────────────────────────────────────────────────────────

const PRIORITY_ORDER = { high: 0, med: 1, low: 2 } as const

export function buildEodReport(input: EodInput): string {
  const { client, date, users } = input

  const nameOf = (id?: string): string | undefined =>
    id ? users.find((u) => u.id === id)?.fullName : undefined

  /** Subtasks read as "Parent → Step", so a line like "Fix login" has context. */
  const taskLine = (t: Task): string => {
    const who = nameOf(t.assigneeId)
    const parent = t.parentTaskId
      ? input.tasks.find((x) => x.id === t.parentTaskId)?.title
      : undefined
    return `- ${parent ? `${parent} → ` : ''}${t.title}${who ? ` (${who})` : ''}`
  }

  const tasks = input.tasks.filter((t) => t.clientId === client.id)
  const activity = input.activity.filter(
    (a) => a.clientId === client.id && isoDate(a.createdAt) === date,
  )
  const meetings = input.events.filter(
    (e) => e.kind === 'meeting' && e.clientId === client.id,
  )
  const entries = input.timeEntries.filter(
    (e) => e.clientId === client.id && e.entryDate === date,
  )

  const sections: { header: string; lines: string[] }[] = []

  // COMPLETED TODAY — from completed_at, or completion activity that day
  const completedIds = new Set(
    activity.filter((a) => a.action === 'completed' && a.taskId).map((a) => a.taskId as string),
  )
  const completed = tasks.filter(
    (t) =>
      (t.completedAt && isoDate(t.completedAt) === date) || completedIds.has(t.id),
  )
  sections.push({ header: 'COMPLETED TODAY', lines: completed.map(taskLine) })

  // IN PROGRESS — with progress notes from that day's status_changed activity
  const inProgressLines: string[] = []
  for (const t of tasks.filter((x) => x.status === 'in_progress' && !x.archived)) {
    inProgressLines.push(taskLine(t))
    for (const a of activity.filter(
      (x) => x.taskId === t.id && x.action === 'status_changed',
    )) {
      const note = a.detail['note']
      const from = a.detail['from']
      const to = a.detail['to']
      if (typeof note === 'string' && note) inProgressLines.push(`  ${note}`)
      else if (typeof from === 'string' && typeof to === 'string')
        inProgressLines.push(`  moved ${from} -> ${to}`)
    }
  }
  sections.push({ header: 'IN PROGRESS', lines: inProgressLines })

  // BLOCKED / WAITING — reason comes from the task notes
  const blockedLines: string[] = []
  for (const t of tasks.filter((x) => x.status === 'blocked' && !x.archived)) {
    blockedLines.push(taskLine(t))
    if (t.notes) blockedLines.push(`  ${t.notes}`)
  }
  sections.push({ header: 'BLOCKED / WAITING', lines: blockedLines })

  // MEETINGS HELD — that day's meetings for the client, notes indented
  const heldLines: string[] = []
  for (const m of meetings.filter((x) => isoDate(x.startsAt) === date)) {
    heldLines.push(`- ${m.title} (${fmtTime(m.startsAt)})`)
    if (m.notes) {
      for (const line of m.notes.split('\n').filter(Boolean)) heldLines.push(`  ${line}`)
    }
  }
  sections.push({ header: 'MEETINGS HELD', lines: heldLines })

  // HOURS LOGGED — per task breakdown + total
  const hoursLines: string[] = []
  if (entries.length > 0) {
    const byLabel = new Map<string, number>()
    for (const e of entries) {
      const task = e.taskId ? tasks.find((t) => t.id === e.taskId) : undefined
      const label = task?.title ?? e.note ?? 'General'
      byLabel.set(label, (byLabel.get(label) ?? 0) + e.minutes)
    }
    for (const [label, mins] of byLabel) hoursLines.push(`- ${label}: ${fmtMinutes(mins)}`)
    const total = entries.reduce((sum, e) => sum + e.minutes, 0)
    hoursLines.push(`Total: ${fmtMinutes(total)}`)
  }
  sections.push({ header: 'HOURS LOGGED', lines: hoursLines })

  // TOMORROW'S PRIORITIES — open tasks due tomorrow (through the next
  // business day when tomorrow is a weekend), high priority first, plus
  // tomorrow's meetings
  const tomorrow = addDays(date, 1)
  const horizon = nextBusinessDay(date)
  const inWindow = (iso?: string): boolean => {
    if (!iso) return false
    const day = isoDate(iso)
    return day >= tomorrow && day <= horizon
  }
  const upcoming = tasks
    .filter((t) => t.status !== 'done' && !t.archived && inWindow(t.dueDate))
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
  const priorityLines = upcoming.map(taskLine)
  for (const m of meetings.filter((x) => inWindow(x.startsAt))) {
    priorityLines.push(`- Meeting: ${m.title} (${fmtTime(m.startsAt)})`)
  }
  sections.push({ header: "TOMORROW'S PRIORITIES", lines: priorityLines })

  // Assemble — skip empty sections, keep headers stable
  const out: string[] = [`END OF DAY REPORT — ${client.name} — ${fmtDate(date)}`]
  for (const section of sections) {
    if (section.lines.length === 0) continue
    out.push('', section.header, ...section.lines)
  }
  return out.join('\n')
}
