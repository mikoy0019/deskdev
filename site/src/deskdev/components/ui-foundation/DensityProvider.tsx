import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { RowsIcon, TextAlignJustifyIcon } from '@phosphor-icons/react'
import { classNames } from '../../lib/format'

/**
 * Density — comfortable | compact. Persisted to localStorage and reflected as
 * `data-density` on <html>; the CSS in index.css retunes the 4px rhythm and
 * drops the base type a notch in compact. Mirrors the ThemeProvider shape.
 */

export type Density = 'comfortable' | 'compact'

const STORAGE_KEY = 'deskdev-density'

interface DensityContextValue {
  density: Density
  setDensity: (d: Density) => void
  toggleDensity: () => void
}

const DensityContext = createContext<DensityContextValue | undefined>(undefined)

function readStored(): Density {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'comfortable' || v === 'compact') return v
  } catch {
    // localStorage unavailable — fall through
  }
  return 'comfortable'
}

function apply(density: Density): void {
  document.documentElement.setAttribute('data-density', density)
}

export function DensityProvider({ children }: { children: ReactNode }) {
  const [density, setDensityState] = useState<Density>(readStored)

  const setDensity = useCallback((next: Density) => {
    setDensityState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // ignore persistence failures
    }
  }, [])

  const toggleDensity = useCallback(() => {
    setDensityState((prev) => {
      const next = prev === 'compact' ? 'comfortable' : 'compact'
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // ignore
      }
      return next
    })
  }, [])

  useEffect(() => {
    apply(density)
  }, [density])

  const value = useMemo(
    () => ({ density, setDensity, toggleDensity }),
    [density, setDensity, toggleDensity],
  )

  return <DensityContext.Provider value={value}>{children}</DensityContext.Provider>
}

export function useDensity(): DensityContextValue {
  const ctx = useContext(DensityContext)
  if (!ctx) throw new Error('useDensity must be used within a DensityProvider')
  return ctx
}

/** Topbar affordance — toggles between comfortable and compact. */
export function DensityToggle({ className }: { className?: string }) {
  const { density, toggleDensity } = useDensity()
  const compact = density === 'compact'
  const Icon = compact ? TextAlignJustifyIcon : RowsIcon
  return (
    <button
      type="button"
      onClick={toggleDensity}
      title={`Density: ${density} (click for ${compact ? 'comfortable' : 'compact'})`}
      aria-label={`Switch to ${compact ? 'comfortable' : 'compact'} density`}
      className={classNames(
        'pressable p-2 pointer-coarse:p-3.5 rounded-lg text-ink-200 hover:text-ink-50 hover:bg-ink-700',
        className,
      )}
    >
      <Icon size={16} aria-hidden />
    </button>
  )
}
