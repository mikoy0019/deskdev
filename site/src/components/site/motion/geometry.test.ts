import { describe, expect, it } from 'vitest';
import { magneticOffset, panelScrollTop, parallaxPercent, trackDistance, trackOffset } from './geometry';

const box = { left: 100, top: 100, width: 200, height: 50 };

describe('magneticOffset', () => {
  it('is zero at the centre', () => {
    expect(magneticOffset(200, 125, box)).toEqual({ x: 0, y: 0 });
  });
  it('follows a fraction of the offset', () => {
    expect(magneticOffset(210, 130, box)).toEqual({ x: 3, y: 1.5 });
  });
  it('is clamped so the element never wanders', () => {
    expect(magneticOffset(300, 150, box)).toEqual({ x: 10, y: 7.5 });
    expect(magneticOffset(0, 0, box)).toEqual({ x: -10, y: -8 });
    expect(magneticOffset(0, 0, box, { maxX: 4, maxY: 2 })).toEqual({ x: -4, y: -2 });
  });
  it('keeps the defaults for options passed through as undefined (component props)', () => {
    expect(magneticOffset(210, 130, box, { strength: undefined, maxX: undefined, maxY: undefined })).toEqual({ x: 3, y: 1.5 });
    expect(magneticOffset(210, 130, box, { strength: Number.NaN })).toEqual({ x: 3, y: 1.5 });
  });
});

describe('parallaxPercent', () => {
  it('drifts from +amount/2 to -amount/2 of its height', () => {
    expect(parallaxPercent(0, 0.15)).toBe(7.5);
    expect(parallaxPercent(0.5, 0.15)).toBe(0);
    expect(parallaxPercent(1, 0.15)).toBe(-7.5);
    expect(parallaxPercent(1, -0.12)).toBe(6);
  });
  it('clamps progress', () => {
    expect(parallaxPercent(-1, 0.1)).toBe(5);
    expect(parallaxPercent(2, 0.1)).toBe(-5);
  });
});

describe('horizontal track', () => {
  it('distance is the overflow, never negative', () => {
    expect(trackDistance(3200, 1440)).toBe(1760);
    expect(trackDistance(900, 1440)).toBe(0);
  });
  it('offset maps progress 1:1', () => {
    expect(trackOffset(0, 1760)).toBe(0);
    expect(trackOffset(0.5, 1760)).toBe(-880);
    expect(trackOffset(1.4, 1760)).toBe(-1760);
  });
  it('focus target: scrollY that brings a panel to the start edge', () => {
    expect(panelScrollTop(56, 56, 1760, 2000)).toBe(2000);
    expect(panelScrollTop(56 + 880, 56, 1760, 2000)).toBe(2880);
    expect(panelScrollTop(9999, 56, 1760, 2000)).toBe(3760);
    expect(panelScrollTop(400, 56, 0, 2000)).toBe(2000);
  });
});
