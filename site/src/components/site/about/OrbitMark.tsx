'use client';

import { memo, useRef } from 'react';
import { useOffscreenPause } from '@/components/site/motion';

/**
 * The studio's orbital mark: hairline rings around a solid core, with two
 * satellites circling at different speeds (one team, work moving around it).
 * Constant motion, so linear; CSS keyframes on a compositor-only rotate.
 * Longhands rather than the `animation` shorthand, so the kit's
 * `[data-nx-offscreen] .nx-kit-loop { animation-play-state: paused }` still
 * applies (useOffscreenPause stops both orbits off-screen); reduced motion
 * drops the animation and leaves the satellites where they rest.
 */
const ORBIT_KEYFRAMES = '@keyframes nx-about-orbit{to{transform:rotate(1turn)}}';

export const OrbitMark = memo(function OrbitMark() {
  const ref = useRef<HTMLDivElement>(null);
  useOffscreenPause(ref);

  return (
    <div ref={ref} className="relative mx-auto aspect-square w-full max-w-[17rem] sm:max-w-[19rem]" aria-hidden>
      {/* Own keyframes (React 19 hoists and dedupes this), so the orbit doesn't
          depend on Tailwind emitting its theme `spin` for some other page. */}
      <style href="nx-about-orbit" precedence="default">{ORBIT_KEYFRAMES}</style>
      <svg viewBox="0 0 200 200" fill="none" className="absolute inset-0 h-full w-full text-fg-3">
        <circle cx="100" cy="100" r="99" stroke="currentColor" strokeOpacity="0.35" strokeWidth="0.6" />
        <circle cx="100" cy="100" r="76" stroke="currentColor" strokeOpacity="0.45" strokeWidth="0.6" strokeDasharray="1.5 3.5" />
        <circle cx="100" cy="100" r="53" stroke="currentColor" strokeOpacity="0.35" strokeWidth="0.6" />
        <path d="M100 0v200M0 100h200" stroke="currentColor" strokeOpacity="0.18" strokeWidth="0.6" />
      </svg>
      {/* Satellites on the outer and middle rings */}
      <div className="nx-kit-loop absolute inset-0 [animation-duration:48s] [animation-iteration-count:infinite] [animation-name:nx-about-orbit] [animation-timing-function:linear] motion-reduce:[animation-name:none]">
        <span className="absolute left-1/2 top-0 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-4 ring-accent-soft" />
      </div>
      <div className="nx-kit-loop absolute inset-[12%] [animation-direction:reverse] [animation-duration:32s] [animation-iteration-count:infinite] [animation-name:nx-about-orbit] [animation-timing-function:linear] motion-reduce:[animation-name:none]">
        <span className="absolute bottom-[14.6%] right-[14.6%] size-1.5 translate-x-1/2 translate-y-1/2 rounded-full bg-accent-2" />
      </div>
      {/* Core: a flat accent disc with a top-edge highlight, like every other surface here (no shaded sphere) */}
      <div className="absolute inset-[34%] rounded-full bg-accent shadow-[inset_0_1px_0_rgb(255_255_255/0.18)]" />
    </div>
  );
});
