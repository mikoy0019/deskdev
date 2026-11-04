import { useColorScheme } from 'react-native'
import { useStore, type ThemeMode } from '../store/useStore'
import type {
  ProjectStatus, TaskStatus, Priority, Engagement, ClientStatus, Role,
} from './types'

// ─── Fonts ───────────────────────────────────────────────────────────────────
// Mirrors the web type stack (LANGUAGE.md / DESIGN.md):
//   sans    → Inter            (UI workhorse: body, labels, inputs)
//   display → Schibsted Grotesk (page titles, section headers, big numerals)
//   mono    → JetBrains Mono    (IDs, durations, timestamps — reads as data)
//
// React Native resolves fontWeight per registered family name (no variable-font
// weight synthesis), so each weight is its own family. These string keys must
// match the names passed to `useFonts` in app/_layout.tsx. Prefer the weight-
// specific key (e.g. fonts.sansSemibold) over pairing fonts.sans + fontWeight.
export const fonts = {
  /** Inter — UI body / labels / inputs. */
  sans: 'Inter_400Regular',
  sansMedium: 'Inter_500Medium',
  sansSemibold: 'Inter_600SemiBold',
  sansBold: 'Inter_700Bold',
  /** Schibsted Grotesk — editorial display voice (titles, big numbers). */
  display: 'SchibstedGrotesk_600SemiBold',
  displayBold: 'SchibstedGrotesk_700Bold',
  /** JetBrains Mono — data: IDs, durations, timestamps. */
  mono: 'JetBrainsMono_400Regular',
  monoMedium: 'JetBrainsMono_500Medium',
  monoSemibold: 'JetBrainsMono_600SemiBold',
} as const

// ─── Radius scale ────────────────────────────────────────────────────────────
// One ramp, mirrored from web (site/src/deskdev/index.css --radius-*). Pick one rung per
// surface — never hand-set radii in screens.
export const radius = {
  /** 6px — chips, badges, small controls (web --radius-sm). */
  sm: 6,
  /** 8px — buttons, inputs (web --radius-md). */
  md: 8,
  /** 12px — cards, modals, sheets (web --radius-lg). */
  lg: 12,
  /** full pill — filter/tag chips (web rounded-full). */
  pill: 999,
} as const

// ─── Spacing scale ───────────────────────────────────────────────────────────
// DESIGN.md #3: everything snaps to a 4px grid. Screens should reach for these
// rungs instead of hand-typing padding numbers (that drift is what produced the
// clipped-chip bug: a 52px cap around a 55px row).
export const space = {
  /** 4px */ xs: 4,
  /** 8px */ sm: 8,
  /** 12px — default gutter between cards */ md: 12,
  /** 16px — screen padding */ lg: 16,
  /** 24px */ xl: 24,
  /** 32px */ xxl: 32,
} as const

// ─── Motion ──────────────────────────────────────────────────────────────────
// DESIGN.md: two durations only, ease-out, opacity/transform only.
export const motion = {
  /** 150ms — press, hover, small fades. */
  fast: 150,
  /** 200ms — overlays, sheets, route transitions. */
  base: 200,
} as const

// ─── Layout constants ────────────────────────────────────────────────────────
// The tab bar floats over content, so scroll views must reserve room for it or
// the last card hides behind the glass. Import this instead of guessing.
export const layout = {
  /** Height of the floating tab pill itself. */
  tabBarHeight: 64,
  /** Gap between the pill and the bottom safe-area inset. */
  tabBarInset: 12,
  /** Bottom padding scroll content needs to clear the floating pill. */
  get scrollClearance() {
    return this.tabBarHeight + this.tabBarInset * 2
  },
} as const

// ─── Palette ─────────────────────────────────────────────────────────────────
// Mirrors the web app's semantic ink ramp + brand tokens
// (site/src/deskdev/index.css, incl. its @theme block). Same semantic meaning in both themes.

export interface Palette {
  /** ink-900 — page background */
  page: string
  /** ink-850 — sidebar / topbar / tab bar surface */
  surface: string
  /** ink-800 — card surface */
  card: string
  /** ink-700 — hover / input surface */
  hover: string
  /** ink-600 — default border */
  border: string
  /** ink-500 — strong border / disabled */
  borderStrong: string
  /** ink-400 — muted icons */
  iconMuted: string
  /** ink-300 — muted secondary text / placeholders */
  textMuted: string
  /** ink-200 — secondary text */
  textSecondary: string
  /** ink-100 — primary body text */
  text: string
  /** ink-50 — highest-contrast text (white in dark, near-black in light) */
  textHigh: string
  /** brand-600 #2563eb — primary buttons, FAB (white text on top) */
  brand: string
  /** brand text accent — brand-400 in dark, brand-600 in light */
  brandText: string
  /** rose-500 — destructive */
  danger: string
  /** emerald — success status text/icon (mirrors web .badge-success text tone) */
  success: string
  /** amber — warning status text/icon (mirrors web .badge-warn text tone) */
  warn: string
  /** sky — info status text/icon (mirrors web .badge-info text tone) */
  info: string

  // ── Glass (floating tab bar, sheets, any surface that sits *over* content) ──
  // On iOS 26 the real liquid-glass material carries the look and these are
  // barely visible; on Android they sit on top of the BlurView; with no blur at
  // all they carry it alone — so they must read well unassisted.
  /** Translucent fill layered over the blur. */
  glass: string
  /** Hairline edge of a glass surface. */
  glassBorder: string
  /** Top inner highlight — the "lit edge" that sells the material. */
  glassHighlight: string
  /**
   * Soft internal gradient. Real glass is never one flat tone — brightness
   * varies across the surface, and that variation is most of what reads as
   * "liquid" rather than "grey box".
   */
  glassGradient: string
  /**
   * Inset reflections: a bright rim along the top edge and a darker one along
   * the bottom, so the surface looks lit from above and has thickness.
   *
   * These are the ONLY depth cue on a glass surface — deliberately no cast
   * shadow, which under a translucent panel just smears a dark halo over the
   * content behind it.
   */
  glassReflections: BoxShadow[]
  /** Fill of the active-tab bubble — a light "lens" inside the glass. */
  glassBubble: string
  /** Tint passed to expo-blur's BlurView. */
  blurTint: 'light' | 'dark'
  /** Scrim behind modals / sheets. */
  overlay: string
}

/** RN 0.85 boxShadow entry (supports `inset`, which is what makes reflections). */
export interface BoxShadow {
  offsetX: number
  offsetY: number
  blurRadius?: number
  spreadDistance?: number
  color?: string
  inset?: boolean
}

export const palettes: { light: Palette; dark: Palette } = {
  light: {
    page: '#f5f6f8',
    surface: '#eef0f4',
    card: '#ffffff',
    hover: '#f0f2f6',
    border: '#e2e8f0',
    borderStrong: '#cbd5e1',
    iconMuted: '#94a3b8',
    textMuted: '#64748b',
    textSecondary: '#475569',
    text: '#1e293b',
    textHigh: '#0f172a',
    brand: '#2563eb',
    brandText: '#2563eb',
    danger: '#f43f5e',
    success: '#059669', // emerald-600
    warn: '#d97706',    // amber-600
    info: '#0ea5e9',    // sky-500
    // Mostly-opaque frosted white — the light-theme twin of the dark bar (see
    // the note there: the material is dense, the blur does the "glass").
    glass: 'rgba(248, 249, 251, 0.88)',
    glassBorder: 'rgba(15, 23, 42, 0.06)',
    glassHighlight: 'rgba(255, 255, 255, 0.9)',
    glassGradient:
      'linear-gradient(180deg, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0.10) 45%, rgba(15,23,42,0.03) 100%)',
    glassReflections: [
      { offsetX: 0, offsetY: 1, blurRadius: 1, color: 'rgba(255,255,255,0.70)', inset: true },
      { offsetX: 0, offsetY: -1, blurRadius: 2, color: 'rgba(15,23,42,0.08)', inset: true },
    ],
    glassBubble: 'rgba(15, 23, 42, 0.09)',
    blurTint: 'light',
    overlay: 'rgba(15, 23, 42, 0.32)',
  },
  dark: {
    page: '#0a0c12',
    surface: '#0e1119',
    card: '#11141c',
    hover: '#171b25',
    border: '#1e2330',
    borderStrong: '#2a3040',
    iconMuted: '#3b4356',
    textMuted: '#5a6275',
    textSecondary: '#8a91a3',
    text: '#c1c6d4',
    textHigh: '#ffffff',
    brand: '#2563eb',
    brandText: '#5ea0ff',
    danger: '#f43f5e',
    success: '#34d399', // emerald-400
    warn: '#fbbf24',    // amber-400
    info: '#38bdf8',    // sky-400
    // Near-solid smoky black, NOT a thin see-through film.
    //
    // This is the counter-intuitive part: the reference bar (Instagram's) is
    // *more* opaque than a transparent pane, not less. Its glassiness comes from
    // heavily blurring what's behind it, then laying a dark, almost-solid tint on
    // top — you perceive soft colour and motion through it, never legible content.
    // Dropping the tint to let content read through does the opposite: it looks
    // like a cheap transparent overlay, and white icons start fighting whatever
    // scrolls underneath.
    glass: 'rgba(22, 23, 27, 0.86)',
    // Barely-there rim. The reference has no bright glass edge — a visible
    // hairline would make it read as a drawn box rather than a mass of material.
    glassBorder: 'rgba(255, 255, 255, 0.06)',
    glassHighlight: 'rgba(255, 255, 255, 0.10)',
    // Very slight top-lit falloff — enough to avoid a dead flat fill, not enough
    // to look like a painted gradient.
    glassGradient:
      'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.01) 45%, rgba(0,0,0,0.06) 100%)',
    glassReflections: [
      { offsetX: 0, offsetY: 1, blurRadius: 1, color: 'rgba(255,255,255,0.10)', inset: true },
      { offsetX: 0, offsetY: -1, blurRadius: 2, color: 'rgba(0,0,0,0.20)', inset: true },
    ],
    // The active lens: a soft light patch inside the dark glass.
    glassBubble: 'rgba(255, 255, 255, 0.14)',
    blurTint: 'dark',
    overlay: 'rgba(0, 0, 0, 0.55)',
  },
}

// ─── Theme hook (system scheme + manual override from store settings) ────────

export function useThemeMode(): ThemeMode {
  return useStore((s) => s.settings.themeMode ?? 'system')
}

export function useIsDark(): boolean {
  const scheme = useColorScheme()
  const mode = useThemeMode()
  if (mode === 'system') return (scheme ?? 'dark') === 'dark'
  return mode === 'dark'
}

export function useTheme(): Palette {
  return useIsDark() ? palettes.dark : palettes.light
}

// ─── Accent chips (web pattern: bg accent/15, border accent/30, text -400) ──

export type Accent =
  | 'brand' | 'sky' | 'amber' | 'emerald' | 'rose'
  | 'violet' | 'fuchsia' | 'teal' | 'slate' | 'orange'

const ACCENT_500: Record<Accent, string> = {
  brand: '#3b82f6',
  sky: '#0ea5e9',
  amber: '#f59e0b',
  emerald: '#10b981',
  rose: '#f43f5e',
  violet: '#8b5cf6',
  fuchsia: '#d946ef',
  teal: '#14b8a6',
  slate: '#64748b',
  orange: '#f97316',
}

const ACCENT_400: Record<Accent, string> = {
  brand: '#5ea0ff',
  sky: '#38bdf8',
  amber: '#fbbf24',
  emerald: '#34d399',
  rose: '#fb7185',
  violet: '#a78bfa',
  fuchsia: '#e879f9',
  teal: '#2dd4bf',
  slate: '#94a3b8',
  orange: '#fb923c',
}

/** Hex (#rrggbb) → rgba() string. */
export function rgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export interface ChipColors {
  bg: string
  border: string
  text: string
}

/** Tinted pill colors matching the web `.chip` accent pattern. */
export function accentChip(accent: Accent): ChipColors {
  return {
    bg: rgba(ACCENT_500[accent], 0.15),
    border: rgba(ACCENT_500[accent], 0.3),
    text: ACCENT_400[accent],
  }
}

/** Neutral chip — web: bg-ink-600 text-ink-100 border-ink-500. */
export function neutralChip(p: Palette): ChipColors {
  return { bg: p.border, border: p.borderStrong, text: p.text }
}

// ─── Status colors + labels (mirror site/src/deskdev/components/Chips.tsx) ────────────

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  backlog: 'Backlog',
  planning: 'Planning',
  in_progress: 'In Progress',
  waiting: 'Waiting',
  done: 'Done',
}

export function projectStatusChip(p: Palette, status: ProjectStatus): ChipColors {
  switch (status) {
    case 'planning': return accentChip('sky')
    case 'in_progress': return accentChip('brand')
    case 'waiting': return accentChip('amber')
    case 'done': return accentChip('emerald')
    default: return neutralChip(p) // backlog
  }
}

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  done: 'Done',
}

export function taskStatusChip(p: Palette, status: TaskStatus): ChipColors {
  switch (status) {
    case 'in_progress': return accentChip('brand')
    case 'blocked': return accentChip('rose')
    case 'done': return accentChip('emerald')
    default: return neutralChip(p) // todo
  }
}

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'LOW',
  med: 'MED',
  high: 'HIGH',
}

export function priorityChip(p: Palette, priority: Priority): ChipColors {
  switch (priority) {
    case 'med': return accentChip('amber')
    case 'high': return accentChip('rose')
    default: return neutralChip(p) // low
  }
}

export const ENGAGEMENT_LABELS: Record<Engagement, string> = {
  full_time: 'Full Time',
  part_time: 'Part Time',
  gig_on_call: 'Gig — On Call',
}

export function engagementChip(engagement: Engagement): ChipColors {
  switch (engagement) {
    case 'full_time': return accentChip('sky')
    case 'part_time': return accentChip('violet')
    default: return accentChip('amber') // gig_on_call
  }
}

export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  ended: 'Ended',
}

export function clientStatusChip(status: ClientStatus): ChipColors {
  switch (status) {
    case 'active': return accentChip('emerald')
    case 'paused': return accentChip('amber')
    default: return accentChip('slate') // ended
  }
}

export function roleChip(role: Role): ChipColors {
  return role === 'admin' ? accentChip('brand') : accentChip('teal')
}

// ─── Avatar colors ───────────────────────────────────────────────────────────
// format.ts avatarColor() returns Tailwind class names (shared with web) —
// map them to hex for native backgrounds.

const AVATAR_HEX: Record<string, string> = {
  'bg-rose-500': '#f43f5e',
  'bg-amber-500': '#f59e0b',
  'bg-emerald-500': '#10b981',
  'bg-sky-500': '#0ea5e9',
  'bg-violet-500': '#8b5cf6',
  'bg-fuchsia-500': '#d946ef',
  'bg-teal-500': '#14b8a6',
  'bg-orange-500': '#f97316',
}

/** Tailwind bg class (from avatarColor/User.avatarColor) → hex. Passes through
 *  a raw hex value (client/category colors are stored as hex, not classes). */
export function avatarHex(bgClass?: string): string {
  if (!bgClass) return '#2563eb'
  if (bgClass.startsWith('#')) return bgClass
  return AVATAR_HEX[bgClass] || '#2563eb'
}

/** Client color palette — mirrors the web client form (ClientBits CLIENT_COLORS). */
export const CLIENT_COLORS = [
  '#8b5cf6', '#0ea5e9', '#10b981', '#f59e0b',
  '#f43f5e', '#14b8a6', '#f97316', '#6366f1',
]

/**
 * Swatches offered by every "pick a color" control (CRM tables, CRM select
 * options, calendar events).
 *
 * These were three near-identical arrays copy-pasted across TableForm,
 * ColumnForm and EventForm — same hues, shuffled order, one stray slate. Colors
 * users pick are stored as hex on the record, so unifying the picker only
 * changes which swatch sits in which slot, never an existing selection.
 */
export const SWATCHES = [
  '#2563eb', '#0ea5e9', '#10b981', '#f59e0b',
  '#f43f5e', '#8b5cf6', '#14b8a6', '#f97316',
]
