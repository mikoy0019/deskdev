import { isAdmin } from '../../lib/permissions'
import type { Client, Lead, User } from '../../lib/types'

export const AD_SOURCES = {
  meta: { label: 'Meta', url: 'https://www.facebook.com/ads/library/' },
  google: { label: 'Google', url: 'https://adstransparency.google.com/' },
  linkedin: { label: 'LinkedIn', url: 'https://www.linkedin.com/ad-library/' },
  other: { label: 'Other', url: '' },
} as const

export const AD_SIGNALS = {
  broken_destination: { label: 'Broken ad destination', service: 'Website maintenance' },
  mobile_friction: { label: 'Observed mobile usability issue', service: 'Website usability improvements' },
  offer_mismatch: { label: 'Ad and destination offer mismatch', service: 'Campaign landing page' },
  booking_friction: { label: 'Observed booking friction', service: 'Booking flow improvements' },
  manual_enquiry: { label: 'Public instructions describe manual enquiries', service: 'Enquiry workflow review' },
  explicit_request: { label: 'Explicit request for service help', service: 'Service discovery conversation' },
} as const

export type AdStatus = 'needs_review' | 'approved' | 'contacted' | 'dismissed' | 'do_not_contact'
export interface AdInput {
  business: string
  source: keyof typeof AD_SOURCES
  adUrl: string
  landingUrl: string
  signal: keyof typeof AD_SIGNALS
  evidence: string
  observedOn: string
  contactUrl: string
}
export interface AdOpportunity extends AdInput {
  id: string
  ownerId: string
  revision: number
  status: AdStatus
  createdAt: string
  updatedAt: string
  approvedRevision?: number
  approvedAt?: string
  contactedAt?: string
}
export interface AdBook {
  version: 1
  opportunities: AdOpportunity[]
}
export const emptyAdBook = (): AdBook => ({ version: 1, opportunities: [] })
export const AD_EVIDENCE_DAYS = 14

/** Only navigable public web links; no credentials, scripts, or local network destinations. */
export function adWebUrl(raw: string): string {
  const url = new URL(raw.trim())
  const host = url.hostname.toLowerCase()
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !host.includes('.') || host.endsWith('.localhost') || host.endsWith('.local') || /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host.includes(':')) throw new Error('Use a public HTTP or HTTPS link without credentials.')
  return url.href
}

export function adBusinessKey(landingUrl: string): string {
  return new URL(adWebUrl(landingUrl)).hostname.toLowerCase().replace(/^www\./, '')
}

function dayValid(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day
}

export function validateAdInput(input: AdInput, today: string): AdInput {
  if (!input || typeof input !== 'object' || typeof input.business !== 'string' || !input.business.trim() || input.business.length > 160) throw new Error('Enter a business name, up to 160 characters.')
  if (!Object.hasOwn(AD_SOURCES, input.source) || !Object.hasOwn(AD_SIGNALS, input.signal)) throw new Error('Choose a supported source and observed signal.')
  if (typeof input.evidence !== 'string' || input.evidence.trim().length < 15 || input.evidence.length > 2000) throw new Error('Record specific evidence, between 15 and 2,000 characters.')
  if (typeof input.observedOn !== 'string' || !dayValid(input.observedOn) || input.observedOn > today) throw new Error('Choose a valid observation date on or before today.')
  for (const field of ['adUrl', 'landingUrl', 'contactUrl'] as const) {
    if (typeof input[field] !== 'string' || input[field].length > 2000) throw new Error('Links must be no longer than 2,000 characters.')
  }
  return { business: input.business.trim(), source: input.source, signal: input.signal, evidence: input.evidence.trim(), observedOn: input.observedOn, adUrl: adWebUrl(input.adUrl), landingUrl: adWebUrl(input.landingUrl), contactUrl: input.contactUrl.trim() ? adWebUrl(input.contactUrl) : '' }
}

export function adBookKey(mode: 'local' | 'remote', userId: string): string {
  return `deskdev-cube-ads:v1:${mode}:${encodeURIComponent(userId)}`
}

/** Validate storage rather than trusting browser data. Fail visibly, without replacing corrupt records. */
export function parseAdBook(raw: string | null, userId: string): AdBook {
  if (!raw) return emptyAdBook()
  const data = JSON.parse(raw) as AdBook
  if (!data || data.version !== 1 || !Array.isArray(data.opportunities) || data.opportunities.length > 500) throw new Error('Opportunity storage could not be read.')
  const ids = new Set<string>()
  const keys = new Set<string>()
  const opportunities = data.opportunities.map((row) => {
    if (!row || typeof row.id !== 'string' || ids.has(row.id) || row.ownerId !== userId || !Number.isSafeInteger(row.revision) || row.revision < 1 || !['needs_review', 'approved', 'contacted', 'dismissed', 'do_not_contact'].includes(row.status) || !Number.isFinite(Date.parse(row.createdAt)) || !Number.isFinite(Date.parse(row.updatedAt))) throw new Error('Opportunity storage could not be read.')
    const input = validateAdInput(row, '9999-12-31')
    const key = adBusinessKey(input.landingUrl)
    if (keys.has(key) || ((row.status === 'approved' || row.status === 'contacted') && (row.approvedRevision !== row.revision || !row.approvedAt || !Number.isFinite(Date.parse(row.approvedAt)))) || (row.status === 'contacted' && (!row.contactedAt || !Number.isFinite(Date.parse(row.contactedAt))))) throw new Error('Opportunity storage could not be read.')
    ids.add(row.id)
    keys.add(key)
    return { ...input, id: row.id, ownerId: row.ownerId, revision: row.revision, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt, approvedRevision: row.approvedRevision, approvedAt: row.approvedAt, contactedAt: row.contactedAt }
  })
  return { version: 1, opportunities }
}

const companyName = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

export function existingAdRelationship(opportunity: AdInput, leads: Lead[], clients: Client[]): { kind: 'lead' | 'client'; id: string } | null {
  const name = companyName(opportunity.business)
  const client = clients.find((row) => [row.name, row.company].some((value) => value && companyName(value) === name))
  if (client) return { kind: 'client', id: client.id }
  const lead = leads.find((row) => [row.name, row.company].some((value) => value && companyName(value) === name))
  return lead ? { kind: 'lead', id: lead.id } : null
}

export function adReviewBlocker(opportunity: AdOpportunity, today: string, existing: ReturnType<typeof existingAdRelationship>, recordsAvailable: boolean): string | null {
  if (!recordsAvailable) return 'Load both Growth and client records before checking existing relationships.'
  if (existing) return `This business matches an existing ${existing.kind}. Review that relationship before considering cold outreach.`
  if (opportunity.status === 'do_not_contact') return 'This business is marked do not contact.'
  if (opportunity.observedOn > today || Date.parse(`${today}T00:00:00Z`) - Date.parse(`${opportunity.observedOn}T00:00:00Z`) > AD_EVIDENCE_DAYS * 86400000) return `Recheck the observation. Evidence must be no more than ${AD_EVIDENCE_DAYS} days old.`
  if (!opportunity.contactUrl) return 'Record a public business contact page before approving outreach.'
  return null
}

export function saveAdOpportunity(book: AdBook, input: AdInput, user: User | null, now: string, today: string, proposal?: AdOpportunity): AdBook {
  if (!isAdmin(user)) throw new Error('An active admin role is required.')
  const clean = validateAdInput(input, today)
  const previous = proposal ? book.opportunities.find((row) => row.id === proposal.id) : undefined
  if (proposal && (!previous || previous.revision !== proposal.revision || previous.updatedAt !== proposal.updatedAt)) throw new Error('This opportunity changed. Reload it before saving.')
  if (previous && ['contacted', 'do_not_contact'].includes(previous.status)) throw new Error('Contacted or suppressed opportunities cannot be edited.')
  if (book.opportunities.some((row) => row.id !== previous?.id && (adBusinessKey(row.landingUrl) === adBusinessKey(clean.landingUrl) || companyName(row.business) === companyName(clean.business)))) throw new Error('This business is already in your opportunity inbox. Review its existing record.')
  if (!previous && book.opportunities.length >= 500) throw new Error('The personal inbox supports up to 500 opportunities.')
  const row: AdOpportunity = { ...clean, id: previous?.id ?? crypto.randomUUID(), ownerId: user!.id, revision: (previous?.revision ?? 0) + 1, status: 'needs_review', createdAt: previous?.createdAt ?? now, updatedAt: now }
  return { version: 1, opportunities: [row, ...book.opportunities.filter((item) => item.id !== row.id)] }
}

export function reviewAdOpportunity(book: AdBook, proposal: AdOpportunity, status: Exclude<AdStatus, 'needs_review'>, user: User | null, now: string, today: string, existing: ReturnType<typeof existingAdRelationship>, recordsAvailable: boolean): AdBook {
  if (!isAdmin(user) || proposal.ownerId !== user!.id) throw new Error('An active admin role is required for your opportunity.')
  const current = book.opportunities.find((row) => row.id === proposal.id)
  if (!current || JSON.stringify(current) !== JSON.stringify(proposal)) throw new Error('This opportunity changed. Reload it before reviewing.')
  if (current.status === 'do_not_contact') throw new Error('This business is suppressed from outreach.')
  if (status === 'approved' || status === 'contacted') {
    const blocker = adReviewBlocker(current, today, existing, recordsAvailable)
    if (blocker) throw new Error(blocker)
    if (status === 'approved' && current.status !== 'needs_review') throw new Error('Only an opportunity awaiting review can be approved.')
    if (status === 'contacted' && (current.status !== 'approved' || current.approvedRevision !== current.revision)) throw new Error('Approve this exact version before recording contact.')
  }
  const next: AdOpportunity = { ...current, status, updatedAt: now,
    ...(status === 'approved' ? { approvedRevision: current.revision, approvedAt: now } : {}),
    ...(status === 'contacted' ? { contactedAt: now } : {}),
  }
  return { version: 1, opportunities: book.opportunities.map((row) => row.id === current.id ? next : row) }
}

export function adOutreachDraft(opportunity: AdOpportunity): string {
  return `Hi ${opportunity.business} team,\n\nWhile reviewing your ad and its destination, I noted: ${opportunity.evidence}\n\nWe help businesses with ${AD_SIGNALS[opportunity.signal].service.toLowerCase()}. Would it be useful if we shared a suggested next step?\n\nNixGen Solutions`
}
