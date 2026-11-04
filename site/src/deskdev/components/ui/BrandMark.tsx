import { useId, type CSSProperties } from 'react'
import { classNames } from '../../lib/format'

/**
 * The DeskDev "D" letterform — the same path as the favicon and the
 * installed app's icon (public/workspace/favicon.svg), drawn on a 32-unit
 * grid. One mark everywhere the studio signs its name, instead of a generic
 * icon in a tile.
 */
export const BRAND_D_PATH =
  'M10 8h6.2c4.6 0 7.8 3.2 7.8 8s-3.2 8-7.8 8H10V8Zm4.3 3.6v8.8h1.7c2.5 0 4-1.7 4-4.4s-1.5-4.4-4-4.4h-1.7Z'

/**
 * The bare letterform in currentColor, sized like an icon (`size` px), for
 * places that draw the studio inside their own tile (the space rail). Takes
 * the same `size` / `className` as a Phosphor icon so it can stand in for one.
 */
export function BrandGlyph({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="7 6 20 20" width={size} height={size} aria-hidden focusable="false" className={className}>
      <path d={BRAND_D_PATH} fill="currentColor" />
    </svg>
  )
}

/**
 * The app-icon tile: brand fill, white letterform, a machined top edge.
 * Decorative by default (the name always sits next to it); pass `label`
 * when the mark stands alone.
 */
export default function BrandMark({
  size = 32,
  className,
  label,
  style,
}: {
  size?: number
  className?: string
  label?: string
  style?: CSSProperties
}) {
  const sheen = useId()
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      // The radius matches the favicon's rx=7 on 32 (22%), so box-shadow follows the tile.
      className={classNames('shrink-0 rounded-[22%]', className)}
      style={{ boxShadow: 'var(--shadow-1)', ...style }}
    >
      <defs>
        {/* The machined top edge (an inset box-shadow would paint under the tile). */}
        <linearGradient id={sheen} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="0.06" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7" className="fill-brand-600" />
      <rect width="32" height="32" rx="7" fill={`url(#${sheen})`} />
      <path d={BRAND_D_PATH} fill="#fff" />
    </svg>
  )
}
