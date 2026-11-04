'use client';

import { Fragment, memo, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useMotionValueEvent, useScroll, useSpring, useTransform, useVelocity } from 'framer-motion';
import { PauseIcon, PlayIcon } from '@phosphor-icons/react';
import { useOffscreenPause, usePrefersReducedMotion } from './hooks';
import { DECORATIVE_SPRING_OPTIONS } from './presets';

export type MarqueeProps = {
  items: ReactNode[];
  /** Decorative separator between items (hidden from screen readers and in the reduced-motion wrap). */
  separator?: ReactNode;
  /** Seconds for one full loop. Default 40. */
  duration?: number;
  /** CSS length between items. Default 3rem. */
  gap?: string;
  reverse?: boolean;
  /** Accessible name for the list. */
  label?: string;
  /** Speed up briefly with scroll velocity, then ease back (taste's kinetic marquee). Default true. */
  velocityBoost?: boolean;
  /**
   * Pause control (WCAG 2.2.2). `focus` (default): a button that appears
   * when tabbed to. `visible`: always shown. `none`: only for loops that
   * stop by themselves.
   */
  pauseControl?: 'focus' | 'visible' | 'none';
  className?: string;
  itemClassName?: string;
};

/** Smallest playback-rate change worth sending to the compositor. */
const RATE_STEP = 0.05;

/**
 * Endless horizontal band. The loop itself is a CSS animation on a
 * transform (runs off the main thread, constant linear speed); this component
 * only adds what CSS can't:
 * - pauses while off-screen, while hovered (mouse only), while anything inside
 *   has focus, and from its pause button;
 * - optional scroll-velocity boost through motion values (no scroll listeners
 *   of its own; framer's useScroll is shared);
 * - reduced motion: no loop at all — a static, wrapped list (nx.css).
 * The second copy is aria-hidden, so screen readers hear the list once.
 */
function MarqueeImpl({
  items,
  separator,
  duration = 40,
  gap = '3rem',
  reverse = false,
  label,
  velocityBoost = true,
  pauseControl = 'focus',
  className = '',
  itemClassName = '',
}: MarqueeProps) {
  const root = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const reduced = usePrefersReducedMotion();
  useOffscreenPause(root);

  // Scroll velocity → playbackRate, smoothed by the decorative spring.
  const { scrollY } = useScroll();
  const velocity = useVelocity(scrollY);
  const boost = useTransform(velocity, (v) => 1 + Math.min(Math.abs(v) / 700, 3));
  const rate = useSpring(boost, DECORATIVE_SPRING_OPTIONS);
  // The spring emits every frame; the animation is only touched when the rate
  // has moved by a visible step (or has come back to rest), and through
  // updatePlaybackRate, which changes speed without a jump in position.
  const applied = useRef(1);
  useMotionValueEvent(rate, 'change', (r) => {
    if (!velocityBoost || reduced) return;
    const next = Math.abs(r - 1) < RATE_STEP ? 1 : r;
    if (next === applied.current || (next !== 1 && Math.abs(next - applied.current) < RATE_STEP)) return;
    applied.current = next;
    track.current?.getAnimations().forEach((a) => a.updatePlaybackRate(next));
  });
  useEffect(() => {
    if (velocityBoost && !reduced) return;
    applied.current = 1;
    track.current?.getAnimations().forEach((a) => a.updatePlaybackRate(1));
  }, [velocityBoost, reduced]);

  const group = (hidden: boolean) => (
    // The copy is `inert` as well as aria-hidden: a link inside it can't take focus.
    <ul
      className="nx-kit-marquee-group"
      aria-hidden={hidden || undefined}
      inert={hidden || undefined}
      role={hidden ? undefined : 'list'}
      aria-label={hidden ? undefined : label}
    >
      {items.map((item, i) => (
        <Fragment key={i}>
          <li className={itemClassName}>{item}</li>
          {separator ? (
            <li aria-hidden className="nx-kit-marquee-sep">
              {separator}
            </li>
          ) : null}
        </Fragment>
      ))}
    </ul>
  );

  const style = { '--nx-kit-marquee-duration': `${duration}s`, '--nx-kit-marquee-gap': gap } as CSSProperties;

  return (
    <div
      ref={root}
      className={`nx-kit-marquee ${className}`.trim()}
      data-reverse={reverse ? '' : undefined}
      data-paused={paused ? '' : undefined}
      style={style}
    >
      <div className="nx-kit-marquee-viewport">
        <div ref={track} className="nx-kit-marquee-track nx-kit-loop">
          {group(false)}
          {group(true)}
        </div>
      </div>
      {pauseControl !== 'none' && !reduced ? (
        <button
          type="button"
          className="nx-kit-marquee-toggle nx-press nx-js-only"
          data-mode={pauseControl}
          aria-pressed={paused}
          aria-label="Pause motion"
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? <PlayIcon aria-hidden size={16} weight="regular" /> : <PauseIcon aria-hidden size={16} weight="regular" />}
        </button>
      ) : null}
    </div>
  );
}

export const Marquee = memo(MarqueeImpl);

/**
 * Taste's "wide data stream": a seamless carousel of cards. Same engine as
 * Marquee with calmer defaults (slower, tighter gap, no scroll boost).
 */
export const InfiniteCarousel = memo(function InfiniteCarousel({
  duration = 60,
  gap = '1rem',
  velocityBoost = false,
  ...rest
}: MarqueeProps) {
  return <MarqueeImpl duration={duration} gap={gap} velocityBoost={velocityBoost} {...rest} />;
});
