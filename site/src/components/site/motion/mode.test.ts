import { describe, expect, it } from 'vitest';
import { liveMotionMode, type MotionEnv } from './mode';
import { FAILSAFE_MS, QUERY } from './presets';
import { revealTransition, wordTransition } from './variants';

function env(over: { reduced?: boolean; mark?: string | null; now?: number } = {}): MotionEnv {
  return {
    matchMedia: (q: string) => ({ matches: q === QUERY.reducedMotion && over.reduced === true }),
    document: { documentElement: { getAttribute: () => over.mark ?? null } },
    performance: { now: () => over.now ?? 200 },
  };
}

describe('liveMotionMode', () => {
  it('reads prefers-reduced-motion live, even while the hydration-safe hook still says false', () => {
    // First client render of a load-triggered hero: hook = false, media query = reduce.
    expect(liveMotionMode({ reduced: false }, env({ reduced: true })).reduced).toBe(true);
    expect(liveMotionMode({ reduced: false }, env({ reduced: false })).reduced).toBe(false);
  });

  it('a first-load entrance under reduced motion fades and does not travel', () => {
    const mode = liveMotionMode({ reduced: false, instant: false }, env({ reduced: true }));
    for (const kind of ['up', 'left', 'right', 'scale', 'clip'] as const) {
      const t = revealTransition(kind, mode);
      expect(t.duration).toBeGreaterThan(0); // the fade stays
      expect(t.transform).toEqual({ duration: 0 }); // the movement is gone
      expect(t.clipPath).toEqual({ duration: 0 });
    }
    expect(wordTransition(mode).transform).toEqual({ duration: 0 });
    expect(wordTransition(mode).duration).toBeGreaterThan(0);
  });

  it('never switches a mode off that the hooks already report', () => {
    expect(liveMotionMode({ reduced: true, instant: true }, env())).toEqual({ reduced: true, instant: true });
  });

  it('instant: late mark, or no mark yet after the fail-safe window', () => {
    expect(liveMotionMode({}, env({ mark: 'late' })).instant).toBe(true);
    expect(liveMotionMode({}, env({ mark: 'ready', now: FAILSAFE_MS + 5000 })).instant).toBe(false);
    expect(liveMotionMode({}, env({ mark: null, now: FAILSAFE_MS + 1 })).instant).toBe(true);
    expect(liveMotionMode({}, env({ mark: null, now: 300 })).instant).toBe(false);
  });

  it('falls back to the hint without a browser', () => {
    // null, not undefined: undefined would take the default (jsdom's window), whose clock is
    // past the fail-safe window whenever the whole suite takes more than 3s to reach this file.
    expect(liveMotionMode({ reduced: true }, null)).toEqual({ reduced: true, instant: false });
    expect(liveMotionMode({}, {})).toEqual({ reduced: false, instant: false });
  });
});
