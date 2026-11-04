import type { CSSProperties } from 'react';
import { loadFont as loadInstrumentSerif } from '@remotion/google-fonts/InstrumentSerif';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadJetBrainsMono } from '@remotion/google-fonts/JetBrainsMono';
import { loadFont as loadSpaceGrotesk } from '@remotion/google-fonts/SpaceGrotesk';

// The NixGen site's type system (site/src/styles/nx.css): Space Grotesk headings,
// Inter body, Instrument Serif italic for accent words, JetBrains Mono labels.
const heading = loadSpaceGrotesk('normal', { weights: ['400', '500', '600'], subsets: ['latin'] });
const body = loadInter('normal', { weights: ['400', '500', '600'], subsets: ['latin'] });
const serif = loadInstrumentSerif('italic', { weights: ['400'], subsets: ['latin'] });
const mono = loadJetBrainsMono('normal', { weights: ['400', '500'], subsets: ['latin'] });

export const FONT = {
  heading: `${heading.fontFamily}, sans-serif`,
  body: `${body.fontFamily}, sans-serif`,
  serif: `${serif.fontFamily}, serif`,
  mono: `${mono.fontFamily}, monospace`,
} as const;

/** The site's dark theme tokens (nx.css, :root[data-theme="dark"]). */
export const COLOR = {
  bg: '#06080d',
  bg2: '#0a0d14',
  surface: '#0d1119',
  surface2: '#131926',
  line: 'rgba(226, 232, 255, 0.08)',
  line2: 'rgba(226, 232, 255, 0.15)',
  fg: '#f3f5fa',
  fg2: '#b4bccd',
  fg3: '#7f899e',
  accent: '#2b66ff',
  accentFg: '#ffffff',
  accentText: '#7ea6ff',
  accent2: '#22d3ee',
  // Status colours. Only for status (done, overdue, at risk), never decoration.
  success: '#34d399',
  warn: '#fbbf24',
  danger: '#f87171',
} as const;

export const TYPE = {
  display: { fontFamily: FONT.heading, fontWeight: 500, fontSize: 148, lineHeight: 0.92, letterSpacing: '-0.048em' },
  h1: { fontFamily: FONT.heading, fontWeight: 500, fontSize: 104, lineHeight: 0.96, letterSpacing: '-0.042em' },
  h2: { fontFamily: FONT.heading, fontWeight: 500, fontSize: 76, lineHeight: 1.0, letterSpacing: '-0.036em' },
  h3: { fontFamily: FONT.heading, fontWeight: 500, fontSize: 46, lineHeight: 1.1, letterSpacing: '-0.024em' },
  h4: { fontFamily: FONT.heading, fontWeight: 500, fontSize: 32, lineHeight: 1.2, letterSpacing: '-0.014em' },
  lede: { fontFamily: FONT.body, fontWeight: 400, fontSize: 34, lineHeight: 1.45, letterSpacing: '-0.01em' },
  body: { fontFamily: FONT.body, fontWeight: 400, fontSize: 26, lineHeight: 1.5 },
  small: { fontFamily: FONT.body, fontWeight: 500, fontSize: 20, lineHeight: 1.4 },
  eyebrow: { fontFamily: FONT.mono, fontWeight: 500, fontSize: 18, letterSpacing: '0.14em', textTransform: 'uppercase' },
  mono: { fontFamily: FONT.mono, fontWeight: 400, fontSize: 20, letterSpacing: '0.02em' },
  numeral: { fontFamily: FONT.heading, fontWeight: 500, lineHeight: 0.9, letterSpacing: '-0.045em', fontVariantNumeric: 'tabular-nums' },
} satisfies Record<string, CSSProperties>;

/**
 * The frame is 1920x1080. The HUD owns y < 110, the offer rail (offer scenes only)
 * owns y 132-190, and captions own y > 900. Scene content stays inside the rest.
 */
export const LAYOUT = {
  width: 1920,
  height: 1080,
  padX: 140,
  top: 140,
  offerTop: 240,
  bottom: 880,
  railTop: 132,
} as const;

export const RADIUS = { sm: 10, md: 16, lg: 24, xl: 32, pill: 999 } as const;

export const SHADOW = {
  card: 'inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 40px 80px -24px rgba(0, 0, 0, 0.6)',
  float: 'inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 60px 120px -30px rgba(0, 0, 0, 0.75)',
  accent: '0 0 0 1px rgba(43, 102, 255, 0.55), 0 24px 80px -20px rgba(43, 102, 255, 0.45)',
} as const;
