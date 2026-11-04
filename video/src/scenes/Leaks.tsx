import React from 'react';
import { AbsoluteFill, interpolateColors, useCurrentFrame } from 'remotion';
import { Card } from '../components/Surfaces';
import { Headline } from '../components/Text';
import { EASE, mix, progress } from '../lib/motion';
import { useCue } from '../lib/scene';
import { COLOR, TYPE } from '../theme';
import { Blind } from './leaks/Blind';
import { Busywork } from './leaks/Busywork';
import { NUMERAL, Roll, Slot } from './leaks/kit';
import { LookAlike } from './leaks/LookAlike';
import { SlowInbox } from './leaks/SlowInbox';

const LEFT = 140;
const COL_W = 620;
const PANEL = { left: 860, top: 200, width: 920, height: 640 };
const NUMS = ['01', '02', '03', '04'];

/** Per leak: its beat, the phrases its title and lede land on, and the copy. */
const LEAKS = [
  { beat: 'leak1', titleCue: 'looks like', ledeCue: 'shop on price', title: 'Looks like *everyone else.*', width: 560, lede: 'So customers shop on price.' },
  { beat: 'leak2', titleCue: 'slow', ledeCue: 'whoever', title: 'Slow *follow-up.*', width: COL_W, lede: 'Whoever answers first wins.' },
  { beat: 'leak3', titleCue: 'busywork', ledeCue: 'by hand', title: 'Endless *busywork.*', width: COL_W, lede: 'All by hand, after hours.' },
  { beat: 'leak4', titleCue: 'no visibility', ledeCue: 'but not', title: 'No *visibility.*', width: COL_W, lede: 'Spend in. Results unknown.' },
];

/** Big two-digit numeral with a muted leading zero. */
const Numeral: React.FC<{ n: string }> = ({ n }) => (
  <span>
    <span style={{ color: COLOR.fg3, opacity: 0.55 }}>{n[0]}</span>
    {n.slice(1)}
  </span>
);

/** Title + lede for one leak: rise in on their words, lift away when the next leak starts. */
const Copy: React.FC<{ titleAt: number; ledeAt: number; exit?: number; title: string; lede: string; width?: number }> = ({ titleAt, ledeAt, exit, title, lede, width = COL_W }) => {
  const frame = useCurrentFrame();
  const out = exit === undefined ? 0 : progress(frame, exit - 4, 14, EASE.inOut);
  if (frame < titleAt - 2 || out >= 1) return null;
  const ledeIn = progress(frame, ledeAt, 22, EASE.out);
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: COL_W,
        opacity: 1 - out,
        transform: `translateY(${-out * 26}px)`,
        filter: out > 0 ? `blur(${out * 6}px)` : undefined,
      }}
    >
      <Headline text={title} at={titleAt} size="h2" maxWidth={width} />
      <div
        style={{
          ...TYPE.lede,
          color: COLOR.fg2,
          marginTop: 26,
          opacity: ledeIn,
          transform: `translateY(${(1 - ledeIn) * 16}px)`,
          filter: ledeIn < 1 ? `blur(${(1 - ledeIn) * 5}px)` : undefined,
        }}
      >
        {lede}
      </div>
    </div>
  );
};

const Leaks: React.FC = () => {
  const frame = useCurrentFrame();
  const { cue, beatStart, scene } = useCue();

  // Each leak takes over just before its number is spoken.
  // The number rolls so it lands as it is spoken; the panel clears first, then
  // the next leak's content rises in, so two panels never share the card.
  const starts = LEAKS.map((l) => beatStart(l.beat));
  const turns = starts.map((s, i) => (i === 0 ? 0 : s - 10));
  const panelIn = starts.map((s, i) => (i === 0 ? 2 : s + 2));
  const panelOut = starts.map((_, i) => (i < starts.length - 1 ? starts[i + 1] - 14 : undefined));

  const intro = progress(frame, 2, 22, EASE.out);
  const card = progress(frame, 0, 26, EASE.out);
  // Whole-scene drift: the panel and the left column move at different rates.
  const t = progress(frame, 0, scene.frames, EASE.inOut);
  const colDrift = mix(6, -8, t);
  const panelDrift = mix(14, -16, t);

  return (
    <AbsoluteFill>
      {/* Left column */}
      <div style={{ position: 'absolute', left: LEFT, top: 0, width: COL_W, height: '100%', transform: `translateY(${colDrift}px)` }}>
        <div
          style={{
            position: 'absolute',
            top: 212,
            left: 0,
            ...TYPE.eyebrow,
            fontSize: 20,
            color: COLOR.fg3,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            opacity: intro,
            transform: `translateY(${(1 - intro) * 10}px)`,
          }}
        >
          <span>Leak</span>
          <Roll values={NUMS} at={turns.slice(1)} dur={14} style={{ color: COLOR.accentText }} />
          <span>/ 04</span>
        </div>

        {/* Four-segment progress */}
        <div style={{ position: 'absolute', top: 260, left: 0, display: 'flex', gap: 10 }}>
          {NUMS.map((n, i) => {
            const show = progress(frame, 4 + i * 3, 18, EASE.out);
            const fill = progress(frame, turns[i] + (i === 0 ? 8 : 4), 22, EASE.inOut);
            const done = i < 3 ? progress(frame, turns[i + 1], 18, EASE.inOut) : 0;
            return (
              <div
                key={n}
                style={{ width: 96, height: 4, borderRadius: 2, background: COLOR.line2, overflow: 'hidden', opacity: show }}
              >
                <div
                  style={{
                    width: `${fill * 100}%`,
                    height: '100%',
                    background: interpolateColors(done, [0, 1], [COLOR.accent, COLOR.fg3]),
                  }}
                />
              </div>
            );
          })}
        </div>

        {/* Giant numeral */}
        <div style={{ position: 'absolute', top: 300, left: -10 }}>
          <Roll
            values={NUMS.map((n) => (
              <Numeral key={n} n={n} />
            ))}
            at={turns.slice(1)}
            enter={0}
            enterDur={14}
            enterTravel={0.4}
            dur={22}
            blur={4}
            sizer="00"
            style={{ ...NUMERAL, fontSize: 240, lineHeight: 1.02, color: COLOR.fg }}
          />
        </div>

        {/* Title + lede */}
        <div style={{ position: 'absolute', top: 572, left: 0, width: COL_W }}>
          {LEAKS.map((l, i) => (
            <Copy
              key={l.beat}
              titleAt={cue(l.titleCue, { beat: l.beat, offset: -6 })}
              ledeAt={cue(l.ledeCue, { beat: l.beat, offset: -4 })}
              exit={i < LEAKS.length - 1 ? turns[i + 1] : undefined}
              title={l.title}
              lede={l.lede}
              width={l.width}
            />
          ))}
        </div>
      </div>

      {/* Right: one panel, content swaps per leak */}
      <div
        style={{
          position: 'absolute',
          left: PANEL.left,
          top: PANEL.top,
          width: PANEL.width,
          height: PANEL.height,
          opacity: card,
          transform: `translateY(${(1 - card) * 30 + panelDrift}px) scale(${0.98 + 0.02 * card})`,
        }}
      >
        <Card padding={0} style={{ width: '100%', height: '100%', overflow: 'hidden', boxSizing: 'border-box' }}>
          <Slot enter={panelIn[0]} exit={panelOut[0]}>
            <LookAlike />
          </Slot>
          <Slot enter={panelIn[1]} exit={panelOut[1]}>
            <SlowInbox />
          </Slot>
          <Slot enter={panelIn[2]} exit={panelOut[2]}>
            <Busywork />
          </Slot>
          <Slot enter={panelIn[3]}>
            <Blind />
          </Slot>
        </Card>
      </div>
    </AbsoluteFill>
  );
};

export default Leaks;
