import type { ReactNode } from 'react';
import { flattenTitle } from './Typography';
import { Reveal } from './motion/Reveal';
import { SplitWords } from './motion/SplitWords';
import { Stagger, StaggerItem } from './motion/Stagger';

/**
 * Closing call-to-action panel — the one brand-blue surface on a page. Same
 * look in both themes. Put Buttons with variant="white" / "outline-white" in
 * `actions`.
 *
 * A calm plate, not a glow: one flat cobalt (a few percent of tonal drift top
 * to bottom, same hue), a hairline grid fading out of one corner, and no light
 * blobs. Built as a double bezel: a quiet outer tray (hairline ring, a few
 * pixels of the page's surface) holding the plate, whose radius is the tray's
 * minus the gap so the two curves stay concentric. The plate's own hairline
 * (inset ring + top highlight, in nx.css) gives it an edge.
 *
 * Motion (kit): the tray rises from 0.96 as it scrolls into view; the copy then
 * enters as a group (kicker, headline word by word, body, actions).
 */
export function CtaBand({
  kicker,
  title,
  body,
  actions,
  className = '',
}: {
  /** Small line above the title, e.g. <Beacon>Available Q2 2026</Beacon> or text. */
  kicker?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`nx-section ${className}`}>
      <div className="nx-wrap">
        <Reveal
          variant="scale"
          className="rounded-[calc(var(--nx-radius-xl)+0.5rem)] bg-surface/60 p-1.5 ring-1 ring-line sm:p-2"
        >
          <div className="nx-cta relative isolate overflow-hidden rounded-[var(--nx-radius-xl)] px-6 py-16 sm:px-12 md:px-16 md:py-24">
            <div className="nx-cta-grid pointer-events-none absolute inset-0 -z-10" aria-hidden />
            <Stagger delay={0.12} className="max-w-3xl">
              {kicker && <StaggerItem className="mb-8 text-white/85">{kicker}</StaggerItem>}
              <SplitWords as="h2" className="nx-h2 !text-white">
                {flattenTitle(title)}
              </SplitWords>
              {body && (
                <StaggerItem as="p" className="nx-lede mt-6 max-w-2xl !text-white/80">
                  {body}
                </StaggerItem>
              )}
              {actions && <StaggerItem className="mt-10 flex flex-wrap gap-3">{actions}</StaggerItem>}
            </Stagger>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
