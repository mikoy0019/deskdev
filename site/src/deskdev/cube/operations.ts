import { cubeDate, type CubeSnapshot } from './engine'
import { engagementGate } from '../lib/engagements'
import { isAdmin } from '../lib/permissions'
import { isOpenLead } from '../lib/leads'

export const OPERATION_DEPARTMENTS = {
  growth: 'Growth / Sales', client_ops: 'Client Operations', delivery: 'Delivery / Engineering',
  creative: 'Creative / Content', finance: 'Finance', people: 'People / Capacity', leadership: 'Leadership / Operations',
} as const
export type OperationDepartment = keyof typeof OPERATION_DEPARTMENTS
export interface CubeIntake {
  projectId: string
  version: number
  contractReference: string
  briefConfirmed: boolean
  assetsConfirmed: boolean
  creativeRequired: boolean
  creativeApproved: boolean
  qaConfirmed: boolean
  evidence: string
}
export const emptyIntake = (projectId: string): CubeIntake => ({ projectId, version: 0, contractReference: '', briefConfirmed: false, assetsConfirmed: false, creativeRequired: false, creativeApproved: false, qaConfirmed: false, evidence: '' })
export interface OperationTeam { code: OperationDepartment; ownerId: string | null; enabled: boolean }
export interface OperationWork {
  key: string
  department: OperationDepartment
  subjectType: 'lead' | 'task' | 'project' | 'integration' | 'operation'
  subjectId: string
  title: string
  instruction: string
  urgency: 'attention' | 'urgent'
  ownerId: string | null
  status: 'open' | 'resolved'
  firstSeenAt: string
  urgentSinceAt: string | null
  updatedAt: string
}
export interface OperationState {
  version: 1
  enabled: boolean
  teams: OperationTeam[]
  intakes: CubeIntake[]
  work: OperationWork[]
  lastRunAt: string | null
  error: string | null
  history: { id: string; workKey: string | null; action: string; at: string }[]
}
export const emptyOperations = (): OperationState => ({ version: 1, enabled: true, teams: (Object.keys(OPERATION_DEPARTMENTS) as OperationDepartment[]).map(code => ({ code, ownerId: null, enabled: true })), intakes: [], work: [], lastRunAt: null, error: null, history: [] })
const validDay = (value?: string) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value)

/** Local demo counterpart of 053. Production evaluation is a transaction in the database. */
export function evaluateOperations(snapshot: CubeSnapshot, previous: OperationState): OperationState {
  if (!isAdmin(snapshot.user) || !previous.enabled) return previous
  if (snapshot.unavailable.length) return { ...previous, error: 'Source data is unavailable. Existing work has not been resolved.' }
  const today = cubeDate(snapshot.now, snapshot.timezone)
  const admins = snapshot.users.filter(isAdmin).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  const active = (id?: string | null) => snapshot.users.some(u => u.id === id && !u.deactivatedAt)
  const teams = previous.teams.map(team => ({ ...team, ownerId: admins.some(u => u.id === team.ownerId) ? team.ownerId : admins[0]?.id ?? null }))
  const candidates: OperationWork[] = []
  const add = (department: OperationDepartment, subjectType: OperationWork['subjectType'], subjectId: string, title: string, instruction: string, urgency: OperationWork['urgency'] = 'attention', ownerId?: string) => {
    if (!teams.find(t => t.code === department)?.enabled) return
    const key = `${department}:${subjectType}:${subjectId}`
    const old = previous.work.find(w => w.key === key)
    candidates.push({ key, department, subjectType, subjectId, title, instruction, urgency,
      ownerId: department === 'finance' || department === 'leadership' || !active(ownerId) ? teams.find(t => t.code === department)?.ownerId ?? null : ownerId!,
      status: 'open', firstSeenAt: old?.status === 'open' ? old.firstSeenAt : snapshot.now,
      urgentSinceAt: urgency === 'urgent' ? old?.status === 'open' && old.urgency === 'urgent' ? old.urgentSinceAt ?? snapshot.now : snapshot.now : null, updatedAt: snapshot.now })
  }
  for (const lead of snapshot.leads) {
    if (!isOpenLead(lead) || lead.piiScrubbedAt) continue
    const replyLate = Boolean(!lead.firstRespondedAt && lead.slaDueAt && Date.parse(lead.slaDueAt) <= Date.parse(snapshot.now))
    if (!active(lead.ownerId) || (validDay(lead.followUp) && lead.followUp! <= today) || replyLate) add('growth', 'lead', lead.id, lead.name || 'Lead follow-up', 'Assign an active owner, review the last contact and record the follow-up outcome.', replyLate || (validDay(lead.followUp) && lead.followUp! < today) ? 'urgent' : 'attention', lead.ownerId)
  }
  for (const task of snapshot.tasks) {
    if (task.archived || task.status === 'done') continue
    const overdue = Boolean(validDay(task.dueDate) && task.dueDate! < today)
    if (task.status === 'blocked' || overdue) add('delivery', 'task', task.id, task.title, 'Resolve the recorded blocker or revise the delivery plan in the source task.', overdue || task.priority === 'high' ? 'urgent' : 'attention', task.assigneeId)
    if (!active(task.assigneeId)) add('people', 'task', task.id, task.title, 'Assign an active task owner. Capacity and skill records must be supplied before Cube can balance workload.')
  }
  for (const project of snapshot.projects) {
    const intake = previous.intakes.find(i => i.projectId === project.id) ?? emptyIntake(project.id)
    const engagement = snapshot.projectEngagements.find(e => e.projectId === project.id)
    const gate = !engagement ? 'Create the engagement and record scope, acceptance and deposit evidence.' : engagementGate(engagement.terms)
    const overdueInvoice = engagement?.terms.invoices.some(invoice => validDay(invoice.dueDate) && invoice.dueDate < today && engagement.terms.payments.filter(p => p.invoiceId === invoice.id).reduce((sum, p) => sum + p.amountMinor, 0) < invoice.amountMinor)
    if ((project.status !== 'done' && (!intake.contractReference.trim() || gate)) || overdueInvoice) add('finance', 'project', project.id, project.title, overdueInvoice ? 'Reconcile the overdue invoice against confirmed receipts.' : !intake.contractReference.trim() ? 'Contract pending: add the real agreement reference when supplied. A reference alone does not record acceptance.' : gate!, project.status === 'in_progress' && Boolean(gate || !intake.contractReference.trim()) || overdueInvoice ? 'urgent' : 'attention')
    if (project.status === 'done') continue
    if (!intake.briefConfirmed || !intake.assetsConfirmed) add('client_ops', 'project', project.id, project.title, 'Confirm the client brief and required assets in project intake.', 'attention', project.assigneeId)
    if (intake.creativeRequired && !intake.creativeApproved) add('creative', 'project', project.id, project.title, 'Complete the creative review and record approval in project intake.')
    if (!active(project.assigneeId)) add('people', 'project', project.id, project.title, 'Assign an active delivery owner in the source project.')
    const ready = engagement && !gate && intake.contractReference.trim() && intake.briefConfirmed && intake.assetsConfirmed && (!intake.creativeRequired || intake.creativeApproved) && active(project.assigneeId)
    if (ready && engagement.terms.phase === 'planning') add('delivery', 'project', project.id, project.title, 'Intake and Finance prerequisites are recorded. Accept the delivery handoff and start the engagement in the project panel.', 'attention', project.assigneeId)
    if (engagement?.terms.phase === 'active' && !intake.qaConfirmed) add('delivery', 'project', project.id, project.title, 'Complete delivery QA and record its evidence before final handoff.', 'attention', project.assigneeId)
  }
  for (const work of [...candidates]) {
    if (work.department !== 'leadership' && work.urgentSinceAt && Date.parse(snapshot.now) - Date.parse(work.urgentSinceAt) >= 86400000) add('leadership', 'operation', work.key, `Escalation: ${work.title}`, 'An urgent departmental exception has remained open for 24 hours. Coordinate the responsible department.')
  }
  const keys = new Set(candidates.map(w => w.key))
  const paused = new Set(teams.filter(t => !t.enabled).map(t => t.code))
  const work = [...candidates, ...previous.work.filter(w => !keys.has(w.key)).map(w => paused.has(w.department) || (w.subjectType === 'operation' && previous.work.some(parent => parent.key === w.subjectId && paused.has(parent.department))) || w.status === 'resolved' ? w : { ...w, status: 'resolved' as const, updatedAt: snapshot.now })]
  const events = work.flatMap(w => {
    const old = previous.work.find(item => item.key === w.key)
    const action = !old ? 'created' : old.status !== w.status ? w.status === 'open' ? 'reopened' : 'resolved' : old.ownerId !== w.ownerId || old.instruction !== w.instruction || old.urgency !== w.urgency || old.title !== w.title ? 'updated' : null
    return action ? [{ id: `${w.key}:${snapshot.now}:${action}`, workKey: w.key, action, at: snapshot.now }] : []
  })
  return { ...previous, teams, work, history: [...previous.history, ...events].slice(-200), lastRunAt: snapshot.now, error: null }
}

export function operationHref(work: OperationWork): string | null {
  if (work.subjectType === 'project') return `/projects/${encodeURIComponent(work.subjectId)}`
  if (work.subjectType === 'task') return `/tasks?task=${encodeURIComponent(work.subjectId)}`
  if (work.subjectType === 'lead') return `/growth/leads?lead=${encodeURIComponent(work.subjectId)}`
  return null
}
