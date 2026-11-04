import React from 'react';
import { interpolateColors, useCurrentFrame } from 'remotion';
import { Icon } from '../../components/Icon';
import { Chip } from '../../components/Surfaces';
import { EASE, mix, progress, springAt } from '../../lib/motion';
import { useCue } from '../../lib/scene';
import { COLOR, FONT, RADIUS, SHADOW, TYPE } from '../../theme';
import { Roll, alpha } from './kit';

// Illustrative inquiries (generic first name + initial).
const ROWS = [
  { initials: 'MG', name: 'Maria G.', subject: 'Quote for a new driveway?', times: ['2m', '3h', '1d'] },
  { initials: 'JP', name: 'James P.', subject: 'Can someone come out Friday?', times: ['5m', '4h', '1d'] },
  { initials: 'PS', name: 'Priya S.', subject: 'AC stopped cooling overnight', times: ['9m', '6h', '2d'] },
  { initials: 'TR', name: 'Tom R.', subject: 'Price for a full repaint?', times: ['14m', '9h', '2d'] },
];
const ROW_H = 92;
const SIDE = 44;

/** Leak 2: inquiries age in the inbox while a competitor replies in minutes and books the job. */
export const SlowInbox: React.FC = () => {
  const frame = useCurrentFrame();
  const { cue, beatStart } = useCue();
  const enter = beatStart('leak2');
  const ageAt = cue('sit in an inbox', { beat: 'leak2', offset: -4 });
  const rivalAt = cue('answers first', { beat: 'leak2', offset: -4 });
  const wonAt = cue('wins the job', { beat: 'leak2', offset: -4 });

  // The inbox sits centred, then moves up to make room for the competitor's reply.
  const shift = progress(frame, rivalAt, 28, EASE.inOut);
  const top = mix(100, 36, shift) + mix(0, -6, progress(frame, enter, 120, EASE.inOut));
  const rival = progress(frame, rivalAt + 4, 26, EASE.out);
  const won = springAt(frame, wonAt, { damping: 14, stiffness: 180 });

  return (
    <>
      <div style={{ position: 'absolute', left: SIDE, right: SIDE, top }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, height: 52 }}>
          <Icon name="inbox" size={30} color={COLOR.fg2} />
          <div style={{ ...TYPE.h4, color: COLOR.fg }}>Inbox</div>
          <div style={{ flex: 1 }} />
          <Chip tone="accent">4 unread</Chip>
        </div>
        <div style={{ height: 1, background: COLOR.line2, marginTop: 18 }} />
        {ROWS.map((row, i) => {
          const p = progress(frame, enter + 6 + i * 4, 22, EASE.out);
          const age = [ageAt + i * 3, ageAt + 16 + i * 3];
          const warm = progress(frame, age[0], 30, EASE.inOut);
          return (
            <div
              key={row.name}
              style={{
                height: ROW_H,
                display: 'flex',
                alignItems: 'center',
                gap: 20,
                borderBottom: i < ROWS.length - 1 ? `1px solid ${COLOR.line}` : undefined,
                opacity: p * mix(1, 0.62, shift),
                transform: `translateY(${(1 - p) * 18}px)`,
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 28,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: alpha(COLOR.fg, 0.06),
                  border: `1px solid ${COLOR.line2}`,
                  fontFamily: FONT.heading,
                  fontWeight: 600,
                  fontSize: 21,
                  letterSpacing: '0.02em',
                  color: COLOR.fg2,
                }}
              >
                {row.initials}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: 27, lineHeight: 1.2, color: COLOR.fg }}>{row.name}</div>
                <div style={{ fontFamily: FONT.body, fontWeight: 400, fontSize: 26, lineHeight: 1.3, color: COLOR.fg2, whiteSpace: 'nowrap' }}>{row.subject}</div>
              </div>
              <Roll
                values={row.times}
                at={age}
                dur={12}
                width={74}
                align="right"
                sizer="00m"
                style={{ fontFamily: FONT.mono, fontWeight: 500, fontSize: 24, lineHeight: 1.3, color: interpolateColors(warm, [0, 1], [COLOR.fg3, COLOR.warn]) }}
              />
              <div style={{ width: 12, height: 12, borderRadius: 6, flexShrink: 0, background: COLOR.accent }} />
            </div>
          );
        })}
      </div>

      {rival > 0 ? (
        <div
          style={{
            position: 'absolute',
            left: SIDE,
            right: SIDE,
            top: 500,
            height: 104,
            padding: '0 24px',
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: 'center',
            gap: 20,
            borderRadius: RADIUS.md,
            background: COLOR.surface2,
            border: `1px solid ${COLOR.line2}`,
            boxShadow: SHADOW.float,
            opacity: rival,
            transform: `translateY(${(1 - rival) * 44}px)`,
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: alpha(COLOR.fg, 0.06),
              border: `1px solid ${COLOR.line2}`,
              color: COLOR.fg2,
            }}
          >
            <Icon name="send" size={24} />
          </div>
          <div style={{ flex: 1, fontFamily: FONT.body, fontSize: 27, lineHeight: 1.3, color: COLOR.fg2 }}>
            <span style={{ color: COLOR.fg, fontWeight: 600 }}>Competitor</span> · replied in{' '}
            <span style={{ color: COLOR.fg, fontWeight: 600 }}>2 min</span>
          </div>
          <div style={{ opacity: Math.min(1, won * 1.5), transform: `scale(${0.7 + 0.3 * won})` }}>
            <Chip tone="success" icon="check" size="lg">
              Booked
            </Chip>
          </div>
        </div>
      ) : null}
    </>
  );
};
