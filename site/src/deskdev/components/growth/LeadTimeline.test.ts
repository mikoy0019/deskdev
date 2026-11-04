import { describe, expect, it } from 'vitest'
import type { LeadAction } from '../../lib/types'
import {
  LEAD_ACTION_LABEL, activitySummary, attributionRows, fmtSpan, humanize, resubmittedFields,
  scoreRows, slaLabel, spamReasonLabel,
} from './LeadTimeline'

const NOW = Date.parse('2026-10-03T10:00:00Z')
const at = (mins: number) => new Date(NOW + mins * 60_000).toISOString()

describe('LEAD_ACTION_LABEL', () => {
  it('labels all 22 actions', () => {
    const actions: LeadAction[] = [
      'created', 'stage_changed', 'contacted', 'note', 'won', 'lost', 'submitted', 'resubmitted', 'assigned',
      'sla_breached', 'spam_marked', 'not_spam', 'proposal_sent', 'auto_reply_sent', 'email_received',
      'email_sent', 'meeting_booked', 'converted', 'followup_set', 'booking_link_sent', 'call_logged',
      'form_submitted',
    ]
    expect(Object.keys(LEAD_ACTION_LABEL).sort()).toEqual([...actions].sort())
    for (const a of actions) expect(LEAD_ACTION_LABEL[a]).toBeTruthy()
  })
})

describe('fmtSpan', () => {
  it('formats minutes, hours and days, never negative', () => {
    expect(fmtSpan(9 * 60_000)).toBe('9m')
    expect(fmtSpan(125 * 60_000)).toBe('2h 5m')
    expect(fmtSpan(120 * 60_000)).toBe('2h')
    expect(fmtSpan(3 * 864e5)).toBe('3d')
    expect(fmtSpan(-5000)).toBe('0m')
  })
})

describe('slaLabel', () => {
  it('has no clock without a deadline or for spam', () => {
    expect(slaLabel({}, NOW)).toBeNull()
    expect(slaLabel({ slaDueAt: at(10), spam: true }, NOW)).toBeNull()
  })

  it('counts down, warns and reports a breach', () => {
    expect(slaLabel({ slaDueAt: at(42) }, NOW)).toEqual({ state: 'ok', text: 'Reply due in 42m' })
    expect(slaLabel({ slaDueAt: at(10) }, NOW)).toEqual({ state: 'due_soon', text: 'Reply due in 10m' })
    expect(slaLabel({ slaDueAt: at(-75) }, NOW)).toEqual({ state: 'breached', text: 'Reply overdue 1h 15m' })
  })

  it('is met once someone replied', () => {
    expect(slaLabel({ slaDueAt: at(-75), firstRespondedAt: at(-90) }, NOW)).toEqual({ state: 'met', text: 'Replied' })
  })
})

describe('scoreRows', () => {
  it('sorts by points, drops zeros and labels unknown rules', () => {
    expect(scoreRows({ company: 5, budget: 20, phone: 0, new_rule: 7 })).toEqual([
      { key: 'budget', label: 'Budget', points: 20 },
      { key: 'new_rule', label: 'New rule', points: 7 },
      { key: 'company', label: 'Company named', points: 5 },
    ])
    expect(scoreRows(undefined)).toEqual([])
  })
})

describe('spamReasonLabel', () => {
  it('names known reasons and humanizes the rest', () => {
    expect(spamReasonLabel('turnstile_failed')).toBe('Failed the bot check')
    expect(spamReasonLabel('link_flood')).toBe('Link flood')
    expect(spamReasonLabel(undefined)).toBe('No reason recorded')
    expect(humanize('  a__b-c ')).toBe('A b c')
  })
})

describe('activitySummary', () => {
  const name = (id: string) => (id === 'u-1' ? 'Rina Cruz' : undefined)

  it('describes stage, loss, owner and follow-up changes', () => {
    expect(activitySummary({ action: 'stage_changed', detail: { from: 'new', to: 'contacted' } })).toBe('New → Contacted')
    expect(activitySummary({ action: 'lost', detail: { reason: 'no_decision' } })).toBe('No decision')
    expect(activitySummary({ action: 'assigned', detail: { to: 'u-1', via: 'round_robin' } }, name)).toBe('To Rina Cruz · round robin')
    expect(activitySummary({ action: 'assigned', detail: { to: 'u-9' } }, name)).toBe('To a teammate')
    expect(activitySummary({ action: 'assigned', detail: { to: null } }, name)).toBe('Unassigned')
    expect(activitySummary({ action: 'followup_set', detail: { to: null } })).toBe('Cleared')
  })

  it('describes intake and conversion', () => {
    expect(activitySummary({ action: 'submitted', detail: { services: ['website', 'automation'], quarantined: true } }))
      .toBe('Website, Automation & AI · Quarantined')
    expect(activitySummary({ action: 'converted', detail: { service: 'app', new_client: false } }))
      .toBe('App / dashboard · Added to an existing client')
    expect(activitySummary({ action: 'spam_marked', detail: { reason: 'manual' } })).toBe('Marked by a teammate')
  })

  it('survives a malformed detail', () => {
    expect(activitySummary({ action: 'stage_changed', detail: { from: 7, to: {} } })).toBeUndefined()
    expect(activitySummary({ action: 'note', detail: { note: 42 } })).toBeUndefined()
    expect(activitySummary({ action: 'contacted', detail: {} })).toBeUndefined()
  })
})

describe('resubmittedFields', () => {
  it('lists what the new brief claimed, with labels', () => {
    expect(resubmittedFields({
      name: 'Maya S.', phone: ' 0917 ', company: '', services: ['app', 3], budget_band: '7k_15k',
      timeline: 'asap', message: 'Now with a deadline', consent: true, submission: 2,
    })).toEqual([
      { label: 'Name', value: 'Maya S.' },
      { label: 'Phone', value: '0917' },
      { label: 'Services', value: 'App / dashboard' },
      { label: 'Budget', value: '$7k – $15k' },
      { label: 'Timeline', value: 'As soon as possible' },
      { label: 'Message', value: 'Now with a deadline' },
      { label: 'Consent', value: 'Given' },
    ])
    expect(resubmittedFields(undefined)).toEqual([])
  })
})

describe('attributionRows', () => {
  it('keeps only captured string keys', () => {
    expect(attributionRows({ utm_source: 'google', referrer: '', landing_page: '/contact', at: 'x', gclid: 5 as unknown as string }))
      .toEqual([{ label: 'Source', value: 'google' }, { label: 'Landing page', value: '/contact' }])
    expect(attributionRows(undefined)).toEqual([])
  })
})
