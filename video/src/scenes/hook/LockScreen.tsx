import React from 'react';
import { random } from 'remotion';
import { Icon } from '../../components/Icon';
import { EASE, mix } from '../../lib/motion';
import { COLOR, FONT, RADIUS, SHADOW } from '../../theme';

/** Minutes past midnight when the inquiry arrives: 9:04 PM. */
export const ARRIVAL = 21 * 60 + 4;

const smooth = (t: number) => EASE.inOut(Math.min(1, Math.max(0, t)));

/** How far a wheel showing floor(v) has rolled toward the next value (0..1), in the last 40% of each step. */
const rollOf = (v: number) => smooth((v - Math.floor(v) - 0.6) / 0.4);

/** One slot of an odometer: the current label, the next one rising in underneath. */
const Wheel: React.FC<{ cur: string; next: string; roll: number; width?: string; align?: 'left' | 'right' | 'center' }> = ({
  cur,
  next,
  roll,
  width,
  align = 'center',
}) => (
  <span style={{ position: 'relative', display: 'inline-block', overflow: 'hidden', height: '1.08em', width, textAlign: align, verticalAlign: 'top' }}>
    <span style={{ display: 'block', transform: `translateY(${-roll * 100}%)`, opacity: 1 - roll * 0.6 }}>{cur}</span>
    <span style={{ position: 'absolute', left: 0, right: 0, top: 0, transform: `translateY(${(1 - roll) * 100}%)`, opacity: 0.4 + roll * 0.6 }}>
      {next}
    </span>
  </span>
);

const DIGIT_EM = 0.6;
const h12 = (h: number) => String(h % 12 || 12);

/** The lock-screen clock. `t` is minutes past midnight (fractional while fast-forwarding). */
const Clock: React.FC<{ t: number }> = ({ t }) => {
  const units = rollOf(t);
  const whole = Math.floor(t);
  const min = whole % 60;
  const hour = Math.floor(whole / 60) % 24;
  const tensRoll = whole % 10 === 9 ? units : 0;
  const hourRoll = min === 59 ? units : 0;
  const nextHour = (hour + 1) % 24;
  const meridiem = hour >= 12 ? 'PM' : 'AM';
  const nextMeridiem = nextHour >= 12 ? 'PM' : 'AM';
  const hourWidth = mix(h12(hour).length, h12(nextHour).length, hourRoll) * DIGIT_EM;
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', color: COLOR.fg }}>
      <div
        style={{
          fontFamily: FONT.heading,
          fontWeight: 500,
          fontSize: 84,
          lineHeight: 1,
          letterSpacing: '-0.04em',
          fontVariantNumeric: 'tabular-nums',
          display: 'flex',
        }}
      >
        <Wheel cur={h12(hour)} next={h12(nextHour)} roll={hourRoll} width={`${hourWidth}em`} align="right" />
        <span style={{ margin: '0 0.02em', transform: 'translateY(-0.06em)' }}>:</span>
        <Wheel cur={String(Math.floor(min / 10))} next={String(Math.floor(((min + 1) % 60) / 10))} roll={tensRoll} width={`${DIGIT_EM}em`} />
        <Wheel cur={String(min % 10)} next={String((min + 1) % 10)} roll={units} width={`${DIGIT_EM}em`} />
      </div>
      <div style={{ fontFamily: FONT.heading, fontWeight: 500, fontSize: 26, letterSpacing: '0.02em', color: COLOR.fg2, marginTop: 12, marginLeft: 6 }}>
        <Wheel cur={meridiem} next={nextMeridiem} roll={meridiem === nextMeridiem ? 0 : hourRoll} />
      </div>
    </div>
  );
};

// Two bands of sky, above and below the notification (which sits at ~44-76% of the
// screen), so no star ever shows through the card while it fades in. Upper-band stars
// keep to the sides so none sits beside the date or clock and reads as punctuation.
const STARS = Array.from({ length: 16 }, (_, i) => ({
  x:
    i < 11
      ? (i % 2 ? 84 : 4) + random(`hook-star-x-${i}`) * 12
      : 6 + random(`hook-star-x-${i}`) * 88,
  y: i < 11 ? 4 + random(`hook-star-y-${i}`) * 36 : 80 + random(`hook-star-y-${i}`) * 12,
  r: 1 + random(`hook-star-r-${i}`) * 1.4,
  a: 0.18 + random(`hook-star-a-${i}`) * 0.32,
}));

/**
 * The phone's lock screen through one night.
 * `t` clock minutes past midnight (can exceed 1440), `dawn` 0..1, `notif` 0..1 entrance,
 * `age` label for the notification ("now", "11h ago"), `wake` 0..1 screen brightness pulse.
 */
export const LockScreen: React.FC<{ t: number; dawn: number; notif: number; age: string; wake: number }> = ({ t, dawn, notif, age, wake }) => {
  const clockT = t % 1440;
  const pastMidnight = t >= 1440;
  const day = pastMidnight ? 'Wednesday, May 13' : 'Tuesday, May 12';
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {/* Night sky: a faint blue wash up top, fading as morning comes. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(120% 70% at 50% 0%, ${COLOR.accent}, transparent 70%)`,
          opacity: 0.16 * (1 - dawn * 0.8),
        }}
      />
      {/* Dawn: the whole screen lifts from bg toward surface2, a little more toward the bottom. */}
      <div style={{ position: 'absolute', inset: 0, background: COLOR.surface2, opacity: dawn * 0.65 }} />
      <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, transparent 30%, ${COLOR.line} 100%)`, opacity: dawn }} />
      {STARS.map((s, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.r * 2,
            height: s.r * 2,
            borderRadius: s.r,
            background: COLOR.fg,
            opacity: s.a * (1 - dawn),
          }}
        />
      ))}
      {/* Screen wakes when the notification lands. */}
      <div style={{ position: 'absolute', inset: 0, background: COLOR.line, opacity: wake * 0.75 }} />

      <div style={{ position: 'absolute', top: 78, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <Icon name="lock" size={20} color={COLOR.fg2} />
        <div style={{ fontFamily: FONT.body, fontWeight: 500, fontSize: 20, color: COLOR.fg2, marginTop: 12, marginBottom: 6 }}>{day}</div>
        <Clock t={clockT} />
      </div>

      {/* The inquiry. */}
      <div
        style={{
          position: 'absolute',
          top: 296,
          left: 12,
          right: 12,
          opacity: notif,
          transform: `translateY(${(1 - notif) * -40}px) scale(${0.96 + notif * 0.04})`,
          transformOrigin: '50% 0%',
        }}
      >
        <div
          style={{
            position: 'relative',
            borderRadius: RADIUS.lg,
            border: `1px solid ${COLOR.line2}`,
            boxShadow: SHADOW.card,
            padding: '16px 18px 18px',
          }}
        >
          <div style={{ position: 'absolute', inset: 0, borderRadius: RADIUS.lg, background: COLOR.surface2, opacity: 0.95 }} />
          <div style={{ position: 'absolute', inset: 0, borderRadius: RADIUS.lg, background: COLOR.line }} />
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 9,
                background: COLOR.accent,
                color: COLOR.accentFg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Icon name="globe" size={20} />
            </div>
            <div style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: 20, color: COLOR.fg2, flex: 1, whiteSpace: 'nowrap' }}>Website</div>
            <div style={{ fontFamily: FONT.body, fontWeight: 500, fontSize: 20, color: COLOR.fg3, whiteSpace: 'nowrap' }}>{age}</div>
          </div>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
            <span style={{ width: 10, height: 10, borderRadius: 5, background: COLOR.accent, flexShrink: 0 }} />
            <div style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: 24, color: COLOR.fg }}>New inquiry</div>
          </div>
          <div style={{ position: 'relative', fontFamily: FONT.body, fontWeight: 400, fontSize: 26, lineHeight: 1.25, color: COLOR.fg2, marginTop: 6 }}>
            Hi! Can someone quote a repair this week?
          </div>
        </div>
      </div>

      {/* Home indicator. */}
      <div style={{ position: 'absolute', bottom: 12, left: '50%', width: 120, height: 5, marginLeft: -60, borderRadius: 3, background: COLOR.fg2, opacity: 0.7 }} />
    </div>
  );
};
