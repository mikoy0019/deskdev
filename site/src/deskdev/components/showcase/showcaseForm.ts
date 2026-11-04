import { consentAllowsPublishing, isHttpsUrl, MAX_SHOWCASE_SUMMARY } from '../../lib/showcase'
import type {
  ShowcaseCaseStudy, ShowcaseConsent, ShowcaseImageSource, ShowcaseItem, ShowcaseKind, ShowcaseStatus,
} from '../../lib/types'

// Pure form rules for the showcase editor: what the modal holds while someone
// types (strings), how that becomes a patch, and what is refused before the
// store is asked. Kept free of React so the rules are unit-tested.

/** The public site reads at most this many case-study metrics. */
export const MAX_METRICS = 6
/** 037's CHECK on consent_note. */
export const MAX_CONSENT_NOTE = 1000

export interface MetricDraft {
  label: string
  value: string
}

export interface ShowcaseDraft {
  title: string
  slug: string
  kind: ShowcaseKind
  url: string
  linkPublic: boolean
  industry: string
  summary: string
  resultTag: string
  /** Comma-separated while editing. */
  stack: string
  launchedOn: string
  imageAlt: string
  imageSource: ShowcaseImageSource | ''
  featured: boolean
  homeFeatured: boolean
  sortOrder: string
  consent: ShowcaseConsent
  consentNote: string
  clientId: string
  challenge: string
  approach: string
  outcome: string
  metrics: MetricDraft[]
  quoteText: string
  quoteAuthor: string
  quoteRole: string
}

export type DraftErrors = Partial<Record<
  'title' | 'url' | 'summary' | 'sortOrder' | 'consentNote' | 'quote' | 'metrics' | 'consent', string
>>

const text = (v: unknown): string => (typeof v === 'string' ? v : '')

export function draftFromItem(item?: ShowcaseItem | null): ShowcaseDraft {
  const cs = item?.caseStudy ?? {}
  return {
    title: item?.title ?? '',
    slug: item?.slug ?? '',
    kind: item?.kind ?? 'website',
    url: item?.url ?? '',
    linkPublic: item?.linkPublic ?? true,
    industry: item?.industry ?? '',
    summary: item?.summary ?? '',
    resultTag: item?.resultTag ?? '',
    stack: (item?.stack ?? []).join(', '),
    launchedOn: item?.launchedOn ?? '',
    imageAlt: item?.imageAlt ?? '',
    imageSource: item?.imageSource ?? '',
    featured: item?.featured ?? false,
    homeFeatured: item?.homeFeatured ?? false,
    sortOrder: item ? String(item.sortOrder) : '',
    consent: item?.consent ?? 'unknown',
    consentNote: item?.consentNote ?? '',
    clientId: item?.clientId ?? '',
    challenge: text(cs.challenge),
    approach: text(cs.approach),
    outcome: text(cs.outcome),
    metrics: Array.isArray(cs.metrics)
      ? cs.metrics.slice(0, MAX_METRICS).map((m) => ({ label: text(m?.label), value: text(m?.value) }))
      : [],
    quoteText: text(cs.quote?.text),
    quoteAuthor: text(cs.quote?.author),
    quoteRole: text(cs.quote?.role),
  }
}

/** "Next.js, Supabase,, next.js " becomes ['Next.js', 'Supabase'] (first spelling wins). */
export function parseStack(value: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of value.split(',')) {
    const name = raw.trim()
    const key = name.toLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

/**
 * What the form refuses before saving. `status` is the item's current status:
 * a live item must keep a publishable consent (the database CHECK).
 */
export function validateDraft(draft: ShowcaseDraft, status: ShowcaseStatus = 'draft'): DraftErrors {
  const errors: DraftErrors = {}
  if (!draft.title.trim()) errors.title = 'Give the item a title.'
  const url = draft.url.trim()
  if (url && !isHttpsUrl(url)) errors.url = 'Use a full https:// link.'
  if (draft.summary.trim().length > MAX_SHOWCASE_SUMMARY) {
    errors.summary = `Keep the summary to ${MAX_SHOWCASE_SUMMARY} characters.`
  }
  const order = draft.sortOrder.trim()
  if (order && !/^-?\d+$/.test(order)) errors.sortOrder = 'Use a whole number.'
  if (draft.consentNote.trim().length > MAX_CONSENT_NOTE) {
    errors.consentNote = `Keep the note to ${MAX_CONSENT_NOTE} characters.`
  }
  const hasText = Boolean(draft.quoteText.trim())
  const hasAuthor = Boolean(draft.quoteAuthor.trim())
  if (hasText !== hasAuthor) errors.quote = 'A quote needs both its text and who said it.'
  if (draft.metrics.some((m) => Boolean(m.label.trim()) !== Boolean(m.value.trim()))) {
    errors.metrics = 'Each metric needs a label and a value.'
  }
  if (status === 'published' && !consentAllowsPublishing(draft.consent)) {
    errors.consent = 'A live item needs consent on record. Unpublish it first.'
  }
  return errors
}

/**
 * The case study as stored: empty parts left out, metrics capped, the quote
 * only when complete. Keys this form does not edit are carried over from
 * `base`. Undefined when nothing is left.
 */
export function caseStudyFromDraft(draft: ShowcaseDraft, base?: ShowcaseCaseStudy): ShowcaseCaseStudy | undefined {
  const out: ShowcaseCaseStudy = { ...(base ?? {}) }
  for (const key of ['challenge', 'approach', 'outcome'] as const) {
    const value = draft[key].trim()
    if (value) out[key] = value
    else delete out[key]
  }
  const metrics = draft.metrics
    .map((m) => ({ label: m.label.trim(), value: m.value.trim() }))
    .filter((m) => m.label && m.value)
    .slice(0, MAX_METRICS)
  if (metrics.length > 0) out.metrics = metrics
  else delete out.metrics
  const quoteText = draft.quoteText.trim()
  const author = draft.quoteAuthor.trim()
  if (quoteText && author) {
    const role = draft.quoteRole.trim()
    out.quote = { text: quoteText, author, ...(role ? { role } : {}) }
  } else delete out.quote
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * The editable fields as a store patch. An emptied optional field is an
 * explicit `undefined`, which the data layer writes as "clear this column".
 * Never carries status, publicUrl or the image keys: those have their own paths.
 */
export function patchFromDraft(draft: ShowcaseDraft, base?: ShowcaseItem | null) {
  const opt = (v: string) => v.trim() || undefined
  const order = draft.sortOrder.trim()
  const slug = draft.slug.trim()
  return {
    title: draft.title.trim(),
    ...(slug && slug !== base?.slug ? { slug } : {}),
    kind: draft.kind,
    url: opt(draft.url),
    linkPublic: draft.linkPublic,
    industry: opt(draft.industry),
    summary: opt(draft.summary),
    resultTag: opt(draft.resultTag),
    stack: parseStack(draft.stack),
    launchedOn: opt(draft.launchedOn),
    imageAlt: opt(draft.imageAlt),
    imageSource: draft.imageSource || undefined,
    featured: draft.featured,
    homeFeatured: draft.homeFeatured,
    ...(order ? { sortOrder: Number(order) } : {}),
    consent: draft.consent,
    consentNote: opt(draft.consentNote),
    clientId: opt(draft.clientId),
    caseStudy: caseStudyFromDraft(draft, base?.caseStudy),
  }
}

export function isDirty(draft: ShowcaseDraft, item?: ShowcaseItem | null): boolean {
  return JSON.stringify(draft) !== JSON.stringify(draftFromItem(item))
}

export type StatusFilter = 'all' | ShowcaseStatus

/** How many items sit in each status, plus the total. */
export function statusCounts(items: Pick<ShowcaseItem, 'status'>[]): Record<StatusFilter, number> {
  const out: Record<StatusFilter, number> = { all: items.length, draft: 0, ready: 0, published: 0, hidden: 0, archived: 0 }
  for (const item of items) out[item.status]++
  return out
}

/** Case-insensitive match on what a person would search an item by. */
export function matchesSearch(item: ShowcaseItem, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [item.title, item.slug, item.industry, item.url, item.resultTag, ...item.stack]
    .some((v) => v?.toLowerCase().includes(q))
}
