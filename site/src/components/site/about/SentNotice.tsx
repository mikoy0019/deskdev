'use client';

import type { ReactNode } from 'react';
import { LoopingPop, usePrefersReducedMotion } from '@/components/site/motion';

/**
 * The scorecard's delivery notice. It pops in on a loop; under reduced motion
 * it simply stays up, because a badge that keeps fading in and out is still
 * an endless blink for someone who asked for less motion.
 */
export function SentNotice({ children, className = '' }: { children: ReactNode; className?: string }) {
  const reduced = usePrefersReducedMotion();
  if (reduced) {
    return (
      <span aria-hidden className={className}>
        <span className="inline-flex">{children}</span>
      </span>
    );
  }
  return (
    <LoopingPop origin="top left" every={8000} className={className}>
      {children}
    </LoopingPop>
  );
}
