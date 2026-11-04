import { Link } from 'react-router-dom'
import { ArrowUpRightIcon, type Icon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { classNames } from '../lib/format'
import { AnimatedNumber } from './motion'

/**
 * Dashboard stat tile — editorial treatment: a quiet label with its icon, a
 * headline figure in the UI face (tabular so digits never jitter), and an
 * optional sub line. Renders as a Link when `to` is set; the icon and a corner
 * arrow shift to the brand color on hover to signal it's navigable.
 * Monochrome by design — colour is reserved for genuine status inside the data
 * views, not the summary tiles.
 *
 * `variant="card"` (default) is a standalone card for a grid of tiles.
 * `variant="cell"` is a borderless cell for one shared card (`StatStrip`).
 */
export default function StatCard({
  label, value, icon: Icon, sub, to, variant = 'card', countKey, className, keepSub,
}: {
  label: string
  value: number | string
  icon: Icon
  sub?: string
  to?: string
  variant?: 'card' | 'cell'
  /**
   * A numeric value counts up from 0 the first time this key shows in a
   * session, and from old to new when it changes on screen (AnimatedNumber).
   */
  countKey?: string
  /** Extra classes on the tile root — e.g. a column span in a bento strip. */
  className?: string
  /** Keep the sub line on phones (a cell wide enough to hold it). */
  keepSub?: boolean
}) {
  const shown = typeof value === 'number' ? value.toLocaleString() : value
  // Full-figure money ("$1,250,000") is twice a count's width. In a half-width
  // phone tile (~100px inside) text-3xl spills out, so long values step down a
  // size below sm, and anything still too wide truncates (full value on hover).
  // "$19,900" still fits at full size; the step is for seven figures and up.
  const long = shown.length > 8
  // Strip cells run three to a row on phones (Home): tighter rhythm, a smaller
  // number and no sub line there, so six tiles take two short rows, not three
  // tall ones that push the day's meetings and tasks below the fold.
  const cell = variant === 'cell'
  const inner = (
    <>
      {/* The label used to share its row with a 32px icon chip and an
          uppercase tracking, which truncated "Active projects" at desktop
          widths. Sentence case + a bare 16px icon leaves it the full row. */}
      {/* Phone thirds: the row always holds two label lines, so a wrapped
          "Active projects" doesn't push its figure below its neighbours'. */}
      <div className={classNames('flex items-start justify-between gap-2', cell && 'max-sm:min-h-8')}>
        <span className="min-w-0 text-xs font-medium leading-4 text-ink-300 line-clamp-2">
          {label}
        </span>
        <Icon
          size={16}
          aria-hidden
          className={classNames(
            'shrink-0 text-ink-400 transition-colors duration-150 ease-[ease]',
            to && 'group-hover:text-brand-600 dark:group-hover:text-brand-400',
          )}
        />
      </div>
      <div className={classNames('flex items-end justify-between gap-2', cell ? 'mt-2 sm:mt-4' : 'mt-4')}>
        <div className="min-w-0">
          {/* A fixed line box: the sub line starts at the same y whichever
              size the figure takes, so a row of tiles shares its lines. */}
          <div className="flex h-6 items-end sm:h-7">
          <div
            className={classNames(
              'text-metric min-w-0 leading-none text-ink-50 truncate',
              // Full-figure money is long: "$1,250,000" in a sixth-width
              // desktop tile needs the step down at all sizes.
              cell
                ? long ? 'text-lg sm:text-2xl' : 'text-xl sm:text-[1.75rem]'
                : long ? 'text-xl sm:text-2xl' : 'text-2xl sm:text-[1.75rem]',
            )}
            title={shown}
          >
            {typeof value === 'number' ? <AnimatedNumber value={value} countKey={countKey} /> : value}
          </div>
          </div>
          {sub && (
            <div className={classNames('mt-2 truncate text-[11px] leading-4 text-ink-400 tabular-nums', cell && !keepSub && 'max-sm:hidden')}>{sub}</div>
          )}
        </div>
        {to && (
          <ArrowUpRightIcon
            size={16}
            aria-hidden
            // Fine pointers only: the arrow slides in as the hover hint (touch
            // has no hover, and a stuck hover would leave it out).
            className="mb-0.5 shrink-0 text-ink-400 opacity-0 transition-[opacity,translate,color] duration-150 ease-out hover-fine:-translate-x-0.5 hover-fine:translate-y-0.5 hover-fine:group-hover:translate-x-0 hover-fine:group-hover:translate-y-0 group-hover:text-brand-600 dark:group-hover:text-brand-400 group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        )}
      </div>
    </>
  )

  const shell = cell
    ? classNames(
        'density-card max-sm:p-3 flex flex-col border-r border-b border-ink-600',
        // A ruled cell can't scale without its hairlines shifting, so its
        // press is a deeper tint, on press-down.
        to && 'transition-colors duration-150 ease-[ease] hover:bg-ink-700/40 active:bg-ink-700/70 [-webkit-touch-callout:none] focus-visible:ring-inset focus-visible:ring-offset-0',
        className,
      )
    : classNames('card density-card flex flex-col', to && 'card-hover pressable-card', className)

  if (to) {
    return (
      <Link to={to} className={classNames(shell, 'group')}>
        {inner}
      </Link>
    )
  }
  return <div className={shell}>{inner}</div>
}

/**
 * One card holding `variant="cell"` tiles, ruled by hairlines instead of six
 * separate boxes. Each cell draws its own right + bottom border; the grid runs
 * 1px past the card on both axes and the card clips it, so the rules on the
 * outer edge disappear for any column count and any number of tiles (a
 * permission-trimmed row just leaves card surface, never a grey hole).
 * Pass the grid's column classes in `className`.
 */
export function StatStrip({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <div className={classNames('-mr-px -mb-px grid', className)}>{children}</div>
    </div>
  )
}
