import { describe, expect, it } from 'vitest'
import {
  HOT_SCORE, budgetBandLabel, compareBySla, convertedProjectTitle, inboxTab, isBusinessEmail,
  isValidBusinessHours, normalizeService, scoreLead, serviceLabel, slaState, starterTasksFor,
  timelineLabel,
} from './leads'
import type { Lead } from './types'

// These mirror the SQL in 034 (lead_score, lead_budget_band) and 036
// (convert_lead, lead_service_label). Local mode runs on them, and the Growth
// screens use them to explain a server-computed score, so they must agree.

describe('scoreLead (034 lead_score)', () => {
  it('scores the full rule set and caps at 100', () => {
    const r = scoreLead({
      budgetBand: '15k_plus', timeline: 'asap', email: 'ceo@acme.io', company: 'Acme', phone: '+1 555',
      message: 'x'.repeat(201), submissionCount: 2, existingClientId: 'c1', services: ['website', 'app'],
    })
    // 40 + 20 + 10 + 5 + 5 + 5 + 10 + 15 + 5 = 115 → 100
    expect(r.score).toBe(100)
    expect(r.hot).toBe(true)
    expect(r.breakdown).toEqual({
      budget: 40, timeline: 20, business_email: 10, company: 5, phone: 5,
      detailed_message: 5, repeat_submission: 10, existing_client: 15, multiple_services: 5,
    })
  })

  it('lists only the rules that scored', () => {
    const r = scoreLead({ budgetBand: 'unsure', timeline: 'exploring', email: 'me@gmail.com' })
    expect(r).toEqual({ score: 0, hot: false, breakdown: {} })
  })

  it('scores both budget band sets the SQL accepts', () => {
    expect(scoreLead({ budgetBand: '3k_7k' }).score).toBe(20)
    expect(scoreLead({ budgetBand: '7k_15k' }).score).toBe(30)
    expect(scoreLead({ budgetBand: '1k_2_5k' }).score).toBe(8)
    expect(scoreLead({ budgetBand: '10k_25k' }).score).toBe(32)
    expect(scoreLead({ budgetBand: '25k_plus' }).score).toBe(40)
    expect(scoreLead({ budgetBand: 'something else' }).score).toBe(0)
  })

  it('gives 1–3 months +12 and later timelines nothing', () => {
    expect(scoreLead({ timeline: '1_3_months' }).score).toBe(12)
    expect(scoreLead({ timeline: '3_6_months' }).score).toBe(0)
    expect(scoreLead({ timeline: '6_plus_months' }).score).toBe(0)
  })

  it('needs a message over 200 characters and two or more services', () => {
    expect(scoreLead({ message: 'x'.repeat(200) }).score).toBe(0)
    expect(scoreLead({ services: ['website'] }).score).toBe(0)
  })

  it(`marks ${HOT_SCORE}+ hot`, () => {
    // 40 + 20 = 60
    expect(scoreLead({ budgetBand: '15k_plus', timeline: 'asap' }).hot).toBe(true)
    // 30 + 20 + 5 = 55
    expect(scoreLead({ budgetBand: '7k_15k', timeline: 'asap', phone: '1' }).hot).toBe(false)
  })
})

describe('isBusinessEmail', () => {
  it('rejects free-mail providers, including regional domains', () => {
    for (const e of ['a@gmail.com', 'a@yahoo.com.ph', 'a@outlook.co.uk', 'a@proton.me', 'a@hey.com', 'a@mail.yahoo.co.jp']) {
      expect(isBusinessEmail(e), e).toBe(false)
    }
  })

  it('accepts a company domain and rejects junk', () => {
    expect(isBusinessEmail('Maya@KalyeCoffee.ph ')).toBe(true)
    expect(isBusinessEmail('nobody')).toBe(false)
    expect(isBusinessEmail('a@localhost')).toBe(false)
    expect(isBusinessEmail(undefined)).toBe(false)
  })
})

describe('labels', () => {
  it('labels both band sets and passes unknown keys through', () => {
    expect(budgetBandLabel('3k_7k')).toBe('$3k – $7k')
    expect(budgetBandLabel('2_5k_5k')).toBe('$2.5k – $5k')
    expect(budgetBandLabel('custom')).toBe('custom')
    expect(budgetBandLabel(undefined)).toBeUndefined()
    expect(timelineLabel('asap')).toBe('As soon as possible')
  })

  it('serviceLabel matches lead_service_label', () => {
    expect(serviceLabel('website')).toBe('Website')
    expect(serviceLabel('app')).toBe('App / dashboard')
    expect(serviceLabel('seo_audit')).toBe('Seo Audit')
    expect(serviceLabel(undefined)).toBe('Project')
  })
})

describe('conversion (036 convert_lead)', () => {
  it('normalizes the service like the RPC, falling back to the lead’s first', () => {
    expect(normalizeService(' Web App! ')).toBe('web_app_')
    expect(normalizeService(undefined, 'automation')).toBe('automation')
    expect(normalizeService('', undefined)).toBeUndefined()
  })

  it('names the project "<Company> - <service>", the client’s company winning', () => {
    expect(convertedProjectTitle({ company: 'Kalye Coffee', name: 'Maya' }, 'website')).toBe('Kalye Coffee - Website')
    expect(convertedProjectTitle({ company: '', name: 'Maya' }, undefined)).toBe('Maya - Project')
    expect(convertedProjectTitle({ company: 'Lead Co', name: 'Maya' }, 'app', 'Existing Ltd')).toBe('Existing Ltd - App / dashboard')
  })

  it('starts every project with the three common tasks, then two per service', () => {
    expect(starterTasksFor(undefined, 'Acme')).toEqual([
      'Kickoff call with Acme',
      'Request access and store credentials in the Vault',
      'Write the discovery doc',
    ])
    expect(starterTasksFor('automation', 'Acme').slice(3)).toEqual([
      'Map the current process and tools',
      'List the integrations and API access needed',
    ])
    expect(starterTasksFor('unknown_thing', 'Acme')).toHaveLength(3)
  })
})

describe('SLA and inbox', () => {
  const base: Lead = {
    id: 'l', name: 'L', stage: 'new', value: 0, source: 'website', hot: false, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  }
  const now = Date.parse('2026-10-03T10:00:00Z')

  it('reads the reply clock', () => {
    expect(slaState({ ...base }, now)).toBe('none')
    expect(slaState({ ...base, slaDueAt: '2026-10-03T11:00:00Z' }, now)).toBe('ok')
    expect(slaState({ ...base, slaDueAt: '2026-10-03T10:10:00Z' }, now)).toBe('due_soon')
    expect(slaState({ ...base, slaDueAt: '2026-10-03T09:59:00Z' }, now)).toBe('breached')
    expect(slaState({ ...base, slaDueAt: '2026-10-03T09:00:00Z', firstRespondedAt: '2026-10-03T08:00:00Z' }, now)).toBe('met')
    expect(slaState({ ...base, slaDueAt: '2026-10-03T09:00:00Z', spam: true }, now)).toBe('none')
  })

  it('puts breached leads first', () => {
    const late = { ...base, id: 'late', slaDueAt: '2026-10-03T09:00:00Z' }
    const soon = { ...base, id: 'soon', slaDueAt: '2026-10-03T10:05:00Z' }
    const fine = { ...base, id: 'fine', slaDueAt: '2026-10-03T12:00:00Z' }
    expect([fine, soon, late].sort((a, b) => compareBySla(a, b, now)).map((l) => l.id)).toEqual(['late', 'soon', 'fine'])
  })

  it('files leads into the inbox tabs', () => {
    expect(inboxTab({ ...base })).toBe('new')
    expect(inboxTab({ ...base, firstRespondedAt: 'x' })).toBe('pipeline')
    expect(inboxTab({ ...base, stage: 'won' })).toBe('closed')
    expect(inboxTab({ ...base, spam: true })).toBe('quarantine')
  })
})

describe('isValidBusinessHours (033)', () => {
  const ok = { tz: 'Asia/Manila', days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' }

  it('accepts the default', () => {
    expect(isValidBusinessHours(ok)).toBe(true)
  })

  it('rejects what the server would', () => {
    expect(isValidBusinessHours({ ...ok, tz: 'Mars/Olympus' })).toBe(false)
    expect(isValidBusinessHours({ ...ok, days: [] })).toBe(false)
    expect(isValidBusinessHours({ ...ok, days: [1, 1] })).toBe(false)
    expect(isValidBusinessHours({ ...ok, days: [0] })).toBe(false)
    expect(isValidBusinessHours({ ...ok, start: '9:00' })).toBe(false)
    expect(isValidBusinessHours({ ...ok, start: '18:00', end: '09:00' })).toBe(false)
    expect(isValidBusinessHours(null)).toBe(false)
  })
})
