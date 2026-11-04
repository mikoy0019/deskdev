import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from './useStore'

const s = () => useStore.getState()
const activityFor = (leadId: string) => s().leadActivity.filter((a) => a.leadId === leadId)

beforeEach(() => {
  useStore.getState().resetSeed()
  // Destructive actions are permission-guarded; act as the seed admin.
  useStore.setState({ currentUserId: useStore.getState().users[0].id })
})

describe('lead event log', () => {
  it('logs a created event when a lead is added', () => {
    const id = s().addLead({ name: 'Acme Co' })
    const events = activityFor(id)
    expect(events).toHaveLength(1)
    expect(events[0].action).toBe('created')
  })

  it('logs stage changes with from/to', () => {
    const id = s().addLead({ name: 'Acme Co' })
    s().moveLeadStage(id, 'contacted')
    const move = activityFor(id).find((a) => a.action === 'stage_changed')!
    expect(move.detail).toMatchObject({ from: 'new', to: 'contacted' })
  })

  it('ignores a no-op stage move', () => {
    const id = s().addLead({ name: 'Acme Co' })
    s().moveLeadStage(id, 'new')
    expect(activityFor(id).filter((a) => a.action === 'stage_changed')).toHaveLength(0)
  })

  it('stamps firstRespondedAt once, on the first move off new', () => {
    const id = s().addLead({ name: 'Acme Co' })
    expect(s().leads.find((l) => l.id === id)!.firstRespondedAt).toBeUndefined()

    s().moveLeadStage(id, 'contacted')
    const first = s().leads.find((l) => l.id === id)!.firstRespondedAt
    expect(first).toBeTruthy()

    // A later move must NOT overwrite the original first-response time.
    s().moveLeadStage(id, 'proposal')
    expect(s().leads.find((l) => l.id === id)!.firstRespondedAt).toBe(first)
  })

  it('touchLead sets firstRespondedAt + lastTouchAt and logs a touch', () => {
    const id = s().addLead({ name: 'Acme Co' })
    s().touchLead(id)
    const l = s().leads.find((x) => x.id === id)!
    expect(l.firstRespondedAt).toBeTruthy()
    expect(l.lastTouchAt).toBeTruthy()
    expect(activityFor(id).some((a) => a.action === 'contacted')).toBe(true)
  })

  it('captures a lost reason and logs it', () => {
    const id = s().addLead({ name: 'Acme Co' })
    s().moveLeadStage(id, 'lost', 'no_decision')
    expect(s().leads.find((l) => l.id === id)!.lostReason).toBe('no_decision')
    const lost = activityFor(id).find((a) => a.action === 'lost')!
    expect(lost.detail).toMatchObject({ reason: 'no_decision' })
  })

  it('clears the lost reason when a lead is revived', () => {
    const id = s().addLead({ name: 'Acme Co' })
    s().moveLeadStage(id, 'lost', 'price')
    s().moveLeadStage(id, 'contacted')
    expect(s().leads.find((l) => l.id === id)!.lostReason).toBeUndefined()
  })

  it('deletes a lead together with its history', () => {
    const id = s().addLead({ name: 'Acme Co' })
    s().moveLeadStage(id, 'contacted')
    expect(activityFor(id).length).toBeGreaterThan(0)
    s().deleteLead(id)
    expect(activityFor(id)).toHaveLength(0)
  })

  it('converting to a client links it and logs the win', () => {
    const id = s().addLead({ name: 'Acme Co', company: 'Acme', email: 'a@acme.com' })
    const clientsBefore = s().clients.length
    s().convertLeadToClient(id)

    const lead = s().leads.find((l) => l.id === id)!
    expect(s().clients.length).toBe(clientsBefore + 1)
    expect(lead.stage).toBe('won')
    expect(lead.clientId).toBeTruthy()
    expect(activityFor(id).some((a) => a.action === 'won')).toBe(true)
  })
})

describe('win dating (regression: wins were dated by updatedAt)', () => {
  it('keeps a May win in May even when the lead is edited in July', () => {
    // Fake timers make the exact bug scenario deterministic: win in one month,
    // harmless edit in a later one.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-05-10T09:00:00Z'))
      const id = s().addLead({ name: 'Acme Co' })
      s().moveLeadStage(id, 'won')

      const wonEvents = activityFor(id).filter((a) => a.action === 'won')
      expect(wonEvents).toHaveLength(1)
      const wonAt = wonEvents[0].createdAt
      expect(wonAt.slice(0, 7)).toBe('2026-05')

      // Two months later someone just fixes the company name.
      vi.setSystemTime(new Date('2026-07-16T09:00:00Z'))
      s().updateLead(id, { name: 'Acme Corporation' })

      const after = activityFor(id).filter((a) => a.action === 'won')
      expect(after).toHaveLength(1)
      expect(after[0].createdAt).toBe(wonAt) // the win stays in May…
      // …while updatedAt moves to July. Dating wins by updatedAt — the old
      // behaviour — would have counted this rename as a brand-new July win.
      expect(s().leads.find((l) => l.id === id)!.updatedAt.slice(0, 7)).toBe('2026-07')
    } finally {
      vi.useRealTimers()
    }
  })

  it('seed has a win in a prior month that updatedAt would misdate', () => {
    // ld-7 was won ~40 days ago but edited yesterday — the exact shape that used
    // to inflate "won this month".
    const lead = s().leads.find((l) => l.id === 'ld-7')!
    const wonEvent = s().leadActivity.find((a) => a.leadId === 'ld-7' && a.action === 'won')!
    expect(lead.stage).toBe('won')
    expect(wonEvent.createdAt.slice(0, 7)).not.toBe(lead.updatedAt.slice(0, 7))
  })
})
