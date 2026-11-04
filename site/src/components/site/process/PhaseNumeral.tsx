'use client';

import { useMemo } from 'react';
import { m } from 'framer-motion';
import { DURATION, EASE, IN_VIEW, usePrefersReducedMotion } from '@/components/site/motion';
import { useMotionKit } from '@/components/site/motion/hooks';

/**
 * The hollow phase numeral ("02") on /process. When its panel arrives, a
 * tinted fill rises inside the hairline outline, like ink settling, to mark
 * the phase you are reading.
 *
 * Gate: rare (a marketing page). Purpose: state indication, the phase in front
 * of you is the one that fills. Tool: Motion whileInView (once) on clip-path +
 * opacity (both run on WAAPI); the outline itself never moves. Curve: clip is an
 * on-screen shape change, so --ease-in-out over DURATION.revealLong; the fade
 * lands sooner with --ease-out. Reduced motion: the fill fades in, no rise.
 *
 * Decorative: aria-hidden; without JS the outline shows alone (clean, see the
 * seam note below). The fill is painted with background-clip: text (a solid
 * tint, not a gradient), so it is ornament, never text a contrast check should
 * read.
 */
export function PhaseNumeral({ value, className = '' }: { value: string; className?: string }) {
  const reduced = usePrefersReducedMotion();
  const { instant } = useMotionKit();

  const variants = useMemo(
    () => ({
      hidden: { opacity: 0, clipPath: 'inset(100% 0% 0% 0%)' },
      shown: {
        opacity: 1,
        clipPath: 'inset(0% 0% 0% 0%)',
        transitionEnd: { clipPath: 'none' },
        transition: instant
          ? { duration: 0 }
          : reduced
            ? { duration: DURATION.fade, ease: EASE.out, clipPath: { duration: 0 } }
            : { duration: DURATION.revealLong, ease: EASE.inOut, opacity: { duration: DURATION.fade, ease: EASE.out } },
      },
    }),
    [instant, reduced],
  );

  return (
    // The wrapper is what's observed: the fill's own clip-path starts at zero
    // area, and Chromium's IntersectionObserver counts a target's clip-path.
    // pr: the last glyph's ink runs past its advance under the tight tracking;
    // the padding keeps it inside the box the fill's background paints.
    <m.span
      aria-hidden
      className={`nx-numeral relative block select-none pr-[0.08em] ${className}`}
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, amount: 0.4, margin: IN_VIEW.margin }}
    >
      {/*
        Space Grotesk builds "1" from overlapping contours, which a bare text
        stroke draws as seams inside the glyph. Painting the stroke first, then
        an opaque fill in the panel's own surface colour over it, hides the
        inner half and every seam; the stroke is doubled so the hairline left
        outside the glyph is still 1px.
      */}
      <span className="nx-numeral-outline block [-webkit-text-stroke-width:2px] [color:var(--surface)] [paint-order:stroke_fill]">
        {value}
      </span>
      <m.span
        className="absolute inset-0 block bg-[var(--phase-fill)] bg-clip-text text-transparent [--phase-fill:color-mix(in_oklab,var(--accent)_34%,transparent)] light:[--phase-fill:color-mix(in_oklab,var(--accent)_15%,transparent)]"
        variants={variants}
      >
        {value}
      </m.span>
    </m.span>
  );
}
