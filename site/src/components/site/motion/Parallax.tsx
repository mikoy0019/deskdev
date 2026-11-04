'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useMotionValue, useScroll, useTransform } from 'framer-motion';
import { parallaxPercent } from './geometry';
import { QUERY } from './presets';
import { MOTION_TAGS, type ElementProps, type MotionTag } from './tags';

export type ParallaxProps = ElementProps & {
  /**
   * Drift as a fraction of the element's own height across one pass of the
   * viewport. 0.15 → from +7.5% to −7.5%. Negative drifts the other way.
   * Keep it small (≤ 0.15): it is decoration, never content people read.
   */
  amount?: number;
  as?: MotionTag;
  children?: ReactNode;
};

/**
 * Scroll-linked vertical drift. Replaces `data-parallax`.
 * useScroll (framer's shared, passive scroll tracking — no listener of our
 * own) → a full translate3d string, so the browser composites it. Reduced
 * motion holds it still. Give the parent `overflow: clip` (or make the
 * element taller than its frame) so the drift never reveals an edge.
 */
export function Parallax({ amount = 0.15, as = 'div', children, style, ...rest }: ParallaxProps) {
  const ref = useRef<HTMLElement>(null);
  // 1 = moving, 0 = still (reduced motion). Starts at 1 on server and client
  // alike, so hydration matches; flips after mount when needed.
  const enabled = useMotionValue(1);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const transform = useTransform<number, string>([scrollYProgress, enabled], ([p, on]) =>
    on ? `translate3d(0px, ${parallaxPercent(p, amount)}%, 0px)` : 'none',
  );

  useEffect(() => {
    const mq = window.matchMedia(QUERY.reducedMotion);
    const sync = () => enabled.set(mq.matches ? 0 : 1);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [enabled]);

  const Tag = MOTION_TAGS[as];
  return (
    <Tag {...rest} ref={ref as never} style={{ ...style, transform }}>
      {children}
    </Tag>
  );
}
