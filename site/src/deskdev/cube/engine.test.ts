import { describe, expect, it } from 'vitest'
import { emptyEngagementTerms } from '../lib/engagements'
import type { Lead, Project, ProjectEngagement, Task, User } from '../lib/types'
import { cubeDate, cubeDecisionHref, evaluateCube, type CubeSnapshot } from './engine'
import { cubeJournalKey, cubeReviewState, emptyCubeJournal, parseCubeJournal, reviewCubeDecision } from './journal'

const admin: User = { id: 'admin', fullName: 'Admin', role: 'admin', permissions: {}, createdAt: '2026-01-01' }
const member: User = { ...admin, id: 'member', role: 'member', permissions: { tasks: 'view', projects: 'edit' } }
const lead: Lead = { id: 'lead', name: 'Prospect', stage: 'new', source: 'website', value: 0, hot: false, ownerId: admin.id, followUp: '2026-10-08', createdAt: '2026-10-01', updatedAt: '2026-10-01' }
const task: Task = { id: 'task', clientId: 'client', title: 'Blocked work', status: 'blocked', priority: 'med', dueDate: '2026-10-07', assigneeId: admin.id, position: 0, archived: false, createdAt: '2026-10-01', updatedAt: '2026-10-01' }
const project: Project = { id: 'project', clientId: 'client', title: 'Client project', status: 'planning', position: 0, createdAt: '2026-10-01', updatedAt: '2026-10-01' }
const engagement: ProjectEngagement = { id: 'engagement', projectId: project.id, version: 1, terms: emptyEngagementTerms(), createdAt: '2026-10-01', updatedAt: '2026-10-01' }
const snapshot = (patch: Partial<CubeSnapshot> = {}): CubeSnapshot => ({ user: admin, users: [admin, member], leads: [lead], tasks: [task], projects: [project], projectEngagements: [engagement], unavailable: [], now: '2026-10-08T02:00:00.000Z', timezone: 'Asia/Manila', ...patch })

describe('Cube operational decisions', () => {
  it('evaluates three playbooks without modifying the snapshot', () => {
    const input = snapshot()
    const before = structuredClone(input)
    expect(evaluateCube(input).map((decision) => decision.playbookId).sort()).toEqual(['blocked-task', 'engagement-readiness', 'lead-followup'])
    expect(input).toEqual(before)
  })

  it('uses the business date at timezone boundaries and handles an invalid timezone', () => {
    expect(cubeDate('2026-10-07T17:00:00Z', 'Asia/Manila')).toBe('2026-10-08')
    expect(evaluateCube(snapshot({ now: '2026-10-07T17:00:00Z' })).find((decision) => decision.entityType === 'lead')).toBeDefined()
    expect(() => cubeDate('2026-10-07', 'invalid')).toThrow()
  })

  it('does not expose Growth or financial decisions to a member without those rights', () => {
    expect(evaluateCube(snapshot({ user: member })).map((decision) => decision.entityType)).toEqual(['task'])
    expect(evaluateCube(snapshot({ user: null }))).toEqual([])
    expect(evaluateCube(snapshot({ user: { ...admin, deactivatedAt: '2026-10-01' } }))).toEqual([])
  })

  it('excludes failed source pulls and does not infer missing engagements', () => {
    expect(evaluateCube(snapshot({ unavailable: ['leads', 'tasks', 'projectEngagements'] }))).toEqual([])
    expect(evaluateCube(snapshot({ projectEngagements: [] })).some((decision) => decision.entityType === 'engagement')).toBe(false)
  })

  it('does not assign a known-missing owner when user records are unavailable', () => {
    const decisions = evaluateCube(snapshot({ unavailable: ['users'], leads: [{ ...lead, ownerId: undefined, followUp: undefined }] }))
    expect(decisions.some((decision) => decision.entityType === 'lead')).toBe(false)
    expect(decisions.find((decision) => decision.entityType === 'task')?.ownerLabel).toBe('Owner data unavailable')
  })

  it('ignores closed or quarantined leads and archived or completed tasks', () => {
    expect(evaluateCube(snapshot({ leads: [{ ...lead, spam: true }, { ...lead, id: 'won', stage: 'won' }, { ...lead, id: 'lost', stage: 'lost' }], tasks: [{ ...task, archived: true }, { ...task, id: 'done', status: 'done' }], projectEngagements: [] }))).toEqual([])
  })

  it('groups lead exceptions and considers inactive owners unavailable', () => {
    const decision = evaluateCube(snapshot({ users: [{ ...admin, deactivatedAt: '2026-10-01' }], leads: [{ ...lead, slaDueAt: '2026-10-07T00:00:00Z' }] })).find((item) => item.entityType === 'lead')!
    expect(decision.reasonCodes).toEqual(['lead_owner_missing', 'lead_followup_due', 'lead_reply_overdue'])
    expect(decision.severity).toBe('urgent')
    expect(decision.ownerId).toBeUndefined()
  })

  it('invalid dates do not trigger overdue rules', () => {
    const result = evaluateCube(snapshot({ leads: [{ ...lead, followUp: '2026-02-30', slaDueAt: 'invalid' }], tasks: [{ ...task, dueDate: 'invalid' }] }))
    expect(result.some((decision) => decision.entityType === 'lead')).toBe(false)
    expect(result.find((decision) => decision.entityType === 'task')?.severity).toBe('attention')
  })

  it('checks the existing deposit gate and permits explicitly agreed zero deposits', () => {
    const accepted = { ...engagement, terms: { ...engagement.terms, scope: 'Website', acceptedOn: '2026-10-01', acceptanceEvidence: 'Signed contract', feeMinor: 10000, depositMinor: 2500 } }
    const blocked = evaluateCube(snapshot({ projectEngagements: [accepted] })).find((decision) => decision.entityType === 'engagement')!
    expect(blocked.nextAction).toContain('deposit')
    const ready = evaluateCube(snapshot({ projectEngagements: [{ ...accepted, terms: { ...accepted.terms, depositMinor: 0 } }] })).find((decision) => decision.entityType === 'engagement')!
    expect(ready.reasonCodes).toEqual(['engagement_kickoff_ready'])
    expect(cubeDecisionHref(ready)).toBe('/projects/project')
  })

  it('does not recommend kickoff for active engagements or done projects', () => {
    expect(evaluateCube(snapshot({ projectEngagements: [{ ...engagement, terms: { ...engagement.terms, phase: 'active' } }] })).some((decision) => decision.entityType === 'engagement')).toBe(false)
    expect(evaluateCube(snapshot({ projects: [{ ...project, status: 'done' }] })).some((decision) => decision.entityType === 'engagement')).toBe(false)
  })
})

describe('Cube personal review lifecycle', () => {
  const now = '2026-10-08T02:00:00.000Z'
  const current = () => evaluateCube(snapshot())
  const proposal = () => current().find((decision) => decision.entityType === 'task')!

  it('acknowledges once, reopens, and does not complete source work', () => {
    const input = snapshot()
    const decision = proposal()
    const acknowledged = reviewCubeDecision(emptyCubeJournal(), decision, evaluateCube(input), admin, 'acknowledged', now)
    expect(cubeReviewState(acknowledged, decision, now)).toBe('acknowledged')
    expect(reviewCubeDecision(acknowledged, decision, current(), admin, 'acknowledged', now)).toBe(acknowledged)
    expect(cubeReviewState(reviewCubeDecision(acknowledged, decision, current(), admin, 'reopened', now), decision, now)).toBe('pending')
    expect(input.tasks[0].status).toBe('blocked')
  })

  it('rejects changed, removed, unauthorized, or paused recommendations', () => {
    const decision = proposal()
    const changed = evaluateCube(snapshot({ tasks: [{ ...task, notes: 'New blocker' }] }))
    expect(() => reviewCubeDecision(emptyCubeJournal(), decision, changed, admin, 'acknowledged', now)).toThrow('changed')
    expect(() => reviewCubeDecision(emptyCubeJournal(), decision, [], admin, 'acknowledged', now)).toThrow('changed')
    expect(() => reviewCubeDecision(emptyCubeJournal(), decision, current(), member, 'acknowledged', now)).toThrow('edit permission')
    expect(() => reviewCubeDecision({ ...emptyCubeJournal(), paused: ['blocked-task'] }, decision, current(), admin, 'acknowledged', now)).toThrow('Resume')
  })

  it('expires snoozes and reopens changed evidence immediately', () => {
    const decision = proposal()
    const journal = reviewCubeDecision(emptyCubeJournal(), decision, current(), admin, 'snoozed', now)
    expect(cubeReviewState(journal, decision, '2026-10-09T01:59:59Z')).toBe('snoozed')
    expect(cubeReviewState(journal, decision, '2026-10-09T02:00:00Z')).toBe('pending')
    const changed = evaluateCube(snapshot({ tasks: [{ ...task, notes: 'Changed' }] })).find((item) => item.entityType === 'task')!
    expect(cubeReviewState(journal, changed, now)).toBe('pending')
  })

  it('persists identifiers without copied evidence and isolates accounts', () => {
    const decision = proposal()
    const journal = reviewCubeDecision(emptyCubeJournal(), decision, current(), admin, 'acknowledged', now)
    const raw = JSON.stringify(journal)
    expect(raw).not.toContain('Blocked work')
    expect(raw).not.toContain('Recorded notes')
    expect(parseCubeJournal(raw, admin.id)).toEqual(journal)
    expect(() => parseCubeJournal(raw, member.id)).toThrow()
    expect(() => parseCubeJournal('{', admin.id)).toThrow()
    expect(cubeJournalKey('local', admin.id)).not.toBe(cubeJournalKey('remote', admin.id))
  })
})
