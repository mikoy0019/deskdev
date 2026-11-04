import { useCallback, useEffect, useMemo, useRef, type CSSProperties, type PointerEvent, type MouseEvent, type RefObject } from 'react'
import { animate, useMotionValue, useReducedMotion, type AnimationPlaybackControls, type MotionValue } from 'framer-motion'
import {
  classifyMove, dragOffset, pushSample, releaseVelocity, shouldDismiss, type DragSample,
} from './dragMath'
import { SPRING, TWEEN } from './presets'

/** The edge a surface leaves through. */
export type DismissEdge = 'bottom' | 'left' | 'right'

export interface DragToDismissOptions {
  /** Called once a drag commits to dismissing. The parent closes the surface. */
  onDismiss: () => void
  /** The surface's edge. Default 'bottom' (a phone sheet). */
  edge?: DismissEdge
  /** The element that moves (measured for its size; its WAAPI enter/exit is interrupted on grab). */
  targetRef: RefObject<HTMLElement | null>
  /** Off while the surface is exiting, or for a sheet that must not be swiped away. */
  enabled?: boolean
}

export interface DragToDismiss {
  /** px toward the dismiss edge; the surface's transform follows it. */
  offset: MotionValue<number>
  /** Spread on the grab surface: a sheet's grabber + title bar, or a whole side drawer. */
  handleProps: {
    onPointerDown: (e: PointerEvent<HTMLElement>) => void
    onPointerMove: (e: PointerEvent<HTMLElement>) => void
    onPointerUp: (e: PointerEvent<HTMLElement>) => void
    onPointerCancel: (e: PointerEvent<HTMLElement>) => void
    onLostPointerCapture: (e: PointerEvent<HTMLElement>) => void
    onClickCapture: (e: MouseEvent<HTMLElement>) => void
    style: CSSProperties
    'data-drag-handle': ''
  }
  /**
   * The release velocity (px/s) of the drag that dismissed, once; null when
   * the close came from elsewhere (scrim, button, Escape). The exit animation
   * takes it so the fling continues at the finger's speed.
   */
  takeReleaseVelocity: () => number | null
  /** The surface started its exit — stop springing it back. */
  markExiting: () => void
}

interface Active {
  id: number
  startX: number
  startY: number
  startT: number
  base: number
  size: number
  engaged: boolean
  samples: DragSample[]
  /** The grab surface — the drag captures the pointer here once it commits. */
  handle: HTMLElement
}

/** The fields of a pointer event the drag reads (React's or the DOM's). */
interface PointerSample {
  pointerId: number
  clientX: number
  clientY: number
  timeStamp: number
}

// Text controls own their own drags (selection, sliders).
const TEXT_CONTROL = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]'

/** Along-axis and cross-axis deltas, along positive toward the dismiss edge. */
function axisDeltas(edge: DismissEdge, dx: number, dy: number): [number, number] {
  if (edge === 'bottom') return [dy, dx]
  return [edge === 'right' ? dx : -dx, dy]
}

function sizeOf(el: HTMLElement | null, edge: DismissEdge): number {
  if (!el) return 0
  const r = el.getBoundingClientRect()
  return edge === 'bottom' ? r.height : r.width
}

/**
 * Apple: an interrupted animation restarts from the on-screen (presentation)
 * value, never its target. Cancel the surface's running WAAPI enter/exit and
 * return where it actually was, in dismiss units.
 */
function interruptPresentation(el: HTMLElement | null, edge: DismissEdge): number | null {
  if (!el || typeof el.getAnimations !== 'function') return null
  const running = el.getAnimations()
  if (running.length === 0) return null
  let px = 0
  const t = getComputedStyle(el).transform
  if (t && t !== 'none' && typeof DOMMatrixReadOnly === 'function') {
    const m = new DOMMatrixReadOnly(t)
    px = edge === 'bottom' ? m.m42 : edge === 'right' ? m.m41 : -m.m41
  }
  running.forEach((a) => a.cancel())
  el.style.opacity = ''
  return px
}

/**
 * Drag-to-dismiss for a phone sheet or side drawer, per Emil and Apple:
 * 1:1 tracking from where it was grabbed, rubber-band friction against the
 * open direction, pointer capture once the drag commits (10px slop), one
 * finger only, dismissal on distance OR a flick (> 0.11 px/ms) unless the
 * finger is moving back, and a spring that inherits the release velocity.
 * The hook only owns the drag offset; SheetPanel renders the transform and
 * runs enter/exit (the fling-out uses takeReleaseVelocity()).
 */
export function useDragToDismiss({
  onDismiss, edge = 'bottom', targetRef, enabled = true,
}: DragToDismissOptions): DragToDismiss {
  const offset = useMotionValue(0)
  const reduce = useReducedMotion()
  const active = useRef<Active | null>(null)
  const settling = useRef<AnimationPlaybackControls | null>(null)
  const justDragged = useRef(false)
  const exiting = useRef(false)
  const velocityOut = useRef<number | null>(null)
  const vetoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Window listeners that follow the pointer until the drag commits (it can
  // leave a thin grabber before then, and capture waits for the commit).
  const unwatch = useRef<(() => void) | null>(null)
  const onDismissRef = useRef(onDismiss)
  useEffect(() => {
    onDismissRef.current = onDismiss
  }, [onDismiss])
  useEffect(() => () => {
    clearTimeout(vetoTimer.current)
    settling.current?.stop()
    unwatch.current?.()
  }, [])

  const settle = useCallback(
    (velocityPxPerSec: number) => {
      settling.current?.stop()
      settling.current = reduce
        ? animate(offset, 0, TWEEN.fade)
        : animate(offset, 0, { ...SPRING.drag, velocity: velocityPxPerSec })
    },
    [offset, reduce],
  )

  const end = useCallback(
    (e: PointerEvent<HTMLElement>, cancelled: boolean) => {
      const a = active.current
      if (!a || e.pointerId !== a.id) return
      active.current = null
      unwatch.current?.()
      if (!a.engaged) return
      justDragged.current = true
      const target = e.currentTarget
      if (target.hasPointerCapture?.(a.id)) target.releasePointerCapture(a.id)
      const [along] = axisDeltas(edge, e.clientX - a.startX, e.clientY - a.startY)
      const distance = a.base + along
      const velocity = releaseVelocity(a.samples, e.timeStamp)
      const dismiss = !cancelled && !exiting.current && shouldDismiss({
        distance, elapsed: e.timeStamp - a.startT, velocity, size: a.size,
      })
      if (!dismiss) {
        settle(velocity * 1000)
        return
      }
      velocityOut.current = Math.max(0, velocity * 1000)
      onDismissRef.current()
      // The parent may veto (an unsaved-changes guard keeps it open): if no
      // exit has started shortly after, spring home instead of hanging.
      clearTimeout(vetoTimer.current)
      vetoTimer.current = setTimeout(() => {
        if (exiting.current) return
        velocityOut.current = null
        settle(0)
      }, 150)
    },
    [edge, settle],
  )

  // One pointer sample → commit / cancel / follow. Runs for the handle's own
  // pointermove and, until the drag commits, for moves anywhere on the page.
  const move = useCallback(
    (e: PointerSample) => {
      const a = active.current
      if (!a || e.pointerId !== a.id) return
      const [along, cross] = axisDeltas(edge, e.clientX - a.startX, e.clientY - a.startY)
      if (!a.engaged) {
        const kind = classifyMove(along, cross)
        if (kind === null) return
        unwatch.current?.()
        if (kind === 'cancel') {
          active.current = null
          return
        }
        a.engaged = true
        // Capture only once the drag commits, so a tap still reaches the
        // close button inside the handle.
        try {
          a.handle.setPointerCapture?.(e.pointerId)
        } catch {
          // The pointer is already gone (released between frames).
        }
      }
      const raw = a.base + along
      pushSample(a.samples, { d: raw, t: e.timeStamp })
      offset.set(dragOffset(raw, a.size))
    },
    [edge, offset],
  )

  const handleProps = useMemo<DragToDismiss['handleProps']>(() => ({
    onPointerDown: (e) => {
      if (!enabled || exiting.current) return
      // Multi-touch guard: a second finger never takes over a live drag.
      if (active.current) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      if ((e.target as Element).closest?.(TEXT_CONTROL)) return
      justDragged.current = false
      const presented = interruptPresentation(targetRef.current, edge)
      settling.current?.stop()
      if (presented !== null) offset.set(presented)
      active.current = {
        id: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startT: e.timeStamp,
        base: offset.get(),
        size: sizeOf(targetRef.current, edge),
        engaged: false,
        samples: [],
        handle: e.currentTarget,
      }
      // Until it commits, follow the pointer off the handle too (a fast flick
      // leaves a 50px grabber in one frame); the handle's own events go
      // through React.
      unwatch.current?.()
      const handle = e.currentTarget
      const onMove = (ev: globalThis.PointerEvent) => {
        if (!handle.contains(ev.target as Node)) move(ev)
      }
      const onUp = (ev: globalThis.PointerEvent) => {
        const a = active.current
        if (!a || ev.pointerId !== a.id || a.engaged) return
        if (handle.contains(ev.target as Node)) return
        active.current = null
        stop()
      }
      const stop = () => {
        window.removeEventListener('pointermove', onMove, true)
        window.removeEventListener('pointerup', onUp, true)
        window.removeEventListener('pointercancel', onUp, true)
        unwatch.current = null
      }
      window.addEventListener('pointermove', onMove, true)
      window.addEventListener('pointerup', onUp, true)
      window.addEventListener('pointercancel', onUp, true)
      unwatch.current = stop
    },
    onPointerMove: (e) => move(e),
    onPointerUp: (e) => end(e, false),
    onPointerCancel: (e) => end(e, true),
    // Only the handle's own capture. A touch is captured by whatever element
    // it lands on (the title, the grabber); when the drag commits and capture
    // moves to the handle, that child's lostpointercapture bubbles up here
    // and must not cancel the drag that just began.
    onLostPointerCapture: (e) => {
      if (e.target !== e.currentTarget) return
      end(e, true)
    },
    onClickCapture: (e) => {
      // The click that ends a drag is not a tap on whatever sits under it.
      if (!justDragged.current) return
      justDragged.current = false
      e.preventDefault()
      e.stopPropagation()
    },
    // The browser keeps the other axis: a sheet's handle owns everything; a
    // side drawer keeps vertical scrolling.
    style: {
      touchAction: edge === 'bottom' ? 'none' : 'pan-y',
      userSelect: 'none',
      WebkitUserSelect: 'none',
    },
    'data-drag-handle': '',
  }), [edge, enabled, end, move, offset, targetRef])

  const takeReleaseVelocity = useCallback(() => {
    const v = velocityOut.current
    velocityOut.current = null
    return v
  }, [])

  const markExiting = useCallback(() => {
    exiting.current = true
    clearTimeout(vetoTimer.current)
    settling.current?.stop()
  }, [])

  return { offset, handleProps, takeReleaseVelocity, markExiting }
}
