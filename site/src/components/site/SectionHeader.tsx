import type { ReactNode } from 'react';
import { Eyebrow, flattenTitle } from './Typography';
import { SplitWords } from './motion/SplitWords';
import { Stagger, StaggerItem } from './motion/Stagger';

/**
 * Standard section opener: eyebrow, h2 and optional lede.
 *  - layout="split" (default when there's a lede and align is left): title on the
 *    left 7 columns, lede bottom-aligned in the right 5 — the editorial look.
 *  - layout="stack": eyebrow, title, lede stacked (use for centered headers).
 *
 * Motion (kit): the header enters as one group when it scrolls into view —
 * eyebrow, then the headline word by word, then the lede — 60ms apart, once.
 */
export function SectionHeader({
  index,
  eyebrow,
  title,
  lede,
  align = 'left',
  layout,
  aside,
  className = '',
  titleClassName = '',
  id,
}: {
  index?: string;
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  align?: 'left' | 'center';
  layout?: 'split' | 'stack';
  /** Extra content for the right column in split layout (e.g. a button). */
  aside?: ReactNode;
  className?: string;
  titleClassName?: string;
  id?: string;
}) {
  const mode = layout ?? (align === 'left' && (lede || aside) ? 'split' : 'stack');
  const center = align === 'center';

  const head = (
    <>
      {eyebrow && (
        <StaggerItem className="mb-6">
          <Eyebrow index={index}>{eyebrow}</Eyebrow>
        </StaggerItem>
      )}
      <SplitWords as="h2" id={id} className={`nx-h2 ${center ? 'mx-auto' : ''} ${titleClassName}`}>
        {flattenTitle(title)}
      </SplitWords>
    </>
  );

  if (mode === 'split') {
    return (
      <Stagger className={`grid gap-8 lg:grid-cols-12 lg:items-end lg:gap-12 ${className}`}>
        <div className="lg:col-span-7">{head}</div>
        {(lede || aside) && (
          <StaggerItem className="flex flex-col gap-6 lg:col-span-5 lg:pb-2">
            {lede && <p className="nx-lede max-w-xl">{lede}</p>}
            {aside}
          </StaggerItem>
        )}
      </Stagger>
    );
  }

  return (
    <Stagger className={`flex flex-col ${center ? 'items-center text-center' : ''} ${className}`}>
      {head}
      {lede && (
        <StaggerItem as="p" className={`nx-lede mt-6 max-w-2xl ${center ? 'mx-auto' : ''}`}>
          {lede}
        </StaggerItem>
      )}
      {aside && <StaggerItem className="mt-8">{aside}</StaggerItem>}
    </Stagger>
  );
}
