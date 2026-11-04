'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { DURATION, EASE_CSS } from '@/components/site/motion/presets';

/**
 * Settles the login card in whenever `key` changes after the first render (the card swapping
 * between sign-in, reset and sent). The first render is left to the CSS entrance in LoginStyles.
 *
 * Emil's gate: an occasional, click-initiated state change. The purpose is to stop the new step
 * from teleporting in under the pointer.
 * - Tool: WAAPI, which runs on the compositor and needs no library.
 * - Motion: an 8px rise plus a fade, DURATION.modal (280ms) on the strong ease-out.
 * - Interruptible: a second swap cancels the running animation and starts from the current frame.
 * - Reduced motion: the fade stays and the movement goes.
 */
export function useSwapIn<T extends HTMLElement>(key: string): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  // Compare against the last key (not a "first render" flag) so StrictMode's
  // double-invoked mount effect doesn't count as a swap.
  const last = useRef(key);

  useEffect(() => {
    if (last.current === key) return;
    last.current = key;
    const el = ref.current;
    if (!el) return;
    // Hand focus to the new heading so keyboard / screen-reader users land in the new step
    // (the button they pressed may have just unmounted).
    el.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
    if (typeof el.animate !== 'function') return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const anim = el.animate(
      reduced
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: 'translate3d(0, 8px, 0)' },
            { opacity: 1, transform: 'none' },
          ],
      { duration: DURATION.modal * 1000, easing: EASE_CSS.out },
    );
    return () => anim.cancel();
  }, [key]);

  return ref;
}
