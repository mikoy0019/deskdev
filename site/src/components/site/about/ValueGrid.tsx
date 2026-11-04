import { Stagger, StaggerItem } from '@/components/site/motion';
import { Bezel } from './Bezel';
import { ValueVisualArt } from './ValueVisuals';
import type { Value } from './types';

/**
 * The values as an asymmetric bento: wide/narrow, then narrow/wide (7/5, 5/7
 * on a 12-column grid), one column on phones. Each tile is a double-bezel
 * picture of the value at work; the index, title and copy sit underneath,
 * gallery style. Tiles enter 80ms apart.
 */
const spans = ['lg:col-span-7', 'lg:col-span-5', 'lg:col-span-5', 'lg:col-span-7'];

export function ValueGrid({ items }: { items: Value[] }) {
  return (
    <Stagger as="ul" className="grid gap-x-6 gap-y-14 md:gap-y-16 lg:grid-cols-12 lg:gap-y-20" each={0.08}>
      {items.map((v, i) => (
        <StaggerItem as="li" key={v.title} className={`flex min-w-0 flex-col ${spans[i % spans.length]}`}>
          {/* 15rem: the label and the picture sit about 3rem apart in every tile, which
              is also the room the scorecard's "Sent" notice needs under its label. */}
          <Bezel innerClassName="h-[15rem]">
            <div className="h-full" aria-hidden>
              <ValueVisualArt kind={v.visual} />
            </div>
          </Bezel>
          <div className="mt-8 flex items-center gap-4 px-1" aria-hidden>
            <span className="nx-mono text-xs tabular-nums text-accent-text">{String(i + 1).padStart(2, '0')}</span>
            <span className="h-px w-10 bg-line-2" />
          </div>
          <h3 className="nx-h3 mt-4 px-1 text-[clamp(1.5rem,2.1vw,1.875rem)]">{v.title}</h3>
          <p className="nx-body mt-3 max-w-[34rem] px-1">{v.body}</p>
        </StaggerItem>
      ))}
    </Stagger>
  );
}
