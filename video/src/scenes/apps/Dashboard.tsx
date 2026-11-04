import React from 'react';
import { interpolateColors, useCurrentFrame } from 'remotion';
import { Icon, type IconName } from '../../components/Icon';
import { mix } from '../../lib/motion';
import { COLOR, FONT, SHADOW, TYPE } from '../../theme';
import { alpha } from './tint';

/**
 * A mock "live revenue dashboard" (sample data), drawn at its full size. The scene
 * scales it down into a grid cell and back up to fill the grid.
 *
 * The real Supernova capture (products/supernova-dashboard.png) is a sign-in screen,
 * so this mock stands in for it, the same way the NixGen site's portfolio draws a
 * coded mockup for products without a usable screenshot.
 */
export const DASH_W = 944;
export const DASH_H = 578;

const SIDEBAR = 72;
const PAD = 26;
const X0 = SIDEBAR + PAD;
const INNER = DASH_W - X0 - PAD;
const KPI_TOP = 86;
const KPI_H = 112;
const KPI_GAP = 16;
const KPI_W = (INNER - KPI_GAP * 2) / 3;
const MAIN_TOP = KPI_TOP + KPI_H + 18;
const MAIN_H = DASH_H - PAD - MAIN_TOP;
const SOURCE_W = 300;
const CHART_W = INNER - SOURCE_W - KPI_GAP;
const AXIS_W = 58;
const CHART_SVG_W = CHART_W - 44 - AXIS_W;
const CHART_SVG_H = 226;
/** Right edge of the weekly-revenue panel (dash px): its lower right is just area fill. */
export const DASH_CHART_RIGHT = X0 + CHART_W;

/** Same channels the "no visibility" leak asked about; round sample numbers. */
const SOURCES = [
  { name: 'Website', value: 26000 },
  { name: 'Google Ads', value: 18000 },
  { name: 'Facebook', value: 12000 },
  { name: 'Flyers', value: 8000 },
];
const SOURCE_MAX = 26000;
const SOURCE_TONE = [1, 0.72, 0.56, 0.42];

/** Weekly revenue in $k for the last 11 weeks; the current (12th) week fills in live. */
const WEEKS = [12.1, 12.6, 12.3, 13.2, 12.9, 13.8, 13.5, 14.3, 14.0, 14.9, 14.6];
const THIS_WEEK = { from: 13.9, to: 15.4 };
const Y_LO = 11.2;
const Y_HI = 15.8;
/** Gridlines with axis labels, in $k. */
const TICKS = [12, 13, 14, 15];

const money = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
const hundreds = (v: number) => Math.round(v / 100) * 100;

/** Catmull-Rom through the points, as cubic Béziers. */
function smoothPath(pts: [number, number][]): string {
  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${c1[0].toFixed(2)} ${c1[1].toFixed(2)}, ${c2[0].toFixed(2)} ${c2[1].toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d;
}

const panel: React.CSSProperties = {
  position: 'absolute',
  background: COLOR.surface,
  border: `1px solid ${COLOR.line2}`,
  borderRadius: 16,
};

const label: React.CSSProperties = { fontFamily: FONT.body, fontWeight: 500, fontSize: 20, lineHeight: 1.2, color: COLOR.fg3 };

const NAV: IconName[] = ['chart', 'users', 'calendar', 'file'];

export const Dashboard: React.FC<{
  /** 0..1: the current week's revenue ticks up (the "live" moment). */
  live: number;
  /** 0..1: attention moves to the revenue-by-source panel. */
  focus: number;
  /** 0..1 fill per source row. */
  bars: number[];
  /** 0..1 position of a soft highlight crossing the source panel. */
  sweep: number;
}> = ({ live, focus, bars, sweep }) => {
  const frame = useCurrentFrame();
  const pulse = (frame % 45) / 45;
  const rest = 1 - 0.5 * focus;

  const weeks = [...WEEKS, mix(THIS_WEEK.from, THIS_WEEK.to, live)];
  const step = CHART_SVG_W / (weeks.length - 1);
  const yOf = (v: number) => 10 + (1 - (v - Y_LO) / (Y_HI - Y_LO)) * (CHART_SVG_H - 20);
  const pts = weeks.map((v, i) => [i * step, yOf(v)] as [number, number]);
  const line = smoothPath(pts);
  const area = `${line} L ${CHART_SVG_W} ${CHART_SVG_H} L 0 ${CHART_SVG_H} Z`;
  const [ex, ey] = pts[pts.length - 1];

  const revenue = hundreds(mix(62800, 64000, live));
  const jobs = live > 0.55 ? 128 : 127;
  const thisWeek = hundreds(mix(THIS_WEEK.from, THIS_WEEK.to, live) * 1000);

  return (
    <div style={{ position: 'absolute', inset: 0, width: DASH_W, height: DASH_H, background: COLOR.bg2, overflow: 'hidden' }}>
      {/* Sidebar */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: SIDEBAR,
          background: COLOR.bg,
          borderRight: `1px solid ${COLOR.line}`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: 24,
          gap: 14,
          opacity: rest,
        }}
      >
        <div style={{ width: 40, height: 40, borderRadius: 12, background: COLOR.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
          <Icon name="trendingUp" size={22} color={COLOR.accentFg} stroke={2} />
        </div>
        {NAV.map((name, i) => (
          <div
            key={name}
            style={{
              width: 42,
              height: 42,
              borderRadius: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: i === 0 ? alpha(COLOR.accent, 0.14) : 'transparent',
              color: i === 0 ? COLOR.accentText : COLOR.fg3,
            }}
          >
            <Icon name={name} size={22} />
          </div>
        ))}
      </div>

      {/* Header */}
      <div style={{ position: 'absolute', left: X0, top: PAD, height: 40, display: 'flex', alignItems: 'center', gap: 16, opacity: rest }}>
        <span style={{ fontFamily: FONT.heading, fontWeight: 500, fontSize: 30, letterSpacing: '-0.02em', color: COLOR.fg }}>Revenue</span>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 9,
            padding: '5px 14px 5px 12px',
            borderRadius: 999,
            background: alpha(COLOR.success, 0.12),
            border: `1px solid ${alpha(COLOR.success, 0.4)}`,
            ...label,
            color: COLOR.success,
          }}
        >
          <span style={{ position: 'relative', width: 10, height: 10 }}>
            <span style={{ position: 'absolute', inset: 0, borderRadius: 5, background: COLOR.success }} />
            <span
              style={{
                position: 'absolute',
                inset: -6 * pulse,
                borderRadius: 99,
                border: `1.5px solid ${COLOR.success}`,
                opacity: 0.7 * (1 - pulse),
              }}
            />
          </span>
          Live
        </span>
      </div>

      {/* Mock figures are labelled as such (hard rule 1) */}
      <div
        style={{
          position: 'absolute',
          right: PAD,
          top: PAD,
          height: 40,
          display: 'flex',
          alignItems: 'center',
          ...TYPE.mono,
          fontSize: 20,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: COLOR.fg3,
        }}
      >
        Sample data
      </div>

      {/* KPI tiles */}
      {[
        { k: 'Revenue this month', v: money(revenue) },
        { k: 'Jobs booked', v: String(jobs) },
        { k: 'Average job', v: '$500' },
      ].map((t, i) => (
        <div
          key={t.k}
          style={{
            ...panel,
            left: X0 + i * (KPI_W + KPI_GAP),
            top: KPI_TOP,
            width: KPI_W,
            height: KPI_H,
            padding: '18px 22px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            opacity: rest,
          }}
        >
          <span style={label}>{t.k}</span>
          <span style={{ ...TYPE.numeral, fontSize: 44, lineHeight: 1, color: COLOR.fg }}>{t.v}</span>
        </div>
      ))}

      {/* Weekly revenue chart */}
      <div style={{ ...panel, left: X0, top: MAIN_TOP, width: CHART_W, height: MAIN_H, opacity: rest }}>
        <div style={{ position: 'absolute', left: 22, top: 20, ...label, color: COLOR.fg2 }}>Weekly revenue</div>
        <div style={{ position: 'absolute', right: 22, top: 14, display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span style={label}>This week</span>
          <span style={{ ...TYPE.numeral, fontSize: 32, lineHeight: 1, color: COLOR.fg }}>{money(thisWeek)}</span>
        </div>
        {TICKS.map((v) => (
          <div key={v} style={{ position: 'absolute', left: 22, top: 74 + yOf(v) - 12, ...label, lineHeight: '24px', fontVariantNumeric: 'tabular-nums' }}>
            ${v}k
          </div>
        ))}
        <svg
          width={CHART_SVG_W}
          height={CHART_SVG_H}
          viewBox={`0 0 ${CHART_SVG_W} ${CHART_SVG_H}`}
          style={{ position: 'absolute', left: 22 + AXIS_W, top: 74, overflow: 'visible' }}
        >
          {TICKS.map((v) => (
            <line key={v} x1={0} x2={CHART_SVG_W} y1={yOf(v)} y2={yOf(v)} stroke={COLOR.line} strokeWidth={1} />
          ))}
          <line x1={0} x2={CHART_SVG_W} y1={CHART_SVG_H} y2={CHART_SVG_H} stroke={COLOR.line2} strokeWidth={1} />
          <path d={area} fill={alpha(COLOR.accent, 0.16)} />
          <path d={line} fill="none" stroke={COLOR.accent} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={ex} cy={ey} r={7 + 14 * pulse} fill="none" stroke={COLOR.accentText} strokeWidth={1.5} opacity={0.6 * (1 - pulse)} />
          <circle cx={ex} cy={ey} r={6.5} fill={COLOR.bg2} stroke={COLOR.accentText} strokeWidth={3} />
        </svg>
      </div>

      {/* Revenue by source */}
      <div
        style={{
          ...panel,
          left: X0 + CHART_W + KPI_GAP,
          top: MAIN_TOP,
          width: SOURCE_W,
          height: MAIN_H,
          overflow: 'hidden',
          borderColor: interpolateColors(focus, [0, 1], [COLOR.line2, alpha(COLOR.accent, 0.7)]),
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 22,
            top: 20,
            ...label,
            color: interpolateColors(focus, [0, 1], [COLOR.fg2, COLOR.fg]),
          }}
        >
          Revenue by source
        </div>
        {SOURCES.map((s, i) => {
          const b = bars[i] ?? 0;
          return (
            <div key={s.name} style={{ position: 'absolute', left: 22, right: 22, top: 70 + i * 62 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ ...label, color: COLOR.fg2 }}>{s.name}</span>
                <span style={{ ...label, color: COLOR.fg, fontVariantNumeric: 'tabular-nums', opacity: Math.min(1, b * 3) }}>
                  {money(hundreds(s.value * b))}
                </span>
              </div>
              <div style={{ marginTop: 12, height: 8, borderRadius: 4, background: alpha(COLOR.fg, 0.06) }}>
                <div
                  style={{
                    width: `${(s.value / SOURCE_MAX) * b * 100}%`,
                    height: '100%',
                    borderRadius: 4,
                    background: COLOR.accent,
                    opacity: SOURCE_TONE[i],
                  }}
                />
              </div>
            </div>
          );
        })}
        {/* Soft highlight crossing the panel once */}
        {sweep > 0 && sweep < 1 ? (
          <div
            style={{
              position: 'absolute',
              top: -80,
              left: mix(-160, SOURCE_W + 60, sweep),
              width: 110,
              height: MAIN_H + 160,
              transform: 'rotate(16deg)',
              background: `linear-gradient(90deg, ${alpha(COLOR.fg, 0)}, ${alpha(COLOR.fg, 0.07)}, ${alpha(COLOR.fg, 0)})`,
            }}
          />
        ) : null}
      </div>
      {/* Accent ring around the source panel while it has the focus */}
      <div
        style={{
          position: 'absolute',
          left: X0 + CHART_W + KPI_GAP,
          top: MAIN_TOP,
          width: SOURCE_W,
          height: MAIN_H,
          borderRadius: 16,
          boxShadow: SHADOW.accent,
          opacity: focus,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
};
