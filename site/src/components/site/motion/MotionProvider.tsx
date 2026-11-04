'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { LazyMotion, MotionConfig, domAnimation } from 'framer-motion';
import { MotionKitContext } from './hooks';
import { FAILSAFE_MS } from './presets';

/**
 * Framer Motion for the marketing site. Mounted once, in app/(site)/layout.tsx.
 *
 * - LazyMotion + domAnimation: the `m.*` components carry only the renderer;
 *   animations, variants, exit, in-view, hover/tap/focus come from this one
 *   bundle. Layout/drag (domMax) is loaded on demand by the primitives that
 *   need it (AutoSortList). `strict`: rendering `motion.*` under this
 *   provider throws in development — import `m` instead.
 * - MotionConfig reducedMotion="user": framer drops x/y/scale/layout motion for
 *   people who ask for less motion. The kit writes full transform strings
 *   (which framer does not treat as positional), so its components also read
 *   the preference themselves and keep only the fade.
 * - Marks <html data-nx-motion="ready"> once hydrated. Until then the CSS
 *   fail-safe in nx.css may reveal hidden content (no JS, JS failed, or slower
 *   than FAILSAFE_MS); if hydration comes after that, the attribute says
 *   "late" and entrances land instantly instead of re-hiding the page.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  const [instant, setInstant] = useState(false);

  useEffect(() => {
    const late = performance.now() > FAILSAFE_MS;
    document.documentElement.setAttribute('data-nx-motion', late ? 'late' : 'ready');
    // Hydration timing is only knowable now; one re-render of the context.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (late) setInstant(true);
  }, []);

  const kit = useMemo(() => ({ instant }), [instant]);

  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <MotionKitContext.Provider value={kit}>{children}</MotionKitContext.Provider>
      </MotionConfig>
    </LazyMotion>
  );
}
