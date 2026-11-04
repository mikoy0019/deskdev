import { useState } from 'react'
import { avatarColor, classNames } from '../../lib/format'
import { avatarImageUrl } from '../../lib/avatarImages'
import type { User } from '../../lib/types'

/** Swatch choices for a user's avatar color — Tailwind bg classes. */
export const AVATAR_COLORS = [
  'bg-rose-500', 'bg-orange-500', 'bg-amber-500', 'bg-emerald-500',
  'bg-teal-500', 'bg-sky-500', 'bg-violet-500', 'bg-fuchsia-500',
]

/** First grapheme of a word: whole emoji / combined characters, never half a surrogate pair. */
function firstGrapheme(word: string): string {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    for (const { segment } of seg.segment(word)) return segment
  }
  return Array.from(word)[0] ?? ''
}

/**
 * First + last word ("Bartholomew Fitzgerald-Montgomery III" → "BF", not
 * "BI"): a trailing suffix (III, Jr., Sr.) is skipped so the surname counts.
 */
export function avatarInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const suffix = /^(i{1,3}|iv|v|jr\.?|sr\.?)$/i
  const last = words.length > 1 && suffix.test(words[words.length - 1]) ? words[words.length - 2] : words[words.length - 1]
  const picked = words.length > 1 && last !== words[0] ? [words[0], last] : [words[0]]
  return picked.map((w) => firstGrapheme(w).toLocaleUpperCase()).join('')
}

/**
 * The user's picture (052) when they have one; otherwise their initials on
 * the picked avatarColor, falling back to the name-hash color used by the
 * shared Avatar component.
 */
export default function UserAvatar({
  user,
  size = 'md',
}: {
  user: Pick<User, 'fullName' | 'avatarColor' | 'avatarKey'>
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  const sizes = {
    sm: 'size-6 text-[10px]',
    md: 'size-8 text-xs',
    lg: 'size-12 text-sm',
    xl: 'size-20 text-xl',
  }
  const [broken, setBroken] = useState<string | null>(null)
  const url = user.avatarKey && user.avatarKey !== broken ? avatarImageUrl(user.avatarKey) : undefined
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- client-only SPA; a 256px WebP from the avatars bucket, nothing to optimise
      <img
        src={url}
        alt=""
        aria-hidden
        draggable={false}
        onError={() => setBroken(user.avatarKey ?? null)}
        className={classNames('shrink-0 select-none rounded-full bg-ink-700 object-cover', sizes[size])}
      />
    )
  }
  return (
    <div
      aria-hidden
      className={classNames(
        // Ink on the -500 swatch (≥4.5:1 on every one; white failed on several).
        'flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-on-swatch',
        user.avatarColor || avatarColor(user.fullName),
        sizes[size],
      )}
    >
      {avatarInitials(user.fullName)}
    </div>
  )
}
