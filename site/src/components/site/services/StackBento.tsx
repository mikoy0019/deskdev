'use client';

import { createContext, memo, useContext, useState, type ReactNode } from 'react';
import { ArrowDownIcon, ArrowElbowDownLeftIcon, ChatCenteredTextIcon, CheckCircleIcon, PauseIcon, PlayIcon } from '@phosphor-icons/react';
import { AutoSortList, BreathingDot, InfiniteCarousel, LoopingPop, Reveal, Typewriter } from '@/components/site/motion';

/** One tile's caption: the capability it illustrates (links to its section) and one line on what it shows. */
export interface StackTile {
  anchor: 'conversion' | 'automation' | 'operations' | 'dashboards';
  title: string;
  caption: string;
}


/*
 * Illustration content. Every name and figure here is invented sample data and
 * every mockup carries the `sample` tag; the mockups are aria-hidden (the
 * captions say what each one shows).
 */
const LEADS = [
  { id: 'ortega', name: 'Ortega Roofing', kind: 'Quote', to: 'Sales' },
  { id: 'halden', name: 'Halden Dental', kind: 'Callback', to: 'Desk' },
  { id: 'brightwater', name: 'Brightwater Pools', kind: 'Booking', to: 'Calendar' },
  { id: 'marsh', name: 'Marsh & Rye Bakery', kind: 'Question', to: 'Inbox' },
];
/** Short enough to stay on one line in the narrowest tile (the caret follows the text). */
const PROMPTS = ['Follow up on Tuesday’s quotes', 'Summarise this week’s calls', 'Flag leads with no reply'];
const DRAFTS = ['Follow-up drafted · Ortega Roofing', 'Follow-up drafted · Halden Dental', 'Scorecard ready for Monday'];
const KPIS = [
  { label: 'Quote requests', value: '38', delta: '+9 vs last week' },
  { label: 'Median reply', value: '47s', delta: 'automated' },
  { label: 'Booked calls', value: '12', delta: '+3 vs last week' },
  { label: 'Close rate', value: '31.4%', delta: '+2.6 pts' },
  { label: 'Organic sessions', value: '2,184', delta: '+412' },
  { label: 'Cost per lead', value: '$18.70', delta: '−$4.15' },
];
const BARS = [18, 27, 22, 38, 31, 46, 41, 58, 52, 72, 64, 92];

/** Static stand-in for BreathingDot while motion is paused. */
function StillDot({ tone = 'live' }: { tone?: 'live' | 'accent' }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${tone === 'live' ? 'bg-[var(--nx-kit-live)]' : 'bg-accent'}`}
    />
  );
}

function Dot({ paused, tone }: { paused: boolean; tone?: 'live' | 'accent' }) {
  return paused ? <StillDot tone={tone} /> : <BreathingDot tone={tone} />;
}

const MONO_LABEL = 'nx-mono text-[0.6875rem] uppercase tracking-[0.12em]';

/* ── Mockups ─────────────────────────────────────────────────────────── */

const ToastCard = (
  <span className="inline-flex items-center gap-2 rounded-xl bg-fg px-3.5 py-2.5 text-[0.8125rem] font-medium text-bg shadow-[var(--shadow-md)]">
    <CheckCircleIcon size={16} aria-hidden className="shrink-0" />
    Quote request received
  </span>
);

const SiteMockup = memo(function SiteMockup({ paused }: { paused: boolean }) {
  const field = (label: string, value: string) => (
    <div className="grid gap-1">
      <span className="text-[0.6875rem] text-fg-3">{label}</span>
      <span className="rounded-lg border border-line bg-surface px-3 py-2 text-[0.8125rem] text-fg">{value}</span>
    </div>
  );
  return (
    <>
      {/*
        A picture of a form, not a form: it ignores the pointer, and the button is
        a quiet outline so it can't be mistaken for the page's own primary CTA.
        Below `sm` the notice gets its own row under the sample tag (side by side
        they collide), so the window starts lower and drops its third field.
      */}
      <div className="pointer-events-none absolute inset-x-6 bottom-0 top-[6.75rem] select-none rounded-t-2xl border border-b-0 border-line bg-bg-2 sm:inset-x-8 sm:top-[4.25rem]">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className={`${MONO_LABEL} text-fg-3`}>Request a quote</span>
          <span className={`${MONO_LABEL} inline-flex items-center gap-2 text-fg-2`}>
            <Dot paused={paused} />
            Live
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 p-4">
          {field('Name', 'Dana Ortega')}
          {field('Service', 'Roof repair')}
          <div className="col-span-2 max-sm:hidden">{field('When', 'This week, mornings')}</div>
        </div>
        <span className="mx-4 inline-flex h-8 items-center rounded-full border border-[color-mix(in_oklab,var(--accent)_45%,var(--line))] bg-accent-soft px-3.5 text-[0.8125rem] font-medium text-accent-text">
          Send request
        </span>
      </div>
      <span className="pointer-events-none absolute right-6 top-[3.5rem] sm:right-7 sm:top-6">
        {paused ? ToastCard : <LoopingPop origin="top right">{ToastCard}</LoopingPop>}
      </span>
    </>
  );
});

const LEAD_ROW = 'flex items-center justify-between gap-3 rounded-xl border border-line bg-bg-2 px-4 py-2.5 transition-[background-color,border-color] duration-300 ease-[ease]';
const LEAD_LIST = 'mt-4 grid gap-2 [&>li:first-child]:border-[color-mix(in_oklab,var(--accent)_45%,var(--line))] [&>li:first-child]:bg-accent-soft';

const leadContent = (l: (typeof LEADS)[number]) => (
  <>
    <span className="truncate text-[0.9375rem] font-medium text-fg">{l.name}</span>
    <span className={`${MONO_LABEL} shrink-0 text-[0.625rem] text-fg-3`}>
      <span className="hidden sm:inline">{l.kind} </span>→ {l.to}
    </span>
  </>
);
const LEAD_ITEMS = LEADS.map((l) => ({ id: l.id, content: leadContent(l) }));

const QueueMockup = memo(function QueueMockup({ paused }: { paused: boolean }) {
  return (
    <>
      <div className="mt-5 flex items-center justify-between">
        <span className={`${MONO_LABEL} text-fg-2`}>Lead queue</span>
        <span className={`${MONO_LABEL} inline-flex items-center gap-2 text-fg-3`}>
          <Dot paused={paused} tone="accent" />
          Ranking
        </span>
      </div>
      {paused ? (
        <ul className={LEAD_LIST}>
          {LEAD_ITEMS.map((i) => (
            <li key={i.id} className={LEAD_ROW}>
              {i.content}
            </li>
          ))}
        </ul>
      ) : (
        <AutoSortList items={LEAD_ITEMS} interval={2800} className={LEAD_LIST} itemClassName={LEAD_ROW} />
      )}
    </>
  );
});

const AssistantMockup = memo(function AssistantMockup({ paused }: { paused: boolean }) {
  return (
    <>
      <div className="mt-5 flex items-center justify-between">
        <span className={`${MONO_LABEL} text-fg-2`}>Assistant</span>
        <span className={`${MONO_LABEL} inline-flex items-center gap-2 text-fg-3`}>
          <Dot paused={paused} tone="accent" />
          Drafting
        </span>
      </div>
      <div className="mt-4 flex h-12 items-center gap-3 rounded-xl border border-line bg-bg-2 px-4">
        <ChatCenteredTextIcon size={16} aria-hidden className="shrink-0 text-accent-text" />
        <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-[0.875rem] text-fg sm:text-[0.9375rem]">
          {paused ? PROMPTS[0] : <Typewriter phrases={PROMPTS} />}
        </span>
        <span className="hidden h-6 w-6 shrink-0 place-items-center rounded-md border border-line text-fg-3 sm:grid">
          <ArrowElbowDownLeftIcon size={12} aria-hidden />
        </span>
      </div>
      <ul className="mt-5 grid gap-2.5">
        {DRAFTS.map((d) => (
          <li key={d} className="flex items-center gap-2.5 text-[0.875rem] text-fg-2">
            <CheckCircleIcon size={16} aria-hidden className="shrink-0 text-accent-text" />
            {d}
          </li>
        ))}
      </ul>
    </>
  );
});

const KPI_CARDS = KPIS.map((k) => (
  <span key={k.label} className="grid w-[10.5rem] gap-2 rounded-xl border border-line bg-bg-2 p-4">
    <span className={`${MONO_LABEL} text-[0.625rem] text-fg-3`}>{k.label}</span>
    <span className="nx-numeral text-[1.75rem]">{k.value}</span>
    <span className="text-[0.75rem] tabular-nums text-accent-text">{k.delta}</span>
  </span>
));

const PanelMockup = memo(function PanelMockup({ paused }: { paused: boolean }) {
  return (
    <>
      <div className="mt-5 flex items-center justify-between">
        <span className={`${MONO_LABEL} text-fg-2`}>This week</span>
        <span className={`${MONO_LABEL} inline-flex items-center gap-2 text-fg-3`}>
          <Dot paused={paused} />
          Synced
        </span>
      </div>
      {/* Fixed-height window: the reduced-motion carousel wraps into a static list, so clip it to one row. */}
      <div className="-mx-6 mt-5 h-[7.25rem] overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_7%,#000_93%,transparent)] sm:-mx-8">
        {paused ? (
          <div className="flex gap-4 overflow-hidden px-6 sm:px-8">{KPI_CARDS}</div>
        ) : (
          <InfiniteCarousel items={KPI_CARDS} pauseControl="none" duration={48} />
        )}
      </div>
      {/* Takes the height left under the carousel; the percentages resolve against it (no padding inside). */}
      <div className="mt-4 flex min-h-12 flex-1 items-end gap-1.5 border-b border-line">
        {BARS.map((h, i) => (
          <span
            key={i}
            className={`flex-1 rounded-t-sm ${i === BARS.length - 1 ? 'bg-accent' : 'bg-[color-mix(in_oklab,var(--fg)_12%,transparent)]'}`}
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
    </>
  );
});

const MOCKUPS: Record<StackTile['anchor'], typeof SiteMockup> = {
  conversion: SiteMockup,
  automation: QueueMockup,
  operations: AssistantMockup,
  dashboards: PanelMockup,
};

/** Asymmetric 7/5 then 5/7 rows from `lg`; one column below. */
const SPANS = ['lg:col-span-7', 'lg:col-span-5', 'lg:col-span-5', 'lg:col-span-7'];

/**
 * Each tile reveals on its own when it reaches the viewport: the grid is taller
 * than the screen, so one group stagger would play the lower tiles unseen. The
 * second tile of a desktop row trails the first by 80ms.
 */
function Tile({ tile, span, delay, sample, children }: { tile: StackTile; span: string; delay: number; sample: string; children: ReactNode }) {
  return (
    <Reveal as="li" delay={delay} className={`min-w-0 ${span}`}>
      <figure className="flex h-full flex-col">
        <div className="rounded-[2rem] bg-[color-mix(in_oklab,var(--fg)_3%,transparent)] p-1.5 shadow-[var(--shadow-md)] ring-1 ring-line">
          <div className="relative flex h-[21rem] flex-col overflow-hidden rounded-[calc(2rem-0.375rem)] bg-surface p-6 shadow-[inset_0_1px_0_color-mix(in_oklab,var(--fg)_6%,transparent)] sm:p-8">
            <span className={`${MONO_LABEL} inline-flex self-start rounded-full border border-line px-2.5 py-1 text-[0.625rem] text-fg-3`}>{sample}</span>
            <div aria-hidden className="flex min-h-0 flex-1 flex-col">
              {children}
            </div>
          </div>
        </div>
        <figcaption className="mt-4 px-2">
          <a
            href={`#${tile.anchor}`}
            className="group inline-flex min-h-11 touch-manipulation items-center gap-2 font-heading text-[1.125rem] font-medium tracking-[-0.012em] text-fg transition-colors duration-200 ease-[ease] [-webkit-tap-highlight-color:transparent] hover:text-accent-text active:text-accent-text"
          >
            {tile.title}
            <ArrowDownIcon
              size={15}
              aria-hidden
              className="text-fg-3 [transition:translate_200ms_var(--ease-out),color_200ms_ease] group-hover:text-accent-text motion-safe:[@media(hover:hover)_and_(pointer:fine)]:group-hover:translate-y-0.5"
            />
          </a>
          <p className="nx-body max-w-[46ch] text-pretty text-[0.9375rem]">{tile.caption}</p>
        </figcaption>
      </figure>
    </Reveal>
  );
}

const PausedContext = createContext<{ paused: boolean; toggle: () => void }>({ paused: false, toggle: () => {} });

/** Shares one paused flag between the Pause control (in the section header) and the tiles. */
export function StackMotionScope({ children }: { children: ReactNode }) {
  const [paused, setPaused] = useState(false);
  return <PausedContext.Provider value={{ paused, toggle: () => setPaused((p) => !p) }}>{children}</PausedContext.Provider>;
}

/**
 * Stops every loop in the section at once (WCAG 2.2.2: moving content that
 * runs longer than five seconds needs a pause). The label says what a press
 * does next, so it carries no aria-pressed.
 */
export function StackPauseButton({ pause, play }: { pause: string; play: string }) {
  const { paused, toggle } = useContext(PausedContext);
  return (
    <button
      type="button"
      onClick={toggle}
      className={`${MONO_LABEL} nx-press inline-flex min-h-11 items-center gap-2 self-start rounded-full px-4 text-fg-2 ring-1 ring-line [transition:scale_var(--dur-press)_var(--ease-out),color_200ms_ease,box-shadow_200ms_ease] hover:text-fg hover:ring-line-2 motion-reduce:active:scale-100`}
    >
      {paused ? <PlayIcon size={14} aria-hidden /> : <PauseIcon size={14} aria-hidden />}
      {paused ? play : pause}
    </button>
  );
}

/**
 * Bento 2.0 for /services: four of the systems shown working on the same
 * inbound lead — a quote form that pops a "received" notice, a lead queue that
 * keeps re-ranking itself, an assistant cycling through requests, and a metrics
 * stream. Each loop is the motion kit's memoised, off-screen-paused primitive;
 * <StackPauseButton> stops all of them at once, and reduced motion shows each
 * one still. Render inside <StackMotionScope>.
 */
export function StackBento({ tiles, sample }: { tiles: StackTile[]; sample: string }) {
  const { paused } = useContext(PausedContext);
  return (
    <ul className="grid grid-cols-1 gap-x-5 gap-y-12 lg:grid-cols-12">
      {tiles.map((t, i) => {
        const Mockup = MOCKUPS[t.anchor];
        return (
          <Tile key={t.anchor} tile={t} span={SPANS[i] ?? 'lg:col-span-6'} delay={(i % 2) * 0.08} sample={sample}>
            <Mockup paused={paused} />
          </Tile>
        );
      })}
    </ul>
  );
}
