import { PhasePanel } from './PhasePanel';
import type { Phase } from './types';

/**
 * The four phases of /process as a plain grid: one column on phones and
 * tablets, two by two from lg. The page scrolls straight down like every other
 * page on the site; nothing is pinned and nothing moves sideways. Each panel
 * rises in as it reaches the viewport (see PhasePanel), the right column a
 * beat after the left.
 */
export function PhaseTrack({ phases, label, deliverablesLabel }: { phases: Phase[]; label: string; deliverablesLabel: string }) {
  return (
    <section id="phases" aria-label={label} className="relative border-t border-line py-[clamp(3rem,7vw,6rem)]">
      <div className="nx-wrap grid gap-5 lg:grid-cols-2 lg:gap-6">
        {phases.map((p, i) => (
          <PhasePanel
            key={p.id}
            phase={p}
            total={phases.length}
            deliverablesLabel={deliverablesLabel}
            feature={i === phases.length - 1}
            delay={(i % 2) * 0.06}
          />
        ))}
      </div>
    </section>
  );
}
