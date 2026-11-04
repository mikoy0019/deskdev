'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { useLoopGate } from '@/components/site/motion';

export type SprintPhase = { name: string; days: number };

/** ms each phase stays lit while the strip walks through the schedule. */
const STEP_MS = 1800;

/**
 * Day cells grouped into phases, with a legend underneath. While on screen,
 * the lit phase walks from the first to the last and starts over, so the
 * strip reads as a sequence rather than a static bar. Colour/opacity only
 * (each phase cross-fades, 300ms ease), one state update per step in this
 * leaf alone. Off-screen, in a background tab or under reduced motion the
 * walk stops and the last phase (launch day) stays lit.
 */
export const SprintStrip = memo(function SprintStrip({ phases }: { phases: readonly SprintPhase[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const running = useLoopGate(ref);
  const lastPhase = phases.length - 1;
  const [active, setActive] = useState(lastPhase);

  useEffect(() => {
    if (!running) {
      setActive(lastPhase);
      return;
    }
    // Carry on from the resting phase: the first tick wraps launch day round
    // to the first phase like any other step, with no jump on arrival.
    let step = lastPhase;
    const id = window.setInterval(() => {
      step = (step + 1) % phases.length;
      setActive(step);
    }, STEP_MS);
    return () => window.clearInterval(id);
  }, [running, lastPhase, phases.length]);

  // First day of each phase, for the legend's "D3–7" ranges.
  const starts = phases.reduce<number[]>((acc, p, i) => [...acc, i === 0 ? 1 : acc[i - 1] + phases[i - 1].days], []);
  const fade = 'transition-opacity duration-300 ease-[ease]';

  return (
    <div ref={ref} className="flex flex-col gap-5">
      <div className="grid gap-2" style={{ gridTemplateColumns: phases.map((p) => `${p.days}fr`).join(' ') }}>
        {phases.map((p, i) => (
          <div key={p.name} className="grid gap-1" style={{ gridTemplateColumns: `repeat(${p.days}, minmax(0, 1fr))` }}>
            {Array.from({ length: p.days }, (_, d) => (
              <span key={d} className="relative h-10 overflow-hidden rounded-[0.3rem] bg-surface-2 ring-1 ring-inset ring-line sm:h-12">
                <span className={`absolute inset-0 bg-accent ${fade} ${i === active ? 'opacity-100' : 'opacity-0'}`} />
              </span>
            ))}
          </div>
        ))}
      </div>
      <ol className="grid grid-cols-4 gap-3 border-t border-line pt-4">
        {phases.map((p, i) => {
          const end = starts[i] + p.days - 1;
          return (
            <li key={p.name} className="flex min-w-0 flex-col gap-1">
              <span
                className={`nx-mono text-[0.6875rem] uppercase tracking-[0.12em] transition-colors duration-300 ease-[ease] ${
                  i === active ? 'text-fg' : 'text-fg-3'
                }`}
              >
                {p.name}
              </span>
              <span className="nx-mono text-[0.6875rem] tabular-nums text-fg-3">
                D{starts[i]}
                {end > starts[i] ? `–${end}` : ''}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
});
