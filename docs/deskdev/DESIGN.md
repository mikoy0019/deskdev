# DESIGN — Premium Quality Bar & Direction

Applies to every screen in web **and** mobile. Read alongside `FOUNDATION-THEME.md` (token cheat-sheet + builder rules).

## The quality bar (10 points — every shipped screen)

1. **Real states, always.** Loading = skeletons that match the final layout (no spinners-in-a-void). Empty = designed empty states with an icon, a sentence, and a primary action (`EmptyState` component). Errors = inline, next to the thing that failed, with a retry — never toast-only failures.
2. **Restrained motion.** Transitions live in the 120–240ms band, ease-out, animating opacity/transform only. Every animation respects `prefers-reduced-motion` (reduce → fade or nothing).
3. **One radius scale, one 4px grid.** A single radius ramp used consistently (cards, inputs, chips each get exactly one value); all spacing/sizing snaps to a 4px grid. No ad-hoc 13px paddings.
4. **Accessible by construction.** WCAG AA contrast in both themes, visible `:focus-visible` rings on every interactive element, touch targets ≥ 44px (mobile especially).
5. **No default-anything.** No browser-default focus rings, form controls, scrollbars-with-no-thought, alert()/confirm(), default link blue, or unstyled selection. Every visible surface is a decision.
6. **Typography is engineered.** Self-hosted variable fonts (no CDN/FOIT), `font-variant-numeric: tabular-nums` for every column of numbers, durations, and counters so digits never jitter.
7. **Icons: Lucide + custom glyphs.** Lucide is the icon system; bespoke glyphs only where Lucide has no fit — drawn on the same grid/stroke so they're indistinguishable.
8. **Dense but breathable.** Information-dense layouts (this is an ops tool) with deliberate whitespace rhythm — density comes from tight type scale and alignment, never from cramming.
9. **Tokens only.** All color through semantic `ink-*` / `brand-*` / status-accent tokens — no hardcoded hex in components, no raw slate/gray/zinc, never `text-white`/`text-black` (use `text-ink-50`).
10. **The finishing 2%.** Real favicon + OG image, designed 404, correct per-route `document.title`, and haptics on mobile for confirm/destructive/drag interactions.

## Direction: "Editorial Ink"

The existing ink/brand system stays — we sharpen it into a calm, editorial, print-inspired workspace:

- **Palette:** keep the semantic `ink-50..ink-900` ramp (dark + light via tokens) and the fixed `brand-*` blue ramp. **Brand blue (`brand-600`, #2563eb) is THE interactive color** — links, primary buttons, active nav, focus rings, selection. Status accents (emerald/amber/rose/…) stay reserved for status, never for interaction.
- **Type stack:**
  - **Inter var** (self-hosted) for UI text, with `ss01` and `tnum` enabled — the workhorse.
  - **Schibsted Grotesk** for display: page titles, section headers, big dashboard numbers — the editorial voice.
  - **JetBrains Mono** for durations, time logs, IDs, and EOD report previews — anything that must read as data.
- **Motion:** two durations only — **150ms** (hover/press/small fades) and **200ms** (overlays, panel/route transitions), ease-out, reduced-motion aware.
- **Command palette:** Ctrl+K / Cmd+K palette is planned as the power-user spine (jump to client/project/task, quick actions) — design new features so their primary actions are palette-invokable.
- **Component classes first:** `.card` `.btn` `.btn-primary` `.btn-ghost` `.input` `.chip` `.section-title` (`site/src/deskdev/index.css`) are the building blocks — extend them rather than restyling per-screen.
