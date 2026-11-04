import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'
import type { PermFeature, PermLevel } from '../lib/types'

// Local mode (no Supabase): the store is the database, so these exercise the
// client-side stand-ins for 034's triage and 036's convert_lead, plus the
// allowed() guards every Growth action carries.

const s = () => useStore.getState()
const activityFor = (leadId: string) => s().leadActivity.filter((a) => a.leadId === leadId)
const lead = (id: string) => s().leads.find((l) => l.id === id)!

function actAs(id: string, permissions?: Partial<Record<PermFeature, PermLevel>>) {
  if (permissions) {
    useStore.setState((st) => ({ users: st.users.map((u) => (u.id === id ? { ...u, permissions } : u)) }))
  }
  useStore.setState({ currentUserId: id })
}

beforeEach(() => {
  s().resetSeed()
  actAs('u-admin')
})

describe('lead triage actions', () => {
  it('assignLead logs the change and tells the new owner', () => {
    const id = s().addLead({ name: 'Acme' })
    expect(s().assignLead(id, 'u-member')).toBe(true)
    expect(lead(id).ownerId).toBe('u-member')
    expect(activityFor(id).find((a) => a.action === 'assigned')?.detail).toEqual({ from: null, to: 'u-member' })
    const n = s().notifications.find((x) => x.type === 'lead_assigned' && x.entityId === id)
    expect(n).toMatchObject({ userId: 'u-member', actorId: 'u-admin', entity: 'lead' })
  })

  it('assignLead to the same owner is a no-op', () => {
    const id = s().addLead({ name: 'Acme', ownerId: 'u-member' })
    const before = activityFor(id).length
    expect(s().assignLead(id, 'u-member')).toBe(true)
    expect(activityFor(id)).toHaveLength(before)
  })

  it('setLeadSpam quarantines and releases, logging both', () => {
    const id = s().addLead({ name: 'Bot' })
    expect(s().setLeadSpam(id, true, 'turnstile_failed')).toBe(true)
    expect(lead(id)).toMatchObject({ spam: true, spamReason: 'turnstile_failed' })
    expect(s().setLeadSpam(id, false)).toBe(true)
    expect(lead(id).spam).toBe(false)
    expect(lead(id).spamReason).toBeUndefined()
    expect(activityFor(id).map((a) => a.action)).toEqual(['created', 'spam_marked', 'not_spam'])
  })

  it('setLeadFollowUp sets and clears the date', () => {
    const id = s().addLead({ name: 'Acme' })
    s().setLeadFollowUp(id, '2026-10-10')
    s().setLeadFollowUp(id, undefined)
    expect(lead(id).followUp).toBeUndefined()
    expect(activityFor(id).filter((a) => a.action === 'followup_set').map((a) => a.detail)).toEqual([
      { from: null, to: '2026-10-10' },
      { from: '2026-10-10', to: null },
    ])
  })

  it('logLeadTouch stops the SLA clock and a proposal moves the stage', () => {
    const id = s().addLead({ name: 'Acme', slaDueAt: new Date(Date.now() + 3600_000).toISOString() })
    expect(s().logLeadTouch(id, 'call_logged', { minutes: 15 })).toBe(true)
    const first = lead(id).firstRespondedAt
    expect(first).toBeDefined()
    s().logLeadTouch(id, 'proposal_sent', { url: 'https://docs.example/p' })
    expect(lead(id).firstRespondedAt).toBe(first)
    expect(lead(id).stage).toBe('proposal')
    expect(activityFor(id).map((a) => a.action)).toEqual(['created', 'call_logged', 'proposal_sent', 'stage_changed'])
  })

  it('refuses every triage action without growth:edit', () => {
    const id = s().addLead({ name: 'Acme' })
    actAs('u-member', { growth: 'view', clients: 'edit' })
    const before = activityFor(id).length
    expect(s().assignLead(id, 'u-admin')).toBe(false)
    expect(s().setLeadSpam(id, true)).toBe(false)
    expect(s().setLeadFollowUp(id, '2026-10-10')).toBe(false)
    expect(s().logLeadTouch(id, 'contacted')).toBe(false)
    s().deleteLead(id)
    expect(lead(id)).toBeDefined()
    expect(activityFor(id)).toHaveLength(before)
  })

  it('a deactivated admin can do nothing', () => {
    const id = s().addLead({ name: 'Acme' })
    useStore.setState((st) => ({ users: st.users.map((u) => (u.id === 'u-admin' ? { ...u, deactivatedAt: '2026-10-01T00:00:00Z' } : u)) }))
    expect(s().assignLead(id, 'u-member')).toBe(false)
  })
})

describe('local scoring (stand-in for leads_apply_score)', () => {
  it('scores an intake-style lead on add', () => {
    const id = s().addLead({ name: 'Maya', email: 'maya@kalye.ph', budgetBand: '15k_plus', timeline: 'asap' })
    expect(lead(id)).toMatchObject({ score: 70, hot: true, scoreBreakdown: { budget: 40, timeline: 20, business_email: 10 } })
  })

  it('re-scores an open lead when an input changes, and only turns hot on', () => {
    const id = s().addLead({ name: 'Maya', budgetBand: 'under_1k', timeline: 'exploring' })
    expect(lead(id)).toMatchObject({ score: 0, hot: false })
    s().updateLead(id, { budgetBand: '15k_plus', timeline: 'asap' })
    expect(lead(id)).toMatchObject({ score: 60, hot: true })
    s().updateLead(id, { budgetBand: 'under_1k' })
    expect(lead(id)).toMatchObject({ score: 20, hot: true })
  })

  it('leaves a closed lead’s score alone', () => {
    const id = s().addLead({ name: 'Maya', budgetBand: '3k_7k' })
    s().moveLeadStage(id, 'lost', 'price')
    s().updateLead(id, { budgetBand: '15k_plus' })
    expect(lead(id).score).toBe(20)
  })
})

describe('convertLead — local fallback (036 mirrored)', () => {
  it('creates the client, a "<Company> - <service>" project and the starter tasks', async () => {
    const id = s().addLead({
      name: 'Maya Santos', company: 'Kalye Coffee', email: 'maya@kalye.ph', value: 4000,
      services: ['website', 'automation'], ownerId: 'u-member', message: 'We need online ordering.',
    })
    const res = await s().convertLead(id)
    expect(res.ok).toBe(true)
    const client = s().clients.find((c) => c.id === res.clientId)!
    expect(client).toMatchObject({ name: 'Maya Santos', company: 'Kalye Coffee', email: 'maya@kalye.ph' })
    const project = s().projects.find((p) => p.id === res.projectId)!
    expect(project).toMatchObject({ title: 'Kalye Coffee - Website', status: 'planning', budget: 4000, assigneeId: 'u-member', clientId: client.id })
    expect(project.notes).toBe('From the enquiry:\nWe need online ordering.')
    const tasks = s().tasks.filter((t) => t.projectId === project.id)
    expect(tasks.map((t) => t.title)).toEqual([
      'Kickoff call with Kalye Coffee',
      'Request access and store credentials in the Vault',
      'Write the discovery doc',
      'Collect brand assets and page content',
      'Agree the sitemap and page list',
    ])
    expect(tasks[0].priority).toBe('high')
    expect(tasks.every((t) => t.assigneeId === 'u-member')).toBe(true)
    expect(lead(id)).toMatchObject({ stage: 'won', clientId: client.id })
    const converted = activityFor(id).find((a) => a.action === 'converted')!
    expect(converted.detail).toMatchObject({ client_id: client.id, project_id: project.id, service: 'website', new_client: true })
    expect(activityFor(id).some((a) => a.action === 'won')).toBe(true)
  })

  it('takes an explicit service', async () => {
    const id = s().addLead({ name: 'Acme', company: 'Acme', services: ['website'] })
    const res = await s().convertLead(id, 'Automation')
    expect(s().projects.find((p) => p.id === res.projectId)!.title).toBe('Acme - Automation & AI')
  })

  it('is idempotent: converting twice returns the same client and project', async () => {
    const id = s().addLead({ name: 'Acme', company: 'Acme' })
    const first = await s().convertLead(id)
    const clients = s().clients.length
    const second = await s().convertLead(id)
    expect(second).toEqual(first)
    expect(s().clients).toHaveLength(clients)
  })

  it('converts into the existing client an enquiry matched, under their name', async () => {
    const existing = s().clients[0]
    const id = s().addLead({ name: 'Someone', company: 'Typed Co', existingClientId: existing.id })
    const clients = s().clients.length
    const res = await s().convertLead(id, 'app')
    expect(res.clientId).toBe(existing.id)
    expect(s().clients).toHaveLength(clients)
    const name = existing.company?.trim() || existing.name
    expect(s().projects.find((p) => p.id === res.projectId)!.title).toBe(`${name} - App / dashboard`)
    expect(activityFor(id).find((a) => a.action === 'converted')!.detail.new_client).toBe(false)
  })

  it('refuses a quarantined lead', async () => {
    const id = s().addLead({ name: 'Bot', spam: true })
    const res = await s().convertLead(id)
    expect(res).toEqual({ ok: false, error: 'Mark this lead as not spam before converting it' })
  })

  it('needs growth:edit and clients:edit', async () => {
    const id = s().addLead({ name: 'Acme' })
    const clients = s().clients.length
    actAs('u-member', { growth: 'edit', clients: 'view' })
    expect((await s().convertLead(id)).ok).toBe(false)
    actAs('u-member', { growth: 'edit', clients: 'edit' })
    expect((await s().convertLead(id)).ok).toBe(true)
    expect(s().clients).toHaveLength(clients + 1)
  })

  it('convertLeadToClient (the old entry point) still lands synchronously', () => {
    const id = s().addLead({ name: 'Acme', company: 'Acme' })
    s().convertLeadToClient(id)
    expect(lead(id).clientId).toBeDefined()
  })

  it('a missing lead is an error, not a throw', async () => {
    expect(await s().convertLead('nope')).toEqual({ ok: false, error: 'Lead not found' })
  })
})
