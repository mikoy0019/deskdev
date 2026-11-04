'use client';

import { useEffect } from 'react';
import { ArrowClockwiseIcon } from '@phosphor-icons/react';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { Button } from '@/components/site/Button';
import { HeroBackdrop } from '@/components/site/PageHero';
import { Accent, Eyebrow } from '@/components/site/Typography';
import { reportClientError } from '@/lib/clientErrors';

/** Route-level error boundary for the marketing site. The (site) layout —
 *  fonts, theme, motion — stays mounted; only the page area is replaced.
 *  No entrance animation here on purpose: someone recovering from a failure
 *  needs "Try again" at once, not a choreographed reveal. */
export default function SiteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
    // For an error thrown on the server the digest is all the browser is given;
    // sent along, it ties this report to the Worker's own log line.
    reportClientError(error, { app: 'site', kind: 'boundary', digest: error.digest });
  }, [error]);

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <Navbar />

      <main className="flex-1">
        <section className="relative isolate overflow-hidden pb-[clamp(4.5rem,9vw,8rem)] pt-[calc(var(--nx-nav-h)+clamp(4rem,10vw,8.5rem))]">
          <HeroBackdrop />

          <div className="nx-wrap">
            <div className="grid gap-14 lg:grid-cols-12 lg:items-end lg:gap-10">
              <div className="lg:col-span-8">
                <Eyebrow index="500" className="mb-8">
                  Something went wrong
                </Eyebrow>
                <h1 className="nx-h1">
                  A wire came <Accent>loose.</Accent>
                </h1>
                <p className="nx-lede mt-8 max-w-2xl">
                  Something on our side stopped this page from loading. Try again&nbsp;— and if it keeps happening, let us
                  know and we&apos;ll fix it.
                </p>
                <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                  <Button onClick={() => reset()} size="lg" icon={<ArrowClockwiseIcon size={18} aria-hidden />}>
                    Try again
                  </Button>
                  <Button href="/" variant="secondary" size="lg">
                    Back to home
                  </Button>
                  <Button href="/contact" variant="ghost" size="lg" className="min-h-11 sm:ml-3">
                    Contact us
                  </Button>
                </div>
                {error.digest && (
                  <p className="nx-small nx-mono mt-10">
                    Reference: <span className="text-fg-2">{error.digest}</span>
                  </p>
                )}
              </div>

              {/* Decorative watermark, same hairline numeral as the 404 (pr: see there). */}
              <div
                aria-hidden
                className="nx-numeral nx-numeral-outline hidden select-none pr-[0.05em] text-right text-[clamp(8rem,16vw,15rem)] before:content-['500'] lg:col-span-4 lg:block"
              />
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
