import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { Icon } from '../components/Icon';
import { PhoneFrame, Chip } from '../components/Surfaces';
import { Eyebrow, Headline } from '../components/Text';
import { CLAMP, EASE, mix, progress, springAt } from '../lib/motion';
import { useCue } from '../lib/scene';
import { COLOR, TYPE } from '../theme';
import { ARRIVAL, LockScreen } from './hook/LockScreen';

/** The night the lead waits through: 9:04 PM to 8:04 AM. */
const NIGHT = 11 * 60;
const FF_DUR = 45;

const PHONE = { x: 300, y: 160, w: 340, h: 700 };
/** Where the phone opens: alone in the middle of the frame. */
const PHONE_CENTER_X = (1920 - PHONE.w) / 2;
/** Right column: a vertical log of the night. */
const COL = 860;
const RAIL_X = 8;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Fade + lift out, for things leaving mid-scene. `blur` only for small (< 800 px) nodes. */
function exitStyle(frame: number, at: number, dur = 16, blur = false): React.CSSProperties {
  const p = progress(frame, at, dur, EASE.inOut);
  return {
    opacity: 1 - p,
    transform: `translateY(${-p * 18}px)`,
    filter: blur && p > 0 && p < 1 ? `blur(${p * 6}px)` : undefined,
  };
}

/** Fade + rise in. */
function enterStyle(frame: number, at: number, dur = 20, y = 18): React.CSSProperties {
  const p = progress(frame, at, dur, EASE.out);
  return {
    opacity: p,
    transform: `translateY(${(1 - p) * y}px)`,
    filter: p < 1 ? `blur(${(1 - p) * 5}px)` : undefined,
  };
}

/** A node on the log's rail. `beacon` keeps a soft ring breathing out of it after it lands. */
const Node: React.FC<{ color: string; at: number; beacon?: boolean }> = ({ color, at, beacon }) => {
  const frame = useCurrentFrame();
  const p = springAt(frame, at, { damping: 16, stiffness: 160 });
  const BEAT = 42;
  const since = frame - at - 12;
  const cycle = EASE.out(since > 0 ? (since % BEAT) / BEAT : 0);
  return (
    <>
      {beacon && since > 0 ? (
        <div
          style={{
            // Starts just outside the node's 6 px bg halo (30 px) so it is never hidden.
            position: 'absolute',
            left: RAIL_X - 15,
            top: -6,
            width: 30,
            height: 30,
            borderRadius: 15,
            border: `1.5px solid ${color}`,
            opacity: 0.6 * (1 - cycle),
            transform: `scale(${1 + cycle * 1.1})`,
          }}
        />
      ) : null}
      <div
        style={{
          position: 'absolute',
          left: RAIL_X - 9,
          top: 0,
          width: 18,
          height: 18,
          borderRadius: 9,
          background: color,
          border: `2px solid ${color}`,
          boxShadow: `0 0 0 6px ${COLOR.bg}`,
          transform: `scale(${p})`,
        }}
      />
    </>
  );
};

const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const { cue, scene } = useCue();

  const notifAt = cue('fills out the form', { offset: -4 });
  // The log's eyebrow arrives with the log, once the phone has moved aside.
  const eyebrowAt = notifAt + 2;
  const nightAt = cue('nobody answers', { offset: -10 });
  const ffAt = cue('nobody answers', { offset: -2 });
  const lostAt = cue('booked someone else', { offset: -4 });
  const clearAt = cue('not bad luck', { offset: -20 });
  const luckAt = cue('not bad luck', { offset: -4 });
  const systemsAt = cue('systems problem', { offset: -7 });

  // The night, fast-forwarded: minutes since the inquiry arrived.
  const ff = progress(frame, ffAt, FF_DUR, EASE.inOut);
  const elapsed = ff * NIGHT;
  const dawn = progress(frame, ffAt + 6, FF_DUR, EASE.inOut);
  const hours = Math.floor(elapsed / 60);
  const age = elapsed < 1 ? 'now' : elapsed < 60 ? `${Math.floor(elapsed)}m ago` : `${hours}h ago`;

  const notif = springAt(frame, notifAt, { damping: 18, stiffness: 130 });
  const wake = interpolate(frame, [notifAt, notifAt + 4, notifAt + 40], [0, 1, 0], { ...CLAMP, easing: EASE.out });

  // Phone: opens alone, centred, then glides aside as the inquiry arrives; slow drift,
  // a dim when the lead is lost, then it recedes for the reframe.
  const lost = progress(frame, lostAt, 24, EASE.out);
  const recede = progress(frame, clearAt + 4, 34, EASE.inOut);
  const drift = interpolate(frame, [0, scene.frames], [4, -20], CLAMP);
  const phoneIn = progress(frame, 0, 30, EASE.out);
  const glide = progress(frame, notifAt - 10, 24, EASE.inOut);
  const phoneX = mix(PHONE_CENTER_X, PHONE.x, glide);
  const phoneScale = mix(1.03, 1, glide) * mix(1, 0.94, recede) * mix(0.97, 1, phoneIn);
  const phoneOpacity = phoneIn * mix(1, 0.4, recede);

  // Right column parallax, plus a slow push through the "lead lost" hold.
  const colDrift = interpolate(frame, [0, scene.frames], [20, -20], CLAMP);
  const colPush = mix(1, 1.025, progress(frame, lostAt, clearAt + 16 - lostAt, EASE.inOut));

  // Unanswered segment: from moon to sun.
  const RAIL_TOP = 132;
  const RAIL_LEN = 300;
  const railIn = progress(frame, nightAt, 22, EASE.inOut);
  const sunOn = progress(frame, ffAt + FF_DUR - 8, 14, EASE.out);
  const pulse = 0.55 + 0.45 * Math.sin((frame - nightAt) / 6);

  return (
    <AbsoluteFill>
      {/* Phone on the left. */}
      <div
        style={{
          position: 'absolute',
          left: phoneX,
          top: PHONE.y,
          transform: `translateY(${drift + (1 - phoneIn) * 24}px) scale(${phoneScale})`,
          transformOrigin: '50% 50%',
          opacity: phoneOpacity,
        }}
      >
        <PhoneFrame width={PHONE.w} height={PHONE.h} screen={COLOR.bg}>
          <LockScreen t={ARRIVAL + elapsed} dawn={dawn} notif={notif} age={age} wake={wake} />
          <div style={{ position: 'absolute', inset: 0, background: COLOR.bg, opacity: lost * 0.32 }} />
        </PhoneFrame>
      </div>

      {/* Right column: the night as a log. */}
      <div
        style={{
          position: 'absolute',
          left: COL,
          top: 214,
          width: 980,
          height: 640,
          transform: `translateY(${colDrift}px) scale(${colPush})`,
          transformOrigin: '0% 50%',
        }}
      >
        <div style={{ width: 'fit-content', ...exitStyle(frame, clearAt, 16, true) }}>
          <Eyebrow at={eyebrowAt}>After hours</Eyebrow>
        </div>

        {/* The connector from the inquiry node straight into the moon ring. */}
        <div
          style={{
            position: 'absolute',
            left: RAIL_X - 1,
            top: 71,
            width: 2,
            height: (RAIL_TOP + 6 - 71) * progress(frame, notifAt + 6, 20),
            background: COLOR.line2,
            ...exitStyle(frame, clearAt + 4),
          }}
        />

        {/* 9:04 PM: the inquiry arrives. */}
        <div style={{ position: 'absolute', top: 62, left: 0, width: 760, ...exitStyle(frame, clearAt + 2) }}>
          <Node color={COLOR.accent} at={notifAt + 2} />
          <div style={{ marginLeft: 48, marginTop: -6, width: 'fit-content', ...enterStyle(frame, notifAt + 4) }}>
            <div style={{ ...TYPE.mono, fontSize: 22, color: COLOR.accentText }}>9:04 PM</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 8 }}>
              <div style={{ ...TYPE.h3, color: COLOR.fg }}>New inquiry</div>
              <Chip icon="globe">Website form</Chip>
            </div>
          </div>
        </div>

        {/* The rail from the inquiry down to morning. */}
        <div style={{ position: 'absolute', top: RAIL_TOP, left: 0, width: 760, height: RAIL_LEN + 80, ...exitStyle(frame, clearAt + 4) }}>
          {/* Moon to sun: starts and ends inside the rings so no gap shows while they scale in. */}
          <div style={{ position: 'absolute', left: RAIL_X - 1, top: 34, width: 2, height: (RAIL_LEN + 12) * railIn, background: COLOR.line2 }}>
            <div style={{ width: '100%', height: `${ff * 100}%`, background: COLOR.warn, opacity: 0.75 }} />
          </div>
          <div
            style={{
              position: 'absolute',
              left: RAIL_X - 20,
              top: 0,
              width: 40,
              height: 40,
              borderRadius: 20,
              background: COLOR.surface2,
              border: `1px solid ${COLOR.line2}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: COLOR.fg2,
              opacity: railIn,
              transform: `scale(${mix(0.6, 1, railIn)})`,
            }}
          >
            <Icon name="moon" size={20} />
          </div>
          <div
            style={{
              position: 'absolute',
              left: RAIL_X - 20,
              top: RAIL_LEN + 40,
              width: 40,
              height: 40,
              borderRadius: 20,
              background: COLOR.surface2,
              border: `1px solid ${COLOR.line2}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: sunOn > 0.5 ? COLOR.fg : COLOR.fg3,
              opacity: railIn * mix(0.7, 1, sunOn),
              transform: `scale(${mix(0.6, 1, railIn) * mix(0.9, 1, sunOn)})`,
            }}
          >
            <Icon name="sun" size={20} />
          </div>

          {/* Unanswered counter. */}
          <div style={{ position: 'absolute', left: 48, top: 78, ...enterStyle(frame, nightAt + 2, 22) }}>
            <div style={{ ...TYPE.eyebrow, fontSize: 20, color: COLOR.warn, display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 10, height: 10, borderRadius: 5, background: COLOR.warn, opacity: pulse }} />
              Unanswered
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 18, marginTop: 18 }}>
              <div style={{ ...TYPE.numeral, fontSize: 184, color: COLOR.fg }}>
                {hours}
                <span style={{ fontSize: 112, color: COLOR.fg2, letterSpacing: '-0.02em' }}>h</span>
              </div>
              <div style={{ ...TYPE.numeral, fontSize: 84, color: COLOR.fg3 }}>
                {pad2(Math.floor(elapsed % 60))}
                <span style={{ fontSize: 56 }}>m</span>
              </div>
            </div>
          </div>
        </div>

        {/* 8:04 AM: they booked someone else. */}
        <div style={{ position: 'absolute', top: RAIL_TOP + RAIL_LEN + 136, left: 0, width: 760, ...exitStyle(frame, clearAt + 6) }}>
          <div style={{ position: 'absolute', left: RAIL_X - 1, top: -54, width: 2, height: 54 * progress(frame, lostAt - 4, 10), background: COLOR.line2 }} />
          <Node color={COLOR.danger} at={lostAt} beacon />
          <div style={{ marginLeft: 48, marginTop: -6, width: 'fit-content', display: 'flex', alignItems: 'center', gap: 20, ...enterStyle(frame, lostAt + 2) }}>
            <div style={{ ...TYPE.mono, fontSize: 22, color: COLOR.danger }}>8:04 AM</div>
            <div style={{ transform: `scale(${mix(0.92, 1, springAt(frame, lostAt + 4, { damping: 15, stiffness: 170 }))})`, transformOrigin: '0% 50%' }}>
              <Chip tone="danger" icon="x" size="lg">
                Lead lost: booked elsewhere
              </Chip>
            </div>
          </div>
        </div>
      </div>

      {/* The reframe. */}
      <div style={{ position: 'absolute', left: COL, top: 400, width: 980, transform: `translateY(${colDrift * 0.6}px)` }}>
        <Headline text="Not bad luck." size="h2" color={COLOR.fg2} at={luckAt} />
        <Headline text="A *systems problem.*" size="h1" at={systemsAt} stagger={2.5} style={{ marginTop: 28 }} />
      </div>
    </AbsoluteFill>
  );
};

export default Hook;
