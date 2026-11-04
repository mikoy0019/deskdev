import { can, isAdmin } from '../lib/permissions'
import { engagementGate } from '../lib/engagements'
import { isOpenLead } from '../lib/leads'
import type { Lead, PermFeature, Project, ProjectEngagement, Task, User } from '../lib/types'

export type CubeDepartment = 'growth' | 'delivery' | 'finance'
export type CubePlaybookId = 'lead-followup' | 'blocked-task' | 'engagement-readiness'

export const CUBE_PLAYBOOKS = [
  { id: 'lead-followup', department: 'growth', title: 'Lead follow-up', description: 'Review missing owners, overdue replies, and scheduled follow-ups.', feature: 'growth', adminOnly: false },
  { id: 'blocked-task', department: 'delivery', title: 'Blocked work', description: 'Bring blocked tasks and their recorded context to the delivery owner.', feature: 'tasks', adminOnly: false },
  { id: 'engagement-readiness', department: 'finance', title: 'Delivery readiness', description: 'Check recorded scope, acceptance, and deposit before kickoff.', feature: 'projects', adminOnly: true },
] as const

export interface CubeSnapshot {
  user: User | null
  users: User[]
  leads: Lead[]
  tasks: Task[]
  projects: Project[]
  projectEngagements: ProjectEngagement[]
  /** Failed pulls retain stale rows in DeskDev; Cube must not evaluate those rows. */
  unavailable: readonly string[]
  now: string
  timezone: string
}

export interface CubeDecision {
  id: string
  playbookId: CubePlaybookId
  playbookVersion: 1
  department: CubeDepartment
  feature: PermFeature
  entityId: string
  entityType: 'lead' | 'task' | 'engagement'
  title: string
  summary: string
  nextAction: string
  ownerId?: string
  ownerLabel: string
  severity: 'attention' | 'urgent'
  reasonCodes: string[]
  evidence: { label: string; value: string }[]
  action: { type: 'review_lead'; leadId: string } | { type: 'review_task'; taskId: string } | { type: 'review_engagement'; projectId: string }
  /** Exact rule inputs, rather than a probability or generated explanation. Never persisted. */
  fingerprint: string
}

export function cubeDate(now: string, timezone: string): string {
  const date = new Date(now)
  if (!Number.isFinite(date.getTime())) throw new Error('Cube needs a valid evaluation time.')
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

function validDay(value?: string): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value)
}

export function cubePlaybookVisible(user: User | null, id: CubePlaybookId): boolean {
  const playbook = CUBE_PLAYBOOKS.find((item) => item.id === id)
  return Boolean(playbook && can(user, playbook.feature, 'view') && (!playbook.adminOnly || isAdmin(user)))
}

export function canReviewCubeDecision(user: User | null, decision: CubeDecision): boolean {
  return cubePlaybookVisible(user, decision.playbookId) && can(user, decision.feature, 'edit')
}

export function cubeDecisionHref(decision: CubeDecision): string {
  switch (decision.action.type) {
    case 'review_lead': return `/growth/leads?lead=${encodeURIComponent(decision.action.leadId)}`
    case 'review_task': return `/tasks?task=${encodeURIComponent(decision.action.taskId)}`
    case 'review_engagement': return `/projects/${encodeURIComponent(decision.action.projectId)}`
  }
}

/** Read-only, deterministic evaluation. No notifications, source writes, or network calls. */
export function evaluateCube(snapshot: CubeSnapshot): CubeDecision[] {
  const decisions: CubeDecision[] = []
  const today = cubeDate(snapshot.now, snapshot.timezone)
  const now = Date.parse(snapshot.now)
  const unavailable = new Set(snapshot.unavailable)
  const owner = (id?: string) => unavailable.has('users') ? undefined : snapshot.users.find((user) => user.id === id && !user.deactivatedAt)
  const add = (input: Omit<CubeDecision, 'id' | 'playbookVersion' | 'fingerprint'>, inputs: unknown) => {
    decisions.push({ ...input, id: `${input.playbookId}:${input.entityId}`, playbookVersion: 1, fingerprint: JSON.stringify([1, input.reasonCodes, input.ownerId, inputs]) })
  }

  if (cubePlaybookVisible(snapshot.user, 'lead-followup') && !unavailable.has('leads')) {
    for (const lead of snapshot.leads) {
      if (!isOpenLead(lead) || lead.piiScrubbedAt) continue
      const assigned = owner(lead.ownerId)
      const reasons: string[] = []
      if (!unavailable.has('users') && !assigned) reasons.push('lead_owner_missing')
      if (validDay(lead.followUp) && lead.followUp <= today) reasons.push('lead_followup_due')
      if (!lead.firstRespondedAt && lead.slaDueAt && Date.parse(lead.slaDueAt) <= now) reasons.push('lead_reply_overdue')
      if (!reasons.length) continue
      add({ playbookId: 'lead-followup', department: 'growth', feature: 'growth', entityId: lead.id, entityType: 'lead',
        title: lead.name || lead.company || 'Unnamed lead', summary: reasons.includes('lead_reply_overdue') ? 'The first reply is overdue in DeskDev.' : reasons.includes('lead_followup_due') ? 'A scheduled follow-up is due.' : 'This open lead needs an active owner.',
        nextAction: assigned ? 'Review the last contact, follow up, and record the outcome in the lead.' : 'Assign an active Growth owner, then review the next contact.',
        ownerId: assigned?.id, ownerLabel: assigned?.fullName ?? (unavailable.has('users') ? 'Owner data unavailable' : 'Growth admin review'),
        severity: reasons.includes('lead_reply_overdue') || (validDay(lead.followUp) && lead.followUp < today) ? 'urgent' : 'attention',
        reasonCodes: reasons, evidence: [{ label: 'Stage', value: lead.stage }, { label: 'Follow-up date', value: lead.followUp || 'Not set' }, { label: 'First reply', value: lead.firstRespondedAt || 'Not recorded' }, ...(lead.slaDueAt ? [{ label: 'Reply deadline', value: lead.slaDueAt }] : [])],
        action: { type: 'review_lead', leadId: lead.id },
      }, [lead.name, lead.company, lead.updatedAt, lead.stage, lead.followUp, lead.slaDueAt, lead.firstRespondedAt, lead.lastTouchAt, lead.ownerId, assigned?.fullName, today])
    }
  }

  if (cubePlaybookVisible(snapshot.user, 'blocked-task') && !unavailable.has('tasks')) {
    for (const task of snapshot.tasks) {
      if (task.archived || task.status !== 'blocked') continue
      const assigned = owner(task.assigneeId)
      const overdue = validDay(task.dueDate) && task.dueDate < today
      add({ playbookId: 'blocked-task', department: 'delivery', feature: 'tasks', entityId: task.id, entityType: 'task',
        title: task.title, summary: overdue ? 'This blocked task is past its due date.' : 'This task is blocked and needs an owner review.',
        nextAction: assigned ? 'Review the blocker with the assignee and record the resolution or next step.' : 'Assign an active delivery owner and record the blocker and next step.',
        ownerId: assigned?.id, ownerLabel: assigned?.fullName ?? (unavailable.has('users') ? 'Owner data unavailable' : 'Delivery admin review'),
        severity: overdue || task.priority === 'high' ? 'urgent' : 'attention', reasonCodes: ['task_blocked', ...(overdue ? ['task_overdue'] : [])],
        evidence: [{ label: 'Status', value: 'Blocked' }, { label: 'Due date', value: task.dueDate || 'Not set' }, { label: 'Priority', value: task.priority }, { label: 'Recorded notes', value: task.notes?.trim() || 'No blocker notes recorded' }],
        action: { type: 'review_task', taskId: task.id },
      }, [task.title, task.updatedAt, task.status, task.archived, task.dueDate, task.priority, task.notes, task.assigneeId, assigned?.fullName, today])
    }
  }

  if (cubePlaybookVisible(snapshot.user, 'engagement-readiness') && !unavailable.has('projects') && !unavailable.has('projectEngagements')) {
    for (const engagement of snapshot.projectEngagements) {
      const project = snapshot.projects.find((item) => item.id === engagement.projectId)
      if (!project || project.status === 'done' || engagement.terms.phase !== 'planning') continue
      const gate = engagementGate(engagement.terms)
      const assigned = owner(project.assigneeId)
      add({ playbookId: 'engagement-readiness', department: 'finance', feature: 'projects', entityId: engagement.id, entityType: 'engagement',
        title: project.title, summary: gate ? 'Delivery prerequisites are incomplete.' : 'Recorded prerequisites are ready for kickoff review.',
        nextAction: gate || 'Review the engagement and explicitly start delivery in the project panel.',
        ownerId: undefined, ownerLabel: 'Finance admin review', severity: project.status === 'in_progress' && gate ? 'urgent' : 'attention',
        reasonCodes: [gate ? 'engagement_kickoff_blocked' : 'engagement_kickoff_ready'],
        evidence: [{ label: 'Engagement version', value: String(engagement.version) }, { label: 'Delivery phase', value: engagement.terms.phase }, { label: 'Acceptance', value: engagement.terms.acceptedOn || 'Not recorded' }, { label: 'Delivery owner', value: assigned?.fullName || (unavailable.has('users') ? 'Owner data unavailable' : 'Not assigned') }, { label: 'Prerequisite check', value: gate || 'Scope, acceptance, and required deposit recorded' }],
        action: { type: 'review_engagement', projectId: project.id },
      }, [engagement.version, engagement.updatedAt, engagement.terms, project.title, project.updatedAt, project.status, project.assigneeId, assigned?.fullName])
    }
  }
  return decisions.sort((a, b) => Number(b.severity === 'urgent') - Number(a.severity === 'urgent') || a.id.localeCompare(b.id))
}
