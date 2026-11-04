import type { PointerEvent, ReactNode } from 'react'
import { m, useMotionTemplate, useMotionValue, useReducedMotion, useSpring } from 'framer-motion'
import { classNames } from '../../lib/format'
import { useMediaQuery } from '../../pwa/useMediaQuery'
import { SPRING } from './presets'

const FINE_HOVER = '(hover: hover) and (pointer: fine)'
const { stiffness, damping } = SPRING.decorative

/**
 * A primary call to action that leans a few px toward the cursor. RARE
 * SURFACES ONLY — the Login submit and the Install CTA, seen once or twice
 * per person. Never inside the daily workspace.
 *
 * Mouse / trackpad only (no hover on touch), off under reduced motion.
 * Motion values + the decorative spring: no React state, no re-render while
 * the pointer moves. Press feedback stays on the inner button (`btn-*`
 * scales with the independent `scale` property, so the two compose).
 */
export function Magnetic({
  children, strength = 0.2, max = 6, className,
}: {
  children: ReactNode
  /** Share of the pointer's offset from centre the CTA follows. */
  strength?: number
  /** Cap on the lean, px. */
  max?: number
  className?: string
}) {
  const fine = useMediaQuery(FINE_HOVER)
  const reduce = useReducedMotion()
  const on = fine && !reduce
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const sx = useSpring(x, { stiffness, damping })
  const sy = useSpring(y, { stiffness, damping })
  const transform = useMotionTemplate`translate3d(${sx}px, ${sy}px, 0)`

  const clamp = (n: number) => Math.max(-max, Math.min(max, n))
  const onPointerMove = (e: PointerEvent<HTMLSpanElement>) => {
    if (!on || e.pointerType !== 'mouse') return
    const r = e.currentTarget.getBoundingClientRect()
    x.set(clamp((e.clientX - (r.left + r.width / 2)) * strength))
    y.set(clamp((e.clientY - (r.top + r.height / 2)) * strength))
  }
  const onPointerLeave = () => {
    x.set(0)
    y.set(0)
  }

  return (
    <m.span
      className={classNames('inline-flex', className)}
      style={on ? { transform } : undefined}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      {children}
    </m.span>
  )
}
