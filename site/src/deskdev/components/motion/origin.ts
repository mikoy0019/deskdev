/**
 * Origin-aware popovers: a menu grows out of the button that opened it, not
 * out of its own centre (modals are the exception — they stay centred).
 * PopoverPanel reads `var(--transform-origin)` first, so positioning code
 * that computes a flip can set the variable; otherwise it falls back to the
 * origin derived from the placement here.
 */

export type Placement =
  | 'bottom-start'
  | 'bottom'
  | 'bottom-end'
  | 'top-start'
  | 'top'
  | 'top-end'
  | 'left-start'
  | 'left'
  | 'left-end'
  | 'right-start'
  | 'right'
  | 'right-end'

/**
 * transform-origin for a panel at `placement` relative to its trigger. The
 * origin is the panel's edge nearest the trigger: a menu below its button
 * (bottom-*) grows from its top edge, aligned to the side it hangs from.
 */
export function originFor(placement: Placement): string {
  const [side, align] = placement.split('-') as [string, 'start' | 'end' | undefined]
  if (side === 'bottom' || side === 'top') {
    const y = side === 'bottom' ? 'top' : 'bottom'
    const x = align === 'start' ? 'left' : align === 'end' ? 'right' : 'center'
    return `${y} ${x}`
  }
  const x = side === 'right' ? 'left' : 'right'
  const y = align === 'start' ? 'top' : align === 'end' ? 'bottom' : 'center'
  return `${x} ${y}`
}

/** The style value PopoverPanel uses: the CSS variable wins, the placement is the fallback. */
export function originStyle(placement: Placement): string {
  return `var(--transform-origin, ${originFor(placement)})`
}
