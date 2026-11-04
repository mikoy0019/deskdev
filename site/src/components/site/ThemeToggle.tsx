'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { MoonIcon, SunIcon } from '@phosphor-icons/react';
import { THEME_EVENT, THEME_KEY, applyTheme, readTheme, storedTheme, type Theme } from '@/lib/theme';

const subscribe = (onChange: () => void) => {
  window.addEventListener(THEME_EVENT, onChange);
  return () => window.removeEventListener(THEME_EVENT, onChange);
};
// The server can't know the theme: render a neutral icon/label first (null), then the real one.
const serverTheme = () => null;

/**
 * The glyph swap is a crossfade, not a spin: the outgoing icon dips to 0.9
 * and blurs 2px while the incoming one sharpens in, 200ms on the strong
 * ease-out (the blur bridges the two shapes, so it reads as one object
 * changing). Both glyphs are stacked in one grid cell, so nothing shifts.
 */
const GLYPH = 'col-start-1 row-start-1 grid place-items-center';
const GLYPH_TRANSITION = 'opacity 200ms var(--ease-out), scale 200ms var(--ease-out), filter 200ms var(--ease-out)';
// While the theme switches, nx.css gives every element colour-only transitions
// (html.nx-theme-switching, !important), which would make this swap instant.
// An important inline declaration outranks it, so the glyph keeps its crossfade.
// Reduced motion keeps only the fade (the size and blur change land at once).
const keepTransition = (el: HTMLSpanElement | null) => {
  if (!el) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.style.setProperty('transition', reduced ? 'opacity 200ms ease' : GLYPH_TRANSITION, 'important');
};

/** Page backgrounds (nx.css --bg), mirrored in the (site) layout's viewport.themeColor. */
const STATUS_BAR: Record<Theme, string> = { dark: '#06080d', light: '#f5f6f8' };
const syncStatusBar = (theme: Theme) => {
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = STATUS_BAR[theme];
  }
};

/** Sun/moon switch. Follows other tabs (storage event) and the OS setting
 *  until the visitor makes an explicit choice. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  // html[data-theme] is the source of truth; applyTheme() announces every change.
  const theme = useSyncExternalStore<Theme | null>(subscribe, readTheme, serverTheme);

  // The status bar follows the page, not the OS: once the visitor picks a
  // theme, both theme-color metas (one per OS scheme) carry that theme's bg.
  useEffect(() => {
    if (theme) syncStatusBar(theme);
  }, [theme]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_KEY && (e.newValue === 'light' || e.newValue === 'dark')) {
        applyTheme(e.newValue, { persist: false });
      }
    };
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onSystem = () => {
      if (!storedTheme()) applyTheme(media.matches ? 'light' : 'dark', { persist: false });
    };
    window.addEventListener('storage', onStorage);
    media.addEventListener('change', onSystem);
    return () => {
      window.removeEventListener('storage', onStorage);
      media.removeEventListener('change', onSystem);
    };
  }, []);

  const next: Theme = theme === 'light' ? 'dark' : 'light';
  const label = theme ? `Switch to ${next} theme` : 'Switch theme';

  return (
    <button
      type="button"
      onClick={() => applyTheme(next)}
      aria-label={label}
      title={label}
      // 44px target; colour changes ease, the press answers with scale 0.97 in 140ms.
      // nx-js-only: without JavaScript the switch could do nothing, so it is not shown.
      className={`nx-js-only relative inline-grid size-11 shrink-0 touch-manipulation select-none place-items-center rounded-full text-fg-2 [-webkit-tap-highlight-color:transparent] [transition:background-color_200ms_ease,color_200ms_ease,scale_var(--dur-press)_var(--ease-out)] hover:bg-surface-2 hover:text-fg active:scale-[0.97] motion-reduce:active:scale-100 ${className}`}
    >
      {/* Sun (shown in dark theme → click for light) */}
      <span ref={keepTransition} aria-hidden className={`${GLYPH} light:scale-90 light:opacity-0 light:blur-[2px]`}>
        <SunIcon size={18} />
      </span>
      {/* Moon (shown in light theme → click for dark) */}
      <span ref={keepTransition} aria-hidden className={`${GLYPH} scale-90 opacity-0 blur-[2px] light:scale-100 light:opacity-100 light:blur-none`}>
        <MoonIcon size={18} />
      </span>
    </button>
  );
}
