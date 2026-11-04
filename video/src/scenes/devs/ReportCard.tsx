import React from 'react';
import { interpolateColors, useCurrentFrame } from 'remotion';
import { Icon, type IconName } from '../../components/Icon';
import { Card } from '../../components/Surfaces';
import { EASE, progress, springAt } from '../../lib/motion';
import { COLOR, FONT, RADIUS, TYPE } from '../../theme';
import { CARD_H, CARD_W, MonoLabel, tint, type DevsTiming } from './kit';

const PAD = 32;
const INNER_W = CARD_W - PAD * 2;
const HEADER_H = 68;
const RULE1_Y = PAD + HEADER_H + 16;
const LINES_Y = RULE1_Y + 12;
const LINE_H = 50;
const RULE2_Y = LINES_Y + LINE_H * 3 + 12;
const WEEK_LABEL_Y = RULE2_Y + 16;
const CELLS_Y = WEEK_LABEL_Y + 24 + 12;
const CELL_H = CARD_H - PAD - CELLS_Y;

type Line = { icon: IconName; done: boolean; lead?: string; text: string };

const LINES: Line[] = [
  { icon: 'check', done: true, text: 'Booking page shipped' },
  { icon: 'check', done: true, text: 'CRM sync fixed' },
  { icon: 'arrowRight', done: false, lead: 'Tomorrow:', text: 'invoice reminders' },
];

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const ReportLine: React.FC<{ line: Line; at: number; top: number }> = ({ line, at, top }) => {
  const frame = useCurrentFrame();
  const p = progress(frame, at, 16, EASE.out);
  const pop = springAt(frame, at + 3, { damping: 14, stiffness: 170 });
  const tone = line.done ? COLOR.success : COLOR.accentText;
  return (
    <div
      style={{
        position: 'absolute',
        left: PAD,
        top,
        height: LINE_H,
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        opacity: p,
        transform: `translateX(${(1 - p) * 18}px)`,
        filter: p < 1 ? `blur(${(1 - p) * 4}px)` : undefined,
      }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          boxSizing: 'border-box',
          borderRadius: '50%',
          background: tint(line.done ? COLOR.success : COLOR.accent, 0.13),
          border: `1px solid ${tint(line.done ? COLOR.success : COLOR.accent, 0.4)}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: tone,
          transform: `scale(${0.5 + 0.5 * pop})`,
        }}
      >
        <Icon name={line.icon} size={18} stroke={2.25} />
      </div>
      <div style={{ fontFamily: FONT.body, fontWeight: 500, fontSize: 28, letterSpacing: '-0.01em', color: COLOR.fg }}>
        {line.lead ? <span style={{ color: COLOR.fg3 }}>{line.lead} </span> : null}
        {line.text}
      </div>
    </div>
  );
};

const DayCell: React.FC<{ day: string; at: number; shownAt: number }> = ({ day, at, shownAt }) => {
  const frame = useCurrentFrame();
  const shown = progress(frame, shownAt, 16, EASE.out);
  const fill = progress(frame, at, 8, EASE.out);
  const pop = springAt(frame, at, { damping: 14, stiffness: 180 });
  return (
    <div
      style={{
        flex: 1,
        height: CELL_H,
        boxSizing: 'border-box',
        borderRadius: RADIUS.sm + 2,
        border: `1px solid ${interpolateColors(fill, [0, 1], [COLOR.line2, tint(COLOR.accent, 0.5)])}`,
        background: interpolateColors(fill, [0, 1], [tint(COLOR.fg, 0.02), tint(COLOR.accent, 0.1)]),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 12px 0 16px',
        opacity: shown,
        transform: `translateY(${(1 - shown) * 8}px)`,
      }}
    >
      <span style={{ fontFamily: FONT.body, fontWeight: 500, fontSize: 22, color: interpolateColors(fill, [0, 1], [COLOR.fg3, COLOR.fg]) }}>{day}</span>
      <div style={{ position: 'relative', width: 30, height: 30 }}>
        <div style={{ position: 'absolute', inset: 0, boxSizing: 'border-box', borderRadius: '50%', border: `1px solid ${COLOR.line2}` }} />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: COLOR.accent,
            color: COLOR.accentFg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: Math.min(1, pop * 1.5),
            transform: `scale(${pop})`,
          }}
        >
          <Icon name="check" size={17} stroke={2.5} />
        </div>
      </div>
    </div>
  );
};

/**
 * "Daily report · Today": emerges beside the profile card on "reporting to you every day",
 * builds line by line, then the Mon–Fri strip ticks on "every day".
 */
export const ReportCard: React.FC<{ t: DevsTiming }> = ({ t }) => {
  const frame = useCurrentFrame();
  if (frame < t.report) return null;
  const shown = springAt(frame, t.report, { stiffness: 90 });
  const rule1 = progress(frame, t.report + 6, 18, EASE.inOut);
  const rule2 = progress(frame, t.lines[2] + 2, 18, EASE.inOut);
  // Build order: lines, then the second rule, then the label, then the day cells.
  const weekLabel = progress(frame, t.lines[2] + 6, 16, EASE.out);
  return (
    <div
      style={{
        position: 'relative',
        width: CARD_W,
        height: CARD_H,
        opacity: Math.min(1, shown * 1.4),
        // Follows the profile card's leftward move and rises into place; the right edge
        // is pinned so it never crosses the safe area (x 1780) on the way in.
        transform: `translate(${(1 - shown) * -48}px, ${(1 - shown) * 24}px) scale(${0.96 + 0.04 * shown})`,
        transformOrigin: '100% 50%',
      }}
    >
      <Card padding={0} style={{ position: 'absolute', inset: 0 }}>
        {/* Header */}
        <div style={{ position: 'absolute', left: PAD, top: PAD, width: INNER_W, height: HEADER_H, display: 'flex', alignItems: 'center', gap: 18 }}>
          <div
            style={{
              width: 56,
              height: 56,
              flexShrink: 0,
              boxSizing: 'border-box',
              borderRadius: RADIUS.md,
              background: tint(COLOR.accent, 0.14),
              border: `1px solid ${tint(COLOR.accent, 0.45)}`,
              color: COLOR.accentText,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="mail" size={28} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ ...TYPE.h4, color: COLOR.fg, whiteSpace: 'nowrap' }}>
              Daily report<span style={{ color: COLOR.fg3 }}> · Today</span>
            </div>
            <div style={{ fontFamily: FONT.body, fontWeight: 400, fontSize: 22, lineHeight: '28px', color: COLOR.fg3 }}>Sent to you · 5:30 PM</div>
          </div>
        </div>
        <div
          style={{ position: 'absolute', left: PAD, top: RULE1_Y, width: INNER_W, height: 1, background: COLOR.line2, transform: `scaleX(${rule1})`, transformOrigin: '0 50%' }}
        />

        {/* Lines */}
        {LINES.map((line, i) => (
          <ReportLine key={line.text} line={line} at={t.lines[i]} top={LINES_Y + i * LINE_H} />
        ))}
        <div
          style={{ position: 'absolute', left: PAD, top: RULE2_Y, width: INNER_W, height: 1, background: COLOR.line2, transform: `scaleX(${rule2})`, transformOrigin: '0 50%' }}
        />

        {/* Mon–Fri */}
        <MonoLabel style={{ position: 'absolute', left: PAD, top: WEEK_LABEL_Y, opacity: weekLabel, transform: `translateY(${(1 - weekLabel) * 8}px)` }}>
          This week
        </MonoLabel>
        <div style={{ position: 'absolute', left: PAD, top: CELLS_Y, width: INNER_W, display: 'flex', gap: 12 }}>
          {DAYS.map((day, i) => (
            <DayCell key={day} day={day} shownAt={t.lines[2] + 8 + i * 2} at={t.week + i * 5} />
          ))}
        </div>
      </Card>
    </div>
  );
};
