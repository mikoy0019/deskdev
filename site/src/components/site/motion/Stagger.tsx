'use client';

import { useMemo, useRef, type ReactNode } from 'react';
import { StaggerContext, useInStagger, useMotionKit, usePrefersReducedMotion } from './hooks';
import { liveMotionMode } from './mode';
import { IN_VIEW, STAGGER } from './presets';
import { groupOffsets, revealFrames, revealTransition, staggerDelay, type RevealKind } from './variants';
import { MOTION_TAGS, type ElementProps, type MotionTag } from './tags';

export type StaggerProps = ElementProps & {
  /** Seconds between items, clamped to 30–80ms. Default 60ms. */
  each?: number;
  /** Seconds before the first item. */
  delay?: number;
  /** `inView` (default) or `load` (hero: right after hydration). */
  trigger?: 'inView' | 'load';
  margin?: string;
  /**
   * How much of the group must be visible before `inView` fires: `some`
   * (default), `all`, or a 0–1 fraction. Use a fraction (e.g. 0.3) for a
   * panel-level cascade, so a tall panel doesn't play while only its top
   * edge is on screen.
   */
  amount?: 'some' | 'all' | number;
  as?: MotionTag;
  children?: ReactNode;
};

/**
 * What each item of this group adds to the wait of the ones after it, in DOM
 * order (the order framer indexes children in). Items are marked
 * `data-nx-item`; a split headline also carries its cascade length in
 * `data-nx-span`. Only this group's own items count, not a nested group's.
 */
function itemSpans(root: Element | null): number[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll('[data-nx-item]'))
    .filter((el) => el.parentElement?.closest('[data-nx-item], [data-nx-group]') === root)
    .map((el) => Number(el.getAttribute('data-nx-span')) || 0);
}

/**
 * Orchestrates a group entrance. Replaces `data-reveal-stagger` and, with
 * trigger="load", the `data-intro` hero sequence.
 *
 * Items are any <StaggerItem>, <Reveal>, <SplitWords> or nested <Stagger>
 * below it — at any depth, through plain elements — in render order. A
 * <SplitWords> holds the stage for its whole word cascade: the item after it
 * starts with the headline's last word. No item waits more than 0.6s, and
 * nothing blocks interaction while it plays (items are only transparent,
 * never inert).
 */
export function Stagger({
  each = STAGGER.each,
  delay = 0,
  trigger = 'inView',
  margin = IN_VIEW.margin,
  amount,
  as = 'div',
  children,
  ...rest
}: StaggerProps) {
  const nested = useInStagger();
  const reduced = usePrefersReducedMotion();
  const { instant } = useMotionKit();
  const root = useRef<HTMLDivElement>(null);
  const Tag = MOTION_TAGS[as];

  const variants = useMemo(
    () => ({
      hidden: {},
      // A function: framer resolves it when the entrance starts, so the motion
      // mode is the real one even on the first (hydration) render — see mode.ts.
      shown: () => {
        const mode = liveMotionMode({ reduced, instant });
        // Reduced motion keeps the fade but lands the group together.
        const together = mode.instant || mode.reduced;
        let offsets: number[] | undefined;
        return {
          transition: {
            delayChildren: (i: number, total: number) => {
              if (together) return delay;
              offsets ??= groupOffsets(itemSpans(root.current), each);
              // Children the kit doesn't know (a page's own m.* with variants):
              // the counts differ, so fall back to plain even spacing.
              return delay + (offsets.length === total && i >= 0 && i < total ? offsets[i] : staggerDelay(i, each));
            },
          },
        };
      },
    }),
    [delay, each, instant, reduced],
  );

  const trig = nested
    ? { 'data-nx-item': '' }
    : {
        initial: 'hidden',
        ...(trigger === 'load' ? { animate: 'shown' } : { whileInView: 'shown', viewport: { once: true, margin, amount } }),
      };

  return (
    <StaggerContext.Provider value>
      <Tag {...rest} ref={root} data-nx-group="" variants={variants} {...trig}>
        {children}
      </Tag>
    </StaggerContext.Provider>
  );
}

export type StaggerItemProps = ElementProps & {
  /** Entrance shape (same kinds as Reveal). Default `up`, with a shorter 16px rise. */
  variant?: RevealKind;
  distance?: number;
  as?: MotionTag;
  children?: ReactNode;
};

/** One item of a <Stagger>. Outside a Stagger it simply renders, fully visible. */
export function StaggerItem({ variant = 'up', distance, as = 'div', children, ...rest }: StaggerItemProps) {
  const inStagger = useInStagger();
  const reduced = usePrefersReducedMotion();
  const { instant } = useMotionKit();
  const Tag = MOTION_TAGS[as];

  const variants = useMemo(() => {
    const frames = revealFrames(variant, distance ?? (variant === 'up' ? 16 : undefined));
    return {
      hidden: frames.hidden,
      shown: () => ({ ...frames.shown, transition: revealTransition(variant, liveMotionMode({ reduced, instant })) }),
    };
  }, [variant, distance, reduced, instant]);

  if (!inStagger) return <Tag {...rest}>{children}</Tag>;
  return (
    <Tag {...rest} data-nx-reveal="" data-nx-item="" variants={variants}>
      {children}
    </Tag>
  );
}
