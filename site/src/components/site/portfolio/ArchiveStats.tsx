import { Counter, Stagger, StaggerItem } from '@/components/site/motion';

/**
 * The archive in four figures: a hairline-ruled row (2×2 on phones), no
 * boxes. Figures are tabular and count up when they arrive below the fold
 * (Counter: the final value is in the HTML; on-screen, reduced motion and
 * no-JS show it as is). The four cells enter 80ms apart.
 */
export function ArchiveStats({ stats }: { stats: { value: string; label: string }[] }) {
  return (
    <Stagger each={0.08} className="grid grid-cols-2 lg:grid-cols-4">
      {stats.map((stat, i) => {
        const word = stat.value.match(/^([^\d]*[\d.,]+)(\s+[A-Za-z].*)$/); // "14 days" → smaller unit
        return (
          <StaggerItem
            key={stat.label}
            className={[
              'flex flex-col gap-3 py-10 md:py-14',
              i % 2 === 1 ? 'border-l border-line pl-5 sm:pl-8' : 'pr-5 sm:pr-8',
              i >= 2 ? 'border-t border-line lg:border-t-0' : '',
              i === 2 ? 'lg:border-l lg:pl-8' : '',
            ].join(' ')}
          >
            <span className="nx-numeral whitespace-nowrap text-[clamp(3rem,6vw,5.25rem)]">
              {word ? (
                <>
                  <Counter value={word[1]} />
                  <span className="ml-[0.18em] text-[0.38em] font-normal tracking-normal text-fg-2">{word[2].trim()}</span>
                </>
              ) : (
                <Counter value={stat.value} />
              )}
            </span>
            <span className="nx-eyebrow">{stat.label}</span>
          </StaggerItem>
        );
      })}
    </Stagger>
  );
}
