import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRightIcon } from '@phosphor-icons/react/ssr';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { Button } from '@/components/site/Button';
import { HeroBackdrop } from '@/components/site/PageHero';
import { Accent, Eyebrow } from '@/components/site/Typography';
import { INTRO, introDelay, introHeadline } from '@/components/site/Intro';

export const metadata: Metadata = {
  title: 'Page not found',
  // The 404 response already carries robots noindex (added by the router).
};

// Where people usually meant to go.
const destinations = [
  { label: 'Services', href: '/services' },
  { label: 'Portfolio', href: '/portfolio' },
  { label: 'Process', href: '/process' },
  { label: 'Templates', href: '/templates' },
  { label: 'About', href: '/about' },
];

/** Hover nudge for the row arrow: mouse/trackpad only, never under reduced motion. */
const NUDGE =
  '[transition:translate_200ms_var(--ease-out),color_200ms_ease] [@media(hover:hover)_and_(pointer:fine)_and_(prefers-reduced-motion:no-preference)]:group-hover:translate-x-0.5 [@media(hover:hover)_and_(pointer:fine)_and_(prefers-reduced-motion:no-preference)]:group-hover:-translate-y-0.5';

export default function NotFound() {
  const headline = introHeadline(
    <>
      This page is <Accent>off the map.</Accent>
    </>,
  );
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <Navbar />

      <main className="flex-1">
        <section className="relative isolate overflow-hidden pb-[clamp(4.5rem,9vw,8rem)] pt-[calc(var(--nx-nav-h)+clamp(4rem,10vw,8.5rem))]">
          <HeroBackdrop />

          <div className="nx-wrap">
            {/* A rare page, so it keeps the site's hero entrance: the CSS intro (Intro.tsx), on
                screen from first paint, under 0.6s of waiting in all. */}
            <div className="grid gap-14 lg:grid-cols-12 lg:items-end lg:gap-10">
              <div className="lg:col-span-8">
                <div className="nx-intro mb-8">
                  <Eyebrow index="404">Page not found</Eyebrow>
                </div>
                <h1 className="nx-h1">{headline.words}</h1>
                <p className="nx-intro nx-lede mt-8 max-w-2xl" style={introDelay(headline.after)}>
                  The link may be out of date, or the page has moved. Head back to the homepage, or tell us what you
                  were looking for and we&apos;ll point you to it.
                </p>
                <div
                  className="nx-intro mt-10 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center"
                  style={introDelay(headline.after + INTRO.step)}
                >
                  <Button href="/" size="lg" arrow magnetic>
                    Back to home
                  </Button>
                  <Button href="/contact" variant="secondary" size="lg">
                    Contact us
                  </Button>
                </div>
              </div>

              {/* Decorative watermark: drawn via ::before so it isn't read or contrast-checked as text.
                  pr: negative tracking pulls the box in from the last glyph, so without it the ink
                  overhangs the grid's right edge (the same correction PhaseNumeral uses). */}
              <div
                aria-hidden
                className="nx-intro-fade nx-numeral nx-numeral-outline hidden select-none pr-[0.05em] text-right text-[clamp(8rem,16vw,15rem)] before:content-['404'] lg:col-span-4 lg:block"
                style={introDelay(headline.after + 2 * INTRO.step)}
              />
            </div>

            {/* Editorial index of likely destinations: hairline rows on phones, one ruled line of five on desktop. */}
            <nav aria-label="Popular pages" className="mt-[clamp(4.5rem,9vw,7.5rem)]">
              <p className="nx-eyebrow mb-4">Popular pages</p>
              <ul className="grid border-t border-line md:grid-cols-5">
                {destinations.map((d, i) => (
                  <li key={d.href} className="border-b border-line md:border-b-0 md:border-l md:first:border-l-0">
                    <Link
                      href={d.href}
                      className="group flex min-h-16 touch-manipulation select-none items-center justify-between gap-4 py-4 [-webkit-tap-highlight-color:transparent] md:px-5 md:[li:first-child>&]:pl-0"
                    >
                      <span className="flex items-baseline gap-3">
                        <span aria-hidden className="nx-mono text-[0.6875rem] text-fg-3">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <span className="font-heading text-lg tracking-[-0.01em] text-fg [transition:color_200ms_ease] group-hover:text-accent-text">
                          {d.label}
                        </span>
                      </span>
                      <ArrowUpRightIcon size={16} aria-hidden className={`shrink-0 text-fg-3 group-hover:text-accent-text ${NUDGE}`} />
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
