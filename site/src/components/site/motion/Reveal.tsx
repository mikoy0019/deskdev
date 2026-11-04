'use client';

import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { m } from 'framer-motion';
import { useInStagger, useMotionKit, usePrefersReducedMotion } from './hooks';
import { DURATION, EASE, IN_VIEW } from './presets';
import { liveMotionMode } from './mode';
import { revealFrames, revealTransition, type RevealKind } from './variants';
import { MOTION_TAGS, type ElementProps, type MotionTag } from './tags';

export type RevealProps = ElementProps & {
  /** Entrance shape. `up` (default) rises, `left`/`right` slide in from that side, `scale` rises from 0.96, `clip` opens an aperture (use for images/media blocks), `fade` is opacity only — use sparingly. */
  variant?: RevealKind;
  /** `inView` (default): when it scrolls into view, once. `load`: right after hydration (hero copy). */
  trigger?: 'inView' | 'load';
  /** Seconds before it starts. Ignored inside a <Stagger> (the group spaces items). */
  delay?: number;
  /** Override the travel in px (up/left/right/scale). */
  distance?: number;
  /** IntersectionObserver rootMargin for `inView`. Default fires ~12% above the fold. */
  margin?: string;
  /** How much of the element must be visible before `inView` fires: `some` (default), `all` or 0–1. */
  amount?: 'some' | 'all' | number;
  /** Replay every time it re-enters (default false: an interface shouldn't fight its reader). */
  repeat?: boolean;
  as?: MotionTag;
  children?: ReactNode;
};

/**
 * Scroll / load entrance for a block. Replaces `data-reveal`, `data-intro`.
 *
 * Server HTML carries the hidden frame (inline style), so the entrance never
 * flashes; `data-nx-reveal` lets the nx.css fail-safe show it without JS.
 * Inside a <Stagger> it becomes a group item and inherits the group's trigger.
 */
export function Reveal({
  variant = 'up',
  trigger = 'inView',
  delay,
  distance,
  margin = IN_VIEW.margin,
  amount,
  repeat = false,
  as = 'div',
  children,
  ...rest
}: RevealProps) {
  const inStagger = useInStagger();
  const reduced = usePrefersReducedMotion();
  const { instant } = useMotionKit();
  const Tag = MOTION_TAGS[as];

  const variants = useMemo(() => {
    const frames = revealFrames(variant, distance);
    // A function: framer resolves it when the entrance starts, so the motion
    // mode is the real one even on the first (hydration) render — see mode.ts.
    const shown = () => ({
      ...frames.shown,
      transition: revealTransition(variant, { ...liveMotionMode({ reduced, instant }), delay: inStagger ? undefined : delay }),
    });
    return { hidden: frames.hidden, shown };
  }, [variant, distance, reduced, instant, delay, inStagger]);

  if (inStagger) {
    return (
      <Tag {...rest} data-nx-reveal="" data-nx-item="" variants={variants}>
        {children}
      </Tag>
    );
  }

  return (
    <Tag
      {...rest}
      data-nx-reveal=""
      variants={variants}
      initial="hidden"
      {...(trigger === 'load'
        ? { animate: 'shown' }
        : { whileInView: 'shown', viewport: { once: !repeat, margin, amount } })}
    >
      {children}
    </Tag>
  );
}

/**
 * Media inside a `variant="clip"` Reveal: settles from a slight zoom while the
 * aperture opens (the image moves less than its frame, which reads as depth).
 * Must be a descendant of the Reveal; it follows the Reveal's state.
 */
export function RevealMedia({ children, className, style }: { children?: ReactNode; className?: string; style?: CSSProperties }) {
  const reduced = usePrefersReducedMotion();
  const { instant } = useMotionKit();
  const variants = useMemo(
    () => ({
      hidden: { transform: 'scale(1.12)' },
      shown: () => {
        const mode = liveMotionMode({ reduced, instant });
        return {
          transform: 'scale(1)',
          transitionEnd: { transform: 'none' },
          transition: mode.instant || mode.reduced ? { duration: 0 } : { duration: DURATION.media, ease: EASE.out },
        };
      },
    }),
    [instant, reduced],
  );
  return (
    <m.div className={className} style={style} variants={variants} data-nx-reveal="">
      {children}
    </m.div>
  );
}
