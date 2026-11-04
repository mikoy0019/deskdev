import type { ReactNode } from 'react';
import { Eyebrow } from './Typography';
import { INTRO, introDelay, introHeadline } from './Intro';

/**
 * Light pool for the top of a page: the theme's raised surface tone fading
 * out from the upper left, so the hero has depth without a coloured glow (one
 * accent, no blue aura). Neutral in both themes.
 */
export const LIGHT_POOL =
  'bg-[radial-gradient(60%_70%_at_14%_0%,var(--surface)_0%,transparent_72%)] light:bg-[radial-gradient(60%_70%_at_14%_0%,#ffffff_0%,transparent_72%)]';

/** Hairline grid (masked to the middle) under the light pool. Decorative; sits behind the hero copy. */
export function HeroBackdrop({ className = 'h-[38rem]' }: { className?: string }) {
  return (
    <>
      <div className="nx-grid-bg pointer-events-none absolute inset-0 -z-10 opacity-70" aria-hidden />
      <div className={`pointer-events-none absolute inset-x-0 top-0 -z-10 ${LIGHT_POOL} ${className}`} aria-hidden />
    </>
  );
}

/**
 * Hero for inner pages (About, Services, Portfolio, Process, Contact).
 * Editorial split: the headline owns the left eight columns, the aside sits
 * bottom-aligned on the right.
 *
 * Motion: a CSS intro that starts on first paint (see Intro.tsx) — eyebrow,
 * the headline word by word, then lede, actions, aside once the headline's
 * last word is on its way. Nothing waits for JavaScript or for more than
 * 0.6s, and nothing is blocked while it plays. Reduced motion: no travel and
 * no waiting. The motion kit is for what enters below the fold.
 */
export function PageHero({
  eyebrow,
  index,
  title,
  lede,
  actions,
  aside,
  children,
  className = '',
}: {
  /** A string renders as an Eyebrow; pass a node (e.g. <Beacon>) for anything else. */
  eyebrow?: ReactNode;
  index?: string;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  /** Right column on large screens (meta list, stat, image). */
  aside?: ReactNode;
  /** Extra content under the hero copy, full width. */
  children?: ReactNode;
  className?: string;
}) {
  const headline = introHeadline(title);
  return (
    <section className={`relative isolate overflow-hidden pt-[calc(var(--nx-nav-h)+clamp(4rem,10vw,8.5rem))] pb-[clamp(3.5rem,8vw,7rem)] ${className}`}>
      <HeroBackdrop />

      <div className="nx-wrap">
        <div className={`grid gap-12 ${aside ? 'lg:grid-cols-12 lg:items-end' : ''}`}>
          <div className={aside ? 'lg:col-span-8' : 'max-w-5xl'}>
            {eyebrow && (
              <div className="nx-intro mb-8">
                {typeof eyebrow === 'string' ? <Eyebrow index={index}>{eyebrow}</Eyebrow> : eyebrow}
              </div>
            )}
            {/* One step under the Home display line (5.8vw) up to 1440: 78px there against 83px, 84px max. */}
            <h1 className="nx-h1 text-[clamp(2.7rem,5.4vw,5.25rem)]">{headline.words}</h1>
            {lede && (
              <p className="nx-intro nx-lede mt-8 max-w-2xl" style={introDelay(headline.after)}>
                {lede}
              </p>
            )}
            {actions && (
              <div className="nx-intro mt-10 flex flex-wrap items-center gap-3" style={introDelay(headline.after + INTRO.step)}>
                {actions}
              </div>
            )}
          </div>
          {aside && (
            <div className="nx-intro lg:col-span-4" style={introDelay(headline.after + 2 * INTRO.step)}>
              {aside}
            </div>
          )}
        </div>
        {children}
      </div>
    </section>
  );
}
