import type { Transition } from 'framer-motion'

/**
 * DeskDev motion presets — the only curves, durations and springs a screen
 * should use. Every value comes from Emil Kowalski's tables (animations.dev)
 * or Apple's fluid-interface defaults; none is hand-tuned. index.css mirrors
 * the curves and durations as CSS variables (--ease-*, --dur-*), and
 * presets.test.ts fails if the two drift apart.
 *
 * DeskDev is a daily work tool: crisp and fast. Before animating anything,
 * run the gate in the kit's guide (scratchpad deskdev-motion-kit.md):
 * keyboard-initiated or 100+/day actions never animate; tens/day get
 * near-imperceptible motion or none.
 */

/** Cubic-bezier control points, for Motion's `ease`. */
export const EASE = {
  /** Strong ease-out: anything entering or leaving (dropdowns, modals, toasts). */
  out: [0.23, 1, 0.32, 1],
  /** Strong ease-in-out: something already on screen moving or morphing. */
  inOut: [0.77, 0, 0.175, 1],
  /** iOS drawer curve (Ionic): sheets and drawers sliding from an edge. */
  drawer: [0.32, 0.72, 0, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>

/** The same curves as CSS strings (inline styles, WAAPI). */
export const EASE_CSS = {
  out: 'cubic-bezier(0.23, 1, 0.32, 1)',
  inOut: 'cubic-bezier(0.77, 0, 0.175, 1)',
  drawer: 'cubic-bezier(0.32, 0.72, 0, 1)',
} as const

/**
 * Durations in seconds (Motion's unit). The *Exit rungs are shorter than
 * their enter: slow where the user is looking, snappy where the system
 * responds. UI stays under 300ms; only the sheet, which travels the height
 * of the screen, sits in the 200–500ms drawer band.
 */
export const DURATION = {
  /** Button / tab press feedback (100–160ms). */
  press: 0.16,
  /** Tooltips, small popovers (125–200ms). */
  tooltip: 0.125,
  /** Dropdowns, menus, selects, popovers (150–250ms). */
  popover: 0.18,
  popoverExit: 0.12,
  /** Centered modal + its scrim (200–500ms band, kept under 300). */
  modal: 0.24,
  modalExit: 0.15,
  /** Phone bottom sheet / side drawer travelling in from an edge. */
  sheet: 0.35,
  sheetExit: 0.25,
  /** Reduced-motion stand-in for any movement: a plain opacity fade. */
  fade: 0.2,
  /** Route content fade (tens/day: near-imperceptible). */
  route: 0.12,
  /** One stagger item's own fade-rise. */
  listItem: 0.24,
  /** A stat's count to a new value. */
  number: 0.4,
} as const

/** Same rungs in milliseconds, for CSS-in-JS and timers. */
export const DURATION_MS = Object.fromEntries(
  Object.entries(DURATION).map(([k, v]) => [k, Math.round(v * 1000)]),
) as { readonly [K in keyof typeof DURATION]: number }

/** Stagger between siblings on a view's first load (30–80ms band). */
export const STAGGER = {
  /** Seconds between items. */
  gap: 0.04,
  /** Items after this index arrive with the last delayed one. */
  maxItems: 10,
} as const

/**
 * Springs — for anything a finger or pointer can interrupt. They retarget
 * from the current value and carry velocity; a tween restarts from zero.
 */
export const SPRING = {
  /** Emil's default: interruptible state changes (expand, reorder settle). */
  ui: { type: 'spring', duration: 0.5, bounce: 0.2 },
  /**
   * Layout indicators (tab pill, nav rail, segmented control). Critically
   * damped, Apple's default UI response (damping 1.0, response 0.3): a
   * dashboard indicator glides, it never wobbles.
   */
  indicator: { type: 'spring', duration: 0.3, bounce: 0 },
  /**
   * Drag release — settle back or fling out with the finger's velocity.
   * The bounce is earned: a gesture with momentum preceded it.
   */
  drag: { type: 'spring', duration: 0.5, bounce: 0.2 },
  /**
   * The taste skill's decorative spring. Login and Install only (magnetic
   * CTA) — never on a daily-use surface.
   */
  decorative: { type: 'spring', stiffness: 100, damping: 20 },
} as const satisfies Record<string, Transition>

/** Ready-made tween transitions, for `transition={TWEEN.popover}`. */
export const TWEEN = {
  press: { duration: DURATION.press, ease: EASE.out },
  tooltip: { duration: DURATION.tooltip, ease: EASE.out },
  popover: { duration: DURATION.popover, ease: EASE.out },
  popoverExit: { duration: DURATION.popoverExit, ease: EASE.out },
  modal: { duration: DURATION.modal, ease: EASE.out },
  modalExit: { duration: DURATION.modalExit, ease: EASE.out },
  sheet: { duration: DURATION.sheet, ease: EASE.drawer },
  sheetExit: { duration: DURATION.sheetExit, ease: EASE.drawer },
  fade: { duration: DURATION.fade, ease: EASE.out },
  move: { duration: DURATION.popover, ease: EASE.inOut },
  instant: { duration: 0 },
} as const satisfies Record<string, Transition>

/** Press scale — buttons, tabs, chips (Emil: 0.95–0.98). */
export const PRESS_SCALE = 0.97
/** Press scale for wide surfaces (cards, full-width rows). */
export const PRESS_SCALE_CARD = 0.98
/** Entry scale for popovers and tooltips — never from 0. */
export const POP_SCALE = 0.95
/** Entry scale for centered modals. */
export const MODAL_SCALE = 0.96
