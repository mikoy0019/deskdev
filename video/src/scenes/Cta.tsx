import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { Icon, type IconName } from '../components/Icon';
import { Chip } from '../components/Surfaces';
import { Eyebrow, Headline, Reveal } from '../components/Text';
import { EASE, mix, progress, springAt } from '../lib/motion';
import { useCue } from '../lib/scene';
import { COLOR, FONT, RADIUS, SHADOW, TYPE } from '../theme';

/**
 * cta: "If that's you, go to nixgensolutions.com and tell us about your business. We'll
 * reply within 12 hours to set up a 30-minute discovery call. No pressure, no pitch deck.
 * Just a clear look at where you're losing time and money, and what we'd build to fix it."
 *
 *  1. "Next step" + "Book your 30-minute discovery call." open the scene, centred.
 *  2. "nixgensolutions.com": an address-bar pill types the URL as it is spoken.
 *  3. "tell us": the accent button "Tell us about your business" rises, a cursor glides
 *     onto it and clicks (press + release, one soft ring).
 *  4. Chips land on their words: "Reply within 12 hours", "No pressure", "No pitch deck".
 *  5. "a clear look ... what we'd build": a quiet closing line, "the leaks, and the fix."
 *  6. After "fix it": everything but the URL pill settles away; the pill glides down into
 *     the end card under a large NIXGEN. wordmark and the four services. Holds ~3 s.
 */

const CX = 960;
const URL_TEXT = 'nixgensolutions.com';

// Main layout: vertical centres (px) inside the 140-880 safe area.
const Y = {
  eyebrow: 186,
  headlineTop: 222,
  pill: 500,
  button: 616,
  chips: 730,
  line: 818,
};

// Underline under "discovery call." (left edge, top, full width; measured from the render).
const UNDERLINE = { x: 690, y: 424, w: 536 };

// End card: vertical centres.
const END = {
  word: 432,
  rule: 556,
  services: 600,
  pill: 700,
};

const WORD_SIZE = 184;
const PILL_H = 72;
/** Distance from the wordmark letter box's padded bottom up to just below the baseline (measured from the render). */
const MASK_BOTTOM = 34;

/** Classic arrow pointer, drawn locally (it's a UI mock, not an icon). Tip at (0, 0). */
const Cursor: React.FC<{ x: number; y: number; opacity: number; press: number }> = ({ x, y, opacity, press }) => (
  <svg
    width={34}
    height={46}
    viewBox="0 0 17 23"
    style={{
      position: 'absolute',
      left: x,
      top: y,
      opacity,
      transform: `scale(${1 - press * 0.12})`,
      transformOrigin: '0 0',
      overflow: 'visible',
      filter: `drop-shadow(0 6px 10px ${COLOR.bg})`,
    }}
  >
    <path d="M0.5 0.5 L0.5 18 L5 14 L8.2 21.4 L11 20.2 L7.9 13 L13.6 13 Z" fill={COLOR.fg} stroke={COLOR.bg} strokeWidth={1} strokeLinejoin="round" />
  </svg>
);

/** The address-bar pill. Types the URL between `typeFrom` and `typeTo`, focus-lit while typing. */
const UrlPill: React.FC<{ typeFrom: number; typeTo: number; at: number; scale: number; lit: number }> = ({ typeFrom, typeTo, at, scale, lit }) => {
  const frame = useCurrentFrame();
  const enter = progress(frame, at, 18);
  const typed = Math.round(mix(0, URL_TEXT.length, progress(frame, typeFrom, typeTo - typeFrom, EASE.inOut)));
  // Accent border while typing, and again (softer) once it settles into the end card.
  const focus = Math.max(progress(frame, at, 10) * (1 - progress(frame, typeTo + 10, 20)), lit * 0.6);
  const caretOn = frame < typeTo + 14 && Math.floor((frame - at) / 8) % 2 === 0;
  return (
    <div
      style={{
        height: PILL_H,
        borderRadius: RADIUS.pill,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '0 34px 0 30px',
        boxSizing: 'border-box',
        background: COLOR.surface2,
        position: 'relative',
        border: `1px solid ${COLOR.line2}`,
        boxShadow: SHADOW.card,
        opacity: enter,
        transform: `translateY(${(1 - enter) * 18}px) scale(${scale * (0.96 + 0.04 * enter)})`,
      }}
    >
      {/* Focus ring: the accent border faded in over the hairline (theme colour + opacity). */}
      {focus > 0.01 ? (
        <div style={{ position: 'absolute', inset: -1, borderRadius: RADIUS.pill, border: `1px solid ${COLOR.accent}`, opacity: 0.15 + 0.45 * focus }} />
      ) : null}
      <Icon name="globe" size={28} color={COLOR.accentText} />
      <div style={{ fontFamily: FONT.mono, fontSize: 31, letterSpacing: '0.01em', color: COLOR.fg, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center' }}>
        <span>{URL_TEXT.slice(0, typed)}</span>
        <span style={{ width: 3, height: 34, marginLeft: 3, background: COLOR.accentText, opacity: caretOn ? 1 : 0 }} />
        <span style={{ opacity: 0 }}>{URL_TEXT.slice(typed)}</span>
      </div>
    </div>
  );
};

/** The primary button. `hover` 0..1 nudges the arrow; `press` 0..1 sinks it. */
const CtaButton: React.FC<{ hover: number; press: number }> = ({ hover, press }) => (
  <div
    style={{
      position: 'relative',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 20,
      height: 104,
      padding: '0 52px 0 58px',
      borderRadius: RADIUS.pill,
      background: COLOR.accent,
      color: COLOR.accentFg,
      fontFamily: FONT.heading,
      fontWeight: 500,
      fontSize: 38,
      letterSpacing: '-0.02em',
      whiteSpace: 'nowrap',
      boxShadow: SHADOW.accent,
      transform: `scale(${1 + hover * 0.015 - press * 0.04})`,
      overflow: 'hidden',
    }}
  >
    {/* Pressed shade, a flat dark layer (no extra colour). */}
    <div style={{ position: 'absolute', inset: 0, background: COLOR.bg, opacity: press * 0.18 }} />
    <span style={{ position: 'relative' }}>Tell us about your business</span>
    <span style={{ position: 'relative', display: 'flex', transform: `translateX(${hover * 8}px)` }}>
      <Icon name="arrowRight" size={36} stroke={2.2} />
    </span>
  </div>
);

/** A chip that lands on its word with a tiny settle. */
const LandChip: React.FC<{ at: number; icon: IconName; children: React.ReactNode }> = ({ at, icon, children }) => {
  const frame = useCurrentFrame();
  const p = springAt(frame, at, { damping: 15, stiffness: 170 });
  return (
    <div style={{ opacity: Math.min(1, p * 1.6), transform: `translateY(${(1 - p) * 18}px) scale(${0.94 + 0.06 * p})` }}>
      <Chip size="lg" icon={icon}>
        {children}
      </Chip>
    </div>
  );
};

/** NIXGEN. with letters rising from a mask; the accent period lands last with a small settle. */
const Wordmark: React.FC<{ at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  const letters = 'NIXGEN'.split('');
  const dot = springAt(frame, at + letters.length * 2 + 6, { damping: 14, stiffness: 160 });
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
        position: 'relative',
        // Cancel the trailing tracking so the letters, not letters + period, sit on the centre line.
        marginRight: '-0.06em',
      }}
    >
      {letters.map((l, i) => {
        const p = springAt(frame, at + i * 2, { stiffness: 150 });
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              overflow: 'hidden',
              padding: '0.08em 0 0.1em',
              margin: '-0.08em 0 -0.1em',
              // The mask's bottom edge sits on the baseline (a hair below, for the G's overshoot), so
              // letters only appear once they cross it instead of rising as cut-off blocks.
              clipPath: `inset(0 0 ${MASK_BOTTOM}px 0)`,
            }}
          >
            <span style={{ display: 'inline-block', transform: `translateY(${(1 - p) * 110}%)`, opacity: Math.min(1, p * 1.4) }}>{l}</span>
          </span>
        );
      })}
      <span
        style={{
          // Hanging period: optically centres the wordmark.
          position: 'absolute',
          left: '100%',
          // Pull the period in towards the N: tracking plus the glyph's side bearing leave a gap.
          marginLeft: '-0.07em',
          top: 0,
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

/** Centres its child horizontally on CX with its vertical centre at `y`. */
const At: React.FC<{ y: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ y, children, style }) => (
  <div style={{ position: 'absolute', left: 0, right: 0, top: y, display: 'flex', justifyContent: 'center', transform: 'translateY(-50%)', ...style }}>
    {children}
  </div>
);

const Cta: React.FC = () => {
  const frame = useCurrentFrame();
  const { cue, cueEnd, scene } = useCue();

  // Voice cues.
  const urlAt = cue('nixgensolutions.com');
  const urlEnd = cueEnd('nixgensolutions.com');
  const tellAt = cue('tell us');
  const hoursAt = cue('12 hours', { offset: -4 });
  const discAt = cue('30-minute discovery call', { offset: -4 });
  const pressureAt = cue('No pressure', { offset: -4 });
  const deckAt = cue('no pitch deck', { offset: -4 });
  const lookAt = cue('clear look', { offset: -4 });
  const buildAt = cue("what we'd build", { offset: -4 });
  const endAt = cueEnd('fix it', { offset: -12 });

  // Rows that build word by word stay centred on what's visible: each row slides over by half
  // of every item still to come, easing as that item lands (widths measured from the render).
  const centreShift = (items: { at: number; w: number }[], gap: number) => {
    const total = items.reduce((s, it) => s + it.w, 0) + gap * (items.length - 1);
    const shown = items.reduce((s, it, i) => s + springAt(frame, it.at, { stiffness: 110 }) * (it.w + (i ? gap : 0)), 0);
    return Math.max(0, total - shown) / 2;
  };
  const chipsShift = centreShift(
    [
      { at: hoursAt, w: 348 },
      { at: pressureAt, w: 236 },
      { at: deckAt, w: 257 },
    ],
    16,
  );
  const lineShift = centreShift(
    [
      { at: lookAt, w: 366 },
      { at: buildAt, w: 172 },
    ],
    12,
  );

  // Button + cursor choreography around "tell us".
  const buttonAt = tellAt - 16;
  const cursorIn = progress(frame, tellAt - 18, 20, EASE.out);
  const pressDown = progress(frame, tellAt - 1, 5, EASE.out);
  const pressUp = progress(frame, tellAt + 5, 8, EASE.out);
  const press = pressDown * (1 - pressUp);
  const hover = progress(frame, tellAt - 6, 8);
  const ring = progress(frame, tellAt + 5, 26, EASE.out);
  const cursorAway = progress(frame, tellAt + 26, 30, EASE.inOut);
  const cursorX = mix(1300, 1150, cursorIn) + cursorAway * 60;
  const cursorY = mix(830, Y.button + 26, cursorIn) + cursorAway * 40;
  const cursorOpacity = progress(frame, tellAt - 18, 10) * (1 - cursorAway);

  // Hand-off to the end card.
  // The main column clears first; the pill only starts travelling once the button under it is gone.
  const out = progress(frame, endAt, 14, EASE.inOut);
  const glide = progress(frame, endAt + 6, 30, EASE.inOut);
  const wordAt = endAt + 20;
  const servicesAt = wordAt + 18;

  // Always subtly alive: the main column drifts up a little; the end card breathes.
  const drift = mix(10, -12, frame / Math.max(1, endAt));
  const hold = progress(frame, wordAt, scene.frames - wordAt, (t) => t);
  const endScale = 1 + 0.018 * hold;

  const pillY = mix(Y.pill + drift, END.pill, glide);
  const pillScale = mix(1, 1.06, glide);
  const main: React.CSSProperties = { opacity: 1 - out, transform: `translateY(${drift - out * 24}px)` };

  return (
    <AbsoluteFill>
      {/* Main call to action. */}
      <AbsoluteFill style={main}>
        <At y={Y.eyebrow}>
          <Eyebrow at={4}>Next step</Eyebrow>
        </At>
        <div style={{ position: 'absolute', left: 0, right: 0, top: Y.headlineTop, display: 'flex', justifyContent: 'center' }}>
          <Headline text="Book your 30-minute *discovery call.*" at={8} size="h1" align="center" maxWidth={1300} />
        </div>

        {/* "to set up a 30-minute discovery call": the headline's accent line gets underlined as it is said. */}
        <div
          style={{
            position: 'absolute',
            left: UNDERLINE.x,
            top: UNDERLINE.y,
            width: UNDERLINE.w * progress(frame, discAt, 20, EASE.inOut),
            height: 2,
            borderRadius: 1,
            background: COLOR.accent,
          }}
        />

        <At y={Y.button}>
          <Reveal at={buttonAt} y={22} blur={4} scale={0.96} dur={22}>
            <div style={{ position: 'relative' }}>
              {/* Click ring, one soft pulse from the button edge. */}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: RADIUS.pill,
                  border: `2px solid ${COLOR.accentText}`,
                  opacity: ring > 0 ? 0.6 * (1 - ring) : 0,
                  transform: `scale(${1 + ring * 0.09}, ${1 + ring * 0.35})`,
                }}
              />
              <CtaButton hover={hover} press={press} />
            </div>
          </Reveal>
        </At>

        <At y={Y.chips} style={{ gap: 16, marginLeft: chipsShift * 2 }}>
          <LandChip at={hoursAt} icon="clock">
            Reply within 12 hours
          </LandChip>
          <LandChip at={pressureAt} icon="check">
            No pressure
          </LandChip>
          <LandChip at={deckAt} icon="check">
            No pitch deck
          </LandChip>
        </At>

        <At y={Y.line} style={{ gap: 12, marginLeft: lineShift * 2 }}>
          <Headline text="A clear look at the *leaks,*" at={lookAt} size="h4" color={COLOR.fg2} stagger={2} style={{ fontSize: 34 }} />
          <Headline text="and the *fix.*" at={buildAt} size="h4" color={COLOR.fg2} stagger={2} style={{ fontSize: 34 }} />
        </At>

        <Cursor x={cursorX} y={cursorY} opacity={cursorOpacity} press={press} />
      </AbsoluteFill>

      {/* End card. */}
      <AbsoluteFill style={{ transform: `scale(${endScale})`, transformOrigin: `${CX}px 540px` }}>
        {frame >= wordAt - 2 ? (
          <>
            <At y={END.word}>
              <Wordmark at={wordAt} />
            </At>
            <At y={END.rule}>
              <div
                style={{
                  width: 96 * progress(frame, wordAt + 14, 26, EASE.inOut),
                  height: 2,
                  borderRadius: 1,
                  background: COLOR.accent,
                }}
              />
            </At>
            <At y={END.services}>
              <Reveal at={servicesAt} y={12} blur={4}>
                <div style={{ ...TYPE.eyebrow, fontSize: 24, letterSpacing: '0.16em', color: COLOR.fg2, whiteSpace: 'nowrap' }}>
                  Websites <Sep /> Automation &amp; AI <Sep /> Apps <Sep /> Developers
                </div>
              </Reveal>
            </At>
          </>
        ) : null}
      </AbsoluteFill>

      {/* The URL pill lives outside both layers: it types in the main CTA, then glides into the end card. */}
      <AbsoluteFill style={{ transform: `scale(${mix(1, endScale, glide)})`, transformOrigin: `${CX}px 540px` }}>
        <At y={pillY}>
          <UrlPill at={urlAt - 6} typeFrom={urlAt} typeTo={urlEnd - 6} scale={pillScale} lit={glide} />
        </At>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Sep: React.FC = () => <span style={{ color: COLOR.accentText, margin: '0 0.5em' }}>·</span>;

export default Cta;
