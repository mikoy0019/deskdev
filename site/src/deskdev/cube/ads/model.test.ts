import { describe, expect, it } from 'vitest'
import type { Client, Lead, User } from '../../lib/types'
import {
  adOutreachDraft, adReviewBlocker, adWebUrl, emptyAdBook, existingAdRelationship,
  parseAdBook, reviewAdOpportunity, saveAdOpportunity, type AdInput,
} from './model'

const user: User = { id: 'editor', fullName: 'Editor', role: 'admin', permissions: {}, createdAt: '2026-01-01' }
const input: AdInput = { business: 'Example Cafe', source: 'meta', adUrl: 'https://www.facebook.com/ads/library/?id=123', landingUrl: 'https://example.com/offer', signal: 'broken_destination', evidence: 'The advertised offer link returned a 404 when reviewed.', observedOn: '2026-10-08', contactUrl: 'https://example.com/contact' }
const now = '2026-10-08T04:00:00.000Z'
const day = '2026-10-08'
const saved = () => saveAdOpportunity(emptyAdBook(), input, user, now, day)

describe('ad opportunity review', () => {
  it('records evidence, matches a service, and never claims known ad performance', () => {
    const row = saved().opportunities[0]
    expect(row.status).toBe('needs_review')
    expect(adOutreachDraft(row)).toContain(input.evidence)
    expect(adOutreachDraft(row)).not.toContain('poor results')
    expect(parseAdBook(JSON.stringify(saved()), user.id).opportunities).toHaveLength(1)
  })
  it('rejects scripts, credentials, and local network links', () => {
    for (const value of ['javascript:alert(1)', 'https://user:pass@example.com/', 'http://127.0.0.1/', 'http://192.168.1.1/', 'https://localhost/', 'https://[::1]/']) expect(() => adWebUrl(value)).toThrow()
  })
  it('deduplicates businesses across ad links and suppressed domains', () => {
    const book = saved()
    expect(() => saveAdOpportunity(book, { ...input, landingUrl: 'https://www.example.com/other' }, user, now, day)).toThrow('already')
    const suppressed = reviewAdOpportunity(book, book.opportunities[0], 'do_not_contact', user, now, day, null, true)
    expect(() => saveAdOpportunity(suppressed, { ...input, landingUrl: 'https://second-domain.com' }, user, now, day)).toThrow('already')
  })
  it('requires edit permission and valid dated observations', () => {
    expect(() => saveAdOpportunity(emptyAdBook(), input, { ...user, role: 'member', permissions: { growth: 'edit' } }, now, day)).toThrow('admin')
    expect(() => saveAdOpportunity(emptyAdBook(), { ...input, observedOn: '2026-02-30' }, user, now, day)).toThrow('date')
    expect(() => saveAdOpportunity(emptyAdBook(), { ...input, observedOn: '2026-10-09' }, user, now, day)).toThrow('date')
  })
  it('blocks outreach for stale evidence, unknown relationships, or missing contacts', () => {
    const row = saved().opportunities[0]
    expect(adReviewBlocker(row, '2026-10-23', null, true)).toContain('Recheck')
    expect(adReviewBlocker(row, day, null, false)).toContain('Load')
    expect(adReviewBlocker({ ...row, contactUrl: '' }, day, null, true)).toContain('contact')
  })
  it('finds existing leads and clients without inventing a match', () => {
    const lead = { id: 'lead', name: 'Example Café', company: 'Example Cafe' } as Lead
    const client = { id: 'client', name: 'Example Cafe' } as Client
    expect(existingAdRelationship(input, [lead], [])).toEqual({ kind: 'lead', id: 'lead' })
    expect(existingAdRelationship(input, [lead], [client])).toEqual({ kind: 'client', id: 'client' })
    expect(existingAdRelationship(input, [], [])).toBeNull()
  })
  it('approves an exact version and invalidates approval after editing evidence', () => {
    const book = saved()
    const approved = reviewAdOpportunity(book, book.opportunities[0], 'approved', user, now, day, null, true)
    expect(approved.opportunities[0].approvedRevision).toBe(1)
    const edited = saveAdOpportunity(approved, { ...input, evidence: 'The destination now loads but the booking link is broken.' }, user, now, day, approved.opportunities[0])
    expect(edited.opportunities[0].status).toBe('needs_review')
    expect(edited.opportunities[0].approvedRevision).toBeUndefined()
    expect(() => reviewAdOpportunity(edited, approved.opportunities[0], 'contacted', user, now, day, null, true)).toThrow('changed')
  })
  it('requires approval before contact and preserves do-not-contact suppression', () => {
    const book = saved()
    expect(() => reviewAdOpportunity(book, book.opportunities[0], 'contacted', user, now, day, null, true)).toThrow('Approve')
    const approved = reviewAdOpportunity(book, book.opportunities[0], 'approved', user, now, day, null, true)
    const contacted = reviewAdOpportunity(approved, approved.opportunities[0], 'contacted', user, now, day, null, true)
    expect(contacted.opportunities[0].contactedAt).toBe(now)
    const suppressed = reviewAdOpportunity(contacted, contacted.opportunities[0], 'do_not_contact', user, now, day, null, true)
    expect(() => saveAdOpportunity(suppressed, input, user, now, day, suppressed.opportunities[0])).toThrow('cannot be edited')
  })
  it('does not overwrite corrupt or another account’s storage', () => {
    expect(() => parseAdBook('{broken', user.id)).toThrow()
    expect(() => parseAdBook(JSON.stringify(saved()), 'other')).toThrow()
  })
})
