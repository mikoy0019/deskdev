import { describe, expect, it } from 'vitest';
import { clampStagger, groupOffsets, revealFrames, revealTransition, staggerDelay, wordFrames, wordTransition, wordsSpan, type RevealKind } from './variants';
import { DURATION, EASE, STAGGER } from './presets';

const KINDS: RevealKind[] = ['up', 'fade', 'left', 'right', 'scale', 'clip'];

describe('revealFrames', () => {
  it('every kind starts transparent and ends opaque', () => {
    for (const kind of KINDS) {
      const f = revealFrames(kind);
      expect(f.hidden.opacity).toBe(0);
      expect(f.shown.opacity).toBe(1);
    }
  });

  it('uses full transform strings, never shorthands, and lands on transform: none', () => {
    for (const kind of ['up', 'left', 'right', 'scale'] as const) {
      const f = revealFrames(kind);
      expect(f.hidden.transform).toMatch(/^translate3d\(/);
      expect(f.shown.transform).toMatch(/^translate3d\(0px, 0px, 0px\)/);
      expect(f.shown.transitionEnd?.transform).toBe('none');
      for (const key of ['x', 'y', 'scale']) expect(f.hidden).not.toHaveProperty(key);
    }
  });

  it('moves in the named direction with the default travel', () => {
    expect(revealFrames('up').hidden.transform).toBe('translate3d(0px, 24px, 0px)');
    expect(revealFrames('left').hidden.transform).toBe('translate3d(-40px, 0px, 0px)');
    expect(revealFrames('right').hidden.transform).toBe('translate3d(40px, 0px, 0px)');
    expect(revealFrames('up', 8).hidden.transform).toBe('translate3d(0px, 8px, 0px)');
  });

  it('never scales from 0', () => {
    const hidden = revealFrames('scale').hidden.transform ?? '';
    const s = Number(hidden.match(/scale\(([\d.]+)\)/)?.[1]);
    expect(s).toBeGreaterThanOrEqual(0.9);
    expect(s).toBeLessThan(1);
  });

  it('clip opens an aperture and ends with clip-path: none', () => {
    const f = revealFrames('clip');
    expect(f.hidden.clipPath).toMatch(/^inset\(/);
    expect(f.shown.clipPath).toBe('inset(0% 0% 0% 0% round 0px)');
    expect(f.shown.transitionEnd?.clipPath).toBe('none');
    expect(f.hidden.transform).toBeUndefined();
  });

  it('fade is opacity only', () => {
    expect(revealFrames('fade')).toEqual({ hidden: { opacity: 0 }, shown: { opacity: 1 } });
  });
});

describe('revealTransition', () => {
  it('ease-out rise by default; clip morphs with ease-in-out', () => {
    expect(revealTransition('up')).toMatchObject({ duration: DURATION.reveal, ease: EASE.out });
    expect(revealTransition('clip')).toMatchObject({ duration: DURATION.revealLong, ease: EASE.inOut });
  });

  it('reduced motion keeps the fade and drops movement', () => {
    const t = revealTransition('up', { reduced: true });
    expect(t.duration).toBe(DURATION.fade);
    expect(t.transform).toEqual({ duration: 0 });
    expect(t.clipPath).toEqual({ duration: 0 });
  });

  it('instant lands immediately', () => {
    expect(revealTransition('clip', { instant: true }).duration).toBe(0);
  });

  it('only sets delay when given (so a Stagger offset is not overridden)', () => {
    expect('delay' in revealTransition('up')).toBe(false);
    expect('delay' in revealTransition('up', { delay: 0 })).toBe(false);
    expect(revealTransition('up', { delay: 0.2 }).delay).toBe(0.2);
  });
});

describe('words', () => {
  it('rise from below their mask and fade under reduced motion', () => {
    expect(wordFrames().hidden.transform).toBe('translate3d(0px, 105%, 0px)');
    expect(wordTransition({ reduced: true }).transform).toEqual({ duration: 0 });
    expect(wordTransition().ease).toEqual(EASE.out);
  });
});

describe('stagger', () => {
  it('clamps into 30-80ms', () => {
    expect(clampStagger(0.01)).toBe(STAGGER.min);
    expect(clampStagger(0.2)).toBe(STAGGER.max);
    expect(clampStagger(0.05)).toBe(0.05);
    expect(clampStagger(Number.NaN)).toBe(STAGGER.each);
  });

  it('spaces items and caps the wait', () => {
    expect(staggerDelay(0)).toBe(0);
    expect(staggerDelay(3, 0.06)).toBeCloseTo(0.18);
    expect(staggerDelay(50, 0.06)).toBe(STAGGER.maxTotal);
    expect(staggerDelay(-2)).toBe(0);
  });

  it('a split headline holds the stage: the next item starts with its last word', () => {
    // eyebrow, 5-word headline, lede, actions
    const span = wordsSpan(5, 0.05);
    expect(span).toBeCloseTo(0.2);
    const at = groupOffsets([0, span, 0, 0], 0.06);
    expect(at[0]).toBe(0);
    expect(at[1]).toBeCloseTo(0.06);
    expect(at[2]).toBeCloseTo(0.06 + 0.06 + 0.2); // not 0.12: it waits for the cascade
    expect(at[3]).toBeCloseTo(at[2] + 0.06);
  });

  it('plain groups keep even spacing, and nothing waits past the cap', () => {
    expect(groupOffsets([0, 0, 0], 0.06)).toEqual([0, 0.06, 0.12]);
    expect(Math.max(...groupOffsets(new Array(40).fill(0), 0.08))).toBe(STAGGER.maxTotal);
    expect(groupOffsets([0, wordsSpan(30), 0], 0.06)[2]).toBe(STAGGER.maxTotal);
    expect(wordsSpan(1)).toBe(0);
    expect(wordsSpan(0)).toBe(0);
    expect(groupOffsets([0, Number.NaN, -1, 0], 0.06)).toEqual([0, 0.06, 0.12, 0.18]);
  });
});
