import type { CSSProperties } from 'react'
import { LayoutGroup, m } from 'framer-motion'
import { SPRING, TWEEN } from './presets'
import { useInputModality } from './inputModality'

/**
 * The active marker of a tab row / nav list — a pill behind the label, a
 * rail beside it, an underline under it — that glides from the old item to
 * the new one (shared layoutId). Render it ONLY inside the active item:
 *
 *   {active && <LayoutIndicator layoutId="settings-nav" className="absolute inset-0 rounded-md bg-ink-700" radius={6} />}
 *
 * Purpose: spatial consistency (where the selection went). Frequency: tens
 * a day, so it is near-imperceptible — a critically damped 300ms spring, no
 * overshoot — and it does not move at all when the change came from the
 * keyboard (arrow keys, shortcuts, the command palette) or under reduced
 * motion (MotionConfig skips layout animation; the marker just appears).
 *
 * Two copies of the same nav on screen (desktop sidebar + phone drawer)?
 * Wrap each in <IndicatorGroup id="…"> so the marker can't fly between them.
 */
export function LayoutIndicator({
  layoutId, className, style, radius,
}: {
  /** Shared by every item of one nav: 'sidebar', 'tabbar', 'settings-nav', 'tasks-tabs'… */
  layoutId: string
  className?: string
  style?: CSSProperties
  /**
   * Corner radius in px. Pass it here (not only as a rounded-* class) so
   * Motion corrects the corners while the marker stretches between items.
   */
  radius?: number
}) {
  const keyboard = useInputModality() === 'keyboard'
  return (
    <m.span
      aria-hidden
      layoutId={layoutId}
      className={className}
      style={radius === undefined ? style : { borderRadius: radius, ...style }}
      transition={keyboard ? TWEEN.instant : SPRING.indicator}
    />
  )
}

/** Scopes layoutIds — one per rendered copy of a nav. */
export const IndicatorGroup = LayoutGroup
