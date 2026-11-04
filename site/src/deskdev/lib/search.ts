import {
  BriefcaseIcon, CalendarBlankIcon, CheckSquareIcon, type Icon, TableIcon, UsersIcon,
} from '@phosphor-icons/react'
import type { Client, Project, Task, EventItem, CrmTable } from './types'
import { fmtDateTime } from './format'

/**
 * Live entity search over the workspace records (clients, projects, tasks,
 * events, CRM tables). Extracted from the old Topbar search box so the command
 * palette can surface records alongside its Navigate/Create/Preferences actions
 * — one search surface instead of two.
 */

export type Hit = {
  kind: 'client' | 'project' | 'task' | 'event' | 'crm'
  id: string
  title: string
  sub?: string
  to: string
}

export const HIT_ICONS: Record<Hit['kind'], Icon> = {
  client: UsersIcon,
  project: BriefcaseIcon,
  task: CheckSquareIcon,
  event: CalendarBlankIcon,
  crm: TableIcon,
}

export interface SearchSources {
  clients: Client[]
  projects: Project[]
  tasks: Task[]
  events: EventItem[]
  crmTables: CrmTable[]
}

/** Case-insensitive substring search; caps at 12 hits (records-first ordering). */
export function searchEntities(query: string, s: SearchSources): Hit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const out: Hit[] = []

  for (const c of s.clients) {
    if (
      c.name.toLowerCase().includes(q) ||
      c.company?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q)
    ) {
      out.push({ kind: 'client', id: c.id, title: c.name, sub: c.company ?? c.email, to: `/clients/${c.id}` })
    }
  }
  for (const p of s.projects) {
    if (p.title.toLowerCase().includes(q) || p.notes?.toLowerCase().includes(q)) {
      const client = s.clients.find((c) => c.id === p.clientId)
      out.push({
        kind: 'project',
        id: p.id,
        title: p.title,
        sub: client ? `${client.name} · ${p.status.replace('_', ' ')}` : p.status.replace('_', ' '),
        to: `/projects/${p.id}`,
      })
    }
  }
  for (const t of s.tasks) {
    if (t.archived) continue
    if (t.title.toLowerCase().includes(q)) {
      const project = t.projectId ? s.projects.find((p) => p.id === t.projectId) : null
      // Subtasks aren't on the board, so name the parent they live under.
      const parent = t.parentTaskId ? s.tasks.find((p) => p.id === t.parentTaskId) : null
      const sub = parent
        ? `Subtask of ${parent.title}`
        : project
          ? `Task in ${project.title}`
          : 'Task'
      // ?task= opens the task itself (a subtask too), not the whole board.
      out.push({ kind: 'task', id: t.id, title: t.title, sub, to: `/tasks?task=${t.id}` })
    }
  }
  for (const e of s.events) {
    if (e.title.toLowerCase().includes(q) || e.description?.toLowerCase().includes(q)) {
      out.push({
        kind: 'event',
        id: e.id,
        title: e.title,
        sub: `${e.kind === 'meeting' ? 'Meeting' : 'Event'} · ${fmtDateTime(e.startsAt)}`,
        // ?event= names the record for the page to open.
        to: `${e.kind === 'meeting' ? '/meetings' : '/calendar'}?event=${e.id}`,
      })
    }
  }
  for (const t of s.crmTables) {
    if (t.name.toLowerCase().includes(q)) {
      out.push({ kind: 'crm', id: t.id, title: t.name, sub: 'CRM table', to: `/crm/${t.id}` })
    }
  }
  return out.slice(0, 12)
}
