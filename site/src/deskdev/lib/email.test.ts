import { beforeEach, describe, expect, it } from 'vitest'
import { draftError, parseAddresses, replySubject, snippet, threadsOf } from './email'
import { useStore } from '../store/useStore'
import type { Email } from './types'

const mail = (over: Partial<Email>): Email => ({
  id: 'e1', direction: 'out', status: 'sent', toEmails: ['maya@kalye.ph'], ccEmails: [], subject: 'Hello',
  bodyText: 'Hi', createdAt: '2026-10-06T08:00:00Z', updatedAt: '2026-10-06T08:00:00Z', ...over,
})

describe('addresses and drafts', () => {
  it('parses commas, semicolons and spaces; lower-cases and de-duplicates', () => {
    expect(parseAddresses('Maya@Kalye.ph, ben@x.com; maya@kalye.ph  c@y.io')).toEqual(['maya@kalye.ph', 'ben@x.com', 'c@y.io'])
  })

  it('names the first problem with a draft', () => {
    const ok = { to: ['maya@kalye.ph'], cc: [], subject: 'Hi', body: 'Hello' }
    expect(draftError(ok)).toBeNull()
    expect(draftError({ ...ok, to: [] })).toMatch(/recipient/)
    expect(draftError({ ...ok, to: ['maya@'] })).toMatch(/isn’t a valid/)
    expect(draftError({ ...ok, subject: '  ' })).toMatch(/subject/)
    expect(draftError({ ...ok, body: '\n' })).toMatch(/message/)
    expect(draftError({ ...ok, to: Array.from({ length: 11 }, (_, i) => `a${i}@x.com`) })).toMatch(/At most 10/)
  })

  it('prefixes Re: once, and trims snippets', () => {
    expect(replySubject('Your project')).toBe('Re: Your project')
    expect(replySubject('RE: Your project')).toBe('RE: Your project')
    expect(snippet('a\n\nb   c', 10)).toBe('a b c')
    expect(snippet('x'.repeat(20), 10)).toBe(`${'x'.repeat(9)}…`)
  })
})

describe('threadsOf', () => {
  it('groups by Gmail thread, joins an unsent reply to its parent, newest activity first', () => {
    const threads = threadsOf([
      mail({ id: 'a', gmailThreadId: 't1', sentAt: '2026-10-01T08:00:00Z' }),
      mail({ id: 'b', direction: 'in', status: 'received', gmailThreadId: 't1', receivedAt: '2026-10-02T08:00:00Z' }),
      // Queued reply to b: no thread id yet, still part of t1.
      mail({ id: 'c', status: 'queued', inReplyTo: 'b', createdAt: '2026-10-03T08:00:00Z' }),
      mail({ id: 'd', subject: 'Other', gmailThreadId: 't2', sentAt: '2026-09-30T08:00:00Z' }),
    ])
    expect(threads.map((t) => t.key)).toEqual(['t1', 't2'])
    expect(threads[0].messages.map((m) => m.id)).toEqual(['a', 'b', 'c'])
    expect(threads[0].last.id).toBe('c')
  })
})

describe('sendEmail (store, local mode)', () => {
  const s = () => useStore.getState()
  beforeEach(() => {
    s().resetSeed()
    useStore.setState({ currentUserId: s().users[0].id })
  })

  it('queues a valid email on the lead, with the sender name from settings', () => {
    const res = s().sendEmail({ to: ['Maya@Kalye.ph'], subject: ' Next steps ', body: 'Hi Maya', leadId: 'ld-8' })
    expect(res.ok).toBe(true)
    expect(s().emails.find((e) => e.id === res.id)).toMatchObject({
      direction: 'out', status: 'queued', leadId: 'ld-8', toEmails: ['maya@kalye.ph'], subject: 'Next steps',
      fromName: s().workspaceSettings.emailFromName,
    })
  })

  it('refuses without an anchor, a recipient, or edit access', () => {
    expect(s().sendEmail({ to: ['a@x.com'], subject: 'Hi', body: 'x' }).ok).toBe(false)
    expect(s().sendEmail({ to: [], subject: 'Hi', body: 'x', leadId: 'ld-8' }).error).toMatch(/recipient/)
    const member = s().users.find((u) => u.role !== 'admin' && u.permissions.growth !== 'edit')
    if (member) {
      useStore.setState({ currentUserId: member.id })
      expect(s().sendEmail({ to: ['a@x.com'], subject: 'Hi', body: 'x', leadId: 'ld-8' }).ok).toBe(false)
    }
  })

  it('a failed email can only be retried on the live workspace', async () => {
    const res = s().sendEmail({ to: ['a@x.com'], subject: 'Hi', body: 'x', leadId: 'ld-8' })
    useStore.setState((st) => ({ emails: st.emails.map((e) => (e.id === res.id ? { ...e, status: 'failed' } : e)) }))
    expect((await s().retryEmail(res.id!)).error).toMatch(/live workspace/)
  })
})
