import { Reveal } from '@/components/site/motion';
import { splitPrice, type AddOn } from './types';

/**
 * The add-on modules as one price list in a double-bezel tray: a hairline
 * outer shell around an inner core whose 1px gaps draw the rules between
 * entries. Two columns from `lg`, one below. Each entry reads index, title,
 * price, then what it includes — a menu, not six equal cards. Entries aren't
 * links, so they carry no hover affordance and no "+" mark.
 *
 * Each entry fades in as it reaches the viewport (the list is taller than a
 * phone screen, so a group stagger would play unseen); the right column trails
 * by 50ms where two sit side by side. Amounts share one right edge: the unit
 * ("/mo") sits in a fixed slot that stays empty on one-off prices.
 */
export function AddOnList({ items }: { items: AddOn[] }) {
  return (
    <div className="rounded-[2rem] bg-[color-mix(in_oklab,var(--fg)_3%,transparent)] p-1.5 ring-1 ring-line">
      <ul
        className="grid gap-px overflow-hidden rounded-[calc(2rem-0.375rem)] bg-line shadow-[inset_0_1px_0_color-mix(in_oklab,var(--fg)_6%,transparent)] lg:grid-cols-2">
        {items.map((a, i) => {
          const price = splitPrice(a.price);
          return (
            <Reveal
              as="li"
              key={a.title}
              variant="fade"
              delay={(i % 2) * 0.05}
              className="grid grid-cols-[auto_1fr] gap-x-5 bg-surface px-6 py-7 sm:grid-cols-[auto_1fr_auto] sm:px-8 sm:py-9"
            >
              <span aria-hidden className="nx-mono row-span-3 pt-1.5 text-[0.6875rem] sm:pt-3 tabular-nums text-fg-3 sm:row-span-2">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className="nx-h4 text-[1.1875rem] sm:pt-1.5">{a.title}</h3>
              <p className="nx-numeral mt-3 text-[clamp(1.875rem,2.6vw,2.375rem)] sm:mt-0 sm:text-right">
                {price ? (
                  <>
                    {price.amount}
                    <span className="ml-0.5 text-left text-[0.42em] font-normal tracking-normal text-fg-3 sm:inline-block sm:w-[1.75rem]">
                      {price.unit}
                    </span>
                  </>
                ) : (
                  a.price
                )}
              </p>
              <p className="nx-body mt-4 max-w-[44ch] text-pretty text-[0.9375rem] sm:col-span-2 sm:mt-5">{a.body}</p>
            </Reveal>
          );
        })}
      </ul>
    </div>
  );
}
