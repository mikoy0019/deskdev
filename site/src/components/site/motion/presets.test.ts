import { describe, expect, it } from 'vitest';
import { DURATION, EASE, EASE_CSS, QUERY, SPRING, STAGGER, toCubicBezier } from './presets';

describe('presets', () => {
  it("uses Emil Kowalski's curves verbatim", () => {
    expect(EASE.out).toEqual([0.23, 1, 0.32, 1]);
    expect(EASE.inOut).toEqual([0.77, 0, 0.175, 1]);
    expect(EASE.drawer).toEqual([0.32, 0.72, 0, 1]);
    expect(EASE_CSS.out).toBe('cubic-bezier(0.23, 1, 0.32, 1)');
    expect(toCubicBezier(EASE.drawer)).toBe('cubic-bezier(0.32, 0.72, 0, 1)');
  });

  it('has no ease-in curve', () => {
    expect(Object.keys(EASE)).not.toContain('in');
    // Every curve leaves its start fast: the second control point is already high.
    for (const [, y1] of Object.values(EASE)) expect(y1).toBeGreaterThanOrEqual(0);
    expect(EASE.out[1]).toBe(1);
  });

  it('keeps UI durations inside the budget', () => {
    expect(DURATION.press).toBeGreaterThanOrEqual(0.1);
    expect(DURATION.press).toBeLessThanOrEqual(0.16);
    expect(DURATION.tooltip).toBeGreaterThanOrEqual(0.125);
    expect(DURATION.tooltip).toBeLessThanOrEqual(0.2);
    expect(DURATION.dropdown).toBeGreaterThanOrEqual(0.15);
    expect(DURATION.dropdown).toBeLessThanOrEqual(0.25);
    expect(DURATION.modal).toBeLessThan(0.3);
    expect(DURATION.exit).toBeLessThan(DURATION.tooltip);
  });

  it("springs: Emil's UI default, bounce never above 0.3, taste's decorative physics", () => {
    expect(SPRING.ui).toEqual({ type: 'spring', duration: 0.5, bounce: 0.2 });
    expect(SPRING.settle.bounce).toBe(0);
    expect(SPRING.playful.bounce).toBeLessThanOrEqual(0.3);
    expect(SPRING.decorative).toEqual({ type: 'spring', stiffness: 100, damping: 20 });
  });

  it('stagger window is 30-80ms', () => {
    expect(STAGGER.min).toBe(0.03);
    expect(STAGGER.max).toBe(0.08);
    expect(STAGGER.each).toBeGreaterThanOrEqual(STAGGER.min);
    expect(STAGGER.each).toBeLessThanOrEqual(STAGGER.max);
    expect(STAGGER.words).toBeGreaterThanOrEqual(STAGGER.min);
  });

  it('pin query matches the nx.css `pin:` variant', () => {
    expect(QUERY.pin).toBe('(prefers-reduced-motion: no-preference) and (min-width: 1024px) and (min-height: 560px)');
  });
});
