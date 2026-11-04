import { slaState } from '../../lib/leads'
import type { Lead, SiteSubscriber } from '../../lib/types'

/**
 * Pure figures behind Growth Hub → Reports and the subscriber export, kept
 * apart from the components so they run under Vitest.
 */

export type ReportRange = '30d' | '90d' | 'all'
export const REPORT_RANGES: { key: ReportRange; label: string; days?: number }[] = [
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 },
  { key: 'all', label: 'All time' },
]

/** Real leads that arrived inside the range. Quarantined ones never count. */
export function reportLeads(leads: Lead[], range: ReportRange, now: number): Lead[] {
  const days = REPORT_RANGES.find((r) => r.key === range)?.days
  const from = days ? now - days * 864e5 : -Infinity
  return leads.filter((l) => !l.spam && new Date(l.createdAt).getTime() >= from)
}

export interface Tally { label: string; value: number }

/**
 * Count leads per key, biggest first (ties by label, so the order is stable).
 * A lead with several keys (services) counts once under each; a lead with
 * none counts under `blank`, when given.
 */
export function tally(leads: Lead[], keysOf: (lead: Lead) => (string | undefined)[], blank?: string): Tally[] {
  const counts = new Map<string, number>()
  for (const lead of leads) {
    const keys = [...new Set(keysOf(lead).map((k) => k?.trim()).filter((k): k is string => Boolean(k)))]
    if (keys.length === 0 && blank) keys.push(blank)
    for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
}

/** utm_source of the first or last touch, lower-cased and capped (it is the visitor's own text). */
export function utmSource(lead: Lead, touch: 'first' | 'last'): string | undefined {
  const raw = lead.attribution?.[touch]?.utm_source
  return typeof raw === 'string' ? raw.trim().toLowerCase().slice(0, 40) || undefined : undefined
}

export interface ReplyStats {
  /** Median of firstRespondedAt − createdAt over leads that got a reply. */
  medianMs: number | null
  replied: number
  /** Replied on or before slaDueAt. */
  onTime: number
  /** Replied, but after slaDueAt. */
  late: number
  /** No reply and past slaDueAt. */
  breached: number
  /** No reply yet, still inside the SLA. */
  waiting: number
  /** onTime / (onTime + late + breached); null while nothing has been judged. */
  hitRate: number | null
}

/**
 * Reply speed and the SLA hit rate. slaState decides who is judged: 'none'
 * (no deadline: manual leads) is left out, 'ok' and 'due_soon' are still
 * running. 'met' only says someone replied, so it is split by whether the
 * reply beat the deadline: a late reply is a miss, not a hit.
 */
export function replyStats(leads: Lead[], now: number): ReplyStats {
  const times: number[] = []
  let onTime = 0
  let late = 0
  let breached = 0
  let waiting = 0
  for (const lead of leads) {
    if (lead.firstRespondedAt) {
      const ms = new Date(lead.firstRespondedAt).getTime() - new Date(lead.createdAt).getTime()
      if (Number.isFinite(ms) && ms >= 0) times.push(ms)
    }
    const state = slaState(lead, now)
    if (state === 'met') {
      const replied = new Date(lead.firstRespondedAt as string).getTime()
      const due = new Date(lead.slaDueAt as string).getTime()
      if (Number.isFinite(replied) && Number.isFinite(due) && replied > due) late += 1
      else onTime += 1
    } else if (state === 'breached') breached += 1
    else if (state === 'ok' || state === 'due_soon') waiting += 1
  }
  times.sort((a, b) => a - b)
  const mid = Math.floor(times.length / 2)
  const medianMs = times.length === 0 ? null : times.length % 2 ? times[mid] : (times[mid - 1] + times[mid]) / 2
  const judged = onTime + late + breached
  return { medianMs, replied: times.length, onTime, late, breached, waiting, hitRate: judged > 0 ? onTime / judged : null }
}

/** Leads that became a client (clientId set) out of the leads given. */
export function conversionStats(leads: Lead[]): { total: number; converted: number; rate: number | null } {
  const converted = leads.filter((l) => Boolean(l.clientId)).length
  return { total: leads.length, converted, rate: leads.length > 0 ? converted / leads.length : null }
}

// ─── Subscriber export ──────────────────────────────────────────────────────

/**
 * One CSV cell. Always quoted; a value a spreadsheet would run as a formula
 * (=, +, -, @, tab, CR first) gets a leading apostrophe. The address and the
 * source come from a public form, so they are not trusted.
 */
export function csvCell(value: string | undefined | null): string {
  const text = value ?? ''
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

export function subscribersCsv(subscribers: SiteSubscriber[]): string {
  const rows = [['email', 'status', 'source', 'subscribed_at', 'unsubscribed_at']]
  for (const s of subscribers) {
    rows.push([
      s.email,
      s.unsubscribedAt ? 'unsubscribed' : 'subscribed',
      s.source ?? '',
      s.consentAt ?? s.createdAt,
      s.unsubscribedAt ?? '',
    ])
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
