import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useMediaQuery } from '../pwa/useMediaQuery'
import { syncThemeColor } from './themeColor'
import {
  LEGACY_THEME_KEY,
  THEME_KEY,
  isDarkMode,
  needsMigration,
  persistThemeMode,
  readThemeMode,
  readThemeSources,
  resolveThemeMode,
  type ThemeMode,
} from './themeStorage'

export type { ThemeMode }

// Storage and resolution live in themeStorage.ts, shared with the site's
// `nixgen-theme` cookie; the workspace layout's pre-paint script embeds the
// same resolution, so the first paint already matches what this picks.
const MEDIA_QUERY = '(prefers-color-scheme: dark)'

interface ThemeContextValue {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
  isDark: boolean
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readThemeMode)
  // Live OS preference; only consulted in system mode.
  const systemDark = useMediaQuery(MEDIA_QUERY)
  const isDark = isDarkMode(mode, systemDark)

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next)
    persistThemeMode(next)
  }, [])

  // A choice saved before the site shared the theme sits only under the legacy
  // key: publish it once so the site follows it too.
  useEffect(() => {
    const sources = readThemeSources()
    if (needsMigration(sources)) persistThemeMode(resolveThemeMode(sources))
  }, [])

  // Follow a choice made elsewhere: another tab (storage event) or the site on
  // another subdomain (a cookie change fires nothing, so re-read on return).
  useEffect(() => {
    const resync = () => setModeState(readThemeMode())
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === THEME_KEY || e.key === LEGACY_THEME_KEY) resync()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') resync()
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', resync)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', resync)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  // Apply/remove the .dark class whenever the resolved theme changes (a mode
  // switch, or the OS flipping while in system mode), then repaint the browser
  // chrome to match the in-app theme rather than the OS one.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
    syncThemeColor(isDark)
  }, [isDark])

  const value = useMemo(() => ({ mode, setMode, isDark }), [mode, setMode, isDark])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return ctx
}
