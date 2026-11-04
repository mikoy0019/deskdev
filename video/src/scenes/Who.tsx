import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { Chip } from '../components/Surfaces';
import { Headline, Reveal } from '../components/Text';
import { CLAMP, EASE, mix, progress, springAt } from '../lib/motion';
import { useCue } from '../lib/scene';
import { COLOR, FONT, RADIUS, TYPE } from '../theme';
import { Glyph, type GlyphName } from './who/glyphs';
import { Wall, alpha, mixHex } from './who/Wall';

/**
 * who: "We're NixGen. Since 2023, we've delivered more than 200 websites, plus the apps
 * and automations behind them, for contractors, salons, HVAC companies, tour operators
 * and more. And we keep finding the same four leaks."
 *
 *  1. "NixGen": the NIXGEN. wordmark rises in, letter by letter, centred over a dim wall
 *     of real client work; "Since 2023" lands under it.
 *  2. "200": the wordmark eases up and smaller, the wall brightens a little, and a big
 *     counter runs to 200+ beside "websites delivered"; "+ Apps", "+ Automations" follow.
 *  3. Each industry chip lands on its word.
 *  4. "the same four leaks": the stats settle back, the wall dims, and "The same
 *     four leaks." lands with four numbered ticks (the next scene's structure).
 */

const WORD_SIZE = 170;
const WORD_TOP_SCALE = 0.5;
// Wordmark centre: centred in the frame, then up near the top of the safe area.
const WORD_Y_CENTER = 470;
const WORD_Y_TOP = 214;
// "Since 2023" sits under the wordmark and travels with it (unscaled, so it stays legible).
const SINCE_Y_CENTER = 600;
const SINCE_Y_TOP = 286;

const NUM_SIZE = 300;
const NUM_BOX_W = 610;
// Visible extent of the lockup (numeral ink ≈ x 425, label "websites" ends ≈ 1350, the
// "+ Automations" chip ≈ 1505): the shifts that centre it on x 960 before and after the chips.
const LOCKUP_SHIFT_PRE = 72;
const LOCKUP_SHIFT_POST = -5;

type Industry = { label: string; glyph: GlyphName; cue: string; w: number };

const INDUSTRIES: Industry[] = [
  { label: 'Contractors', glyph: 'hardHat', cue: 'contractors', w: 254 },
  { label: 'Salons', glyph: 'scissors', cue: 'salons', w: 186 },
  { label: 'HVAC', glyph: 'thermometer', cue: 'HVAC', w: 174 },
  { label: 'Tour operators', glyph: 'compass', cue: 'tour operators', w: 294 },
  { label: '& more', glyph: 'plus', cue: 'and more', w: 190 },
];
// Rendered chip widths (measured from stills) and the row gap: chips keep their places
// relative to each other while the whole row eases so the visible chips stay centred.
const CHIP_GAP = 16;
const ROW_W = INDUSTRIES.reduce((sum, c) => sum + c.w, 0) + CHIP_GAP * (INDUSTRIES.length - 1);

/** Mono label with a short hairline either side, centred. */
const CenterLabel: React.FC<{ children: React.ReactNode; at: number; style?: React.CSSProperties }> = ({ children, at, style }) => {
  const frame = useCurrentFrame();
  const p = progress(frame, at, 16);
  const rule = progress(frame, at + 4, 22);
  const line = <span style={{ display: 'block', width: 40 * rule, height: 1, background: 'currentColor', opacity: 0.5 }} />;
  return (
    <div
      style={{
        ...TYPE.eyebrow,
        fontSize: 22,
        color: COLOR.fg3,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
        opacity: p,
        transform: `translateY(${(1 - p) * 10}px)`,
        ...style,
      }}
    >
      {line}
      <span>{children}</span>
      {line}
    </div>
  );
};

/** NIXGEN. with each letter rising out of a mask; the blue period lands last with a small settle. */
const Wordmark: React.FC<{ at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  const letters = 'NIXGEN'.split('');
  const dot = springAt(frame, at + letters.length * 2 + 8, { damping: 14, stiffness: 160 });
  return (
    <div
      style={{
        fontFamily: FONT.heading,
        fontWeight: 600,
        fontSize: WORD_SIZE,
        lineHeight: 1,
        letterSpacing: '0.06em',
        color: COLOR.fg,
        display: 'flex',
        whiteSpace: 'nowrap',
      }}
    >
      {letters.map((l, i) => {
        const p = springAt(frame, at + i * 2, { stiffness: 170 });
        return (
          <span key={i} style={{ display: 'inline-block', overflow: 'hidden', padding: '0.08em 0 0.1em', margin: '-0.08em 0 -0.1em' }}>
            <span style={{ display: 'inline-block', transform: `translateY(${(1 - p) * 110}%)`, opacity: Math.min(1, p * 1.4) }}>{l}</span>
          </span>
        );
      })}
      <span
        style={{
          display: 'inline-block',
          color: COLOR.accentText,
          letterSpacing: 0,
          opacity: Math.min(1, dot * 2),
          transform: `translateY(${(1 - dot) * -40}px)`,
        }}
      >
        .
      </span>
    </div>
  );
};

/**
 * A chip that lands accent-lit on its word, then cools to neutral so the newest one always
 * reads as "now". Text and glyph colours blend continuously with the glow (no step).
 */
const IndustryChip: React.FC<{ item: Industry; at: number }> = ({ item, at }) => {
  const frame = useCurrentFrame();
  const enter = springAt(frame, at, { damping: 16, stiffness: 170 });
  const lit = progress(frame, at, 6) * (1 - progress(frame, at + 16, 30, EASE.inOut));
  return (
    <div
      style={{
        position: 'relative',
        opacity: Math.min(1, enter * 1.4),
        transform: `translateY(${(1 - enter) * 22}px) scale(${mix(0.92, 1, enter)})`,
      }}
    >
      <Chip size="lg" style={{ padding: '16px 28px', fontSize: 28, color: mixHex(COLOR.fg2, COLOR.fg, lit) }}>
        <Glyph name={item.glyph} size={26} color={mixHex(COLOR.fg3, COLOR.accentText, lit)} />
        {item.label}
      </Chip>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: RADIUS.pill,
          border: `1px solid ${alpha(COLOR.accent, 0.7)}`,
          background: alpha(COLOR.accent, 0.12),
          opacity: lit,
        }}
      />
    </div>
  );
};

/** "+ Apps" / "+ Automations": accent add-ons to the 200+ websites. */
const AddChip: React.FC<{ label: string; at: number }> = ({ label, at }) => {
  const frame = useCurrentFrame();
  const enter = springAt(frame, at, { damping: 16, stiffness: 170 });
  return (
    <div style={{ opacity: Math.min(1, enter * 1.4), transform: `translateX(${(1 - enter) * -18}px) scale(${mix(0.94, 1, enter)})` }}>
      <Chip tone="accent" size="lg" style={{ fontSize: 28, padding: '14px 26px' }}>
        <Glyph name="plus" size={24} />
        {label}
      </Chip>
    </div>
  );
};

/** Four numbered ticks on a hairline: the structure of the next scene. */
const LeakTicks: React.FC<{ at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  const PITCH = 150;
  const span = PITCH * 3;
  const line = progress(frame, at, 26, EASE.inOut);
  return (
    <div style={{ position: 'relative', width: span + 120, height: 96 }}>
      <div
        style={{
          position: 'absolute',
          left: 60,
          top: 20,
          width: span * line,
          height: 1,
          background: COLOR.line2,
        }}
      />
      {[0, 1, 2, 3].map((i) => {
        const p = springAt(frame, at + 4 + i * 5, { damping: 15, stiffness: 170 });
        const first = i === 0;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: 60 + i * PITCH,
              top: 0,
              width: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              opacity: Math.min(1, p * 1.4),
              transform: `translateY(${(1 - p) * 14}px)`,
            }}
          >
            <div
              style={{
                width: 12,
                height: 12,
                marginTop: 14,
                borderRadius: 6,
                background: first ? COLOR.accent : COLOR.bg,
                border: `1.5px solid ${first ? COLOR.accent : COLOR.fg3}`,
                boxShadow: first ? `0 0 0 6px ${alpha(COLOR.accent, 0.16)}` : undefined,
              }}
            />
            <div
              style={{
                ...TYPE.mono,
                fontSize: 24,
                fontWeight: 500,
                marginTop: 18,
                color: first ? COLOR.accentText : COLOR.fg2,
                whiteSpace: 'nowrap',
              }}
            >
              {String(i + 1).padStart(2, '0')}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const Who: React.FC = () => {
  const frame = useCurrentFrame();
  const { cue, scene } = useCue();

  const tWord = cue('NixGen', { offset: -6 });
  const tSince = cue('2023', { offset: -5 });
  const tShrink = cue('delivered', { offset: -2 });
  const t200 = cue('200', { offset: -5 });
  const tLabel = cue('websites', { offset: -6 });
  const tApps = cue('apps and automations', { offset: -4 });
  const tAutos = cue('automations', { offset: -4 });
  const tFor = cue('for contractors', { offset: -8 });
  const tSettle = cue('finding', { offset: -8 });
  // Rises while the stats are still fading out (no empty beat); "The same" lands on its
  // words and the stagger carries "four leaks." onto the words.
  const tLeaks = cue('same', { offset: -10 });
  const tTicks = cue('leaks', { offset: -2 });

  // Stats + industries settle back for the closing line.
  const settle = progress(frame, tSettle, 16, EASE.inOut);
  // The brand recedes properly so "The same four leaks." owns the frame.
  const brandDim = mix(1, 0.25, settle);
  const brandScale = mix(1, 0.9, settle);

  // Wordmark: centre → up and smaller.
  const up = progress(frame, tShrink, 26, EASE.inOut);
  const wordY = mix(WORD_Y_CENTER, WORD_Y_TOP, up);
  const wordScale = mix(1, WORD_TOP_SCALE, up) * brandScale;
  const sinceY = mix(SINCE_Y_CENTER, SINCE_Y_TOP, up);

  // Wall: dim, a touch brighter from "200", back down for the last line.
  const wallVis = progress(frame, t200, 30, EASE.inOut) * (1 - 0.85 * settle);
  // The "+" lands as the counter settles on 200.
  const plus = springAt(frame, t200 + 16, { damping: 15, stiffness: 160 });

  // The 200+ lockup is centred on what's on screen: numeral + label first, then it
  // eases left to make room as "+ Automations" extends the right column.
  const lockupX = mix(LOCKUP_SHIFT_PRE, LOCKUP_SHIFT_POST, progress(frame, tAutos - 4, 22, EASE.inOut));

  // Slow drift of the whole foreground so no frame sits still.
  const drift = interpolate(frame, [0, scene.frames], [10, -14], CLAMP);

  // Industry row: shift so the chips on screen are centred on x 960. Contractors lands
  // already centred; each later chip eases the row left by half its width (plus gap).
  const chipAt = INDUSTRIES.map((item) => cue(item.cue, { offset: -4 }));
  const visibleW = INDUSTRIES.reduce(
    (sum, c, i) => (i === 0 ? c.w : sum + (c.w + CHIP_GAP) * progress(frame, chipAt[i], 14, EASE.inOut)),
    0,
  );
  const rowShift = (ROW_W - visibleW) / 2;

  return (
    <AbsoluteFill>
      <Wall visibility={wallVis} total={scene.frames} />

      <AbsoluteFill style={{ transform: `translateY(${drift}px)` }}>
        {/* Wordmark */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: wordY,
            display: 'flex',
            justifyContent: 'center',
            transform: `translateY(-50%) scale(${wordScale})`,
            opacity: brandDim,
          }}
        >
          <Wordmark at={tWord} />
        </div>

        {/* Since 2023 */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: sinceY, transform: 'translateY(-50%)', opacity: mix(1, 0.25, settle) }}>
          <CenterLabel at={tSince}>Since 2023</CenterLabel>
        </div>

        {/* 200+ websites delivered, + apps, + automations */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 352,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 64,
            opacity: 1 - settle,
            transform: `translate(${lockupX}px, ${-24 * settle}px) scale(${mix(1, 0.97, settle)})`,
          }}
        >
          <Reveal at={t200} y={40} blur={10} dur={22} style={{ width: NUM_BOX_W }}>
            <div style={{ ...TYPE.numeral, fontSize: NUM_SIZE, color: COLOR.fg, textAlign: 'right', whiteSpace: 'nowrap' }}>
              <Num at={t200} />
              <span
                style={{
                  display: 'inline-block',
                  verticalAlign: 'top',
                  fontSize: '0.44em',
                  lineHeight: 1,
                  marginLeft: 14,
                  marginTop: '0.12em',
                  color: COLOR.accentText,
                  opacity: plus,
                  transform: `translateY(${(1 - plus) * 18}px)`,
                }}
              >
                +
              </span>
            </div>
          </Reveal>
          <div style={{ width: 450, display: 'flex', flexDirection: 'column', gap: 30 }}>
            <Headline text="websites *delivered*" size="h2" at={tLabel} style={{ fontSize: 68, lineHeight: 1.02 }} maxWidth={450} />
            <div style={{ display: 'flex', gap: 14 }}>
              <AddChip label="Apps" at={tApps} />
              <AddChip label="Automations" at={tAutos} />
            </div>
          </div>
        </div>

        {/* For service businesses: one chip per industry, on its word */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 676,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 26,
            opacity: 1 - settle,
            transform: `translateY(${-16 * settle}px) scale(${mix(1, 0.97, settle)})`,
          }}
        >
          <CenterLabel at={tFor}>For service businesses</CenterLabel>
          <div style={{ display: 'flex', gap: CHIP_GAP, transform: `translateX(${rowShift}px)` }}>
            {INDUSTRIES.map((item, i) => (
              <IndustryChip key={item.label} item={item} at={chipAt[i]} />
            ))}
          </div>
        </div>

        {/* Closing line + ticks */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 515,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 44,
          }}
        >
          <Headline text="The same *four leaks.*" size="h2" at={tLeaks} align="center" stagger={4} />
          <LeakTicks at={tTicks} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** The 200 counter. Eased so it decelerates into the final number. */
const Num: React.FC<{ at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  const v = Math.round(interpolate(frame, [at, at + 20], [0, 200], { ...CLAMP, easing: EASE.out }));
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</span>;
};

export default Who;
