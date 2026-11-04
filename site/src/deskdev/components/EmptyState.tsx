import type { ReactNode } from 'react'
import type { Icon } from '@phosphor-icons/react'
import { Glyph, type GlyphName } from './ui-foundation/glyphs'
import { classNames } from '../lib/format'

/**
 * Designed empty state: the area's mark on a raised tile, one line, and the
 * action that fills it.
 *
 * API is backward compatible — existing callers pass a Phosphor `icon` + `hint`.
 * New callers pass a `glyph` (the area's mark) and `description`. `glyph`
 * wins over `icon`; `description` wins over `hint`.
 *
 * `compact` is for a panel that sits beside other content (Home's two day
 * panels): a 32px mark with the text and the action in one left-aligned
 * block, about half the height. A whole page that is empty keeps the default.
 *
 * No entrance of its own: it arrives with the page (the route fade).
 */
export default function EmptyState({
  glyph,
  icon: Icon,
  title,
  description,
  hint,
  action,
  compact,
  className,
}: {
  glyph?: GlyphName
  icon?: Icon
  title: string
  description?: string
  hint?: string
  action?: ReactNode
  /** The small, left-aligned form for a panel among others. */
  compact?: boolean
  /** Extra classes on the card root — e.g. `h-full` to stretch in a grid. */
  className?: string
}) {
  const body = description ?? hint
  // Prefer the glyph; fall back to a Phosphor `icon`; else the search mark.
  const showGlyph = glyph ?? (Icon ? null : 'search-empty')

  if (compact) {
    return (
      <div className={classNames('card px-4 py-6 sm:px-5', className)}>
        <div className="flex min-w-0 items-start gap-3.5">
          <div
            className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-ink-600 bg-ink-800 text-ink-300 shadow-(--shadow-1) dark:bg-ink-700/60"
            aria-hidden
          >
            {showGlyph ? <Glyph name={showGlyph} size={18} /> : Icon ? <Icon size={16} aria-hidden /> : null}
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-medium leading-5 text-ink-50 [overflow-wrap:anywhere]">{title}</h2>
            {body && <p className="mt-0.5 max-w-sm text-sm leading-relaxed text-ink-300 text-pretty">{body}</p>}
            {action && <div className="mt-3 flex">{action}</div>}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={classNames('card density-card py-12 px-6 text-center flex flex-col items-center justify-center', className)}>
      {/* The mark sits on a raised tile — card surface, hairline, shadow-2 —
          so it reads as an object on the page, not a grey hole in it. */}
      <div
        className="flex size-14 shrink-0 items-center justify-center rounded-xl border border-ink-600 bg-ink-800 text-ink-300 shadow-(--shadow-2) dark:bg-ink-700/60"
        aria-hidden
      >
        {showGlyph ? <Glyph name={showGlyph} size={26} /> : Icon ? <Icon size={24} aria-hidden /> : null}
      </div>
      <h2 className="mt-5 text-display text-base font-semibold text-ink-50 text-balance [overflow-wrap:anywhere]">{title}</h2>
      {body && <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-ink-300 text-pretty">{body}</p>}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  )
}
