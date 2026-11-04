// Web-only (not mirrored to mobile). Where DeskDev's theme choice lives, shared
// with the NixGen site (src/lib/theme.ts) so a choice made on either side
// follows you to the other.
//
// Read order: the `nixgen-theme` cookie (scoped to .nixgensolutions.com in
// production, so it crosses subdomains), then localStorage `nixgen-theme`, then
// DeskDev's legacy localStorage `deskdev-theme`, else 'system' (follow the OS).
// The site only knows light/dark, so 'system' is expressed by clearing both
// shared values.
//
// The workspace layout's pre-paint script embeds READ_THEME_MODE_SCRIPT, the
// ES5 twin of resolveThemeMode — themeStorage.test.ts keeps the two in step.

export type ThemeMode = 'light' | 'dark' | 'system'

/** Cookie and localStorage key shared with the site (src/lib/theme.ts THEME_KEY). */
export const THEME_KEY = 'nixgen-theme'
/** DeskDev's pre-sync key. Still mirrored: the service worker's offline page reads it. */
export const LEGACY_THEME_KEY = 'deskdev-theme'

const ONE_YEAR = 31536000

export interface ThemeSources {
  /** document.cookie, or null when cookies can't be read. */
  cookie: string | null
  /** localStorage[THEME_KEY] */
  stored: string | null
  /** localStorage[LEGACY_THEME_KEY] */
  legacy: string | null
}

const COOKIE_PATTERN = new RegExp(`(?:^|; )${THEME_KEY}=(light|dark)`)

/** The theme in a document.cookie string, matched exactly as the site does. */
export function cookieTheme(cookie: string | null): 'light' | 'dark' | null {
  const m = cookie ? cookie.match(COOKIE_PATTERN) : null
  return m ? (m[1] as 'light' | 'dark') : null
}

export function resolveThemeMode({ cookie, stored, legacy }: ThemeSources): ThemeMode {
  const fromCookie = cookieTheme(cookie)
  if (fromCookie) return fromCookie
  if (stored === 'light' || stored === 'dark') return stored
  if (legacy === 'light' || legacy === 'dark' || legacy === 'system') return legacy
  return 'system'
}

export function isDarkMode(mode: ThemeMode, systemDark: boolean): boolean {
  return mode === 'dark' || (mode === 'system' && systemDark)
}

/**
 * An older DeskDev choice the site can't see yet: only the legacy key holds an
 * explicit theme. Persisting it once publishes it to the shared cookie.
 */
export function needsMigration({ cookie, stored, legacy }: ThemeSources): boolean {
  return (
    cookieTheme(cookie) === null &&
    stored !== 'light' &&
    stored !== 'dark' &&
    (legacy === 'light' || legacy === 'dark')
  )
}

/** Parent-domain scope in production (same rule as src/lib/theme.ts), host-only elsewhere. */
export function themeCookieDomain(hostname: string): string {
  return /(^|\.)nixgensolutions\.com$/.test(hostname) ? '; domain=.nixgensolutions.com' : ''
}

/**
 * The document.cookie assignments that record `mode`. light/dark write the
 * cookie with the site's attributes; 'system' expires it — in production both
 * the parent-domain cookie and any host-only one, so neither can shadow the OS.
 */
export function themeCookieWrites(mode: ThemeMode, hostname: string): string[] {
  const domain = themeCookieDomain(hostname)
  if (mode !== 'system') {
    return [`${THEME_KEY}=${mode}; path=/; max-age=${ONE_YEAR}; SameSite=Lax${domain}`]
  }
  const clear = `${THEME_KEY}=; path=/; max-age=0; SameSite=Lax`
  return domain ? [clear + domain, clear] : [clear]
}

/** Reads every source, tolerating blocked cookies or storage. */
export function readThemeSources(): ThemeSources {
  const sources: ThemeSources = { cookie: null, stored: null, legacy: null }
  if (typeof document === 'undefined') return sources
  try {
    sources.cookie = document.cookie
  } catch {
    // sandboxed document — cookies unreadable
  }
  try {
    sources.stored = localStorage.getItem(THEME_KEY)
    sources.legacy = localStorage.getItem(LEGACY_THEME_KEY)
  } catch {
    // localStorage unavailable
  }
  return sources
}

export function readThemeMode(): ThemeMode {
  return resolveThemeMode(readThemeSources())
}

/**
 * Records a choice: light/dark → cookie + localStorage (what the site reads);
 * 'system' → both cleared. The legacy key mirrors every choice so the offline
 * page and any older build still agree.
 */
export function persistThemeMode(mode: ThemeMode): void {
  if (typeof document === 'undefined') return
  try {
    for (const write of themeCookieWrites(mode, window.location.hostname)) document.cookie = write
  } catch {
    // cookies blocked — localStorage still carries the choice on this origin
  }
  try {
    if (mode === 'system') localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, mode)
    localStorage.setItem(LEGACY_THEME_KEY, mode)
  } catch {
    // ignore persistence failures
  }
}

/**
 * ES5 function expression for the pre-paint <head> script: returns the stored
 * ThemeMode exactly as resolveThemeMode(readThemeSources()) would.
 */
export const READ_THEME_MODE_SCRIPT = `function () {
    try {
      var m = document.cookie.match(/(?:^|; )${THEME_KEY}=(light|dark)/)
      if (m) return m[1]
    } catch (e) {}
    try {
      var s = localStorage.getItem('${THEME_KEY}')
      if (s === 'light' || s === 'dark') return s
      s = localStorage.getItem('${LEGACY_THEME_KEY}')
      if (s === 'light' || s === 'dark' || s === 'system') return s
    } catch (e) {}
    return 'system'
  }`
