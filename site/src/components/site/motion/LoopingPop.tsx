'use client';

import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { useLoopGate, useLoopHeld, usePrefersReducedMotion } from './hooks';
import { DURATION, EASE, SPRING } from './presets';

export type LoopingPopProps = {
  children: ReactNode;
  /** ms the element stays up. Default 3000. */
  visibleFor?: number;
  /** ms between appearances (start to start). Default 7000. */
  every?: number;
  /** transform-origin: the corner it is anchored to (it grows out of its anchor). Default "top right". */
  origin?: string;
  className?: string;
};

/**
 * Taste's "live status" badge: a small notification that pops in with a
 * slight overshoot (SPRING.playful — marketing mockups only), stays a few
 * seconds and leaves faster than it came (exit 150ms, ease-out, a touch
 * smaller — the same way out as in). Only cycles while on screen with the tab
 * visible, and holds still while its anchor is hovered or focused. Reduced motion: it still comes and goes, as a plain fade with no
 * scale (fewer and gentler, not zero). Decorative (aria-hidden, inert).
 */
export const LoopingPop = memo(function LoopingPop({ children, visibleFor = 3000, every = 7000, origin = 'top right', className = '' }: LoopingPopProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const running = useLoopGate(ref, { allowReduced: true, pauseOnHold: false });
  // Hovering or focusing the anchor freezes the cycle where it is (badge up
  // or down) instead of hiding the badge under the pointer.
  const held = useLoopHeld(ref);
  const reduced = usePrefersReducedMotion();
  const [up, setUp] = useState(false);

  useEffect(() => {
    if (!running) {
      setUp(false);
      return;
    }
    if (held) return;
    let hide = 0;
    const show = () => {
      setUp(true);
      hide = window.setTimeout(() => setUp(false), visibleFor);
    };
    const first = window.setTimeout(show, 900);
    const loop = window.setInterval(show, Math.max(every, visibleFor + 600));
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(hide);
      window.clearInterval(loop);
    };
  }, [running, held, visibleFor, every]);

  const motionProps = useMemo(
    () =>
      reduced
        ? {
            initial: { opacity: 0 },
            animate: { opacity: 1, transition: { duration: DURATION.fade, ease: EASE.out } },
            exit: { opacity: 0, transition: { duration: DURATION.exit, ease: EASE.out } },
          }
        : {
            initial: { opacity: 0, transform: 'scale(0.9)' },
            animate: { opacity: 1, transform: 'scale(1)', transition: { ...SPRING.playful, opacity: { duration: DURATION.tooltip, ease: EASE.out } } },
            exit: { opacity: 0, transform: 'scale(0.96)', transition: { duration: DURATION.exit, ease: EASE.out } },
          },
    [reduced],
  );

  return (
    <span ref={ref} aria-hidden inert className={className}>
      <AnimatePresence>
        {up ? (
          <m.span key="pop" className="inline-flex" style={{ transformOrigin: origin }} {...motionProps}>
            {children}
          </m.span>
        ) : null}
      </AnimatePresence>
    </span>
  );
});
