import { ArrowDownIcon } from '@phosphor-icons/react/ssr';
import type { Capability } from './types';

/**
 * Compact in-page index for the /services hero: the six capability titles as
 * jump links to their sections (#conversion, #automation…). From lg up only:
 * stacked under the copy on a phone it pushed the hero past one screen, and
 * the sections follow in the same order anyway.
 *
 * Hover is colour only, plus a 2px arrow nudge for a fine pointer (touch would
 * leave it stuck after the tap). Touch gets an :active tint instead, with the
 * grey tap flash and double-tap delay removed.
 */
export function ServiceIndex({ items, label }: { items: Pick<Capability, 'id' | 'anchor' | 'title'>[]; label: string }) {
  return (
    <nav aria-label={label} className="hidden lg:block">
      <ol className="border-t border-line">
        {items.map((item) => (
          <li key={item.anchor} className="border-b border-line">
            <a
              href={`#${item.anchor}`}
              className="group flex min-h-[3.25rem] touch-manipulation items-center gap-5 py-3 text-fg-2 transition-colors duration-200 ease-[ease] [-webkit-tap-highlight-color:transparent] hover:text-fg focus-visible:text-fg active:text-fg"
            >
              <span
                aria-hidden
                className="nx-mono w-6 text-xs tabular-nums text-fg-3 transition-colors duration-200 ease-[ease] group-hover:text-accent-text group-active:text-accent-text"
              >
                {item.id}
              </span>
              <span className="flex-1 font-heading text-[1.0625rem] font-medium tracking-[-0.012em]">{item.title}</span>
              <ArrowDownIcon
                size={16}
                aria-hidden
                className="shrink-0 text-fg-3 [transition:translate_200ms_var(--ease-out),color_200ms_ease] group-hover:text-accent-text motion-safe:[@media(hover:hover)_and_(pointer:fine)]:group-hover:translate-y-0.5"
              />
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
