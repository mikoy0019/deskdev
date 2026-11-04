'use client';

import { useRef, type PointerEvent, type ReactNode } from 'react';
import { m, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { magneticOffset, type MagneticOptions } from './geometry';
import { DECORATIVE_SPRING_OPTIONS, QUERY } from './presets';

export type MagneticProps = MagneticOptions & {
  children: ReactNode;
  className?: string;
};

/**
 * Pulls its child a few pixels toward a mouse pointer and springs back on
 * leave. Replaces `data-magnetic`. Marketing CTAs only.
 *
 * - Mouse only (pointerType "mouse" and a hover-capable fine pointer): touch,
 *   pen and keyboard never move it. Reduced motion never moves it.
 * - Motion values + taste's decorative spring, outside React's render cycle
 *   (no state, no re-render per pointer move).
 * - At rest (under 0.05px of pull) the transform is `none`, so the wrapper adds
 *   no stacking context.
 *
 * Renders an inline-flex <span> around the child; the child keeps its own
 * :active press scale (the two transforms compose).
 */
export function Magnetic({ children, className = '', strength, maxX, maxY }: MagneticProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, DECORATIVE_SPRING_OPTIONS);
  const sy = useSpring(y, DECORATIVE_SPRING_OPTIONS);
  const transform = useTransform<number, string>([sx, sy], ([tx, ty]) =>
    !Number.isFinite(tx) || !Number.isFinite(ty) || (Math.abs(tx) < 0.05 && Math.abs(ty) < 0.05) ? 'none' : `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0px)`,
  );

  const allowed = (e: PointerEvent) =>
    e.pointerType === 'mouse' && window.matchMedia(QUERY.finePointer).matches && !window.matchMedia(QUERY.reducedMotion).matches;

  const onPointerMove = (e: PointerEvent<HTMLSpanElement>) => {
    const el = ref.current;
    if (!el || !allowed(e)) return;
    // Measure the resting box: the current pull is part of the transform.
    const r = el.getBoundingClientRect();
    const rest = { left: r.left - sx.get(), top: r.top - sy.get(), width: r.width, height: r.height };
    const { x: ox, y: oy } = magneticOffset(e.clientX, e.clientY, rest, { strength, maxX, maxY });
    x.set(ox);
    y.set(oy);
  };

  const onPointerLeave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <m.span
      ref={ref}
      className={`inline-flex ${className}`.trim()}
      style={{ transform }}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      {children}
    </m.span>
  );
}
