import { StaggerItem } from '@/components/site/motion';
import { Accent } from '@/components/site/Typography';
import { InFocus } from './InFocus';
import { splitOver, type Principle } from './types';

/**
 * One operating principle: tonal numeral, "X over Y" title, rationale.
 * The numeral takes the accent while its row crosses the middle of the
 * viewport (InFocus), marking the rule being read. A colour change, eased.
 * A fill, not a text stroke: stroking the variable display face draws its
 * overlapping contours, which shows as stray lines inside the "1".
 * The numeral is decoration (the label beside it carries the number for
 * screen readers), so it is drawn from `data-n` through ::before rather than
 * set as text: a tonal watermark is not copy to hold to text contrast.
 * Render inside a <Stagger as="ol">.
 */
export function PrincipleRow({ principle: p, label }: { principle: Principle; label: string }) {
  const parts = splitOver(p.title);

  return (
    <StaggerItem as="li" className="border-b border-line">
      <InFocus className="group grid gap-x-10 gap-y-5 py-10 sm:grid-cols-[7.5rem_minmax(0,1fr)] md:py-12 xl:grid-cols-[8.5rem_minmax(0,0.9fr)_minmax(0,1fr)]">
        <div className="flex items-baseline gap-4 sm:block">
          <span
            aria-hidden
            data-n={p.n}
            className="nx-numeral block text-[clamp(4rem,6.5vw,6rem)] leading-[0.8] tracking-[-0.06em] text-[color-mix(in_oklab,var(--fg)_20%,transparent)] transition-colors duration-300 ease-[ease] before:content-[attr(data-n)] group-data-[focus]:text-accent-text"
          />
          <span className="nx-mono text-[0.6875rem] uppercase tracking-[0.14em] text-fg-3 sm:mt-4 sm:block">
            {label} <span className="sr-only">{p.n}</span>
          </span>
        </div>

        <h3 className="nx-h3 text-[clamp(1.6rem,2.3vw,2.1rem)] leading-[1.08] xl:pt-1">
          {parts ? (
            <>
              {parts[0]}{' '}
              <span className="block text-fg-3">
                over <Accent>{parts[1]}</Accent>
              </span>
            </>
          ) : (
            p.title
          )}
        </h3>

        <p className="nx-body sm:col-start-2 xl:col-start-3 xl:pt-2">{p.body}</p>
      </InFocus>
    </StaggerItem>
  );
}
