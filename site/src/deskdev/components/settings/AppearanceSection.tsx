import type { ReactNode } from 'react'
import { type Icon, MonitorIcon, MoonIcon, RowsIcon, SunIcon, TextAlignJustifyIcon } from '@phosphor-icons/react'
import { useTheme, type ThemeMode } from '../../theme/ThemeContext'
import { useDensity, type Density } from '../ui-foundation/DensityProvider'
import { classNames } from '../../lib/format'
import { IndicatorGroup, LayoutIndicator } from '../motion'
import { Panel, radioKeys } from './formKit'

const MODES: { id: ThemeMode; label: string; hint: string; icon: Icon }[] = [
  { id: 'light', label: 'Light', hint: 'Bright surfaces, dark text', icon: SunIcon },
  { id: 'dark', label: 'Dark', hint: 'The original DeskDev look', icon: MoonIcon },
  { id: 'system', label: 'System', hint: 'Follow your OS preference', icon: MonitorIcon },
]

const DENSITIES: { id: Density; label: string; hint: string; icon: Icon }[] = [
  { id: 'comfortable', label: 'Comfortable', hint: 'Roomier rows and larger type', icon: RowsIcon },
  { id: 'compact', label: 'Compact', hint: 'More on screen at once', icon: TextAlignJustifyIcon },
]

// The two themes' own page / card / hairline / ink values (index.css), fixed
// here so each preview shows its theme whatever the current one is.
const PALETTE = {
  light: { page: '#f5f6f8', card: '#ffffff', line: '#e1e5ec', ink: '#0c0f17', muted: '#c9ced8' },
  dark: { page: '#0a0c12', card: '#11141d', line: '#222735', ink: '#f3f5fa', muted: '#2c3242' },
} as const

/** A miniature DeskDev window in one theme: sidebar, title bar, two rows. */
function MiniWindow({ theme, className }: { theme: 'light' | 'dark'; className?: string }) {
  const p = PALETTE[theme]
  return (
    <div className={classNames('flex h-full', className)} style={{ background: p.page }}>
      <div className="w-1/4 border-r" style={{ background: p.card, borderColor: p.line }}>
        <div className="mx-1.5 mt-2 h-1.5 w-3 rounded-full bg-brand-600" />
        <div className="mx-1.5 mt-2 h-1 rounded-full" style={{ background: p.muted }} />
        <div className="mx-1.5 mt-1 h-1 w-2/3 rounded-full" style={{ background: p.muted }} />
      </div>
      <div className="flex-1 p-2">
        <div className="h-1.5 w-1/2 rounded-full" style={{ background: p.ink, opacity: 0.85 }} />
        <div className="mt-2 rounded-[3px] border p-1.5" style={{ background: p.card, borderColor: p.line }}>
          <div className="h-1 w-3/4 rounded-full" style={{ background: p.muted }} />
          <div className="mt-1 h-1 w-1/2 rounded-full" style={{ background: p.muted }} />
        </div>
      </div>
    </div>
  )
}

function ThemePreview({ mode }: { mode: ThemeMode }) {
  if (mode === 'system') {
    // Half and half on a diagonal: follows whichever the OS says.
    return (
      <div className="relative h-full">
        <MiniWindow theme="light" className="absolute inset-0" />
        <MiniWindow theme="dark" className="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]" />
      </div>
    )
  }
  return <MiniWindow theme={mode} />
}

/** Rows at the two densities, drawn in the current theme. */
function DensityPreview({ density }: { density: Density }) {
  const rows = density === 'compact' ? 5 : 3
  return (
    <div className={classNames('flex h-full flex-col justify-center bg-ink-900 px-3', density === 'compact' ? 'gap-1' : 'gap-2.5')}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className={classNames('shrink-0 rounded-full bg-ink-500', density === 'compact' ? 'size-1.5' : 'size-2.5')} />
          <span className={classNames('rounded-full bg-ink-600', density === 'compact' ? 'h-1' : 'h-1.5')} style={{ width: `${70 - i * 9}%` }} />
        </div>
      ))}
    </div>
  )
}

/** One selectable card in a radiogroup: a preview plate, then the label and hint. */
function Choice({
  active, label, hint, icon: Glyph, onSelect, preview, indicator,
}: {
  active: boolean
  label: string
  hint: string
  icon: Icon
  onSelect: () => void
  preview: ReactNode
  /** layoutId shared by the group's selection ring. */
  indicator: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      tabIndex={active ? 0 : -1}
      className={classNames(
        'pressable-card group relative rounded-xl border p-2 text-left',
        active ? 'border-transparent' : 'border-ink-600 hover:border-ink-500',
      )}
      onClick={onSelect}
    >
      {/* The selection ring glides to the picked card (state indication,
          critically damped; instant from the keyboard). */}
      {active && (
        <LayoutIndicator
          layoutId={indicator}
          radius={12}
          className="absolute -inset-px rounded-xl border-2 border-brand-500 bg-brand-500/5"
        />
      )}
      <div className="relative h-20 overflow-hidden rounded-lg border border-ink-600" aria-hidden>
        {preview}
      </div>
      <div className="relative flex items-start gap-2 px-1.5 pb-1 pt-3">
        <Glyph
          size={16}
          weight={active ? 'fill' : 'regular'}
          className={classNames('mt-px shrink-0', active ? 'text-brand-600 dark:text-brand-400' : 'text-ink-300')}
          aria-hidden
        />
        <div className="min-w-0">
          <div className={classNames('text-sm font-semibold', active ? 'text-brand-700 dark:text-brand-400' : 'text-ink-50')}>
            {label}
          </div>
          <div className="mt-0.5 text-xs text-ink-300">{hint}</div>
        </div>
      </div>
    </button>
  )
}

/** Theme and density pickers — both apply instantly. */
export default function AppearanceSection() {
  const { mode, setMode } = useTheme()
  const { density, setDensity } = useDensity()

  return (
    <div className="space-y-5">
      <Panel title="Theme" description="Changes apply immediately as a live preview.">
        <IndicatorGroup id="theme-choice">
          <div
            className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3"
            role="radiogroup"
            aria-label="Theme mode"
            onKeyDown={radioKeys}
          >
            {MODES.map(({ id, label, hint, icon }) => (
              <Choice
                key={id}
                active={mode === id}
                label={label}
                hint={hint}
                icon={icon}
                onSelect={() => setMode(id)}
                preview={<ThemePreview mode={id} />}
                indicator="theme-choice"
              />
            ))}
          </div>
        </IndicatorGroup>
      </Panel>

      {/* The Topbar's density toggle is desktop-only; phones set it here. */}
      <Panel
        title="Density"
        description="How tightly rows, cards and type are packed."
        footer={<p className="mr-auto text-[11px] text-ink-300">Your theme and density are saved on this device only.</p>}
      >
        <IndicatorGroup id="density-choice">
          <div
            className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2"
            role="radiogroup"
            aria-label="Density"
            onKeyDown={radioKeys}
          >
            {DENSITIES.map(({ id, label, hint, icon }) => (
              <Choice
                key={id}
                active={density === id}
                label={label}
                hint={hint}
                icon={icon}
                onSelect={() => setDensity(id)}
                preview={<DensityPreview density={id} />}
                indicator="density-choice"
              />
            ))}
          </div>
        </IndicatorGroup>
      </Panel>
    </div>
  )
}
