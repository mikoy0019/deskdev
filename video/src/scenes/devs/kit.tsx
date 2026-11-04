import React from 'react';
import { Icon } from '../../components/Icon';
import { COLOR, TYPE } from '../../theme';

/** Scene-local frames for every moment in the devs scene, read from the voiceover in Devs.tsx. */
export type DevsTiming = {
  eyebrow: number;
  headline: number;
  /** Profile card rises in (compact: avatar, role, skills). */
  card: number;
  /** "ongoing help": presence dot + "Online". */
  online: number;
  /** "your own": the card takes the accent border. */
  yours: number;
  /** The card grows to reveal the engagement control. */
  engage: number;
  /** Segmented-control highlight lands on each option. */
  full: number;
  part: number;
  onCall: number;
  /** Profile card slides from centre to the left column. */
  split: number;
  /** The segmented highlight widens over all three options (the offer, not one pick). */
  neutral: number;
  /** Daily report card pushes in from the right. */
  report: number;
  /** One frame per report line. */
  lines: number[];
  /** First day of the week strip ticks on "day"; the rest follow. */
  week: number;
};

/** Both cards share one size so the final pair reads as a set. */
export const CARD_W = 800;
export const CARD_H = 426;

/** A theme hex colour at an alpha, so every tint stays derived from COLOR. */
export function tint(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** In-card section label: mono, uppercase, 20 px. */
export const MonoLabel: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ ...TYPE.eyebrow, fontSize: 20, lineHeight: '24px', color: COLOR.fg3, ...style }}>{children}</div>
);

/** Generic person avatar: a circle with the user icon (never a real face). */
export const Avatar: React.FC<{ size: number; style?: React.CSSProperties; children?: React.ReactNode }> = ({ size, style, children }) => (
  <div
    style={{
      position: 'relative',
      width: size,
      height: size,
      flexShrink: 0,
      boxSizing: 'border-box',
      borderRadius: '50%',
      background: COLOR.surface,
      border: `1px solid ${COLOR.line2}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: COLOR.fg2,
      ...style,
    }}
  >
    <Icon name="user" size={Math.round(size * 0.48)} stroke={1.5} />
    {children}
  </div>
);
