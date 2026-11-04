import { ArrowDownIcon } from '@phosphor-icons/react/ssr';
import type { AboutSection } from './types';

/**
 * Compact in-page index for the /about hero: each section as a jump link.
 * From lg up only: stacked under the copy on a phone it pushed the hero past
 * one screen, and the sections follow in the same order anyway.
 * Colour answers hover and press (the press snaps, the release eases); the arrow nudges toward the section it
 * points at, with a mouse or trackpad only (touch would leave it stuck after a tap).
 */
export function AboutIndex({ items, label }: { items: AboutSection[]; label: string }) {
  return (
    <nav aria-label={label} className="hidden lg:block">
      <ol className="border-t border-line">
        {items.map((item) => (
          <li key={item.anchor} className="border-b border-line">
            <a
              href={`#${item.anchor}`}
              className="group flex min-h-[3.25rem] touch-manipulation items-center gap-5 py-3 text-fg-2 transition-colors duration-200 ease-[ease] [-webkit-tap-highlight-color:transparent] hover:text-fg focus-visible:text-fg active:text-fg active:duration-0"
            >
              <span
                className="nx-mono w-6 text-xs tabular-nums text-fg-3 transition-colors duration-200 ease-[ease] group-hover:text-accent-text group-active:text-accent-text group-active:duration-0"
                aria-hidden
              >
                {item.id}
              </span>
              <span className="flex-1 font-heading text-[1.0625rem] font-medium tracking-[-0.012em]">{item.label}</span>
              <ArrowDownIcon
                size={16}
                aria-hidden
                className="shrink-0 text-fg-3 transition-[translate,color] duration-200 ease-out group-hover:text-accent-text [@media(hover:hover)_and_(pointer:fine)]:group-hover:translate-y-0.5"
              />
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
