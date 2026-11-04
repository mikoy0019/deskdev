import type { Project, ProjectPhase, ProjectStatus } from './types'

// A project's life (046): onboarding → development → launched. `phase` is the
// stage; `status` stays the kanban column of the work inside it. Launching is
// what drafts the portfolio entry (037's showcase_on_project fires on status
// 'done' with a live URL).

export const PHASES: readonly ProjectPhase[] = ['onboarding', 'development', 'launched']

export const PHASE_LABEL: Record<ProjectPhase, string> = {
  onboarding: 'Onboarding',
  development: 'Development',
  launched: 'Launched',
}

/**
 * The stage, also for rows from a database without 046 (no `phase`): a done
 * project counts as launched, anything else as in development — never as
 * onboarding, which would send finished work back to the start.
 */
export function phaseOf(project: Pick<Project, 'phase' | 'status'>): ProjectPhase {
  return project.phase ?? (project.status === 'done' ? 'launched' : 'development')
}

/** Where the work column goes when a project enters a stage. */
export function statusOnEntering(phase: ProjectPhase, current: ProjectStatus): ProjectStatus {
  if (phase === 'launched') return 'done'
  if (phase === 'development') {
    // Starting (or reopening) the build: anything not yet underway is now.
    return current === 'backlog' || current === 'planning' || current === 'done' ? 'in_progress' : current
  }
  // Back to onboarding: the build hasn't started.
  return current === 'done' || current === 'in_progress' ? 'planning' : current
}

const STATUSES: readonly ProjectStatus[] = ['backlog', 'planning', 'in_progress', 'waiting', 'done']

/**
 * Why a project can't take this work status, or null when it can. Done is
 * what launching sets and only reopening clears, so a status change alone
 * never splits the two: a plain move to Done left projects "Onboarding" and
 * "Done" at once, with no live URL asked for.
 */
export function statusConflict(project: Pick<Project, 'phase' | 'status'>, status: ProjectStatus): string | null {
  const launched = phaseOf(project) === 'launched'
  if (status === 'done' && !launched) return 'A project is done when it launches. Use "Development done" on the project page.'
  if (status !== 'done' && launched) return 'This project has launched. Use "Reopen development" on the project page first.'
  return null
}

/** The work statuses a project can be moved to in its current stage. */
export function statusesFor(project: Pick<Project, 'phase' | 'status'>): ProjectStatus[] {
  return STATUSES.filter((s) => statusConflict(project, s) === null)
}
