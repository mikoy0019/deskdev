import type { CSSProperties } from 'react'
import { classNames } from '../../lib/format'

/**
 * One placeholder block with the loading shimmer (the `skeleton` utility in
 * index.css: a gradient band translated across on the compositor, 1.4s
 * linear; reduced motion = a still block). Shape it like the content it
 * stands in for — the composed shapes (SkeletonRow / Card / List / Board)
 * live in ui-foundation/Skeleton and share the same shimmer.
 *
 * Mark the loading region, not each block: aria-busy="true" on the list or
 * card the skeleton fills.
 */
export function Skeleton({
  w, h, rounded = 'md', className, style,
}: {
  w?: number | string
  h?: number | string
  rounded?: 'sm' | 'md' | 'lg' | 'full'
  className?: string
  style?: CSSProperties
}) {
  const r = { sm: 'rounded-sm', md: 'rounded-md', lg: 'rounded-lg', full: 'rounded-full' }[rounded]
  return (
    <span
      aria-hidden
      className={classNames('skeleton block', r, className)}
      style={{ width: w, height: h, ...style }}
    />
  )
}
