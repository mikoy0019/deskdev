import { BreathingDot, Stagger, StaggerItem } from '@/components/site/motion';
import { outlineStrongClass, type Milestone } from './types';

/**
 * Journey timeline.
 *  - Phones/tablets: a hairline spine on the left with a dot per milestone,
 *    each year above its copy.
 *  - Desktop (lg+): a horizontal rail — four columns, the year numerals over a
 *    hairline with a dot per milestone, copy underneath. The rail runs on past
 *    the latest year in accent, fading out: the journey isn't finished.
 * The latest year is solid accent and its dot breathes (the current chapter);
 * earlier ones are outlined. Milestones enter left to right, 80ms apart.
 */
export function Timeline({ items }: { items: Milestone[] }) {
  return (
    <Stagger as="ol" className="grid lg:grid-cols-4 lg:gap-x-8" each={0.08}>
      {items.map((t, i) => {
        const first = i === 0;
        const last = i === items.length - 1;
        return (
          <StaggerItem as="li" key={t.year} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-5 lg:flex lg:flex-col">
            {/* Year */}
            <p
              className={`nx-numeral col-start-2 row-start-1 pb-4 text-[clamp(3.5rem,12vw,5.5rem)] leading-[0.82] tracking-[-0.055em] lg:pb-0 lg:text-[clamp(4rem,6vw,6rem)] ${
                last ? 'text-accent-text' : outlineStrongClass
              }`}
            >
              {t.year}
            </p>

            {/* Rail + dot */}
            <div className="relative col-start-1 row-span-2 row-start-1 lg:my-9 lg:h-3" aria-hidden>
              {/* vertical spine (below lg) */}
              <span
                className={`absolute left-1/2 w-px -translate-x-1/2 bg-line-2 lg:hidden ${first ? 'top-5' : 'top-0'} ${last ? 'h-5' : 'bottom-0'}`}
              />
              {/* horizontal rail (lg+): to the next dot, or fading out after the last */}
              <span
                className={`absolute left-0 top-1/2 hidden h-px -translate-y-1/2 lg:block ${
                  last
                    ? 'w-full bg-[linear-gradient(90deg,var(--accent),transparent)]'
                    : 'w-[calc(100%+2rem)] bg-line-2'
                }`}
              />
              {last ? (
                <BreathingDot
                  tone="accent"
                  className="absolute left-1/2 top-5 size-3 -translate-x-1/2 -translate-y-1/2 ring-[6px] ring-accent-soft lg:left-1.5 lg:top-1/2"
                />
              ) : (
                <span className="absolute left-1/2 top-5 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-line-2 bg-bg lg:left-1.5 lg:top-1/2" />
              )}
            </div>

            {/* Copy */}
            <div className={`col-start-2 row-start-2 ${last ? '' : 'pb-14 lg:pb-0'} lg:pr-4`}>
              <h3 className="nx-h3">{t.title}</h3>
              <p className="nx-body mt-3 max-w-[30rem]">{t.body}</p>
            </div>
          </StaggerItem>
        );
      })}
    </Stagger>
  );
}
