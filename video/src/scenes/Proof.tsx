import React from 'react';
import { AbsoluteFill, interpolate, interpolateColors, random, useCurrentFrame } from 'remotion';
import { Card, DrawLine } from '../components/Surfaces';
import { Eyebrow, Headline, Reveal } from '../components/Text';
import { CLAMP, EASE, mix, progress, springAt } from '../lib/motion';
import { useCue } from '../lib/scene';
import { COLOR, FONT, LAYOUT, RADIUS, SHADOW, TYPE } from '../theme';

// "And it works. Austin Hayes, a service business owner, tripled his leads within
// 60 days. At Codetic, the dashboard alone saved the team more than 20 hours a week
// of manual reporting."
//
// Two testimonial cards built like the site's proof section. "Real results." opens
// centred on its own; on "Austin Hayes" it steps aside into the right half while
// Austin's card rises in place on the left, and on "Codetic" it lifts away so Laith's
// card can rise into that half. (The devs scene before this one centres a card and
// slides it left, so this scene deliberately keeps its cards in place.) Each card's
// numeral rests on a dim baseline (1×; a captioned dash) and rolls onto its word
// ("tripled", "20"), so a figure and its unit only appear together once correct.

const CARD_W = 800;
const CARD_H = 540;
/** Cards sit centred in the safe area (y 140–880): 240 + 540 / 2 = 510. */
const ROW_TOP = 240;
/** The header block (eyebrow + h2, ~120 px) centred on the same line as the cards. */
const HEADER_TOP = 450;
/** How far the header steps right to centre on the right-hand card's column. */
const HEADER_SHIFT = LAYOUT.width - LAYOUT.padX - CARD_W / 2 - LAYOUT.width / 2;
const LEFT_X = LAYOUT.padX;
const RIGHT_X = LAYOUT.width - LAYOUT.padX - CARD_W;
const PAD_X = 48;
const PAD_TOP = 40;
const NUM = 176;
const VIZ_W = 300;
const VIZ_H = 104;
const BAR_H = 26;

/** A theme colour at a lower opacity: alpha(COLOR.accent, 0.12). */
function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// ── Sparkline geometry (deterministic, computed once) ─────────────────────────

type Pt = [number, number];

const SPARK = (() => {
  const n = 11;
  const toY = (v: number) => VIZ_H - 6 - ((v - 1) / 2) * (VIZ_H - 14);
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const trend = 1 + 2 * Math.pow(t, 1.3);
    const jitter = i === 0 || i === n - 1 ? 0 : (random(`proof-spark-${i}`) - 0.5) * 0.44;
    pts.push([t * VIZ_W, toY(Math.min(3, Math.max(1, trend + jitter)))]);
  }
  // Catmull-Rom through the points, sampled densely so the line can be cut anywhere.
  const samples: Pt[] = [];
  const steps = 14;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const cr = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
      samples.push([cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  samples.push(pts[pts.length - 1]);
  const cum = [0];
  for (let i = 1; i < samples.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(samples[i][0] - samples[i - 1][0], samples[i][1] - samples[i - 1][1]));
  }
  return { samples, cum, total: cum[cum.length - 1], baseY: toY(1) };
})();

/** The sparkline drawn up to fraction `p` of its length: its path and where its tip is. */
function sparkUpTo(p: number): { d: string; tip: Pt } {
  const { samples, cum, total } = SPARK;
  const length = p * total;
  const out: Pt[] = [samples[0]];
  let tip: Pt = samples[0];
  for (let i = 1; i < samples.length; i++) {
    if (cum[i] <= length) {
      out.push(samples[i]);
      tip = samples[i];
      continue;
    }
    const seg = cum[i] - cum[i - 1];
    const k = seg > 0 ? (length - cum[i - 1]) / seg : 0;
    tip = [mix(samples[i - 1][0], samples[i][0], k), mix(samples[i - 1][1], samples[i][1], k)];
    out.push(tip);
    break;
  }
  const d = out.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
  return { d, tip };
}

// ── Pieces ─────────────────────────────────────────────────────────────────────

/** Rising leads line over a dashed 1× baseline. `p` draws it; `age` (frames since it finished) pings the tip. */
const Sparkline: React.FC<{ p: number; age: number }> = ({ p, age }) => {
  const { d, tip } = sparkUpTo(p);
  const area = `${d} L${tip[0].toFixed(2)} ${SPARK.baseY} L0 ${SPARK.baseY} Z`;
  const ping = age >= 0 ? (age % 66) / 66 : 0;
  const drawn = p > 0.001 ? 1 : 0;
  return (
    <svg width={VIZ_W} height={VIZ_H} viewBox={`0 0 ${VIZ_W} ${VIZ_H}`} style={{ display: 'block', overflow: 'visible' }}>
      <line x1={0} x2={VIZ_W} y1={SPARK.baseY} y2={SPARK.baseY} stroke={COLOR.line2} strokeWidth={1.5} strokeDasharray="3 7" />
      <path d={area} fill={alpha(COLOR.accent, 0.12)} opacity={drawn} />
      <path d={d} fill="none" stroke={COLOR.accentText} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" opacity={drawn} />
      {age >= 0 ? <circle cx={tip[0]} cy={tip[1]} r={7 + ping * 15} fill="none" stroke={COLOR.accentText} strokeWidth={1.5} opacity={(1 - ping) * 0.45} /> : null}
      <circle cx={tip[0]} cy={tip[1]} r={6.5} fill={COLOR.accentText} stroke={COLOR.surface} strokeWidth={3} opacity={drawn} />
    </svg>
  );
};

const BAR_END = 0.24;

/** One end-of-bar marker: a short tick under the track with a mono word beneath it. */
const BarTick: React.FC<{ x: number; label: string; color: string; align: 'center' | 'right'; o: number }> = ({ x, label, color, align, o }) => (
  <div
    style={{
      position: 'absolute',
      top: BAR_H + 8,
      left: x,
      opacity: o,
      transform: `translate(${align === 'right' ? '-100%' : '-50%'}, ${(1 - o) * 6}px)`,
      display: 'flex',
      flexDirection: 'column',
      alignItems: align === 'right' ? 'flex-end' : 'center',
    }}
  >
    <div style={{ width: 2, height: 10, borderRadius: 1, background: color, marginRight: align === 'right' ? 12 : 0 }} />
    <div style={{ ...TYPE.mono, fontSize: 20, letterSpacing: '0.1em', textTransform: 'uppercase', color, marginTop: 6, whiteSpace: 'nowrap' }}>{label}</div>
  </div>
);

/**
 * Manual reporting hours: a full bar that shrinks to a quarter, leaving a dashed,
 * faintly filled track of what it was. `note` 0 → 1 adds a before / after tick pair.
 */
const ReportBar: React.FC<{ p: number; note: number; age: number }> = ({ p, note, age }) => {
  const w = VIZ_W * mix(1, BAR_END, p);
  const ghost = Math.min(1, p * 3);
  // After the before / after note lands, a soft ring keeps pinging from the bar's end.
  const ping = age >= 0 ? (age % 66) / 66 : 0;
  const r = BAR_H / 2;
  return (
    <div style={{ position: 'relative', width: VIZ_W, height: BAR_H }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: RADIUS.pill,
          border: `2px dashed ${alpha(COLOR.fg3, 0.85)}`,
          background: alpha(COLOR.fg3, 0.08),
          opacity: ghost,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: w,
          borderRadius: RADIUS.pill,
          background: interpolateColors(p, [0, 1], [alpha(COLOR.fg3, 0.6), COLOR.accentText]),
        }}
      />
      {age >= 0 ? (
        <svg
          width={VIZ_W}
          height={BAR_H}
          viewBox={`0 0 ${VIZ_W} ${BAR_H}`}
          style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
        >
          <circle cx={w - r} cy={r} r={r + ping * 12} fill="none" stroke={COLOR.accentText} strokeWidth={1.5} opacity={(1 - ping) * 0.5} />
        </svg>
      ) : null}
      <BarTick x={VIZ_W} label="Before" color={COLOR.fg3} align="right" o={note} />
      <BarTick x={VIZ_W * BAR_END - 13} label="After" color={COLOR.accentText} align="center" o={progress(note, 0.25, 0.75, EASE.out)} />
    </div>
  );
};

/** Mono caption above a mini chart. */
const VizLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ ...TYPE.mono, fontSize: 20, letterSpacing: '0.12em', textTransform: 'uppercase', color: COLOR.fg3 }}>{children}</div>
);

/** Digits stacked in a masked column; `p` 0 → 1 rolls from the first digit to the last. */
const DigitRoll: React.FC<{ digits: string[]; p: number }> = ({ digits, p }) => {
  const mask = `linear-gradient(180deg, transparent 0%, ${COLOR.bg} 13%, ${COLOR.bg} 87%, transparent 100%)`;
  return (
    <span style={{ display: 'block', height: '0.9em', overflow: 'hidden', maskImage: mask, WebkitMaskImage: mask }}>
      <span style={{ display: 'block', transform: `translateY(${-p * (digits.length - 1) * 0.9}em)` }}>
        {digits.map((d) => (
          <span key={d} style={{ display: 'block', height: '0.9em', lineHeight: 0.9 }}>
            {d}
          </span>
        ))}
      </span>
    </span>
  );
};

/** The small accent mark after a numeral (× or +), centred on the digits. */
const NumeralMark: React.FC<{ children: string; opacity: number; lift?: number }> = ({ children, opacity, lift = 0 }) => (
  <span
    style={{
      display: 'block',
      fontSize: '0.5em',
      lineHeight: 1,
      marginTop: '0.4em',
      marginLeft: '0.06em',
      color: COLOR.accentText,
      opacity,
      transform: `translateY(${lift}em)`,
    }}
  >
    {children}
  </span>
);

/** Card footer: hairline, initials avatar, name and role. */
const Person: React.FC<{ initials: string; name: string; role: string; at: number; roleAt: number }> = ({ initials, name, role, at, roleAt }) => (
  <div style={{ marginTop: 'auto' }}>
    <DrawLine at={at + 4} dur={30} length={CARD_W - PAD_X * 2} thickness={1} color={COLOR.line2} />
    <div style={{ display: 'flex', alignItems: 'center', gap: 20, paddingTop: 24 }}>
      <Reveal at={at + 2} y={0} x={-12} blur={0} scale={0.9}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: RADIUS.pill,
            border: `1px solid ${COLOR.line2}`,
            background: alpha(COLOR.fg, 0.03),
            display: 'grid',
            placeItems: 'center',
            fontFamily: FONT.heading,
            fontWeight: 500,
            fontSize: 24,
            letterSpacing: '0.02em',
            color: COLOR.fg2,
          }}
        >
          {initials}
        </div>
      </Reveal>
      <div>
        <Reveal at={at + 5} y={10} blur={0}>
          <div style={{ fontFamily: FONT.heading, fontWeight: 500, fontSize: 30, lineHeight: 1.15, letterSpacing: '-0.012em', color: COLOR.fg }}>{name}</div>
        </Reveal>
        <Reveal at={roleAt} y={10} blur={0}>
          <div style={{ fontFamily: FONT.body, fontSize: 26, lineHeight: 1.3, marginTop: 4, color: COLOR.fg3 }}>{role}</div>
        </Reveal>
      </div>
    </div>
  </div>
);

/** The card shell; `glow` 0 → 1 fades in the accent edge that marks the card being talked about. */
const ProofCard: React.FC<{ glow: number; children: React.ReactNode }> = ({ glow, children }) => (
  <Card
    padding={`${PAD_TOP}px ${PAD_X}px 36px`}
    style={{ width: CARD_W, height: CARD_H, boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}
  >
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

const statLabel: React.CSSProperties = { ...TYPE.h4, color: COLOR.fg2, marginTop: 14 };
const quoteStyle: React.CSSProperties = { ...TYPE.lede, color: COLOR.fg, textWrap: 'balance', textIndent: '-0.42em' };

// ── Scene ──────────────────────────────────────────────────────────────────────

const Proof: React.FC = () => {
  const frame = useCurrentFrame();
  const { cue, cueEnd, scene } = useCue();

  // Austin
  const tAustin = cue('Austin Hayes', { offset: -4 });
  const tOwner = cue('service business owner', { offset: -4 });
  const tTripled = cue('tripled', { offset: -3 });
  const tLeads = cue('leads', { offset: -4 });
  const tQuote1 = cue('within', { offset: -4 });
  const tDays = cueEnd('60 days');
  // Laith
  const tCodetic = cue('Codetic', { offset: -4 });
  const tDashboard = cue('dashboard', { offset: -4 });
  const tAlone = cue('alone', { offset: -2 });
  const tTwenty = cue('20');

  // Slow upward drift; the header moves at half speed for a touch of parallax.
  const drift = interpolate(frame, [0, scene.frames], [10, -20], CLAMP);

  // The header steps into the right half as card 1 rises in place on the left, then
  // lifts away just before card 2 rises into that half on "Codetic". Both cards enter
  // with a vertical rise and scale only, so they never pass the safe edges.
  const headMove = progress(frame, tAustin - 4, 26, EASE.inOut);
  const headOut = progress(frame, tCodetic - 14, 16, EASE.inOut);
  const in1 = progress(frame, tAustin, 28);
  const x1 = LEFT_X;
  const in2 = progress(frame, tCodetic, 28);
  const x2 = RIGHT_X;
  const glow1 = progress(frame, tAustin + 8, 24) * (1 - progress(frame, tCodetic, 22));
  const glow2 = progress(frame, tCodetic + 10, 24);

  // Card 1: 1× rolls to 3× on "tripled"; the line climbs through "within 60 days".
  const roll = progress(frame, tTripled, 20);
  const lit1 = progress(frame, tTripled + 6, 14);
  const spark = progress(frame, tTripled, tDays - tTripled, EASE.inOut);

  // Card 2: a dim, captioned dash rests from "Codetic"; the bar shrinks from "dashboard" to
  // carry the motion; the hours roll – → 20 quickly on "more than 20", like Austin's 1 → 3,
  // and the unit label only lands once the figure reads 20.
  const countStart = tTwenty - 14;
  const countEnd = tTwenty + 4;
  const count = Math.round(interpolate(frame, [countStart, countEnd], [0, 20], { ...CLAMP, easing: EASE.out }));
  const lit2 = progress(frame, tTwenty - 4, 14);
  const plus = springAt(frame, tTwenty + 4, { damping: 14, stiffness: 170 });
  const shrink = progress(frame, tDashboard, countEnd + 10 - tDashboard, EASE.inOut);
  const numIn = progress(frame, tCodetic + 8, 18) * mix(0.6, 1, progress(frame, countStart, 8));
  const baseIn = progress(frame, tCodetic + 10, 16);
  const baseOut = progress(frame, countStart - 2, 8);
  const tUnit = tTwenty + 2;
  const note = progress(frame, tTwenty + 6, 18);
  const noteDone = tTwenty + 6 + 18;

  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: HEADER_TOP,
          opacity: 1 - headOut,
          filter: headOut > 0 ? `blur(${headOut * 6}px)` : undefined,
          transform: `translate(${headMove * HEADER_SHIFT}px, ${drift * 0.5 - headOut * 28}px)`,
        }}
      >
        <Eyebrow at={0} style={{ justifyContent: 'center' }}>
          Proof
        </Eyebrow>
        <Headline text="Real *results.*" at={3} size="h2" align="center" style={{ marginTop: 22 }} />
      </div>

      {/* Austin Hayes */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: ROW_TOP,
          opacity: in1,
          transform: `translate(${x1}px, ${drift + (1 - in1) * 44}px) scale(${mix(0.97, 1, in1)})`,
        }}
      >
        <ProofCard glow={glow1}>
          <div style={{ ...TYPE.numeral, fontSize: NUM, lineHeight: 0.9, display: 'flex', color: interpolateColors(lit1, [0, 1], [COLOR.fg3, COLOR.fg]) }}>
            <DigitRoll digits={['1', '2', '3']} p={roll} />
            <NumeralMark opacity={mix(0.45, 1, lit1)}>×</NumeralMark>
          </div>
          <Reveal at={tLeads} y={12} blur={4}>
            <div style={statLabel}>leads in 60 days</div>
          </Reveal>
          <div style={{ position: 'absolute', top: PAD_TOP, right: PAD_X, width: VIZ_W }}>
            <Reveal at={tAustin + 8} y={10} blur={0}>
              <VizLabel>Leads</VizLabel>
            </Reveal>
            <div style={{ marginTop: 22 }}>
              <Reveal at={tAustin + 10} y={0} blur={0}>
                <Sparkline p={spark} age={frame - (tDays + 2)} />
              </Reveal>
            </div>
          </div>
          <Reveal at={tQuote1} y={16} blur={5} style={{ marginTop: 30 }}>
            <div style={quoteStyle}>“They built a system that books work for us.”</div>
          </Reveal>
          <Person initials="AH" name="Austin Hayes" role="Owner, Service Business" at={tAustin} roleAt={tOwner} />
        </ProofCard>
      </div>

      {/* Laith Hofayz, Codetic */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: ROW_TOP,
          opacity: in2,
          transform: `translate(${x2}px, ${drift + (1 - in2) * 28}px) scale(${mix(0.97, 1, in2)})`,
        }}
      >
        <ProofCard glow={glow2}>
          <div style={{ ...TYPE.numeral, fontSize: NUM, lineHeight: 0.9, display: 'flex', color: interpolateColors(lit2, [0, 1], [COLOR.fg3, COLOR.fg]) }}>
            {/* A dash, not a 0, while it waits: "0 hours saved" must never be readable. */}
            <span style={{ display: 'block', height: '0.9em', opacity: numIn, transform: `translateY(${(1 - numIn) * 0.12}em)` }}>{frame < countStart ? '–' : count}</span>
            <NumeralMark opacity={plus} lift={(1 - plus) * 0.25}>
              +
            </NumeralMark>
          </div>
          <div style={{ position: 'relative' }}>
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: statLabel.marginTop,
                ...TYPE.mono,
                fontSize: 20,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: COLOR.fg3,
                whiteSpace: 'nowrap',
                opacity: baseIn * (1 - baseOut),
                transform: `translateY(${(1 - baseIn) * 10 - baseOut * 10}px)`,
              }}
            >
              Hours saved / wk
            </div>
            <Reveal at={tUnit} y={12} blur={4}>
              <div style={statLabel}>hours a week saved</div>
            </Reveal>
          </div>
          <div style={{ position: 'absolute', top: PAD_TOP, right: PAD_X, width: VIZ_W }}>
            <Reveal at={tCodetic + 8} y={10} blur={0}>
              <VizLabel>Manual reporting</VizLabel>
            </Reveal>
            <div style={{ marginTop: 22 + (VIZ_H - BAR_H) / 2 }}>
              <Reveal at={tCodetic + 10} y={0} blur={0}>
                <ReportBar p={shrink} note={note} age={frame - noteDone} />
              </Reveal>
            </div>
          </div>
          <Reveal at={tAlone} y={16} blur={5} style={{ marginTop: 30 }}>
            <div style={quoteStyle}>“The dashboard alone saved us 20 hours a week in manual reporting.”</div>
          </Reveal>
          <Person initials="LH" name="Laith Hofayz" role="Director, Codetic" at={tCodetic} roleAt={tCodetic + 4} />
        </ProofCard>
      </div>
    </AbsoluteFill>
  );
};

export default Proof;
