import React from 'react';
import { AbsoluteFill, interpolateColors, useCurrentFrame } from 'remotion';
import { Icon, type IconName } from '../components/Icon';
import { Headline } from '../components/Text';
import { EASE, mix, progress, springAt } from '../lib/motion';
import { useCue } from '../lib/scene';
import { COLOR, FONT, RADIUS, SHADOW, TYPE } from '../theme';

/**
 * reframe: "Most owners try to fix that with five different vendors. What you need is
 * one team that builds the whole system."
 *
 * Three states:
 *  1. "Five vendors?" alone in the middle of the frame.
 *  2. On "five different vendors" the line lifts to the top and five vendor cards land
 *     in a slightly messy row (tilted, uneven), each drifting on its own.
 *  3. On "one team" the cards straighten, shrink and file into one glowing NIXGEN. card
 *     as five aligned modules; on "the whole system" an accent line connects them.
 */

const CX = 960;
const CY = 560;

/** The accent token with an alpha, so every colour still comes from COLOR. */
const alpha = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

// Headline positions (top of the text block).
const HEAD_TOP = 196;
const HEAD_CENTER_TOP = 462;

// State 2: the vendor row.
const CARD_W = 272;
const CARD_H = 200;
const CARD_PAD = 26;
const ICON_TILE = 60;
const ROW_Y = 560;
const ROW_PITCH = 322;

// State 3: one card, wordmark over five modules.
const BOX_W = 880;
const BOX_H = 372;
const BOX_Y = 566;
const BOX_PAD = 60;
const TILE = 72;
const TILE_PITCH = 128;
const TILE_Y = BOX_Y + BOX_H / 2 - BOX_PAD - TILE / 2;
const WORDMARK_SIZE = 132;

const LINE_DUR = 28;

/** The convergence: tight enough that the tiles reach size in ~14 frames, no overshoot. */
const MERGE_SPRING = { stiffness: 130 };
/** The NIXGEN. card starts from this scale, so its edge is known while it forms. */
const BOX_FROM = 0.96;

/** First frame at which the outermost vendor card sits fully inside the forming card. */
function boxFrame(mergeAt: number): number {
  const half = (BOX_W * BOX_FROM) / 2 - 12;
  for (let f = 0; f < 60; f++) {
    const m = springAt(mergeAt + f, mergeAt, MERGE_SPRING);
    const edge = mix(2 * ROW_PITCH, 2 * TILE_PITCH, m) + mix(CARD_W, TILE, m) / 2;
    if (edge <= half) return mergeAt + f;
  }
  return mergeAt + 60;
}
/**
 * Half the rendered width of " The whole system." in the h2 headline. "One team." holds
 * the centre on its own, then slides left by this much as the second half rises.
 */
const HEAD_SHIFT = 261;

type Vendor = { label: string; icon: IconName; dy: number; rot: number; phase: number; delay: number };

const VENDORS: Vendor[] = [
  { label: 'Web designer', icon: 'layout', dy: 16, rot: -2, phase: 0, delay: 0 },
  { label: 'SEO agency', icon: 'search', dy: -18, rot: 1.5, phase: 37, delay: 5 },
  { label: 'App developer', icon: 'code', dy: 8, rot: -0.9, phase: 71, delay: 10 },
  { label: 'Automation freelancer', icon: 'bolt', dy: -22, rot: 1.9, phase: 19, delay: 14 },
  { label: 'IT help', icon: 'wrench', dy: 14, rot: -1.6, phase: 53, delay: 19 },
];

/** One vendor: a small card that later shrinks into a module of the NIXGEN. card. */
const VendorCard: React.FC<{ index: number; enterAt: number; mergeAt: number; litAt: number }> = ({
  index,
  enterAt,
  mergeAt,
  litAt,
}) => {
  const frame = useCurrentFrame();
  const v = VENDORS[index];
  const enter = progress(frame, enterAt, 22, EASE.out);
  // Critically damped: starts from rest, settles without overshoot.
  const m = springAt(frame, mergeAt, MERGE_SPRING);
  const lit = progress(frame, litAt, 12, EASE.out);

  // Each vendor drifts on its own rhythm until they merge; after that they move as one.
  const drift = Math.sin((frame + v.phase) / 19) * 5 * (1 - m);
  const x = mix(CX + (index - 2) * ROW_PITCH, CX + (index - 2) * TILE_PITCH, m);
  const y = mix(ROW_Y + v.dy + drift + (1 - enter) * 40, TILE_Y, m);
  const w = mix(CARD_W, TILE, m);
  const h = mix(CARD_H, TILE, m);
  const rot = mix(v.rot * mix(2.6, 1, enter), 0, m);
  // Labels stay until the cards actually move; the merge spring starts slowly, so they are
  // gone before any visible shrink.
  const text = 1 - progress(frame, mergeAt - 3, 6, EASE.out);
  const iconAt = mix(CARD_PAD + ICON_TILE / 2, TILE / 2, m);
  const motionBlur = Math.sin(Math.PI * m) * 1;

  return (
    <div
      style={{
        position: 'absolute',
        left: x - w / 2,
        top: y - h / 2,
        width: w,
        height: h,
        borderRadius: mix(RADIUS.lg, RADIUS.md, m),
        background: `linear-gradient(180deg, ${COLOR.surface2} 0%, ${COLOR.surface} 100%)`,
        border: `1px solid ${interpolateColors(lit, [0, 1], [COLOR.line2, alpha(COLOR.accent, 0.6)])}`,
        boxShadow: SHADOW.card,
        overflow: 'hidden',
        opacity: enter,
        transform: `rotate(${rot}deg) scale(${mix(0.94, 1, enter)})`,
        filter: motionBlur > 0.2 || enter < 1 ? `blur(${motionBlur + (1 - enter) * 6}px)` : undefined,
      }}
    >
      {/* Accent wash once the system line reaches this module. */}
      <div style={{ position: 'absolute', inset: 0, background: alpha(COLOR.accent, 0.16), opacity: lit }} />
      {/* The icon's own tile inside the card; the card itself becomes the tile. */}
      <div
        style={{
          position: 'absolute',
          left: iconAt - ICON_TILE / 2,
          top: iconAt - ICON_TILE / 2,
          width: ICON_TILE,
          height: ICON_TILE,
          borderRadius: RADIUS.md,
          background: COLOR.line,
          border: `1px solid ${COLOR.line2}`,
          opacity: 1 - m,
        }}
      />
      <Icon
        name={v.icon}
        size={mix(28, 32, m)}
        color={interpolateColors(lit, [0, 1], [COLOR.fg2, COLOR.accentText])}
        style={{ position: 'absolute', left: iconAt - mix(14, 16, m), top: iconAt - mix(14, 16, m) }}
      />
      <div
        style={{
          ...TYPE.mono,
          position: 'absolute',
          top: CARD_PAD + 4,
          right: CARD_PAD - 2,
          color: COLOR.fg3,
          opacity: text,
        }}
      >
        {String(index + 1).padStart(2, '0')}
      </div>
      <div
        style={{
          position: 'absolute',
          left: CARD_PAD,
          bottom: CARD_PAD - 2,
          width: CARD_W - CARD_PAD * 2,
          fontFamily: FONT.body,
          fontWeight: 500,
          fontSize: 28,
          lineHeight: 1.2,
          letterSpacing: '-0.01em',
          color: COLOR.fg,
          opacity: text,
        }}
      >
        {v.label}
      </div>
    </div>
  );
};

/** NIXGEN. with letters rising from a mask and the accent period landing last. */
const LETTER_STAGGER = 1.5;
const Wordmark: React.FC<{ at: number; size: number }> = ({ at, size }) => {
  const frame = useCurrentFrame();
  const letters = 'NIXGEN'.split('');
  const dot = springAt(frame, at + letters.length * LETTER_STAGGER + 2, { damping: 14, stiffness: 170 });
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        fontFamily: FONT.heading,
        fontWeight: 600,
        fontSize: size,
        lineHeight: 1,
        letterSpacing: '0.06em',
        color: COLOR.fg,
        whiteSpace: 'nowrap',
      }}
    >
      {letters.map((ch, i) => {
        const p = springAt(frame, at + i * LETTER_STAGGER, { stiffness: 180 });
        return (
          <span key={i} style={{ display: 'inline-block', overflow: 'hidden', padding: '0.12em 0 0.16em', margin: '-0.12em 0 -0.16em' }}>
            <span style={{ display: 'inline-block', transform: `translateY(${(1 - p) * 110}%)`, opacity: Math.min(1, p * 1.5) }}>{ch}</span>
          </span>
        );
      })}
      <span
        style={{
          display: 'inline-block',
          color: COLOR.accentText,
          marginRight: '-0.06em',
          opacity: Math.min(1, dot * 2),
          transform: `scale(${dot})`,
          transformOrigin: '50% 85%',
        }}
      >
        .
      </span>
    </div>
  );
};

/** First frame at which an eased 0→1 progress reaches `target`. */
function reachFrame(start: number, dur: number, target: number): number {
  for (let f = 0; f <= dur; f++) if (progress(start + f, start, dur, EASE.inOut) >= target - 0.02) return start + f;
  return start + dur;
}

const Reframe: React.FC = () => {
  const frame = useCurrentFrame();
  const { cue, scene } = useCue();

  const vendorsAt = cue('five different vendors', { offset: -4 });
  const swapAt = cue('one team', { offset: -4 });
  const mergeAt = cue('one team', { offset: -4 });
  const systemAt = cue('the whole system', { offset: -3 });
  const lineAt = cue('whole system', { offset: -3 });

  // "Five vendors?" opens centred, lifts to the top as the vendors land, then gives way.
  const lift = progress(frame, vendorsAt - 4, 26, EASE.inOut);
  // Hands off to "One team." (which starts rising at swapAt - 2) with no empty frames.
  const leave = progress(frame, swapAt - 10, 8, EASE.inOut);

  // "One team." holds the centre, then makes room for "The whole system."
  const slide = progress(frame, systemAt - 6, 18, EASE.inOut);

  // The NIXGEN. card fades in while the tiles converge (they draw over its edge for the
  // few frames before they are all inside it), so it is never an empty slab.
  const boxAt = boxFrame(mergeAt);
  const boxStart = boxAt - 3;
  const box = progress(frame, boxStart, 10, EASE.out);
  const glow = progress(frame, boxAt + 6, 26, EASE.out);
  // The wordmark rises as the tiles pull down into the card, emerging from behind them;
  // it lives outside the card so its letters don't wait for the card's fade.
  const wordAt = mergeAt + 3;
  const line = progress(frame, lineAt, LINE_DUR, EASE.inOut);

  // Slow push-in and lift over the whole scene so no frame is frozen.
  const t = frame / (scene.frames + 12);
  const camera = `translateY(${mix(8, -14, t)}px) scale(${mix(1, 1.035, t)})`;

  const rowLeft = CX - 2 * TILE_PITCH;
  const rowWidth = 4 * TILE_PITCH;

  return (
    <AbsoluteFill style={{ transform: camera, transformOrigin: `${CX}px ${CY}px` }}>
      {/* Headline 1: the question. */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: mix(HEAD_CENTER_TOP, HEAD_TOP, lift),
          display: 'flex',
          justifyContent: 'center',
          opacity: 1 - leave,
          transform: `translateY(${-leave * 22}px) scale(${mix(1.22, 1, lift)})`,
          transformOrigin: '50% 50%',
          visibility: leave >= 1 ? 'hidden' : undefined,
        }}
      >
        {/* Blur sits on the shrink-wrapped headline (~600 px), not the full-width row. */}
        <Headline
          text="Five vendors?"
          at={0}
          size="h2"
          align="center"
          style={{ filter: leave > 0 && leave < 1 ? `blur(${leave * 8}px)` : undefined }}
        />
      </div>

      {/* Headline 2: the answer, landing in two halves on the voice. */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: HEAD_TOP,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'baseline',
          gap: 22,
          transform: `translateX(${HEAD_SHIFT * (1 - slide)}px)`,
        }}
      >
        <Headline text="One team." at={swapAt - 2} size="h2" stagger={3} />
        <Headline text="*The whole system.*" at={systemAt} size="h2" stagger={3} />
      </div>

      {/* The one card. */}
      <div
        style={{
          position: 'absolute',
          left: CX - BOX_W / 2,
          top: BOX_Y - BOX_H / 2,
          width: BOX_W,
          height: BOX_H,
          borderRadius: RADIUS.xl,
          background: `linear-gradient(180deg, ${COLOR.surface2} 0%, ${COLOR.surface} 100%)`,
          border: `1px solid ${interpolateColors(glow, [0, 1], [COLOR.line2, alpha(COLOR.accent, 0.55)])}`,
          boxShadow: SHADOW.card,
          opacity: box,
          transform: `scale(${mix(BOX_FROM, 1, box)})`,
        }}
      >
        <div style={{ position: 'absolute', inset: -1, borderRadius: RADIUS.xl, boxShadow: SHADOW.accent, opacity: glow }} />
      </div>
      <div style={{ position: 'absolute', left: CX - BOX_W / 2, width: BOX_W, top: BOX_Y - BOX_H / 2 + BOX_PAD - 16 }}>
        <Wordmark at={wordAt} size={WORDMARK_SIZE} />
      </div>

      {/* The system line: a hairline track that fills with accent on "whole system". */}
      <div
        style={{
          position: 'absolute',
          left: rowLeft,
          top: TILE_Y - 1,
          width: rowWidth,
          height: 2,
          borderRadius: RADIUS.pill,
          background: COLOR.line2,
          opacity: progress(frame, boxStart + 4, 12),
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: rowLeft,
          top: TILE_Y - 1,
          width: rowWidth * line,
          height: 2,
          borderRadius: RADIUS.pill,
          background: COLOR.accent,
        }}
      />

      {VENDORS.map((_, i) => (
        <VendorCard
          key={i}
          index={i}
          enterAt={vendorsAt + VENDORS[i].delay}
          mergeAt={mergeAt + (2 - Math.abs(i - 2))}
          litAt={reachFrame(lineAt, LINE_DUR, i / 4)}
        />
      ))}
    </AbsoluteFill>
  );
};

export default Reframe;
