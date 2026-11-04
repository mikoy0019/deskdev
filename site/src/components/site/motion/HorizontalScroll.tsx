'use client';

import { createContext, useContext, useRef, type FocusEvent, type ReactNode } from 'react';
import { m, useMotionValue, useScroll, useTransform, type MotionValue } from 'framer-motion';
import { panelScrollTop, trackDistance, trackOffset } from './geometry';
import { QUERY } from './presets';
import { useIsoLayoutEffect, useMediaQuery } from './hooks';
import type { ElementProps } from './tags';

type HScrollState = { progress: MotionValue<number> };
const HScrollContext = createContext<HScrollState | null>(null);

export type HorizontalScrollProps = Omit<ElementProps, 'children'> & {
  /** Classes for the full-viewport frame that sticks while the track pans (layout, padding). Use `pin:` variants: they apply only while panning. */
  frameClassName?: string;
  /** Classes for the track (the row of panels). Stack it by default; `pin:flex pin:flex-row` for the panning row. */
  trackClassName?: string;
  /** Rendered inside the sticky frame, above the track (a rail, a <HorizontalScrollProgress />). */
  header?: ReactNode;
  /** The panels. Direct children of the track; `aria-hidden` children are spacers, not panels. */
  children: ReactNode;
};

/**
 * Vertical scroll pans a row of panels sideways while the section sticks.
 * Replaces `data-pin="horizontal"` + `data-pin-track` (the GSAP pin).
 *
 * Active only when QUERY.pin matches (≥1024 × ≥560, motion allowed) — the
 * same query as the `pin:` Tailwind variant, so `pin:*` classes describe the
 * panning layout and everything else describes the stacked one. Otherwise
 * (phones, short windows, reduced motion) it is an ordinary section and the
 * panels stack.
 *
 * Mechanics: a native `position: sticky` frame inside a section made taller
 * by exactly the track's overflow; useScroll maps the section's scroll
 * progress to a translate3d on the track, 1:1 (no smoothing lag, no
 * scroll-jacking). Keyboard focus on an off-screen panel scrolls the page to
 * that panel. Don't put `overflow: hidden` on an ancestor — it breaks sticky;
 * the section clips sideways itself with `overflow-x: clip`.
 */
export function HorizontalScroll({ className, style, frameClassName = '', trackClassName = '', header, children, ...rest }: HorizontalScrollProps) {
  const section = useRef<HTMLElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const active = useMediaQuery(QUERY.pin);
  const distance = useMotionValue(0);
  const on = useMotionValue(0);

  const { scrollYProgress } = useScroll({ target: section, offset: ['start start', 'end end'] });
  const transform = useTransform<number, string>([scrollYProgress, distance, on], ([p, d, a]) =>
    a ? `translate3d(${trackOffset(p, d)}px, 0px, 0px)` : 'none',
  );

  // Measure: section height = frame height + the track's overflow.
  useIsoLayoutEffect(() => {
    const s = section.current;
    const f = frame.current;
    const t = track.current;
    if (!s || !f || !t) return;
    on.set(active ? 1 : 0);
    if (!active) {
      s.style.height = '';
      distance.set(0);
      return;
    }
    const measure = () => {
      const d = trackDistance(t.scrollWidth, t.clientWidth);
      distance.set(d);
      s.style.height = `${f.offsetHeight + d}px`;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(t);
    ro.observe(f);
    Array.from(t.children).forEach((c) => ro.observe(c));
    return () => {
      ro.disconnect();
      s.style.height = '';
    };
  }, [active, distance, on]);

  // Keyboard: bring a focused panel into view by scrolling the page to it.
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    const s = section.current;
    const t = track.current;
    if (!active || !s || !t) return;
    const panels = Array.from(t.children).filter((c): c is HTMLElement => c instanceof HTMLElement && !c.hasAttribute('aria-hidden'));
    const panel = panels.find((p) => p.contains(e.target as Node));
    if (!panel || !panels.length) return;
    const top = s.getBoundingClientRect().top + window.scrollY;
    const y = panelScrollTop(panel.offsetLeft, panels[0].offsetLeft, distance.get(), top);
    // Instant: a focus jump is keyboard-initiated, so it must not animate.
    if (Math.abs(window.scrollY - y) > 2) window.scrollTo({ top: y, behavior: 'instant' });
  };

  return (
    <HScrollContext.Provider value={{ progress: scrollYProgress }}>
      <section ref={section} className={className} style={{ ...style, overflowX: 'clip' }} {...rest}>
        <div
          ref={frame}
          className={frameClassName}
          style={active ? { position: 'sticky', top: 0, overflowX: 'clip' } : undefined}
        >
          {header}
          <m.div ref={track} className={trackClassName} style={{ transform }} onFocus={onFocus}>
            {children}
          </m.div>
        </div>
      </section>
    </HScrollContext.Provider>
  );
}

/**
 * A bar that fills left → right with the pan (scaleX on a transform, origin
 * left). Must be inside <HorizontalScroll> (its `header` is the usual place).
 * Size and colour it with className.
 */
export function HorizontalScrollProgress({ className = '' }: { className?: string }) {
  const ctx = useContext(HScrollContext);
  const fallback = useMotionValue(0);
  const progress = ctx?.progress ?? fallback;
  const transform = useTransform(progress, (p) => `scaleX(${Math.min(1, Math.max(0, p)).toFixed(4)})`);
  return <m.div aria-hidden className={className} style={{ transform, transformOrigin: '0% 50%' }} />;
}
