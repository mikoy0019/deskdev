import { ClockIcon } from '@phosphor-icons/react/ssr';
import { Eyebrow } from '@/components/site/Typography';
import { Reveal, SplitWords, Stagger, StaggerItem } from '@/components/site/motion';
import { PhaseNumeral } from './PhaseNumeral';
import type { Phase } from './types';

/**
 * One phase on /process. Stacked on phones and in the two-by-two grid from lg;
 * a wide two-column panel on tablets, where it has the whole row.
 *
 * Double-bezel: a hairline tray (outer shell) holding the panel (inner core)
 * with concentric radii, so the panel reads as a machined plate rather than a
 * flat card.
 *
 * Motion: the plate rises in once when it reaches the viewport (`delay` sets
 * the right column a beat behind the left). Inside it the numeral fills, the
 * title rises word by word and the deliverables follow, each on its own
 * in-view trigger, so a panel that is only half on screen never spends them.
 */
export function PhasePanel({
  phase: p,
  total,
  deliverablesLabel,
  feature = false,
  delay,
}: {
  phase: Phase;
  total: number;
  deliverablesLabel: string;
  /** Accent-tinted surface — used for the final phase, where the work lands. */
  feature?: boolean;
  /** Seconds before the plate's entrance starts. */
  delay?: number;
}) {
  const titleId = `phase-${p.id}-title`;

  return (
    <Reveal
      as="article"
      delay={delay}
      id={`phase-${p.id}`}
      aria-labelledby={titleId}
      className="relative flex scroll-mt-[calc(var(--nx-nav-h)+1.5rem)] rounded-[calc(var(--nx-radius-xl)+0.375rem)] bg-[color-mix(in_oklab,var(--fg)_2.5%,transparent)] p-1.5 shadow-[var(--shadow-lg)] ring-1 ring-line"
    >
      <div
        className={`flex min-w-0 flex-1 flex-col rounded-[var(--nx-radius-xl)] border ${feature ? 'nx-card-feature' : 'border-line bg-surface'} p-[clamp(1.5rem,3.4vw,3.25rem)] dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.05)] md:max-lg:grid md:max-lg:grid-cols-12 md:max-lg:gap-x-10`}
      >
        {/* Identity */}
        <div className="flex flex-col md:max-lg:col-span-5 md:max-lg:justify-between">
          <div className="flex items-start justify-between gap-6">
            <PhaseNumeral value={p.id} className="text-[clamp(5.5rem,12vw,8.5rem)] leading-[0.78] tracking-[-0.06em]" />
            <span className="nx-mono select-none pt-1 text-[0.6875rem] uppercase tabular-nums tracking-[0.14em] text-fg-3" aria-hidden>
              {p.id} / {String(total).padStart(2, '0')}
            </span>
          </div>

          <div className="mt-10">
            <Eyebrow className="text-accent-text">{p.subtitle}</Eyebrow>
            <SplitWords as="h2" id={titleId} className="nx-h2 mt-4">
              {p.title}
            </SplitWords>
            <p className="nx-mono mt-8 flex items-center gap-2.5 border-t border-line pt-5 text-[0.8125rem] uppercase tabular-nums tracking-[0.1em] text-fg-2">
              <ClockIcon size={14} weight="regular" aria-hidden className="shrink-0" />
              {p.duration}
            </p>
          </div>
        </div>

        {/* Detail: the deliverables rest on the plate's bottom edge, so the lists line up across a row. */}
        <div className="mt-8 flex flex-1 flex-col md:max-lg:col-span-7 md:max-lg:mt-0">
          <p className="nx-lede max-w-[38rem]">{p.body}</p>

          <div className="mt-auto pt-10">
            <Eyebrow as="h3" className="mb-4">
              {deliverablesLabel}
            </Eyebrow>
            <Stagger as="ol" each={0.05} className="border-t border-line">
              {p.deliverables.map((d, i) => (
                <StaggerItem as="li" key={d} className="flex items-baseline gap-4 border-b border-line py-3.5">
                  <span className="nx-mono w-5 shrink-0 text-[0.6875rem] tabular-nums text-fg-3" aria-hidden>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="text-[1rem] leading-snug text-fg">{d}</span>
                </StaggerItem>
              ))}
            </Stagger>
          </div>
        </div>
      </div>
    </Reveal>
  );
}
