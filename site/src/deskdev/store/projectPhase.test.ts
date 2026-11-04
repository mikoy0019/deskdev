import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'

// Local mode: the store is the database, so the stage rules, the form
// write-back and the portfolio draft (037's stand-in) all run here.

const s = () => useStore.getState()
const projectOf = (id: string) => s().projects.find((p) => p.id === id)!

const ANSWERS = {
  contact_name: 'Maya Santos',
  contact_email: 'maya@kalyecoffee.ph',
  contact_phone: '+63 917 555 0142',
  goals: 'Online ordering for three shops',
  scope: 'Ordering site + loyalty',
  target_launch: '2026-12-01',
  budget: 4500,
  portfolio_consent: 'yes',
}

function newProject() {
  const clientId = s().clients[0].id
  return { clientId, id: s().addProject({ clientId, title: 'Kalye ordering site' }) }
}

beforeEach(() => {
  s().resetSeed()
  // The seed admin.
  useStore.setState({ currentUserId: s().users[0].id })
})

describe('project stages', () => {
  it('starts a new project in onboarding', () => {
    const { id } = newProject()
    expect(projectOf(id).phase).toBe('onboarding')
  })

  it('needs the onboarding form submitted before development', () => {
    const { id } = newProject()
    expect(s().setProjectPhase(id, 'development')).toEqual({ ok: false, error: 'Complete the onboarding form first.' })

    // A draft is not enough.
    s().saveFormResponse({ form: 'onboarding', projectId: id, answers: { contact_name: 'Maya' } })
    expect(s().setProjectPhase(id, 'development').ok).toBe(false)

    expect(s().saveFormResponse({ form: 'onboarding', projectId: id, answers: ANSWERS, submit: true }).ok).toBe(true)
    expect(s().setProjectPhase(id, 'development')).toEqual({ ok: true })
    expect(projectOf(id)).toMatchObject({ phase: 'development', status: 'in_progress' })
  })

  it('refuses to submit with required answers missing, and keeps one response per project', () => {
    const { id } = newProject()
    const first = s().saveFormResponse({ form: 'onboarding', projectId: id, answers: { contact_name: 'Maya' }, submit: true })
    expect(first.ok).toBe(false)
    expect(first.error).toMatch(/Still needed/)
    s().saveFormResponse({ form: 'onboarding', projectId: id, answers: { contact_name: 'Maya' } })
    s().saveFormResponse({ form: 'onboarding', projectId: id, answers: ANSWERS, submit: true })
    const responses = s().formResponses.filter((r) => r.projectId === id)
    expect(responses).toHaveLength(1)
    expect(responses[0]).toMatchObject({ status: 'submitted', form: 'onboarding' })
    expect(responses[0].submittedAt).toBeTruthy()
  })

  it('writes the bound answers onto the client and project when submitted', () => {
    const { id, clientId } = newProject()
    s().saveFormResponse({ form: 'onboarding', projectId: id, answers: ANSWERS, submit: true })
    expect(projectOf(id)).toMatchObject({ dueDate: '2026-12-01', budget: 4500 })
    expect(s().clients.find((c) => c.id === clientId)).toMatchObject({
      email: 'maya@kalyecoffee.ph',
      phone: '+63 917 555 0142',
      showcaseConsent: 'granted',
    })
  })

  it('lets only an admin skip onboarding', () => {
    const { id } = newProject()
    const member = s().users.find((u) => u.role !== 'admin')!
    useStore.setState({ currentUserId: member.id })
    expect(s().setProjectPhase(id, 'development', { force: true }).ok).toBe(false)
    useStore.setState({ currentUserId: s().users[0].id })
    expect(s().setProjectPhase(id, 'development', { force: true })).toEqual({ ok: true })
  })

  it('launching marks the work done, keeps the live URL and drafts the portfolio entry', () => {
    const { id } = newProject()
    s().saveFormResponse({ form: 'onboarding', projectId: id, answers: ANSWERS, submit: true })
    s().setProjectPhase(id, 'development')
    expect(s().setProjectPhase(id, 'launched', { liveUrl: 'http://not-https.example' }).ok).toBe(false)
    expect(s().setProjectPhase(id, 'launched', { liveUrl: 'https://order.kalyecoffee.ph' })).toEqual({ ok: true })
    expect(projectOf(id)).toMatchObject({ phase: 'launched', status: 'done', liveUrl: 'https://order.kalyecoffee.ph' })
    const entry = s().showcaseItems.find((i) => i.projectId === id)
    const client = s().clients.find((c) => c.id === projectOf(id).clientId)!
    // Consent came from the onboarding form, via the client record. The card
    // is the client's, as the showcase_on_project() trigger (037) names it.
    expect(entry).toMatchObject({
      title: client.company?.trim() || client.name.trim(),
      url: 'https://order.kalyecoffee.ph',
      consent: 'granted',
    })
  })

  it('never marks a project done without launching it (the Onboarding + Done mix-up)', () => {
    const { id } = newProject()
    const move = s().moveProject(id, 'done', 0)
    expect(move.ok).toBe(false)
    expect(move.error).toMatch(/Development done/)
    const edit = s().updateProject(id, { status: 'done' })
    expect(edit.ok).toBe(false)
    expect(projectOf(id)).toMatchObject({ phase: 'onboarding', status: 'backlog' })
    // Moves inside the stage still work.
    expect(s().moveProject(id, 'waiting', 0)).toEqual({ ok: true })
    expect(s().updateProject(id, { status: 'planning', notes: 'Kickoff Friday' })).toEqual({ ok: true })
    expect(projectOf(id)).toMatchObject({ status: 'planning', notes: 'Kickoff Friday' })
  })

  it('keeps a launched project done until development is reopened', () => {
    const { id } = newProject()
    s().setProjectPhase(id, 'launched')
    expect(s().moveProject(id, 'in_progress', 0).ok).toBe(false)
    expect(s().updateProject(id, { status: 'waiting' }).error).toMatch(/Reopen development/)
    // Other edits still save, and an unchanged status is no change.
    expect(s().updateProject(id, { status: 'done', notes: 'Shipped' })).toEqual({ ok: true })
    expect(s().setProjectPhase(id, 'development')).toEqual({ ok: true })
    expect(projectOf(id)).toMatchObject({ phase: 'development', status: 'in_progress' })
  })

  it('tells the assignee when the stage changes', () => {
    const { id } = newProject()
    const assignee = s().users.find((u) => u.id !== s().currentUserId)!
    s().updateProject(id, { assigneeId: assignee.id })
    s().setProjectPhase(id, 'development', { force: true })
    expect(
      s().notifications.some((n) => n.userId === assignee.id && n.entityId === id && n.title.includes('moved to Development')),
    ).toBe(true)
  })
})

describe('discovery form and customer links', () => {
  it('completing discovery writes timeline, budget and services onto the lead', () => {
    const lead = s().leads.find((l) => l.id === 'ld-8')!
    const result = s().saveFormResponse({
      form: 'discovery',
      leadId: lead.id,
      answers: {
        trigger: 'Third shop opening',
        goals: 'Online ordering',
        timeline: '1_3_months',
        budget_band: '5k_10k',
        services: ['website', 'automation'],
        meeting_notes: 'Price-sensitive, decides with partner',
      },
      submit: true,
    })
    expect(result.ok).toBe(true)
    expect(s().leads.find((l) => l.id === lead.id)).toMatchObject({
      timeline: '1_3_months',
      budgetBand: '5k_10k',
      services: ['website', 'automation'],
    })
    // Internal notes stay on the response.
    expect(s().formResponses.find((r) => r.id === result.id)!.answers.meeting_notes).toBe('Price-sensitive, decides with partner')
  })

  it('refuses a customer link in local mode (the public form needs the database)', async () => {
    const { id } = newProject()
    const result = await s().createFormLink({ form: 'onboarding', projectId: id })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/live workspace/)
  })
})
