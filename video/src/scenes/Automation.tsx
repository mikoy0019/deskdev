import React from 'react';
import { AbsoluteFill, interpolate, random, useCurrentFrame } from 'remotion';
import { Icon, type IconName } from '../components/Icon';
import { Card, Chip } from '../components/Surfaces';
import { Eyebrow, Headline, Reveal } from '../components/Text';
import { CLAMP, EASE, mix, progress, springAt } from '../lib/motion';
import { useCue } from '../lib/scene';
import { COLOR, FONT, RADIUS, SHADOW } from '../theme';

/*
 * 02 · Automation & AI: "Every lead, answered."
 *
 * Act 1  A web form fills in and is submitted on "inquiry"; a dot carries it to an
 *        email that lands on "instant reply", then on to the CRM on "lands in your CRM".
 * Act 2  "Follow-ups and reminders": a row of scheduled steps appears, then ticks to
 *        done one by one on "run themselves".
 * Act 3  "AI voice agent": a live call card (waveform, the agent's line) and the
 *        booking confirmation on "book appointments".
 */

// ---------------------------------------------------------------------------
// Layout. Offer-scene safe area is x 140–1780, y 240–880. Everything sits inside
// x 150–1770 so the ±10 px drift never leaves it.
// ---------------------------------------------------------------------------
const X0 = 150;
const WIDTH = 1620;
const EYEBROW_Y = 242;
const HEADLINE_Y = 280;
const ROW_Y = 392;
const CARD_W = 470;
const CARD_H = 256;
const LINK_W = (WIDTH - CARD_W * 3) / 2;
const CARD_X = [X0, X0 + CARD_W + LINK_W, X0 + 2 * (CARD_W + LINK_W)] as const;
const PORT_Y = ROW_Y + CARD_H / 2;
const LOW_Y = 680;
const CALL_X = 1000;
const CALL_W = X0 + WIDTH - CALL_X;
const CALL_H = 192;
const PAD = 22;
/**
 * Act 1 sits this much lower so the eyebrow → flow row block is centred in the frame; it
 * eases up to its final place just before act 2 needs the lower band.
 */
const ACT1_LIFT = 100;
/** Follow-up block (26 px label + 20 gap + 48 px chips) centred on the call card beside it. */
const FOLLOW_Y = LOW_Y + Math.round((CALL_H - 94) / 2);

/** Mono uppercase card label, like the site's eyebrows but at a readable 20 px. */
const LABEL: React.CSSProperties = {
  fontFamily: FONT.mono,
  fontWeight: 500,
  fontSize: 20,
  lineHeight: '26px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: COLOR.fg3,
  whiteSpace: 'nowrap',
};

/** Text meant to be read inside the mock UI. */
const READ: React.CSSProperties = {
  fontFamily: FONT.body,
  fontWeight: 400,
  fontSize: 26,
  lineHeight: 1.3,
  letterSpacing: '-0.01em',
  color: COLOR.fg,
};

const CHIP_MD: React.CSSProperties = { fontSize: 22, padding: '7px 16px' };
const CHIP_SM: React.CSSProperties = { fontSize: 20, padding: '6px 14px' };

/** Characters of `text` typed so far: one every `perChar` frames from `start`. */
function typed(frame: number, text: string, start: number, perChar: number): string {
  const n = Math.max(0, Math.min(text.length, Math.floor((frame - start) / perChar)));
  return text.slice(0, n);
}

// ---------------------------------------------------------------------------
// Timing, all on the voice.
// ---------------------------------------------------------------------------
function useTiming() {
  const { cue } = useCue();
  const press = cue('inquiry', { offset: -4 });
  const card2 = cue('instant reply', { offset: -6 });
  const card3 = cue('lands in your CRM', { offset: -4 });
  const run = cue('run themselves', { offset: -2 });
  return {
    eyebrow: 2,
    headline: 8,
    enter: [14, 20, 26] as const,
    links: 34,
    typeName: 30,
    typeMsg: 44,
    press,
    dot1: [press + 8, card2 + 1] as const,
    card2,
    sent: cue('instant reply', { offset: -2 }),
    dot2: [card2 + 14, card3 + 1] as const,
    card3,
    crmLine: cue('CRM', { offset: -4 }),
    follow: cue('Follow-ups and reminders', { offset: -4 }),
    reminders: cue('reminders', { offset: -4 }),
    ticks: [run, run + 9, run + 18] as const,
    call: cue('AI voice agent', { offset: -4 }),
    // The agent starts talking right after the ring, so the card never sits empty.
    line: cue('agent', { offset: -6 }),
    booked: cue('book appointments', { offset: -4 }),
    restore: cue('for you', { offset: -4 }),
  };
}

type Timing = ReturnType<typeof useTiming>;

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/** A flow node: a Card that enters, can sit dormant (dim) and carries an animated highlight. */
const NodeCard: React.FC<{
  x: number;
  y: number;
  w: number;
  h: number;
  enter: number;
  from?: { x?: number; y?: number };
  /** 0 = dormant (dim, waiting), 1 = live. */
  live?: number;
  /** 0..1 accent highlight. */
  glow?: number;
  padding?: number | string;
  children?: React.ReactNode;
}> = ({ x, y, w, h, enter, from = { y: 18 }, live = 1, glow = 0, padding = PAD, children }) => {
  const frame = useCurrentFrame();
  const p = progress(frame, enter, 22);
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        opacity: p * mix(0.5, 1, live),
        transform: `translate(${(from.x ?? 0) * (1 - p)}px, ${(from.y ?? 0) * (1 - p)}px) scale(${mix(0.975, 1, p)})`,
        filter: p < 1 ? `blur(${(1 - p) * 6}px)` : undefined,
      }}
    >
      <Card padding={padding} style={{ width: '100%', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
        {children}
      </Card>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: RADIUS.lg,
          border: `1px solid ${COLOR.accent}`,
          boxShadow: SHADOW.accent,
          opacity: glow * 0.8,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
};

/** Icon + mono label + right-aligned meta. `show` fades the words in (dormant cards show only the icon). */
const CardHeader: React.FC<{ icon: IconName; label: string; meta?: string; show?: number }> = ({ icon, label, meta, show = 1 }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: 26, flexShrink: 0 }}>
    <Icon name={icon} size={22} color={COLOR.accentText} />
    <span style={{ ...LABEL, opacity: show, transform: `translateX(${(1 - show) * -8}px)` }}>{label}</span>
    <span style={{ flex: 1 }} />
    {meta ? <span style={{ ...LABEL, letterSpacing: '0.04em', opacity: show }}>{meta}</span> : null}
  </div>
);

/** Grey placeholder bars for a node that hasn't received anything yet. Leaves with a soft blur. */
const Skeleton: React.FC<{ rows: number[]; out: number; avatar?: boolean }> = ({ rows, out, avatar }) => {
  const frame = useCurrentFrame();
  const p = progress(frame, out, 12);
  if (p >= 1) return null;
  const breathe = (i: number) => 0.7 + 0.3 * Math.sin(frame / 10 + i * 0.9);
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        paddingTop: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        opacity: 1 - p,
        transform: `translateY(${-p * 8}px)`,
        filter: p > 0 ? `blur(${p * 4}px)` : undefined,
      }}
    >
      {avatar ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 22, background: COLOR.line2, opacity: breathe(0) }} />
          <div style={{ width: '58%', height: 14, borderRadius: 7, background: COLOR.line2, opacity: breathe(0.5) }} />
        </div>
      ) : null}
      {rows.map((w, i) => (
        <div key={i} style={{ width: `${w * 100}%`, height: 14, borderRadius: 7, background: COLOR.line2, opacity: breathe(i + 1) }} />
      ))}
    </div>
  );
};

/** Pops a small confirmation in with a touch of overshoot (damping ≥ 14). */
const ChipPop: React.FC<{ at: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ at, children, style }) => {
  const frame = useCurrentFrame();
  const s = springAt(frame, at, { damping: 15, stiffness: 190 });
  const o = progress(frame, at, 8);
  return (
    <div
      style={{
        display: 'inline-block',
        opacity: o,
        transform: `translateY(${(1 - s) * 10}px) scale(${mix(0.86, 1, s)})`,
        transformOrigin: 'left center',
        ...style,
      }}
    >
      {children}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Card 1: the website form
// ---------------------------------------------------------------------------

const Field: React.FC<{ icon: IconName; value: string; caret: boolean; focus: number }> = ({ icon, value, caret, focus }) => {
  const frame = useCurrentFrame();
  const blink = Math.floor(frame / 9) % 2 === 0;
  return (
    <div
      style={{
        position: 'relative',
        height: 50,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '0 16px',
        borderRadius: RADIUS.sm,
        background: COLOR.bg2,
        border: `1px solid ${COLOR.line2}`,
        flexShrink: 0,
      }}
    >
      <div style={{ position: 'absolute', inset: -1, borderRadius: RADIUS.sm, border: `1px solid ${COLOR.accent}`, opacity: focus * 0.7 }} />
      <Icon name={icon} size={20} color={COLOR.fg3} />
      <span style={{ ...READ, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center' }}>
        {value}
        {caret ? <span style={{ width: 2, height: 28, marginLeft: 2, background: COLOR.accentText, opacity: blink ? 1 : 0 }} /> : null}
      </span>
    </div>
  );
};

const SubmitButton: React.FC<{ press: number }> = ({ press }) => {
  const frame = useCurrentFrame();
  const down = progress(frame, press, 4) * (1 - progress(frame, press + 6, 8));
  const done = progress(frame, press + 9, 12);
  const ripple = progress(frame, press + 2, 20);
  const label: React.CSSProperties = {
    position: 'absolute',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    fontFamily: FONT.body,
    fontWeight: 600,
    fontSize: 22,
    color: COLOR.accentFg,
  };
  return (
    <div
      style={{
        position: 'relative',
        height: 48,
        marginTop: 'auto',
        flexShrink: 0,
        borderRadius: RADIUS.sm,
        background: COLOR.accent,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: `scale(${1 - 0.035 * down})`,
      }}
    >
      <div style={{ position: 'absolute', inset: 0, background: COLOR.bg, opacity: 0.24 * down }} />
      <div
        style={{
          position: 'absolute',
          left: '61%',
          top: '50%',
          width: 360,
          height: 360,
          marginLeft: -180,
          marginTop: -180,
          borderRadius: 180,
          background: COLOR.accentFg,
          opacity: frame >= press + 2 ? 0.2 * (1 - ripple) : 0,
          transform: `scale(${ripple})`,
        }}
      />
      <div style={{ ...label, opacity: 1 - done, transform: `translateY(${-done * 16}px)` }}>
        Submit
        <Icon name="arrowRight" size={20} />
      </div>
      <div style={{ ...label, opacity: done, transform: `translateY(${(1 - done) * 16}px)` }}>
        <Icon name="check" size={20} />
        Submitted
      </div>
    </div>
  );
};

const FormBody: React.FC<{ t: Timing }> = ({ t }) => {
  const frame = useCurrentFrame();
  const name = typed(frame, 'Maria G.', t.typeName, 1.5);
  const msg = typed(frame, 'Need a quote this week', t.typeMsg, 1);
  const nameFocus = progress(frame, t.typeName - 6, 6) * (1 - progress(frame, t.typeMsg - 2, 6));
  const msgFocus = progress(frame, t.typeMsg - 2, 6) * (1 - progress(frame, t.press + 4, 8));
  return (
    <>
      <CardHeader icon="globe" label="Website form" meta="9:04 PM" />
      <div style={{ height: 14, flexShrink: 0 }} />
      <Field icon="user" value={name} caret={nameFocus > 0.5} focus={nameFocus} />
      <div style={{ height: 10, flexShrink: 0 }} />
      <Field icon="message" value={msg} caret={msgFocus > 0.5} focus={msgFocus} />
      <SubmitButton press={t.press} />
    </>
  );
};

// ---------------------------------------------------------------------------
// Card 2: the instant reply
// ---------------------------------------------------------------------------

const EmailBody: React.FC<{ t: Timing }> = ({ t }) => {
  const frame = useCurrentFrame();
  const show = progress(frame, t.card2, 12);
  return (
    <>
      <CardHeader icon="mail" label="Email" meta="9:04 PM" show={show} />
      <div style={{ position: 'relative', flex: 1, marginTop: 14, display: 'flex', flexDirection: 'column' }}>
        <Skeleton rows={[0.62, 0.92, 0.78, 0.4]} out={t.card2} />
        <Reveal at={t.card2} y={12} blur={4}>
          <div style={{ ...READ, fontWeight: 600, whiteSpace: 'nowrap' }}>Re: your quote request</div>
        </Reveal>
        <Reveal at={t.card2 + 4} y={12} blur={4} style={{ marginTop: 4 }}>
          <div style={{ ...READ, color: COLOR.fg2, whiteSpace: 'nowrap' }}>
            Thanks Maria,
            <br />
            we{'’'}ll call you at 10:00.
          </div>
        </Reveal>
        <div style={{ marginTop: 'auto' }}>
          <ChipPop at={t.sent}>
            <Chip tone="success" icon="check" style={CHIP_MD}>
              Sent instantly
            </Chip>
          </ChipPop>
        </div>
      </div>
    </>
  );
};

// ---------------------------------------------------------------------------
// Card 3: the CRM record
// ---------------------------------------------------------------------------

const CrmBody: React.FC<{ t: Timing }> = ({ t }) => {
  const frame = useCurrentFrame();
  const show = progress(frame, t.card3, 12);
  return (
    <>
      <CardHeader icon="users" label="CRM" meta="9:04 PM" show={show} />
      <div style={{ position: 'relative', flex: 1, marginTop: 12, display: 'flex', flexDirection: 'column' }}>
        <Skeleton rows={[0.8, 0.5]} out={t.card3} avatar />
        <Reveal at={t.card3} y={12} blur={4}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, height: 44 }}>
            <div style={{ position: 'relative', width: 44, height: 44, flexShrink: 0 }}>
              <div style={{ position: 'absolute', inset: 0, borderRadius: 22, background: COLOR.accent, opacity: 0.18 }} />
              <div style={{ position: 'absolute', inset: 0, borderRadius: 22, border: `1px solid ${COLOR.accent}`, opacity: 0.55 }} />
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: FONT.heading,
                  fontWeight: 600,
                  fontSize: 20,
                  letterSpacing: '0.01em',
                  color: COLOR.accentText,
                }}
              >
                MG
              </div>
            </div>
            <div style={{ ...READ, fontWeight: 500, whiteSpace: 'nowrap' }}>
              New lead <span style={{ color: COLOR.fg3 }}>·</span> Maria G.
            </div>
          </div>
        </Reveal>
        <Reveal at={t.card3 + 6} y={12} blur={4} style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', gap: 30 }}>
            <div>
              <div style={LABEL}>Stage</div>
              <div style={{ marginTop: 6 }}>
                <Chip tone="accent" style={CHIP_SM}>
                  Contacted
                </Chip>
              </div>
            </div>
            <div>
              <div style={LABEL}>Source</div>
              <div style={{ marginTop: 6 }}>
                <Chip icon="globe" style={CHIP_SM}>
                  Website
                </Chip>
              </div>
            </div>
          </div>
        </Reveal>
        <Reveal at={t.crmLine} y={8} blur={3} style={{ marginTop: 'auto' }}>
          <div
            style={{
              borderTop: `1px solid ${COLOR.line}`,
              paddingTop: 10,
              fontFamily: FONT.mono,
              fontSize: 20,
              lineHeight: '24px',
              color: COLOR.fg2,
              whiteSpace: 'nowrap',
            }}
          >
            HubSpot · GoHighLevel · Salesforce
          </div>
        </Reveal>
      </div>
    </>
  );
};

// ---------------------------------------------------------------------------
// Connectors between the nodes
// ---------------------------------------------------------------------------

const Port: React.FC<{ x: number; enter: number; on: number }> = ({ x, enter, on }) => {
  const frame = useCurrentFrame();
  const p = progress(frame, enter, 14);
  return (
    <div
      style={{
        position: 'absolute',
        left: x - 8,
        top: PORT_Y - 8,
        width: 16,
        height: 16,
        boxSizing: 'border-box',
        borderRadius: 8,
        background: COLOR.surface2,
        border: `2px solid ${COLOR.line2}`,
        opacity: p,
        transform: `scale(${mix(0.4, 1, p)})`,
      }}
    >
      <div style={{ position: 'absolute', inset: -2, borderRadius: 8, border: `2px solid ${COLOR.accent}`, opacity: on }} />
      <div style={{ position: 'absolute', left: 3, top: 3, width: 6, height: 6, borderRadius: 3, background: COLOR.accentText, opacity: on }} />
    </div>
  );
};

/** A hairline that draws in, then an accent trail behind a travelling dot. */
const Link: React.FC<{ x1: number; x2: number; draw: number; go: readonly [number, number] }> = ({ x1, x2, draw, go }) => {
  const frame = useCurrentFrame();
  const len = x2 - x1;
  const d = progress(frame, draw, 22, EASE.inOut);
  const k = progress(frame, go[0], go[1] - go[0], EASE.inOut);
  const dot = progress(frame, go[0] - 3, 4) * (1 - progress(frame, go[1], 6));
  const x = x1 + len * k;
  return (
    <>
      <div style={{ position: 'absolute', left: x1, top: PORT_Y - 1, width: len * d, height: 2, borderRadius: 1, background: COLOR.line2 }} />
      <div style={{ position: 'absolute', left: x1, top: PORT_Y - 1, width: len * k, height: 2, borderRadius: 1, background: COLOR.accent }} />
      {dot > 0 ? (
        <>
          <div style={{ position: 'absolute', left: x - 14, top: PORT_Y - 14, width: 28, height: 28, borderRadius: 14, background: COLOR.accent, opacity: 0.22 * dot }} />
          <div style={{ position: 'absolute', left: x - 6, top: PORT_Y - 6, width: 12, height: 12, borderRadius: 6, background: COLOR.accentText, opacity: dot }} />
        </>
      ) : null}
    </>
  );
};

// ---------------------------------------------------------------------------
// Act 2: follow-ups that run themselves
// ---------------------------------------------------------------------------

const StepChip: React.FC<{ label: string; appear: number; tick: number }> = ({ label, appear, tick }) => {
  const frame = useCurrentFrame();
  const a = progress(frame, appear, 14);
  const k = progress(frame, tick, 10);
  const pop = springAt(frame, tick, { damping: 14, stiffness: 200 });
  return (
    <div
      style={{
        position: 'relative',
        opacity: a,
        transform: `translateX(${(1 - a) * -14}px)`,
        filter: a < 1 ? `blur(${(1 - a) * 4}px)` : undefined,
      }}
    >
      <div style={{ opacity: 1 - k }}>
        <Chip icon="clock" style={CHIP_MD}>
          {label}
        </Chip>
      </div>
      <div style={{ position: 'absolute', inset: 0, opacity: k, transform: `scale(${mix(0.92, 1, pop)})` }}>
        <Chip tone="accent" icon="check" style={CHIP_MD}>
          {label}
        </Chip>
      </div>
    </div>
  );
};

const FollowUps: React.FC<{ t: Timing; dim: number }> = ({ t, dim }) => (
  <div style={{ position: 'absolute', left: X0, top: FOLLOW_Y, opacity: dim }}>
    <Reveal at={t.follow} y={10} blur={4}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: 26 }}>
        <Icon name="refresh" size={22} color={COLOR.accentText} />
        <span style={LABEL}>On autopilot</span>
      </div>
    </Reveal>
    <div style={{ display: 'flex', gap: 14, marginTop: 20 }}>
      <StepChip label="Day 1 follow-up" appear={t.follow + 4} tick={t.ticks[0]} />
      <StepChip label="Day 3 follow-up" appear={t.follow + 13} tick={t.ticks[1]} />
      <StepChip label="Appointment reminder" appear={t.reminders} tick={t.ticks[2]} />
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Act 3: the AI voice agent
// ---------------------------------------------------------------------------

const PhoneBadge: React.FC<{ ringFrom: number; ringTo: number }> = ({ ringFrom, ringTo }) => {
  const frame = useCurrentFrame();
  const PERIOD = 26;
  const local = frame - ringFrom;
  const cycle = Math.floor(local / PERIOD);
  const phase = (local - cycle * PERIOD) / PERIOD;
  const ringing = local >= 0 && ringFrom + cycle * PERIOD < ringTo;
  return (
    <div style={{ position: 'relative', width: 44, height: 44, flexShrink: 0 }}>
      {ringing ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 22,
            border: `1.5px solid ${COLOR.accent}`,
            opacity: 0.55 * (1 - phase),
            transform: `scale(${1 + 0.32 * EASE.out(phase)})`,
          }}
        />
      ) : null}
      <div style={{ position: 'absolute', inset: 0, borderRadius: 22, background: COLOR.accent, opacity: 0.18 }} />
      <div style={{ position: 'absolute', inset: 0, borderRadius: 22, border: `1px solid ${COLOR.accent}`, opacity: 0.55 }} />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="phone" size={20} color={COLOR.accentText} />
      </div>
    </div>
  );
};

/** Speech-like bars: deterministic noise, shaped by a syllable rhythm while the agent talks. */
const Waveform: React.FC<{ from: number; to: number }> = ({ from, to }) => {
  const frame = useCurrentFrame();
  const BARS = 26;
  const MAX = 40;
  const MIN = 8;
  const talk = progress(frame, from, 10) * (1 - progress(frame, to, 18));
  const syllable = 0.5 + 0.5 * Math.abs(Math.sin(frame * 0.29 + 1.3 * Math.sin(frame * 0.083)));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: MAX, flexShrink: 0 }}>
      {Array.from({ length: BARS }, (_, i) => {
        const shape = 0.3 + 0.7 * Math.sin((Math.PI * (i + 0.5)) / BARS);
        const tt = frame / 2.2 + i * 0.37;
        const step = Math.floor(tt);
        const f = tt - step;
        const noise = mix(random(`agent-wave-${i}-${step}`), random(`agent-wave-${i}-${step + 1}`), f * f * (3 - 2 * f));
        // Idle: a slow, low swell travelling across the bars. Talking: syllable-shaped noise.
        const breathe = 0.5 + 0.5 * Math.sin(frame / 13 - i * 0.42);
        const amp = mix(0.4 + 0.45 * breathe, 0.25 + 0.75 * noise, talk);
        const level = mix(0.55, 1, talk) * mix(1, syllable, talk);
        const h = MIN + (MAX - MIN) * shape * level * amp;
        return <div key={i} style={{ width: 4, height: h, borderRadius: 2, background: COLOR.accentText, opacity: mix(0.6, 1, talk) }} />;
      })}
    </div>
  );
};

const AGENT_LINE = ['“I', 'can', 'book', 'you', 'for', 'Tuesday', 'at', '10.”'];

/** Three soft dots while the call connects; they hand over to the transcript. */
const Connecting: React.FC<{ from: number; to: number }> = ({ from, to }) => {
  const frame = useCurrentFrame();
  const o = progress(frame, from, 10) * (1 - progress(frame, to - 4, 8));
  if (o <= 0) return null;
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, height: 34, display: 'flex', alignItems: 'center', gap: 8, opacity: o }}>
      {[0, 1, 2].map((i) => {
        const pulse = 0.5 + 0.5 * Math.sin((frame - from) / 4.5 - i * 1.1);
        return (
          <div
            key={i}
            style={{ width: 10, height: 10, borderRadius: 5, background: COLOR.fg3, opacity: mix(0.35, 1, pulse), transform: `translateY(${-3 * pulse}px)` }}
          />
        );
      })}
    </div>
  );
};

const Transcript: React.FC<{ at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ ...READ, whiteSpace: 'nowrap', height: 34 }}>
      {AGENT_LINE.map((w, i) => {
        const p = progress(frame, at + i * 2.6, 9);
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              marginRight: i < AGENT_LINE.length - 1 ? '0.26em' : 0,
              opacity: p,
              transform: `translateY(${(1 - p) * 8}px)`,
            }}
          >
            {w}
          </span>
        );
      })}
    </div>
  );
};

const CallCard: React.FC<{ t: Timing; glow: number }> = ({ t, glow }) => (
  <NodeCard x={CALL_X} y={LOW_Y} w={CALL_W} h={CALL_H} enter={t.call} from={{ x: -40 }} glow={glow} padding="20px 28px">
    <div style={{ display: 'flex', alignItems: 'center', gap: 20, height: 44, flexShrink: 0 }}>
      <PhoneBadge ringFrom={t.call + 4} ringTo={t.line} />
      <span style={LABEL}>
        Incoming call <span style={{ color: COLOR.fg3 }}>·</span> <span style={{ color: COLOR.accentText }}>AI voice agent</span>
      </span>
      <span style={{ flex: 1 }} />
      <Waveform from={t.line - 4} to={t.line + Math.round(AGENT_LINE.length * 2.6) + 12} />
    </div>
    <div style={{ position: 'relative', marginLeft: 64, marginTop: 12 }}>
      <Connecting from={t.call + 8} to={t.line} />
      <Transcript at={t.line} />
    </div>
    <div style={{ marginLeft: 64, marginTop: 12 }}>
      <ChipPop at={t.booked}>
        <Chip tone="success" icon="check" style={CHIP_MD}>
          Appointment booked · Tue 10:00 AM
        </Chip>
      </ChipPop>
    </div>
  </NodeCard>
);

// ---------------------------------------------------------------------------
// The cursor that submits the form
// ---------------------------------------------------------------------------

const CURSOR_PATH = 'M5 3v16.5l4.3-4.1 2.9 6.6 2.9-1.3-2.9-6.4H18z';

const Cursor: React.FC<{ press: number }> = ({ press }) => {
  const frame = useCurrentFrame();
  const move = progress(frame, press - 26, 24, EASE.inOut);
  const leave = progress(frame, press + 12, 18, EASE.inOut);
  const opacity = progress(frame, press - 28, 8) * (1 - leave);
  if (opacity <= 0) return null;
  const down = progress(frame, press, 4) * (1 - progress(frame, press + 6, 6));
  const x = mix(560, 434, move) + 44 * leave;
  const y = mix(724, 606, move) + 30 * leave;
  return (
    <svg
      width={30}
      height={30}
      viewBox="0 0 24 24"
      style={{
        position: 'absolute',
        left: x - 6.25,
        top: y - 3.75,
        opacity,
        overflow: 'visible',
        transform: `scale(${1 - 0.14 * down})`,
        transformOrigin: '6.25px 3.75px',
      }}
    >
      <path d={CURSOR_PATH} fill={COLOR.fg} stroke={COLOR.bg} strokeWidth={1.4} strokeLinejoin="round" />
    </svg>
  );
};

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

const Automation: React.FC = () => {
  const frame = useCurrentFrame();
  const { scene } = useCue();
  const t = useTiming();

  // The whole composition pans slowly left so no frame sits frozen.
  const drift = interpolate(frame, [0, scene.frames + 12], [10, -10], CLAMP);

  // The highlight walks with the signal: form → email → CRM, then the call.
  const glow1 = progress(frame, t.enter[0] + 12, 14) * (1 - progress(frame, t.dot1[0], 16));
  const glow2 = progress(frame, t.card2, 10) * (1 - progress(frame, t.dot2[0] + 4, 16));
  const glow3 = progress(frame, t.card3, 10) * (1 - progress(frame, t.follow, 18));
  const glowCall = progress(frame, t.call + 6, 14);

  // While the voice agent talks, the rest steps back a little; it all comes back on "for you".
  const focusCall = progress(frame, t.call - 2, 18) * (1 - progress(frame, t.restore, 20));
  const topDim = 1 - 0.3 * focusCall;
  const followDim = 1 - 0.22 * focusCall;

  // Act 1 starts centred, then the whole top group eases up to make room for act 2.
  const lift = ACT1_LIFT * (1 - progress(frame, t.follow - 14, 24, EASE.inOut));

  const live2 = progress(frame, t.card2, 12);
  const live3 = progress(frame, t.card3, 12);

  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `translateX(${drift}px)` }}>
        <AbsoluteFill style={{ transform: `translateY(${lift}px)` }}>
          <div style={{ position: 'absolute', left: X0, top: EYEBROW_Y }}>
            <Eyebrow index="02" at={t.eyebrow}>
              {'Automation & AI'}
            </Eyebrow>
          </div>
          <div style={{ position: 'absolute', left: X0, top: HEADLINE_Y }}>
            <Headline text="Every lead, *answered.*" size="h2" at={t.headline} stagger={3} />
          </div>

          <div style={{ position: 'absolute', inset: 0, opacity: topDim }}>
            <NodeCard x={CARD_X[0]} y={ROW_Y} w={CARD_W} h={CARD_H} enter={t.enter[0]} glow={glow1}>
              <FormBody t={t} />
            </NodeCard>
            <NodeCard x={CARD_X[1]} y={ROW_Y} w={CARD_W} h={CARD_H} enter={t.enter[1]} live={live2} glow={glow2}>
              <EmailBody t={t} />
            </NodeCard>
            <NodeCard x={CARD_X[2]} y={ROW_Y} w={CARD_W} h={CARD_H} enter={t.enter[2]} live={live3} glow={glow3}>
              <CrmBody t={t} />
            </NodeCard>

            <Link x1={CARD_X[0] + CARD_W + 8} x2={CARD_X[1] - 8} draw={t.links} go={t.dot1} />
            <Link x1={CARD_X[1] + CARD_W + 8} x2={CARD_X[2] - 8} draw={t.links + 6} go={t.dot2} />
            <Port x={CARD_X[0] + CARD_W} enter={t.links - 4} on={progress(frame, t.dot1[0] - 2, 6)} />
            <Port x={CARD_X[1]} enter={t.links + 12} on={progress(frame, t.dot1[1] - 1, 6)} />
            <Port x={CARD_X[1] + CARD_W} enter={t.links + 2} on={progress(frame, t.dot2[0] - 2, 6)} />
            <Port x={CARD_X[2]} enter={t.links + 18} on={progress(frame, t.dot2[1] - 1, 6)} />
          </div>
          <Cursor press={t.press} />
        </AbsoluteFill>

        <FollowUps t={t} dim={followDim} />
        <CallCard t={t} glow={glowCall} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export default Automation;
