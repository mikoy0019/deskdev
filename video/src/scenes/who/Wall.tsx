import React from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from 'remotion';
import { COLOR, RADIUS } from '../../theme';

/** A theme token with an alpha, so every colour still comes from COLOR. */
export const alpha = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/** Blend two theme tokens channel by channel (t 0 = a, 1 = b): a colour crossfade with no step. */
export const mixHex = (a: string, b: string, t: number) => {
  const p = parseInt(a.slice(1), 16);
  const q = parseInt(b.slice(1), 16);
  const k = Math.min(1, Math.max(0, t));
  const ch = (s: number) => Math.round(((p >> s) & 255) * (1 - k) + ((q >> s) & 255) * k);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
};

// Real work only, and every tile a different crop, so no two visible tiles look the same.
// Client sites are 1280x2400 full-page captures: `y` is where the crop starts (capture px).
// Products are 1600x1000 shown at 1.5x: `side` picks the headline (left) or the UI card (right).
// Left out on purpose: pos-app, supernova and delivery-app (login screens), lumina-comfort
// (the whole capture sits under a dimmed pop-up overlay), and hike-wales and tank-it-easy,
// whose heroes and section titles name places (SCENES.md hard rule 2). Colorado River
// Expeditions is cropped below its hero headline for the same reason.
type Work =
  | { src: string; kind: 'site'; y: number; light?: boolean }
  | { src: string; kind: 'product'; side: 'left' | 'right' };

const W = {
  shiraHero: { src: 'clients/shira-salon.jpg', kind: 'site', y: 0, light: true },
  shiraWhy: { src: 'clients/shira-salon.jpg', kind: 'site', y: 960, light: true },
  shiraShop: { src: 'clients/shira-salon.jpg', kind: 'site', y: 1480, light: true },
  railsHero: { src: 'clients/upscale-rails.jpg', kind: 'site', y: 0 },
  railsAbout: { src: 'clients/upscale-rails.jpg', kind: 'site', y: 860, light: true },
  railsDark: { src: 'clients/upscale-rails.jpg', kind: 'site', y: 1490 },
  itHero: { src: 'clients/topcore-it.jpg', kind: 'site', y: 198 },
  itServices: { src: 'clients/topcore-it.jpg', kind: 'site', y: 1200, light: true },
  raftTrips: { src: 'clients/colorado-river-expeditions.jpg', kind: 'site', y: 1040 },
  raftPhoto: { src: 'clients/colorado-river-expeditions.jpg', kind: 'site', y: 1600 },
  inboxHead: { src: 'products/inbox-ai.png', kind: 'product', side: 'left' },
  inboxUi: { src: 'products/inbox-ai.png', kind: 'product', side: 'right' },
  stockHead: { src: 'products/stock-sense.png', kind: 'product', side: 'left' },
  stockUi: { src: 'products/stock-sense.png', kind: 'product', side: 'right' },
  chaseHead: { src: 'products/invoice-chase.png', kind: 'product', side: 'left' },
  chaseUi: { src: 'products/invoice-chase.png', kind: 'product', side: 'right' },
} satisfies Record<string, Work>;

// Column by column, top to bottom. With this tilt and drift the frame only ever shows
// columns 1-4, rows 0-4, plus a sliver of column 5 (rows 1-2); column 0 and row 5 stay
// off-screen. Every slot the scrim leaves readable (the outer columns and the top and
// bottom rows of the centre ones) holds a different crop, the light product pages sit in
// the outer columns, and the few repeats hide in the centre, under the darkest scrim.
const LAYOUT: Work[][] = [
  [W.railsHero, W.itHero, W.shiraWhy, W.raftTrips, W.inboxUi, W.chaseHead],
  [W.raftPhoto, W.chaseUi, W.inboxHead, W.stockUi, W.shiraHero, W.railsDark],
  [W.itServices, W.shiraHero, W.raftTrips, W.railsHero, W.shiraWhy, W.inboxUi],
  [W.itHero, W.railsAbout, W.shiraShop, W.raftPhoto, W.railsDark, W.stockHead],
  [W.shiraShop, W.chaseHead, W.inboxUi, W.railsAbout, W.stockHead, W.itServices],
  [W.inboxHead, W.raftTrips, W.railsHero, W.chaseUi, W.shiraWhy, W.stockUi],
];

const TILE_W = 440;
const TILE_H = 275; // 16:10
const GAP = 30;
const COLS = LAYOUT.length;
const ROWS = 5;
const GRID_W = COLS * TILE_W + (COLS - 1) * GAP;
const GRID_H = ROWS * TILE_H + (ROWS - 1) * GAP;
const SITE_SCALE = TILE_W / 1280;

const Tile: React.FC<{ work: Work }> = ({ work }) => {
  const light = work.kind === 'product' || work.light;
  return (
    <div
      style={{
        position: 'relative',
        width: TILE_W,
        height: TILE_H,
        flexShrink: 0,
        borderRadius: RADIUS.md,
        overflow: 'hidden',
        border: `1px solid ${COLOR.line2}`,
        background: COLOR.surface,
      }}
    >
      {work.kind === 'site' ? (
        <Img
          src={staticFile(work.src)}
          style={{ position: 'absolute', left: 0, top: -work.y * SITE_SCALE, width: TILE_W, height: 2400 * SITE_SCALE }}
        />
      ) : (
        <Img
          src={staticFile(work.src)}
          style={{
            position: 'absolute',
            left: work.side === 'left' ? 0 : -TILE_W * 0.5,
            top: 0,
            width: TILE_W * 1.5,
            height: (TILE_W * 1.5 * 1000) / 1600,
          }}
        />
      )}
      {/* White pages would outshine the photo tiles: tone them down to the same level. */}
      {light ? <div style={{ position: 'absolute', inset: 0, background: alpha(COLOR.bg, 0.3) }} /> : null}
    </div>
  );
};

/**
 * The "wall of work": a tilted grid of real client sites and product shots, drifting
 * slowly (alternate columns in opposite directions), under a dark scrim so the type on
 * top stays crisp. `visibility` 0..1 drives how much of it shows through.
 */
export const Wall: React.FC<{ visibility: number; total: number }> = ({ visibility, total }) => {
  const frame = useCurrentFrame();
  const t = frame / Math.max(1, total);
  // Whole-grid slow pan plus per-column counter-drift: always moving, never busy.
  const panX = -30 * t;
  const panY = -24 * t;
  // The outer scrim opens up with visibility (the edges show the work as "200" lands);
  // the centre band behind the type stays near-flat at every level.
  const v = Math.min(1, Math.max(0, visibility));
  const edge = 0.62 - 0.17 * v;
  const bandTop = 0.85 - 0.15 * v;
  const bandBottom = 0.9 - 0.2 * v;
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <AbsoluteFill style={{ perspective: 2200, opacity: 0.15 + 0.2 * visibility }}>
        <div
          style={{
            position: 'absolute',
            left: 960 - GRID_W / 2,
            top: 540 - GRID_H / 2,
            width: GRID_W,
            height: GRID_H,
            display: 'flex',
            gap: GAP,
            transform: `translate(${panX}px, ${panY}px) rotateX(26deg) rotateZ(-9deg) scale(${1.08 + 0.03 * t})`,
            filter: 'saturate(0.55)',
          }}
        >
          {LAYOUT.map((column, c) => {
            const dir = c % 2 === 0 ? -1 : 1;
            const drift = dir * 46 * t + (c % 3) * -60;
            return (
              <div key={c} style={{ display: 'flex', flexDirection: 'column', gap: GAP, transform: `translateY(${drift}px)` }}>
                {column.map((work, r) => (
                  <Tile key={r} work={work} />
                ))}
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
      {/* Scrim: near-flat background across the type band (x 360-1560, y 160-820); the wall breathes at the edges. */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 62% 58% at 50% 50%, ${alpha(COLOR.bg, 0.96)} 0%, ${alpha(COLOR.bg, 0.88)} 55%, ${alpha(
            COLOR.bg,
            edge,
          )} 100%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 45% 40% at 50% 50%, ${alpha(COLOR.bg, 0.8)} 0%, ${alpha(COLOR.bg, 0.8)} 55%, ${alpha(
            COLOR.bg,
            0,
          )} 100%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, ${alpha(COLOR.bg, bandTop)} 0%, ${alpha(COLOR.bg, 0)} 22%, ${alpha(COLOR.bg, 0)} 72%, ${alpha(
            COLOR.bg,
            bandBottom,
          )} 100%)`,
        }}
      />
    </AbsoluteFill>
  );
};
