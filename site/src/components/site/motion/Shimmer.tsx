'use client';

import { memo, useRef } from 'react';
import { useOffscreenPause } from './hooks';

/**
 * A light band sweeping across a placeholder: skeleton loading, or the
 * "processing" moment in a mockup. The sweep is a transform on a
 * pseudo-element (linear: it is constant motion), paused off-screen and
 * removed for reduced motion. Size and round it with className
 * (e.g. "h-3 w-40 rounded-full"). Decorative: hidden from screen readers.
 */
export const Shimmer = memo(function Shimmer({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useOffscreenPause(ref);
  return <span ref={ref} aria-hidden className={`nx-kit-shimmer nx-kit-loop ${className}`.trim()} />;
});
