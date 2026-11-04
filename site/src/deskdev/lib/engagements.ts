import type { EngagementTerms } from './types'

export const ENGAGEMENT_CURRENCIES = ['USD', 'PHP', 'EUR', 'GBP', 'AUD', 'CAD'] as const
export const emptyEngagementTerms = (): EngagementTerms => ({
  currency: 'USD', feeMinor: 0, depositMinor: 0, scope: '', acceptanceEvidence: '', acceptedOn: '',
  phase: 'planning', milestones: [], invoices: [], payments: [],
})

/** Decimal strings go straight to minor units, avoiding floating-point rounding of money. */
export function parseMoney(value: string): number | null {
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(value.trim())) return null
  const [whole, fraction = ''] = value.trim().split('.')
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(minor) && minor <= 999999999999 ? minor : null
}

export function engagementTotals(terms: EngagementTerms) {
  const invoiced = terms.invoices.reduce((sum, i) => sum + i.amountMinor, 0)
  const collected = terms.payments.reduce((sum, p) => sum + p.amountMinor, 0)
  return { invoiced, collected, outstanding: invoiced - collected, uninvoiced: terms.feeMinor - invoiced }
}

export function engagementGate(terms: EngagementTerms): string | null {
  if (!terms.scope.trim() || !terms.acceptanceEvidence.trim() || !terms.acceptedOn) return 'Record the agreed scope and acceptance evidence before kickoff.'
  if (engagementTotals(terms).collected < terms.depositMinor) return 'Record the agreed deposit before kickoff.'
  return null
}

const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date
const text = (value: string, max: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
const money = (value: number) => Number.isSafeInteger(value) && value >= 0 && value <= 999999999999
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Mirrors 044's server checks; the database remains authoritative in remote mode. */
export function engagementError(terms: EngagementTerms, previous?: EngagementTerms): string | null {
  if (!ENGAGEMENT_CURRENCIES.includes(terms.currency)) return 'Choose a supported currency.'
  if (!money(terms.feeMinor) || !money(terms.depositMinor) || terms.depositMinor > terms.feeMinor) return 'Enter valid amounts; the deposit cannot exceed the agreed fee.'
  if (typeof terms.scope !== 'string' || terms.scope.length > 12000 || typeof terms.acceptanceEvidence !== 'string' || terms.acceptanceEvidence.length > 2000) return 'Scope or acceptance evidence is too long.'
  if (!['planning', 'active', 'completed'].includes(terms.phase)) return 'Choose a valid engagement phase.'
  if (terms.acceptedOn && (!validDate(terms.acceptedOn) || terms.acceptedOn > new Date().toISOString().slice(0, 10))) return 'Acceptance must have a valid date on or before today.'
  if (Boolean(terms.acceptedOn) !== Boolean(terms.acceptanceEvidence.trim()) || (terms.acceptedOn && !terms.scope.trim())) return 'Record the scope, acceptance date, and evidence together.'
  for (const list of [terms.milestones, terms.invoices, terms.payments]) {
    if (!Array.isArray(list) || list.length > 100) return 'Each engagement supports up to 100 milestones, invoices, and payments.'
    if (new Set(list.map((item) => item.id)).size !== list.length || list.some((item) => !text(item.id, 100))) return 'Every record needs a unique identifier.'
  }
  for (const milestone of terms.milestones) {
    if (!text(milestone.title, 200) || !validDate(milestone.dueDate) || !['planned', 'review', 'approved'].includes(milestone.status) || typeof milestone.approvalEvidence !== 'string' || milestone.approvalEvidence.length > 2000) return 'Each milestone needs a title, valid due date, and status.'
    if (milestone.status === 'approved' && !milestone.approvalEvidence.trim()) return 'Record approval evidence for each approved milestone.'
  }
  if (new Set(terms.invoices.map((i) => i.reference.trim().toLowerCase())).size !== terms.invoices.length) return 'Invoice references must be unique.'
  if (new Set(terms.payments.map((p) => p.reference.trim().toLowerCase())).size !== terms.payments.length) return 'Payment references must be unique.'
  for (const invoice of terms.invoices) {
    if (!text(invoice.reference, 200) || !money(invoice.amountMinor) || invoice.amountMinor === 0 || !validDate(invoice.dueDate)) return 'Each invoice needs a reference, positive amount, and valid due date.'
    if (terms.payments.filter((p) => p.invoiceId === invoice.id).reduce((sum, p) => sum + p.amountMinor, 0) > invoice.amountMinor) return 'Payments cannot exceed their invoice amount.'
  }
  for (const payment of terms.payments) {
    if (!text(payment.reference, 200) || !money(payment.amountMinor) || payment.amountMinor === 0 || !validDate(payment.receivedOn) || payment.receivedOn > new Date().toISOString().slice(0, 10) || !terms.invoices.some((i) => i.id === payment.invoiceId)) return 'Each receipt needs an invoice, unique reference, positive amount, and a date on or before today.'
  }
  if (engagementTotals(terms).invoiced > terms.feeMinor) return 'Invoices cannot exceed the agreed fee.'
  if (previous?.acceptedOn && ['scope', 'feeMinor', 'depositMinor', 'currency', 'acceptedOn', 'acceptanceEvidence'].some((key) => !same(terms[key as keyof EngagementTerms], previous[key as keyof EngagementTerms]))) return 'Accepted terms are locked. Record scope changes outside this engagement until amendment support is available.'
  if (previous && (previous.invoices.some((i) => !terms.invoices.some((next) => same(i, next))) || previous.payments.some((p) => !terms.payments.some((next) => same(p, next))))) return 'Saved invoices and receipts cannot be changed or removed.'
  if (previous?.phase === 'completed' && (terms.phase !== 'completed' || !same(previous.milestones, terms.milestones))) return 'Completed delivery is locked.'
  if (previous?.phase === 'active' && terms.phase === 'planning') return 'An active engagement cannot return to planning.'
  if (terms.phase !== 'planning') {
    const gate = engagementGate(terms)
    if (gate) return gate
  }
  if (terms.phase === 'completed' && (terms.milestones.length === 0 || terms.milestones.some((m) => m.status !== 'approved'))) return 'Approve every milestone before completing the engagement.'
  return null
}
