import React from 'react';
import { AbsoluteFill, interpolate, interpolateColors, useCurrentFrame } from 'remotion';
import { Icon } from '../components/Icon';
import { Chip } from '../components/Surfaces';
import { Eyebrow, Headline, Reveal } from '../components/Text';
import { CLAMP, EASE, mix, progress, springAt } from '../lib/motion';
import { useCue } from '../lib/scene';
import { COLOR, FONT, LAYOUT, RADIUS, SHADOW, TYPE } from '../theme';

// "Working with us is simple. We start with a strategy call about your business and
// your numbers. You watch progress on a live preview link, and a new website can go
// live in 14 days."
//
// A four-node timeline (Signal, Compose, Forge, Launch) across the frame. A progress
// head fills node to node on the voice; a 14-tick day ruler sits under the line. No day
// number rides the head (no per-phase schedule is claimed): a DAY 01 flag marks the
// strategy call, then on "14" the flag over Launch counts DAY 01 → 14 while the ruler
// sweeps and "Live in 14 days." lands top-right, above the Launch column.

const COL0 = 156; // left edge of column 1 (16 px inside the safe area, room for drift)
const COL_W = 404;
const NODE_R = 22;
const TRACK_Y = 510;
const NODE_X = [0, 1, 2, 3].map((i) => COL0 + i * COL_W + NODE_R);
const X_FIRST = NODE_X[0];
const X_LAST = NODE_X[3];
const FLAG_W = 124;
const FLAG_H = 42;
const FLAG_BOTTOM = TRACK_Y - 46;
const RULER_Y = TRACK_Y + 34;
const LABEL_TOP = TRACK_Y + 78;
const CHIP_TOP = TRACK_Y + 240;
const BRACKET_Y = CHIP_TOP - 24;
const DAYS = 14;

const PHASES = [
  { index: '01', name: 'Signal', desc: 'Strategy call' },
  { index: '02', name: 'Compose', desc: 'Design' },
  { index: '03', name: 'Forge', desc: 'Build' },
  { index: '04', name: 'Launch', desc: 'Go live' },
];

/** A theme colour at a lower opacity: alpha(COLOR.accent, 0.12). */
function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** An expanding ring that repeats every `period` frames from `start`. 0 before start. */
function ping(frame: number, start: number, period = 42): number {
  if (frame < start) return -1;
  return ((frame - start) % period) / period;
}

/** Rise-and-focus entrance style for a big word: `p` 0 → 1. */
function rise(p: number, y: number): React.CSSProperties {
  return { opacity: p, transform: `translateY(${(1 - p) * y}px)`, filter: p < 1 ? `blur(${(1 - p) * 8}px)` : undefined };
}

// ── Pieces ─────────────────────────────────────────────────────────────────────

/** A timeline node: hollow until reached, accent ring while the head sits on it, filled with a check once done. */
const Node: React.FC<{ x: number; enterAt: number; reachAt: number; doneAt: number; launch?: boolean }> = ({
  x,
  enterAt,
  reachAt,
  doneAt,
  launch = false,
}) => {
  const frame = useCurrentFrame();
  const enter = springAt(frame, enterAt, { damping: 18, stiffness: 150 });
  const reach = progress(frame, reachAt, 12);
  const done = progress(frame, doneAt, 12);
  const check = springAt(frame, doneAt + 2, { damping: 14, stiffness: 170 });
  const p = done < 1 ? ping(frame, reachAt) : -1;
  const size = NODE_R * 2;
  return (
    <div
      style={{
        position: 'absolute',
        left: x - NODE_R,
        top: TRACK_Y - NODE_R,
        width: size,
        height: size,
        opacity: Math.min(1, enter * 1.4),
        transform: `scale(${mix(0.55, 1, enter)})`,
      }}
    >
      {p >= 0 ? (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: size + p * 44,
            height: size + p * 44,
            marginLeft: -(size + p * 44) / 2,
            marginTop: -(size + p * 44) / 2,
            borderRadius: RADIUS.pill,
            border: `1.5px solid ${COLOR.accentText}`,
            opacity: (1 - p) * 0.5 * reach,
          }}
        />
      ) : null}
      {launch ? <div style={{ position: 'absolute', inset: 0, borderRadius: RADIUS.pill, boxShadow: SHADOW.accent, opacity: done }} /> : null}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: RADIUS.pill,
          background: COLOR.bg2,
          border: `1.5px solid ${interpolateColors(reach, [0, 1], [COLOR.line2, COLOR.accent])}`,
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <div style={{ position: 'absolute', inset: -1.5, borderRadius: RADIUS.pill, background: COLOR.accent, opacity: done }} />
        <div style={{ position: 'absolute', width: 6, height: 6, borderRadius: 3, background: COLOR.fg3, opacity: 1 - reach }} />
        <div style={{ position: 'relative', transform: `scale(${check})`, opacity: Math.min(1, check * 1.5) }}>
          <Icon name="check" size={22} color={COLOR.accentFg} stroke={2.4} />
        </div>
      </div>
    </div>
  );
};

/** Column label under a node: mono index, phase name, one-word descriptor. Dim until its node is reached. */
const Label: React.FC<{ x: number; index: string; name: string; desc: string; enterAt: number; reachAt: number }> = ({
  x,
  index,
  name,
  desc,
  enterAt,
  reachAt,
}) => {
  const frame = useCurrentFrame();
  const reach = progress(frame, reachAt, 14);
  return (
    <div style={{ position: 'absolute', left: x, top: LABEL_TOP }}>
      <Reveal at={enterAt} y={14} blur={4}>
        <div style={{ opacity: mix(0.42, 1, reach) }}>
          <div style={{ ...TYPE.mono, fontSize: 20, letterSpacing: '0.12em', color: interpolateColors(reach, [0, 1], [COLOR.fg3, COLOR.accentText]) }}>{index}</div>
          <div style={{ ...TYPE.h4, color: COLOR.fg, marginTop: 10 }}>{name}</div>
          <div style={{ ...TYPE.body, color: COLOR.fg2, marginTop: 2 }}>{desc}</div>
        </div>
      </Reveal>
    </div>
  );
};

/** The "14 days" counter: DAY 01 → DAY 14 over COUNT_DUR frames from `start`, eased out. */
const COUNT_DUR = 16;
function countDay(frame: number, start: number): number {
  return Math.round(mix(1, DAYS, progress(frame, start, COUNT_DUR, EASE.out)));
}

/** The (fractional) frame at which the counter first shows day `n`, so each tick lights as the counter passes it. */
function dayReachedAt(n: number, start: number): number {
  for (let t = start; t <= start + COUNT_DUR; t += 0.25) {
    if (countDay(t, start) >= n) return t;
  }
  return start + COUNT_DUR;
}

/**
 * The 14-tick day ruler under the line. It sits quiet (no day is tied to the head's
 * travel) until the "14 days" count, when each tick lights and pops as the counter passes
 * it, so the sweep reads as one wave from left to right.
 */
const Ruler: React.FC<{ enterAt: number; countAt: number }> = ({ enterAt, countAt }) => {
  const frame = useCurrentFrame();
  const step = (X_LAST - X_FIRST) / (DAYS - 1);
  return (
    <>
      {Array.from({ length: DAYS }, (_, i) => {
        const enter = progress(frame, enterAt + i * 1.5, 14);
        const at = dayReachedAt(i + 1, countAt);
        const lit = progress(frame, at, 6);
        // Grows 8 px with a small spring overshoot as the counter reaches it.
        const grow = frame >= at ? springAt(frame, at, { damping: 16, stiffness: 260 }) : 0;
        const major = i === 0 || i === 6 || i === DAYS - 1;
        const h = (major ? 20 : 12) + grow * 8;
        const color = interpolateColors(lit, [0, 0.35, 1], [alpha(COLOR.fg3, 0.8), COLOR.fg2, COLOR.accentText]);
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: X_FIRST + i * step - (major ? 1.5 : 1),
              top: RULER_Y,
              width: major ? 3 : 2,
              height: h,
              borderRadius: 1.5,
              background: color,
              opacity: enter,
              transform: `translateY(${(1 - enter) * -6}px)`,
            }}
          />
        );
      })}
    </>
  );
};

/** The mono "DAY NN" flag on a stem above node `x`. `launched` turns it solid accent. */
const DayFlag: React.FC<{ x: number; day: number; show: number; lift: number; launched: number }> = ({ x, day, show, lift, launched }) => {
  if (show <= 0) return null;
  const left = Math.min(Math.max(x - FLAG_W / 2, COL0 - 6), LAYOUT.width - LAYOUT.padX - FLAG_W - 10);
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: show, transform: `translateY(${-lift}px)` }}>
      <div
        style={{
          position: 'absolute',
          left: x - 0.5,
          top: FLAG_BOTTOM,
          width: 1,
          height: TRACK_Y - FLAG_BOTTOM - NODE_R - 4 + lift,
          background: interpolateColors(launched, [0, 1], [COLOR.line2, alpha(COLOR.accent, 0.8)]),
        }}
      />
      <div
        style={{
          position: 'absolute',
          left,
          top: FLAG_BOTTOM - FLAG_H,
          width: FLAG_W,
          height: FLAG_H,
          borderRadius: RADIUS.pill,
          display: 'grid',
          placeItems: 'center',
          background: interpolateColors(launched, [0, 1], [COLOR.surface2, COLOR.accent]),
          border: `1px solid ${interpolateColors(launched, [0, 1], [alpha(COLOR.accent, 0.5), alpha(COLOR.accent, 1)])}`,
          boxShadow: SHADOW.card,
        }}
      >
        <span
          style={{
            ...TYPE.mono,
            fontSize: 20,
            fontWeight: 500,
            letterSpacing: '0.12em',
            fontVariantNumeric: 'tabular-nums',
            color: interpolateColors(launched, [0, 1], [COLOR.accentText, COLOR.accentFg]),
          }}
        >
          DAY {String(day).padStart(2, '0')}
        </span>
      </div>
    </div>
  );
};

/** "Live preview link": a small browser-ish pill with a pulsing live dot. */
const PreviewChip: React.FC<{ at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  const p = ping(frame, at + 8, 36);
  return (
    <Reveal at={at} y={14} blur={4} scale={0.96}>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 14,
          padding: '10px 22px 10px 16px',
          borderRadius: RADIUS.pill,
          background: COLOR.surface2,
          border: `1px solid ${COLOR.line2}`,
          boxShadow: SHADOW.card,
          whiteSpace: 'nowrap',
        }}
      >
        <div style={{ display: 'flex', gap: 5, paddingRight: 14, borderRight: `1px solid ${COLOR.line2}` }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ width: 8, height: 8, borderRadius: 4, background: alpha(COLOR.fg, 0.18) }} />
          ))}
        </div>
        <Icon name="globe" size={22} color={COLOR.fg2} />
        <span style={{ ...TYPE.small, fontSize: 22, color: COLOR.fg }}>Live preview link</span>
        <span style={{ position: 'relative', width: 12, height: 12, marginLeft: 2 }}>
          {p >= 0 ? (
            <span
              style={{
                position: 'absolute',
                left: 6 - (6 + p * 12),
                top: 6 - (6 + p * 12),
                width: 12 + p * 24,
                height: 12 + p * 24,
                borderRadius: RADIUS.pill,
                border: `1.5px solid ${COLOR.success}`,
                opacity: (1 - p) * 0.6,
              }}
            />
          ) : null}
          <span style={{ position: 'absolute', inset: 0, borderRadius: 6, background: COLOR.success }} />
        </span>
      </div>
    </Reveal>
  );
};

// ── Scene ──────────────────────────────────────────────────────────────────────

const Process: React.FC = () => {
  const frame = useCurrentFrame();
  const { cue } = useCue();

  const strategy = cue('strategy call', { offset: -4 });
  const business = cue('your business', { offset: -4 });
  const watch = cue('watch progress');
  const preview = cue('live preview link', { offset: -4 });
  const goLive = cue('go live');
  const days14 = cue('14 days');
  const liveInAt = cue('live in', { offset: -3 });
  const daysAt = cue('days', { offset: -4 });

  // The head moves node to node: 1 → 2 on "watch progress", 2 → 3 on "live preview link", 3 → 4 on "go live".
  const legs = [
    { from: watch - 8, to: watch + 16 },
    { from: preview, to: preview + 30 },
    { from: goLive - 22, to: goLive + 2 },
  ];
  const f = legs.reduce((sum, l) => sum + progress(frame, l.from, l.to - l.from, EASE.inOut) / 3, 0);
  const headX = mix(X_FIRST, X_LAST, f);
  const reachAt = [strategy, legs[0].to, legs[1].to, legs[2].to];
  const doneAt = [legs[0].from, legs[1].from, legs[2].from, legs[2].to];

  // Drift: the timeline layer travels a little further than the text layer.
  const drift = interpolate(frame, [0, 340], [8, -14], CLAMP);
  const textDrift = interpolate(frame, [0, 340], [4, -6], CLAMP);

  // Entrances
  const lineIn = progress(frame, 10, 36, EASE.inOut);
  const headIn = progress(frame, strategy, 14);
  const headOut = progress(frame, goLive + 2, 12);
  const fillW = (X_LAST - X_FIRST) * f;
  const tail = progress(frame, 40, 30);

  // Day flag. It never rides the head (that would imply a per-phase schedule): DAY 01 on
  // "strategy call" over node 1, gone as the head leaves; then over node 4 it counts
  // DAY 01 → 14 on "14", in step with the ruler and the big numeral.
  const startOut = progress(frame, legs[0].from, 10);
  const startFlag = { show: headIn * (1 - startOut), lift: (1 - headIn) * -10 + startOut * 7 };
  const countAt = days14 - 6;
  const endIn = progress(frame, days14 - 8, 10);
  const endDay = countDay(frame, countAt);
  const launched = progress(frame, days14 + 10, 14);

  // "Live in 14 days."
  const liveIn = progress(frame, liveInAt, 18);
  const num = progress(frame, days14 - 5, 22);
  const daysWord = progress(frame, daysAt, 20);
  const headlineDim = progress(frame, days14 - 8, 20);

  return (
    <AbsoluteFill>
      {/* Text layer */}
      <AbsoluteFill style={{ transform: `translateX(${textDrift}px)` }}>
        <div style={{ position: 'absolute', left: LAYOUT.padX + 6, top: 168, opacity: mix(1, 0.5, headlineDim) }}>
          <Eyebrow at={2}>How it works</Eyebrow>
          <Headline text="From first call to *launch.*" at={6} size="h2" style={{ marginTop: 28 }} />
        </div>

        <div
          style={{
            position: 'absolute',
            right: LAYOUT.padX + 6,
            top: 150,
            display: 'flex',
            alignItems: 'baseline',
            gap: 22,
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ ...TYPE.h3, color: COLOR.fg2, opacity: liveIn, transform: `translateY(${(1 - liveIn) * 16}px)`, display: 'inline-block' }}>Live in</span>
          <span style={{ ...TYPE.numeral, fontVariantNumeric: 'normal', fontSize: 184, letterSpacing: '-0.02em', color: COLOR.fg, display: 'inline-block', ...rise(num, 48) }}>14</span>
          <span
            style={{
              fontFamily: FONT.serif,
              fontStyle: 'italic',
              fontWeight: 400,
              fontSize: 104,
              lineHeight: 1,
              letterSpacing: '-0.01em',
              color: COLOR.accentText,
              display: 'inline-block',
              ...rise(daysWord, 32),
            }}
          >
            days.
          </span>
        </div>
      </AbsoluteFill>

      {/* Timeline layer */}
      <AbsoluteFill style={{ transform: `translateX(${drift}px)` }}>
        {/* Base track, the dashed run-on past launch, and the accent fill */}
        <div
          style={{
            position: 'absolute',
            left: X_FIRST,
            top: TRACK_Y - 1,
            width: (X_LAST - X_FIRST) * lineIn,
            height: 2,
            borderRadius: 1,
            background: COLOR.line2,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: X_LAST + NODE_R + 10,
            top: TRACK_Y - 1,
            width: (LAYOUT.width - LAYOUT.padX - 24 - (X_LAST + NODE_R + 10)) * tail,
            height: 2,
            backgroundImage: `linear-gradient(90deg, ${COLOR.line2} 50%, transparent 50%)`,
            backgroundSize: '10px 2px',
            maskImage: 'linear-gradient(90deg, #000 30%, transparent)',
            WebkitMaskImage: 'linear-gradient(90deg, #000 30%, transparent)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: X_FIRST,
            top: TRACK_Y - 1.5,
            width: fillW,
            height: 3,
            borderRadius: 2,
            background: COLOR.accent,
            opacity: headIn,
          }}
        />

        <Ruler enterAt={24} countAt={countAt} />

        {PHASES.map((ph, i) => (
          <Node key={ph.index} x={NODE_X[i]} enterAt={12 + i * 6} reachAt={reachAt[i]} doneAt={doneAt[i]} launch={i === 3} />
        ))}

        {/* Progress head + Day N flag */}
        <div
          style={{
            position: 'absolute',
            left: headX - 7,
            top: TRACK_Y - 7,
            width: 14,
            height: 14,
            borderRadius: 7,
            background: COLOR.fg,
            boxShadow: `0 0 0 5px ${alpha(COLOR.accent, 0.35)}`,
            opacity: headIn * (1 - headOut),
            transform: `scale(${mix(0.4, 1, headIn)})`,
          }}
        />
        <DayFlag x={X_FIRST} day={1} show={startFlag.show} lift={startFlag.lift} launched={0} />
        <DayFlag x={X_LAST} day={endDay} show={endIn} lift={(1 - endIn) * -8} launched={launched} />

        {PHASES.map((ph, i) => (
          <Label key={ph.index} x={NODE_X[i] - NODE_R} index={ph.index} name={ph.name} desc={ph.desc} enterAt={16 + i * 6} reachAt={reachAt[i]} />
        ))}

        {/* 01: your business & numbers */}
        <div style={{ position: 'absolute', left: NODE_X[0] - NODE_R, top: CHIP_TOP }}>
          <Reveal at={business} y={14} blur={4} scale={0.96}>
            <Chip tone="accent" icon="chart">
              Your business & numbers
            </Chip>
          </Reveal>
        </div>

        {/* 02–03: live preview link, bracketed under Compose and Forge */}
        <Bracket at={preview - 4} />
        <div style={{ position: 'absolute', left: (NODE_X[1] + NODE_X[2]) / 2, top: CHIP_TOP, transform: 'translateX(-50%)' }}>
          <PreviewChip at={preview} />
        </div>

        {/* 04: launched */}
        <div style={{ position: 'absolute', left: NODE_X[3] - NODE_R, top: CHIP_TOP }}>
          <Reveal at={goLive - 2} y={14} blur={4} scale={0.96}>
            <Chip tone="success" icon="check">
              Website live
            </Chip>
          </Reveal>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** A hairline bracket spanning nodes 2 and 3, drawn out from its centre. */
const Bracket: React.FC<{ at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  const p = progress(frame, at, 20, EASE.inOut);
  const ends = progress(frame, at + 12, 10);
  const w = NODE_X[2] - NODE_X[1];
  const mid = (NODE_X[1] + NODE_X[2]) / 2;
  return (
    <>
      <div style={{ position: 'absolute', left: mid - (w / 2) * p, top: BRACKET_Y, width: w * p, height: 1, background: alpha(COLOR.fg3, 0.45) }} />
      {[NODE_X[1], NODE_X[2]].map((x) => (
        <div key={x} style={{ position: 'absolute', left: x - 0.5, top: BRACKET_Y - 12 * ends, width: 1, height: 12 * ends, background: alpha(COLOR.fg3, 0.45) }} />
      ))}
    </>
  );
};

export default Process;
