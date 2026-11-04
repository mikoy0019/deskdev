import type { ShowcaseConsent, ShowcaseItem, ShowcaseStatus, User } from './types'
import { can, isAdmin } from './permissions'

// Pure showcase rules (037). The database enforces the same ones — the
// publish-guard trigger and the consent CHECK — so these exist to keep the
// UI honest and the local store consistent, not as the security boundary.
// Not to be confused with site/src/lib/showcase.ts, the public site's reader.

/** Consent values that allow an item onto the public site (the CHECK in 037). */
export const PUBLISHABLE_CONSENT: readonly ShowcaseConsent[] = ['granted', 'legacy', 'internal']

export const MAX_SHOWCASE_SUMMARY = 400

export function consentAllowsPublishing(consent: ShowcaseConsent | undefined): boolean {
  return PUBLISHABLE_CONSENT.includes(consent ?? 'unknown')
}

/**
 * Why `user` may not move an item from `from` to `to`, or null when allowed.
 * Publishing and unpublishing are admin-only; drafting, readying, hiding an
 * unpublished item and archiving need showcase:edit.
 */
export function showcaseStatusError(
  user: User | null | undefined,
  item: Pick<ShowcaseItem, 'status' | 'consent'>,
  to: ShowcaseStatus,
): string | null {
  if (!can(user, 'showcase', 'edit')) return 'You need edit access to the Showcase.'
  if (item.status === to) return null
  const publishing = to === 'published'
  const unpublishing = item.status === 'published'
  if ((publishing || unpublishing) && !isAdmin(user)) {
    return 'Only an admin can publish or unpublish a showcase item.'
  }
  if (publishing && !consentAllowsPublishing(item.consent)) {
    return 'This item needs the client’s consent before it can be published.'
  }
  return null
}

export interface ChecklistItem {
  key: 'url' | 'image' | 'alt' | 'consent' | 'summary'
  label: string
  ok: boolean
}

/**
 * The publish checklist shown before an admin publishes. Only consent is
 * enforced by the database; the rest keeps the public page from looking
 * half-finished. `linkStatus` stands in for "URL reachable".
 */
export function publishChecklist(item: Partial<ShowcaseItem>): ChecklistItem[] {
  const summary = item.summary?.trim() ?? ''
  return [
    { key: 'url', label: 'Live link reachable', ok: Boolean(item.url) && item.linkStatus !== 'down' },
    { key: 'image', label: 'Screenshot uploaded', ok: Boolean(item.imageKey) },
    { key: 'alt', label: 'Image has alt text', ok: Boolean(item.imageAlt?.trim()) },
    { key: 'consent', label: 'Client consent recorded', ok: consentAllowsPublishing(item.consent) },
    {
      key: 'summary',
      label: `Summary written (${MAX_SHOWCASE_SUMMARY} characters max)`,
      ok: summary.length > 0 && summary.length <= MAX_SHOWCASE_SUMMARY,
    },
  ]
}

/** "Harbor Dental — New Site!" → "harbor-dental-new-site". */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '')
}

/** A slug for `title` not already in `taken`: "acme", then "acme-2", "acme-3"… */
export function uniqueSlug(title: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  const base = slugify(title) || 'project'
  if (!used.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!used.has(candidate)) return candidate
  }
}

/** projects.live_url and showcase links are https only (037's CHECK). */
export function isHttpsUrl(value: string | undefined): boolean {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && Boolean(url.hostname)
  } catch {
    return false
  }
}

/** Featured first, then curation order, then newest — the site's order too. */
export function compareShowcase(a: ShowcaseItem, b: ShowcaseItem): number {
  if (a.featured !== b.featured) return a.featured ? -1 : 1
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
  return b.createdAt.localeCompare(a.createdAt)
}
