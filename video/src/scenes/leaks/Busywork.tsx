import React from 'react';
import { useCurrentFrame } from 'remotion';
import { Icon, type IconName } from '../../components/Icon';
import { Chip } from '../../components/Surfaces';
import { EASE, mix, progress, springAt } from '../../lib/motion';
import { useCue } from '../../lib/scene';
import { COLOR, FONT, RADIUS, SHADOW, TYPE } from '../../theme';
import { NUMERAL, Roll, alpha } from './kit';

type Chore = { icon: IconName; cue: string; label: string; overdue?: string };

// Illustrative chores, one per spoken word.
const CHORES: Chore[] = [
  { icon: 'file', cue: 'Quotes', label: 'Send quote: Hendricks' },
  { icon: 'clock', cue: 'reminders', label: 'Reminder: Tue 9:00 AM' },
  { icon: 'calendar', cue: 'scheduling', label: 'Reschedule Friday crew' },
  { icon: 'dollar', cue: 'invoices', label: 'Invoice #1042:', overdue: '34 days overdue' },
];

const SIDE = 44;
const TOP = 150;
const ROW_H = 96;
const STEP = 112;

/** Leak 3: chores pile up one per word (newest on top), then the clock says it's nearly midnight. */
export const Busywork: React.FC = () => {
  const frame = useCurrentFrame();
  const { cue, beatStart } = useCue();
  const enter = beatStart('leak3');
  const at = CHORES.map((c) => cue(c.cue, { beat: 'leak3', offset: -4 }));
  const nightAt = cue('kitchen table', { beat: 'leak3', offset: -6 });

  const night = progress(frame, nightAt, 30, EASE.out);
  const head = progress(frame, enter - 2, 18, EASE.out);
  const countIn = progress(frame, at[0], 16, EASE.out);
  // Slow sink of the pile so the held frame keeps breathing.
  const sink = mix(0, 10, progress(frame, at[0], 200, EASE.inOut));

  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: SIDE,
          right: SIDE,
          top: 44,
          height: 64,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          opacity: head,
          transform: `translateY(${(1 - head) * 12}px)`,
        }}
      >
        <Icon name="layers" size={30} color={COLOR.fg2} />
        <div style={{ ...TYPE.h4, color: COLOR.fg }}>To do</div>
        <div style={{ opacity: countIn, transform: `translateY(${(1 - countIn) * 8}px)` }}>
          <Chip tone="neutral" style={{ gap: 8 }}>
            <Roll values={['1', '2', '3', '4']} at={at.slice(1)} dur={12} sizer="0" style={{ fontVariantNumeric: 'tabular-nums' }} />
            <span>open</span>
          </Chip>
        </div>
        <div style={{ flex: 1 }} />
        {night > 0 ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '10px 22px 10px 16px',
              borderRadius: RADIUS.pill,
              background: COLOR.bg2,
              border: `1px solid ${COLOR.line2}`,
              opacity: night,
              transform: `translateY(${(1 - night) * -14}px)`,
            }}
          >
            <Icon name="moon" size={26} color={COLOR.accentText} />
            <span style={{ ...NUMERAL, fontSize: 40, lineHeight: 1, letterSpacing: '0.01em', fontVariantNumeric: 'proportional-nums', color: COLOR.fg }}>
              11:42 <span style={{ fontSize: 26, letterSpacing: '0.02em', color: COLOR.fg2 }}>PM</span>
            </span>
          </div>
        ) : null}
      </div>

      {/* Empty slots waiting to be filled: the list is the shape of the evening. */}
      {CHORES.map((_, k) => {
        const show = progress(frame, enter + 4 + k * 4, 20, EASE.out) * (1 - progress(frame, at[k] + 6, 14, EASE.out));
        if (show <= 0) return null;
        return (
          <div
            key={`slot-${k}`}
            style={{
              position: 'absolute',
              left: SIDE,
              right: SIDE,
              top: TOP + k * STEP + sink,
              height: ROW_H,
              borderRadius: RADIUS.md,
              border: `1px dashed ${COLOR.line2}`,
              opacity: show * 0.8,
            }}
          />
        );
      })}

      {CHORES.map((chore, i) => {
        if (frame < at[i]) return null;
        const drop = springAt(frame, at[i], { damping: 16, stiffness: 150 });
        // Every later chore lands on top and pushes this one down a slot.
        let pushed = 0;
        for (let j = i + 1; j < CHORES.length; j++) pushed += progress(frame, at[j] - 8, 16, EASE.inOut);
        const top = TOP + pushed * STEP + (1 - drop) * -28 + sink;
        const overdue = Boolean(chore.overdue);
        const dim = overdue ? 1 : mix(1, 0.72, night);
        return (
          <div
            key={chore.label}
            style={{
              position: 'absolute',
              left: SIDE,
              right: SIDE,
              top,
              height: ROW_H,
              zIndex: 10 + i,
              padding: '0 28px 0 22px',
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'center',
              gap: 22,
              borderRadius: RADIUS.md,
              background: overdue ? `linear-gradient(0deg, ${alpha(COLOR.danger, 0.07)}, ${alpha(COLOR.danger, 0.07)}), ${COLOR.surface2}` : COLOR.surface2,
              border: `1px solid ${overdue ? alpha(COLOR.danger, 0.45) : COLOR.line2}`,
              boxShadow: SHADOW.card,
              opacity: Math.min(1, drop * 1.6) * dim,
              // Square rows; the pile is sold by motion: each lands with a small settle in scale.
              transform: `scale(${mix(0.96, 1, drop)})`,
            }}
          >
            <div
              style={{
                width: 54,
                height: 54,
                borderRadius: RADIUS.sm,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: overdue ? alpha(COLOR.danger, 0.12) : alpha(COLOR.fg, 0.05),
                border: `1px solid ${overdue ? alpha(COLOR.danger, 0.35) : COLOR.line2}`,
                color: overdue ? COLOR.danger : COLOR.fg2,
              }}
            >
              <Icon name={chore.icon} size={26} />
            </div>
            <div style={{ flex: 1, fontFamily: FONT.body, fontWeight: 500, fontSize: 29, lineHeight: 1.2, color: COLOR.fg, whiteSpace: 'nowrap' }}>
              {chore.label}
              {chore.overdue ? <span style={{ color: COLOR.danger }}> {chore.overdue}</span> : null}
            </div>
            {overdue ? (
              <Icon name="alert" size={28} color={COLOR.danger} />
            ) : (
              <div style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, border: `2px solid ${COLOR.fg3}` }} />
            )}
          </div>
        );
      })}
    </>
  );
};
