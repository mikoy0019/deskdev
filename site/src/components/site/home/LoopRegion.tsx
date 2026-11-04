'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { PauseIcon, PlayIcon } from '@phosphor-icons/react';
import { IN_VIEW, useOffscreenPause, usePrefersReducedMotion } from '@/components/site/motion';

/**
 * A plain block whose CSS loops (`.nx-kit-loop` inside it) pause while it is
 * off-screen (browsers already stop them in background tabs). Lets
 * server-rendered decorative loops (the hero wall, the bento timelines) stop
 * costing frames once scrolled past.
 *
 * It also reports first sight: `data-loop-armed` while the block has not been
 * on screen yet, `data-loop-live` from the first time it is. A loop that tells
 * a sequence (the 14 days) uses the pair to start from its first frame when
 * the reader arrives, instead of mid-cycle.
 */
export function LoopRegion({
  children,
  className = '',
  style,
  'aria-hidden': ariaHidden,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  'aria-hidden'?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useOffscreenPause(ref);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.setAttribute('data-loop-live', '');
          io.disconnect();
        } else {
          el.setAttribute('data-loop-armed', '');
        }
      },
      { rootMargin: IN_VIEW.margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={className} style={style} aria-hidden={ariaHidden}>
      {children}
    </div>
  );
}

/**
 * A decorative loop with a way to stop it (WCAG 2.2.2: the hero wall and strip
 * run for about a minute per cycle, and resting a mouse on them is not a way a
 * keyboard or a touch screen has). The loop itself stays `aria-hidden`; the
 * button sits beside it, outside the hidden block.
 *
 * The button is the motion kit's marquee toggle (nx.css): out of sight until a
 * keyboard reaches it with a mouse or trackpad, always there on touch. While it
 * is pressed the wrapper carries `data-paused` and home.module.css holds the
 * tracks still. Not rendered under reduced motion (nothing loops) and hidden
 * without JavaScript (nx-js-only: it could do nothing).
 */
export function PausableLoop({
  children,
  className = '',
  loopClassName = '',
  toggleClassName = '',
}: {
  children: ReactNode;
  /** The wrapper: positioning, and what `data-paused` is set on. */
  className?: string;
  /** The aria-hidden block that holds the loop (mask, overflow, grid). */
  loopClassName?: string;
  toggleClassName?: string;
}) {
  const [paused, setPaused] = useState(false);
  const reduced = usePrefersReducedMotion();
  return (
    <div className={className} data-paused={paused ? '' : undefined}>
      <LoopRegion aria-hidden className={loopClassName}>
        {children}
      </LoopRegion>
      {!reduced && (
        <button
          type="button"
          className={`nx-kit-marquee-toggle nx-press nx-js-only ${toggleClassName}`.trim()}
          data-mode="focus"
          aria-pressed={paused}
          aria-label="Pause motion"
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? <PlayIcon aria-hidden size={16} weight="regular" /> : <PauseIcon aria-hidden size={16} weight="regular" />}
        </button>
      )}
    </div>
  );
}
