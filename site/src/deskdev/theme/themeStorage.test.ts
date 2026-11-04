import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { THEME_KEY as SITE_THEME_KEY } from '../../lib/theme'
import {
  LEGACY_THEME_KEY,
  READ_THEME_MODE_SCRIPT,
  THEME_KEY,
  cookieTheme,
  isDarkMode,
  needsMigration,
  persistThemeMode,
  readThemeMode,
  resolveThemeMode,
  themeCookieDomain,
  themeCookieWrites,
  type ThemeSources,
} from './themeStorage'

const none: ThemeSources = { cookie: null, stored: null, legacy: null }

function clearCookie() {
  document.cookie = `${THEME_KEY}=; path=/; max-age=0`
}

describe('THEME_KEY', () => {
  it('is the key the site writes', () => {
    expect(THEME_KEY).toBe(SITE_THEME_KEY)
  })
})

describe('cookieTheme', () => {
  it('reads light/dark wherever the cookie sits', () => {
    expect(cookieTheme('nixgen-theme=dark')).toBe('dark')
    expect(cookieTheme('a=1; nixgen-theme=light; b=2')).toBe('light')
  })

  it('ignores other values, lookalike names and missing cookies', () => {
    expect(cookieTheme('nixgen-theme=system')).toBeNull()
    expect(cookieTheme('nixgen-theme=')).toBeNull()
    expect(cookieTheme('xnixgen-theme=dark')).toBeNull()
    expect(cookieTheme('a=1;nixgen-theme=dark')).toBeNull()
    expect(cookieTheme('')).toBeNull()
    expect(cookieTheme(null)).toBeNull()
  })
})

describe('resolveThemeMode', () => {
  it("falls back to 'system' with nothing stored", () => {
    expect(resolveThemeMode(none)).toBe('system')
    expect(resolveThemeMode({ cookie: '', stored: 'bogus', legacy: 'bogus' })).toBe('system')
  })

  it('prefers the cookie over both localStorage keys', () => {
    expect(
      resolveThemeMode({ cookie: 'nixgen-theme=light', stored: 'dark', legacy: 'dark' }),
    ).toBe('light')
  })

  it('then the shared localStorage key', () => {
    expect(resolveThemeMode({ cookie: '', stored: 'dark', legacy: 'light' })).toBe('dark')
    expect(resolveThemeMode({ cookie: 'nixgen-theme=bogus', stored: 'light', legacy: null })).toBe(
      'light',
    )
  })

  it("never reads 'system' from the shared key (the site has no such value)", () => {
    expect(resolveThemeMode({ cookie: '', stored: 'system', legacy: 'dark' })).toBe('dark')
  })

  it('then the legacy DeskDev key, including system', () => {
    expect(resolveThemeMode({ cookie: '', stored: null, legacy: 'dark' })).toBe('dark')
    expect(resolveThemeMode({ cookie: '', stored: null, legacy: 'system' })).toBe('system')
  })
})

describe('isDarkMode', () => {
  it('follows an explicit choice, else the OS', () => {
    expect(isDarkMode('dark', false)).toBe(true)
    expect(isDarkMode('light', true)).toBe(false)
    expect(isDarkMode('system', true)).toBe(true)
    expect(isDarkMode('system', false)).toBe(false)
  })
})

describe('needsMigration', () => {
  it('only when the legacy key alone holds an explicit theme', () => {
    expect(needsMigration({ cookie: '', stored: null, legacy: 'dark' })).toBe(true)
    expect(needsMigration({ cookie: '', stored: null, legacy: 'system' })).toBe(false)
    expect(needsMigration({ cookie: 'nixgen-theme=light', stored: null, legacy: 'dark' })).toBe(
      false,
    )
    expect(needsMigration({ cookie: '', stored: 'light', legacy: 'dark' })).toBe(false)
    expect(needsMigration(none)).toBe(false)
  })
})

describe('themeCookieWrites', () => {
  it('scopes to the parent domain in production only', () => {
    expect(themeCookieDomain('nixgensolutions.com')).toBe('; domain=.nixgensolutions.com')
    expect(themeCookieDomain('workspace.nixgensolutions.com')).toBe(
      '; domain=.nixgensolutions.com',
    )
    expect(themeCookieDomain('localhost')).toBe('')
    expect(themeCookieDomain('nixgensolutions.com.evil.dev')).toBe('')
    expect(themeCookieDomain('notnixgensolutions.com')).toBe('')
  })

  it('writes light/dark with the same attributes as the site', () => {
    expect(themeCookieWrites('dark', 'workspace.nixgensolutions.com')).toEqual([
      'nixgen-theme=dark; path=/; max-age=31536000; SameSite=Lax; domain=.nixgensolutions.com',
    ])
    expect(themeCookieWrites('light', 'localhost')).toEqual([
      'nixgen-theme=light; path=/; max-age=31536000; SameSite=Lax',
    ])
  })

  it("expires the cookie for 'system' — domain and host-only in production", () => {
    expect(themeCookieWrites('system', 'nixgensolutions.com')).toEqual([
      'nixgen-theme=; path=/; max-age=0; SameSite=Lax; domain=.nixgensolutions.com',
      'nixgen-theme=; path=/; max-age=0; SameSite=Lax',
    ])
    expect(themeCookieWrites('system', 'localhost')).toEqual([
      'nixgen-theme=; path=/; max-age=0; SameSite=Lax',
    ])
  })
})

describe('persistThemeMode / readThemeMode', () => {
  beforeEach(() => {
    localStorage.clear()
    clearCookie()
  })
  afterEach(() => {
    localStorage.clear()
    clearCookie()
    vi.restoreAllMocks()
  })

  it('a light/dark choice lands in the cookie and both keys', () => {
    persistThemeMode('dark')
    expect(document.cookie).toContain('nixgen-theme=dark')
    expect(localStorage.getItem(THEME_KEY)).toBe('dark')
    expect(localStorage.getItem(LEGACY_THEME_KEY)).toBe('dark')
    expect(readThemeMode()).toBe('dark')
  })

  it("'system' clears the shared cookie and key, and wins over an old choice", () => {
    persistThemeMode('light')
    persistThemeMode('system')
    expect(document.cookie).not.toContain('nixgen-theme=')
    expect(localStorage.getItem(THEME_KEY)).toBeNull()
    expect(localStorage.getItem(LEGACY_THEME_KEY)).toBe('system')
    expect(readThemeMode()).toBe('system')
  })

  it('a site-side cookie overrides what DeskDev stored', () => {
    persistThemeMode('dark')
    document.cookie = 'nixgen-theme=light; path=/'
    expect(readThemeMode()).toBe('light')
  })

  it('survives blocked storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => persistThemeMode('dark')).not.toThrow()
    expect(readThemeMode()).toBe('dark')
  })
})

describe('READ_THEME_MODE_SCRIPT (pre-paint twin of resolveThemeMode)', () => {
  function runScript(src: ThemeSources): string {
    const fakeDocument = { cookie: src.cookie ?? '' }
    const values: Record<string, string | null> = {
      [THEME_KEY]: src.stored,
      [LEGACY_THEME_KEY]: src.legacy,
    }
    const fakeStorage = { getItem: (k: string) => values[k] ?? null }
    const fn = new Function('document', 'localStorage', `return (${READ_THEME_MODE_SCRIPT})()`)
    return fn(fakeDocument, fakeStorage) as string
  }

  const cookies = [null, '', 'nixgen-theme=light', 'a=1; nixgen-theme=dark', 'nixgen-theme=x']
  const values = [null, 'light', 'dark', 'system', 'bogus']

  it('agrees with resolveThemeMode on every combination', () => {
    for (const cookie of cookies) {
      for (const stored of values) {
        for (const legacy of values) {
          const src = { cookie, stored, legacy }
          expect(runScript(src), JSON.stringify(src)).toBe(resolveThemeMode(src))
        }
      }
    }
  })

  it("falls back to 'system' when cookies and storage both throw", () => {
    const throwing = {
      get cookie(): string {
        throw new Error('blocked')
      },
    }
    const blocked = {
      getItem() {
        throw new Error('blocked')
      },
    }
    const fn = new Function('document', 'localStorage', `return (${READ_THEME_MODE_SCRIPT})()`)
    expect(fn(throwing, blocked)).toBe('system')
  })
})
