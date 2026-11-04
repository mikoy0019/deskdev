import { Stagger, StaggerItem } from '@/components/site/motion';
import type { StackGroup } from './types';

/**
 * The stack as a colophon: one hairline row per discipline, with the index and
 * label on the left and the tools set large on the right in their own casing.
 * Dots separate the tools because some names contain a slash.
 */
export function StackList({ groups }: { groups: StackGroup[] }) {
  return (
    <Stagger className="border-t border-line-2" each={0.08}>
      {groups.map((g, i) => (
        <StaggerItem
          key={g.label}
          className="grid gap-x-10 gap-y-4 border-b border-line py-7 md:py-9 lg:grid-cols-12 lg:items-baseline"
        >
          <div className="flex items-baseline gap-4 lg:col-span-3">
            <span className="nx-mono w-6 shrink-0 text-xs tabular-nums text-accent-text" aria-hidden>
              {String(i + 1).padStart(2, '0')}
            </span>
            <h3 className="nx-h4 text-[1.3125rem]">{g.label}</h3>
          </div>
          {/* The ul hangs 1.2em left of this clip box, so the dot that leads each
              tool is cut off whenever that tool starts a line: no stray dots. */}
          <div className="overflow-hidden lg:col-span-9">
            <ul className="-ml-[1.2em] flex flex-wrap gap-y-1 font-heading text-[clamp(1.125rem,1.75vw,1.5rem)] font-medium leading-[1.35] tracking-[-0.02em] text-fg-2">
              {g.items.map((item) => (
                <li
                  key={item}
                  className="relative pl-[1.2em] before:absolute before:left-[0.5em] before:top-[0.68em] before:size-[0.2em] before:-translate-y-1/2 before:rounded-full before:bg-fg-3 before:content-['']"
                >
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </StaggerItem>
      ))}
    </Stagger>
  );
}
