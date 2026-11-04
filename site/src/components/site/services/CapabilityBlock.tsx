import { ClockIcon, TrendUpIcon } from '@phosphor-icons/react/ssr';
import { Button } from '@/components/site/Button';
import { Accent, Eyebrow } from '@/components/site/Typography';
import { Counter, Magnetic, Reveal, SplitWords, Stagger, StaggerItem } from '@/components/site/motion';
import { INTRO, introDelay } from '@/components/site/Intro';
import { splitLastWord, splitMetric, splitPrice, type Capability } from './types';

export interface CapabilityLabels {
  deliverables: string;
  results: string;
  cta: string;
  ctaHref: string;
}

/**
 * How a block is composed, so six capabilities don't read as one template:
 * `feature` (the flagship) runs its identity across the full width with the
 * deliverables and proof side by side below; `standard` is the sticky identity
 * column on the left; `mirrored` puts that column on the right from `lg`.
 */
export type CapabilityLayout = 'feature' | 'standard' | 'mirrored';

/**
 * Hairline index numeral — the shared outline treatment (same as About/Home).
 * The stroke sits under a fill in the page colour (as on /process): a bare
 * stroke draws the display face's overlapping contours inside "1" and "4".
 * The fill covers the stroke's inner half, so 2px leaves the 1px hairline.
 * Drawn from `data-n` (::before), like the 404 watermark: decoration, not text.
 */
const OUTLINE_NUMERAL =
  'nx-numeral-outline [-webkit-text-stroke-width:2px] [color:var(--bg)] [paint-order:stroke_fill] before:content-[attr(data-n)]';

/**
 * Double-bezel tray: a hairline outer shell with a 6px lip around an inner
 * core whose radius is the shell's minus the lip, so the curves stay concentric.
 */
const SHELL = 'rounded-[1.75rem] bg-[color-mix(in_oklab,var(--fg)_3%,transparent)] p-1.5 ring-1 ring-line';
const CORE =
  'rounded-[calc(1.75rem-0.375rem)] bg-surface shadow-[inset_0_1px_0_color-mix(in_oklab,var(--fg)_6%,transparent),var(--shadow-sm)]';

/** A metric worth counting up ("+312%", "20+") — not "#1" or "0s", which would only flicker. */
function countable(metric: string) {
  const n = Number.parseFloat(metric.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n >= 10;
}

/** Only a figure that is an increase ("+312%") earns the trend-up mark; "0s" or "#1" are not trends. */
function isGain(metric: string | undefined) {
  return !!metric && metric.startsWith('+');
}

function Price({ price }: { price: string }) {
  const p = splitPrice(price);
  return (
    <p className="flex items-baseline gap-2 text-fg">
      {p ? (
        <>
          {p.lead && <span className="nx-small">{p.lead}</span>}{' '}
          <span className="nx-numeral text-[clamp(1.9rem,2.6vw,2.4rem)]">{p.amount}</span>
          {p.unit && <span className="nx-small">{p.unit}</span>}
        </>
      ) : (
        <span className="nx-numeral text-[clamp(1.9rem,2.6vw,2.4rem)]">{price}</span>
      )}
    </p>
  );
}

function Timeline({ children }: { children: string }) {
  return (
    <p className="nx-mono inline-flex items-center gap-2 pb-1 text-[0.8125rem] uppercase tracking-[0.1em] text-fg-2">
      <ClockIcon size={15} aria-hidden className="shrink-0" />
      {children}
    </p>
  );
}

/**
 * Each row reveals on its own as it reaches the viewport (a group stagger would
 * play the lower rows off-screen on a phone); the right column trails by 40ms
 * where two sit side by side.
 */
function Deliverables({ label, items, roomy }: { label: string; items: string[]; roomy: boolean }) {
  return (
    <div>
      <Reveal>
        <Eyebrow as="h3" className="mb-5">
          {label}
        </Eyebrow>
      </Reveal>
      <ol className="grid border-t border-line sm:grid-cols-2 sm:gap-x-10">
        {items.map((d, i) => (
          <Reveal
            as="li"
            key={d}
            distance={10}
            delay={(i % 2) * 0.04}
            className={`flex items-baseline gap-4 border-b border-line ${roomy ? 'py-4' : 'py-3 sm:py-4'}`}
          >
            <span className="nx-mono w-5 shrink-0 text-[0.6875rem] tabular-nums text-fg-3" aria-hidden>
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className={`leading-snug text-fg ${roomy ? 'text-[1rem]' : 'text-[0.9375rem] sm:text-[1rem]'}`}>{d}</span>
          </Reveal>
        ))}
      </ol>
    </div>
  );
}

/** Marker beside a secondary result: the same dot on every row. The chip belongs to the lead figure alone. */
function ResultMark() {
  return (
    <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center">
      <span className="size-1.5 rounded-full bg-accent-text/70" />
    </span>
  );
}

/**
 * Proof: one tray on every block. The lead result sits in the large cell, the
 * other two beside (or, `stacked`, under) it as dotted rows. A lead with a
 * figure sets the figure as a numeral over its label; a lead that is a
 * statement ("Live KPIs in one panel") sets the sentence at heading size in
 * the same cell, so the six blocks read as one component.
 */
function Proof({ label, results, stacked }: { label: string; results: string[]; stacked: boolean }) {
  const [first, ...rest] = results;
  const firstMetric = splitMetric(first);

  return (
    <div>
      <Reveal>
        <Eyebrow as="h3" className="mb-5">
          {label}
        </Eyebrow>
      </Reveal>
      <Reveal className={SHELL}>
        <ul className={`grid overflow-hidden sm:grid-cols-[1.2fr_1fr] ${stacked ? 'lg:grid-cols-1' : ''} ${CORE}`}>
          <li
            className={`flex flex-col justify-between gap-8 border-b border-line p-6 sm:row-span-2 sm:border-r sm:border-b-0 sm:p-8 ${
              stacked ? 'lg:row-span-1 lg:border-r-0 lg:border-b' : ''
            }`}
          >
            {/* One chip for every lead result; the trend arrow only where the figure is an increase. */}
            <span aria-hidden className="grid h-9 w-9 place-items-center rounded-full bg-accent-soft text-accent-text">
              {isGain(firstMetric?.metric) ? <TrendUpIcon size={16} /> : <span className="size-1.5 rounded-full bg-current" />}
            </span>
            {firstMetric ? (
              <p className="font-heading text-[1.125rem] font-medium leading-snug tracking-[-0.012em] text-fg-2">
                {countable(firstMetric.metric) ? (
                  <Counter value={firstMetric.metric} className="nx-numeral block text-[clamp(3rem,4.6vw,4.25rem)] text-accent-text" />
                ) : (
                  <span className="nx-numeral block text-[clamp(3rem,4.6vw,4.25rem)] text-accent-text">{firstMetric.metric}</span>
                )}{' '}
                <span className="mt-4 block text-balance text-fg">{firstMetric.rest}</span>
              </p>
            ) : (
              <p className="nx-h3 max-w-[16ch] text-balance">{first}</p>
            )}
          </li>
          {rest.map((r, i) => {
            const m = splitMetric(r);
            return (
              <li key={r} className={`flex items-start gap-4 p-5 sm:p-6 ${i > 0 ? 'border-t border-line' : ''}`}>
                <ResultMark />
                <p className="pt-0.5 font-heading text-[1.0625rem] font-medium leading-snug tracking-[-0.012em] text-fg">
                  {m ? (
                    <>
                      <span className="tabular-nums text-accent-text">{m.metric}</span> {m.rest}
                    </>
                  ) : (
                    r
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      </Reveal>
    </div>
  );
}

/**
 * One capability on /services. `standard` / `mirrored`: a sticky identity
 * column (index numeral, tagline, title, price, timeline) beside the detail
 * column (body, deliverables, proven results); the column only sticks when the
 * viewport is tall enough to show all of it. `feature`: the identity spans the
 * full width, then deliverables and proof sit side by side. The CTA sits with
 * the identity on desktop and closes the block on smaller screens.
 *
 * Motion (marketing, seen once per visit): the identity enters as one group
 * (numeral, tagline, words of the title, price, CTA, 60ms apart; the flagship's
 * first three use the CSS page intro, see below), deliverable
 * rows fade up as each arrives, the proof rises in and a lead figure counts
 * up. All of it is the motion kit's, so reduced motion keeps the fades and
 * drops the travel.
 */
export function CapabilityBlock({
  capability: c,
  labels,
  layout = 'standard',
}: {
  capability: Capability;
  labels: CapabilityLabels;
  layout?: CapabilityLayout;
}) {
  const titleId = `${c.anchor}-title`;
  const [lead, last] = splitLastWord(c.title);

  const title = (
    <>
      {lead}
      {lead && ' '}
      <Accent>{last}</Accent>
    </>
  );
  const cta = (
    <Button href={labels.ctaHref} variant="invert" arrow aria-describedby={titleId}>
      {labels.cta}
    </Button>
  );
  const mobileCta = <Reveal className="mt-12 lg:hidden">{cta}</Reveal>;

  if (layout === 'feature') {
    return (
      <article id={c.anchor} aria-labelledby={titleId} className="border-t border-line py-[clamp(5rem,10vw,9.5rem)]">
        <div className="nx-wrap">
          <Stagger>
            <div className="grid gap-x-16 gap-y-10 lg:grid-cols-12 lg:items-end">
              <div className="lg:col-span-7">
                {/* The flagship opens the page: on a phone its numeral, tagline and the top of its
                    title are inside the first screen. They enter with the CSS intro (Intro.tsx),
                    which starts on first paint right after the hero's own pieces, instead of
                    waiting for hydration as kit items would. The rest of the block is below the
                    fold everywhere and keeps the kit's scroll entrance. */}
                <span
                  aria-hidden
                  data-n={c.id}
                  className={`nx-intro-fade nx-numeral block text-[clamp(5.5rem,13vw,13rem)] leading-[0.78] tracking-[-0.06em] ${OUTLINE_NUMERAL}`}
                  style={introDelay(INTRO.cap - 2 * INTRO.step)}
                />
                <div className="nx-intro" style={introDelay(INTRO.cap - INTRO.step)}>
                  <Eyebrow className="mt-10 text-accent-text">{c.tagline}</Eyebrow>
                </div>
                <h2 id={titleId} className="nx-intro nx-h2 mt-5" style={introDelay(INTRO.cap)}>
                  {title}
                </h2>
              </div>
              <StaggerItem as="p" className="nx-lede max-w-[40rem] text-pretty lg:col-span-5 lg:pb-2">
                {c.body}
              </StaggerItem>
            </div>

            <StaggerItem className="mt-12 flex flex-wrap items-end gap-x-12 gap-y-4 border-t border-line pt-6 lg:mt-16">
              <Price price={c.price} />
              <Timeline>{c.timeline}</Timeline>
              <div className="ml-auto hidden lg:block">
                <Magnetic>{cta}</Magnetic>
              </div>
            </StaggerItem>
          </Stagger>

          <div className="mt-14 grid gap-x-16 gap-y-12 md:mt-20 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <Deliverables label={labels.deliverables} items={c.deliverables} roomy />
            </div>
            <div className="lg:col-span-5">
              <Proof label={labels.results} results={c.results} stacked />
            </div>
          </div>

          {mobileCta}
        </div>
      </article>
    );
  }

  const mirrored = layout === 'mirrored';

  return (
    <article id={c.anchor} aria-labelledby={titleId} className="border-t border-line py-[clamp(5rem,10vw,9.5rem)]">
      <div className="nx-wrap grid gap-x-16 gap-y-14 lg:grid-cols-12">
        {/* Identity — sticks while the detail column scrolls past. First in the DOM either way; `mirrored` only moves it visually. */}
        <div className={`lg:col-span-5 lg:row-start-1 ${mirrored ? 'lg:col-start-8' : ''}`}>
          <Stagger className="lg:top-[calc(var(--nx-nav-h)+2.5rem)] lg:[@media(min-height:46rem)]:sticky">
            <StaggerItem
              as="span"
              aria-hidden
              data-n={c.id}
              className={`nx-numeral block text-[clamp(5.5rem,11vw,10.5rem)] leading-[0.78] tracking-[-0.06em] ${OUTLINE_NUMERAL}`}
            />

            <StaggerItem>
              <Eyebrow className="mt-10 text-accent-text">{c.tagline}</Eyebrow>
            </StaggerItem>
            <SplitWords as="h2" id={titleId} className="nx-h2 mt-5">
              {title}
            </SplitWords>

            <StaggerItem className="mt-10 flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-t border-line pt-6">
              <Price price={c.price} />
              <Timeline>{c.timeline}</Timeline>
            </StaggerItem>

            <StaggerItem className="mt-10 hidden lg:block">
              <Magnetic>{cta}</Magnetic>
            </StaggerItem>
          </Stagger>
        </div>

        {/* Detail */}
        <div className={`lg:col-span-7 lg:row-start-1 lg:pt-3 ${mirrored ? 'lg:col-start-1' : ''}`}>
          <Reveal as="p" className="nx-lede max-w-[40rem] text-pretty">
            {c.body}
          </Reveal>

          <div className="mt-14 md:mt-16">
            <Deliverables label={labels.deliverables} items={c.deliverables} roomy={false} />
          </div>

          <div className="mt-12 md:mt-14">
            <Proof label={labels.results} results={c.results} stacked={false} />
          </div>

          {mobileCta}
        </div>
      </div>
    </article>
  );
}
