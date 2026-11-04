import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { Icon } from '../components/Icon';
import { Card } from '../components/Surfaces';
import { Eyebrow, Headline, Reveal } from '../components/Text';
import { CLAMP, EASE, mix, progress, springAt } from '../lib/motion';
import { useCue } from '../lib/scene';
import { COLOR, FONT, LAYOUT, RADIUS, SHADOW, TYPE } from '../theme';
import { AccentPill, alpha, CheckRow, ConceptThumb, THUMB_H, THUMB_W, Unlock } from './risk/kit';

// "You own everything we build: the domain, the code and the content, on your own
// accounts, with no lock-in. And if you don't love the first design concepts, we
// revise until you do, at no extra charge."
//
// Two cards under the eyebrow "Your terms". The ownership card rises alone and
// centred; its checklist ticks on each word. On "first design concepts" it glides
// left as the revisions card arrives, where concept thumbnails stack v1 → v3 and the
// last one is approved.

const CARD_W = 800;
const CARD_H = 604;
const ROW_TOP = 236;
const LEFT_X = LAYOUT.padX;
const RIGHT_X = LAYOUT.width - LAYOUT.padX - CARD_W;
const CENTER_X = (LAYOUT.width - CARD_W) / 2;
const PAD_X = 48;
const PAD_Y = 44;
const ROW_H = 72;
const INNER_W = CARD_W - PAD_X * 2;
/** Height of the concept stage: what's left between the title and the footer. */
const STAGE_H = 300;
/** Horizontal step between stacked concepts. */
const STEP = 132;
/** Room around card 2 so its edge mask doesn't clip the card's shadow. */
const MASK_PAD = 100;

const kicker: React.CSSProperties = { ...TYPE.eyebrow, fontSize: 20, color: COLOR.fg3, display: 'flex', gap: 14 };
const titleStyle: React.CSSProperties = { marginTop: 18, fontSize: 52 };

/** Card shell; `glow` 0 → 1 fades in the accent edge marking the card being talked about. */
const TermsCard: React.FC<{ glow: number; children: React.ReactNode }> = ({ glow, children }) => (
  <Card padding={`${PAD_Y}px ${PAD_X}px`} style={{ width: CARD_W, height: CARD_H, boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
    <div
      style={{
        position: 'absolute',
        inset: -1,
        borderRadius: RADIUS.lg,
        border: `1px solid ${alpha(COLOR.accent, 0.55)}`,
        boxShadow: SHADOW.accent,
        opacity: glow,
        pointerEvents: 'none',
      }}
    />
    {children}
  </Card>
);

const Risk: React.FC = () => {
  const frame = useCurrentFrame();
  const { cue, scene } = useCue();

  // Ownership card
  const tOwn = cue('own', { offset: -6 });
  const tDomain = cue('domain', { offset: -4 });
  const tCode = cue('code', { offset: -4 });
  const tContent = cue('content', { offset: -4 });
  const tAccounts = cue('your own accounts', { offset: -4 });
  const tLockIn = cue('no lock-in', { offset: -4 });
  // Revisions card
  const tConcepts = cue('first design concepts');
  const tV1 = cue('concepts', { offset: -6 });
  const tV2 = cue('revise', { offset: -4 });
  const tV3 = cue('until you do', { offset: -2 });
  const tDo = cue('do', { offset: -3 });
  const tCharge = cue('no extra charge', { offset: -4 });

  // Slow upward drift; the eyebrow moves at half speed for a touch of parallax.
  const drift = interpolate(frame, [0, scene.frames], [12, -14], CLAMP);

  // Card 1 rises centred, then glides left (from ~frame 200) as card 2 arrives. Card 2
  // rides just behind card 1's right edge, so the two never overlap mid-move.
  const in1 = progress(frame, 2, 30);
  const slide = progress(frame, tConcepts - 16, 28, EASE.inOut);
  const x1 = mix(CENTER_X, LEFT_X, slide);
  const in2 = progress(frame, tConcepts - 6, 26);
  const x2 = Math.max(RIGHT_X, x1 + CARD_W + 40);
  // While card 2 still rides past the right safe edge, feather it out *inside* x 1780
  // so it seems to emerge from the safe edge rather than hang off the frame. The
  // feather narrows to nothing as the slide lands, so dropping the mask doesn't pop.
  const fadeTo = LAYOUT.width - LAYOUT.padX + 2 - (x2 - MASK_PAD);
  const fadeW = 200 * (1 - slide);
  const edgeMask: React.CSSProperties =
    slide < 1
      ? {
          maskImage: `linear-gradient(90deg, #000 ${fadeTo - fadeW}px, transparent ${fadeTo}px)`,
          WebkitMaskImage: `linear-gradient(90deg, #000 ${fadeTo - fadeW}px, transparent ${fadeTo}px)`,
        }
      : {};
  const glow1 = progress(frame, tDomain - 4, 24) * (1 - progress(frame, tConcepts - 6, 22));
  const glow2 = progress(frame, tConcepts + 12, 24);

  const rows = [
    { icon: 'globe', label: 'Domain', detail: 'yourbusiness.com', at: tDomain },
    { icon: 'code', label: 'Code', detail: 'Full source', at: tCode },
    { icon: 'file', label: 'Content', detail: 'Words & images', at: tContent },
    { icon: 'key', label: 'On your accounts', detail: 'Your logins', at: tAccounts },
  ] as const;

  const lockIn = springAt(frame, tLockIn, { damping: 15, stiffness: 160 });
  const shackle = progress(frame, tLockIn + 8, 14);

  // Concepts: each new version slides in at the front; older ones step back and dim.
  const arrivals = [tV1, tV2, tV3].map((t) => progress(frame, t, 22));
  const behind = (i: number) => arrivals.slice(i + 1).reduce((a, b) => a + b, 0);
  const shown = arrivals.reduce((a, b) => a + b, 0);
  // The whole stack shifts right as it grows, so it stays centred in the card.
  const stackShift = (Math.max(1, shown) - 1) * (STEP / 2);
  const approve = springAt(frame, tDo, { damping: 14, stiffness: 170 });
  const ring = progress(frame, tDo, 14);
  const charge = springAt(frame, tCharge, { damping: 15, stiffness: 160 });

  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 150, transform: `translateY(${drift * 0.5}px)` }}>
        <Eyebrow at={0} style={{ justifyContent: 'center' }}>
          Your terms
        </Eyebrow>
      </div>

      {/* Ownership */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: ROW_TOP,
          opacity: in1,
          transform: `translate(${x1}px, ${drift + (1 - in1) * 44}px) scale(${mix(0.97, 1, in1)})`,
        }}
      >
        <TermsCard glow={glow1}>
          <Reveal at={2} y={8} blur={0}>
            <div style={kicker}>
              <span style={{ color: COLOR.accentText }}>01</span>
              <span>Ownership</span>
            </div>
          </Reveal>
          <Headline text="You own *everything.*" at={tOwn} size="h3" style={titleStyle} />
          <div style={{ marginTop: 34 }}>
            {rows.map((r, i) => (
              <CheckRow
                key={r.label}
                icon={r.icon}
                label={r.label}
                detail={r.detail}
                first={i === 0}
                height={ROW_H}
                show={progress(frame, r.at, 16)}
                tick={springAt(frame, r.at + 5, { damping: 14, stiffness: 180 })}
              />
            ))}
          </div>
          <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center' }}>
            <div style={{ opacity: Math.min(1, lockIn * 1.4), transform: `translateY(${(1 - lockIn) * 14}px) scale(${mix(0.9, 1, lockIn)})`, transformOrigin: 'left center' }}>
              <AccentPill icon={<Unlock open={shackle} />}>No lock-in</AccentPill>
            </div>
          </div>
        </TermsCard>
      </div>

      {/* Revisions */}
      <div
        style={{
          position: 'absolute',
          left: -MASK_PAD,
          top: ROW_TOP - MASK_PAD,
          padding: MASK_PAD,
          opacity: in2,
          transform: `translate(${x2}px, ${drift + (1 - in2) * 30}px)`,
          ...edgeMask,
        }}
      >
        <TermsCard glow={glow2}>
          <Reveal at={tConcepts - 2} y={8} blur={0}>
            <div style={kicker}>
              <span style={{ color: COLOR.accentText }}>02</span>
              <span>Design concepts</span>
            </div>
          </Reveal>
          <Headline text="Revisions until you *love it.*" at={tConcepts} size="h3" style={titleStyle} />

          <div style={{ position: 'relative', height: STAGE_H, marginTop: 34 }}>
            {[0, 1, 2].map((i) => {
              const a = arrivals[i];
              if (a <= 0) return null;
              const d = behind(i);
              const front = i === 2;
              const x = (INNER_W - THUMB_W) / 2 + stackShift - d * STEP + (1 - a) * 90;
              const y = (STAGE_H - THUMB_H) / 2 + d * 6;
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    zIndex: i,
                    opacity: a,
                    transform: `translate(${x}px, ${y}px) scale(${1 - d * 0.1})`,
                    transformOrigin: 'left center',
                  }}
                >
                  <ConceptThumb index={i} approved={front ? ring : 0} />
                  {/* Older concepts dim as they step back. */}
                  <div style={{ position: 'absolute', inset: 0, borderRadius: RADIUS.md, background: COLOR.bg, opacity: Math.min(1, d) * 0.5 }} />
                  {front ? (
                    <div
                      style={{
                        position: 'absolute',
                        right: -14,
                        top: -30,
                        opacity: Math.min(1, approve * 1.4),
                        transform: `translateY(${(1 - approve) * 10}px) scale(${mix(0.85, 1, approve)})`,
                        transformOrigin: 'right center',
                      }}
                    >
                      <div
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '9px 18px 9px 12px',
                          borderRadius: RADIUS.pill,
                          background: COLOR.surface2,
                          border: `1px solid ${alpha(COLOR.success, 0.55)}`,
                          color: COLOR.success,
                          boxShadow: SHADOW.card,
                          ...TYPE.small,
                          fontSize: 22,
                        }}
                      >
                        <span
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: RADIUS.pill,
                            background: COLOR.success,
                            color: COLOR.bg,
                            display: 'grid',
                            placeItems: 'center',
                          }}
                        >
                          <Icon name="check" size={18} stroke={2.6} />
                        </span>
                        Approved
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center' }}>
            <div style={{ opacity: Math.min(1, charge * 1.4), transform: `translateY(${(1 - charge) * 14}px) scale(${mix(0.9, 1, charge)})`, transformOrigin: 'left center' }}>
              <AccentPill icon={<Icon name="check" size={24} stroke={2} />}>No extra charge</AccentPill>
            </div>
            <div style={{ marginLeft: 'auto', ...TYPE.mono, fontSize: 20, letterSpacing: '0.12em', textTransform: 'uppercase', color: COLOR.fg3, opacity: progress(frame, tV1, 16) }}>
              <span style={{ fontFamily: FONT.mono }}>Round </span>
              <span style={{ color: COLOR.fg2, fontVariantNumeric: 'tabular-nums' }}>{String(Math.max(1, Math.round(shown))).padStart(2, '0')}</span>
            </div>
          </div>
        </TermsCard>
      </div>
    </AbsoluteFill>
  );
};

export default Risk;
