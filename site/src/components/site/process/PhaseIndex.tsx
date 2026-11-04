import type { Phase } from './types';

/**
 * Hero aside on /process: the four phases as a compact schedule — index,
 * name, focus and how long each one takes — read top to bottom like a timeline.
 * Double-bezel (hairline tray + inset plate). The final phase, where the work
 * goes live, is marked by colour alone (a static accent dot): the schedule is
 * not live state, so nothing here loops.
 */
export function PhaseIndex({ phases, label }: { phases: Phase[]; label: string }) {
  return (
    <div className="rounded-[calc(var(--nx-radius-lg)+0.375rem)] bg-[color-mix(in_oklab,var(--fg)_2.5%,transparent)] p-1.5 ring-1 ring-line">
      <ol
        aria-label={label}
        className="relative rounded-[var(--nx-radius-lg)] border border-line bg-surface px-5 py-1.5 dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.05)] before:absolute before:inset-y-7 before:left-[2.125rem] before:w-px before:bg-line-2"
      >
        {phases.map((p, i) => {
          const last = i === phases.length - 1;
          return (
            <li key={p.id} className="relative flex items-center gap-5 border-b border-line py-3.5 last:border-b-0">
              <span className="relative grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line-2 bg-surface">
                <span className={`h-1.5 w-1.5 rounded-full ${last ? 'bg-accent' : 'bg-fg-3'}`} aria-hidden />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-baseline gap-3">
                  <span className="nx-mono text-xs tabular-nums text-accent-text">{p.id}</span>
                  <span className="font-heading text-[1.0625rem] font-medium tracking-[-0.012em] text-fg">{p.title}</span>
                </span>
                <span className="nx-small mt-0.5">{p.subtitle}</span>
              </span>
              <span className="nx-mono shrink-0 text-[0.75rem] uppercase tabular-nums tracking-[0.08em] text-fg-2">{p.duration}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
