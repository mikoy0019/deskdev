/**
 * Variant + transition builders for Reveal, StaggerItem and SplitWords.
 * Pure (no React), so the exact frames are unit-tested.
 *
 * Movement is written as full transform strings (hardware accelerated: framer
 * hands `transform`, `opacity` and `clipPath` to WAAPI, which keeps running
 * while the page is busy loading), never the x / y / scale shorthands. Every
 * entrance ends on `transform: none` / `clip-path: none` (transitionEnd) so a
 * revealed section is not left as a containing block for fixed children.
 */
import { DURATION, EASE, STAGGER } from './presets';

export type RevealKind = 'up' | 'fade' | 'left' | 'right' | 'scale' | 'clip';

type Frame = {
  opacity?: number;
  transform?: string;
  clipPath?: string;
  transitionEnd?: { transform?: string; clipPath?: string };
};

export type RevealFrames = { hidden: Frame; shown: Frame };

/** Default travel, in px. Marketing scale: noticeable, never a fly-in. */
export const REVEAL_DISTANCE = { up: 24, side: 40, scale: 16 } as const;

const translate = (x: number, y: number) => `translate3d(${x}px, ${y}px, 0px)`;

/** Hidden + shown frames for one reveal kind. `distance` overrides the default travel (px). */
export function revealFrames(kind: RevealKind, distance?: number): RevealFrames {
  switch (kind) {
    case 'fade':
      return { hidden: { opacity: 0 }, shown: { opacity: 1 } };
    case 'left': {
      const d = distance ?? REVEAL_DISTANCE.side;
      return {
        hidden: { opacity: 0, transform: translate(-d, 0) },
        shown: { opacity: 1, transform: translate(0, 0), transitionEnd: { transform: 'none' } },
      };
    }
    case 'right': {
      const d = distance ?? REVEAL_DISTANCE.side;
      return {
        hidden: { opacity: 0, transform: translate(d, 0) },
        shown: { opacity: 1, transform: translate(0, 0), transitionEnd: { transform: 'none' } },
      };
    }
    case 'scale': {
      const d = distance ?? REVEAL_DISTANCE.scale;
      // 0.96, never 0: nothing in the real world appears from nothing.
      return {
        hidden: { opacity: 0, transform: `${translate(0, d)} scale(0.96)` },
        shown: { opacity: 1, transform: `${translate(0, 0)} scale(1)`, transitionEnd: { transform: 'none' } },
      };
    }
    case 'clip':
      // An aperture that opens from the middle; the rounded corners square off as it lands.
      return {
        hidden: { opacity: 0, clipPath: 'inset(10% 8% 10% 8% round 24px)' },
        shown: { opacity: 1, clipPath: 'inset(0% 0% 0% 0% round 0px)', transitionEnd: { clipPath: 'none' } },
      };
    case 'up':
    default: {
      const d = distance ?? REVEAL_DISTANCE.up;
      return {
        hidden: { opacity: 0, transform: translate(0, d) },
        shown: { opacity: 1, transform: translate(0, 0), transitionEnd: { transform: 'none' } },
      };
    }
  }
}

type ValueTransition = { duration: number; ease?: readonly [number, number, number, number] };

export type RevealTransition = ValueTransition & {
  delay?: number;
  opacity?: ValueTransition;
  transform?: ValueTransition;
  clipPath?: ValueTransition;
};

export type TransitionMode = {
  /** prefers-reduced-motion: keep the fade, drop the movement. */
  reduced?: boolean;
  /** Provider hydrated after the CSS fail-safe fired: land instantly, nothing re-hides. */
  instant?: boolean;
  /** Seconds. Leave undefined inside a Stagger, or it overrides the stagger offset. */
  delay?: number;
};

/**
 * Transition for a reveal kind.
 * - normal: ease-out rise/slide/scale; clip morphs with ease-in-out (it's an
 *   on-screen shape change), opacity lands a little sooner than the movement.
 * - reduced: opacity fades, transform/clip jump (fewer and gentler, not zero).
 * - instant: everything lands immediately.
 */
export function revealTransition(kind: RevealKind, mode: TransitionMode = {}): RevealTransition {
  const delay = mode.delay ? { delay: mode.delay } : {};
  if (mode.instant) return { duration: 0, ...delay };
  if (mode.reduced) {
    return {
      duration: DURATION.fade,
      ease: EASE.out,
      transform: { duration: 0 },
      clipPath: { duration: 0 },
      ...delay,
    };
  }
  if (kind === 'clip') {
    return {
      duration: DURATION.revealLong,
      ease: EASE.inOut,
      opacity: { duration: DURATION.revealLong * 0.5, ease: EASE.out },
      ...delay,
    };
  }
  return {
    duration: DURATION.reveal,
    ease: EASE.out,
    opacity: { duration: DURATION.reveal * 0.75, ease: EASE.out },
    ...delay,
  };
}

/** Frames for one word of a SplitWords headline: rises out of its line mask. */
export function wordFrames(): RevealFrames {
  return {
    hidden: { opacity: 0, transform: 'translate3d(0px, 105%, 0px)' },
    shown: { opacity: 1, transform: 'translate3d(0px, 0%, 0px)', transitionEnd: { transform: 'none' } },
  };
}

export function wordTransition(mode: TransitionMode = {}): RevealTransition {
  if (mode.instant) return { duration: 0 };
  if (mode.reduced) return { duration: DURATION.fade, ease: EASE.out, transform: { duration: 0 } };
  return { duration: DURATION.revealLong, ease: EASE.out, opacity: { duration: DURATION.reveal * 0.5, ease: EASE.out } };
}

/**
 * How long a split headline's cascade runs before its LAST word starts
 * (seconds). A group uses it to keep the next item behind the headline.
 */
export function wordsSpan(count: number, each: number = STAGGER.words): number {
  return count > 1 ? staggerDelay(count - 1, each, 1) : 0;
}

/**
 * Start offsets for the items of a group, in order. `spans[i]` is the extra
 * time item i holds the stage before the next one may start: 0 for a plain
 * item, wordsSpan() for a split headline — so the item after a headline
 * starts with its last word rather than its second. Nothing waits longer than
 * `maxTotal`.
 */
export function groupOffsets(spans: readonly number[], each: number = STAGGER.each, maxTotal: number = STAGGER.maxTotal): number[] {
  const step = clampStagger(each);
  const cap = Math.max(0, maxTotal);
  let at = 0;
  return spans.map((span) => {
    const start = Math.min(at, cap);
    at += step + (Number.isFinite(span) && span > 0 ? span : 0);
    return start;
  });
}

/** Clamp a stagger step into Emil's 30–80ms window. */
export function clampStagger(each: number): number {
  if (!Number.isFinite(each)) return STAGGER.each;
  return Math.min(STAGGER.max, Math.max(STAGGER.min, each));
}

/**
 * Delay for the i-th child of a group: `each` apart, but no child ever waits
 * longer than `maxTotal`, so a long list doesn't trickle in for seconds.
 */
export function staggerDelay(index: number, each: number = STAGGER.each, maxTotal: number = STAGGER.maxTotal): number {
  const step = clampStagger(each);
  return Math.min(Math.max(0, index) * step, Math.max(0, maxTotal));
}
