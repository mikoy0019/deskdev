/**
 * Pure math behind the pointer- and scroll-linked primitives (Magnetic,
 * Parallax, HorizontalScroll), kept out of the components so it is tested.
 */

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export type MagneticOptions = {
  /** Fraction of the pointer's offset from the centre the element follows. */
  strength?: number;
  /** Max travel in px, horizontally / vertically. */
  maxX?: number;
  maxY?: number;
};

/** The existing site's feel: ~30% of the offset, at most 10px across and 8px down. */
export const MAGNETIC_DEFAULTS = { strength: 0.3, maxX: 10, maxY: 8 } as const;

/**
 * Where a magnetic element should sit for a pointer at (`pointerX`, `pointerY`)
 * over a box (`rect`). The pull is proportional, then clamped, so a large
 * button never wanders away from its label.
 */
export function magneticOffset(
  pointerX: number,
  pointerY: number,
  rect: { left: number; top: number; width: number; height: number },
  options: MagneticOptions = {},
): { x: number; y: number } {
  // `??`, not a spread: a prop passed through as `undefined` keeps the default.
  const strength = finiteOr(options.strength, MAGNETIC_DEFAULTS.strength);
  const maxX = Math.abs(finiteOr(options.maxX, MAGNETIC_DEFAULTS.maxX));
  const maxY = Math.abs(finiteOr(options.maxY, MAGNETIC_DEFAULTS.maxY));
  const dx = pointerX - (rect.left + rect.width / 2);
  const dy = pointerY - (rect.top + rect.height / 2);
  return {
    x: round2(clamp(dx * strength, -maxX, maxX)),
    y: round2(clamp(dy * strength, -maxY, maxY)),
  };
}

/**
 * Parallax drift as a percentage of the element's own height. `progress` runs
 * 0 → 1 while the element crosses the viewport (enters at the bottom, leaves at
 * the top). A positive `amount` drifts up as you scroll (slower than the page);
 * negative drifts down. amount 0.15 → +7.5% … −7.5%.
 */
export function parallaxPercent(progress: number, amount: number): number {
  const p = clamp(progress, 0, 1);
  return round2(amount * 50 * (1 - 2 * p));
}

/** How far a horizontal track must travel to show its last panel (never negative). */
export function trackDistance(scrollWidth: number, clientWidth: number): number {
  return Math.max(0, Math.round(scrollWidth - clientWidth));
}

/** Horizontal offset (px, ≤ 0) of the track for a vertical scroll `progress` 0 → 1. */
export function trackOffset(progress: number, distance: number): number {
  return round2(-clamp(progress, 0, 1) * Math.max(0, distance));
}

/**
 * The window scrollY that brings a panel to the track's starting edge — used
 * when keyboard focus lands on a panel that is still off to the right.
 * `sectionTop` is the section's top in document coordinates.
 */
export function panelScrollTop(panelLeft: number, originLeft: number, distance: number, sectionTop: number): number {
  if (distance <= 0) return Math.round(sectionTop);
  const progress = clamp((panelLeft - originLeft) / distance, 0, 1);
  return Math.round(sectionTop + progress * distance);
}

function finiteOr(value: number | undefined, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function round2(n: number) {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}
