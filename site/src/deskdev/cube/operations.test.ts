import { describe, expect, it } from 'vitest'
import type { Project, Task, User } from '../lib/types'
import { emptyEngagementTerms } from '../lib/engagements'
import type { CubeSnapshot } from './engine'
import { emptyIntake, emptyOperations, evaluateOperations } from './operations'
import { intakeError, parseOperations } from './operationsApi'

const admin: User = { id: 'admin', fullName: 'Admin', role: 'admin', permissions: {}, createdAt: '2026-01-01' }
const project: Project = { id: 'project', clientId: 'client', title: 'Website', status: 'planning', assigneeId: admin.id, position: 0, createdAt: '2026-01-01', updatedAt: '2026-01-01' }
const task: Task = { id: 'task', clientId: 'client', projectId: project.id, title: 'Blocked task', status: 'blocked', priority: 'high', position: 0, archived: false, createdAt: '2026-01-01', updatedAt: '2026-01-01' }
const snapshot = (patch: Partial<CubeSnapshot> = {}): CubeSnapshot => ({ user: admin, users: [admin], projects: [project], tasks: [task], leads: [], projectEngagements: [], unavailable: [], now: '2026-10-08T02:00:00Z', timezone: 'Asia/Manila', ...patch })

describe('Cube automatic department operations', () => {
  it('automatically routes missing prerequisites and owners without changing business records', () => {
    const input = snapshot()
    const before = structuredClone(input)
    const state = evaluateOperations(input, emptyOperations())
    expect(state.teams).toHaveLength(7)
    expect(state.teams.every(t => t.ownerId === admin.id)).toBe(true)
    expect(state.work.map(w => w.department)).toEqual(expect.arrayContaining(['delivery','people','client_ops','finance']))
    expect(state.work.find(w => w.department === 'finance')?.instruction).toContain('Contract pending')
    expect(input).toEqual(before)
  })
  it('deduplicates repeated evaluation and resolves only conditions no longer present', () => {
    const first = evaluateOperations(snapshot(), emptyOperations())
    const second = evaluateOperations(snapshot(), first)
    expect(second.work.map(w => w.key)).toEqual(first.work.map(w => w.key))
    const closed = evaluateOperations(snapshot({ tasks: [{ ...task, status: 'done' }] }), second)
    expect(closed.work.find(w => w.key === 'delivery:task:task')?.status).toBe('resolved')
    expect(closed.work.find(w => w.key === 'finance:project:project')?.status).toBe('open')
  })
  it('preserves work when source pulls fail and when workspace execution is paused', () => {
    const first = evaluateOperations(snapshot(), emptyOperations())
    const missing = evaluateOperations(snapshot({ tasks: [], unavailable: ['tasks'] }), first)
    expect(missing.work).toEqual(first.work)
    expect(missing.error).toContain('unavailable')
    const paused = { ...first, enabled: false }
    expect(evaluateOperations(snapshot(), paused)).toBe(paused)
  })
  it('does not run under a member or deactivated admin', () => {
    const state = emptyOperations()
    expect(evaluateOperations(snapshot({ user: { ...admin, role: 'member' } }), state)).toBe(state)
    expect(evaluateOperations(snapshot({ user: { ...admin, deactivatedAt: '2026-10-01' } }), state)).toBe(state)
  })
  it('holds agreement-dependent handoffs until acceptance, deposit, intake and creative evidence are recorded', () => {
    const state = emptyOperations()
    state.intakes = [{ ...emptyIntake(project.id), version: 1, contractReference: 'Contract A1', briefConfirmed: true, assetsConfirmed: true, creativeRequired: true, evidence: 'Brief B1, assets A1' }]
    const engagement = { id: 'engagement', projectId: project.id, version: 1, terms: emptyEngagementTerms(), createdAt: '2026-01-01', updatedAt: '2026-01-01' }
    const noAcceptance = evaluateOperations(snapshot({ projectEngagements: [engagement] }), state)
    expect(noAcceptance.work.some(w => w.key === 'delivery:project:project')).toBe(false)
    const accepted = { ...engagement, terms: { ...engagement.terms, scope: 'Website', acceptedOn: '2026-01-01', acceptanceEvidence: 'Signed A1', depositMinor: 100, feeMinor: 100 } }
    expect(evaluateOperations(snapshot({ projectEngagements: [accepted] }), state).work.some(w => w.key === 'delivery:project:project')).toBe(false)
    state.intakes[0].creativeApproved = true
    const zeroDeposit = { ...accepted, terms: { ...accepted.terms, depositMinor: 0 } }
    expect(evaluateOperations(snapshot({ projectEngagements: [zeroDeposit] }), state).work.some(w => w.key === 'delivery:project:project')).toBe(true)
  })
  it('escalates an urgent unresolved item after 24 hours without duplicating escalation', () => {
    const first = evaluateOperations(snapshot(), emptyOperations())
    const next = evaluateOperations(snapshot({ now: '2026-10-09T02:00:00Z' }), first)
    expect(next.work.filter(w => w.department === 'leadership' && w.status === 'open')).toHaveLength(1)
    expect(evaluateOperations(snapshot({ now: '2026-10-09T02:00:00Z' }), next).work.filter(w => w.department === 'leadership')).toHaveLength(1)
  })
  it('keeps paused departmental work unresolved and chooses a new active admin if an owner leaves', () => {
    const first = evaluateOperations(snapshot(), emptyOperations())
    first.teams.find(t => t.code === 'delivery')!.enabled = false
    const backup = { ...admin, id: 'backup', createdAt: '2026-02-01' }
    const next = evaluateOperations(snapshot({ user: backup, users: [{ ...admin, deactivatedAt: '2026-10-01' }, backup], tasks: [] }), first)
    expect(next.work.find(w => w.key === 'delivery:task:task')?.status).toBe('open')
    expect(next.teams.every(t => t.ownerId === backup.id)).toBe(true)
  })
  it('preserves first-seen time only within the same unresolved episode', () => {
    const first = evaluateOperations(snapshot(), emptyOperations())
    const closed = evaluateOperations(snapshot({ tasks: [] }), first)
    const next = evaluateOperations(snapshot({ now: '2026-10-10T02:00:00Z' }), closed)
    expect(next.work.find(w => w.key === 'delivery:task:task')?.firstSeenAt).toBe('2026-10-10T02:00:00Z')
  })
  it('starts the escalation clock when an existing exception becomes urgent', () => {
    const first = evaluateOperations(snapshot({ tasks: [{ ...task, priority: 'low' }] }), emptyOperations())
    const next = evaluateOperations(snapshot({ now: '2026-10-10T02:00:00Z' }), first)
    expect(next.work.find(w => w.key === 'delivery:task:task')?.urgentSinceAt).toBe('2026-10-10T02:00:00Z')
    expect(next.work.some(w => w.department === 'leadership' && w.status === 'open')).toBe(false)
  })
  it('keeps collecting unpaid overdue invoices after a project is done', () => {
    const engagement = { id: 'engagement', projectId: project.id, version: 1, terms: { ...emptyEngagementTerms(), invoices: [{ id: 'i1', reference: 'INV-1', amountMinor: 1000, dueDate: '2026-01-01' }] }, createdAt: '2026-01-01', updatedAt: '2026-01-01' }
    const next = evaluateOperations(snapshot({ projects: [{ ...project, status: 'done' }], tasks: [], projectEngagements: [engagement] }), emptyOperations())
    expect(next.work).toHaveLength(1)
    expect(next.work[0].department).toBe('finance')
    expect(next.work[0].instruction).toContain('overdue invoice')
  })
})
describe('Cube intake and persistence validation', () => {
  it('requires real confirmation evidence but permits a pending unsigned contract reference', () => {
    const intake = emptyIntake(project.id)
    expect(() => intakeError(intake)).not.toThrow()
    expect(() => intakeError({ ...intake, briefConfirmed: true })).toThrow('evidence')
    expect(() => intakeError({ ...intake, contractReference: 'x'.repeat(2001) })).toThrow('too long')
  })
  it('loads valid work and refuses malformed persisted records', () => {
    const state = evaluateOperations(snapshot(), emptyOperations())
    expect(parseOperations(JSON.stringify(state))).toEqual(state)
    expect(() => parseOperations('{broken')).toThrow()
    expect(() => parseOperations(JSON.stringify({ ...state, teams: [] }))).toThrow('settings')
    expect(() => parseOperations(JSON.stringify({ ...state, work: [{ ...state.work[0], status: 'complete' }] }))).toThrow('work records')
    expect(() => parseOperations(JSON.stringify({ ...state, work: [state.work[0], state.work[0]] }))).toThrow('duplicate')
  })
})
