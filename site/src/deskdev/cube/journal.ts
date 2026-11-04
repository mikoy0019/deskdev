import { CUBE_PLAYBOOKS, canReviewCubeDecision, type CubeDecision, type CubePlaybookId } from './engine'
import type { User } from '../lib/types'

export type CubeReviewAction = 'acknowledged' | 'snoozed' | 'reopened'
export interface CubeReview {
  id: string
  decisionId: string
  revision: string
  playbookId: CubePlaybookId
  actorId: string
  action: CubeReviewAction
  at: string
  until?: string
}
export interface CubeJournal {
  version: 1
  paused: CubePlaybookId[]
  reviews: CubeReview[]
}

export const emptyCubeJournal = (): CubeJournal => ({ version: 1, paused: [], reviews: [] })

/** A change marker, not an authorization token. Avoid saving business evidence in browser history. */
export function cubeRevision(decision: CubeDecision): string {
  let a = 2166136261
  let b = 5381
  for (const char of decision.fingerprint) {
    a = Math.imul(a ^ char.charCodeAt(0), 16777619)
    b = Math.imul(b, 33) ^ char.charCodeAt(0)
  }
  return `${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`
}

export function cubeJournalKey(mode: 'local' | 'remote', userId: string): string {
  return `deskdev-cube:v1:${mode}:${encodeURIComponent(userId)}`
}

const playbookId = (value: unknown): value is CubePlaybookId => CUBE_PLAYBOOKS.some((item) => item.id === value)
const validTime = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))

export function parseCubeJournal(raw: string | null, userId: string): CubeJournal {
  if (!raw) return emptyCubeJournal()
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object') throw new Error('Cube review history is invalid.')
  const item = value as Partial<CubeJournal>
  if (item.version !== 1 || !Array.isArray(item.paused) || !item.paused.every(playbookId) || !Array.isArray(item.reviews)) throw new Error('Cube review history is invalid.')
  const reviews: CubeReview[] = []
  for (const candidate of item.reviews.slice(-200)) {
    if (!candidate || typeof candidate !== 'object') throw new Error('Cube review history is invalid.')
    const row = candidate as CubeReview
    if (typeof row.id !== 'string' || typeof row.decisionId !== 'string' || typeof row.revision !== 'string' || !playbookId(row.playbookId) || row.actorId !== userId || !['acknowledged', 'snoozed', 'reopened'].includes(row.action) || !validTime(row.at) || (row.action === 'snoozed' && !validTime(row.until))) throw new Error('Cube review history is invalid.')
    reviews.push({ id: row.id, decisionId: row.decisionId, revision: row.revision, playbookId: row.playbookId, actorId: row.actorId, action: row.action, at: row.at, ...(row.action === 'snoozed' ? { until: row.until } : {}) })
  }
  return { version: 1, paused: [...new Set(item.paused)], reviews }
}

export function cubeReviewState(journal: CubeJournal, decision: CubeDecision, now: string): 'pending' | 'acknowledged' | 'snoozed' {
  const latest = [...journal.reviews].reverse().find((review) => review.decisionId === decision.id)
  if (!latest || latest.revision !== cubeRevision(decision)) return 'pending'
  if (latest.action === 'acknowledged') return 'acknowledged'
  if (latest.action === 'snoozed' && latest.until && Date.parse(latest.until) > Date.parse(now)) return 'snoozed'
  return 'pending'
}

/** Re-evaluate against the current snapshot before recording a review. A review never executes work. */
export function reviewCubeDecision(journal: CubeJournal, proposal: CubeDecision, current: CubeDecision[], user: User | null, action: CubeReviewAction, now: string): CubeJournal {
  const latest = current.find((decision) => decision.id === proposal.id)
  if (!latest || latest.fingerprint !== proposal.fingerprint) throw new Error('This recommendation changed. Review the current evidence and try again.')
  if (!user || !canReviewCubeDecision(user, latest)) throw new Error('You need edit permission to review this recommendation.')
  if (journal.paused.includes(latest.playbookId)) throw new Error('Resume this playbook before reviewing its recommendations.')
  if (!validTime(now)) throw new Error('Cube needs a valid review time.')
  const state = cubeReviewState(journal, latest, now)
  if ((action === 'acknowledged' && state === 'acknowledged') || (action === 'snoozed' && state === 'snoozed') || (action === 'reopened' && state === 'pending')) return journal
  const review: CubeReview = { id: crypto.randomUUID(), decisionId: latest.id, revision: cubeRevision(latest), playbookId: latest.playbookId, actorId: user.id, action, at: now,
    ...(action === 'snoozed' ? { until: new Date(Date.parse(now) + 24 * 60 * 60 * 1000).toISOString() } : {}) }
  return { ...journal, reviews: [...journal.reviews, review].slice(-200) }
}
