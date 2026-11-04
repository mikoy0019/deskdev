import { fmtDate, fmtMoney } from '../../lib/format'
import { budgetBandLabel, serviceLabel, slaState, timelineLabel, type SlaState } from '../../lib/leads'
import type { Lead, LeadAction, LeadActivity, LeadLostReason, LeadStage, LeadTouch } from '../../lib/types'
import { LOST_REASON_LABEL, STAGE_LABEL } from './shared'

// The words the lead drawer puts on a lead's history, score and reply clock.
// Pure, so the wording is tested without rendering anything. Everything in
// an activity's `detail` came from a form or another client: it is read
// defensively and only ever shown as text.

/** One label per history event (all 22 in LeadAction). */
export const LEAD_ACTION_LABEL: Record<LeadAction, string> = {
  created: 'Lead added',
  stage_changed: 'Stage changed',
  contacted: 'Replied',
  note: 'Note',
  won: 'Won',
  lost: 'Lost',
  submitted: 'Form submitted',
  resubmitted: 'Submitted again',
  assigned: 'Owner changed',
  sla_breached: 'Reply overdue',
  spam_marked: 'Marked as spam',
  not_spam: 'Marked not spam',
  proposal_sent: 'Proposal sent',
  auto_reply_sent: 'Auto-reply sent',
  email_received: 'Email received',
  email_sent: 'Email sent',
  meeting_booked: 'Meeting booked',
  converted: 'Converted to client',
  followup_set: 'Follow-up set',
  booking_link_sent: 'Booking link sent',
  call_logged: 'Call logged',
  form_submitted: 'Sent back a form',
}

/**
 * The touches the drawer's "Log a touch" menu offers, in order. The sixth
 * (booking_link_sent) is logged by the copy-link button instead.
 */
export const LEAD_TOUCHES = [
  { action: 'contacted', label: 'Replied' },
  { action: 'call_logged', label: 'Call' },
  { action: 'email_sent', label: 'Email sent' },
  { action: 'proposal_sent', label: 'Proposal sent' },
  { action: 'meeting_booked', label: 'Meeting booked' },
] as const satisfies readonly { action: LeadAction; label: string }[]

/** The score rules, in the words of lib/leads.ts scoreLead. */
export const SCORE_RULE_LABEL: Record<string, string> = {
  budget: 'Budget',
  timeline: 'Timeline',
  business_email: 'Business email',
  company: 'Company named',
  phone: 'Phone given',
  detailed_message: 'Detailed message',
  repeat_submission: 'Submitted more than once',
  existing_client: 'Existing client',
  multiple_services: 'Two or more services',
}

/** snake_case token → "Sentence case", for keys this file has no label for. */
export function humanize(token: string): string {
  const words = token.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : ''
}

/** Score rows, largest first; an unknown rule keeps its key, humanized. */
export function scoreRows(breakdown: Record<string, number> | undefined): { key: string; label: string; points: number }[] {
  return Object.entries(breakdown ?? {})
    .filter(([, points]) => typeof points === 'number' && Number.isFinite(points) && points !== 0)
    .map(([key, points]) => ({ key, label: SCORE_RULE_LABEL[key] ?? humanize(key), points }))
    .sort((a, b) => b.points - a.points)
}

const SPAM_REASON: Record<string, string> = {
  manual: 'Marked by a teammate',
  turnstile_failed: 'Failed the bot check',
  turnstile_missing: 'Skipped the bot check',
  honeypot: 'Filled the hidden field',
  token_invalid: 'Form token was not valid',
  token_expired: 'Form token had expired',
  rate_limited: 'Too many submissions',
}

export function spamReasonLabel(reason: string | undefined): string {
  if (!reason?.trim()) return 'No reason recorded'
  return SPAM_REASON[reason] ?? humanize(reason)
}

/** 9m · 2h 5m · 3d — a span, never negative. */
export function fmtSpan(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000))
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return mins % 60 ? `${hours}h ${mins % 60}m` : `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

export interface SlaLabel {
  state: SlaState
  text: string
}

/** The reply clock in words; null when the lead has none (manual, spam). */
export function slaLabel(
  lead: Pick<Lead, 'slaDueAt' | 'firstRespondedAt' | 'spam'>,
  now: number,
): SlaLabel | null {
  const state = slaState(lead, now)
  if (state === 'none' || !lead.slaDueAt) return null
  if (state === 'met') return { state, text: 'Replied' }
  const due = new Date(lead.slaDueAt).getTime()
  if (state === 'breached') return { state, text: `Reply overdue ${fmtSpan(now - due)}` }
  return { state, text: `Reply due in ${fmtSpan(due - now)}` }
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [])

/**
 * The one line under an event's label: what changed. `userName` resolves a
 * profile id (an owner) to a display name.
 */
export function activitySummary(
  a: Pick<LeadActivity, 'action' | 'detail'>,
  userName: (id: string) => string | undefined = () => undefined,
): string | undefined {
  const d = a.detail ?? {}
  switch (a.action) {
    case 'stage_changed': {
      const from = STAGE_LABEL[d.from as LeadStage]
      const to = STAGE_LABEL[d.to as LeadStage]
      return from && to ? `${from} → ${to}` : to
    }
    case 'lost':
      return LOST_REASON_LABEL[d.reason as LeadLostReason]
    case 'won':
      return typeof d.value === 'number' && d.value > 0 ? fmtMoney(d.value) : undefined
    case 'assigned': {
      const to = str(d.to)
      const who = to ? `To ${userName(to) ?? 'a teammate'}` : 'Unassigned'
      return d.via === 'round_robin' ? `${who} · round robin` : who
    }
    case 'followup_set':
      return str(d.to) ? fmtDate(str(d.to)) : 'Cleared'
    case 'note':
      return str(d.note)
    case 'spam_marked':
      return spamReasonLabel(str(d.reason))
    case 'converted': {
      const service = str(d.service) ? serviceLabel(str(d.service)) : undefined
      const where = d.new_client === false ? 'Added to an existing client' : undefined
      return [service, where].filter(Boolean).join(' · ') || undefined
    }
    case 'submitted': {
      const parts = [strings(d.services).map((s) => serviceLabel(s)).join(', '), d.quarantined === true ? 'Quarantined' : '']
      return parts.filter(Boolean).join(' · ') || undefined
    }
    case 'email_received':
    case 'email_sent':
      return str(d.subject)
    default:
      return undefined
  }
}

/**
 * What a repeat submission claimed. A resubmission never overwrites the
 * lead, so these are listed on its history row for staff to apply by hand.
 */
export function resubmittedFields(detail: Record<string, unknown> | undefined): { label: string; value: string }[] {
  const d = detail ?? {}
  const rows: { label: string; value: string }[] = []
  const push = (label: string, value: string | undefined) => {
    if (value) rows.push({ label, value })
  }
  push('Name', str(d.name))
  push('Company', str(d.company))
  push('Phone', str(d.phone))
  push('Services', strings(d.services).map((s) => serviceLabel(s)).join(', '))
  push('Budget', budgetBandLabel(str(d.budget_band)))
  push('Timeline', timelineLabel(str(d.timeline)))
  push('Message', str(d.message))
  if (typeof d.consent === 'boolean') push('Consent', d.consent ? 'Given' : 'Not given')
  return rows
}

const TOUCH_KEYS: [string, string][] = [
  ['utm_source', 'Source'],
  ['utm_medium', 'Medium'],
  ['utm_campaign', 'Campaign'],
  ['utm_term', 'Term'],
  ['utm_content', 'Content'],
  ['referrer', 'Referrer'],
  ['landing_page', 'Landing page'],
  ['gclid', 'Google click ID'],
]

/** A first or last touch as label/value rows; only the keys that were captured. */
export function attributionRows(touch: LeadTouch | undefined): { label: string; value: string }[] {
  if (!touch || typeof touch !== 'object') return []
  return TOUCH_KEYS.flatMap(([key, label]) => {
    const value = str(touch[key])
    return value ? [{ label, value: value.slice(0, 300) }] : []
  })
}
