import type { CSSProperties, ReactNode } from 'react'
import { classNames } from '../../lib/format'
import type { ProjectCategory } from '../../lib/types'

/**
 * Inline style for a hex-coloured chip: a 12% tint and a 35% border. The text
 * stays on the ink tokens — a user-picked colour as text (yellow on the light
 * page, navy on the dark one) can't hold 4.5:1 in both themes, so the colour
 * lives in the tint and the dot instead. Undefined when no colour is set.
 */
export function hexPillStyle(color?: string): CSSProperties | undefined {
  if (!color) return undefined
  return { backgroundColor: `${color}1f`, borderColor: `${color}59` }
}

/** A label chip in a data colour (client, category): colour dot + ink text, truncates. */
export function ColorChip({
  color, className, children,
}: {
  color?: string
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={classNames(
        'chip min-w-0 max-w-full border-ink-500 bg-ink-700/60 text-ink-100',
        className,
      )}
      style={hexPillStyle(color)}
      title={typeof children === 'string' ? children : undefined}
    >
      {color && (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      )}
      <span className="truncate">{children}</span>
    </span>
  )
}

/** Coloured pill for a project category — neutral ink chip when uncoloured. */
export default function CategoryPill({ category }: { category: ProjectCategory }) {
  return <ColorChip color={category.color}>{category.name}</ColorChip>
}
