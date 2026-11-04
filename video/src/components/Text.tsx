import React from 'react';
import { useCurrentFrame } from 'remotion';
import { EASE, progress, springAt } from '../lib/motion';
import { COLOR, FONT, TYPE } from '../theme';

type HeadingSize = 'display' | 'h1' | 'h2' | 'h3' | 'h4';

/** "Websites that *win the job.*" → words, with the starred ones marked as accent. */
function parse(text: string): { word: string; accent: boolean }[] {
  const words: { word: string; accent: boolean }[] = [];
  for (const part of text.split(/(\*[^*]+\*)/)) {
    if (!part) continue;
    const accent = part.length > 2 && part.startsWith('*') && part.endsWith('*');
    const clean = accent ? part.slice(1, -1) : part;
    for (const word of clean.split(/\s+/)) if (word) words.push({ word, accent });
  }
  return words;
}

/**
 * Heading whose words rise out of a mask one after another. Wrap accent words in
 * asterisks to set them in Instrument Serif italic: "One team, *one system.*"
 */
export const Headline: React.FC<{
  text: string;
  /** Scene-local frame the first word starts rising. */
  at?: number;
  size?: HeadingSize;
  /** Frames between words. */
  stagger?: number;
  color?: string;
  accentColor?: string;
  align?: 'left' | 'center' | 'right';
  maxWidth?: number;
  style?: React.CSSProperties;
}> = ({ text, at = 0, size = 'h1', stagger = 2.5, color = COLOR.fg, accentColor = COLOR.accentText, align = 'left', maxWidth, style }) => {
  const frame = useCurrentFrame();
  const words = parse(text);
  return (
    <div style={{ ...TYPE[size], color, textAlign: align, maxWidth, ...style }}>
      {words.map(({ word, accent }, i) => {
        const p = springAt(frame, at + i * stagger, { stiffness: 140 });
        return (
          <React.Fragment key={i}>
            <span
              style={{
                display: 'inline-block',
                overflow: 'hidden',
                verticalAlign: 'top',
                // Room for ascenders, descenders and italic overhang inside the mask,
                // cancelled by the negative margins so layout is unchanged.
                padding: `0.14em ${accent ? '0.12em' : '0.02em'} 0.2em 0`,
                margin: `-0.14em ${accent ? '-0.12em' : '-0.02em'} -0.2em 0`,
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  transform: `translateY(${(1 - p) * 115}%)`,
                  opacity: Math.min(1, p * 1.5),
                  ...(accent
                    ? { fontFamily: FONT.serif, fontStyle: 'italic', fontWeight: 400, letterSpacing: '-0.01em', fontSize: '1.06em', color: accentColor }
                    : null),
                }}
              >
                {word}
              </span>
            </span>
            {i < words.length - 1 ? ' ' : null}
          </React.Fragment>
        );
      })}
    </div>
  );
};

/** Fades and slides its children in at `at`. The default entrance for anything that isn't a headline. */
export const Reveal: React.FC<{
  at?: number;
  dur?: number;
  y?: number;
  x?: number;
  blur?: number;
  /** Starting scale, e.g. 0.96. */
  scale?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ at = 0, dur = 20, y = 24, x = 0, blur = 6, scale = 1, children, style }) => {
  const frame = useCurrentFrame();
  const p = progress(frame, at, dur, EASE.out);
  return (
    <div
      style={{
        opacity: p,
        transform: `translate(${(1 - p) * x}px, ${(1 - p) * y}px) scale(${scale + (1 - scale) * p})`,
        filter: blur && p < 1 ? `blur(${(1 - p) * blur}px)` : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** Mono, uppercase section label, like the site's .nx-eyebrow: "01 —— WEBSITES". */
export const Eyebrow: React.FC<{
  children: React.ReactNode;
  /** Accent-coloured index shown before a short rule, e.g. "01". */
  index?: string;
  at?: number;
  style?: React.CSSProperties;
}> = ({ children, index, at = 0, style }) => {
  const frame = useCurrentFrame();
  const p = progress(frame, at, 16);
  const rule = progress(frame, at + 4, 22);
  return (
    <div
      style={{
        ...TYPE.eyebrow,
        color: COLOR.fg3,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        opacity: p,
        transform: `translateY(${(1 - p) * 10}px)`,
        ...style,
      }}
    >
      {index ? <span style={{ color: COLOR.accentText }}>{index}</span> : null}
      {index ? <span style={{ display: 'block', width: 32 * rule, height: 1, background: 'currentColor', opacity: 0.5 }} /> : null}
      <span>{children}</span>
    </div>
  );
};

/** Supporting paragraph in the secondary text colour. */
export const Lede: React.FC<{ children: React.ReactNode; at?: number; maxWidth?: number; style?: React.CSSProperties }> = ({
  children,
  at = 0,
  maxWidth = 760,
  style,
}) => (
  <Reveal at={at} y={16} style={style}>
    <div style={{ ...TYPE.lede, color: COLOR.fg2, maxWidth }}>{children}</div>
  </Reveal>
);
