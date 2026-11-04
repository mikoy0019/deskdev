import { describe, expect, it } from 'vitest'
import type { ShowcaseItem } from '../../lib/types'
import {
  caseStudyFromDraft, draftFromItem, isDirty, matchesSearch, parseStack, patchFromDraft, statusCounts, validateDraft,
} from './showcaseForm'

const item: ShowcaseItem = {
  id: 'i1', slug: 'acme', kind: 'website', title: 'Acme', url: 'https://acme.test', linkPublic: true,
  stack: ['Next.js', 'Supabase'], status: 'draft', featured: false, homeFeatured: false, sortOrder: 20,
  consent: 'unknown', linkStatus: 'unknown', linkFailCount: 0, createdAt: '2026-01-01', updatedAt: '2026-01-01',
  summary: 'A site.', caseStudy: { challenge: 'Slow', extra: 'kept', metrics: [{ label: 'Speed', value: '2x' }] },
}

describe('showcaseForm', () => {
  it('round-trips an item without marking it dirty', () => {
    const draft = draftFromItem(item)
    expect(isDirty(draft, item)).toBe(false)
    expect(isDirty({ ...draft, title: 'Acme 2' }, item)).toBe(true)
    const patch = patchFromDraft(draft, item)
    expect(patch.title).toBe('Acme')
    expect(patch.stack).toEqual(['Next.js', 'Supabase'])
    expect(patch.sortOrder).toBe(20)
    expect('slug' in patch).toBe(false)
    expect('status' in patch).toBe(false)
    expect('publicUrl' in patch).toBe(false)
  })

  it('clears emptied optional fields with an explicit undefined', () => {
    const patch = patchFromDraft({ ...draftFromItem(item), url: ' ', summary: '' }, item)
    expect('url' in patch && patch.url === undefined).toBe(true)
    expect('summary' in patch && patch.summary === undefined).toBe(true)
  })

  it('parses the stack: trims, drops blanks and case-insensitive repeats', () => {
    expect(parseStack(' Next.js, Supabase,, next.js ,')).toEqual(['Next.js', 'Supabase'])
    expect(parseStack('')).toEqual([])
  })

  it('validates title, https link, summary length, order, quote and metrics', () => {
    const base = draftFromItem(item)
    expect(validateDraft(base)).toEqual({})
    expect(validateDraft({ ...base, title: ' ' }).title).toBeTruthy()
    expect(validateDraft({ ...base, url: 'http://acme.test' }).url).toBeTruthy()
    expect(validateDraft({ ...base, url: '' }).url).toBeUndefined()
    expect(validateDraft({ ...base, summary: 'x'.repeat(401) }).summary).toBeTruthy()
    expect(validateDraft({ ...base, sortOrder: '1.5' }).sortOrder).toBeTruthy()
    expect(validateDraft({ ...base, quoteText: 'Great' }).quote).toBeTruthy()
    expect(validateDraft({ ...base, quoteText: 'Great', quoteAuthor: 'Ana' }).quote).toBeUndefined()
    expect(validateDraft({ ...base, metrics: [{ label: 'Speed', value: '' }] }).metrics).toBeTruthy()
  })

  it('refuses to save a live item without publishable consent', () => {
    const base = draftFromItem(item)
    expect(validateDraft(base, 'published').consent).toBeTruthy()
    expect(validateDraft({ ...base, consent: 'granted' }, 'published').consent).toBeUndefined()
    expect(validateDraft({ ...base, consent: 'declined' }, 'ready').consent).toBeUndefined()
  })

  it('builds the case study: keeps unknown keys, caps metrics, needs a full quote', () => {
    const draft = draftFromItem(item)
    const many = Array.from({ length: 8 }, (_, i) => ({ label: `L${i}`, value: `${i}` }))
    const cs = caseStudyFromDraft({ ...draft, metrics: many, quoteText: 'Great', quoteAuthor: '' }, item.caseStudy)
    expect(cs?.extra).toBe('kept')
    expect(cs?.metrics).toHaveLength(6)
    expect(cs?.quote).toBeUndefined()
    const quoted = caseStudyFromDraft({ ...draft, quoteText: 'Great', quoteAuthor: 'Ana', quoteRole: ' ' })
    expect(quoted?.quote).toEqual({ text: 'Great', author: 'Ana' })
    expect(caseStudyFromDraft({ ...draft, challenge: '', metrics: [] })).toBeUndefined()
  })

  it('counts statuses and searches title, industry and stack', () => {
    expect(statusCounts([item, { ...item, status: 'ready' }, { ...item, status: 'ready' }])).toMatchObject({
      all: 3, draft: 1, ready: 2, published: 0,
    })
    expect(matchesSearch(item, 'supa')).toBe(true)
    expect(matchesSearch(item, ' ACME ')).toBe(true)
    expect(matchesSearch(item, 'bakery')).toBe(false)
  })
})
