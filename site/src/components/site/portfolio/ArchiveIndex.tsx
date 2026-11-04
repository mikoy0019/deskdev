import { ArrowDownIcon } from '@phosphor-icons/react/ssr';

/**
 * Hero aside for /portfolio: the two archive sections as jump links, each
 * with its count (08 products, 80 sites).
 *
 * Hover is colour only, plus a 2px arrow nudge for a mouse or trackpad (touch
 * would leave it stuck after the tap). Touch gets an :active tint instead,
 * with the grey tap flash and the double-tap delay removed.
 */
export function ArchiveIndex({
  items,
  label,
}: {
  items: { id: string; anchor: string; title: string; count: number }[];
  label: string;
}) {
  return (
    <nav aria-label={label}>
      <ol className="border-t border-line">
        {items.map((item) => (
          <li key={item.anchor} className="border-b border-line">
            <a
              href={`#${item.anchor}`}
              className="group flex min-h-[4.5rem] touch-manipulation select-none items-center gap-5 py-4 text-fg-2 transition-colors duration-200 ease-[ease] [-webkit-tap-highlight-color:transparent] hover:text-fg focus-visible:text-fg active:text-fg"
            >
              <span
                aria-hidden
                className="nx-mono w-6 text-xs tabular-nums text-fg-3 transition-colors duration-200 ease-[ease] group-hover:text-accent-text group-active:text-accent-text"
              >
                {item.id}
              </span>
              <span className="flex-1 font-heading text-[1.0625rem] font-medium tracking-[-0.012em]">
                {item.title}
                {/* read as "In-House Products, 8" rather than "01In-House Products08" */}
                <span className="sr-only">, {item.count}</span>
              </span>
              <span
                aria-hidden
                className="nx-numeral text-[2rem] tabular-nums text-fg transition-colors duration-200 ease-[ease] group-hover:text-accent-text group-active:text-accent-text"
              >
                {String(item.count).padStart(2, '0')}
              </span>
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
