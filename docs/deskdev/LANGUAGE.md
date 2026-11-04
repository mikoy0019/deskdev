# LANGUAGE — the Foundation contract

The concrete vocabulary every stage-2 screen uses. Direction is **Editorial Ink**:
a calm, dense, print-inspired ops workspace. Restraint is the point. Read with
`FOUNDATION-THEME.md` (token cheat-sheet) and `DESIGN.md` (quality bar).

## Fonts (self-hosted, no CDN)

| Role | Tailwind class | Font | Use for |
|---|---|---|---|
| UI | `font-sans` (default) | Inter Variable | Body, labels, inputs, tables — the workhorse |
| Display | `font-display` / `.text-display` | Schibsted Grotesk Variable | Page titles, section headers, big dashboard numbers |
| Mono | `font-mono` | JetBrains Mono Variable | IDs, keyboard hints, code and EOD previews; numbers, dates, durations and timestamps are sans with `tabular-nums` |

- Inter `ss01` + `cv11` are on globally. **Numbers that align** (tables, money,
  durations, counts, dates) get `.tabular-nums` so digits never jitter.
- Reach for `font-display` on titles/hero numbers only — not paragraphs.

## Type scale (px @ 16px root; compact drops root to 15px)

| Token | Class | Size |
|---|---|---|
| Display XL | `.text-display text-3xl` | 30px / 1.875rem |
| Display L | `.text-display text-2xl` | 24px |
| Title | `text-lg font-semibold` | 18px |
| Body | `text-sm` | 14px (default UI size) |
| Meta | `text-xs` | 12px |
| Caption | `text-[11px]` | 11px |
| Count badge | `text-[10px]` | 10px: count-badge numerals only |
| Section label | `.section-title` | 12px uppercase tracked |

## Radius scale (one ramp — pick one rung per surface)

`--radius-sm` 6px (chips, badges, small controls) · `--radius-md` 8px (buttons,
inputs) · `--radius-lg` 12px (cards, modals, palette). Component classes already
apply the right rung — don't hand-set radii.

## Spacing — 4px grid

Every padding/margin/gap snaps to multiples of 4px (Tailwind `1`=4px). No ad-hoc
13px. Card interiors use `.density-card` (padding var), rows use `.density-row`.

## Component classes (extend these, never restyle per screen)

`.card` `.card-hover` · `.btn` `.btn-primary` `.btn-secondary` `.btn-ghost`
`.btn-danger` · `.input` · `.chip` (pill filter/tag) · `.section-title` ·
`.text-display`. All carry token borders, layered `--shadow-*`, 150ms
transitions, and a brand `:focus-visible` ring.

### Status badges (semantic only — never for interaction)

`.badge` + one of: `.badge-neutral` `.badge-info` `.badge-success`
`.badge-warn` `.badge-danger` `.badge-brand`. Pattern is `/15` fill, `/30`
border, `400`-tone text; reads on both themes.

## Color

- **brand-blue is THE interactive color** — links, primary buttons, active nav,
  focus rings, selection. `brand-600` is the primary.
- Surfaces = **ink tokens only** (`ink-50..ink-900`, alpha OK: `bg-ink-800/60`).
- Status accents (emerald/amber/rose/sky) **only** via `.badge-*` for status.
- Never `text-white`/`text-black` → use `text-ink-50`. Never raw slate/gray/zinc.
  Never hardcoded hex/rgb in components.

## Motion (two durations, reduced-motion safe)

- `.animate-fade` — 150ms opacity (micro fades, hover reveals).
- `.animate-fade-rise` — 200ms opacity + 4px rise (panels, modals, palette).
- `.animate-shimmer` — skeleton shimmer.
- Everything collapses to instant under `prefers-reduced-motion` (handled in CSS).
- Hover/press = 150ms; overlays/route = 200ms; ease-out; opacity/transform only.

## Density

`data-density` on `<html>`, persisted (`deskdev-density`). `DensityProvider`
wraps the app; `useDensity()` → `{ density, setDensity, toggleDensity }`;
`<DensityToggle/>` lives in the Topbar. Compact tightens `--row-py` / `--card-p`
and drops root type a notch. Consume via `.density-row` / `.density-card`.

## Required states (every list/data view)

1. **Loading** → content-shaped skeletons from `ui-foundation/Skeleton`:
   `SkeletonLine` `SkeletonBlock` `SkeletonCard` `SkeletonRow` `SkeletonList`.
   Never a bare spinner.
2. **Empty** → `<EmptyState glyph="…" title description action />`. Glyphs:
   `clients projects tasks calendar crm meetings notifications search-empty`
   (duotone marks from `ui-foundation/glyphs`, `<Glyph/>`). Not emoji, not Lucide.
3. **Error** → inline, next to what failed, with a retry. Never `alert()`, never
   toast-only.

## Command palette

Global **Ctrl/Cmd+K** (`CommandPalette`, mounted once in `App.tsx`). Design new
features so their primary action is palette-invokable. Quick-create commands
navigate to `…?new=1` — **stage-2 pages should read `?new=1` and auto-open their
create modal.** Topbar shows the `<KbdHint/>` chip.

## Icons

Lucide for inline UI (buttons, rows, menus), ~16px. Duotone `Glyph` only for the
large empty/zero-state marks. Never emoji as icons.

## DO / DON'T

**DO** — tokens only · one radius + 4px grid · tabular numerals for aligned
numbers · mono for IDs, keyboard hints, code and EOD previews (numbers, dates,
durations and timestamps are sans with `tabular-nums`) · real loading/empty/error states ·
`:focus-visible` brand ring on every interactive element · verify light **and**
dark.

**DON'T** — purple/indigo gradient heroes · glassmorphism blur soup · neon glows ·
emoji icons · decorative gradients on surfaces · random accent colors · status
colors for interaction · `text-white`/`text-black` · raw slate/gray/zinc ·
hardcoded hex · bare spinners · dead empty whitespace · `alert()`/`confirm()` ·
gratuitous motion.
