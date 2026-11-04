import type { BusinessHours, Lead, LeadAttribution, LeadTouch } from './types'

// Pure lead rules shared by the store and the Growth screens: the intake
// vocabulary, transparent scoring, SLA state, inbox tabs and what a converted
// lead starts with. The server is the authority in remote mode (lead_score
// and convert_lead in 034/036); these mirror it so local mode behaves the
// same and the UI can explain a score without a round trip.

// ─── Intake vocabulary ──────────────────────────────────────────────────────
// The keys the database stores (034: lead_services, lead_budget_band,
// lead_timeline) and lead_score scores. Labels are UI copy. Budget bands are
// provisional until the owner confirms real figures (Q11): change them here,
// in the site's contact page and in lead_budget_band / lead_score together.

export const LEAD_SERVICES = [
  { key: 'website', label: 'Website' },
  { key: 'app', label: 'App / dashboard' },
  { key: 'automation', label: 'Automation & AI' },
  { key: 'developer', label: 'Dedicated developer' },
  // The site's contact form picker, slugged by lead_services.
  { key: 'dashboard', label: 'Revenue dashboard' },
  { key: 'ai_operations', label: 'AI operations' },
  { key: 'full_stack', label: 'Full-stack build' },
] as const

export type LeadServiceKey = (typeof LEAD_SERVICES)[number]['key']

/** Budget band → score points (0–40), the bands the DeskDev screens offer. */
export const BUDGET_BANDS = [
  { key: 'under_1k', label: 'Under $1k', points: 0 },
  { key: '1k_3k', label: '$1k – $3k', points: 10 },
  { key: '3k_7k', label: '$3k – $7k', points: 20 },
  { key: '7k_15k', label: '$7k – $15k', points: 30 },
  { key: '15k_plus', label: '$15k+', points: 40 },
  { key: 'unsure', label: 'Not sure yet', points: 0 },
] as const

/**
 * The second band set lead_budget_band (034) accepts: the one the current
 * site form's labels map to. Scored and labelled the same way until Q11
 * settles on one set (then drop it here and in lead_score together).
 */
export const SITE_BUDGET_BANDS = [
  { key: '1k_2_5k', label: '$1k – $2.5k', points: 8 },
  { key: '2_5k_5k', label: '$2.5k – $5k', points: 16 },
  { key: '5k_10k', label: '$5k – $10k', points: 24 },
  { key: '10k_25k', label: '$10k – $25k', points: 32 },
  { key: '25k_plus', label: '$25k+', points: 40 },
] as const

const ALL_BUDGET_BANDS: readonly { key: string; label: string; points: number }[] = [...BUDGET_BANDS, ...SITE_BUDGET_BANDS]

/** A stored band key → its label; an unknown key is shown as typed. */
export function budgetBandLabel(key: string | undefined): string | undefined {
  if (!key) return undefined
  return ALL_BUDGET_BANDS.find((b) => b.key === key)?.label ?? key
}

/** The same lookup under the name the lead screens first used. */
export const budgetLabel = budgetBandLabel

/** Timeline → score points (lead_score: asap +20, 1–3 months +12, the rest 0). */
export const LEAD_TIMELINES = [
  { key: 'asap', label: 'As soon as possible', points: 20 },
  { key: '1_3_months', label: 'In 1–3 months', points: 12 },
  { key: '3_6_months', label: 'In 3–6 months', points: 0 },
  { key: '6_plus_months', label: 'In 6+ months', points: 0 },
  { key: 'exploring', label: 'Just exploring', points: 0 },
] as const

/** A stored timeline key → its label; an unknown key is shown as typed. */
export function timelineLabel(key: string | undefined): string | undefined {
  if (!key) return undefined
  return LEAD_TIMELINES.find((t) => t.key === key)?.label ?? key
}

/**
 * lead_score's breakdown keys (034, the same as scoreLead's), for explaining
 * a score. message / repeat / services are the keys an earlier lead_score
 * wrote, so a row scored before the rename still reads.
 */
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
  message: 'Detailed message',
  repeat: 'Submitted more than once',
  services: 'Two or more services',
}

export const HOT_SCORE = 60

/**
 * Consumer mailboxes — an address on one of these isn't a business domain.
 * The same rule as lead_score (034): the provider is the first label of the
 * domain (gmail.com, yahoo.com.ph, outlook.co.uk …), or a regional
 * subdomain of the big four.
 */
const FREE_MAIL_PROVIDER =
  /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|proton|protonmail|pm|gmx|mail|yandex|zoho|tutanota|fastmail|hey|qq|163|126|rocketmail)\./
const FREE_MAIL_REGIONAL = /\.(gmail|yahoo|hotmail|outlook)\./

export function isBusinessEmail(email: string | undefined): boolean {
  const domain = email?.trim().toLowerCase().split('@')[1]
  if (!domain || !domain.includes('.')) return false
  return !FREE_MAIL_PROVIDER.test(domain) && !FREE_MAIL_REGIONAL.test(domain)
}

export interface LeadScore {
  score: number
  hot: boolean
  /** Rule → points, only the rules that scored. */
  breakdown: Record<string, number>
}

type Scorable = Pick<
  Lead,
  'budgetBand' | 'timeline' | 'email' | 'company' | 'phone' | 'message' | 'services' | 'submissionCount' | 'existingClientId'
>

/**
 * The transparent scoring rules from the plan (no AI):
 * budget band 0–40 · timeline asap +20 / 1–3 months +12 · business email +10
 * · company +5 · phone +5 · message over 200 chars +5 · repeat submission +10
 * · existing client +15 · two or more services +5. 60+ is hot. Capped at 100.
 */
export function scoreLead(lead: Scorable): LeadScore {
  const breakdown: Record<string, number> = {}
  const add = (rule: string, points: number) => {
    if (points > 0) breakdown[rule] = points
  }
  add('budget', ALL_BUDGET_BANDS.find((b) => b.key === lead.budgetBand)?.points ?? 0)
  add('timeline', LEAD_TIMELINES.find((t) => t.key === lead.timeline)?.points ?? 0)
  if (isBusinessEmail(lead.email)) add('business_email', 10)
  if (lead.company?.trim()) add('company', 5)
  if (lead.phone?.trim()) add('phone', 5)
  if ((lead.message?.trim().length ?? 0) > 200) add('detailed_message', 5)
  if ((lead.submissionCount ?? 1) > 1) add('repeat_submission', 10)
  if (lead.existingClientId) add('existing_client', 15)
  if ((lead.services?.length ?? 0) >= 2) add('multiple_services', 5)
  const score = Math.min(100, Object.values(breakdown).reduce((a, b) => a + b, 0))
  return { score, hot: score >= HOT_SCORE, breakdown }
}

// ─── Attribution ────────────────────────────────────────────────────────────

const TOUCH_KEYS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'referrer', 'landing_page', 'gclid', 'at',
] as const

function touchOf(value: unknown): LeadTouch | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>
  const touch: LeadTouch = {}
  for (const key of TOUCH_KEYS) {
    const v = input[key]
    if (typeof v === 'string' && v) touch[key] = v
  }
  return Object.keys(touch).length ? touch : undefined
}

/**
 * First and last touch, whichever shape the row holds: intake_site_lead
 * (034's lead_clean_attribution) keeps the first touch at the top level and
 * the last under `last`; older rows and local mode nest both.
 */
export function leadTouches(attribution: LeadAttribution | undefined): { first?: LeadTouch; last?: LeadTouch } {
  if (!attribution) return {}
  return { first: touchOf(attribution.first) ?? touchOf(attribution), last: touchOf(attribution.last) }
}

// ─── State ──────────────────────────────────────────────────────────────────

/** Still being worked: not won, not lost, not quarantined. */
export function isOpenLead(lead: Pick<Lead, 'stage' | 'spam'>): boolean {
  return !lead.spam && lead.stage !== 'won' && lead.stage !== 'lost'
}

export type LeadInboxTab = 'new' | 'pipeline' | 'quarantine' | 'closed'

/**
 * Where a lead sits in the Growth inbox: quarantined spam apart, then "new"
 * (nobody has replied yet), the open pipeline, and closed (won/lost). The
 * "All" tab is every lead.
 */
export function inboxTab(lead: Pick<Lead, 'stage' | 'spam' | 'firstRespondedAt'>): LeadInboxTab {
  if (lead.spam) return 'quarantine'
  if (lead.stage === 'won' || lead.stage === 'lost') return 'closed'
  if (lead.stage === 'new' && !lead.firstRespondedAt) return 'new'
  return 'pipeline'
}

export type SlaState = 'none' | 'met' | 'ok' | 'due_soon' | 'breached'

/** Amber this close to the deadline. */
export const SLA_WARN_MS = 15 * 60 * 1000

/**
 * The reply clock: 'met' once someone responded, 'breached' past slaDueAt,
 * 'due_soon' inside the last 15 minutes, 'none' without a deadline (manual
 * leads, quarantined ones).
 */
export function slaState(
  lead: Pick<Lead, 'slaDueAt' | 'firstRespondedAt' | 'spam'>,
  now: number = Date.now(),
): SlaState {
  if (lead.spam || !lead.slaDueAt) return 'none'
  if (lead.firstRespondedAt) return 'met'
  const due = new Date(lead.slaDueAt).getTime()
  if (Number.isNaN(due)) return 'none'
  if (now >= due) return 'breached'
  if (due - now <= SLA_WARN_MS) return 'due_soon'
  return 'ok'
}

/** Newest submissions first within a tab, breached and soonest-due on top. */
export function compareBySla(a: Lead, b: Lead, now: number = Date.now()): number {
  const rank: Record<SlaState, number> = { breached: 0, due_soon: 1, ok: 2, met: 3, none: 4 }
  const ra = rank[slaState(a, now)]
  const rb = rank[slaState(b, now)]
  if (ra !== rb) return ra - rb
  const da = a.slaDueAt ? new Date(a.slaDueAt).getTime() : Infinity
  const db = b.slaDueAt ? new Date(b.slaDueAt).getTime() : Infinity
  if (da !== db) return da - db
  return b.createdAt.localeCompare(a.createdAt)
}

// ─── Conversion ─────────────────────────────────────────────────────────────

const SERVICE_LABEL: Record<string, string> = Object.fromEntries(LEAD_SERVICES.map((s) => [s.key, s.label]))

/** lead_service_label (036): a known key's label, else the slug in Title Case. */
export function serviceLabel(key: string | undefined): string {
  const k = key?.trim().toLowerCase() ?? ''
  if (!k) return 'Project'
  return SERVICE_LABEL[k] ?? k.slice(0, 40).replace(/_/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase())
}

/**
 * convert_lead's service slug (036): lower-case, runs of anything else
 * folded to '_', 40 characters; unset falls back to `fallback` (the lead's
 * first service).
 */
export function normalizeService(service: string | undefined, fallback?: string): string | undefined {
  const slug = (service ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)
  return slug || fallback || undefined
}

/**
 * "<Company> - <service>", as convert_lead names it. `company` is the
 * existing client's name when converting into one (theirs wins).
 */
export function convertedProjectTitle(
  lead: Pick<Lead, 'company' | 'name'>,
  service: string | undefined,
  company?: string,
): string {
  const who = company?.trim() || lead.company?.trim() || lead.name.trim() || 'New client'
  return `${who} - ${serviceLabel(service)}`.slice(0, 200)
}

/** Two starter tasks per service, after the three every engagement gets. */
const SERVICE_STARTER_TASKS: Record<string, string[]> = {
  website: ['Collect brand assets and page content', 'Agree the sitemap and page list'],
  app: ['Define user roles and core flows', 'Draft the data model'],
  automation: ['Map the current process and tools', 'List the integrations and API access needed'],
  developer: ["Onboard the developer to the client's tools", 'Agree the weekly reporting cadence'],
  // dashboard / ai_operations / full_stack (the site form's picker) get the
  // three common tasks only, as convert_lead gives them no service tasks yet.
}

/**
 * Starter task titles for a converted lead's first project — word for word
 * what convert_lead (036) creates, so local mode matches the server. The
 * first one (the kickoff) is the high-priority task.
 */
export function starterTasksFor(service: string | undefined, company = 'the client'): string[] {
  return [
    `Kickoff call with ${company}`,
    'Request access and store credentials in the Vault',
    'Write the discovery doc',
    ...(service ? SERVICE_STARTER_TASKS[service] ?? [] : []),
  ]
}

// ─── Business hours ─────────────────────────────────────────────────────────

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/

function isKnownTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/**
 * is_valid_business_hours (033): a real IANA zone, 1–7 distinct ISO weekdays
 * (1 = Monday … 7 = Sunday) and HH:MM start before end. The SLA maths must
 * never meet a bad zone or an empty week, so the server refuses anything else.
 */
export function isValidBusinessHours(hours: unknown): hours is BusinessHours {
  if (!hours || typeof hours !== 'object') return false
  const h = hours as Partial<BusinessHours>
  if (typeof h.tz !== 'string' || !isKnownTimeZone(h.tz)) return false
  if (!Array.isArray(h.days) || h.days.length < 1 || h.days.length > 7) return false
  if (!h.days.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)) return false
  if (new Set(h.days).size !== h.days.length) return false
  if (typeof h.start !== 'string' || typeof h.end !== 'string') return false
  return HHMM.test(h.start) && HHMM.test(h.end) && h.start < h.end
}
