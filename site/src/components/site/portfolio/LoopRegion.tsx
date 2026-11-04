'use client';

import { useRef, type CSSProperties, type ReactNode } from 'react';
import { useOffscreenPause } from '@/components/site/motion';

/**
 * A plain div that pauses the CSS loops inside it while it is off-screen
 * (the kit's useOffscreenPause sets data-nx-offscreen, which
 * portfolio.module.css and nx.css turn into animation-play-state: paused).
 * No React state: the attribute is written straight to the element.
 */
export function LoopRegion({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  useOffscreenPause(ref);
  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}
