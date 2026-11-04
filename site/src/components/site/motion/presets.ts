/**
 * The marketing site's motion vocabulary. Every curve, duration and spring the
 * kit uses lives here; pages use these names instead of inventing values.
 *
 * Curves are Emil Kowalski's (mirrored as CSS variables in styles/nx.css:
 * --ease-out, --ease-in-out, --ease-drawer). There is deliberately no ease-in:
 * it starts slow, exactly when the reader is watching.
 *
 * Pure module (no React, no framer-motion import), so server components and
 * tests can read it.
 */

/** Cubic-bezier control points, in framer-motion's `ease` format. */
export const EASE = {
  /** Entering / exiting, the default. Strong ease-out. */
  out: [0.23, 1, 0.32, 1],
  /** Something already on screen moving or morphing (clip-path apertures, indicators). */
  inOut: [0.77, 0, 0.175, 1],
  /** Sheets and drawers (iOS curve, via Ionic). */
  drawer: [0.32, 0.72, 0, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

export type EaseName = keyof typeof EASE;

/** The same curves as CSS strings (inline styles, WAAPI, `transition:` values). */
export const EASE_CSS: Record<EaseName, string> = {
  out: toCubicBezier(EASE.out),
  inOut: toCubicBezier(EASE.inOut),
  drawer: toCubicBezier(EASE.drawer),
};

export function toCubicBezier(points: readonly [number, number, number, number]): string {
  return `cubic-bezier(${points.join(', ')})`;
}

/**
 * Durations in SECONDS (framer-motion's unit). UI stays under 0.3s; the
 * marketing-only entries (reveal, counter) are explanatory and may run longer.
 * CSS twins: --dur-press, --dur-tooltip, --dur-dropdown, --dur-modal,
 * --dur-drawer, --dur-reveal, --dur-reveal-long (nx.css).
 */
export const DURATION = {
  /** Button press feedback (100–160ms). */
  press: 0.14,
  /** Tooltips, small popovers (125–200ms). */
  tooltip: 0.16,
  /** Dropdowns, selects (150–250ms). */
  dropdown: 0.2,
  /** Modals (200–500ms; UI budget keeps it under 300). */
  modal: 0.28,
  /** Drawers / sheets with --ease-drawer. */
  drawer: 0.5,
  /** Exit of a small popped element: faster than its entrance. */
  exit: 0.15,
  /** Opacity under reduced motion: the fade that replaces movement. */
  fade: 0.3,
  /** Marketing scroll reveal (rise, slide, scale). */
  reveal: 0.7,
  /** Marketing clip-path aperture and masked word rise. */
  revealLong: 0.9,
  /** Media settling inside a clip reveal (outlasts its frame slightly: reads as depth). */
  media: 1.2,
  /** Count-up of a statistic. */
  counter: 1.4,
} as const;

/**
 * Springs.
 * - ui: Emil's default for interface motion (indicators, reorders, pops).
 * - settle: critically damped, no overshoot (Apple's reposition: damping 1, response 0.4).
 * - playful: the top of Emil's 0.1–0.3 bounce range. Only for rare, playful
 *   moments (a notification badge popping in a marketing mockup).
 * - decorative: taste's weighty spring. ONLY for decorative marketing motion
 *   (magnetic pull, scroll-velocity smoothing), never for UI state.
 */
export const SPRING = {
  ui: { type: 'spring', duration: 0.5, bounce: 0.2 },
  settle: { type: 'spring', duration: 0.4, bounce: 0 },
  playful: { type: 'spring', duration: 0.5, bounce: 0.3 },
  decorative: { type: 'spring', stiffness: 100, damping: 20 },
} as const;

/** The decorative spring as `useSpring` options (no `type` key). */
export const DECORATIVE_SPRING_OPTIONS = { stiffness: SPRING.decorative.stiffness, damping: SPRING.decorative.damping } as const;

/** Stagger, in seconds between siblings. Emil's window is 30–80ms. */
export const STAGGER = {
  /** Default between items in a group. */
  each: 0.06,
  /** Between words of a split headline. */
  words: 0.05,
  min: 0.03,
  max: 0.08,
  /** No item waits longer than this: long lists land together after the first few. */
  maxTotal: 0.6,
} as const;

/**
 * In-view trigger. The bottom margin makes a reveal fire once the element is
 * ~12% above the fold (the old engine's "top 88%").
 */
export const IN_VIEW = {
  margin: '0px 0px -12% 0px',
  /** Counters start a little later, so the count is actually watched. */
  counterMargin: '0px 0px -10% 0px',
  /** Loops run while within 10% of the viewport and pause beyond it. */
  loopMargin: '10% 0px 10% 0px',
} as const;

/** Media queries the kit shares with CSS. */
export const QUERY = {
  reducedMotion: '(prefers-reduced-motion: reduce)',
  /** Hover-capable precise pointer: gate every hover motion behind this. */
  finePointer: '(hover: hover) and (pointer: fine)',
  /**
   * Horizontal scroll is active. MUST match the `pin:` custom variant in
   * styles/nx.css, so layout classes and the JS agree.
   */
  pin: '(prefers-reduced-motion: no-preference) and (min-width: 1024px) and (min-height: 560px)',
} as const;

/**
 * If the provider hasn't hydrated by this point (ms after navigation start),
 * the CSS fail-safe in nx.css has already shown every kit-hidden element, and
 * the kit skips entrance animations for the session instead of re-hiding them.
 * Keep in sync with the `nx-kit-failsafe` animation delay in nx.css.
 */
export const FAILSAFE_MS = 3000;

/**
 * Shows every kit-hidden element (`[data-nx-reveal]`). Used by
 * <MotionNoScript> when JavaScript is off; the same declarations sit in
 * nx.css for `@media (scripting: none)` and print.
 */
export const NOSCRIPT_CSS = '[data-nx-reveal]{opacity:1!important;transform:none!important;clip-path:none!important}';
