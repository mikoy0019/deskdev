'use client';

import { useEffect, useRef } from 'react';
import { animate, useInView } from 'framer-motion';
import { formatCounter, parseCounter } from './countUp';
import { DURATION, EASE, IN_VIEW, QUERY } from './presets';
import { useMotionKit } from './hooks';

export type CounterProps = {
  /** The final display string, e.g. "200+", "$14M+", "1,284", "4.9/5". Its first number counts up. */
  value: string;
  className?: string;
  /** Seconds. Default 1.4. */
  duration?: number;
};

/**
 * Writes into the span's existing text node (React's own), so React keeps
 * ownership of it and a later `value` change still lands on screen.
 */
function write(el: HTMLElement, text: string) {
  const node = el.firstChild;
  if (node && node.nodeType === Node.TEXT_NODE && !node.nextSibling) node.nodeValue = text;
  else el.textContent = text;
}

/**
 * A statistic that counts up to its value as it scrolls into view. Replaces
 * `data-counter`.
 *
 * - The server HTML (and no-JS, crawlers, reduced motion) has the final value.
 * - A number already on screen when the page loads stays put; only one still
 *   below the fold is reset to 0 (off-screen, so nobody sees the swap) and
 *   counted when it arrives.
 * - The count writes text directly (no React render per frame) and always
 *   finishes on the exact source string. Tabular numerals keep the width steady.
 */
export function Counter({ value, className = '', duration = DURATION.counter }: CounterProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const armed = useRef(false);
  const inView = useInView(ref, { once: true, margin: IN_VIEW.counterMargin });
  const { instant } = useMotionKit();

  // Arm: decide once, after hydration, whether this number will count.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    armed.current = false;
    write(el, value);
    const parsed = parseCounter(value);
    if (!parsed || instant || window.matchMedia(QUERY.reducedMotion).matches) return;
    const r = el.getBoundingClientRect();
    const onScreen = r.bottom > 0 && r.top < window.innerHeight;
    if (onScreen) return;
    armed.current = true;
    write(el, formatCounter(parsed, 0));
    return () => {
      armed.current = false;
      write(el, value);
    };
  }, [value, instant]);

  // Count when it arrives.
  useEffect(() => {
    const el = ref.current;
    const parsed = parseCounter(value);
    if (!inView || !el || !parsed || !armed.current) return;
    armed.current = false;
    const controls = animate(0, parsed.target, {
      duration,
      ease: EASE.out,
      onUpdate: (v) => write(el, formatCounter(parsed, v)),
      onComplete: () => write(el, value),
    });
    return () => {
      controls.stop();
      write(el, value);
    };
  }, [inView, value, duration]);

  return (
    <span ref={ref} className={`tabular-nums ${className}`.trim()}>
      {value}
    </span>
  );
}
