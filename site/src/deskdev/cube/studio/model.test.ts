import { describe, expect, it } from 'vitest'
import type { User } from '../../lib/types'
import {
  approveStudioContent, emptyStudioBook, parseStudioBook, recordStudioPublication,
  saveStudioCase, saveStudioContent, transitionStudioCase, type CaseInput, type ContentInput,
} from './model'

const admin: User = { id: 'admin', fullName: 'Admin', role: 'admin', permissions: {}, createdAt: '2026-01-01' }
const member: User = { ...admin, id: 'member', role: 'member', permissions: { growth: 'edit', projects: 'edit' } }
const now = '2026-10-08T00:00:00.000Z'
const input: CaseInput = { kind: 'handoff', title: 'Confirm onboarding inputs', department: 'Client Success', ownerId: admin.id, nextStep: 'Obtain client assets and record acceptance.', reviewOn: '2026-10-09', sourceUrl: 'https://example.com/project' }
const draft: ContentInput = { title: 'Project story', channel: 'LinkedIn', account: 'NixGen company page', objective: 'Share approved project work', caption: 'A description entered by the owner.', assetUrl: 'https://example.com/asset', scheduleAt: '2026-10-09T01:00:00.000Z' }

describe('admin workflow planning', () => {
  it('records ownership, acceptance, blockers, and verified resolution', () => {
    let book = saveStudioCase(emptyStudioBook(), input, admin, [admin], now)
    book = transitionStudioCase(book, book.cases[0], 'accepted', 'Receiving team confirmed ownership in meeting.', admin, now)
    book = transitionStudioCase(book, book.cases[0], 'waiting', 'Client assets are still outstanding.', admin, now)
    expect(() => transitionStudioCase(book, book.cases[0], 'resolved', '', admin, now)).toThrow('evidence')
    book = transitionStudioCase(book, book.cases[0], 'resolved', 'Assets received and checked against the brief.', admin, now)
    expect(book.cases[0].status).toBe('resolved')
    expect(book.events).toHaveLength(4)
    expect(parseStudioBook(JSON.stringify(book))).toEqual(book)
  })
  it('rejects non-admins, inactive owners, stale actions, and duplicate active sources', () => {
    expect(() => saveStudioCase(emptyStudioBook(), input, member, [admin], now)).toThrow('admin')
    expect(() => saveStudioCase(emptyStudioBook(), input, admin, [{ ...admin, deactivatedAt: now }], now)).toThrow('active owner')
    const book = saveStudioCase(emptyStudioBook(), input, admin, [admin], now)
    expect(() => saveStudioCase(book, input, admin, [admin], now)).toThrow('already')
    const accepted = transitionStudioCase(book, book.cases[0], 'accepted', 'Accepted in review.', admin, now)
    expect(() => transitionStudioCase(accepted, book.cases[0], 'resolved', 'Complete.', admin, now)).toThrow('changed')
  })
  it('locks resolved evidence and requires an admin Finance owner', () => {
    const book = saveStudioCase(emptyStudioBook(), input, admin, [admin], now)
    const resolved = transitionStudioCase(book, book.cases[0], 'resolved', 'All prerequisites verified.', admin, now)
    expect(() => saveStudioCase(resolved, input, admin, [admin], now, resolved.cases[0])).toThrow('resolved')
    expect(() => saveStudioCase(emptyStudioBook(), { ...input, department: 'Finance', ownerId: member.id }, admin, [member], now)).toThrow('admin owner')
  })
})

describe('content approval and manual publishing records', () => {
  it('requires exact approval, invalidates edited drafts, and never automatically publishes', () => {
    const book = saveStudioContent(emptyStudioBook(), draft, admin, now)
    expect(() => recordStudioPublication(book, book.content[0], 'https://linkedin.com/posts/example', admin, now)).toThrow('Approve')
    const approved = approveStudioContent(book, book.content[0], admin, now)
    expect(approved.content[0].status).toBe('approved')
    const changed = saveStudioContent(approved, { ...draft, account: 'Another account' }, admin, now, approved.content[0])
    expect(changed.content[0].status).toBe('draft')
    expect(changed.content[0].approvedVersion).toBeUndefined()
    expect(() => recordStudioPublication(changed, approved.content[0], 'https://linkedin.com/posts/example', admin, now)).toThrow('changed')
  })
  it('records a verified public URL, protects history, and rejects members with edit permission', () => {
    expect(() => saveStudioContent(emptyStudioBook(), draft, member, now)).toThrow('admin')
    let book = saveStudioContent(emptyStudioBook(), draft, admin, now)
    book = approveStudioContent(book, book.content[0], admin, now)
    expect(() => recordStudioPublication(book, book.content[0], 'javascript:alert(1)', admin, now)).toThrow()
    book = recordStudioPublication(book, book.content[0], 'https://linkedin.com/posts/example', admin, now)
    expect(book.content[0].publishedUrl).toBe('https://linkedin.com/posts/example')
    expect(book.events[2].action).toBe('publication_recorded')
    expect(parseStudioBook(JSON.stringify(book))).toEqual(book)
    expect(() => saveStudioContent(book, draft, admin, now, book.content[0])).toThrow('Published')
    expect(() => parseStudioBook('{broken')).toThrow()
  })
})
