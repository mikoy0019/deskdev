import { useState } from 'react'
import { avatarColor, classNames } from '../../lib/format'
import { avatarImageUrl } from '../../lib/avatarImages'
import { ColorSwatches as SwatchRadios, type Swatch } from '../calendar/calendarShared'
import type { Client, ClientCategory, Engagement } from '../../lib/types'

/** Client color palette used by the client form + category manager. The
    first swatch is every new client's default, so it isn't one of the two
    violets: a roster that defaults to purple drifts toward the AI-glow look. */
export const CLIENT_SWATCHES: readonly Swatch[] = [
  { value: '#0ea5e9', name: 'Sky' },
  { value: '#10b981', name: 'Green' },
  { value: '#f59e0b', name: 'Amber' },
  { value: '#f43f5e', name: 'Rose' },
  { value: '#14b8a6', name: 'Teal' },
  { value: '#f97316', name: 'Orange' },
  { value: '#8b5cf6', name: 'Violet' },
  { value: '#6366f1', name: 'Indigo' },
]
export const CLIENT_COLORS = CLIENT_SWATCHES.map((s) => s.value)

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

/** First visible character of a word — a whole grapheme, so an emoji or an
    accented capital never splits into half a surrogate pair. */
function firstGrapheme(word: string): string {
  if (segmenter) {
    for (const { segment } of segmenter.segment(word)) return segment
    return ''
  }
  return Array.from(word)[0] ?? ''
}

/** Initials from the first two words, as everywhere else in the app (the
    space rail, avatars), but grapheme-safe and skipping a suffix ("Jr", "III")
    or a lone symbol; a CJK name without spaces gives its first glyph. */
export function clientInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w))
  if (words.length === 0) return firstGrapheme(name.trim()) || '?'
  const meaningful = words.filter((w) => !/^(I{1,3}|IV|Jr\.?|Sr\.?)$/i.test(w))
  const pick = meaningful.length > 0 ? meaningful : words
  const first = firstGrapheme(pick[0])
  const last = pick.length > 1 ? firstGrapheme(pick[1]) : ''
  return (first + last).toLocaleUpperCase()
}

/** Round avatar — the client's picture (052), else its initials on its chosen color (or a name-seeded one). */
export function ClientAvatar({
  client,
  size = 'md',
}: {
  client: Client
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  const sizes = {
    sm: 'size-9 text-xs',
    md: 'size-10 text-sm',
    lg: 'size-14 text-lg',
    xl: 'size-20 text-2xl',
  }
  const [broken, setBroken] = useState<string | null>(null)
  const url = client.avatarKey && client.avatarKey !== broken ? avatarImageUrl(client.avatarKey) : undefined
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- client-only SPA; a 256px WebP from the avatars bucket, nothing to optimise
      <img
        src={url}
        alt=""
        aria-hidden
        draggable={false}
        onError={() => setBroken(client.avatarKey ?? null)}
        className={classNames(
          'rounded-full object-cover shrink-0 select-none bg-ink-700',
          'shadow-[inset_0_0_0_1px_rgb(var(--shadow-color)/0.12)]',
          sizes[size],
        )}
      />
    )
  }
  return (
    <div
      className={classNames(
        'rounded-full flex items-center justify-center text-on-swatch font-semibold tracking-tight shrink-0 select-none',
        // A hairline inner edge seats the swatch on both themes (tinted with
        // the page's shadow hue, never pure black).
        'shadow-[inset_0_0_0_1px_rgb(var(--shadow-color)/0.12)]',
        sizes[size],
        !client.color && avatarColor(client.name),
      )}
      style={client.color ? { backgroundColor: client.color } : undefined}
      aria-hidden
    >
      {clientInitials(client.name)}
    </div>
  )
}

export const ENGAGEMENT_LABELS: Record<Engagement, string> = {
  full_time: 'Full Time',
  part_time: 'Part Time',
  gig_on_call: 'Gig — On Call',
}

/** The engagement as a neutral chip. The status chip beside it is the one
    that carries colour (it means something); three hues per row was noise. */
export function EngagementTag({ engagement }: { engagement: Engagement }) {
  return (
    <span className="chip shrink-0 whitespace-nowrap bg-ink-700 text-ink-100 border-ink-500">
      {ENGAGEMENT_LABELS[engagement]}
    </span>
  )
}

/** Neutral chip with the category's colored dot + name. */
export function CategoryChip({ category }: { category: ClientCategory }) {
  return (
    <span className="chip max-w-full bg-ink-700 text-ink-100 border-ink-500">
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: category.color ?? 'rgb(var(--ink-400))' }}
        aria-hidden
      />
      <span className="truncate">{category.name}</span>
    </span>
  )
}

/** The client colour picker: the shared swatch radios over the client palette. */
export function ColorSwatches({
  value,
  onChange,
  labelledBy,
}: {
  value?: string
  onChange: (color: string) => void
  /** id of the visible "Color" label, when the form has one */
  labelledBy?: string
}) {
  return <SwatchRadios swatches={CLIENT_SWATCHES} value={value} onChange={onChange} labelledBy={labelledBy} />
}
