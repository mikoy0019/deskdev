// Theme (dark / light) for the NixGen site — shared with DeskDev.
//
// html[data-theme] drives every token in src/styles/nx.css. The boot script
// runs in <head> before first paint (no flash of the wrong theme); after that,
// ThemeToggle flips the attribute and persists the choice.
//
// Persistence is a `nixgen-theme` cookie (scoped to the parent domain in
// production, so nixgensolutions.com and workspace.nixgensolutions.com share
// it) mirrored to localStorage under the same key. DeskDev reads and writes the
// same pair, so the choice follows you between the site and the workspace.
// No stored value → follow the OS (prefers-color-scheme).

export type Theme = 'dark' | 'light';

export const THEME_KEY = 'nixgen-theme';
export const THEME_EVENT = 'nixgen-theme-change';

/** Inline <head> script: sets the theme before first paint. */
export const THEME_BOOT_SCRIPT = `(function(){var d=document.documentElement,k='${THEME_KEY}',s=null;try{var m=document.cookie.match(/(?:^|; )${THEME_KEY}=(light|dark)/);s=m?m[1]:localStorage.getItem(k);}catch(e){}var t=s==='light'||s==='dark'?s:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');d.setAttribute('data-theme',t);d.style.colorScheme=t;})();`;

/** Parent-domain cookie scope in production (".nixgensolutions.com"), host-only elsewhere. */
function cookieDomain(): string {
  const host = window.location.hostname;
  return /(^|\.)nixgensolutions\.com$/.test(host) ? '; domain=.nixgensolutions.com' : '';
}

export function storedTheme(): Theme | null {
  try {
    const m = document.cookie.match(new RegExp(`(?:^|; )${THEME_KEY}=(light|dark)`));
    const v = m ? m[1] : localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

export function readTheme(): Theme {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme: Theme, { persist = true, animate = true } = {}) {
  const root = document.documentElement;
  if (animate) {
    root.classList.add('nx-theme-switching');
    window.setTimeout(() => root.classList.remove('nx-theme-switching'), 400);
  }
  root.setAttribute('data-theme', theme);
  root.style.colorScheme = theme;
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* private mode — the cookie / attribute still apply */
    }
    document.cookie = `${THEME_KEY}=${theme}; path=/; max-age=31536000; SameSite=Lax${cookieDomain()}`;
  }
  window.dispatchEvent(new CustomEvent<Theme>(THEME_EVENT, { detail: theme }));
}
