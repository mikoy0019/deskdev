import { isDeactivated } from '../lib/permissions'
import type { Client, ClientCategory, Project, ProjectCategory, Task, User } from '../lib/types'

type Directory = {
  clients: Client[]; clientCategories: ClientCategory[]; projects: Project[]
  projectCategories: ProjectCategory[]; tasks: Task[]; users: User[]
}

export function validateClient(row: Pick<Client, 'name' | 'email' | 'categoryId'>, state: Directory): void {
  if (!row.name.trim()) throw new Error('Client name is required.')
  if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email.trim())) throw new Error('Enter a valid email address.')
  if (row.categoryId && !state.clientCategories.some((c) => c.id === row.categoryId)) throw new Error('Choose an existing category.')
}

export function validateWork(row: Pick<Task, 'title' | 'clientId' | 'categoryId' | 'assigneeId' | 'dueDate'>, state: Directory, previous?: { assigneeId?: string }): void {
  if (!row.title.trim()) throw new Error('Title is required.')
  if (!state.clients.some((c) => c.id === row.clientId)) throw new Error('Choose an existing client.')
  if (row.categoryId && !state.projectCategories.some((c) => c.id === row.categoryId && c.clientId === row.clientId)) {
    throw new Error('Choose a category belonging to this client.')
  }
  if (row.assigneeId && row.assigneeId !== previous?.assigneeId && !state.users.some((u) => u.id === row.assigneeId && !isDeactivated(u))) {
    throw new Error('Choose an active teammate.')
  }
  if (row.dueDate && !validDate(row.dueDate)) throw new Error('Choose a valid due date.')
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function validateProject(row: Pick<Project, 'title' | 'clientId' | 'categoryId' | 'assigneeId' | 'dueDate' | 'startDate' | 'budget'>, state: Directory, previous?: Project): void {
  validateWork(row, state, previous)
  if (row.startDate && !validDate(row.startDate)) throw new Error('Choose a valid start date.')
  if (row.startDate && row.dueDate && row.dueDate < row.startDate) throw new Error('Due date must be on or after the start date.')
  if (row.budget !== undefined && (!Number.isFinite(row.budget) || row.budget < 0)) throw new Error('Budget must be zero or more.')
  if (previous && row.clientId !== previous.clientId && state.tasks.some((t) => t.projectId === previous.id)) {
    throw new Error('Move or detach this project’s tasks before changing its client.')
  }
}

export const MAX_COLLABORATORS = 20

export function validateTask(row: Pick<Task, 'title' | 'clientId' | 'categoryId' | 'assigneeId' | 'dueDate' | 'projectId' | 'parentTaskId' | 'collaboratorIds' | 'coverUrl'>, state: Directory, previous?: Task): void {
  validateWork(row, state, previous)
  if (row.coverUrl && (!/^https:\/\/[^\s]+$/i.test(row.coverUrl) || row.coverUrl.length > 2048)) throw new Error('Use an HTTPS image URL up to 2048 characters.')
  const collaborators = row.collaboratorIds ?? []
  if (collaborators.length > MAX_COLLABORATORS) throw new Error(`A task can have at most ${MAX_COLLABORATORS} collaborators.`)
  // Someone already on the task stays even if deactivated since; new names must be active.
  const held = new Set(previous?.collaboratorIds ?? [])
  if (collaborators.some((id) => !held.has(id) && !state.users.some((u) => u.id === id && !isDeactivated(u)))) {
    throw new Error('Choose active teammates as collaborators.')
  }
  if (row.projectId && !state.projects.some((p) => p.id === row.projectId && p.clientId === row.clientId)) {
    throw new Error('Choose a project belonging to this client.')
  }
  if (row.parentTaskId) {
    const parent = state.tasks.find((t) => t.id === row.parentTaskId)
    if (!parent || parent.parentTaskId || parent.id === previous?.id) throw new Error('Choose a top-level parent task.')
    if (parent.clientId !== row.clientId || parent.projectId !== row.projectId) throw new Error('A subtask must use its parent’s client and project.')
  }
  if (previous && state.tasks.some((t) => t.parentTaskId === previous.id) &&
    (row.parentTaskId || row.clientId !== previous.clientId || row.projectId !== previous.projectId)) {
    throw new Error('Move or remove this task’s subtasks before changing its client or project.')
  }
}
