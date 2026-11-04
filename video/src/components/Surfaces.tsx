import React from 'react';
import { Img, interpolate, useCurrentFrame } from 'remotion';
import { CLAMP, EASE, progress } from '../lib/motion';
import { COLOR, FONT, RADIUS, SHADOW, TYPE } from '../theme';
import { Icon, type IconName } from './Icon';

/** The base panel: surface fill, hairline border, soft depth. `glow` marks the one highlighted card. */
export const Card: React.FC<{
  children?: React.ReactNode;
  padding?: number | string;
  radius?: number;
  glow?: boolean;
  style?: React.CSSProperties;
}> = ({ children, padding = 32, radius = RADIUS.lg, glow = false, style }) => (
  <div
    style={{
      position: 'relative',
      background: `linear-gradient(180deg, ${COLOR.surface2} 0%, ${COLOR.surface} 100%)`,
      border: `1px solid ${glow ? 'rgba(43, 102, 255, 0.55)' : COLOR.line2}`,
      borderRadius: radius,
      boxShadow: glow ? `${SHADOW.card}, ${SHADOW.accent}` : SHADOW.card,
      padding,
      ...style,
    }}
  >
    {children}
  </div>
);

export type ChipTone = 'neutral' | 'accent' | 'success' | 'warn' | 'danger';

const CHIP_TONES: Record<ChipTone, { bg: string; border: string; color: string }> = {
  neutral: { bg: 'rgba(226, 232, 255, 0.05)', border: COLOR.line2, color: COLOR.fg2 },
  accent: { bg: 'rgba(43, 102, 255, 0.14)', border: 'rgba(43, 102, 255, 0.5)', color: COLOR.accentText },
  success: { bg: 'rgba(52, 211, 153, 0.12)', border: 'rgba(52, 211, 153, 0.4)', color: '#6ee7b7' },
  warn: { bg: 'rgba(251, 191, 36, 0.12)', border: 'rgba(251, 191, 36, 0.4)', color: '#fcd34d' },
  danger: { bg: 'rgba(248, 113, 113, 0.12)', border: 'rgba(248, 113, 113, 0.4)', color: '#fca5a5' },
};

/** Pill label. Status tones (success/warn/danger) are for status only. */
export const Chip: React.FC<{
  children: React.ReactNode;
  tone?: ChipTone;
  icon?: IconName;
  size?: 'md' | 'lg';
  style?: React.CSSProperties;
}> = ({ children, tone = 'neutral', icon, size = 'md', style }) => {
  const t = CHIP_TONES[tone];
  const lg = size === 'lg';
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: lg ? 12 : 10,
        padding: lg ? '14px 24px' : '9px 18px',
        borderRadius: RADIUS.pill,
        background: t.bg,
        border: `1px solid ${t.border}`,
        color: t.color,
        ...TYPE.small,
        fontSize: lg ? 26 : 20,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {icon ? <Icon name={icon} size={lg ? 24 : 20} /> : null}
      {children}
    </div>
  );
};

/** Counts from `from` to `to` starting at `at`. Tabular numerals so digits don't jitter. */
export const Counter: React.FC<{
  to: number;
  from?: number;
  at?: number;
  dur?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  style?: React.CSSProperties;
}> = ({ to, from = 0, at = 0, dur = 40, decimals = 0, prefix = '', suffix = '', style }) => {
  const frame = useCurrentFrame();
  const value = interpolate(frame, [at, at + dur], [from, to], { ...CLAMP, easing: EASE.out });
  return (
    <span style={{ fontVariantNumeric: 'tabular-nums', ...style }}>
      {prefix}
      {value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  );
};

/** A browser window. Put a <Shot> or your own mock UI inside. */
export const BrowserFrame: React.FC<{
  url: string;
  width: number;
  height: number;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ url, width, height, children, style }) => (
  <div
    style={{
      width,
      height,
      borderRadius: 18,
      overflow: 'hidden',
      background: '#0b0f17',
      border: `1px solid ${COLOR.line2}`,
      boxShadow: SHADOW.float,
      display: 'flex',
      flexDirection: 'column',
      ...style,
    }}
  >
    <div style={{ height: 46, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 18px', borderBottom: `1px solid ${COLOR.line}` }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{ width: 12, height: 12, borderRadius: 6, background: 'rgba(226, 232, 255, 0.16)' }} />
      ))}
      <div
        style={{
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 16px',
          borderRadius: RADIUS.pill,
          background: 'rgba(226, 232, 255, 0.05)',
          color: COLOR.fg3,
          fontFamily: FONT.mono,
          fontSize: 15,
        }}
      >
        <Icon name="lock" size={14} />
        {url}
      </div>
      <span style={{ width: 52 }} />
    </div>
    <div style={{ position: 'relative', flex: 1, overflow: 'hidden', background: '#ffffff' }}>{children}</div>
  </div>
);

/** A phone. Content is clipped to the screen. */
export const PhoneFrame: React.FC<{
  width?: number;
  height?: number;
  children?: React.ReactNode;
  screen?: string;
  style?: React.CSSProperties;
}> = ({ width = 360, height = 740, children, screen = '#05070b', style }) => (
  <div
    style={{
      width,
      height,
      borderRadius: 58,
      padding: 11,
      background: 'linear-gradient(160deg, #1b2130 0%, #0b0e15 60%)',
      border: `1px solid ${COLOR.line2}`,
      boxShadow: SHADOW.float,
      ...style,
    }}
  >
    <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: 47, overflow: 'hidden', background: screen }}>
      {children}
      <div style={{ position: 'absolute', top: 12, left: '50%', width: 116, height: 34, marginLeft: -58, borderRadius: 17, background: '#000' }} />
    </div>
  </div>
);

/**
 * A full-page screenshot (public/clients/*.jpg are 1280x2400) shown at `width`,
 * scrolled by `scroll` (0 = top, 1 = as far down as `maxScroll` of the image).
 */
export const Shot: React.FC<{
  src: string;
  width: number;
  /** 0..1 */
  scroll?: number;
  /** Fraction of the image height that 1.0 scroll reaches. */
  maxScroll?: number;
  /** Source image aspect: height / width. Client shots are 2400/1280. */
  aspect?: number;
  style?: React.CSSProperties;
}> = ({ src, width, scroll = 0, maxScroll = 0.45, aspect = 2400 / 1280, style }) => (
  <Img
    src={src}
    style={{
      position: 'absolute',
      left: 0,
      top: 0,
      width,
      height: width * aspect,
      transform: `translateY(${-scroll * maxScroll * width * aspect}px)`,
      ...style,
    }}
  />
);

/** A thin animated line that draws from 0 to full length. Use for connectors and timelines. */
export const DrawLine: React.FC<{
  at: number;
  dur?: number;
  length: number;
  vertical?: boolean;
  color?: string;
  thickness?: number;
  style?: React.CSSProperties;
}> = ({ at, dur = 24, length, vertical = false, color = COLOR.line2, thickness = 2, style }) => {
  const frame = useCurrentFrame();
  const p = progress(frame, at, dur, EASE.inOut);
  return (
    <div
      style={{
        width: vertical ? thickness : length * p,
        height: vertical ? length * p : thickness,
        background: color,
        borderRadius: thickness,
        ...style,
      }}
    />
  );
};
