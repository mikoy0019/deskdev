/**
 * Subtask rules — one place so the store guard, the board and the modal all
 * agree on what "blocked by subtasks" means.
 *
 * A subtask is an ordinary task row carrying `parentTaskId`. Subtasks are one
 * level deep (a subtask never has subtasks of its own) and they gate their
 * parent: it cannot be marked done while any unarchived subtask is still open.
 * Archiving a subtask takes it out of the gate — that is the escape hatch for
 * work that turned out not to be needed.
 */
import type { Task } from './types'

/** Display order for a subtask list — insertion order, oldest first. */
const byOrder = (a: Task, b: Task): number =>
  a.position - b.position || a.createdAt.localeCompare(b.createdAt)

/** Every subtask of `parentId`, archived ones included, in display order. */
export function subtasksOf(tasks: Task[], parentId: string): Task[] {
  return tasks.filter((t) => t.parentTaskId === parentId).sort(byOrder)
}

/** The unarchived, not-yet-done subtasks that block `parentId` from 'done'. */
export function openSubtasks(tasks: Task[], parentId: string): Task[] {
  return subtasksOf(tasks, parentId).filter(
    (t) => t.status !== 'done' && !t.archived,
  )
}

/**
 * Completion progress over the subtasks that count (archived ones don't).
 * `total` is 0 when the task has no subtasks — the caller's cue to render
 * nothing at all.
 */
export function subtaskProgress(
  tasks: Task[],
  parentId: string,
): { done: number; total: number } {
  const counted = subtasksOf(tasks, parentId).filter((t) => !t.archived)
  return {
    done: counted.filter((t) => t.status === 'done').length,
    total: counted.length,
  }
}

/** True when `parentId` may be moved to 'done' right now. */
export const canCompleteTask = (tasks: Task[], parentId: string): boolean =>
  openSubtasks(tasks, parentId).length === 0

/** User-facing reason a task can't be completed yet. */
export function blockedBySubtasksMessage(tasks: Task[], parentId: string): string {
  const open = openSubtasks(tasks, parentId)
  return open.length === 1
    ? `Finish the subtask "${open[0].title}" first`
    : `Finish all ${open.length} subtasks first`
}

/**
 * A task's collaborator list as the database keeps it (054): each person
 * once, in the order added, never the assignee.
 */
export function cleanCollaborators(ids: readonly string[] | undefined, assigneeId?: string): string[] {
  return [...new Set((ids ?? []).filter((id) => id && id !== assigneeId))]
}

/** Everyone on a task: the assignee first, then the collaborators. */
export function taskPeople(task: Pick<Task, 'assigneeId' | 'collaboratorIds'>): string[] {
  return cleanCollaborators([...(task.assigneeId ? [task.assigneeId] : []), ...(task.collaboratorIds ?? [])])
}
