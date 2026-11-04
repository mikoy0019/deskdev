import type { Icon } from '@phosphor-icons/react';
import { ChartLineUpIcon, KeyIcon, LifebuoyIcon, PresentationChartIcon, SealCheckIcon, TimerIcon } from '@phosphor-icons/react/ssr';
import type { Guarantee, GuaranteeIcon } from './types';

const icons: Record<GuaranteeIcon, Icon> = {
  clock: TimerIcon, // 14-day delivery
  key: KeyIcon, // full code ownership
  chart: ChartLineUpIcon, // revenue-first design
  support: LifebuoyIcon, // post-launch support
  report: PresentationChartIcon, // weekly scorecards
  badge: SealCheckIcon, // satisfaction guarantee
};

/**
 * One promise on /process, as a line in a ledger rather than a card: hairline
 * rule, index, a small machined icon plate, the promise, and its fine print.
 * Content, not a control — no hover state, so nothing pretends to be clickable.
 *
 * Phones: plate + index on one line, then title, then body.
 * md+: index | plate | title (4 cols) | body (6 cols) on a 12-column grid.
 */
export function GuaranteeRow({ guarantee: g, index }: { guarantee: Guarantee; index: number }) {
  const Glyph = icons[g.icon];
  return (
    <article className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-5 gap-y-5 border-t border-line py-8 md:grid-cols-12 md:gap-x-8 md:py-11">
      <span
        aria-hidden
        className="col-start-2 row-start-1 justify-self-end pt-1 font-mono text-[0.6875rem] tabular-nums tracking-[0.02em] text-fg-3 md:col-span-1 md:col-start-1 md:justify-self-start md:pt-3"
      >
        {String(index + 1).padStart(2, '0')}
      </span>
      <span
        aria-hidden
        className="col-start-1 row-start-1 grid h-12 w-12 place-items-center rounded-[0.875rem] border border-line bg-surface text-accent-text dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.06)] md:col-span-1 md:col-start-2"
      >
        <Glyph size={24} weight="light" />
      </span>
      <h3 className="nx-h3 col-span-2 md:col-span-4 md:col-start-3 md:row-start-1 md:pt-1.5">{g.title}</h3>
      <p className="nx-body col-span-2 max-w-[52ch] md:col-span-6 md:col-start-7 md:row-start-1 md:pt-1.5 md:text-[1.0625rem]">{g.body}</p>
    </article>
  );
}
