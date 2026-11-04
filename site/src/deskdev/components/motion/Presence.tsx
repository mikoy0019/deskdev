import {
  createContext, useContext, useEffect, useLayoutEffect, useRef, useState,
  type CSSProperties, type HTMLAttributes, type ReactNode, type Ref,
} from 'react'
import {
  AnimatePresence, animate, m, useIsPresent, usePresence, useReducedMotion,
  type AnimatePresenceProps, type HTMLMotionProps, type Transition, type Variants,
} from 'framer-motion'
import { classNames } from '../../lib/format'
import { DURATION_MS, EASE_CSS, MODAL_SCALE, POP_SCALE, SPRING, TWEEN } from './presets'
import { getInputModality, useInputModality } from './inputModality'
import { originStyle, type Placement } from './origin'
import { useDragToDismiss, type DismissEdge, type DragToDismiss } from './useDragToDismiss'

/*
 * Enter + exit for overlays. One rule set for all of them:
 *   - ease-out in, a shorter ease-out out (exit snaps, enter is watched);
 *   - opacity + transform only, never from scale(0);
 *   - popovers grow from their trigger (--transform-origin), modals stay centred,
 *     sheets and drawers leave through the edge they came from;
 *   - opened or closed from the keyboard → no animation at all (Emil: never
 *     animate keyboard-initiated actions). Escape closes instantly.
 *   - reduced motion: the transforms drop, the fades remain (picked here —
 *     MotionConfig can't see inside a `transform` string).
 */

/**
 * `custom` an exiting child receives: was the close keyboard-initiated, and
 * is reduced motion on? (MotionConfig's reducedMotion only drops the x / y /
 * scale shorthands; the kit animates full `transform` strings for hardware
 * acceleration, so it picks the opacity-only variant itself.)
 */
export interface ExitCustom {
  instant: boolean
  reduce: boolean
}

/** The custom every overlay part shares: keyboard → instant, reduced motion → fade only. */
function useOverlayCustom(): ExitCustom {
  const instant = useInputModality() === 'keyboard'
  const reduce = useReducedMotion() === true
  return { instant, reduce }
}

/**
 * AnimatePresence that tells exiting overlays how they were closed, so an
 * Escape (or Enter on a menu item) removes them instantly. Use it instead of
 * AnimatePresence for every overlay; children need a stable `key`.
 */
export function Presence({ children, ...props }: Omit<AnimatePresenceProps, 'custom'> & { children?: ReactNode }) {
  const custom = useOverlayCustom()
  return (
    <AnimatePresence {...props} custom={custom}>
      {children}
    </AnimatePresence>
  )
}

/**
 * Enter/exit variants for a scale-from-origin surface. Exit is the enter in
 * reverse with its own (shorter) timing. Reduced motion keeps the fade.
 */
export function scaleVariants(scale: number, enter: Transition, exit: Transition): Variants {
  return {
    closed: ({ instant, reduce }: ExitCustom) => {
      if (instant) return { opacity: 0, transition: TWEEN.instant }
      if (reduce) return { opacity: 0, transition: exit }
      return { opacity: 0, transform: `scale(${scale})`, transition: exit }
    },
    open: ({ reduce }: ExitCustom) =>
      reduce ? { opacity: 1, transition: TWEEN.fade } : { opacity: 1, transform: 'scale(1)', transition: enter },
  }
}

const popoverVariants = scaleVariants(POP_SCALE, TWEEN.popover, TWEEN.popoverExit)
const tooltipVariants = scaleVariants(0.97, TWEEN.tooltip, TWEEN.tooltip)
const dialogVariants = scaleVariants(MODAL_SCALE, TWEEN.modal, TWEEN.modalExit)

const scrimVariants: Variants = {
  closed: ({ instant }: ExitCustom) => ({ opacity: 0, transition: instant ? TWEEN.instant : TWEEN.modalExit }),
  open: { opacity: 1, transition: TWEEN.modal },
}

type PanelProps = Omit<HTMLMotionProps<'div'>, 'initial' | 'animate' | 'exit' | 'variants' | 'custom'>

/**
 * A toast-like notice (UpdatePrompt, an offline banner, an undo bar — Sonner
 * owns real toasts). Rises from the edge it is pinned to and leaves the same
 * way: 240ms in, 150ms out, strong ease-out. `distance` is how far it travels
 * — '100%' (its own height) for a fixed notice, a few px for one in flow.
 */
export function NoticePanel({
  edge = 'bottom', distance = '100%', ...props
}: PanelProps & { edge?: 'top' | 'bottom'; distance?: string }) {
  const custom = useOverlayCustom()
  const off = `translate3d(0, ${edge === 'bottom' ? distance : `calc(-1 * ${distance})`}, 0)`
  const variants: Variants = {
    closed: ({ instant, reduce }: ExitCustom) => {
      if (instant) return { opacity: 0, transition: TWEEN.instant }
      if (reduce) return { opacity: 0, transition: TWEEN.modalExit }
      return { opacity: 0, transform: off, transition: TWEEN.modalExit }
    },
    open: ({ reduce }: ExitCustom) =>
      reduce ? { opacity: 1, transition: TWEEN.fade } : { opacity: 1, transform: 'translate3d(0, 0, 0)', transition: TWEEN.modal },
  }
  return (
    <m.div
      {...props}
      custom={custom}
      variants={variants}
      initial={custom.instant ? false : 'closed'}
      animate="open"
      exit="closed"
    />
  )
}

/**
 * A dropdown / menu / picker / popover panel. Grows from its trigger:
 * `placement` gives the fallback origin, `--transform-origin` (set by
 * positioning code that flips) overrides it. 180ms in, 120ms out.
 */
export function PopoverPanel({
  placement = 'bottom-start', style, ...props
}: PanelProps & { placement?: Placement }) {
  const custom = useOverlayCustom()
  return (
    <m.div
      {...props}
      custom={custom}
      variants={popoverVariants}
      initial={custom.instant ? false : 'closed'}
      animate="open"
      exit="closed"
      style={{ transformOrigin: originStyle(placement), ...style }}
    />
  )
}

// Tooltips: the first waits and fades; once one has been open, neighbours
// show instantly (no delay, no animation) until the pointer rests elsewhere.
let tooltipWarmUntil = 0
const TOOLTIP_COOLDOWN_MS = 300

/** Is a tooltip group warm (one was open moments ago)? Read when deciding the delay. */
export function tooltipIsWarm(now = Date.now()): boolean {
  return now < tooltipWarmUntil
}

/** A tooltip bubble. Same contract as PopoverPanel, 125ms, instant when warm. */
export function TooltipPanel({
  placement = 'top', style, ...props
}: PanelProps & { placement?: Placement }) {
  const custom = useOverlayCustom()
  // Decided once, at mount: a tooltip appearing while the group is warm skips its enter.
  const [warm] = useState(() => tooltipIsWarm())
  useEffect(() => () => {
    tooltipWarmUntil = Date.now() + TOOLTIP_COOLDOWN_MS
  }, [])
  return (
    <m.div
      role="tooltip"
      {...props}
      custom={custom}
      variants={tooltipVariants}
      initial={custom.instant || warm ? false : 'closed'}
      animate="open"
      exit="closed"
      style={{ transformOrigin: originStyle(placement), ...style }}
    />
  )
}

/** The centred desktop dialog panel: scale 0.96 + fade, origin centre, 240ms in / 150ms out. */
export function DialogPanel({ style, ...props }: PanelProps) {
  const custom = useOverlayCustom()
  return (
    <m.div
      {...props}
      custom={custom}
      variants={dialogVariants}
      initial={custom.instant ? false : 'closed'}
      animate="open"
      exit="closed"
      style={{ transformOrigin: 'center', ...style }}
    />
  )
}

/** The one scrim (the `scrim` utility), faded with its dialog or sheet. */
export function Scrim({ className, ...props }: PanelProps) {
  const custom = useOverlayCustom()
  return (
    <m.div
      aria-hidden
      {...props}
      className={classNames('scrim', className)}
      custom={custom}
      variants={scrimVariants}
      initial={custom.instant ? false : 'closed'}
      animate="open"
      exit="closed"
    />
  )
}

/**
 * The fixed layer an overlay lives in — the direct child of <Presence>.
 * While its contents play their exit it stops taking pointer events, so the
 * page underneath is usable the moment a dismissal is decided.
 */
export function OverlayRoot({ style, ...props }: HTMLAttributes<HTMLDivElement> & { ref?: Ref<HTMLDivElement> }) {
  const present = useIsPresent()
  return <div {...props} style={present ? style : { ...style, pointerEvents: 'none' }} />
}

// ─── Sheets and drawers ────────────────────────────────────────────────────

const SheetDragContext = createContext<DragToDismiss['handleProps'] | null>(null)

/**
 * The drag surface inside a SheetPanel: the grabber + title bar of a bottom
 * sheet. (A side drawer's SheetPanel is its own handle — no SheetHandle.)
 * Taps on buttons inside it still work; only a committed drag is captured.
 */
export function SheetHandle({ style, ...props }: HTMLAttributes<HTMLDivElement>) {
  const handle = useContext(SheetDragContext)
  if (!handle) return <div style={style} {...props} />
  const { style: handleStyle, ...handlers } = handle
  return <div {...props} {...handlers} style={{ ...handleStyle, ...style }} />
}

function restingTransform(edge: DismissEdge, d: number): string {
  if (d === 0) return 'none'
  if (edge === 'bottom') return `translate3d(0, ${d}px, 0)`
  return `translate3d(${edge === 'right' ? d : -d}px, 0, 0)`
}

function offscreen(edge: DismissEdge): string {
  if (edge === 'bottom') return 'translate3d(0, 100%, 0)'
  return `translate3d(${edge === 'right' ? '100%' : '-100%'}, 0, 0)`
}

export interface SheetPanelProps extends HTMLAttributes<HTMLDivElement> {
  /** Closes the surface — the same handler the scrim and close button use. */
  onDismiss: () => void
  /** The edge it enters from and leaves through. Default 'bottom'. */
  edge?: DismissEdge
  /** false = no swipe-to-dismiss (it still enters and exits). */
  draggable?: boolean
  ref?: Ref<HTMLDivElement>
  children?: ReactNode
}

/**
 * A phone bottom sheet (edge 'bottom') or side drawer ('left' / 'right').
 * Enters along its edge with the iOS drawer curve (350ms) and leaves the same
 * way (250ms); swipe it toward the edge to dismiss. Must sit inside
 * <Presence>. The enter/exit run as WAAPI transform animations (compositor —
 * smooth while the sheet's content is still mounting); the drag writes the
 * transform straight onto this element; a fling carries its velocity into the
 * exit spring. Bottom sheets take the drag on <SheetHandle>; side drawers on
 * the whole panel (vertical scrolling stays native).
 */
export function SheetPanel({
  onDismiss, edge = 'bottom', draggable = true, ref, style, children, ...props
}: SheetPanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [isPresent, safeToRemove] = usePresence()
  const reduce = useReducedMotion()
  const drag = useDragToDismiss({ onDismiss, edge, targetRef: panelRef, enabled: draggable && isPresent })

  const setRefs = (el: HTMLDivElement | null) => {
    panelRef.current = el
    if (typeof ref === 'function') ref(el)
    else if (ref) ref.current = el
  }

  // The drag offset → the transform, written directly (no React render, no
  // CSS variable on an ancestor).
  useEffect(() => {
    const write = (d: number) => {
      const el = panelRef.current
      if (el) el.style.transform = restingTransform(edge, d)
    }
    write(drag.offset.get())
    return drag.offset.on('change', write)
  }, [drag.offset, edge])

  // Enter: before first paint, so it never flashes in place.
  useLayoutEffect(() => {
    const el = panelRef.current
    if (!el || typeof el.animate !== 'function' || getInputModality() === 'keyboard') return
    const enter = reduce
      ? el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION_MS.fade, easing: EASE_CSS.out })
      : el.animate([{ transform: offscreen(edge) }, { transform: 'none' }], {
          duration: DURATION_MS.sheet, easing: EASE_CSS.drawer,
        })
    return () => enter.cancel()
    // Mount only: the edge of a mounted sheet doesn't change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Exit: the way it came. A fling continues at the finger's speed.
  useEffect(() => {
    if (isPresent) return
    drag.markExiting()
    let finished = false
    const done = () => {
      if (finished) return
      finished = true
      safeToRemove?.()
    }
    const el = panelRef.current
    const velocity = drag.takeReleaseVelocity()
    if (!el || getInputModality() === 'keyboard') {
      done()
      return
    }
    if (reduce || typeof el.animate !== 'function') {
      if (typeof el.animate !== 'function') {
        done()
        return
      }
      const fade = el.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: DURATION_MS.modalExit, easing: EASE_CSS.out, fill: 'forwards',
      })
      fade.finished.then(done, done)
      return () => fade.cancel()
    }
    if (velocity !== null) {
      const rect = el.getBoundingClientRect()
      const size = edge === 'bottom' ? rect.height : rect.width
      // Remove as soon as it is out of view — not when the spring finally rests.
      const stop = drag.offset.on('change', (d) => {
        if (d >= size) done()
      })
      const fling = animate(drag.offset, size, { ...SPRING.drag, velocity })
      fling.then(done, done)
      return () => {
        stop()
        fling.stop()
      }
    }
    const from = el.style.transform || 'none'
    const leave = el.animate([{ transform: from }, { transform: offscreen(edge) }], {
      duration: DURATION_MS.sheetExit, easing: EASE_CSS.drawer, fill: 'forwards',
    })
    leave.finished.then(done, done)
    return () => leave.cancel()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPresent])

  const isDrawer = edge !== 'bottom'
  const panelHandlers = isDrawer && draggable ? drag.handleProps : null
  const { style: handleStyle, ...drawerHandlers } = panelHandlers ?? { style: undefined }
  const mergedStyle: CSSProperties = { ...handleStyle, ...style }

  return (
    <SheetDragContext.Provider value={draggable && !isDrawer ? drag.handleProps : null}>
      <div ref={setRefs} {...props} {...drawerHandlers} style={mergedStyle}>
        {children}
      </div>
    </SheetDragContext.Provider>
  )
}
