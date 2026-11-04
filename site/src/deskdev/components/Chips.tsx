import type {
  ProjectPhase, ProjectStatus, TaskStatus, Priority, Engagement, ClientStatus, Role,
} from '../lib/types'
import { classNames } from '../lib/format'
import { PHASE_LABEL } from '../lib/projectPhase'

// Status has one shape everywhere: the 6px `.badge` (LANGUAGE.md). Pills
// (`.chip`) are for tags and filters — client, category, engagement.
// The colours are the foundation badge palette: /15 fill, /30 border, and a
// dark text tone in light (700, or 800 for the pale hues amber / emerald / rose /
// teal) and 400 in dark, so every badge clears WCAG AA (4.5:1) on its own tint
// over both the card and the page.
// Neutral states fall back to ink tokens — never raw slate/gray.

// ─── Project status ──────────────────────────────────────────────────────────

const projectStatusStyles: Record<ProjectStatus, string> = {
  backlog: 'bg-ink-700 text-ink-200 border-ink-600',
  planning: 'bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/30',
  in_progress: 'bg-brand-500/15 text-brand-700 dark:text-brand-400 border-brand-500/30',
  waiting: 'bg-amber-500/15 text-amber-800 dark:text-amber-400 border-amber-500/30',
  done: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-400 border-emerald-500/30',
}

const projectStatusLabels: Record<ProjectStatus, string> = {
  backlog: 'Backlog',
  planning: 'Planning',
  in_progress: 'In Progress',
  waiting: 'Waiting',
  done: 'Done',
}

export function StatusChip({ status }: { status: ProjectStatus }) {
  return (
    <span className={classNames('badge shrink-0 whitespace-nowrap', projectStatusStyles[status])}>
      {projectStatusLabels[status]}
    </span>
  )
}

// ─── Project stage (046) ─────────────────────────────────────────────────────

const projectPhaseStyles: Record<ProjectPhase, string> = {
  onboarding: 'bg-amber-500/15 text-amber-800 dark:text-amber-400 border-amber-500/30',
  development: 'bg-brand-500/15 text-brand-700 dark:text-brand-400 border-brand-500/30',
  launched: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-400 border-emerald-500/30',
}

/** Pass phaseOf(project), not project.phase (rows from before 046 have none). */
export function PhaseChip({ phase, className }: { phase: ProjectPhase; className?: string }) {
  return (
    <span className={classNames('chip shrink-0 whitespace-nowrap', projectPhaseStyles[phase], className)}>
      {PHASE_LABEL[phase]}
    </span>
  )
}

// ─── Task status ─────────────────────────────────────────────────────────────

const taskStatusStyles: Record<TaskStatus, string> = {
  todo: 'bg-ink-700 text-ink-200 border-ink-600',
  in_progress: 'bg-brand-500/15 text-brand-700 dark:text-brand-400 border-brand-500/30',
  blocked: 'bg-rose-500/15 text-rose-800 dark:text-rose-400 border-rose-500/30',
  done: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-400 border-emerald-500/30',
}

const taskStatusLabels: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  done: 'Done',
}

export function TaskStatusChip({ status }: { status: TaskStatus }) {
  return (
    <span className={classNames('badge shrink-0 whitespace-nowrap', taskStatusStyles[status])}>
      {taskStatusLabels[status]}
    </span>
  )
}

// ─── Priority ────────────────────────────────────────────────────────────────

const priorityStyles: Record<Priority, string> = {
  low: 'bg-ink-700 text-ink-200 border-ink-600',
  med: 'bg-amber-500/15 text-amber-800 dark:text-amber-400 border-amber-500/30',
  high: 'bg-rose-500/15 text-rose-800 dark:text-rose-400 border-rose-500/30',
}

export function PriorityChip({ priority }: { priority: Priority }) {
  return (
    <span className={classNames('badge shrink-0 whitespace-nowrap uppercase text-[11px] tracking-wide', priorityStyles[priority])}>
      {priority}
    </span>
  )
}

// ─── Client engagement ───────────────────────────────────────────────────────

const engagementStyles: Record<Engagement, string> = {
  full_time: 'bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/30',
  part_time: 'bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-500/30',
  gig_on_call: 'bg-amber-500/15 text-amber-800 dark:text-amber-400 border-amber-500/30',
}

const engagementLabels: Record<Engagement, string> = {
  full_time: 'Full Time',
  part_time: 'Part Time',
  gig_on_call: 'Gig — On Call',
}

export function EngagementChip({ engagement }: { engagement: Engagement }) {
  return (
    <span className={classNames('chip shrink-0 whitespace-nowrap', engagementStyles[engagement])}>
      {engagementLabels[engagement]}
    </span>
  )
}

// ─── Client status ───────────────────────────────────────────────────────────

const clientStatusStyles: Record<ClientStatus, string> = {
  active: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-400 border-emerald-500/30',
  paused: 'bg-amber-500/15 text-amber-800 dark:text-amber-400 border-amber-500/30',
  ended: 'bg-ink-700 text-ink-200 border-ink-600',
}

export function ClientStatusChip({ status }: { status: ClientStatus }) {
  return (
    <span className={classNames('badge shrink-0 whitespace-nowrap capitalize', clientStatusStyles[status])}>
      {status}
    </span>
  )
}

// ─── Role ────────────────────────────────────────────────────────────────────

const roleStyles: Record<Role, string> = {
  admin: 'bg-brand-500/15 text-brand-700 dark:text-brand-400 border-brand-500/30',
  member: 'bg-teal-500/15 text-teal-800 dark:text-teal-400 border-teal-500/30',
}

export function RoleChip({ role }: { role: Role }) {
  return (
    <span className={classNames('badge shrink-0 whitespace-nowrap capitalize', roleStyles[role])}>{role}</span>
  )
}
