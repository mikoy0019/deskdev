import React from 'react';
import { interpolateColors, useCurrentFrame } from 'remotion';
import { Icon } from '../../components/Icon';
import { BrowserFrame, Chip } from '../../components/Surfaces';
import { EASE, mix, progress, springAt } from '../../lib/motion';
import { useCue } from '../../lib/scene';
import { COLOR, RADIUS, SHADOW, TYPE } from '../../theme';
import { NUMERAL, PANEL_W, alpha } from './kit';

// Drawn at 600x430 and scaled down, so the browser chrome stays in proportion.
const SITE_W = 600;
const SITE_H = 430;

// Mock website content: a white page with grey wireframe blocks (raw greys are
// allowed inside a BrowserFrame). Every copy is identical on purpose.
const PAGE = '#edf0f4';
const INK = '#c3cad5';
const INK_SOFT = '#d5dae2';
const INK_STRONG = '#a9b2c0';
const FILL = '#dee3ea';

const Block: React.FC<{ x: number; y: number; w: number; h: number; c: string; r?: number }> = ({ x, y, w, h, c, r = 6 }) => (
  <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, borderRadius: r, background: c }} />
);

/** A generic template website. */
const WireSite: React.FC = () => (
  <BrowserFrame url={' '.repeat(8)} width={SITE_W} height={SITE_H}>
    <div style={{ position: 'absolute', inset: 0, background: PAGE }}>
      <Block x={32} y={24} w={78} h={18} c={INK} r={4} />
      {[0, 1, 2].map((i) => (
        <Block key={i} x={318 + i * 62} y={29} w={46} h={9} c={INK_SOFT} r={5} />
      ))}
      <Block x={506} y={20} w={62} h={26} c={INK_STRONG} r={13} />
      <Block x={32} y={84} w={296} h={28} c={INK} />
      <Block x={32} y={122} w={232} h={28} c={INK} />
      <Block x={32} y={170} w={268} h={11} c={INK_SOFT} />
      <Block x={32} y={190} w={210} h={11} c={INK_SOFT} />
      <Block x={32} y={222} w={128} h={38} c={INK_STRONG} r={8} />
      <div style={{ position: 'absolute', left: 360, top: 76, width: 208, height: 184, borderRadius: 10, background: FILL, overflow: 'hidden' }}>
        <svg width={208} height={184} viewBox="0 0 208 184" style={{ position: 'absolute', inset: 0 }}>
          <circle cx={150} cy={58} r={16} fill={INK_SOFT} />
          <path d="M0 184 L70 92 L118 150 L146 118 L208 184 Z" fill={INK} />
        </svg>
      </div>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{ position: 'absolute', left: 32 + i * 184, top: 290, width: 168, height: 66, borderRadius: 8, background: '#e4e8ee', border: `1px solid ${INK_SOFT}` }}
        >
          <Block x={14} y={16} w={26} h={26} c={INK_SOFT} r={6} />
          <Block x={52} y={20} w={92} h={8} c={INK} r={4} />
          <Block x={52} y={34} w={66} h={8} c={INK_SOFT} r={4} />
        </div>
      ))}
    </div>
  </BrowserFrame>
);

// Centre positions inside the panel, relative to the group's base line.
const FAN = [
  { x: 206, y: 16, r: -7 },
  { x: 459, y: -10, r: 0 },
  { x: 712, y: 16, r: 7 },
];
const STACK = [
  { x: 440, y: 12, r: -3.5 },
  { x: 459, y: 0, r: 0 },
  { x: 480, y: 9, r: 3 },
];
const Z = [1, 3, 2];
const ENTER = [12, 6, 18];

const QUOTES = [
  { label: 'Quote A', price: '$480' },
  { label: 'Quote B', price: '$450' },
  { label: 'Quote C', price: '$420' },
];
const TAG_W = 236;
const TAG_H = 124;
const TAG_GAP = 26;
const TAG_TOP = 404;
const CHEAPEST = 2;

/** Leak 1: three identical sites collapse into one stack, then customers compare on price. */
export const LookAlike: React.FC = () => {
  const frame = useCurrentFrame();
  const { cue } = useCue();
  const stackAt = cue("everyone else's", { beat: 'leak1', offset: -4 });
  const lostAt = cue("can't tell you apart", { beat: 'leak1', offset: -4 });
  const tagsAt = cue('shop on price', { beat: 'leak1', offset: -4 });
  const pickAt = cue('price', { beat: 'leak1', offset: 8 });

  const stack = progress(frame, stackAt, 36, EASE.inOut);
  const lift = progress(frame, tagsAt - 16, 30, EASE.inOut);
  // Slow drift of the group so the held stack never looks frozen.
  const drift = mix(0, -10, progress(frame, stackAt, 150, EASE.inOut));
  const baseY = mix(330, 237, lift) + drift;
  const scale = mix(0.56, 0.72, stack) * mix(1, 0.76, lift);

  const mid = STACK[1];
  const youX = mix(FAN[1].x, mid.x, stack);
  const youY = baseY + mix(FAN[1].y, mid.y, stack) - (SITE_H * scale) / 2 - 34;
  const youIn = progress(frame, 22, 18, EASE.out);
  const youOut = progress(frame, lostAt, 16, EASE.in);

  const pick = progress(frame, pickAt, 18, EASE.out);
  const tagsLeft = (PANEL_W - (3 * TAG_W + 2 * TAG_GAP)) / 2;

  return (
    <>
      {[0, 1, 2].map((i) => {
        const p = progress(frame, ENTER[i], 24, EASE.out);
        const x = mix(FAN[i].x, STACK[i].x, stack);
        const y = baseY + mix(FAN[i].y, STACK[i].y, stack) + (1 - p) * 34;
        const r = mix(FAN[i].r, STACK[i].r, stack);
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x - SITE_W / 2,
              top: y - SITE_H / 2,
              width: SITE_W,
              height: SITE_H,
              zIndex: Z[i],
              opacity: p,
              transform: `rotate(${r}deg) scale(${scale})`,
            }}
          >
            <WireSite />
          </div>
        );
      })}

      {youOut < 1 ? (
        <div
          style={{
            position: 'absolute',
            left: youX,
            top: youY,
            zIndex: 4,
            opacity: youIn * (1 - youOut),
            transform: `translate(-50%, -50%) translateY(${(1 - youIn) * 10 - youOut * 12}px)`,
            filter: youOut > 0 ? `blur(${youOut * 5}px)` : undefined,
          }}
        >
          <Chip tone="accent" icon="user">
            You
          </Chip>
        </div>
      ) : null}

      {QUOTES.map((q, i) => {
        const s = springAt(frame, tagsAt + i * 6, { damping: 14, stiffness: 170 });
        if (frame < tagsAt + i * 6) return null;
        const cheapest = i === CHEAPEST;
        return (
          <div
            key={q.label}
            style={{
              position: 'absolute',
              left: tagsLeft + i * (TAG_W + TAG_GAP),
              top: TAG_TOP,
              width: TAG_W,
              height: TAG_H,
              zIndex: 5,
              opacity: Math.min(1, s * 1.6) * (cheapest ? 1 : mix(1, 0.4, pick)),
              transform: `translateY(${(1 - s) * -48}px)`,
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: RADIUS.md,
                background: COLOR.surface2,
                border: `1px solid ${cheapest ? interpolateColors(pick, [0, 1], [COLOR.line2, alpha(COLOR.accent, 0.7)]) : COLOR.line2}`,
                boxShadow: SHADOW.card,
              }}
            />
            {cheapest ? (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: RADIUS.md,
                  background: alpha(COLOR.accent, 0.1),
                  boxShadow: SHADOW.accent,
                  opacity: pick,
                }}
              />
            ) : null}
            <div style={{ position: 'absolute', left: 26, top: 22, ...TYPE.eyebrow, fontSize: 20, color: COLOR.fg3 }}>{q.label}</div>
            {cheapest ? (
              <div
                style={{
                  position: 'absolute',
                  right: 22,
                  top: 20,
                  width: 30,
                  height: 30,
                  borderRadius: 15,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: COLOR.accent,
                  color: COLOR.accentFg,
                  opacity: pick,
                  transform: `scale(${0.6 + 0.4 * springAt(frame, pickAt, { damping: 14, stiffness: 180 })})`,
                }}
              >
                <Icon name="check" size={18} stroke={2.4} />
              </div>
            ) : null}
            <div
              style={{
                position: 'absolute',
                left: 24,
                bottom: 18,
                ...NUMERAL,
                fontSize: 58,
                color: cheapest ? interpolateColors(pick, [0, 1], [COLOR.fg, COLOR.accentText]) : COLOR.fg,
              }}
            >
              {q.price}
            </div>
          </div>
        );
      })}
    </>
  );
};
