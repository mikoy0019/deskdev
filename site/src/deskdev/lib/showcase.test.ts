import { describe, expect, it } from 'vitest'
import {
  compareShowcase, consentAllowsPublishing, isHttpsUrl, publishChecklist, showcaseStatusError, slugify, uniqueSlug,
} from './showcase'
import type { ShowcaseItem, User } from './types'

const admin: User = { id: 'a', fullName: 'Admin', role: 'admin', permissions: {}, createdAt: '' }
const editor: User = { id: 'e', fullName: 'Editor', role: 'member', permissions: { showcase: 'edit' }, createdAt: '' }
const viewer: User = { id: 'v', fullName: 'Viewer', role: 'member', permissions: { showcase: 'view' }, createdAt: '' }
const gone: User = { ...admin, id: 'g', deactivatedAt: '2026-10-01T00:00:00Z' }

describe('showcaseStatusError (037 publish guard)', () => {
  const draft = { status: 'draft' as const, consent: 'granted' as const }
  const live = { status: 'published' as const, consent: 'legacy' as const }

  it('lets an editor draft, ready and hide, but not publish or unpublish', () => {
    expect(showcaseStatusError(editor, draft, 'ready')).toBeNull()
    expect(showcaseStatusError(editor, draft, 'hidden')).toBeNull()
    expect(showcaseStatusError(editor, draft, 'published')).toMatch(/admin/)
    expect(showcaseStatusError(editor, live, 'hidden')).toMatch(/admin/)
  })

  it('lets an admin publish only with consent on record', () => {
    expect(showcaseStatusError(admin, draft, 'published')).toBeNull()
    expect(showcaseStatusError(admin, { status: 'ready', consent: 'unknown' }, 'published')).toMatch(/consent/)
    expect(showcaseStatusError(admin, { status: 'ready', consent: 'declined' }, 'published')).toMatch(/consent/)
  })

  it('refuses viewers and deactivated accounts', () => {
    expect(showcaseStatusError(viewer, draft, 'ready')).toMatch(/edit access/)
    expect(showcaseStatusError(gone, draft, 'published')).toMatch(/edit access/)
  })

  it('treats a no-op move as allowed', () => {
    expect(showcaseStatusError(editor, live, 'published')).toBeNull()
  })
})

describe('consent', () => {
  it('matches the CHECK: granted, legacy and internal may publish', () => {
    expect(['granted', 'legacy', 'internal'].every((c) => consentAllowsPublishing(c as never))).toBe(true)
    expect(consentAllowsPublishing('unknown')).toBe(false)
    expect(consentAllowsPublishing('declined')).toBe(false)
    expect(consentAllowsPublishing(undefined)).toBe(false)
  })
})

describe('publishChecklist', () => {
  it('flags every missing piece', () => {
    const list = publishChecklist({ url: 'https://x.io', linkStatus: 'down', consent: 'unknown', summary: 'x'.repeat(401) })
    expect(Object.fromEntries(list.map((c) => [c.key, c.ok]))).toEqual({
      url: false, image: false, alt: false, consent: false, summary: false,
    })
  })

  it('passes a finished item', () => {
    const list = publishChecklist({
      url: 'https://x.io', linkStatus: 'ok', imageKey: 'items/a.webp', imageAlt: 'Home page', consent: 'granted', summary: 'Fine.',
    })
    expect(list.every((c) => c.ok)).toBe(true)
  })
})

describe('slugs and links', () => {
  it('slugifies like showcase_slugify', () => {
    expect(slugify('Harbor Dental — New Site!')).toBe('harbor-dental-new-site')
    expect(slugify('Café Niño')).toBe('cafe-nino')
    expect(slugify('---')).toBe('')
    expect(slugify('a'.repeat(100))).toHaveLength(80)
  })

  it('finds a free slug', () => {
    expect(uniqueSlug('Acme', [])).toBe('acme')
    expect(uniqueSlug('Acme', ['acme', 'acme-2'])).toBe('acme-3')
    expect(uniqueSlug('!!!', [])).toBe('project')
  })

  it('accepts https links only', () => {
    expect(isHttpsUrl('https://acme.io/path')).toBe(true)
    expect(isHttpsUrl('http://acme.io')).toBe(false)
    expect(isHttpsUrl('javascript:alert(1)')).toBe(false)
    expect(isHttpsUrl('not a url')).toBe(false)
    expect(isHttpsUrl(undefined)).toBe(false)
  })
})

describe('compareShowcase', () => {
  const item = (id: string, over: Partial<ShowcaseItem>): ShowcaseItem => ({
    id, slug: id, kind: 'website', title: id, linkPublic: true, stack: [], status: 'published', featured: false,
    homeFeatured: false, sortOrder: 0, consent: 'legacy', linkStatus: 'ok', linkFailCount: 0,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...over,
  })

  it('orders featured, then sort order, then newest', () => {
    const list = [
      item('old', { sortOrder: 5 }),
      item('new', { sortOrder: 5, createdAt: '2026-06-01T00:00:00Z' }),
      item('first', { sortOrder: 1 }),
      item('star', { featured: true, sortOrder: 99 }),
    ]
    expect(list.sort(compareShowcase).map((i) => i.id)).toEqual(['star', 'first', 'new', 'old'])
  })
})
