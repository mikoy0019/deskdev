'use client';

/**
 * Shared client hooks for the motion kit. Every hook that reads the browser
 * (media queries, visibility) returns its SERVER value during hydration and
 * only then switches to the real one (useSyncExternalStore's server snapshot),
 * so nothing the kit renders can differ between server HTML and the first
 * client render.
 */
import { createContext, useContext, useEffect, useLayoutEffect, useState, useSyncExternalStore, type RefObject } from 'react';
import { useInView } from 'framer-motion';
import { IN_VIEW, QUERY } from './presets';

export const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** `matchMedia(query).matches`, false on the server and during hydration. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** prefers-reduced-motion: reduce. Hydration-safe (false until hydrated). */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery(QUERY.reducedMotion);
}

/** document.visibilityState === 'visible' (true on the server). */
export function useDocumentVisible(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      document.addEventListener('visibilitychange', onChange);
      return () => document.removeEventListener('visibilitychange', onChange);
    },
    () => document.visibilityState === 'visible',
    () => true,
  );
}

/**
 * The element whose hover / focus holds a loop still (WCAG 2.2.2: a way to
 * pause motion that runs longer than 5s). A page can mark a whole card with
 * `data-nx-loop-zone`; otherwise it is the loop itself, or its parent when the
 * loop is `inert` (inert elements receive no pointer events).
 */
function loopZone(el: Element): Element {
  return el.closest('[data-nx-loop-zone]') ?? (el.hasAttribute('inert') ? el.parentElement : null) ?? el;
}

/**
 * Calls `onChange(true)` while the loop's zone is hovered with a mouse or has
 * keyboard focus inside it, `onChange(false)` when both are gone. Touch never
 * holds (a tap would leave the loop stuck). Returns the cleanup.
 */
function watchHeld(el: Element, onChange: (held: boolean) => void): () => void {
  const zone = loopZone(el) as HTMLElement;
  let hover = false;
  let focus = false;
  let last = false;
  const sync = () => {
    const held = hover || focus;
    if (held === last) return;
    last = held;
    onChange(held);
  };
  const enter = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    hover = true;
    sync();
  };
  const leave = () => {
    hover = false;
    sync();
  };
  const focusIn = () => {
    focus = true;
    sync();
  };
  const focusOut = (e: FocusEvent) => {
    if (e.relatedTarget instanceof Node && zone.contains(e.relatedTarget)) return;
    focus = false;
    sync();
  };
  zone.addEventListener('pointerenter', enter);
  zone.addEventListener('pointerleave', leave);
  zone.addEventListener('focusin', focusIn);
  zone.addEventListener('focusout', focusOut);
  return () => {
    zone.removeEventListener('pointerenter', enter);
    zone.removeEventListener('pointerleave', leave);
    zone.removeEventListener('focusin', focusIn);
    zone.removeEventListener('focusout', focusOut);
  };
}

/** True while the loop's zone (see loopZone) is hovered with a mouse or holds focus. */
export function useLoopHeld(ref: RefObject<Element | null>): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return watchHeld(el, setHeld);
  }, [ref]);
  return held;
}

/**
 * Whether a perpetual loop may run: near the viewport, tab visible, motion
 * allowed, and not held by the reader (mouse hover or keyboard focus on its
 * zone). Loops that use this stop their timers when it turns false, so
 * nothing ticks off-screen or in a background tab.
 * - `allowReduced`: the loop has its own gentler reduced-motion form (an
 *   opacity-only fade) and keeps cycling with it.
 * - `pauseOnHold: false`: the loop handles hover / focus itself (useLoopHeld).
 */
export function useLoopGate(ref: RefObject<Element | null>, options: { allowReduced?: boolean; pauseOnHold?: boolean } = {}): boolean {
  const near = useInView(ref, { margin: IN_VIEW.loopMargin });
  const visible = useDocumentVisible();
  const reduced = usePrefersReducedMotion();
  const held = useLoopHeld(ref);
  return near && visible && (options.allowReduced === true || !reduced) && !(held && options.pauseOnHold !== false);
}

/**
 * Pauses the CSS loops inside `ref` while it is off-screen, and while its zone
 * is hovered with a mouse or holds keyboard focus, by toggling
 * `data-nx-offscreen` / `data-nx-held` directly on the element (no React
 * re-render). nx.css pauses every `.nx-kit-loop` animation under either
 * attribute. (A hidden tab needs nothing: browsers stop CSS animations there.)
 */
export function useOffscreenPause(ref: RefObject<Element | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) el.removeAttribute('data-nx-offscreen');
        else el.setAttribute('data-nx-offscreen', '');
      },
      { rootMargin: IN_VIEW.loopMargin },
    );
    io.observe(el);
    const unwatch = watchHeld(el, (held) => {
      if (held) el.setAttribute('data-nx-held', '');
      else el.removeAttribute('data-nx-held');
    });
    return () => {
      io.disconnect();
      unwatch();
      el.removeAttribute('data-nx-offscreen');
      el.removeAttribute('data-nx-held');
    };
  }, [ref]);
}

/**
 * Set by MotionProvider. `instant` = the provider hydrated after the CSS
 * fail-safe already showed the hidden content, so entrances land immediately
 * for the rest of the session rather than hiding content again.
 */
export const MotionKitContext = createContext<{ instant: boolean }>({ instant: false });

export function useMotionKit() {
  return useContext(MotionKitContext);
}

/**
 * Inside a <Stagger>, children don't trigger themselves: they inherit the
 * group's hidden → shown change, and the group spaces them out.
 */
export const StaggerContext = createContext(false);

export function useInStagger() {
  return useContext(StaggerContext);
}
