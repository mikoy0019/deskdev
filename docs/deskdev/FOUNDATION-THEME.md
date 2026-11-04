# THEME

DeskDev Studio web supports **dark + light** via a `.dark` class (Tailwind 4: `@custom-variant dark` in `site/src/deskdev/index.css`) and CSS-variable-driven semantic tokens. Paths written `src/...` are relative to `site/src/deskdev/`. Wrap the app in `ThemeProvider` from `src/theme/ThemeContext.tsx`; `useTheme()` gives `{ mode, setMode, isDark }` (mode: `'light' | 'dark' | 'system'`, persisted to localStorage `deskdev-theme`).

## Ink token cheat-sheet (semantic — same meaning in both themes)

| Token | Use for |
|---|---|
| `ink-900` | Page background |
| `ink-850` | Sidebar / topbar surface |
| `ink-800` | Card surface |
| `ink-700` | Hover surface |
| `ink-600` | Default border |
| `ink-500` | Strong border / disabled |
| `ink-400` | Muted icons |
| `ink-300` | Muted secondary text / placeholders |
| `ink-200` | Secondary text |
| `ink-100` | Primary body text |
| `ink-50`  | Highest-contrast text (white in dark, near-black in light) |

Alpha modifiers work: `bg-ink-800/60`, `border-ink-600/50`, etc.

## Rules for builders

- **Never use `text-white` or `text-black`** — use `text-ink-50` for max-contrast text. (`text-white` on a solid `bg-brand-600` button is the one exception — brand blue takes white text in both themes.)
- **Never use raw slate/gray/zinc colors** — use ink tokens; the light-theme values already map to slate-ish grays.
- **`brand-*` classes are fine as-is** in both themes (fixed hex ramp, primary `brand-600` #2563eb).
- **Status accents** (sky, amber, emerald, rose, violet, fuchsia, teal) keep stock Tailwind classes with the `/15` background + `/30` border pattern, e.g. `bg-emerald-500/15 border-emerald-500/30 text-emerald-400` — this reads well on both themes.
- Component classes `.card`, `.card-hover`, `.btn`, `.btn-primary`, `.btn-ghost`, `.input`, `.chip`, `.section-title` (src/index.css) are already token-aware — prefer them.
- `components/ui/` holds presentational, route-agnostic primitives (e.g. `sidebar-nav.tsx`). This app is **not** shadcn — there is no `components.json` and no `bg-card`/`border-border` CSS-var layer. Any component pulled in from shadcn/21st.dev must have its classes re-pointed onto the ink/brand ramp before it lands.

## Mobile (`mobile/src/lib/theme.ts`)

Same semantics, no Tailwind — React Native styles read the tokens from `theme.ts`. `useTheme()` returns the active `Palette`.

| Export | Use for |
|---|---|
| `useTheme()` → `Palette` | All color. Fields mirror the ink ramp: `page`, `surface`, `card`, `hover`, `border`, `borderStrong`, `iconMuted`, `textMuted`, `textSecondary`, `text`, `textHigh`, `brand`, `brandText`, plus `danger`/`success`/`warn`/`info`. |
| `glass`, `glassBorder`, `glassHighlight`, `blurTint` | Surfaces that float *over* content (the tab bar). Consumed by `<GlassSurface>` — don't hand-roll blur. |
| `overlay` | Modal/sheet scrims. Never hardcode `rgba(0,0,0,0.55)`. |
| `space` | 4px grid: `xs` 4 · `sm` 8 · `md` 12 · `lg` 16 · `xl` 24 · `xxl` 32. |
| `radius` | `sm` 6 · `md` 8 · `lg` 12 · `pill`. |
| `motion` | `fast` 150ms · `base` 200ms. Only these two. |
| `layout` | `tabBarHeight`, `tabBarInset`, `scrollClearance` — scroll content inside a tab screen **must** pad by `scrollClearance` or it hides under the floating tab bar. |
| `SWATCHES` | The one color-picker palette (CRM tables, select options, events). |

### Rules for builders (mobile)

- **No raw hex in screens.** The only sanctioned literal is `#ffffff` for text/icons sitting on a solid `p.brand` fill — the same exception the web rules carry.
- **No ad-hoc padding numbers.** Use `space` rungs. A hand-typed `maxHeight: 52` around a 55px chip row is what sheared the client names off the filter chips.
- **Size pills by `minHeight`, not vertical padding**, so a parent can never clip the text. Reach for the shared `<FilterChip>` rather than re-implementing one per screen.
- **No system `Alert` for menus** — use `<ActionSheet>` (DESIGN.md #5: no default alert()/confirm()).
- **Tab screens** pass `tabScreen` to `<Screen>` (adds the top safe-area inset — they have no native header — and reserves bottom room for the tab pill) and render a `<ScreenHeader>` via the `header` prop.
