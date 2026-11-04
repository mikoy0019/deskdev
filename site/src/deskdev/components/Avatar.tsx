import { useState } from 'react'
import { avatarColor, initials, classNames } from '../lib/format'
import { avatarImageUrl } from '../lib/avatarImages'
import { useStore } from '../store/useStore'

/**
 * A person's picture (052) or, without one, their initials on their colour:
 * the swatch they picked in Settings → Profile, on every screen. Pass the
 * user's `avatarColor` as `color` and `avatarKey` as `imageKey` where the user
 * is at hand; a call site that only has the name still gets both, looked up by
 * that name. Only a name that is nobody's (a group chat, "?") falls back to
 * the name hash, which two names can share.
 */
export default function Avatar({
  name,
  color,
  imageKey,
  size = 'md',
}: {
  name: string
  /** The user's `avatarColor` (a Tailwind bg class). */
  color?: string
  /** The user's `avatarKey`; null means "no picture, don't look one up". */
  imageKey?: string | null
  size?: 'sm' | 'md' | 'lg'
}) {
  const sizes = {
    sm: 'w-6 h-6 text-[10px]',
    md: 'w-8 h-8 text-xs',
    lg: 'w-10 h-10 text-sm',
  }
  const personId = useStore((s) => {
    const matches = s.users.filter((u) => u.fullName === name)
    return matches.length === 1 ? matches[0].id : undefined
  })
  const picked = useStore((s) => (color ? undefined : s.users.find((u) => u.fullName === name)?.avatarColor))
  const pickedKey = useStore((s) => (imageKey !== undefined ? undefined : s.users.find((u) => u.fullName === name)?.avatarKey))
  const key = imageKey === undefined ? pickedKey : imageKey ?? undefined
  // A picture that fails to load (deleted, offline) falls back to the initials.
  const [broken, setBroken] = useState<string | null>(null)
  const url = key && key !== broken ? avatarImageUrl(key) : undefined
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- client-only SPA; a 256px WebP from the avatars bucket, nothing to optimise
      <img
        data-person-id={personId}
        src={url}
        alt=""
        aria-hidden
        draggable={false}
        onError={() => setBroken(key ?? null)}
        className={classNames('rounded-full object-cover shrink-0 select-none bg-ink-700', sizes[size])}
      />
    )
  }
  return (
    <div
      data-person-id={personId}
      className={classNames(
        // Ink on the -500 swatch (≥4.5:1 on every one; white fell to 2.4:1 on
        // teal and failed on emerald, sky, amber and orange).
        'rounded-full flex items-center justify-center text-on-swatch font-semibold shrink-0 select-none',
        color || picked || avatarColor(name),
        sizes[size],
      )}
      aria-hidden
    >
      {initials(name)}
    </div>
  )
}
