import React from 'react';
import { useCurrentFrame } from 'remotion';
import { EASE, progress } from '../../lib/motion';
import { TYPE } from '../../theme';

/** The card panel's inner size (the Card is 920x640 with a 1px border). */
export const PANEL_W = 918;
export const PANEL_H = 638;

/**
 * TYPE.numeral, locally tuned. Space Grotesk's "1" has a narrow notch where the flag
 * meets the stem that reads as a dark seam at display sizes. Weight 400 plus a thin
 * same-colour stroke closes that notch to a clean point and lands at the weight of 500.
 */
export const NUMERAL: React.CSSProperties = {
  ...TYPE.numeral,
  fontWeight: 400,
  WebkitTextStroke: '0.02em currentColor',
};

/** A theme hex colour at an alpha, e.g. alpha(COLOR.accent, 0.14). Keeps tints tied to the theme. */
export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/**
 * Odometer-style value. The first value rises in at `enter`; at each frame in `at`
 * the current value slides up and out while the next one rises in from below.
 * Sized by `sizer` (or the first value), clipped to its own line box.
 */
export const Roll: React.FC<{
  values: React.ReactNode[];
  /** Frame each later value takes over: one entry per value after the first. */
  at: number[];
  /** Frame the first value rises in. Omit to show it from the start. */
  enter?: number;
  dur?: number;
  /** The first value's rise: its own duration, and how far it travels (fraction of the line). */
  enterDur?: number;
  enterTravel?: number;
  /** Peak blur in px mid-roll (keep it small, on small elements only). */
  blur?: number;
  /** Fixed width in px; otherwise the sizer's width. */
  width?: number;
  align?: 'left' | 'right' | 'center';
  /** Invisible content that sets the box size; defaults to the first value. */
  sizer?: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ values, at, enter, dur = 18, enterDur, enterTravel = 1, blur = 0, width, align = 'left', sizer, style }) => {
  const frame = useCurrentFrame();
  return (
    <span style={{ position: 'relative', display: 'block', overflow: 'hidden', width, textAlign: align, ...style }}>
      <span style={{ display: 'block', visibility: 'hidden' }}>{sizer ?? values[0]}</span>
      {values.map((value, i) => {
        const inAt = i === 0 ? enter : at[i - 1];
        const pin = inAt === undefined ? 1 : progress(frame, inAt, i === 0 ? (enterDur ?? dur) : dur, i === 0 ? EASE.out : EASE.inOut);
        const travel = i === 0 ? enterTravel : 1;
        const pout = i < at.length ? progress(frame, at[i], dur, EASE.inOut) : 0;
        if (pin <= 0 || pout >= 1) return null;
        const moving = pin < 1 ? pin : pout;
        const smear = blur ? Math.sin(Math.PI * moving) * blur : 0;
        return (
          <span
            key={i}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              display: 'block',
              transform: `translateY(${(1 - pin) * travel * 100 - pout * 100}%)`,
              opacity: Math.min(1, pin * 1.4) * (1 - pout),
              filter: smear > 0.05 ? `blur(${smear}px)` : undefined,
            }}
          >
            {value}
          </span>
        );
      })}
    </span>
  );
};

/**
 * One leak's panel content inside the shared card: rises in at `enter`, lifts away
 * at `exit`. Unmounted outside that window so only one panel renders at a time.
 */
export const Slot: React.FC<{ enter: number; exit?: number; children: React.ReactNode }> = ({ enter, exit, children }) => {
  const frame = useCurrentFrame();
  if (frame < enter) return null;
  const pin = progress(frame, enter, 24, EASE.out);
  const pout = exit === undefined ? 0 : progress(frame, exit, 14, EASE.inOut);
  if (pout >= 1) return null;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        opacity: pin * (1 - pout),
        transform: `translateY(${(1 - pin) * 28 - pout * 22}px) scale(${0.985 + 0.015 * pin})`,
      }}
    >
      {children}
    </div>
  );
};
