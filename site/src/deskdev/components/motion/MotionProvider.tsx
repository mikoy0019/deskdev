import { useEffect, type ReactNode } from 'react'
import { LazyMotion, MotionConfig, domMax } from 'framer-motion'
import { trackInputModality } from './inputModality'

/**
 * DeskDev's motion root (Root.tsx wraps the app in it, once):
 *  - LazyMotion with domMax — animations, exits, gestures, drag AND layout /
 *    layoutId (LayoutIndicator). Loaded with the app chunk, not lazily: an
 *    overlay's first `initial` state must never wait on a second request.
 *    Use the `m.*` components (from 'framer-motion'), never `motion.*`,
 *    which would pull the full bundle back in.
 *  - MotionConfig reducedMotion="user": with the OS setting on, Motion
 *    skips layout / layoutId animation and the x / y / scale shorthands and
 *    keeps opacity / colour — fewer and gentler, not none. It does NOT see
 *    inside a full `transform` string (the kit's hardware-accelerated form),
 *    so every kit part also checks useReducedMotion() itself; screen code
 *    that animates `transform` directly must do the same.
 *  - The input-modality tracker (<html data-input>), so keyboard-initiated
 *    actions skip their animation.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  useEffect(() => trackInputModality(), [])
  return (
    <LazyMotion features={domMax}>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  )
}
