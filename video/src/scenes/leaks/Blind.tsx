import React from 'react';
import { interpolateColors, useCurrentFrame } from 'remotion';
import { Icon, type IconName } from '../../components/Icon';
import { Chip, Counter, DrawLine } from '../../components/Surfaces';
import { EASE, mix, progress, springAt } from '../../lib/motion';
import { useCue } from '../../lib/scene';
import { COLOR, FONT, RADIUS, TYPE } from '../../theme';
import { NUMERAL, PANEL_W, alpha } from './kit';

// Illustrative spend (round numbers). Marked "Sample data" in the panel.
const ROWS: { icon: IconName; channel: string; spent: string }[] = [
  { icon: 'search', channel: 'Google Ads', spent: '$2,400' },
  { icon: 'users', channel: 'Facebook', spent: '$1,100' },
  { icon: 'file', channel: 'Flyers', spent: '$600' },
  { icon: 'globe', channel: 'Website', spent: '—' },
];

const SIDE = 44;
const HEAD_TOP = 124;
const HEAD_H = 56;
const ROW_H = 86;
const LINE_W = PANEL_W - SIDE * 2;
const SPENT_RIGHT = 540;
const CUST_CENTER = LINE_W - 110;

const cell: React.CSSProperties = { position: 'absolute', top: 0, height: '100%', display: 'flex', alignItems: 'center' };

/** The "?" a Customers cell turns into: an accent pill that keeps a slow pulse. */
const Unknown: React.FC<{ at: number; phase: number }> = ({ at, phase }) => {
  const frame = useCurrentFrame();
  if (frame < at) return null;
  const s = springAt(frame, at, { damping: 14, stiffness: 170 });
  const pulse = 0.5 + 0.5 * Math.sin(((frame - at) / 30) * Math.PI * 1.6 - phase);
  return (
    <div
      style={{
        width: 72,
        height: 52,
        borderRadius: RADIUS.pill,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: alpha(COLOR.accent, mix(0.1, 0.22, pulse)),
        border: `1px solid ${alpha(COLOR.accent, mix(0.4, 0.75, pulse))}`,
        fontFamily: FONT.heading,
        fontWeight: 500,
        fontSize: 32,
        color: COLOR.accentText,
        opacity: Math.min(1, s * 1.5),
        transform: `scale(${(0.6 + 0.4 * s) * mix(1, 1.05, pulse)})`,
      }}
    >
      ?
    </div>
  );
};

/** Leak 4: spend per channel is known, customers per channel is a row of question marks. */
export const Blind: React.FC = () => {
  const frame = useCurrentFrame();
  const { cue, beatStart } = useCue();
  const enter = beatStart('leak4');
  const rowsAt = cue('spend on marketing', { beat: 'leak4', offset: -6 });
  const butAt = cue('but not', { beat: 'leak4', offset: -4 });
  const askAt = cue('paying customers', { beat: 'leak4', offset: -6 });

  const head = progress(frame, enter - 2, 18, EASE.out);
  const colFocus = progress(frame, butAt, 20, EASE.inOut);
  const totalAt = rowsAt + ROWS.length * 5 + 10;
  const total = progress(frame, totalAt, 20, EASE.out);
  const drift = mix(0, -8, progress(frame, enter, 250, EASE.inOut));

  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: SIDE,
          right: SIDE,
          top: 44,
          height: 52,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          opacity: head,
          transform: `translateY(${(1 - head) * 12}px)`,
        }}
      >
        <Icon name="chart" size={30} color={COLOR.fg2} />
        <div style={{ ...TYPE.h4, color: COLOR.fg }}>Marketing</div>
        <div style={{ ...TYPE.mono, color: COLOR.fg3, marginLeft: 6 }}>Last 30 days</div>
        <div style={{ flex: 1 }} />
        <Chip>Sample data</Chip>
      </div>

      <div style={{ position: 'absolute', left: SIDE, top: drift, width: LINE_W, height: 638 }}>
        {/* Column header */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: HEAD_TOP,
            height: HEAD_H,
            ...TYPE.eyebrow,
            fontSize: 20,
            color: COLOR.fg3,
            opacity: progress(frame, enter + 4, 20, EASE.out),
          }}
        >
          <div style={{ ...cell, left: 0 }}>Channel</div>
          <div style={{ ...cell, right: LINE_W - SPENT_RIGHT, justifyContent: 'flex-end' }}>Spent</div>
          <div
            style={{
              ...cell,
              left: CUST_CENTER - 120,
              width: 240,
              justifyContent: 'center',
              color: interpolateColors(colFocus, [0, 1], [COLOR.fg3, COLOR.accentText]),
            }}
          >
            Customers
          </div>
        </div>
        <DrawLine at={enter + 6} dur={26} length={LINE_W} color={COLOR.line2} thickness={1} style={{ position: 'absolute', top: HEAD_TOP + HEAD_H }} />

        {/* Customers column focus band */}
        <div
          style={{
            position: 'absolute',
            left: CUST_CENTER - 110,
            width: 220,
            top: HEAD_TOP - 6,
            height: HEAD_H + ROW_H * (ROWS.length + 1) + 18,
            borderRadius: RADIUS.md,
            background: alpha(COLOR.accent, 0.06),
            border: `1px solid ${alpha(COLOR.accent, 0.28)}`,
            opacity: colFocus,
          }}
        />

        {ROWS.map((row, i) => {
          const p = progress(frame, rowsAt + i * 5, 22, EASE.out);
          const top = HEAD_TOP + HEAD_H + i * ROW_H;
          // Until the numbers land, the rows are blank placeholders.
          const ghost = progress(frame, enter + 10 + i * 4, 20, EASE.out) * (1 - progress(frame, rowsAt + i * 5, 12, EASE.out));
          if (p <= 0 && ghost <= 0) return null;
          return (
            <div key={row.channel} style={{ position: 'absolute', left: 0, right: 0, top, height: ROW_H }}>
              {ghost > 0 ? (
                <div style={{ position: 'absolute', inset: 0, opacity: ghost }}>
                  <div style={{ ...cell, left: 0, gap: 16 }}>
                    <div style={{ width: 44, height: 44, borderRadius: RADIUS.sm, background: alpha(COLOR.fg, 0.05) }} />
                    <div style={{ width: [170, 140, 110, 130][i], height: 18, borderRadius: 9, background: alpha(COLOR.fg, 0.07) }} />
                  </div>
                  <div style={{ ...cell, right: LINE_W - SPENT_RIGHT }}>
                    <div style={{ width: [120, 110, 84, 40][i], height: 22, borderRadius: 11, background: alpha(COLOR.fg, 0.07) }} />
                  </div>
                  <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 1, background: COLOR.line }} />
                </div>
              ) : null}
              <div style={{ position: 'absolute', inset: 0, opacity: p, transform: `translateY(${(1 - p) * 16}px)`, display: p > 0 ? undefined : 'none' }}>
                <div style={{ ...cell, left: 0, gap: 16, fontFamily: FONT.body, fontWeight: 500, fontSize: 29, color: COLOR.fg }}>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: RADIUS.sm,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: alpha(COLOR.fg, 0.05),
                      border: `1px solid ${COLOR.line2}`,
                      color: COLOR.fg2,
                    }}
                  >
                    <Icon name={row.icon} size={22} />
                  </div>
                  {row.channel}
                </div>
                <div
                  style={{
                    ...cell,
                    right: LINE_W - SPENT_RIGHT,
                    ...NUMERAL,
                    fontSize: 38,
                    lineHeight: 1,
                    letterSpacing: '-0.02em',
                    color: row.spent === '—' ? COLOR.fg3 : COLOR.fg,
                  }}
                >
                  {row.spent}
                </div>
              </div>
              <div style={{ ...cell, left: CUST_CENTER - 60, width: 120, justifyContent: 'center' }}>
                <Unknown at={askAt + i * 4} phase={i * 0.7} />
              </div>
              {i < ROWS.length - 1 ? (
                <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 1, background: COLOR.line, opacity: Math.max(p, ghost) }} />
              ) : null}
            </div>
          );
        })}

        {/* Total */}
        {total > 0 ? (
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: HEAD_TOP + HEAD_H + ROWS.length * ROW_H,
              height: ROW_H,
              borderTop: `1px solid ${COLOR.line2}`,
            }}
          >
            <div style={{ position: 'absolute', inset: 0, opacity: total, transform: `translateY(${(1 - total) * 12}px)` }}>
              <div style={{ ...cell, left: 0, ...TYPE.eyebrow, fontSize: 20, color: COLOR.fg2 }}>Total</div>
              <div style={{ ...cell, right: LINE_W - SPENT_RIGHT, ...NUMERAL, fontSize: 44, lineHeight: 1, letterSpacing: '-0.02em', color: COLOR.fg }}>
                <Counter to={4100} at={totalAt} dur={30} prefix="$" />
              </div>
            </div>
            <div style={{ ...cell, left: CUST_CENTER - 60, width: 120, justifyContent: 'center' }}>
              <Unknown at={askAt + ROWS.length * 4 + 4} phase={ROWS.length * 0.7} />
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
};
