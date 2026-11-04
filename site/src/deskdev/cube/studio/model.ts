import { can, isAdmin } from '../../lib/permissions'
import type { PermFeature, User } from '../../lib/types'
import { adWebUrl } from '../ads/model'

export const CASE_TYPES = {
  handoff: { title: 'Department handoff', feature: 'projects' },
  onboarding: { title: 'Client onboarding', feature: 'clients' },
  delivery: { title: 'Delivery exception', feature: 'tasks' },
  scope: { title: 'Scope-change review', feature: 'projects' },
  opportunity: { title: 'Job or client opportunity', feature: 'growth' },
  knowledge: { title: 'SOP or coverage gap', feature: 'courses' },
} as const
export const DEPARTMENTS = ['Growth', 'Client Success', 'Delivery', 'Creative', 'Finance', 'People'] as const
export type CaseStatus = 'open' | 'accepted' | 'waiting' | 'resolved' | 'dismissed'
export interface CaseInput {
  kind: keyof typeof CASE_TYPES
  title: string
  department: typeof DEPARTMENTS[number]
  ownerId: string
  nextStep: string
  reviewOn: string
  sourceUrl: string
}
export interface StudioCase extends CaseInput {
  id: string
  version: number
  status: CaseStatus
  evidence: string
  createdAt: string
  updatedAt: string
}
export interface ContentInput {
  title: string
  channel: 'Facebook' | 'Instagram' | 'LinkedIn' | 'Other'
  account: string
  objective: string
  caption: string
  assetUrl: string
  scheduleAt: string
}
export interface StudioContent extends ContentInput {
  id: string
  version: number
  status: 'draft' | 'approved' | 'published'
  approvedVersion?: number
  publishedUrl: string
  createdAt: string
  updatedAt: string
}
export interface StudioEvent {
  id: string
  entityId: string
  entity: 'case' | 'content'
  feature: PermFeature
  actorId: string
  action: string
  at: string
}
export interface StudioBook {
  version: 1
  cases: StudioCase[]
  content: StudioContent[]
  events: StudioEvent[]
}
export const emptyStudioBook = (): StudioBook => ({ version: 1, cases: [], content: [], events: [] })
export const studioKey = (mode: string, id: string) => `deskdev-cube-studio:v1:${mode}:${encodeURIComponent(id)}`
const checkText = (value: string, label: string, max: number) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label} is required (maximum ${max} characters).`)
  return value.trim()
}
const validDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
const feature = (row: CaseInput): PermFeature => CASE_TYPES[row.kind].feature
const authorize = (user: User | null, permission: PermFeature) => {
  if (!isAdmin(user) || !can(user, permission, 'edit')) throw new Error('An active admin role is required.')
}
const event = (book: StudioBook, user: User, row: StudioCase | StudioContent, entity: StudioEvent['entity'], action: string, now: string): StudioEvent[] => [
  ...book.events, { id: crypto.randomUUID(), entityId: row.id, entity, feature: entity === 'case' ? feature(row as StudioCase) : 'growth' as PermFeature, actorId: user.id, action, at: now },
].slice(-500)

export function validateCase(input: CaseInput, users: User[]): CaseInput {
  if (!Object.hasOwn(CASE_TYPES, input.kind) || !DEPARTMENTS.includes(input.department)) throw new Error('Choose a supported case type and department.')
  const owner = users.find((row) => row.id === input.ownerId)
  if (!owner || !can(owner, feature(input), 'edit')) throw new Error('Choose an active owner with edit permission for this case.')
  if (input.department === 'Finance' && owner.role !== 'admin') throw new Error('A Finance case needs an active admin owner.')
  if (!validDay(input.reviewOn)) throw new Error('Choose a valid review date.')
  return { kind: input.kind, department: input.department, ownerId: owner.id, title: checkText(input.title, 'Title', 200), nextStep: checkText(input.nextStep, 'Next step', 2000), reviewOn: input.reviewOn, sourceUrl: input.sourceUrl.trim() ? adWebUrl(input.sourceUrl) : '' }
}

export function saveStudioCase(book: StudioBook, input: CaseInput, user: User | null, users: User[], now: string, previous?: StudioCase): StudioBook {
  const clean = validateCase(input, users)
  authorize(user, feature(clean))
  if (clean.department === 'Finance' && user?.role !== 'admin') throw new Error('Finance cases are admin-only.')
  const latest = previous ? book.cases.find((row) => row.id === previous.id) : undefined
  if (previous && (!latest || JSON.stringify(latest) !== JSON.stringify(previous))) throw new Error('This case changed. Reload before saving.')
  if (latest) authorize(user, feature(latest))
  if (latest?.status === 'resolved') throw new Error('A resolved case keeps its evidence. Create a new case for new work.')
  if (!latest && book.cases.length >= 500) throw new Error('The local workspace supports up to 500 cases.')
  if (!latest && clean.sourceUrl && book.cases.some((row) => row.sourceUrl === clean.sourceUrl && !['resolved', 'dismissed'].includes(row.status))) throw new Error('An active case already uses this source. Review it before creating another.')
  const row: StudioCase = { ...clean, id: latest?.id ?? crypto.randomUUID(), version: (latest?.version ?? 0) + 1, status: 'open', evidence: '', createdAt: latest?.createdAt ?? now, updatedAt: now }
  return { ...book, cases: [row, ...book.cases.filter((item) => item.id !== row.id)], events: event(book, user!, row, 'case', latest ? 'updated' : 'created', now) }
}

export function transitionStudioCase(book: StudioBook, proposal: StudioCase, status: CaseStatus, evidence: string, user: User | null, now: string): StudioBook {
  authorize(user, feature(proposal))
  if (proposal.department === 'Finance' && user?.role !== 'admin') throw new Error('Finance cases are admin-only.')
  const current = book.cases.find((row) => row.id === proposal.id)
  if (!current || JSON.stringify(current) !== JSON.stringify(proposal)) throw new Error('This case changed. Reload before reviewing.')
  if (current.status === 'resolved') throw new Error('The case is already resolved.')
  if (!['open', 'accepted', 'waiting', 'resolved', 'dismissed'].includes(status)) throw new Error('Choose a supported status.')
  if (status === current.status) return book
  if (status !== 'open') checkText(evidence, 'Acceptance, blocker, outcome, or rejection evidence', 2000)
  const row = { ...current, status, evidence: evidence.trim(), version: current.version + 1, updatedAt: now }
  return { ...book, cases: book.cases.map((item) => item.id === row.id ? row : item), events: event(book, user!, row, 'case', status, now) }
}

export function validateContent(input: ContentInput): ContentInput {
  if (!['Facebook', 'Instagram', 'LinkedIn', 'Other'].includes(input.channel)) throw new Error('Choose a supported channel.')
  if (input.scheduleAt && !Number.isFinite(Date.parse(input.scheduleAt))) throw new Error('Choose a valid publication time.')
  return { title: checkText(input.title, 'Title', 200), channel: input.channel, account: checkText(input.account, 'Destination account', 160), objective: checkText(input.objective, 'Objective', 1000), caption: checkText(input.caption, 'Caption', 12000), assetUrl: input.assetUrl.trim() ? adWebUrl(input.assetUrl) : '', scheduleAt: input.scheduleAt }
}

export function saveStudioContent(book: StudioBook, input: ContentInput, user: User | null, now: string, previous?: StudioContent): StudioBook {
  authorize(user, 'growth')
  const clean = validateContent(input)
  const current = previous ? book.content.find((row) => row.id === previous.id) : undefined
  if (previous && (!current || JSON.stringify(current) !== JSON.stringify(previous))) throw new Error('This content changed. Reload before saving.')
  if (current?.status === 'published') throw new Error('Published content keeps its record. Create a new draft for new work.')
  if (!current && book.content.length >= 500) throw new Error('The local workspace supports up to 500 drafts.')
  const row: StudioContent = { ...clean, id: current?.id ?? crypto.randomUUID(), version: (current?.version ?? 0) + 1, status: 'draft', publishedUrl: '', createdAt: current?.createdAt ?? now, updatedAt: now }
  return { ...book, content: [row, ...book.content.filter((item) => item.id !== row.id)], events: event(book, user!, row, 'content', current ? 'updated' : 'created', now) }
}

export function approveStudioContent(book: StudioBook, proposal: StudioContent, user: User | null, now: string): StudioBook {
  authorize(user, 'growth')
  const current = book.content.find((row) => row.id === proposal.id)
  if (!current || JSON.stringify(current) !== JSON.stringify(proposal)) throw new Error('This draft changed. Review the current version.')
  if (current.status !== 'draft') throw new Error('Only a draft can be approved.')
  validateContent(current)
  const row = { ...current, status: 'approved' as const, approvedVersion: current.version, updatedAt: now }
  return { ...book, content: book.content.map((item) => item.id === row.id ? row : item), events: event(book, user!, row, 'content', 'approved', now) }
}

export function recordStudioPublication(book: StudioBook, proposal: StudioContent, publishedUrl: string, user: User | null, now: string): StudioBook {
  authorize(user, 'growth')
  const current = book.content.find((row) => row.id === proposal.id)
  if (!current || JSON.stringify(current) !== JSON.stringify(proposal)) throw new Error('This draft changed. Review the current version.')
  if (current.status !== 'approved' || current.approvedVersion !== current.version) throw new Error('Approve this exact version before recording publication.')
  const row = { ...current, status: 'published' as const, publishedUrl: adWebUrl(publishedUrl), updatedAt: now }
  return { ...book, content: book.content.map((item) => item.id === row.id ? row : item), events: event(book, user!, row, 'content', 'publication_recorded', now) }
}

/** Parse with full field and permission-independent shape validation; never silently discard history. */
export function parseStudioBook(raw: string | null): StudioBook {
  if (!raw) return emptyStudioBook()
  const data = JSON.parse(raw) as StudioBook
  if (!data || data.version !== 1 || !Array.isArray(data.cases) || !Array.isArray(data.content) || !Array.isArray(data.events) || data.cases.length > 500 || data.content.length > 500 || data.events.length > 500) throw new Error('Studio history could not be read.')
  const ids = new Set<string>()
  for (const row of [...data.cases, ...data.content]) {
    if (!row || typeof row.id !== 'string' || ids.has(row.id) || !Number.isSafeInteger(row.version) || row.version < 1 || !Number.isFinite(Date.parse(row.createdAt)) || !Number.isFinite(Date.parse(row.updatedAt))) throw new Error('Studio history could not be read.')
    ids.add(row.id)
  }
  for (const row of data.cases) {
    if (!Object.hasOwn(CASE_TYPES, row.kind) || !DEPARTMENTS.includes(row.department) || typeof row.ownerId !== 'string' || !['open', 'accepted', 'waiting', 'resolved', 'dismissed'].includes(row.status) || !validDay(row.reviewOn) || typeof row.evidence !== 'string' || row.evidence.length > 2000) throw new Error('Invalid case history.')
    checkText(row.title, 'Title', 200)
    checkText(row.nextStep, 'Next step', 2000)
    if (row.sourceUrl) adWebUrl(row.sourceUrl)
    if (row.status !== 'open') checkText(row.evidence, 'Evidence', 2000)
  }
  for (const row of data.content) {
    validateContent(row)
    if (!['draft', 'approved', 'published'].includes(row.status) || (row.status !== 'draft' && row.approvedVersion !== row.version)) throw new Error('Invalid content history.')
    if (row.status === 'published') adWebUrl(row.publishedUrl)
  }
  for (const row of data.events) {
    if (!row || typeof row.id !== 'string' || typeof row.entityId !== 'string' || typeof row.actorId !== 'string' || typeof row.action !== 'string' || !['case', 'content'].includes(row.entity) || !['projects', 'tasks', 'clients', 'growth', 'courses'].includes(row.feature) || !Number.isFinite(Date.parse(row.at))) throw new Error('Invalid event history.')
  }
  return data
}
