import { useEffect, useRef, useState, type PropsWithChildren } from 'react'
import Sidebar from './Sidebar'
import ItemContextMenus from './ItemContextMenus'
import Topbar from './Topbar'
import SpaceRail from './SpaceRail'
import MobileTabBar from './mobile/MobileTabBar'
import OfflineBanner from './mobile/OfflineBanner'
import InstallBanner from './mobile/InstallBanner'
import { WarningCircleIcon } from '@phosphor-icons/react'
import { useKeyboardViewport } from '../pwa/useKeyboardViewport'
import { useIsPhone, useOnline } from '../pwa/useMediaQuery'
import { useStore } from '../store/useStore'
import { NoticePanel, OverlayRoot, Presence, Scrim, SheetPanel } from './motion'

/**
 * A pull where some tables failed keeps their old rows (store hydrate) — say
 * so where the data is, and offer the retry, instead of showing stale figures
 * as if they were current. Offline is the OfflineBanner's job, so this waits
 * for a connection. Same in-flow notice shape as that banner.
 */
function LoadErrorNotice() {
  const failed = useStore((s) => s.loadError)
  const hydrate = useStore((s) => s.hydrate)
  const online = useOnline()
  const [busy, setBusy] = useState(false)
  const show = online && (failed?.length ?? 0) > 0
  const retry = async () => {
    setBusy(true)
    try {
      await hydrate()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div role="status" aria-live="polite" className="shrink-0">
      <Presence initial={false}>
        {show && (
          <NoticePanel
            key="load-error"
            edge="top"
            distance="8px"
            className="flex items-center gap-2 border-b border-ink-600 bg-ink-800 py-1.5 pl-4 pr-2 text-xs text-ink-100 md:pl-6 md:pr-4"
          >
            <WarningCircleIcon size={14} aria-hidden className="shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="min-w-0 flex-1">Some data didn’t load, so parts of this page may be out of date.</span>
            <button
              type="button"
              className="btn-ghost shrink-0 h-7 px-2.5 text-xs pointer-coarse:h-11"
              onClick={retry}
              disabled={busy}
            >
              {busy ? 'Retrying…' : 'Retry'}
            </button>
          </NoticePanel>
        )}
      </Presence>
    </div>
  )
}

export default function Layout({
  title,
  subtitle,
  subtitleShort,
  bare,
  immersive,
  children,
}: PropsWithChildren<{
  title: string
  /** A count or a short description under the title; none leaves the title alone. */
  subtitle?: string
  /** Phones show this instead of `subtitle` (a sentence that doesn't fit is left out there). */
  subtitleShort?: string
  /** Full-bleed, non-scrolling main area — the page manages its own panes (Messages). */
  bare?: boolean
  /**
   * Phones only: an open conversation or room owns the screen. The Topbar and
   * tab bar step aside, and the page's own header becomes the top bar.
   */
  immersive?: boolean
}>) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const drawerRef = useRef<HTMLDivElement>(null)
  // Taken at the tap, before the column goes inert and the browser drops focus.
  const openerRef = useRef<HTMLElement | null>(null)
  const isPhone = useIsPhone()
  // The drawer only exists below md (md:hidden); past that, nothing is behind it.
  const drawerShown = drawerOpen && isPhone
  useKeyboardViewport()

  // The drawer is a dialog: focus moves in, Escape closes it, and focus goes
  // back to whatever opened it (the More tab). The column behind it is inert
  // meanwhile, so Tab can't wander out to controls under the scrim.
  useEffect(() => {
    if (!drawerOpen) return
    const opener = openerRef.current
    drawerRef.current?.querySelector<HTMLElement>('[data-drawer-close]')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (opener && document.contains(opener)) opener.focus()
    }
  }, [drawerOpen])

  return (
    // --app-h is 100dvh, or the visible height while the iOS keyboard is open.
    <div className="flex h-(--app-h) overflow-hidden pl-(--safe-left) pr-(--safe-right)">
      {/* First tab stop: past the sidebar and the top bar (about twenty
          stops) straight to the page. Visible only while it has focus. */}
      <a
        href="#dd-main"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-3 focus-visible:top-[calc(var(--safe-top)+0.75rem)] focus-visible:z-50 focus-visible:rounded-md focus-visible:border focus-visible:border-ink-600 focus-visible:bg-ink-800 focus-visible:px-3 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium focus-visible:text-ink-50 focus-visible:shadow-(--shadow-2)"
        onClick={(e) => {
          // Focus, not a hash change: the router owns the URL.
          e.preventDefault()
          document.getElementById('dd-main')?.focus()
        }}
      >
        Skip to content
      </a>
      <SpaceRail />
      <ItemContextMenus />
      {/* Desktop sidebar */}
      <Sidebar className="hidden md:flex" />
      {/* Mobile drawer — the More tab opens it. It slides in from the left edge
          and leaves the same way; swipe it left (or flick) to dismiss. */}
      <Presence>
        {drawerOpen && (
          <OverlayRoot
            key="drawer"
            ref={drawerRef}
            className="fixed inset-0 z-50 md:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
          >
            <Scrim onClick={() => setDrawerOpen(false)} />
            <SheetPanel
              edge="left"
              onDismiss={() => setDrawerOpen(false)}
              className="absolute inset-y-0 left-0 flex max-w-[85vw] shadow-(--shadow-3)"
            >
              <Sidebar
                className="flex pl-(--safe-left)"
                onNavigate={() => setDrawerOpen(false)}
                onClose={() => setDrawerOpen(false)}
                showRailItems
              />
            </SheetPanel>
          </OverlayRoot>
        )}
      </Presence>

      <div className="flex-1 min-w-0 flex flex-col overflow-hidden" inert={drawerShown}>
        {/* Immersive pages lose the Topbar on phones, so something has to clear the status bar. */}
        {immersive && <div className="md:hidden shrink-0 h-(--safe-top) bg-ink-850" aria-hidden />}
        <Topbar
          className={immersive ? 'max-md:hidden' : undefined}
          title={title}
          subtitle={subtitle}
          subtitleShort={subtitleShort}
        />
        <OfflineBanner />
        <LoadErrorNotice />
        {/* An open conversation owns the phone screen; the offer waits for the list. */}
        <div className={immersive ? 'shrink-0 max-md:hidden' : 'shrink-0'}>
          <InstallBanner />
        </div>
        <main
          id="dd-main"
          // The skip link's target: focusable from script only, and a
          // container, so it shows no ring of its own.
          tabIndex={-1}
          // animate-route: the new page's content arrives with a 120ms opacity
          // fade (tens a day — near-imperceptible; none from the keyboard).
          className={
            bare
              ? 'flex-1 min-h-0 overflow-hidden animate-route outline-hidden focus-visible:ring-0 focus-visible:ring-offset-0'
              : 'flex-1 min-h-0 overflow-y-auto overscroll-y-contain p-4 md:p-6 xl:px-8 xl:pt-7 animate-route outline-hidden focus-visible:ring-0 focus-visible:ring-offset-0'
          }
        >
          {children}
        </main>
        {/* In normal flow, so main simply ends above it — no z-index, no padding hacks. */}
        <MobileTabBar
          className={immersive ? 'hidden' : undefined}
          onMore={() => {
            openerRef.current = document.activeElement as HTMLElement | null
            setDrawerOpen(true)
          }}
          moreOpen={drawerOpen}
        />
      </div>

      {/* Discord-style rail — messages, the studio and every client — right edge, desktop only. */}
    </div>
  )
}
