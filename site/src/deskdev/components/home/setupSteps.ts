/**
 * The first-run setup guide on Home: which steps are done, and whether the
 * card shows at all. Pure, so the rules are tested without a store or a DOM
 * (setupSteps.test.ts). SetupGuide.tsx renders it.
 *
 * A step is done because of what the workspace holds, never because it was
 * clicked. The one exception is installing the app: a desktop browser cannot
 * tell whether the phone has it, so that step can also be ticked by hand.
 */

export type SetupStepId = 'client' | 'project' | 'team' | 'leads' | 'install'

/** What the guide needs to know about the workspace and this device. */
export interface SetupFacts {
  clients: number
  projects: number
  /** People who can sign in (deactivated accounts don't count). */
  activePeople: number
  /** People in the workspace's lead owner pool. */
  leadOwners: number
  /** This device is running the installed app. */
  installedHere: boolean
}

/** What this person has done with the guide on this device (localStorage). */
export interface GuideMemory {
  /** The guide has been shown to them at least once. */
  started?: boolean
  /** They hid it. */
  hidden?: boolean
  /** They ticked "Done" on the install step. */
  installDone?: boolean
  /** Every step was done and "You're set up" has been shown. */
  finished?: boolean
}

export interface SetupStep {
  id: SetupStepId
  label: string
  /** Where the step is done. */
  to: string
  done: boolean
}

export function setupSteps(facts: SetupFacts, memory: GuideMemory = {}): SetupStep[] {
  return [
    { id: 'client', label: 'Add your first client', to: '/clients', done: facts.clients > 0 },
    { id: 'project', label: 'Create a project', to: '/projects', done: facts.projects > 0 },
    { id: 'team', label: 'Invite your team', to: '/settings?section=users', done: facts.activePeople > 1 },
    {
      id: 'leads',
      label: 'Choose who answers new leads',
      to: '/settings?section=growth',
      done: facts.leadOwners > 0,
    },
    {
      id: 'install',
      label: 'Install DeskDev on your phone',
      to: '/install',
      done: facts.installedHere || memory.installDone === true,
    },
  ]
}

/** "2 of 5" */
export function setupProgress(steps: SetupStep[]): string {
  return `${steps.filter((s) => s.done).length} of ${steps.length}`
}

/** A workspace that is already in use: it has clients, projects and more than one person. */
export function isEstablished(facts: SetupFacts): boolean {
  return facts.clients > 0 && facts.projects > 0 && facts.activePeople > 1
}

export type GuideView = 'none' | 'steps' | 'done'

/**
 * What Home shows.
 *
 * - Admins only.
 * - Never after it was hidden, or after it finished.
 * - Never in a workspace that was already in use when this person first could
 *   have seen it (an existing studio does not get a setup card). Once the
 *   guide has started for them it stays through the remaining steps.
 * - Every step done: 'done' once (the caller records `finished`), then never.
 */
export function guideView(admin: boolean, facts: SetupFacts, memory: GuideMemory): GuideView {
  if (!admin || memory.hidden || memory.finished) return 'none'
  const allDone = setupSteps(facts, memory).every((s) => s.done)
  if (!memory.started) return allDone || isEstablished(facts) ? 'none' : 'steps'
  return allDone ? 'done' : 'steps'
}

/** Reads a stored memory; anything unreadable is an empty one. */
export function parseGuideMemory(raw: string | null | undefined): GuideMemory {
  if (!raw) return {}
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return {}
    const v = value as Record<string, unknown>
    return {
      ...(v.started === true && { started: true }),
      ...(v.hidden === true && { hidden: true }),
      ...(v.installDone === true && { installDone: true }),
      ...(v.finished === true && { finished: true }),
    }
  } catch {
    return {}
  }
}

/** Per person, on this device. */
export function guideStorageKey(userId: string): string {
  return `deskdev:setup-guide:${userId}`
}
