/**
 * DeskDev motion + interaction kit. Import from here:
 *
 *   import { Presence, PopoverPanel, LayoutIndicator, StatusDot } from '../motion'
 *
 * The guide (gate, purposes, per-surface decisions, examples) is the kit's
 * README for screen work. Presets are the only values — don't invent curves,
 * durations or springs at the call site.
 */
export {
  EASE, EASE_CSS, DURATION, DURATION_MS, STAGGER, SPRING, TWEEN,
  PRESS_SCALE, PRESS_SCALE_CARD, POP_SCALE, MODAL_SCALE,
} from './presets'
export { MotionProvider } from './MotionProvider'
export {
  Presence, PopoverPanel, TooltipPanel, DialogPanel, NoticePanel, Scrim, OverlayRoot,
  SheetPanel, SheetHandle, tooltipIsWarm, type SheetPanelProps,
} from './Presence'
export { useDragToDismiss, type DismissEdge, type DragToDismiss, type DragToDismissOptions } from './useDragToDismiss'
export { LayoutIndicator, IndicatorGroup } from './LayoutIndicator'
export { Stagger, useStagger } from './Stagger'
export { StatusDot, type StatusTone } from './StatusDot'
export { Skeleton } from './Skeleton'
export { AnimatedNumber } from './AnimatedNumber'
export { Magnetic } from './Magnetic'
export {
  useInputModality, getInputModality, isKeyboardInitiated, type InputModality,
} from './inputModality'
export { useFirstVisit } from './firstVisit'
export { originFor, originStyle, type Placement } from './origin'
// Motion itself, so screens import everything motion from one place.
export { m, AnimatePresence, LayoutGroup, useReducedMotion } from 'framer-motion'
