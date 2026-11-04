import { Counter } from './motion/Counter';

/**
 * Big number + label. The markup always holds the FINAL value (so it's right
 * for crawlers, no-JS and reduced motion); the motion kit's <Counter> counts
 * the number up once if it is still below the fold when the page loads.
 * Tabular figures keep the width steady while it counts.
 */
export function Stat({
  value,
  label,
  className = '',
  size = 'lg',
}: {
  /** Display value, e.g. "200+", "14 days", "96%", "$14M+". */
  value: string;
  label: string;
  className?: string;
  size?: 'md' | 'lg';
}) {
  const word = value.match(/^([^\d]*[\d.,]+)(\s+[A-Za-z].*)$/); // "14 days" → smaller unit
  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <span
        className={`nx-numeral whitespace-nowrap ${size === 'lg' ? 'text-[clamp(3rem,6vw,5.25rem)]' : 'text-[clamp(2.25rem,4vw,3.25rem)]'}`}
      >
        {word ? (
          <>
            <Counter value={word[1]} />
            <span className="ml-[0.18em] text-[0.38em] font-normal tracking-normal text-fg-2">{word[2].trim()}</span>
          </>
        ) : (
          <Counter value={value} />
        )}
      </span>
      <span className="nx-eyebrow">{label}</span>
    </div>
  );
}
