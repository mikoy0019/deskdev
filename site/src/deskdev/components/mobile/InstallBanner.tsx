import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { XIcon } from '@phosphor-icons/react'
import { useStore } from '../../store/useStore'
import { assetUrl } from '../../lib/basePath'
import { useInstallPrompt } from '../../pwa/install'
import { useIsPhone, useIsStandalone } from '../../pwa/useMediaQuery'
import { BANNER_DISMISS_KEY, bannerSnoozed } from '../../pwa/installGuides'

// Every page renders its own Layout, so the banner remounts on each route.
// This keeps a dismissal (or a started install) for the page's lifetime even
// when storage is blocked.
let hiddenThisVisit = false

function readSnoozed(): boolean {
  if (hiddenThisVisit) return true
  try {
    return bannerSnoozed(window.localStorage.getItem(BANNER_DISMISS_KEY), Date.now())
  } catch {
    // Storage blocked (private mode, strict settings): show it, it's dismissable.
    return false
  }
}

function snooze(): void {
  hiddenThisVisit = true
  try {
    window.localStorage.setItem(BANNER_DISMISS_KEY, String(Date.now()))
  } catch {
    // Not persisted; hiddenThisVisit still covers this visit.
  }
}

/**
 * "Get the DeskDev app" — a slim in-flow row under the Topbar, phones only, in
 * the browser only. Install opens the browser's dialog where there is one
 * (Chrome, Samsung, Edge) and the step-by-step page everywhere else, including
 * in-app browsers, which /install explains how to leave. Dismissed, it stays
 * away for 14 days.
 */
export default function InstallBanner() {
  const isPhone = useIsPhone()
  const standalone = useIsStandalone()
  const signedIn = useStore((s) => s.currentUserId !== null)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { canPrompt, installed, promptInstall } = useInstallPrompt()
  const [hidden, setHidden] = useState(readSnoozed)

  if (!isPhone || standalone || installed || hidden || !signedIn || pathname === '/install') return null

  const install = () => {
    if (!canPrompt) {
      navigate('/install')
      return
    }
    // Straight from the click: prompt() needs its user activation.
    void promptInstall().then((result) => {
      if (result === 'accepted') {
        hiddenThisVisit = true
        setHidden(true)
        toast.success('Installing — DeskDev will appear on your home screen in a few seconds')
      } else if (result === 'unavailable') navigate('/install')
    })
  }

  const dismiss = () => {
    snooze()
    setHidden(true)
  }

  return (
    <aside
      aria-label="Install the DeskDev app"
      // No entrance: every page renders its own Layout, so an animation here
      // would replay on each route change. It arrives with the page.
      className="shrink-0 border-b border-ink-600 bg-ink-800 md:hidden"
    >
      <div className="flex items-center gap-3 py-1.5 pl-4 pr-1">
        {/* eslint-disable-next-line @next/next/no-img-element -- client-only SPA; a fixed 192px PNG from public/, nothing to optimise */}
        <img
          src={assetUrl('/icons/icon-192.png')}
          alt=""
          width={36}
          height={36}
          className="h-9 w-9 shrink-0 rounded-[22%]"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink-50">Get the DeskDev app</p>
          <p className="truncate text-xs text-ink-300">Full-screen, with notifications</p>
        </div>
        {/* 36px for a mouse; `btn` raises it to 44px under a finger. */}
        <button
          type="button"
          className="btn-primary pointer-fine:h-9 shrink-0 px-3.5"
          onClick={install}
        >
          Install
        </button>
        <button
          type="button"
          className="pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-300 hover:bg-ink-700 hover:text-ink-50"
          onClick={dismiss}
          aria-label="Dismiss for two weeks"
        >
          <XIcon size={18} aria-hidden />
        </button>
      </div>
    </aside>
  )
}
