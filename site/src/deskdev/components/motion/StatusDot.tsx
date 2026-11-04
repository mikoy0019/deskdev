import { classNames } from '../../lib/format'

export type StatusTone = 'online' | 'away' | 'busy' | 'offline' | 'live' | 'sync' | 'unread'

// 600 in light / 400 in dark: each ≥3:1 against the card and page surfaces
// (WCAG 1.4.11 non-text contrast). The dot paints in currentColor.
const TONE: Record<StatusTone, string> = {
  online: 'text-emerald-600 dark:text-emerald-400',
  away: 'text-amber-600 dark:text-amber-400',
  busy: 'text-rose-600 dark:text-rose-400',
  offline: 'text-ink-400',
  live: 'text-rose-600 dark:text-rose-400',
  sync: 'text-brand-600 dark:text-brand-400',
  unread: 'text-brand-600 dark:text-brand-400',
}

const SIZE = { xs: 'size-1.5', sm: 'size-2', md: 'size-2.5' } as const

/**
 * A status dot. Static by default. `breathe` adds a slow halo (2s, CSS,
 * transform + opacity) and is reserved for state that is live right now:
 * a meeting in progress, a sync running, reconnecting while offline, the
 * single "you have something new" marker. Never on presence dots repeated
 * down a list, never on data being read. Reduced motion: the halo holds
 * still as a faint ring, so the "live" signal survives without movement.
 *
 * Colour alone is not a label: pass `label` when no visible text says the
 * same thing (it becomes the dot's accessible name); otherwise it's hidden.
 */
export function StatusDot({
  tone, breathe = false, label, size = 'sm', className,
}: {
  tone: StatusTone
  breathe?: boolean
  label?: string
  size?: keyof typeof SIZE
  className?: string
}) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={classNames(
        'dd-dot relative inline-block shrink-0 rounded-full bg-current',
        SIZE[size],
        TONE[tone],
        breathe && 'dd-breathe',
        className,
      )}
    />
  )
}
