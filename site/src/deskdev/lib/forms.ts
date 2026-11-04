import type { Client, Lead, Project } from './types'
import { LEAD_SERVICES, LEAD_TIMELINES, SITE_BUDGET_BANDS } from './leads'

// Form templates (046's form_responses stores the answers, keyed by `form`).
// Templates live in code and are versioned: a stored response keeps the
// version it was written against, and a new version only adds fields or
// relabels them, so old answers still read.
//
//   onboarding  per project, filled in at kickoff (046)
//   discovery   per lead, filled in during the first meeting (047)
//
// Both can go to the customer as a quick form (047): a private link to
// nixgensolutions.com/f/<token> showing only the fields not marked
// `internal`. The site imports this file too (src/app/(site)/f, the
// /api/forms route), so it stays pure: no store, no Supabase, no React.

export type FieldType = 'text' | 'email' | 'tel' | 'textarea' | 'date' | 'number' | 'select' | 'multiselect'

/** Where an answer is also written when the form is completed. */
export type Binding =
  | 'client.email' | 'client.phone' | 'client.company' | 'client.timezone' | 'client.showcaseConsent'
  | 'project.dueDate' | 'project.budget'
  | 'lead.company' | 'lead.phone' | 'lead.services' | 'lead.budgetBand' | 'lead.timeline'

export interface FieldOption {
  value: string
  label: string
}

export interface FormField {
  key: string
  label: string
  type: FieldType
  required?: boolean
  hint?: string
  placeholder?: string
  options?: readonly FieldOption[]
  bind?: Binding
  /** The team's own notes: never on the customer's quick form, never sent to the site. */
  internal?: boolean
}

export interface FormSection {
  key: string
  title: string
  hint?: string
  fields: readonly FormField[]
}

export interface FormTemplate {
  key: string
  version: number
  title: string
  description: string
  sections: readonly FormSection[]
  /** Present when the form can go to the customer as a quick form: what they see. */
  customer?: { title: string; intro: string }
}

const READINESS: FieldOption[] = [
  { value: 'ready', label: 'Ready' },
  { value: 'partly', label: 'Partly' },
  { value: 'none', label: 'Not yet' },
]

export const ONBOARDING_FORM: FormTemplate = {
  key: 'onboarding',
  version: 1,
  title: 'Project onboarding',
  description: 'Everything the team needs before development starts. Fill it in with the client during the kickoff.',
  customer: {
    title: 'Project onboarding',
    intro: 'A few details so we can start building. It takes about five minutes, and the optional questions can stay blank.',
  },
  sections: [
    {
      key: 'contacts',
      title: 'Client and contacts',
      fields: [
        { key: 'contact_name', label: 'Main contact', type: 'text', required: true },
        { key: 'contact_email', label: 'Their email', type: 'email', required: true, bind: 'client.email' },
        { key: 'contact_phone', label: 'Their phone', type: 'tel', bind: 'client.phone' },
        { key: 'company', label: 'Company', type: 'text', bind: 'client.company' },
        { key: 'timezone', label: 'Time zone', type: 'text', placeholder: 'e.g. America/New_York', bind: 'client.timezone' },
        {
          key: 'channel', label: 'Best way to reach them', type: 'select',
          options: [
            { value: 'email', label: 'Email' }, { value: 'whatsapp', label: 'WhatsApp' },
            { value: 'viber', label: 'Viber' }, { value: 'slack', label: 'Slack' },
            { value: 'phone', label: 'Phone' }, { value: 'other', label: 'Other' },
          ],
        },
        { key: 'decision_maker', label: 'Who signs off', type: 'text', hint: 'The person who approves designs and launch.' },
        { key: 'billing_email', label: 'Billing contact', type: 'email' },
      ],
    },
    {
      key: 'scope',
      title: 'The project',
      fields: [
        { key: 'goals', label: 'What should this project achieve?', type: 'textarea', required: true },
        { key: 'scope', label: 'What we are building', type: 'textarea', required: true, hint: 'Pages, features and deliverables agreed for this project.' },
        { key: 'services', label: 'Services', type: 'multiselect', options: LEAD_SERVICES.map((s) => ({ value: s.key, label: s.label })) },
        { key: 'target_launch', label: 'Target launch date', type: 'date', required: true, bind: 'project.dueDate' },
        { key: 'budget', label: 'Agreed budget (USD)', type: 'number', bind: 'project.budget' },
        { key: 'success', label: 'How will we know it worked?', type: 'textarea', hint: 'e.g. more booked calls, fewer manual hours.' },
        { key: 'references', label: 'Sites they like, and competitors', type: 'textarea' },
      ],
    },
    {
      key: 'readiness',
      title: 'Assets and access',
      fields: [
        { key: 'brand_assets', label: 'Logo and brand colours', type: 'select', options: READINESS },
        { key: 'content', label: 'Copy and images', type: 'select', options: [...READINESS, { value: 'we_write', label: 'We write it' }] },
        {
          key: 'domain', label: 'Domain and hosting', type: 'select',
          options: [
            { value: 'client_has', label: 'They have it' },
            { value: 'we_provide', label: 'We set it up' },
            { value: 'unsure', label: 'Not sure' },
          ],
        },
        { key: 'access_needed', label: 'Access we need', type: 'textarea', hint: 'List the accounts only. Passwords go in the Vault, never here.' },
        { key: 'integrations', label: 'Tools to connect', type: 'textarea', placeholder: 'CRM, booking, payments, email…' },
      ],
    },
    {
      key: 'portfolio',
      title: 'Portfolio',
      fields: [
        {
          key: 'portfolio_consent', label: 'May we show this project on our website once it launches?', type: 'select',
          required: true, bind: 'client.showcaseConsent',
          options: [
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No, keep it private' },
            { value: 'later', label: 'Ask again at launch' },
          ],
        },
      ],
    },
    {
      key: 'kickoff',
      title: 'Kickoff',
      fields: [
        { key: 'kickoff_date', label: 'Kickoff call', type: 'date', internal: true },
        { key: 'notes', label: 'Anything else', type: 'textarea' },
      ],
    },
  ],
}

export const DISCOVERY_FORM: FormTemplate = {
  key: 'discovery',
  version: 1,
  title: 'Discovery',
  description: 'Work through it with the lead in the first meeting. The internal section is never shown to them.',
  customer: {
    title: 'Tell us about your project',
    intro: 'Answer what you can before our call, or instead of one. It helps us come back with a clear plan and price.',
  },
  sections: [
    {
      key: 'business',
      title: 'Your business',
      fields: [
        { key: 'company', label: 'Business name', type: 'text', bind: 'lead.company' },
        { key: 'industry', label: 'Industry', type: 'text', placeholder: 'e.g. dental clinic, coffee shops' },
        { key: 'location', label: 'Where you operate', type: 'text' },
        { key: 'team_size', label: 'Team size', type: 'select', options: [
          { value: '1', label: 'Just me' }, { value: '2_10', label: '2–10' },
          { value: '11_50', label: '11–50' }, { value: '50_plus', label: '50+' },
        ] },
        { key: 'phone', label: 'Phone', type: 'tel', bind: 'lead.phone' },
        { key: 'current_site', label: 'Current website', type: 'text', placeholder: 'If you have one' },
      ],
    },
    {
      key: 'goals',
      title: 'Goals',
      fields: [
        { key: 'trigger', label: 'What made you reach out now?', type: 'textarea', required: true },
        { key: 'goals', label: 'What should this project achieve?', type: 'textarea', required: true },
        { key: 'current_tools', label: 'Tools you use today', type: 'textarea', placeholder: 'Booking, CRM, spreadsheets, email…' },
        { key: 'pain_points', label: 'What is not working today?', type: 'textarea' },
      ],
    },
    {
      key: 'project',
      title: 'The project',
      fields: [
        { key: 'services', label: 'What you need', type: 'multiselect', bind: 'lead.services', options: LEAD_SERVICES.map((s) => ({ value: s.key, label: s.label })) },
        { key: 'must_haves', label: 'Must-haves', type: 'textarea' },
        { key: 'references', label: 'Sites or apps you like', type: 'textarea' },
        { key: 'timeline', label: 'When do you need it?', type: 'select', bind: 'lead.timeline', options: LEAD_TIMELINES.map((t) => ({ value: t.key, label: t.label })) },
        // The website's bands: customers answer this at /f/<token>, so it asks what the contact form asks.
        { key: 'budget_band', label: 'Budget range', type: 'select', bind: 'lead.budgetBand', options: SITE_BUDGET_BANDS.map((b) => ({ value: b.key, label: b.label })) },
      ],
    },
    {
      key: 'decision',
      title: 'Deciding',
      fields: [
        { key: 'decision_maker', label: 'Who makes the decision?', type: 'text' },
        { key: 'decision_by', label: 'When do you want to decide?', type: 'date' },
        { key: 'other_options', label: 'Other agencies or options you are considering', type: 'textarea' },
      ],
    },
    {
      key: 'internal',
      title: 'Our notes (internal)',
      hint: 'Never shown to the lead, and never part of the quick form.',
      fields: [
        { key: 'fit', label: 'Fit', type: 'select', internal: true, options: [
          { value: 'good', label: 'Good fit' }, { value: 'maybe', label: 'Maybe' }, { value: 'poor', label: 'Not a fit' },
        ] },
        { key: 'next_step', label: 'Next step', type: 'select', internal: true, options: [
          { value: 'proposal', label: 'Send a proposal' }, { value: 'second_call', label: 'Second call' },
          { value: 'nurture', label: 'Follow up later' }, { value: 'decline', label: 'Decline' },
        ] },
        { key: 'meeting_notes', label: 'Meeting notes', type: 'textarea', internal: true },
      ],
    },
  ],
}

export const FORM_TEMPLATES: Record<string, FormTemplate> = {
  [ONBOARDING_FORM.key]: ONBOARDING_FORM,
  [DISCOVERY_FORM.key]: DISCOVERY_FORM,
}

/**
 * What the customer sees on the quick form: the template without its internal
 * fields (and without sections left empty). Null when the form isn't shareable.
 */
export function customerTemplate(template: FormTemplate): FormTemplate | null {
  if (!template.customer) return null
  const sections = template.sections
    .map((s) => ({ ...s, fields: s.fields.filter((f) => !f.internal) }))
    .filter((s) => s.fields.length > 0)
  return { ...template, title: template.customer.title, description: template.customer.intro, sections }
}

/** Answers restricted to the customer's fields — what may leave the server, and what they may write. */
export function customerAnswers(template: FormTemplate, answers: Answers): Answers {
  const view = customerTemplate(template)
  if (!view) return {}
  return cleanAnswers(view, answers)
}

export type Answers = Record<string, unknown>

export function formFields(template: FormTemplate): FormField[] {
  return template.sections.flatMap((s) => s.fields)
}

export function isAnswered(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'string') return value.trim() !== ''
  if (typeof value === 'number') return Number.isFinite(value)
  return value !== undefined && value !== null && value !== false
}

export function missingRequired(template: FormTemplate, answers: Answers): FormField[] {
  return formFields(template).filter((f) => f.required && !isAnswered(answers[f.key]))
}

export function formProgress(template: FormTemplate, answers: Answers): { done: number; required: number } {
  const required = formFields(template).filter((f) => f.required)
  return { done: required.filter((f) => isAnswered(answers[f.key])).length, required: required.length }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Why a field's value is invalid, or null. Empty is fine here; missingRequired covers it. */
export function fieldError(field: FormField, value: unknown): string | null {
  if (!isAnswered(value)) return null
  if (field.type === 'email' && (typeof value !== 'string' || !EMAIL.test(value.trim()))) return 'Enter a full email address'
  if (field.type === 'date' && (typeof value !== 'string' || !DATE.test(value))) return 'Pick a date'
  if (field.type === 'number' && (typeof value !== 'number' || value < 0)) return 'Enter a positive number'
  if ((field.type === 'select') && field.options && !field.options.some((o) => o.value === value)) return 'Pick one of the options'
  return null
}

/** Known keys only, trimmed, empties dropped, arrays limited to their options. */
export function cleanAnswers(template: FormTemplate, answers: Answers): Answers {
  const out: Answers = {}
  for (const f of formFields(template)) {
    const v = answers[f.key]
    if (!isAnswered(v)) continue
    if (f.type === 'multiselect') {
      const allowed = new Set(f.options?.map((o) => o.value))
      const list = (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string' && allowed.has(x))
      if (list.length) out[f.key] = [...new Set(list)]
    } else if (f.type === 'number') {
      const n = typeof v === 'number' ? v : Number(v)
      if (Number.isFinite(n)) out[f.key] = n
    } else if (typeof v === 'string') {
      out[f.key] = f.type === 'textarea' ? v.trim().slice(0, 5000) : v.trim().slice(0, 300)
    }
  }
  return out
}

const CONSENT: Record<string, Client['showcaseConsent']> = { yes: 'granted', no: 'declined', later: 'unknown' }

/** The client, project and lead fields a completed form writes back (only answered, valid ones). */
export function bindingsOf(
  template: FormTemplate,
  answers: Answers,
): { client: Partial<Client>; project: Partial<Project>; lead: Partial<Lead> } {
  const client: Partial<Client> = {}
  const project: Partial<Project> = {}
  const lead: Partial<Lead> = {}
  for (const f of formFields(template)) {
    const v = answers[f.key]
    if (!f.bind || !isAnswered(v) || fieldError(f, v)) continue
    switch (f.bind) {
      case 'client.email': client.email = String(v); break
      case 'client.phone': client.phone = String(v); break
      case 'client.company': client.company = String(v); break
      case 'client.timezone': client.timezone = String(v); break
      case 'client.showcaseConsent': if (CONSENT[String(v)]) client.showcaseConsent = CONSENT[String(v)]; break
      case 'project.dueDate': project.dueDate = String(v); break
      case 'project.budget': project.budget = Number(v); break
      case 'lead.company': lead.company = String(v); break
      case 'lead.phone': lead.phone = String(v); break
      case 'lead.services': lead.services = (v as string[]).slice(); break
      case 'lead.budgetBand': lead.budgetBand = String(v); break
      case 'lead.timeline': lead.timeline = String(v); break
    }
  }
  return { client, project, lead }
}

/** Discovery answers to start from: what the website enquiry already told us. */
export function discoveryPrefill(
  lead: Pick<Lead, 'company' | 'phone' | 'services' | 'budgetBand' | 'timeline' | 'message'>,
): Answers {
  return cleanAnswers(DISCOVERY_FORM, {
    company: lead.company,
    phone: lead.phone,
    goals: lead.message,
    services: lead.services,
    budget_band: lead.budgetBand,
    timeline: lead.timeline,
  })
}

/**
 * Onboarding answers to start from: what the website enquiry (the lead this
 * client was converted from), the client record and the project already say.
 */
export function onboardingPrefill(input: {
  project: Pick<Project, 'dueDate' | 'budget'>
  client?: Pick<Client, 'name' | 'company' | 'email' | 'phone' | 'timezone' | 'showcaseConsent'>
  lead?: Pick<Lead, 'name' | 'email' | 'phone' | 'company' | 'services' | 'message' | 'value'>
}): Answers {
  const { project, client, lead } = input
  const known = new Set<string>(LEAD_SERVICES.map((s) => s.key))
  const consent = client?.showcaseConsent === 'granted' ? 'yes' : client?.showcaseConsent === 'declined' ? 'no' : undefined
  const raw: Answers = {
    contact_name: lead?.name ?? client?.name,
    contact_email: client?.email ?? lead?.email,
    contact_phone: client?.phone ?? lead?.phone,
    company: client?.company ?? lead?.company,
    timezone: client?.timezone,
    goals: lead?.message,
    services: lead?.services?.filter((s) => known.has(s)),
    target_launch: project.dueDate,
    budget: project.budget ?? (lead && lead.value > 0 ? lead.value : undefined),
    portfolio_consent: consent,
  }
  return cleanAnswers(ONBOARDING_FORM, raw)
}
