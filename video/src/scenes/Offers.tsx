import React from 'react';
import { AbsoluteFill, interpolate, interpolateColors, useCurrentFrame } from 'remotion';
import { Icon, type IconName } from '../components/Icon';
import { Card } from '../components/Surfaces';
import { Headline } from '../components/Text';
import { CLAMP, EASE, mix, progress } from '../lib/motion';
import { useCue } from '../lib/scene';
import { COLOR, LAYOUT, RADIUS, TYPE } from '../theme';
import { CROSSFADE } from '../timeline';

type Part = { index: string; title: string; line: string; icon: IconName };

const PARTS: Part[] = [
  { index: '01', title: 'Websites', line: 'Built to book calls', icon: 'layout' },
  { index: '02', title: 'Automation & AI', line: 'Every lead answered', icon: 'bolt' },
  { index: '03', title: 'Apps & dashboards', line: 'Run the business', icon: 'chart' },
  { index: '04', title: 'Dedicated developers', line: 'Your own team', icon: 'users' },
];

// The tiles sit exactly on the offer rail's columns (four equal parts, 16 px apart across
// the safe width), so when the rail fades in over the last frames it lines up part for part.
const GAP = 16;
const TILE_W = (LAYOUT.width - LAYOUT.padX * 2 - GAP * 3) / 4; // 398
const TILE_H = 320;
const PAD = 32;
const HEADLINE_TOP = 290;
const TILES_TOP = 456;

// Each tile's top row is "01 ———": the index, then a 2 px bar like the rail's.
const LABEL_W = 28;
const LABEL_GAP = 14;
/** Frames between one part lighting up and the next, as "four parts" is spoken. */
const COUNT_STEP = 6;
/** Frames each bar takes to fill; with COUNT_STEP 6 the row is fully lit ~7 frames before "parts" ends. */
const FILL_DUR = 12;

/** A theme colour at an opacity, so tints stay derived from the tokens. */
const alpha = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

const Tile: React.FC<{ part: Part; enter: number; fill: number; on: number; rest: number }> = ({ part, enter, fill, on, rest }) => (
  <div
    style={{
      width: TILE_W,
      height: TILE_H,
      opacity: enter * mix(1, 0.5, rest),
      transform: `translateY(${(1 - enter) * 40}px) scale(${mix(0.97, 1, enter)})`,
      filter: enter < 1 ? `blur(${(1 - enter) * 8}px)` : undefined,
    }}
  >
    <Card padding={PAD} radius={RADIUS.lg} style={{ height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: LABEL_GAP }}>
        <span
          style={{
            ...TYPE.mono,
            fontWeight: 500,
            letterSpacing: '0.1em',
            width: LABEL_W,
            color: interpolateColors(on, [0, 1], [COLOR.fg3, COLOR.accentText]),
          }}
        >
          {part.index}
        </span>
        <div style={{ flex: 1, height: 2, borderRadius: 1, background: COLOR.line2, overflow: 'hidden' }}>
          <div style={{ width: `${fill * 100}%`, height: '100%', background: COLOR.accent }} />
        </div>
      </div>
      <div
        style={{
          marginTop: 40,
          width: 64,
          height: 64,
          borderRadius: RADIUS.md,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: interpolateColors(on, [0, 1], [alpha(COLOR.fg, 0.04), alpha(COLOR.accent, 0.14)]),
          border: `1px solid ${interpolateColors(on, [0, 1], [COLOR.line2, alpha(COLOR.accent, 0.5)])}`,
          color: interpolateColors(on, [0, 1], [COLOR.fg2, COLOR.accentText]),
        }}
      >
        <Icon name={part.icon} size={30} />
      </div>
      <div style={{ ...TYPE.h4, color: COLOR.fg, marginTop: 'auto', whiteSpace: 'nowrap' }}>{part.title}</div>
      <div style={{ ...TYPE.body, color: COLOR.fg2, marginTop: 6, whiteSpace: 'nowrap' }}>{part.line}</div>
    </Card>
  </div>
);

const Offers: React.FC = () => {
  const frame = useCurrentFrame();
  const { cue, cueEnd, scene } = useCue();

  // "what we do": the four parts arrive, 4 frames apart. All settled by ~frame 42.
  const tilesAt = cue('what', { offset: -3 });
  // "four parts": the parts are counted 01 → 04, each bar filling left to right in turn,
  // so the four bars read as one line running through the whole row.
  const countAt = cue('four', { offset: -4 });

  // As "parts" ends and the rail arrives with 01 current, parts 02–04 ease back so the eye
  // settles on Websites, which the next scene opens with ("First, websites…"). The count
  // completes ~frame 72, so the fully lit row holds for ~8 frames before the others dim.
  const restAt = cueEnd('parts', { offset: 1 });

  // The headline has said its piece once "parts" ends: it lifts out before the crossfade so
  // it never sits under the next scene's eyebrow. The tiles stay to bridge into the rail.
  const headOut = progress(frame, cueEnd('parts', { offset: -2 }), 12, EASE.inOut);

  // Slow drift so the hold never freezes; the tiles travel further than the headline.
  const drift = interpolate(frame, [0, scene.frames + CROSSFADE], [0, 1], CLAMP);

  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          left: LAYOUT.padX,
          top: HEADLINE_TOP,
          width: LAYOUT.width - LAYOUT.padX * 2,
          opacity: 1 - headOut,
          transform: `translateY(${-10 * drift - 16 * headOut}px)`,
        }}
      >
        <Headline text="Four parts. *One system.*" size="h2" at={4} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: LAYOUT.padX,
          top: TILES_TOP,
          display: 'flex',
          gap: GAP,
          // As the headline lifts out, the row eases up toward the rail it hands over to,
          // so the frame doesn't open a dead band between rail and tiles.
          transform: `translateY(${-22 * drift - 28 * headOut}px)`,
        }}
      >
        {PARTS.map((part, i) => (
          <Tile
            key={part.index}
            part={part}
            enter={progress(frame, tilesAt + i * 4, 22, EASE.out)}
            fill={progress(frame, countAt + i * COUNT_STEP, FILL_DUR, EASE.inOut)}
            on={progress(frame, countAt + i * COUNT_STEP, 10, EASE.out)}
            rest={i === 0 ? 0 : progress(frame, restAt, 10, EASE.inOut)}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
};

export default Offers;
