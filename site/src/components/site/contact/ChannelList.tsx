import { ArrowDownIcon, ArrowUpRightIcon } from '@phosphor-icons/react/ssr';
import { StaggerItem } from '@/components/site/motion';
import type { Channel } from './types';

// The arrow's hover nudge is movement: mouse/trackpad only, and never under reduced motion.
const nudgeDown = '[@media(hover:hover)_and_(pointer:fine)_and_(prefers-reduced-motion:no-preference)]:group-hover:translate-y-0.5';
const nudgeOut =
  '[@media(hover:hover)_and_(pointer:fine)_and_(prefers-reduced-motion:no-preference)]:group-hover:translate-x-0.5 [@media(hover:hover)_and_(pointer:fine)_and_(prefers-reduced-motion:no-preference)]:group-hover:-translate-y-0.5';

/**
 * The studio's direct lines as a hairline-ruled definition list: mono label,
 * large value. Links (mailto:, tel:, an in-page #anchor) keep their hrefs and
 * end in a nested icon island: up-right for a line that leaves the page, down
 * for one that stays on it. A row without an href is a plain fact. `shownInHero` names the row the hero readout already shows:
 * below lg the readout sits right above this list, so that row steps aside
 * there instead of repeating.
 *
 * Rows are StaggerItems: inside the page's <Stagger> they enter in sequence,
 * anywhere else they render plainly.
 *
 * Interaction (Emil): colour answers hover with `ease` (200ms); the arrow's
 * 2px nudge is movement, so it only runs for a mouse/trackpad; the island
 * presses to 0.95 in 140ms on pointer-down.
 */
export function ChannelList({ channels, shownInHero }: { channels: Channel[]; shownInHero?: string }) {
  return (
    <dl className="border-t border-line">
      {channels.map((c) => {
        const inPage = c.href?.startsWith('#');
        const Icon = inPage ? ArrowDownIcon : ArrowUpRightIcon;
        const value = (
          <span className="min-w-0 font-heading text-[clamp(1.3rem,1.85vw,1.625rem)] font-medium leading-tight tracking-[-0.022em] [overflow-wrap:anywhere]">
            {c.value}
          </span>
        );
        return (
          <StaggerItem key={c.label} className={`border-b border-line py-4 ${c.label === shownInHero ? 'max-lg:hidden' : ''}`}>
            <dt className="nx-eyebrow">{c.label}</dt>
            <dd className="mt-2">
              {c.href ? (
                <a
                  href={c.href}
                  className="group flex min-h-11 touch-manipulation items-center justify-between gap-6 text-fg [-webkit-tap-highlight-color:transparent] transition-colors duration-200 ease-[ease] hover:text-accent-text focus-visible:text-accent-text"
                >
                  {value}
                  <span
                    aria-hidden
                    className="grid size-10 shrink-0 place-items-center rounded-full border border-line-2 text-fg-2 [transition:background-color_200ms_ease,border-color_200ms_ease,color_200ms_ease,scale_var(--dur-press)_var(--ease-out)] group-hover:border-accent group-hover:bg-accent group-hover:text-accent-fg group-focus-visible:border-accent group-focus-visible:bg-accent group-focus-visible:text-accent-fg group-active:scale-95"
                  >
                    <Icon size={16} className={`transition-[translate] duration-200 ease-out ${inPage ? nudgeDown : nudgeOut}`} />
                  </span>
                </a>
              ) : (
                <span className="flex min-h-11 items-center text-fg">{value}</span>
              )}
            </dd>
          </StaggerItem>
        );
      })}
    </dl>
  );
}
