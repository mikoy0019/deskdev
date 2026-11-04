import { describe, expect, it } from 'vitest'
import {
  DISCOVERY_FORM, FORM_TEMPLATES, ONBOARDING_FORM, bindingsOf, cleanAnswers, customerAnswers, customerTemplate,
  discoveryPrefill, fieldError, formFields, formProgress, missingRequired, onboardingPrefill,
} from './forms'
import { phaseOf, statusOnEntering } from './projectPhase'

const field = (key: string) => formFields(ONBOARDING_FORM).find((f) => f.key === key)!

const COMPLETE = {
  contact_name: 'Maya Santos',
  contact_email: 'maya@kalyecoffee.ph',
  goals: 'Online ordering for three shops',
  scope: 'Ordering site + loyalty',
  target_launch: '2026-12-01',
  portfolio_consent: 'yes',
}

describe('onboarding form', () => {
  it('has unique field keys', () => {
    const keys = formFields(ONBOARDING_FORM).map((f) => f.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('lists what is still required, and counts progress', () => {
    expect(missingRequired(ONBOARDING_FORM, {}).map((f) => f.key)).toEqual([
      'contact_name', 'contact_email', 'goals', 'scope', 'target_launch', 'portfolio_consent',
    ])
    expect(missingRequired(ONBOARDING_FORM, COMPLETE)).toEqual([])
    expect(formProgress(ONBOARDING_FORM, { contact_name: 'Maya', goals: '  ' })).toEqual({ done: 1, required: 6 })
  })

  it('validates emails, dates, numbers and select values', () => {
    expect(fieldError(field('contact_email'), 'maya@')).toMatch(/email/)
    expect(fieldError(field('contact_email'), 'maya@kalye.ph')).toBeNull()
    expect(fieldError(field('target_launch'), '12/01/2026')).toMatch(/date/)
    expect(fieldError(field('budget'), -5)).toMatch(/positive/)
    expect(fieldError(field('portfolio_consent'), 'maybe')).toMatch(/options/)
    expect(fieldError(field('contact_email'), '')).toBeNull()
  })

  it('keeps known keys only, trims, drops empties, and filters multiselects to their options', () => {
    expect(
      cleanAnswers(ONBOARDING_FORM, {
        contact_name: '  Maya  ',
        goals: '',
        services: ['website', 'website', 'not-a-service'],
        budget: '4500',
        evil: 'x',
      }),
    ).toEqual({ contact_name: 'Maya', services: ['website'], budget: 4500 })
  })

  it('writes bound answers back onto the client and project', () => {
    expect(bindingsOf(ONBOARDING_FORM, { ...COMPLETE, contact_phone: '+63 917 555 0142', budget: 4500 })).toEqual({
      client: { email: 'maya@kalyecoffee.ph', phone: '+63 917 555 0142', showcaseConsent: 'granted' },
      project: { dueDate: '2026-12-01', budget: 4500 },
      lead: {},
    })
    expect(bindingsOf(ONBOARDING_FORM, { portfolio_consent: 'no' }).client).toEqual({ showcaseConsent: 'declined' })
    expect(bindingsOf(ONBOARDING_FORM, { portfolio_consent: 'later' }).client).toEqual({ showcaseConsent: 'unknown' })
    // An invalid answer is never written back.
    expect(bindingsOf(ONBOARDING_FORM, { contact_email: 'nope' }).client).toEqual({})
  })

  it('prefills from the website enquiry, the client and the project', () => {
    const answers = onboardingPrefill({
      project: { dueDate: '2026-12-01' },
      client: { name: 'Kalye Coffee', company: 'Kalye Coffee Co.', showcaseConsent: 'granted' },
      lead: {
        name: 'Maya Santos', email: 'maya@kalyecoffee.ph', phone: '+63 917', company: 'Kalye',
        services: ['website', 'dashboard', 'unknown'], message: 'Online ordering', value: 3000,
      },
    })
    expect(answers).toEqual({
      contact_name: 'Maya Santos',
      contact_email: 'maya@kalyecoffee.ph',
      contact_phone: '+63 917',
      company: 'Kalye Coffee Co.',
      goals: 'Online ordering',
      services: ['website', 'dashboard'],
      target_launch: '2026-12-01',
      budget: 3000,
      portfolio_consent: 'yes',
    })
  })
})

describe('discovery form', () => {
  it('writes timeline, budget and services back onto the lead', () => {
    expect(
      bindingsOf(DISCOVERY_FORM, { timeline: 'asap', budget_band: '5k_10k', services: ['website'], company: 'Kalye', fit: 'good' }).lead,
    ).toEqual({ timeline: 'asap', budgetBand: '5k_10k', services: ['website'], company: 'Kalye' })
  })

  it('prefills from the website enquiry', () => {
    expect(
      discoveryPrefill({ company: 'Kalye', services: ['website', 'nope'], budgetBand: '2_5k_5k', timeline: 'asap', message: 'Ordering' }),
    ).toEqual({ company: 'Kalye', services: ['website'], budget_band: '2_5k_5k', timeline: 'asap', goals: 'Ordering' })
  })
})

describe('quick forms (what the customer sees)', () => {
  it('every template key is unique across templates, and shareable ones have customer copy', () => {
    for (const t of Object.values(FORM_TEMPLATES)) {
      const keys = formFields(t).map((f) => f.key)
      expect(new Set(keys).size, t.key).toBe(keys.length)
      expect(t.customer, t.key).toBeTruthy()
    }
  })

  it('drops internal fields, and sections left empty', () => {
    const view = customerTemplate(DISCOVERY_FORM)!
    const keys = formFields(view).map((f) => f.key)
    expect(keys).not.toContain('meeting_notes')
    expect(keys).not.toContain('fit')
    expect(view.sections.map((s) => s.key)).not.toContain('internal')
    expect(view.title).toBe(DISCOVERY_FORM.customer!.title)
    expect(formFields(customerTemplate(ONBOARDING_FORM)!).map((f) => f.key)).not.toContain('kickoff_date')
  })

  it('never lets internal answers out, or in', () => {
    const stored = { company: 'Kalye', meeting_notes: 'Price-sensitive', fit: 'maybe' }
    expect(customerAnswers(DISCOVERY_FORM, stored)).toEqual({ company: 'Kalye' })
    expect(customerAnswers(DISCOVERY_FORM, { meeting_notes: 'overwrite', goals: 'More bookings' })).toEqual({ goals: 'More bookings' })
  })
})

describe('project stage helpers', () => {
  it('reads rows from before 046 without sending finished work back to onboarding', () => {
    expect(phaseOf({ status: 'done' })).toBe('launched')
    expect(phaseOf({ status: 'planning' })).toBe('development')
    expect(phaseOf({ status: 'planning', phase: 'onboarding' })).toBe('onboarding')
  })

  it('moves the work column with the stage', () => {
    expect(statusOnEntering('development', 'planning')).toBe('in_progress')
    expect(statusOnEntering('development', 'waiting')).toBe('waiting')
    expect(statusOnEntering('launched', 'in_progress')).toBe('done')
    expect(statusOnEntering('onboarding', 'done')).toBe('planning')
  })
})
