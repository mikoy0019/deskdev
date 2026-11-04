import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { Icon, type IconName } from '../components/Icon';
import { Eyebrow, Headline } from '../components/Text';
import { CLAMP, EASE, mix, progress, springAt } from '../lib/motion';
import { useCue } from '../lib/scene';
import { COLOR, LAYOUT, RADIUS, SHADOW, TYPE } from '../theme';

/**
 * whofor: "This is for service business owners who are great at the work and done doing
 * everything else by hand. We take on a small number of clients each quarter, so a senior
 * team stays on every project."
 *
 *  1. Typographic. "Who it's for" + "Service business owners." set the stage; the h1
 *     "Great at the work." lands on its words, then "Done doing it all by hand." with an
 *     accent hairline drawn under "all by hand." as "by hand" is spoken.
 *  2. "everything else": the chores (quotes, reminders, scheduling, invoices) line up
 *     under the headline and get struck through on "by hand".
 *  3. In the pause after "hand.", the chores clear and the type block glides up; three
 *     commitment cards land on their words: small number of clients each quarter,
 *     senior team on every project, no juniors / no outsourcing.
 */

const alpha = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

// Type block: vertically centred at first, then lifted to the top of the safe area.
const BLOCK_TOP = 318;
const BLOCK_LIFT = 128;
// Chores row (only during "everything else by hand") and the commitment cards share this band.
const ROW_TOP = 726;
const CARDS_TOP = 614;
const CARD_GAP = 32;
const CARD_W = (LAYOUT.width - LAYOUT.padX * 2 - CARD_GAP * 2) / 3;
const CARD_H = 226;
const CARD_PAD = '34px 36px';
const cardLeft = (index: number) => LAYOUT.padX + index * (CARD_W + CARD_GAP);
const indexLabel = (index: number) => String(index + 1).padStart(2, '0');
/** Shared by the card and its slot so the slot clears exactly as the card lands. */
const cardEnter = (frame: number, at: number) => springAt(frame, at, { damping: 20, stiffness: 120 });

type Chore = { label: string; icon: IconName };
const CHORES: Chore[] = [
  { label: 'Quotes', icon: 'file' },
  { label: 'Reminders', icon: 'clock' },
  { label: 'Scheduling', icon: 'calendar' },
  { label: 'Invoices', icon: 'dollar' },
];

/** Titles as explicit lines so they break on the phrase, not wherever the box ends. */
type Commitment = { title: string[]; icon: IconName };
const COMMITMENTS: Commitment[] = [
  { title: ['A small number of clients', 'each quarter'], icon: 'calendar' },
  { title: ['Senior team on', 'every project'], icon: 'users' },
  { title: ['No juniors,', 'no outsourcing'], icon: 'shield' },
];

/** A by-hand chore: lands, gets a line drawn through it, dims, then clears upward. */
const ChoreChip: React.FC<{ chore: Chore; at: number; strikeAt: number; exitAt: number }> = ({ chore, at, strikeAt, exitAt }) => {
  const frame = useCurrentFrame();
  const enter = springAt(frame, at, { damping: 18, stiffness: 160 });
  const strike = progress(frame, strikeAt, 12, EASE.inOut);
  const exit = progress(frame, exitAt, 16, EASE.in);
  return (
    <div
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 14,
        padding: '16px 28px',
        borderRadius: RADIUS.pill,
        border: `1px solid ${COLOR.line2}`,
        background: COLOR.line,
        color: strike > 0.5 ? COLOR.fg3 : COLOR.fg2,
        ...TYPE.small,
        fontSize: 28,
        whiteSpace: 'nowrap',
        opacity: Math.min(1, enter * 1.4) * mix(1, 0.55, strike) * (1 - exit),
        transform: `translateY(${(1 - enter) * 20 - exit * 18}px)`,
        filter: exit > 0 ? `blur(${exit * 6}px)` : undefined,
      }}
    >
      <Icon name={chore.icon} size={26} color={COLOR.fg3} />
      <span style={{ position: 'relative' }}>
        {chore.label}
        <span
          style={{
            position: 'absolute',
            left: -4,
            top: '54%',
            height: 2,
            width: `calc(${strike * 100}% + ${strike * 8}px)`,
            background: COLOR.fg2,
            borderRadius: 2,
          }}
        />
      </span>
    </div>
  );
};

/**
 * An empty dashed slot where a commitment card will land: it shows the row as a 3-up from
 * the moment the type block settles, then clears as its card arrives on top of it.
 */
const CardSlot: React.FC<{ index: number; showAt: number; cardAt: number }> = ({ index, showAt, cardAt }) => {
  const frame = useCurrentFrame();
  const show = progress(frame, showAt, 16, EASE.out);
  // Clear early in the card's entrance so the slot's index never doubles the card's own.
  const covered = interpolate(cardEnter(frame, cardAt), [0.04, 0.35], [0, 1], CLAMP);
  if (show <= 0 || covered >= 1) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: cardLeft(index),
        top: CARDS_TOP,
        width: CARD_W,
        height: CARD_H,
        boxSizing: 'border-box',
        borderRadius: RADIUS.lg,
        border: `1px dashed ${COLOR.line2}`,
        padding: CARD_PAD,
        display: 'flex',
        justifyContent: 'flex-end',
        alignItems: 'flex-start',
        opacity: show * (1 - covered),
        transform: `translateY(${(1 - show) * 10}px)`,
      }}
    >
      <div style={{ ...TYPE.eyebrow, fontSize: 20, color: COLOR.fg3, lineHeight: '64px' }}>{indexLabel(index)}</div>
    </div>
  );
};

/** One commitment: icon tile, accent index, title. Lands accent-lit on its word, then cools. */
const CommitmentCard: React.FC<{ item: Commitment; index: number; at: number }> = ({ item, index, at }) => {
  const frame = useCurrentFrame();
  const enter = cardEnter(frame, at);
  const tile = springAt(frame, at + 5, { damping: 14, stiffness: 170 });
  const lit = progress(frame, at, 8) * (1 - progress(frame, at + 34, 40, EASE.inOut));
  return (
    <div
      style={{
        position: 'absolute',
        left: cardLeft(index),
        top: CARDS_TOP,
        width: CARD_W,
        height: CARD_H,
        opacity: Math.min(1, enter * 1.3),
        transform: `translateY(${(1 - enter) * 44}px) scale(${mix(0.96, 1, enter)})`,
        filter: enter < 0.98 ? `blur(${(1 - enter) * 6}px)` : undefined,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: RADIUS.lg,
          background: `linear-gradient(180deg, ${COLOR.surface2} 0%, ${COLOR.surface} 100%)`,
          border: `1px solid ${COLOR.line2}`,
          boxShadow: SHADOW.card,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: RADIUS.lg,
          border: `1px solid ${alpha(COLOR.accent, 0.6)}`,
          boxShadow: SHADOW.accent,
          opacity: lit,
        }}
      />
      <div style={{ position: 'relative', padding: CARD_PAD, height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: RADIUS.md,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: alpha(COLOR.accent, 0.14),
              border: `1px solid ${alpha(COLOR.accent, 0.5)}`,
              color: COLOR.accentText,
              transform: `scale(${mix(0.6, 1, tile)})`,
              opacity: Math.min(1, tile * 1.5),
            }}
          >
            <Icon name={item.icon} size={32} />
          </div>
          <div style={{ ...TYPE.eyebrow, fontSize: 20, color: COLOR.accentText }}>{indexLabel(index)}</div>
        </div>
        <div style={{ ...TYPE.h4, fontSize: 36, color: COLOR.fg, marginTop: 'auto' }}>
          {item.title.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      </div>
    </div>
  );
};

const WhoFor: React.FC = () => {
  const frame = useCurrentFrame();
  const { cue, scene } = useCue();
  const frames = scene.frames;

  const owners = cue('service business owners', { offset: -4 });
  const great = cue('great at the work', { offset: -4 });
  const done = cue('done doing', { offset: -4 });
  const everything = cue('everything else', { offset: -4 });
  const byHand = cue('by hand', { offset: -3 });
  const clients = cue('small number of clients', { offset: -4 });
  const senior = cue('senior team', { offset: -4 });
  const noJuniors = cue('every project', { offset: -6 });

  // In the pause after "hand.": chores clear, then the type block lifts to make room.
  const choresOut = byHand + 20;
  const liftAt = choresOut + 2;
  const lift = progress(frame, liftAt, 28, EASE.inOut);

  // Line 1 steps back a little once line 2 owns the frame.
  const dimFirst = progress(frame, done + 10, 24, EASE.inOut);
  const underline = progress(frame, byHand, 18, EASE.out);

  // Slow drift: type and cards move at different rates (light parallax).
  const driftType = interpolate(frame, [0, frames], [10, -14], CLAMP);
  // The card row keeps rising slowly as a unit (aligned tops), so the hold never freezes.
  // Same range as the type so the underline-to-card gap holds steady through the hold.
  const driftCards = interpolate(frame, [0, frames], [14, -14], CLAMP);
  // Empty slots rise in as the type block finishes lifting (clear of the underline), so
  // the row reads as a 3-up before card 01 lands on "small number of clients".
  const slotsAt = Math.min(liftAt + 18, clients - 9);
  const cardAts = [clients, senior, noJuniors];

  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          left: LAYOUT.padX,
          top: BLOCK_TOP,
          transform: `translateY(${-BLOCK_LIFT * lift + driftType}px)`,
        }}
      >
        <Eyebrow at={2}>Who it's for</Eyebrow>
        <div style={{ height: 26 }} />
        <div
          style={{
            ...TYPE.lede,
            color: COLOR.fg2,
            opacity: progress(frame, owners, 20),
            transform: `translateY(${(1 - progress(frame, owners, 20)) * 16}px)`,
          }}
        >
          Service business owners.
        </div>
        <div style={{ height: 30 }} />
        <div style={{ opacity: mix(1, 0.5, dimFirst) }}>
          <Headline text="Great at the work." at={great} size="h1" />
        </div>
        <div style={{ height: 10 }} />
        <div style={{ display: 'flex', alignItems: 'flex-start', whiteSpace: 'nowrap' }}>
          <Headline text="Done doing it" at={done} size="h1" />
          <div style={{ position: 'relative', marginLeft: '0.26em', fontSize: TYPE.h1.fontSize }}>
            <Headline text="*all by hand.*" at={done + 3 * 2.5} size="h1" />
            <div
              style={{
                position: 'absolute',
                left: 4,
                bottom: -22,
                height: 3,
                width: `calc(${underline * 100}% - 8px)`,
                borderRadius: 2,
                background: COLOR.accent,
                opacity: underline > 0 ? 1 : 0,
              }}
            />
          </div>
        </div>
      </div>

      {frame < choresOut + 30 ? (
        <div
          style={{
            position: 'absolute',
            left: LAYOUT.padX,
            top: ROW_TOP,
            display: 'flex',
            gap: 18,
            transform: `translateY(${driftType}px)`,
          }}
        >
          {CHORES.map((c, i) => (
            <ChoreChip key={c.label} chore={c} at={everything + i * 4} strikeAt={byHand + i * 2} exitAt={choresOut + i * 2} />
          ))}
        </div>
      ) : null}

      <div style={{ position: 'absolute', inset: 0, transform: `translateY(${driftCards}px)` }}>
        {COMMITMENTS.map((item, i) => (
          <CardSlot key={`slot-${item.title[0]}`} index={i} showAt={slotsAt + i * 3} cardAt={cardAts[i]} />
        ))}
        {COMMITMENTS.map((item, i) => (
          <CommitmentCard key={item.title[0]} item={item} index={i} at={cardAts[i]} />
        ))}
      </div>
    </AbsoluteFill>
  );
};

export default WhoFor;
