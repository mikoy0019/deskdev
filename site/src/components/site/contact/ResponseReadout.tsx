import { BreathingDot } from '@/components/site/motion';
import type { Channel } from './types';

/**
 * Hero aside on /contact: the response promise as an instrument readout — a
 * huge outlined numeral pulled from the channel value ("Within 12 hours" → 12),
 * with the real label and value underneath for every reader. The breathing
 * dot says the line is open; it is decorative next to the visible value.
 */
export function ResponseReadout({ channel }: { channel: Channel }) {
  const figure = channel.value.match(/\d+/)?.[0];

  return (
    <div className="border-t border-line pt-6 lg:ml-auto lg:max-w-[21rem]">
      <p className="nx-eyebrow">{channel.label}</p>
      {figure && (
        <p aria-hidden className="mt-5 flex items-end gap-2 select-none">
          <span className="nx-numeral nx-numeral-outline block text-[clamp(6.5rem,12vw,11rem)] leading-[0.78] tracking-[-0.06em]">
            {figure}
          </span>
          <span className="nx-serif pb-[0.06em] text-[clamp(3rem,5vw,4.5rem)] leading-none! text-accent-text">h</span>
        </p>
      )}
      <p className="mt-6 flex items-center justify-between gap-4 border-t border-line pt-4">
        <span className="font-heading text-[1.1875rem] font-medium tracking-[-0.015em] text-fg">{channel.value}</span>
        <BreathingDot className="mr-1" />
      </p>
    </div>
  );
}
