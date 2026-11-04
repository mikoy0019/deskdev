import type { CSSProperties, ReactNode } from 'react';
import { LoopRegion } from './LoopRegion';
import styles from './portfolio.module.css';
import { calm } from './types';

/* ═══════════════════════════════════════════════════════════════
   APP MOCKUP — stylized in-browser UI for in-house products whose
   screenshot isn't hosted locally. Pure CSS/divs tinted by the product
   accent and drawn with theme tokens, so it reads in dark and light.
   Every size is in em and the root scales its font-size with its own
   width (container query units) — crisp from a card to a full feature.
   Each live product carries one quiet loop that shows what it does (a
   driver on the route, a KPI updating, activity streaming in): CSS
   transform/opacity only, paused off-screen, still under reduced motion
   (portfolio.module.css).
   ═══════════════════════════════════════════════════════════════ */

export type MockupVariant = 'dashboard' | 'crm' | 'email' | 'invoicing' | 'inventory' | 'ops' | 'pos' | 'delivery';

/** px at the reference size (1em = 6px) → em */
const u = (px: number) => `${px / 6}em`;

const ink = (pct: number) => `color-mix(in oklab, var(--fg) ${pct}%, transparent)`;
const tint = (accent: string, pct: number) => `color-mix(in oklab, ${accent} ${pct}%, transparent)`;

const surface = ink(7);
const surface2 = ink(13);
const panel: CSSProperties = { background: ink(3.5), border: `1px solid ${ink(6)}` };
const danger = '#f87171';

/** A loop's classes: `loop` carries the off-screen pause and the reduced-motion stop. */
const loop = (name: 'driver' | 'liveBar' | 'stream' | 'sync' | 'ticketLine') => `${styles.loop} ${styles[name]}`;

function Bar({ w, h = 6, c = surface, r = 3 }: { w: number | string; h?: number; c?: string; r?: number }) {
  return <div style={{ width: typeof w === 'number' ? u(w) : w, height: u(h), borderRadius: u(r), background: c, flexShrink: 0 }} />;
}

function Tile({ accent, children }: { accent: string; children?: ReactNode }) {
  return (
    <div style={{ ...panel, flex: 1, borderRadius: u(6), padding: u(8), display: 'flex', flexDirection: 'column', gap: u(6) }}>
      <Bar w="40%" h={4} c={accent} />
      {children ?? <Bar w="70%" h={9} c={surface2} />}
    </div>
  );
}

const col = (gap = 5): CSSProperties => ({ display: 'flex', flexDirection: 'column', gap: u(gap), flex: 1, minHeight: 0 });
const row = (gap = 7): CSSProperties => ({ display: 'flex', alignItems: 'center', gap: u(gap) });

function body(variant: MockupVariant, accent: string) {
  switch (variant) {
    case 'dashboard':
      return (
        <>
          <div style={{ display: 'flex', gap: u(6) }}>
            <Tile accent={accent} />
            <Tile accent={accent} />
            <Tile accent={accent} />
          </div>
          <div style={{ display: 'flex', gap: u(6), flex: 1, minHeight: 0 }}>
            {/* revenue chart: gridlines behind paired bars */}
            <div style={{ ...panel, flex: 2.2, borderRadius: u(6), padding: u(8), display: 'flex', flexDirection: 'column', gap: u(6) }}>
              <div style={{ ...row(6), justifyContent: 'space-between' }}>
                <Bar w="28%" h={4} c={surface2} />
                <div style={row(4)}>
                  <Bar w={14} h={4} c={accent} />
                  <Bar w={14} h={4} c={surface2} />
                </div>
              </div>
              <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} style={{ height: 1, background: ink(7) }} />
                  ))}
                </div>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', gap: u(5), padding: `0 ${u(3)}` }}>
                  {[40, 55, 48, 66, 58, 74, 62, 86, 70, 92].map((h, i) => (
                    <div key={i} style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', gap: u(1.5) }}>
                      {/* the current period (last bar) keeps updating */}
                      <div
                        className={i === 9 ? loop('liveBar') : undefined}
                        style={{ flex: 1, height: `${h}%`, borderRadius: `${u(2)} ${u(2)} 0 0`, background: accent, opacity: 0.85 }}
                      />
                      <div style={{ flex: 1, height: `${h * 0.7}%`, borderRadius: `${u(2)} ${u(2)} 0 0`, background: surface2 }} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {/* channel breakdown */}
            <div style={{ ...panel, flex: 1, borderRadius: u(6), padding: u(8), display: 'flex', flexDirection: 'column', gap: u(7) }}>
              <Bar w="50%" h={4} c={surface2} />
              {[78, 56, 41, 27, 18].map((pct, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: u(3) }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Bar w={`${46 - i * 4}%`} h={3} c={surface2} />
                    <Bar w="16%" h={3} c={surface} />
                  </div>
                  <div style={{ height: u(4), borderRadius: 99, background: surface }}>
                    <div style={{ width: `${pct}%`, height: '100%', borderRadius: 99, background: i === 0 ? accent : tint(accent, 45) }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      );
    case 'crm':
      // Contact list beside the pipeline. Its own composition, so it never
      // reads as a recolour of the ops board.
      return (
        <div style={{ display: 'flex', gap: u(6), flex: 1, minHeight: 0 }}>
          <div style={{ ...panel, flex: 1.7, minWidth: 0, borderRadius: u(6), padding: u(8), display: 'flex', flexDirection: 'column', gap: u(5) }}>
            <div style={{ ...row(6), justifyContent: 'space-between' }}>
              <Bar w="30%" h={4} c={surface2} />
              <div style={{ display: 'flex' }}>
                {[0, 1, 2, 3].map((i) => (
                  // the first contact breathes: synced live across devices
                  <div
                    key={i}
                    className={i === 0 ? loop('sync') : undefined}
                    style={{ width: u(8), height: u(8), borderRadius: 99, marginLeft: i ? u(-2.5) : 0, background: i === 0 ? tint(accent, 60) : surface2, boxShadow: '0 0 0 1px var(--surface)' }}
                  />
                ))}
              </div>
            </div>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} style={{ ...row(6), flex: '1 1 0', minHeight: 0, borderTop: `1px solid ${ink(6)}` }}>
                <div style={{ width: u(9), height: u(9), borderRadius: 99, background: i % 3 === 0 ? tint(accent, 45) : surface2, flexShrink: 0 }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: u(2.5), flex: 1, minWidth: 0 }}>
                  <Bar w={`${62 - (i % 3) * 11}%`} h={4} c={surface2} />
                  <Bar w={`${40 - (i % 2) * 9}%`} h={3} c={surface} />
                </div>
                <Bar w={22} h={7} r={99} c={i < 2 ? tint(accent, 30) : surface} />
                <Bar w={14} h={3} c={surface} />
              </div>
            ))}
          </div>
          <div style={{ ...col(6), flex: 1, minWidth: 0 }}>
            {/* pipeline: stage value split, then each stage narrowing like a funnel */}
            <div style={{ ...panel, flex: 1.3, minHeight: 0, borderRadius: u(6), padding: u(8), display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: u(5) }}>
              <Bar w="45%" h={4} c={surface2} />
              <div style={{ display: 'flex', gap: u(2), height: u(5) }}>
                {(
                  [
                    [34, accent],
                    [26, tint(accent, 55)],
                    [22, surface2],
                    [18, surface],
                  ] as const
                ).map(([w, c], i) => (
                  <div key={i} style={{ width: `${w}%`, borderRadius: 99, background: c }} />
                ))}
              </div>
              {[100, 76, 52, 30].map((w, i) => (
                <div key={i} style={{ width: `${w}%`, height: u(7), borderRadius: u(3), background: i === 0 ? tint(accent, 70) : tint(accent, 44 - i * 10) }} />
              ))}
            </div>
            {/* automated follow-up: sent, sent, queued */}
            <div style={{ ...panel, flex: 1, minHeight: 0, borderRadius: u(6), padding: u(8), display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: u(4) }}>
              <Bar w="55%" h={4} c={surface2} />
              {[0, 1, 2].map((i) => (
                <div key={i} style={row(5)}>
                  <div style={{ width: u(6), height: u(6), borderRadius: 99, background: i < 2 ? accent : 'transparent', border: `1px solid ${i < 2 ? accent : ink(22)}`, flexShrink: 0 }} />
                  <Bar w={`${64 - i * 12}%`} h={3} c={i < 2 ? surface2 : surface} />
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    case 'ops':
      // Board columns stretch to the footer strip and the cards share each
      // column's height, so the board reads as a full screen at any size.
      return (
        <>
          <div style={{ display: 'flex', gap: u(6), flex: 1, minHeight: 0 }}>
            {[0, 1, 2].map((c) => (
              <div key={c} style={col(5)}>
                <div style={{ ...row(5), justifyContent: 'space-between' }}>
                  <Bar w="55%" h={4} c={c === 0 ? accent : surface2} />
                  <Bar w={10} h={4} c={surface} />
                </div>
                {Array.from({ length: [4, 3, 4][c] }).map((_, i) => (
                  <div
                    key={i}
                    style={{
                      ...panel,
                      flex: '1 1 0',
                      minHeight: 0,
                      overflow: 'hidden',
                      borderRadius: u(5),
                      padding: u(5),
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      gap: u(3),
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: u(3) }}>
                      <Bar w={`${82 - ((i + c) % 3) * 12}%`} h={4} c={surface2} />
                      <Bar w="48%" h={3} c={surface} />
                    </div>
                    <div style={row(4)}>
                      <div style={{ width: u(5), height: u(5), borderRadius: 99, background: (i + c) % 2 ? surface2 : tint(accent, 55), flexShrink: 0 }} />
                      <Bar w="22%" h={3} c={surface} />
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
          {/* activity strip: metric + sparkline bars */}
          <div style={{ ...panel, ...row(8), borderRadius: u(6), padding: `${u(6)} ${u(8)}`, height: u(34), flexShrink: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: u(4), width: '22%' }}>
              <Bar w="70%" h={3} c={surface} />
              <Bar w="90%" h={7} c={surface2} />
            </div>
            {/* team activity streaming in: two copies of the bars, moving left by half */}
            <div style={{ flex: 1, height: '100%', overflow: 'hidden' }}>
              <div className={loop('stream')} style={{ display: 'flex', width: '200%', height: '100%' }}>
                {[0, 1].map((copy) => (
                  <div key={copy} style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: u(3), paddingRight: u(3) }}>
                    {[35, 55, 42, 70, 50, 82, 64, 90, 58, 76, 48, 95].map((h, i) => (
                      <div key={i} style={{ flex: 1, height: `${h}%`, borderRadius: u(1.5), background: i % 3 === 2 ? accent : surface2, opacity: i % 3 === 2 ? 0.85 : 1 }} />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      );
    case 'email':
      return (
        <div style={col(5)}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} style={{ ...row(7), padding: `${u(5)} ${u(6)}`, background: i === 0 ? tint(accent, 12) : ink(3), borderRadius: u(5) }}>
              <div style={{ width: u(6), height: u(6), borderRadius: 99, background: i < 2 ? accent : surface, flexShrink: 0 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: u(3), flex: 1 }}>
                <Bar w={`${70 - i * 8}%`} h={4} c={surface2} />
                <Bar w={`${50 - i * 5}%`} h={3} c={surface} />
              </div>
            </div>
          ))}
        </div>
      );
    case 'invoicing':
      return (
        <div style={col(5)}>
          {(
            [
              ['Paid', accent],
              ['Due', surface2],
              ['Paid', accent],
              ['Overdue', danger],
            ] as const
          ).map(([status, c], i) => (
            <div key={i} style={{ ...row(7), padding: u(6), background: ink(3), borderRadius: u(5) }}>
              <Bar w="34%" h={5} c={surface2} />
              <Bar w="18%" h={5} c={surface} />
              <span
                style={{
                  marginLeft: 'auto',
                  padding: `${u(1.5)} ${u(6)}`,
                  borderRadius: 99,
                  background: c === surface2 ? surface2 : tint(c, 22),
                  color: c === surface2 ? 'var(--fg-2)' : c,
                  fontFamily: 'var(--nx-font-mono)',
                  fontSize: u(5),
                  fontWeight: 500,
                  letterSpacing: '0.04em',
                  lineHeight: 1.3,
                  textTransform: 'uppercase',
                }}
              >
                {status}
              </span>
            </div>
          ))}
        </div>
      );
    case 'inventory':
      return (
        <div style={col(5)}>
          <div style={{ display: 'flex', gap: u(6) }}>
            <Bar w="30%" h={4} c={accent} />
            <Bar w="22%" h={4} c={surface} />
            <Bar w="18%" h={4} c={surface} />
          </div>
          {[80, 45, 92, 30].map((pct, i) => (
            <div key={i} style={{ ...row(7), padding: `${u(4)} ${u(6)}`, background: ink(3), borderRadius: u(5) }}>
              <Bar w="30%" h={4} c={surface2} />
              <div style={{ flex: 1, height: u(5), borderRadius: 99, background: surface, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: pct < 40 ? danger : accent, borderRadius: 99 }} />
              </div>
            </div>
          ))}
        </div>
      );
    case 'pos':
      // menu grid (category tabs + item tiles) beside the order ticket
      return (
        <div style={{ display: 'flex', gap: u(6), flex: 1, minHeight: 0 }}>
          <div style={{ ...col(6), flex: 1.6 }}>
            <div style={row(4)}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} style={{ height: u(9), width: u(i === 0 ? 30 : 24), borderRadius: 99, background: i === 0 ? tint(accent, 28) : surface }} />
              ))}
            </div>
            <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gridAutoRows: '1fr', gap: u(5) }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} style={{ ...panel, borderRadius: u(5), display: 'flex', flexDirection: 'column', padding: u(4), gap: u(3), minHeight: 0 }}>
                  <div style={{ flex: 1, minHeight: 0, borderRadius: u(3), background: i % 3 === 1 ? tint(accent, 14) : ink(5) }} />
                  <Bar w="70%" h={3} c={surface2} />
                  <Bar w="40%" h={3} c={tint(accent, 75)} />
                </div>
              ))}
            </div>
          </div>
          <div style={{ ...panel, flex: 1, borderRadius: u(6), padding: u(7), display: 'flex', flexDirection: 'column', gap: u(6) }}>
            <Bar w="45%" h={4} c={surface2} />
            {[58, 44, 66, 38, 52, 47, 61, 35].map((w, i) => (
              // the newest order line arrives on the ticket, then clears
              <div key={i} className={i === 7 ? loop('ticketLine') : undefined} style={{ ...row(5) }}>
                <Bar w={u(8)} h={4} c={surface} />
                <Bar w={`${w}%`} h={3} c={surface2} />
                <div style={{ marginLeft: 'auto' }}>
                  <Bar w={14} h={3} c={surface} />
                </div>
              </div>
            ))}
            <div style={{ marginTop: 'auto', borderTop: `1px solid ${ink(8)}`, paddingTop: u(6), display: 'flex', justifyContent: 'space-between' }}>
              <Bar w="30%" h={5} c={surface2} />
              <Bar w="24%" h={5} c={surface2} />
            </div>
            <div style={{ height: u(14), borderRadius: u(4), background: accent, opacity: 0.85, flexShrink: 0 }} />
          </div>
        </div>
      );
    case 'delivery':
      // dispatch map (street grid + live route) over the driver queue
      return (
        <>
          <div style={{ ...panel, flex: 1, minHeight: 0, borderRadius: u(6), background: `linear-gradient(135deg, ${tint(accent, 14)}, ${ink(3)})`, position: 'relative', overflow: 'hidden' }}>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
              <g stroke={ink(9)} strokeWidth="1" vectorEffect="non-scaling-stroke" fill="none">
                {[18, 42, 66, 86].map((y) => (
                  <path key={`h${y}`} d={`M0 ${y}H100`} vectorEffect="non-scaling-stroke" />
                ))}
                {[14, 34, 58, 80].map((x) => (
                  <path key={`v${x}`} d={`M${x} 0V100`} vectorEffect="non-scaling-stroke" />
                ))}
              </g>
              <path d="M14 78V66H34V42H58V18H80" fill="none" stroke={accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" opacity="0.85" />
            </svg>
            {/* pins sit on the route's ends (same % as the viewBox) */}
            <div style={{ position: 'absolute', left: '14%', top: '78%', width: u(8), height: u(8), borderRadius: 99, background: accent, transform: 'translate(-50%, -50%)', boxShadow: `0 0 0 ${u(3)} ${tint(accent, 25)}` }} />
            <div style={{ position: 'absolute', left: '80%', top: '18%', width: u(8), height: u(8), borderRadius: 99, background: 'var(--fg)', opacity: 0.7, transform: 'translate(-50%, -50%)' }} />
            {/* the driver travels the route; its wrapper is map-sized, so translate % = map % */}
            <div className={loop('driver')} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, width: u(6), height: u(6), borderRadius: 99, background: 'var(--surface)', border: `${u(1.5)} solid ${accent}`, transform: 'translate(-50%, -50%)' }} />
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: u(4) }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ ...row(7), padding: `${u(4)} ${u(6)}`, background: ink(3), borderRadius: u(5) }}>
                <div style={{ width: u(6), height: u(6), borderRadius: 99, background: i === 0 ? accent : surface, flexShrink: 0 }} />
                <Bar w={`${45 - i * 7}%`} h={4} c={surface2} />
                <div style={{ marginLeft: 'auto', display: 'flex', gap: u(5), alignItems: 'center' }}>
                  <Bar w={16} h={3} c={surface} />
                  <Bar w={22} h={6} r={99} c={i === 0 ? tint(accent, 30) : surface} />
                </div>
              </div>
            ))}
          </div>
        </>
      );
  }
}

/**
 * Fills its (positioned) parent. Decorative by default; pass `label` when it
 * stands in for a screenshot so assistive tech gets a name for it.
 */
export function AppMockup({ variant, accent: brand, label }: { variant: MockupVariant; accent: string; label?: string }) {
  // The product's brand colour, chroma-calibrated so its tints sit beside
  // the site's one cobalt accent without shouting (see `calm`).
  const accent = calm(brand);
  return (
    <div
      className="absolute inset-0 overflow-hidden bg-surface"
      style={{ containerType: 'inline-size' }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <LoopRegion
        style={{
          position: 'absolute',
          inset: 0,
          padding: u(12),
          display: 'flex',
          flexDirection: 'column',
          gap: u(8),
          fontSize: 'clamp(4px, 1.6cqi, 16px)',
          background: `linear-gradient(160deg, ${tint(accent, 13)} 0%, transparent 70%)`,
        }}
      >
        {/* app toolbar */}
        <div style={row(6)}>
          <div style={{ width: u(16), height: u(16), borderRadius: u(5), background: tint(accent, 30) }} />
          <div style={{ height: u(8), width: u(90), borderRadius: u(4), background: surface }} />
          <div style={{ marginLeft: 'auto', display: 'flex', gap: u(4) }}>
            <Bar w={18} h={8} c={surface} r={4} />
            <div style={{ width: u(8), height: u(8), borderRadius: 99, background: surface2 }} />
          </div>
        </div>
        {body(variant, accent)}
      </LoopRegion>
    </div>
  );
}
