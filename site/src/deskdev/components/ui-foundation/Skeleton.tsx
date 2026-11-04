import type { CSSProperties } from 'react'
import { classNames } from '../../lib/format'

/**
 * Content-shaped skeletons. Shape the placeholder like the real thing —
 * never a spinner in a void. Every block is the kit's `skeleton` utility (the
 * same sweep as motion/Skeleton: a gradient band translated on the
 * compositor, 1.4s linear); reduced motion leaves a calm static block.
 */

function Shimmer({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div aria-hidden className={classNames('skeleton', className)} style={style} />
}

/** A single line of faux text. `w` accepts any CSS width (e.g. '60%'). */
export function SkeletonLine({
  w = '100%',
  className,
}: {
  w?: string | number
  className?: string
}) {
  return <Shimmer className={classNames('h-3.5 rounded-md', className)} style={{ width: w }} />
}

/** A block — avatar, thumbnail, icon tile. Square by default. */
export function SkeletonBlock({
  w = 40,
  h,
  rounded = 'lg',
  className,
}: {
  w?: string | number
  h?: string | number
  rounded?: 'md' | 'lg' | 'full'
  className?: string
}) {
  const r = rounded === 'full' ? 'rounded-full' : rounded === 'md' ? 'rounded-md' : 'rounded-lg'
  return <Shimmer className={classNames(r, className)} style={{ width: w, height: h ?? w }} />
}

/** A card-shaped skeleton: title + a couple of body lines. */
export function SkeletonCard({ lines = 2, className }: { lines?: number; className?: string }) {
  return (
    <div className={classNames('card density-card space-y-3', className)}>
      <div className="flex items-center gap-3">
        <SkeletonBlock w={36} rounded="lg" />
        <div className="flex-1 space-y-2">
          <SkeletonLine w="55%" />
          <SkeletonLine w="35%" className="h-3" />
        </div>
      </div>
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonLine key={i} w={i === lines - 1 ? '80%' : '100%'} />
      ))}
    </div>
  )
}

/** A table/list row skeleton. Render N of these inside a list container. */
export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div
      className={classNames(
        'flex items-center gap-3 density-row px-3 border-b border-ink-600 last:border-b-0',
        className,
      )}
    >
      <SkeletonBlock w={28} rounded="full" />
      <SkeletonLine w="40%" />
      <div className="flex-1" />
      <SkeletonLine w={64} className="h-3" />
      <SkeletonBlock w={20} h={20} rounded="md" />
    </div>
  )
}

/** Convenience: a stack of `count` SkeletonRows wrapped in a card. */
export function SkeletonList({ count = 5, className }: { count?: number; className?: string }) {
  return (
    <div className={classNames('card overflow-hidden', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  )
}

/**
 * A kanban board in its loading state. Real column headers (they're known before the
 * data lands, so showing them is honest and stops the layout jumping) over faux cards.
 * Shared by Tasks, Projects and Meetings.
 */
export function SkeletonBoard({
  columns,
  cards = 3,
}: {
  columns: { key: string; title: string; accent?: string }[]
  cards?: number
}) {
  return (
    // Same edge-to-edge bleed below md as KanbanBoard, so nothing shifts when it lands.
    <div
      className="flex md:grid gap-4 overflow-x-auto md:overflow-x-visible pb-2 max-md:-mx-4 max-md:px-4"
      style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading board"
    >
      {columns.map((col) => (
        <section
          key={col.key}
          className="min-w-[280px] md:min-w-0 rounded-xl border border-ink-600 bg-ink-850/60 flex flex-col"
        >
          <header className="px-3 py-2.5 flex items-center gap-2 border-b border-ink-600">
            {col.accent && <span className={classNames('w-2 h-2 rounded-full', col.accent)} />}
            <span className="section-title truncate">{col.title}</span>
            <SkeletonBlock w={22} h={18} rounded="full" className="ml-auto" />
          </header>
          <div className="p-2 space-y-2">
            {Array.from({ length: cards }).map((_, i) => (
              <SkeletonCard key={i} lines={1} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
