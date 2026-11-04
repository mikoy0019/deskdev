import React, { useMemo } from 'react';
import { AbsoluteFill, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { CLAMP, EASE, progress } from '../lib/motion';
import { useScene } from '../lib/scene';
import { BEATS, CHAPTERS, CROSSFADE, OFFER_SCENES, SCENES, TOTAL_FRAMES } from '../timeline';
import { COLOR, FONT, LAYOUT, TYPE } from '../theme';

const pad = (n: number) => String(n).padStart(2, '0');

/** Near-black field with two slow accent glows, a faint grid, a vignette and film grain. Absolute frames. */
export const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / 30;
  const ax = 24 + Math.sin(t * 0.13) * 5;
  const ay = 16 + Math.cos(t * 0.11) * 4;
  const bx = 80 + Math.cos(t * 0.09) * 6;
  const by = 90 + Math.sin(t * 0.12) * 4;
  const gridMask = 'radial-gradient(ellipse 70% 62% at 50% 44%, #000 20%, transparent 78%)';
  return (
    <AbsoluteFill style={{ backgroundColor: COLOR.bg }}>
      <AbsoluteFill style={{ background: `radial-gradient(1200px 820px at ${ax}% ${ay}%, rgba(43, 102, 255, 0.17), transparent 70%)` }} />
      <AbsoluteFill style={{ background: `radial-gradient(1000px 700px at ${bx}% ${by}%, rgba(34, 211, 238, 0.06), transparent 70%)` }} />
      <AbsoluteFill
        style={{
          backgroundImage:
            'linear-gradient(rgba(226, 232, 255, 0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(226, 232, 255, 0.035) 1px, transparent 1px)',
          backgroundSize: '96px 96px',
          backgroundPosition: '-1px -1px',
          maskImage: gridMask,
          WebkitMaskImage: gridMask,
        }}
      />
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse 90% 85% at 50% 45%, transparent 55%, rgba(0, 0, 0, 0.55) 100%)' }} />
      <AbsoluteFill
        style={{
          backgroundImage: `url(${staticFile('noise.png')})`,
          backgroundSize: '256px 256px',
          backgroundPosition: `${(frame * 37) % 256}px ${(frame * 53) % 256}px`,
          opacity: 0.05,
        }}
      />
    </AbsoluteFill>
  );
};

/** Fades a scene in, and out through a short blur while the next scene fades in. Scene-local frames. */
export const SceneShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  const scene = useScene();
  const first = scene.index === 0;
  const last = scene.index === SCENES.length - 1;
  const enter = progress(frame, 0, first ? 20 : CROSSFADE + 2, EASE.out);
  const exit = last ? 0 : progress(frame, scene.frames, CROSSFADE, EASE.inOut);
  return (
    <AbsoluteFill
      style={{
        opacity: enter * (1 - exit),
        filter: exit > 0 ? `blur(${exit * 10}px)` : undefined,
        transform: exit > 0 ? `translateY(${-exit * 18}px)` : undefined,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

/** Wordmark top-left; chapter label and chapter progress top-right. Absolute frames. */
export const Hud: React.FC = () => {
  const frame = useCurrentFrame();
  // The hook is a cold open with no NixGen branding (SCENES.md); the HUD arrives with "We're NixGen".
  const brandAt = (SCENES.find((s) => s.id === 'who')?.start ?? 0) + 20;
  const opacity = progress(frame, brandAt, 24) * (1 - progress(frame, TOTAL_FRAMES - 80, 20));
  const chapter = [...CHAPTERS].reverse().find((c) => frame >= c.start) ?? CHAPTERS[0];
  const label = progress(frame, chapter.start, 16);
  return (
    <AbsoluteFill style={{ opacity }}>
      <div
        style={{
          position: 'absolute',
          top: 44,
          left: LAYOUT.padX,
          fontFamily: FONT.heading,
          fontWeight: 600,
          fontSize: 26,
          letterSpacing: '0.08em',
          color: COLOR.fg,
        }}
      >
        NIXGEN<span style={{ color: COLOR.accentText }}>.</span>
      </div>
      <div style={{ position: 'absolute', top: 46, right: LAYOUT.padX, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 12 }}>
        <div
          style={{
            ...TYPE.eyebrow,
            fontSize: 15,
            color: COLOR.fg3,
            display: 'flex',
            gap: 14,
            opacity: label,
            transform: `translateY(${(1 - label) * 6}px)`,
          }}
        >
          <span style={{ color: COLOR.accentText }}>
            {pad(chapter.index + 1)} / {pad(CHAPTERS.length)}
          </span>
          <span>{chapter.title}</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {CHAPTERS.map((c) => {
            const fill = interpolate(frame, [c.start, c.end], [0, 1], CLAMP);
            return (
              <div key={c.id} style={{ width: 40, height: 3, borderRadius: 2, background: COLOR.line2, overflow: 'hidden' }}>
                <div style={{ width: `${fill * 100}%`, height: '100%', background: c.index === chapter.index ? COLOR.accent : COLOR.fg3 }} />
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const OFFERS = ['Websites', 'Automation & AI', 'Apps & dashboards', 'Dedicated developers'];

/** The four-part rail above the offer scenes; the current part's bar fills as it plays. Absolute frames. */
export const OfferRail: React.FC = () => {
  const frame = useCurrentFrame();
  const scenes = OFFER_SCENES.map((id) => SCENES.find((s) => s.id === id)!);
  const first = scenes[0];
  const last = scenes[scenes.length - 1];
  const end = last.start + last.frames;
  if (frame < first.start - 8 || frame > end + CROSSFADE) return null;
  const opacity = progress(frame, first.start - 8, 18) * (1 - progress(frame, end, CROSSFADE));
  return (
    <div style={{ position: 'absolute', top: LAYOUT.railTop, left: LAYOUT.padX, right: LAYOUT.padX, display: 'flex', gap: 16, opacity }}>
      {OFFERS.map((label, i) => {
        const s = scenes[i];
        const fill = interpolate(frame, [s.start, s.start + s.frames], [0, 1], CLAMP);
        const on = frame >= s.start && frame < s.start + s.frames;
        const done = frame >= s.start + s.frames;
        return (
          <div key={label} style={{ flex: 1 }}>
            <div style={{ height: 2, background: COLOR.line2, borderRadius: 1, overflow: 'hidden' }}>
              <div style={{ width: `${fill * 100}%`, height: '100%', background: on ? COLOR.accent : COLOR.fg3 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 14, ...TYPE.small, color: on ? COLOR.fg : done ? COLOR.fg2 : COLOR.fg3 }}>
              <span style={{ fontFamily: FONT.mono, fontSize: 15, letterSpacing: '0.1em', color: on ? COLOR.accentText : COLOR.fg3 }}>{pad(i + 1)}</span>
              {label}
            </div>
          </div>
        );
      })}
    </div>
  );
};

type CaptionWord = { w: string; from: number; to: number };
type Chunk = { words: CaptionWord[]; start: number; end: number };

/** Splits the voiceover into short caption lines at sentence and clause breaks. */
function buildChunks(): Chunk[] {
  const chunks: Chunk[] = [];
  for (const beat of BEATS) {
    let cur: CaptionWord[] = [];
    const flush = () => {
      if (cur.length) chunks.push({ words: cur, start: cur[0].from, end: cur[cur.length - 1].to });
      cur = [];
    };
    beat.words.forEach((w, i) => {
      cur.push({ w: w.w, from: beat.start + w.from, to: beat.start + w.to });
      const next = beat.words[i + 1];
      const length = cur.map((x) => x.w).join(' ').length;
      const sentenceEnd = /[.?!]$/.test(w.w);
      const clauseEnd = /[,;:]$/.test(w.w) && cur.length >= 3;
      const tooLong = next ? length + 1 + next.w.length > 46 : false;
      if (sentenceEnd || clauseEnd || tooLong || cur.length >= 9) flush();
    });
    flush();
  }
  return chunks;
}

/** Burned-in captions, one short line at a time, words lighting up as they're spoken. Absolute frames. */
export const Captions: React.FC = () => {
  const frame = useCurrentFrame();
  const chunks = useMemo(buildChunks, []);
  let index = -1;
  for (let i = 0; i < chunks.length; i++) if (chunks[i].start <= frame + 3) index = i;
  const chunk = chunks[index];
  const visible = chunk ? progress(frame, chunk.start - 3, 6) * (1 - progress(frame, chunk.end + 18, 8)) : 0;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <AbsoluteFill
        style={{
          background: 'linear-gradient(to top, rgba(6, 8, 13, 0.9) 0%, rgba(6, 8, 13, 0.6) 12%, rgba(6, 8, 13, 0) 28%)',
          opacity: Math.max(visible, 0.35),
        }}
      />
      {chunk && visible > 0 ? (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 64, display: 'flex', justifyContent: 'center' }}>
          <div
            style={{
              maxWidth: 1400,
              textAlign: 'center',
              fontFamily: FONT.body,
              fontWeight: 600,
              fontSize: 40,
              lineHeight: 1.3,
              letterSpacing: '-0.01em',
              color: COLOR.fg,
              textShadow: '0 2px 24px rgba(6, 8, 13, 0.9)',
              opacity: visible,
              transform: `translateY(${(1 - visible) * 8}px)`,
            }}
          >
            {chunk.words.map((w, i) => (
              <span key={i} style={{ opacity: 0.38 + 0.62 * progress(frame, w.from - 2, 4) }}>
                {w.w}
                {i < chunk.words.length - 1 ? ' ' : ''}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

/** Everything drawn above the scenes. Absolute frames. */
export const Overlays: React.FC<{ captions?: boolean }> = ({ captions = true }) => (
  <>
    <OfferRail />
    <Hud />
    {captions ? <Captions /> : null}
  </>
);
