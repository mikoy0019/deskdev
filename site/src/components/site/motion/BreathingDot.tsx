'use client';

import { memo, useRef } from 'react';
import { useOffscreenPause } from './hooks';

export type BreathingDotProps = {
  /** `live` (green: online, running) or `accent` (brand blue). */
  tone?: 'live' | 'accent';
  /** Screen-reader text for the state it shows, e.g. the status label. Omit when a visible label sits next to it. */
  label?: string;
  className?: string;
};

/**
 * A status dot with a soft ring that expands and fades — the "this is live"
 * signal. CSS animation (transform + opacity on a pseudo-element, off the
 * main thread), paused while off-screen; reduced motion shows the dot still.
 */
export const BreathingDot = memo(function BreathingDot({ tone = 'live', label, className = '' }: BreathingDotProps) {
  const ref = useRef<HTMLSpanElement>(null);
  useOffscreenPause(ref);
  return (
    <span ref={ref} className={`nx-kit-dot nx-kit-loop ${className}`.trim()} data-tone={tone} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />
  );
});
