import type { ReactNode } from 'react';
import { CheckIcon } from '@phosphor-icons/react/ssr';
import { Typewriter } from '@/components/site/motion';
import { SentNotice } from './SentNotice';
import { SprintStrip, type SprintPhase } from './SprintStrip';
import type { ValueVisual } from './types';

/**
 * Small illustrations for the values bento. Each shows the value working
 * instead of restating it, and every figure in them is marked as sample
 * data. They are pictures (aria-hidden): the title and copy under each tile
 * carry the meaning. Each has at most one quiet loop, and every loop pauses
 * off-screen.
 */

/** Header row shared by the visuals: what it is, and a "sample" tag. */
function VisualHead({ title, note = 'Sample data' }: { title: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="nx-mono text-[0.6875rem] uppercase tracking-[0.12em] text-fg-2">{title}</span>
      <span className="nx-mono shrink-0 text-[0.625rem] uppercase tracking-[0.12em] text-fg-3">{note}</span>
    </div>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return <div className="flex h-full flex-col justify-between gap-6 p-6 sm:p-7">{children}</div>;
}

/** Author mark for the work log: one studio, every entry. */
function Mark() {
  return (
    <span className="nx-mono grid size-7 shrink-0 place-items-center rounded-md bg-accent-soft text-[0.625rem] font-medium text-accent-text">
      NG
    </span>
  );
}

// Short enough for one line in a phone-width tile.
const craftDone = ['Design: booking page type scale', 'Code: quote form, inline errors'];
const craftNext = ['Automation: text back missed calls', 'Design: three hero directions', 'Code: schema for service pages'];

function CraftLog() {
  return (
    <Frame>
      <VisualHead title="Work log" note="Sample entries" />
      <ul className="flex flex-col gap-2.5 text-[0.8125rem] sm:text-[0.875rem]">
        {craftDone.map((line) => (
          <li key={line} className="flex items-center gap-3 text-fg-3">
            <Mark />
            <span className="min-w-0 flex-1 truncate">{line}</span>
            <CheckIcon size={14} className="shrink-0 text-fg-3" />
          </li>
        ))}
        <li className="flex items-center gap-3 rounded-lg bg-surface-2 py-1.5 pr-3 text-fg ring-1 ring-inset ring-line">
          <span className="pl-1.5">
            <Mark />
          </span>
          <Typewriter phrases={craftNext} className="min-w-0 flex-1" />
        </li>
      </ul>
    </Frame>
  );
}

const scoreRows = [
  { label: 'Traffic', value: '2,184', delta: '+12.6%', share: 0.82 },
  { label: 'Conversion', value: '4.7%', delta: '+0.9 pt', share: 0.47 },
  { label: 'Pipeline', value: '$18,240', delta: '+$2,310', share: 0.64 },
];

function Scorecard() {
  return (
    <Frame>
      <div className="relative">
        <VisualHead title="Weekly scorecard" />
        {/* Hangs under the header, in the tile's own free space above the
            figures: it covers nothing and reserves no row while it is away. */}
        <SentNotice className="absolute left-0 top-full mt-3">
          <span className="nx-mono inline-flex items-center gap-1.5 rounded-md bg-accent px-2 py-1 text-[0.625rem] uppercase tracking-[0.1em] text-accent-fg shadow-[var(--shadow-sm)]">
            <CheckIcon size={12} />
            Sent Monday 8:00
          </span>
        </SentNotice>
      </div>
      <dl className="flex flex-col divide-y divide-line">
        {scoreRows.map((r) => (
          <div key={r.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[6.5rem_minmax(0,1fr)_auto]">
            <dt className="text-[0.875rem] text-fg-2">{r.label}</dt>
            <dd className="hidden h-1 overflow-hidden rounded-full bg-surface-2 sm:block">
              <span className="block h-full rounded-full bg-accent-text/70" style={{ width: `${r.share * 100}%` }} />
            </dd>
            <dd className="flex items-baseline gap-3 tabular-nums">
              <span className="font-heading text-[1.0625rem] font-medium text-fg">{r.value}</span>
              <span className="nx-mono w-[4.5rem] text-right text-[0.6875rem] text-accent-text">{r.delta}</span>
            </dd>
          </div>
        ))}
      </dl>
    </Frame>
  );
}

const weeks = [9, 11, 12, 15, 17, 21, 24, 29];

function CompoundBars() {
  const max = Math.max(...weeks);
  return (
    <Frame>
      <VisualHead title="Organic leads, 8 weeks" />
      <div className="flex h-28 items-end gap-2 sm:h-32">
        {weeks.map((w, i) => {
          const last = i === weeks.length - 1;
          return (
            // The accent bar alone marks the latest week: sample figures get no "live" pulse.
            <div key={i} className="flex h-full flex-1 flex-col justify-end">
              <span
                className={`block w-full rounded-t-[0.3rem] ${last ? 'bg-accent' : 'bg-[color-mix(in_oklab,var(--fg)_14%,transparent)]'}`}
                style={{ height: `${(w / max) * 100}%` }}
              />
            </div>
          );
        })}
      </div>
    </Frame>
  );
}

const sprint: SprintPhase[] = [
  { name: 'Signal', days: 2 },
  { name: 'Compose', days: 5 },
  { name: 'Forge', days: 6 },
  { name: 'Launch', days: 1 },
];

function SprintVisual() {
  return (
    <Frame>
      <VisualHead title="14-day launch" note="Sample schedule" />
      <SprintStrip phases={sprint} />
    </Frame>
  );
}

export function ValueVisualArt({ kind }: { kind: ValueVisual }) {
  switch (kind) {
    case 'craft':
      return <CraftLog />;
    case 'scorecard':
      return <Scorecard />;
    case 'compound':
      return <CompoundBars />;
    case 'sprint':
      return <SprintVisual />;
  }
}
