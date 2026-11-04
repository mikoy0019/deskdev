import React from 'react';
import { Icon, type IconName } from '../../components/Icon';
import { COLOR, FONT, RADIUS, SHADOW, TYPE } from '../../theme';

/** A theme colour at a lower opacity: alpha(COLOR.accent, 0.12). */
export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// ── Pills ──────────────────────────────────────────────────────────────────────

/** Large accent pill, like Chip tone="accent" size="lg", but with a free icon slot. */
export const AccentPill: React.FC<{ icon: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <div
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 12,
      padding: '14px 26px 14px 22px',
      borderRadius: RADIUS.pill,
      background: alpha(COLOR.accent, 0.14),
      border: `1px solid ${alpha(COLOR.accent, 0.5)}`,
      color: COLOR.accentText,
      ...TYPE.small,
      fontSize: 26,
      whiteSpace: 'nowrap',
    }}
  >
    {icon}
    {children}
  </div>
);

/** The lock icon whose shackle lifts open as `open` goes 0 → 1. */
export const Unlock: React.FC<{ open: number; size?: number }> = ({ open, size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, overflow: 'visible' }}>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <g transform={`translate(0 ${-3.2 * open}) rotate(${-14 * open} 8 11)`}>
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </g>
  </svg>
);

// ── Ownership checklist ───────────────────────────────────────────────────────

/**
 * One checklist row. The hairline track is always there; the content slides in at
 * `show` (0 → 1) and the check box fills at `tick` (0 → 1, may overshoot a touch).
 */
export const CheckRow: React.FC<{
  icon: IconName;
  label: string;
  detail: string;
  show: number;
  tick: number;
  height: number;
  first?: boolean;
}> = ({ icon, label, detail, show, tick, height, first }) => {
  const lit = Math.min(1, Math.max(0, tick));
  return (
    <div
      style={{
        position: 'relative',
        height,
        display: 'flex',
        alignItems: 'center',
        borderTop: first ? `1px solid ${COLOR.line2}` : undefined,
        borderBottom: `1px solid ${COLOR.line2}`,
      }}
    >
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 22,
          opacity: show,
          transform: `translateX(${(1 - show) * -18}px)`,
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: RADIUS.sm + 2,
            border: `1px solid ${lit > 0.5 ? alpha(COLOR.accent, 0.45) : COLOR.line2}`,
            background: alpha(COLOR.accent, 0.04 + lit * 0.08),
            display: 'grid',
            placeItems: 'center',
            color: lit > 0.5 ? COLOR.accentText : COLOR.fg2,
          }}
        >
          <Icon name={icon} size={24} />
        </div>
        <div style={{ fontFamily: FONT.heading, fontWeight: 500, fontSize: 32, letterSpacing: '-0.014em', color: COLOR.fg }}>{label}</div>
        <div style={{ ...TYPE.mono, fontSize: 21, color: COLOR.fg3, marginLeft: 'auto', marginRight: 26 }}>{detail}</div>
        <div style={{ position: 'relative', width: 38, height: 38 }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: RADIUS.pill, border: `1.5px solid ${COLOR.line2}` }} />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: RADIUS.pill,
              background: COLOR.accent,
              color: COLOR.accentFg,
              display: 'grid',
              placeItems: 'center',
              opacity: lit,
              transform: `scale(${0.5 + 0.5 * tick})`,
            }}
          >
            <Icon name="check" size={22} stroke={2.4} />
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Design concept thumbnails ─────────────────────────────────────────────────

export const THUMB_W = 400;
export const THUMB_H = 262;

const Block: React.FC<{ w: number | string; h: number; a?: number; color?: string; r?: number; style?: React.CSSProperties }> = ({
  w,
  h,
  a = 0.14,
  color = COLOR.fg,
  r = 4,
  style,
}) => <div style={{ width: w, height: h, borderRadius: r, background: alpha(color, a), flexShrink: 0, ...style }} />;

/** Little nav strip shared by every concept: logo dot, three links, a button. */
const Nav: React.FC<{ accent?: boolean }> = ({ accent }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 18 }}>
    <Block w={14} h={14} r={7} a={accent ? 1 : 0.3} color={accent ? COLOR.accent : COLOR.fg} />
    <Block w={46} h={7} a={0.3} />
    <div style={{ flex: 1 }} />
    <Block w={26} h={6} a={0.18} />
    <Block w={26} h={6} a={0.18} />
    <Block w={26} h={6} a={0.18} />
    <Block w={44} h={16} r={8} a={accent ? 1 : 0.22} color={accent ? COLOR.accent : COLOR.fg} />
  </div>
);

/** v1: centred, plain. */
const ConceptA: React.FC = () => (
  <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box' }}>
    <Nav />
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9, marginTop: 26 }}>
      <Block w={220} h={14} a={0.34} />
      <Block w={150} h={14} a={0.34} />
      <Block w={190} h={6} a={0.14} style={{ marginTop: 6 }} />
      <Block w={78} h={20} r={10} a={0.24} style={{ marginTop: 8 }} />
    </div>
    <div style={{ display: 'flex', gap: 12, marginTop: 'auto' }}>
      {[0, 1, 2].map((i) => (
        <Block key={i} w="100%" h={52} a={0.07} r={6} style={{ flex: 1, border: `1px solid ${COLOR.line}` }} />
      ))}
    </div>
  </div>
);

/** v2: split hero, image right. */
const ConceptB: React.FC = () => (
  <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box' }}>
    <Nav />
    <div style={{ display: 'flex', gap: 18, marginTop: 22, flex: 1 }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 9, paddingTop: 10 }}>
        <Block w="92%" h={14} a={0.38} />
        <Block w="70%" h={14} a={0.38} />
        <Block w="84%" h={6} a={0.14} style={{ marginTop: 6 }} />
        <Block w="62%" h={6} a={0.14} />
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <Block w={70} h={20} r={10} a={0.3} />
          <Block w={58} h={20} r={10} a={0.08} style={{ border: `1px solid ${COLOR.line2}` }} />
        </div>
      </div>
      <div style={{ flex: 1, borderRadius: 8, background: alpha(COLOR.fg, 0.08), border: `1px solid ${COLOR.line}`, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: '22%', top: '24%', width: 34, height: 34, borderRadius: 17, background: alpha(COLOR.fg, 0.16) }} />
        <div
          style={{
            position: 'absolute',
            left: -10,
            right: -10,
            bottom: -40,
            height: 110,
            background: alpha(COLOR.fg, 0.1),
            transform: 'rotate(-14deg)',
            transformOrigin: 'left bottom',
          }}
        />
      </div>
    </div>
  </div>
);

/** v3: the refined one. Full-bleed hero, accent call to action, service cards. */
const ConceptC: React.FC = () => (
  <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    <div style={{ padding: '18px 22px 0' }}>
      <Nav accent />
    </div>
    <div
      style={{
        margin: '16px 22px 0',
        height: 104,
        borderRadius: 8,
        background: alpha(COLOR.accent, 0.2),
        border: `1px solid ${alpha(COLOR.accent, 0.35)}`,
        position: 'relative',
        overflow: 'hidden',
        padding: '18px 20px',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ position: 'absolute', right: 26, top: 18, width: 68, height: 68, borderRadius: 34, background: alpha(COLOR.accent, 0.35) }} />
      <Block w={176} h={14} a={0.85} />
      <Block w={120} h={14} a={0.85} />
      <Block w={64} h={18} r={9} a={1} color={COLOR.accent} style={{ marginTop: 6 }} />
    </div>
    <div style={{ display: 'flex', gap: 10, margin: '14px 22px 0' }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{ flex: 1, height: 58, borderRadius: 6, border: `1px solid ${COLOR.line2}`, background: alpha(COLOR.fg, 0.04), padding: 10, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 7 }}
        >
          <Block w={12} h={12} r={6} a={0.9} color={COLOR.accentText} />
          <Block w="70%" h={6} a={0.3} />
        </div>
      ))}
    </div>
  </div>
);

const CONCEPTS = [ConceptA, ConceptB, ConceptC];

/** A design-concept thumbnail with its version tag. `approved` (0 → 1) rings it in success. */
export const ConceptThumb: React.FC<{ index: number; approved?: number }> = ({ index, approved = 0 }) => {
  const Body = CONCEPTS[index];
  return (
    <div
      style={{
        position: 'relative',
        width: THUMB_W,
        height: THUMB_H,
        borderRadius: RADIUS.md,
        background: COLOR.bg2,
        border: `1px solid ${COLOR.line2}`,
        boxShadow: SHADOW.card,
        overflow: 'hidden',
      }}
    >
      <Body />
      <div
        style={{
          position: 'absolute',
          left: 12,
          bottom: 12,
          ...TYPE.mono,
          fontSize: 20,
          fontWeight: 500,
          letterSpacing: '0.06em',
          padding: '3px 10px',
          borderRadius: RADIUS.sm - 4,
          background: alpha(COLOR.bg, 0.86),
          border: `1px solid ${COLOR.line2}`,
          color: COLOR.fg2,
        }}
      >
        v{index + 1}
      </div>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: RADIUS.md,
          border: `2px solid ${alpha(COLOR.success, 0.7)}`,
          opacity: approved,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
};
