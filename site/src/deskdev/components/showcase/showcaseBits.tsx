import { useState } from 'react'
import { classNames } from '../../lib/format'
import { showcaseImageUrl } from '../../lib/showcaseImages'
import type {
  ClientShowcaseConsent, ShowcaseConsent, ShowcaseImageSource, ShowcaseItem, ShowcaseKind, ShowcaseStatus,
} from '../../lib/types'

// One vocabulary for the Showcase page, the item editor, and the panels on
// ProjectDetail and ClientDetail: the same word and tone for a status or a
// consent value wherever it appears.

/** `ready` reads as "Needs review": it is the admins' queue. */
export const STATUS_LABELS: Record<ShowcaseStatus, string> = {
  draft: 'Draft',
  ready: 'Needs review',
  published: 'Published',
  hidden: 'Hidden',
  archived: 'Archived',
}

const STATUS_TONE: Record<ShowcaseStatus, string> = {
  draft: 'badge-neutral',
  ready: 'badge-warn',
  published: 'badge-success',
  hidden: 'badge-neutral',
  archived: 'badge-neutral',
}

export const KIND_LABELS: Record<ShowcaseKind, string> = {
  website: 'Website',
  web_app: 'Web app',
  product: 'Product',
}

export const CONSENT_LABELS: Record<ShowcaseConsent, string> = {
  unknown: 'Not asked yet',
  granted: 'Granted',
  declined: 'Declined',
  legacy: 'Legacy portfolio',
  internal: 'Our own product',
}

const CONSENT_TONE: Record<ShowcaseConsent, string> = {
  unknown: 'badge-neutral',
  granted: 'badge-success',
  declined: 'badge-danger',
  legacy: 'badge-info',
  internal: 'badge-info',
}

export const CLIENT_CONSENT_LABELS: Record<ClientShowcaseConsent, string> = {
  unknown: 'Not asked yet',
  granted: 'Granted',
  declined: 'Declined',
}

export const IMAGE_SOURCE_LABELS: Record<ShowcaseImageSource, string> = {
  upload: 'Uploaded screenshot',
  capture: 'Stored capture',
  local: 'Site file',
  mshots: 'Live capture of the link',
  mockup: 'App mockup',
  none: 'Monogram only',
}

export function ShowcaseStatusBadge({ status, className }: { status: ShowcaseStatus; className?: string }) {
  return <span className={classNames('badge whitespace-nowrap', STATUS_TONE[status], className)}>{STATUS_LABELS[status]}</span>
}

export function ConsentBadge({ consent, className }: { consent: ShowcaseConsent; className?: string }) {
  return <span className={classNames('badge whitespace-nowrap', CONSENT_TONE[consent], className)}>{CONSENT_LABELS[consent]}</span>
}

// The names the portfolio editor (ShowcaseEditor.tsx) was written against:
// the same words and tones as above.
export const STATUS_LABEL = STATUS_LABELS
export const KIND_LABEL = KIND_LABELS
export const CONSENT_LABEL = CONSENT_LABELS
export const StatusBadge = ShowcaseStatusBadge

/**
 * The item's picture at 16:10, or its initial on a quiet tile when there is
 * none (or it fails to load: a legacy key, a file that moved).
 */
export function ShowcaseThumb({
  item, className, large,
}: {
  item: Pick<ShowcaseItem, 'title' | 'imageKey' | 'imageKeySmall' | 'imageAlt'>
  className?: string
  /** Prefer the 1280 image (the editor preview); lists use the 640 one. */
  large?: boolean
}) {
  const src = showcaseImageUrl(large ? item.imageKey ?? item.imageKeySmall : item.imageKeySmall ?? item.imageKey)
  const [failed, setFailed] = useState<string | null>(null)
  const show = src && failed !== src
  return (
    <span
      className={classNames(
        'relative flex aspect-[16/10] shrink-0 items-center justify-center overflow-hidden rounded-md border border-ink-600 bg-ink-700/60',
        className,
      )}
    >
      {show ? (
        // A plain img: the SPA has no image optimiser, and the bucket already holds a 640w copy.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={item.imageAlt ?? ''}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover object-top"
          onError={() => setFailed(src)}
        />
      ) : (
        <span aria-hidden className="text-display text-sm font-semibold text-ink-300">
          {item.title.trim().charAt(0).toUpperCase() || '?'}
        </span>
      )}
    </span>
  )
}
