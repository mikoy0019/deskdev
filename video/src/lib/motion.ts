import { Easing, interpolate, spring } from 'remotion';
import { FPS } from '../timeline';

export const EASE = {
  out: Easing.bezier(0.16, 1, 0.3, 1),
  inOut: Easing.bezier(0.65, 0, 0.35, 1),
  in: Easing.bezier(0.7, 0, 0.84, 0),
};

export const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** 0 → 1 over `dur` frames from `start`, eased. Clamped on both sides. */
export function progress(frame: number, start: number, dur = 18, easing = EASE.out): number {
  return interpolate(frame, [start, start + dur], [0, 1], { ...CLAMP, easing });
}

/** A spring 0 → 1 from `start`. Critically damped (no overshoot) unless you lower `damping`. */
export function springAt(
  frame: number,
  start: number,
  config: { damping?: number; stiffness?: number; mass?: number } = {},
): number {
  return spring({ frame: frame - start, fps: FPS, config: { damping: 200, stiffness: 120, mass: 1, ...config } });
}

export function mix(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Seconds to frames. */
export const sec = (s: number) => Math.round(s * FPS);
