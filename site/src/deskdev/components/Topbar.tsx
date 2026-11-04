import { useLayoutEffect, useRef, useState } from 'react'
import { CaretLeftIcon, MagnifyingGlassIcon, MonitorIcon, MoonIcon, SunIcon } from '@phosphor-icons/react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTheme, type ThemeMode } from '../theme/ThemeContext'
import { OPEN_EVENT, SearchTrigger } from './ui-foundation/CommandPalette'
import { DensityToggle } from './ui-foundation/DensityProvider'
import NotificationsBell from './NotificationsBell'
import MessagesButton from './messages/MessagesButton'
import { backTargetFor } from './mobile/shellNav'
import { useIsPhone } from '../pwa/useMediaQuery'
import { classNames } from '../lib/format'

const NEXT_MODE: Record<ThemeMode, ThemeMode> = {
  light: 'dark',
  dark: 'system',
  system: 'light',
}

// 44px in px, not rem: compact density shrinks the root size.
const phoneIconButton =
  'pressable md:hidden size-[44px] shrink-0 flex items-center justify-center rounded-lg text-ink-200 hover:text-ink-50 hover:bg-ink-700 active:bg-ink-700'

/**
 * The line under the title. On a phone there is room for a count ("14 tasks
 * on the board") but not for a sentence, and a sentence cut mid-word reads as
 * a bug: a line that would not fit is left out there, and the title centres.
 * It stays in the box (zero height, invisible) so it can be measured again
 * when the bar gets wider.
 */
function Subtitle({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [cut, setCut] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    // Fires once on observe, then whenever the bar's width changes.
    const observer = new ResizeObserver(() => setCut(el.scrollWidth > el.clientWidth + 1))
    observer.observe(el)
    return () => observer.disconnect()
  }, [text])
  return (
    <p
      ref={ref}
      className={classNames(
        'mt-0.5 text-xs text-ink-300 leading-tight truncate tabular-nums',
        cut && 'max-md:invisible max-md:mt-0 max-md:h-0',
      )}
    >
      {text}
    </p>
  )
}

export default function Topbar({
  title,
  subtitle,
  subtitleShort,
  className,
}: {
  title: string
  /** A count or a short description under the title. None: the title stands alone. */
  subtitle?: string
  /** Shown instead of `subtitle` on phones, where a sentence does not fit. */
  subtitleShort?: string
  className?: string
}) {
  const { mode, setMode } = useTheme()
  const location = useLocation()
  const navigate = useNavigate()
  const backTo = backTargetFor(location.pathname)
  const isPhone = useIsPhone()
  const line = isPhone ? (subtitleShort ?? subtitle) : subtitle

  const ThemeIcon = mode === 'light' ? SunIcon : mode === 'dark' ? MoonIcon : MonitorIcon

  // An installed iOS app has no browser back button: retrace in-app history
  // when there is some, otherwise go up to the list (a deep link, a fresh launch).
  const goBack = () => {
    if (location.key !== 'default') navigate(-1)
    else if (backTo) navigate(backTo, { replace: true })
  }

  return (
    // ink-850 is also the status-bar colour (theme/themeColor.ts), so the bar is
    // that token, solid: nothing scrolls under it (main is its own scroller),
    // so a translucent blur would only cost a compositing layer.
    <header className={classNames('shrink-0 pt-(--safe-top) border-b border-ink-600 bg-ink-850', className)}>
      <div className="h-14 md:h-16 px-4 md:px-6 xl:px-8 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1 min-w-0">
          {backTo && (
            <button type="button" className={classNames(phoneIconButton, '-ml-3')} onClick={goBack} aria-label="Back">
              <CaretLeftIcon size={22} aria-hidden />
            </button>
          )}
          <div className="min-w-0">
            <h1 className="font-display text-[17px] md:text-lg font-semibold tracking-[-0.02em] text-ink-50 leading-tight truncate">
              {title}
            </h1>
            {/* No date fallback: Home shows the date in its body, and a screen
                without a count or description simply has a title. */}
            {line && <Subtitle text={line} />}
          </div>
        </div>

        <div className="flex items-center gap-1.5 max-md:gap-0 shrink-0 max-md:-mr-2">
          {/* Phones: the Chat tab replaces Messages, Settings → Appearance holds
              density and theme, and search is an icon. */}
          <SearchTrigger className="max-md:hidden" />

          <div className="hidden md:block w-px h-5 bg-ink-600 mx-1" aria-hidden />

          <button
            type="button"
            className={phoneIconButton}
            // Dispatched inside the tap, so the palette can focus its input
            // while iOS still allows the keyboard to open.
            onClick={() => window.dispatchEvent(new CustomEvent(OPEN_EVENT))}
            aria-label="Search records, actions and pages"
          >
            <MagnifyingGlassIcon size={19} aria-hidden />
          </button>

          <MessagesButton className="max-md:hidden" />

          <NotificationsBell />

          <DensityToggle className="max-md:hidden" />

          <button
            type="button"
            className="pressable max-md:hidden size-8 pointer-coarse:size-11 flex items-center justify-center rounded-lg text-ink-200 hover:text-ink-50 hover:bg-ink-700"
            title={`Theme: ${mode} (click to switch)`}
            aria-label={`Theme: ${mode}. Click to switch.`}
            onClick={() => setMode(NEXT_MODE[mode])}
          >
            <ThemeIcon size={16} aria-hidden />
          </button>
        </div>
      </div>
    </header>
  )
}
