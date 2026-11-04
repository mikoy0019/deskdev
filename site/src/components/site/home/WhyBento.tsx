import type { CSSProperties, ReactNode } from 'react';
import { CheckIcon } from '@phosphor-icons/react/ssr';
import { BreathingDot, LoopingPop, Stagger, StaggerItem } from '@/components/site/motion';
import { AfterHoursFeed } from './AfterHoursFeed';
import { Bezel } from './Bezel';
import { LoopRegion } from './LoopRegion';
import styles from './home.module.css';

export interface WhyItem {
  n: string;
  title: string;
  body: string;
}

/** Marks a mockup whose sentences or figures are illustrative. */
function SampleTag({ children = 'Sample data' }: { children?: ReactNode }) {
  return <span className="nx-mono text-[0.6875rem] uppercase tracking-[0.14em] text-fg-3">{children}</span>;
}

/* The numeral is the plate's index, not its headline: the visual owns the plate. */
const numeral = 'nx-numeral block text-[clamp(2.25rem,3.5vw,3.25rem)]';

/* ── Senior: you talk to the people doing the work; one line, nobody in between. ── */
function DirectLine() {
  const node = 'nx-mono shrink-0 rounded-full px-3.5 py-2 text-[0.6875rem] uppercase tracking-[0.12em] sm:px-5 sm:py-3 sm:text-[0.8125rem]';
  return (
    <div>
      <LoopRegion className="flex items-center gap-3 sm:gap-5">
        <span className={`${node} border border-line-2 text-fg-2`}>You</span>
        <span className="relative h-px flex-1 bg-line-2">
          <span className={`nx-kit-loop ${styles.signal}`} />
        </span>
        <span className={`${node} border border-[color-mix(in_oklab,var(--accent)_45%,var(--line))] bg-accent-soft text-accent-text`}>Senior team</span>
      </LoopRegion>
      <p className="nx-mono mt-5 text-center text-[0.6875rem] uppercase tracking-[0.12em] text-fg-3 sm:text-xs">
        <span className="line-through decoration-fg-3">Account manager</span> · direct line
      </p>
    </div>
  );
}

/* ── 14 days: the days fill in sequence and the last one goes live. ── */
function LaunchTimeline() {
  const days = Array.from({ length: 14 }, (_, i) => i);
  return (
    <div>
      <LoopRegion aria-hidden className="grid grid-cols-[repeat(14,minmax(0,1fr))] gap-1">
        {days.map((i) => (
          <span
            key={i}
            className={`nx-kit-loop ${styles.day} ${i === days.length - 1 ? styles.dayLast : ''} h-12 sm:h-14`}
            style={{ '--i': i } as CSSProperties}
          />
        ))}
      </LoopRegion>
      <div className="nx-mono mt-3 flex items-center justify-between text-[0.6875rem] uppercase tracking-[0.12em] text-fg-3">
        <span>Day 01</span>
        <span className="inline-flex items-center gap-2 text-fg-2">
          <BreathingDot /> Day 14 · Live
        </span>
      </div>
    </div>
  );
}

/* ── Yours: everything sits on your own accounts. Static: nothing to explain by moving. ── */
function OwnershipList() {
  return (
    <ul className="divide-y divide-line border-y border-line">
      {['Domain', 'Code', 'Content', 'Design'].map((thing) => (
        <li key={thing} className="flex items-center gap-3 py-3">
          <CheckIcon size={16} weight="regular" aria-hidden className="shrink-0 text-accent-text" />
          <span className="flex-1 text-[0.9375rem] font-medium text-fg">{thing}</span>
          <span className="nx-mono text-[0.6875rem] uppercase tracking-[0.12em] text-fg-3">Your account</span>
        </li>
      ))}
    </ul>
  );
}

/* ── 1:1: a real person on the other end, and the reply lands. ── */
function ReplyThread() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="nx-mono inline-flex items-center gap-2 text-[0.6875rem] uppercase tracking-[0.12em] text-fg-2">
          <BreathingDot /> Team online
        </span>
        <SampleTag>Sample thread</SampleTag>
      </div>
      <p className="max-w-[85%] self-start rounded-2xl rounded-bl-md border border-line bg-bg-2 px-4 py-2.5 text-[0.9375rem] leading-snug text-fg sm:px-5 sm:py-3 sm:text-[1.0625rem]">
        Can we move the launch review to Thursday?
      </p>
      <div className="relative mt-6 max-w-[85%] self-end">
        <p className="rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-[0.9375rem] leading-snug text-accent-fg sm:px-5 sm:py-3 sm:text-[1.0625rem]">Thursday at 10 works. Invite sent.</p>
        <LoopingPop className="absolute bottom-full right-1 mb-1.5" origin="bottom right">
          <span className="nx-mono inline-flex h-6 items-center rounded-full border border-line-2 bg-surface px-2.5 text-[0.625rem] uppercase tracking-[0.12em] text-fg-2 shadow-[var(--shadow-sm)]">
            Replied in 6 min
          </span>
        </LoopingPop>
      </div>
    </div>
  );
}

/* ── ROI: booked calls, week over week. Bars rise once as the chart arrives. ── */
const WEEKS = [24, 31, 28, 39, 46, 43, 58, 71];
function BookedCallsChart() {
  return (
    <figure className="flex h-full flex-col">
      {/* The chart takes whatever height the row gives the plate, so a taller
          neighbour makes a taller chart rather than a void above a short one. */}
      <Stagger as="ol" each={0.05} className="flex min-h-28 flex-1 items-end gap-1.5">
        {WEEKS.map((h, i) => (
          <StaggerItem
            key={i}
            as="li"
            distance={12}
            className={`${styles.bar} ${i === WEEKS.length - 1 ? styles.barPeak : ''} flex-1`}
            style={{ '--h': `${h}%` } as CSSProperties}
          />
        ))}
      </Stagger>
      <figcaption className="mt-3 flex items-center justify-between gap-3">
        <span className="nx-mono text-[0.6875rem] uppercase tracking-[0.12em] text-fg-2">Booked calls / week</span>
        <SampleTag />
      </figcaption>
    </figure>
  );
}

/* ── 24/7: automations firing for a lead after hours. ── */
function AfterHours() {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="nx-mono inline-flex items-center gap-2 text-[0.6875rem] uppercase tracking-[0.12em] text-fg-2">
          <BreathingDot /> Automations running
        </span>
        <SampleTag>Sample activity</SampleTag>
      </div>
      <AfterHoursFeed />
    </div>
  );
}

/* Cell layout per item (same order as the data): the index numeral on top, the
   visual centred in the rest of the plate (`fill` visuals stretch to it
   instead). Spans zig-zag 7/5, 5/7, 4/8 so no row is three equal cards. */
const CELLS: { span: string; fill?: boolean; accent?: boolean; visual: ReactNode }[] = [
  { span: 'md:col-span-2 lg:col-span-7', accent: true, visual: <DirectLine /> },
  { span: 'lg:col-span-5', visual: <LaunchTimeline /> },
  { span: 'lg:col-span-5', visual: <OwnershipList /> },
  { span: 'lg:col-span-7', visual: <ReplyThread /> },
  { span: 'lg:col-span-4', fill: true, visual: <BookedCallsChart /> },
  { span: 'md:col-span-2 lg:col-span-8', visual: <AfterHours /> },
];

/**
 * "Why NixGen" as a Bento 2.0 gallery: each claim gets a plate that shows it
 * (the visual lives in a double-bezel tray; title and body sit beneath it).
 * Loops run only where they explain something (a signal on the direct line,
 * the 14 days filling, a reply landing, automations firing); the ownership
 * list and the chart stay still.
 */
export function WhyBento({ items }: { items: WhyItem[] }) {
  return (
    <Stagger as="ul" each={0.06} className="grid gap-x-5 gap-y-12 md:grid-cols-2 lg:grid-cols-12 lg:gap-y-14">
      {items.map((item, i) => {
        const cell = CELLS[i % CELLS.length];
        return (
          <StaggerItem key={item.title} as="li" className={`flex flex-col ${cell.span}`}>
            <Bezel accent={cell.accent} hover className="flex-1" coreClassName="p-6 sm:p-8">
              <div className="flex h-full flex-col gap-7 sm:gap-8">
                <span className={`${numeral} ${i === 0 ? 'text-accent-text' : ''}`}>{item.n}</span>
                {/* Illustrative mockup: the claim itself is the title and body below. */}
                <div aria-hidden className={`min-w-0 ${cell.fill ? 'flex-1' : 'my-auto'}`}>
                  {cell.visual}
                </div>
              </div>
            </Bezel>
            <div className="mt-5 px-1 sm:px-2">
              <h3 className="nx-h4">{item.title}</h3>
              <p className="nx-body mt-1.5 max-w-[42ch] text-[0.9375rem]">{item.body}</p>
            </div>
          </StaggerItem>
        );
      })}
    </Stagger>
  );
}
