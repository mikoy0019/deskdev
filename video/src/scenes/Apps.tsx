import React from 'react';
import { AbsoluteFill, Easing, Img, staticFile, useCurrentFrame } from 'remotion';
import { Icon, type IconName } from '../components/Icon';
import { BrowserFrame } from '../components/Surfaces';
import { Eyebrow, Headline } from '../components/Text';
import { EASE, mix, progress, springAt } from '../lib/motion';
import { useCue, useScene } from '../lib/scene';
import { COLOR, FONT, LAYOUT, RADIUS, SHADOW, TYPE } from '../theme';
import { DASH_CHART_RIGHT, DASH_H, DASH_W, Dashboard } from './apps/Dashboard';
import { alpha } from './apps/tint';

// 03 Apps & dashboards. Left: the four kinds of app, as a legend that lights up as each
// is named. Right: a 2x2 grid of real app windows; each steps forward on its word, and
// on "live dashboard" the revenue dashboard zooms to fill the grid and shows where the
// revenue comes from.

// ---------------------------------------------------------------- layout (px)
const COL = { x: LAYOUT.padX, y: 258, w: 600 };
const WIN = { w: 460, h: 300 };
const CELLS = [
  { x: 820, y: 250 },
  { x: 1304, y: 250 },
  { x: 820, y: 574 },
  { x: 1304, y: 574 },
];
/** The whole grid area, which the dashboard grows to fill. */
const GRID = { x: 820, y: 250, w: 944, h: 624 };
const CHROME = 47; // BrowserFrame toolbar (46) + its hairline
/** Inside the 1px frame border. */
const innerW = (w: number) => w - 2;
const innerH = (h: number) => h - CHROME - 1;

type Item = { icon: IconName; title: string; sub: string; url: string };
const ITEMS: Item[] = [
  { icon: 'calendar', title: 'Online booking', sub: 'Customers book themselves', url: 'coloradoriverexpeditions.com' },
  { icon: 'users', title: 'Customer portals', sub: 'Clients & investors log in', url: 'upscalerails.com' },
  { icon: 'file', title: 'Invoicing', sub: 'Chases late payments', url: 'Invoice Chase' },
  { icon: 'chart', title: 'Live dashboard', sub: 'Revenue by source', url: 'Supernova · Revenue' },
];

// ---------------------------------------------------------------- window contents

/** A full-page client capture (1280x2400) at window width, scrolled `y` px (screen px). */
const Capture: React.FC<{ src: string; w: number; y: number }> = ({ src, w, y }) => (
  <Img
    src={staticFile(src)}
    style={{ position: 'absolute', left: 0, top: 0, width: w, height: (w * 2400) / 1280, transform: `translateY(${-y}px)` }}
  />
);

/**
 * Invoice Chase (1600x1000), cropped to its invoice overview: paid, overdue, due soon.
 * Crop is in capture px. Even at full drift the window's lower edge stays above the
 * card's footer (hairline at y 474), so no capture text is ever cut by the window edge.
 */
const INVOICE_CROP = { x: 690, y: 76, w: 700 };
const INVOICE_DRIFT = 6;
/** The card's "Due Soon" row (capture px). The reminder toast covers it whole. */
const DUE_SOON = { y: 388, h: 65 };
const InvoiceShot: React.FC<{ w: number; h: number; drift: number }> = ({ w, h, drift }) => {
  const k = w / INVOICE_CROP.w;
  const top = INVOICE_CROP.y + drift;
  return (
    <div style={{ position: 'absolute', inset: 0, width: w, height: h, overflow: 'hidden', background: '#f2fbf7' }}>
      <Img
        src={staticFile('products/invoice-chase.png')}
        style={{ position: 'absolute', left: -INVOICE_CROP.x * k, top: -top * k, width: 1600 * k, height: 1000 * k }}
      />
    </div>
  );
};

/** Solid little label that sits on top of a capture (never text straight over the image). */
const Tag: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div
    style={{
      position: 'absolute',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      height: 34,
      padding: '0 12px',
      borderRadius: RADIUS.sm,
      background: alpha(COLOR.bg, 0.86),
      border: `1px solid ${COLOR.line2}`,
      ...TYPE.mono,
      fontSize: 20,
      lineHeight: 1,
      color: COLOR.fg2,
      ...style,
    }}
  >
    {children}
  </div>
);

/**
 * "Reminder sent" toast that lands in the invoicing window on "chases". It is seated
 * over the whole "Due Soon" row (`top`/`height` in window px, a few px of margin on
 * every side), so no capture text ever peeks out around it.
 */
const ReminderToast: React.FC<{ p: number; top: number; height: number }> = ({ p, top, height }) => (
  <div
    style={{
      position: 'absolute',
      left: 140,
      right: 12,
      top,
      height,
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '0 14px 0 11px',
      borderRadius: RADIUS.md - 4,
      background: COLOR.surface2,
      border: `1px solid ${COLOR.line2}`,
      boxShadow: SHADOW.card,
      opacity: Math.min(1, p * 4),
      transform: `translateY(${(1 - p) * 8}px) scale(${mix(0.97, 1, p)})`,
    }}
  >
    <div
      style={{
        width: 30,
        height: 30,
        borderRadius: 9,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: alpha(COLOR.accent, 0.16),
        color: COLOR.accentText,
      }}
    >
      <Icon name="send" size={17} />
    </div>
    <span style={{ fontFamily: FONT.body, fontWeight: 500, fontSize: 20, lineHeight: 1.1, color: COLOR.fg, whiteSpace: 'nowrap' }}>
      Payment reminder sent
    </span>
  </div>
);

// ---------------------------------------------------------------- legend (left column)

const LegendRow: React.FC<{ item: Item; index: number; enter: number; on: number; active: number }> = ({ item, index, enter, on, active }) => {
  const tone = (a: number) => alpha(COLOR.accent, a * active);
  return (
    <div
      style={{
        position: 'relative',
        height: 86,
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        paddingLeft: 26,
        opacity: enter * mix(0.38, 1, on) * (1 - 0.32 * (on - active)),
        transform: `translateX(${(1 - enter) * -18}px)`,
      }}
    >
      {/* Accent bar that draws down while the row is the one being spoken */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 14,
          width: 3,
          height: 58 * active,
          borderRadius: 2,
          background: COLOR.accent,
        }}
      />
      <span style={{ ...TYPE.mono, fontSize: 20, width: 30, color: on > 0.5 ? COLOR.accentText : COLOR.fg3 }}>{String(index + 1).padStart(2, '0')}</span>
      <div
        style={{
          width: 52,
          height: 52,
          flexShrink: 0,
          borderRadius: 15,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: active > 0.01 ? tone(0.16) : alpha(COLOR.fg, 0.04),
          border: `1px solid ${active > 0.01 ? alpha(COLOR.accent, mix(0.15, 0.55, active)) : COLOR.line2}`,
          color: active > 0.5 ? COLOR.accentText : COLOR.fg2,
        }}
      >
        <Icon name={item.icon} size={26} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ ...TYPE.h4, fontSize: 32, color: COLOR.fg, whiteSpace: 'nowrap' }}>{item.title}</div>
        <div style={{ fontFamily: FONT.body, fontWeight: 400, fontSize: 21, lineHeight: 1.3, color: COLOR.fg3, marginTop: 4, whiteSpace: 'nowrap' }}>
          {item.sub}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- scene

const Apps: React.FC = () => {
  const frame = useCurrentFrame();
  const { cue } = useCue();
  const scene = useScene();

  const head = cue('custom apps', { offset: -6 });
  const cues = [
    cue('Online booking', { offset: -4 }),
    cue('customer portals', { offset: -4 }),
    cue('invoicing', { offset: -4 }),
    cue('live dashboard', { offset: -6 }),
  ];
  const chase = cue('chases', { offset: -2 });
  const exactly = cue('exactly', { offset: -4 });
  const revenue = cue('revenue comes from', { offset: -4 });

  // How far each item has been switched on, and whether it's still the one being spoken.
  const on = cues.map((c) => progress(frame, c, 16));
  const active = on.map((p, i) => p * (1 - (i < 3 ? progress(frame, cues[i + 1], 16) : 0)));

  // The dashboard's zoom into the whole grid. It starts on the word with a soft ease-in,
  // and the other windows fade out over the same frames, so the dashboard grows into
  // the space as they leave (it sits above them, so they are never seen half-covered).
  const zoom = progress(frame, cues[3], 32, Easing.bezier(0.45, 0, 0.25, 1));
  const clear = progress(frame, cues[3] + 2, 22, EASE.inOut);
  // The dashboard's index badge leaves before the zoom gets going.
  const badgeOut = progress(frame, cues[3] - 2, 10);
  // Slow drift of the grid so no frame is frozen (and a slower one for the legend).
  const drift = mix(6, -10, frame / scene.frames);

  // Invoice crop drift (capture px) and where the "Due Soon" row sits in the window.
  const invDrift = mix(0, INVOICE_DRIFT, frame / scene.frames);
  const invK = innerW(WIN.w) / INVOICE_CROP.w;
  const dueTop = (DUE_SOON.y - INVOICE_CROP.y - invDrift) * invK;
  const dueH = DUE_SOON.h * invK;

  // The dashboard's live moment.
  const live = progress(frame, cues[3] + 20, 70, EASE.inOut);
  const bars = [0, 1, 2, 3].map((i) => progress(frame, exactly + i * 5, 30));
  const focus = progress(frame, revenue, 20);
  const sweep = progress(frame, revenue + 6, 40, EASE.inOut);

  return (
    <AbsoluteFill>
      {/* Left column: eyebrow, headline, legend */}
      <div style={{ position: 'absolute', left: COL.x, top: COL.y, width: COL.w, transform: `translateY(${drift * 0.4}px)` }}>
        <Eyebrow index="03" at={2}>
          Apps &amp; dashboards
        </Eyebrow>
        <Headline text="Custom apps & *dashboards.*" size="h2" at={head} maxWidth={COL.w} style={{ marginTop: 30 }} />
        <div style={{ marginTop: 52 }}>
          {ITEMS.map((item, i) => (
            <LegendRow key={item.title} item={item} index={i} enter={progress(frame, head + 18 + i * 4, 20)} on={on[i]} active={active[i]} />
          ))}
        </div>
      </div>

      {/* Right: the 2x2 grid of app windows */}
      <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', transform: `translateY(${drift}px)` }}>
        {ITEMS.map((item, i) => {
          const isDash = i === 3;
          const enter = springAt(frame, head + 4 + i * 4, { stiffness: 90 });
          const a = active[i];
          const seen = on[i];
          // Every window except the dashboard recedes while the dashboard takes over.
          const away = isDash ? 0 : clear;
          const cell = CELLS[i];
          const x = isDash ? mix(cell.x, GRID.x, zoom) : cell.x;
          const y = isDash ? mix(cell.y, GRID.y, zoom) : cell.y;
          const w = isDash ? mix(WIN.w, GRID.w, zoom) : WIN.w;
          const h = isDash ? mix(WIN.h, GRID.h, zoom) : WIN.h;
          // Step forward by 1.2% only, so the gutter to the neighbour stays >= 18 px.
          const scale = mix(0.94, 1, enter) * mix(0.97, 1, seen) * (1 + 0.012 * a * (isDash ? 1 - zoom : 1)) * mix(1, 0.94, away);
          const opacity = Math.min(1, enter * 1.3) * mix(0.55, 1, seen) * mix(1, 0.88, isDash ? 0 : on[i + 1] ?? 0) * (1 - away);
          // Grow toward the grid centre so a scaled window never leaves the safe area.
          const origin = `${i % 2 === 0 ? '0%' : '100%'} ${i < 2 ? '0%' : '100%'}`;
          const iw = innerW(w);
          const ih = innerH(h);
          const dashK = iw / DASH_W;
          const ring = isDash ? a * (1 - zoom) : a;
          if (opacity <= 0.001) return null;
          return (
            <div
              key={item.title}
              style={{
                position: 'absolute',
                left: x,
                top: y,
                width: w,
                height: h,
                zIndex: isDash ? 2 : 1,
                opacity,
                transform: `translateY(${(1 - enter) * 30}px) scale(${scale})`,
                transformOrigin: origin,
              }}
            >
              <BrowserFrame url={item.url} width={w} height={h} style={isDash ? { background: COLOR.bg2 } : undefined}>
                {i === 0 ? <Capture src="clients/colorado-river-expeditions.jpg" w={iw} y={mix(15, 23, frame / scene.frames)} /> : null}
                {i === 1 ? <Capture src="clients/upscale-rails.jpg" w={iw} y={mix(0, 8, frame / scene.frames)} /> : null}
                {i === 2 ? (
                  <>
                    <InvoiceShot w={iw} h={ih} drift={invDrift} />
                    <ReminderToast p={springAt(frame, chase, { damping: 16, stiffness: 150 })} top={dueTop - 5} height={dueH + 10} />
                    <Tag style={{ left: 12, top: 12, padding: '0 10px', fontFamily: FONT.body, fontWeight: 500, letterSpacing: 0 }}>Sample data</Tag>
                  </>
                ) : null}
                {isDash ? (
                  <div style={{ position: 'absolute', left: 0, top: 0, width: DASH_W, height: DASH_H, transform: `scale(${dashK})`, transformOrigin: '0 0' }}>
                    <Dashboard live={live} focus={focus} bars={bars} sweep={sweep} />
                  </div>
                ) : null}
                {/* Index badge, matching the legend. On the dashboard it sits bottom-right of
                    the weekly chart, over the plain area fill (clear of the axis labels). */}
                <Tag
                  style={{
                    ...(isDash ? { right: iw - (DASH_CHART_RIGHT - 16) * dashK } : { left: 12 }),
                    bottom: 12,
                    opacity: isDash ? 1 - badgeOut : 1,
                    color: seen > 0.5 ? COLOR.accentText : COLOR.fg3,
                    borderColor: a > 0.5 ? alpha(COLOR.accent, 0.6) : COLOR.line2,
                  }}
                >
                  <Icon name={item.icon} size={18} />
                  {String(i + 1).padStart(2, '0')}
                </Tag>
              </BrowserFrame>
              {/* Accent ring while this window is the one being spoken */}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: 18,
                  boxShadow: SHADOW.accent,
                  opacity: ring,
                  pointerEvents: 'none',
                }}
              />
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export default Apps;
