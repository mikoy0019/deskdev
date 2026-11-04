// Web-only (not mirrored to mobile). Chrome/Edge/Samsung's install prompt.
//
// Chrome fires beforeinstallprompt right after load, before DeskDev (mounted
// client-side by next/dynamic) exists — so an inline script in the workspace
// layout's <head> catches it first: it calls preventDefault() (no mini-infobar),
// stashes the event on window.__ddBip and dispatches 'dd:bip'; appinstalled sets
// window.__ddInstalled and dispatches 'dd:appinstalled'. This module adopts
// whatever the script caught and keeps listening.
import { useSyncExternalStore } from 'react'
import { useIsStandalone } from './useMediaQuery'

/** Not in lib.dom — Chromium-only and non-standard. */
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: readonly string[]
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
  prompt(): Promise<unknown>
}

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable'

type InstallWindow = Window & {
  __ddBip?: BeforeInstallPromptEvent
  __ddInstalled?: boolean
}

interface InstallState {
  canPrompt: boolean
  installed: boolean
}

let initialized = false
let deferred: BeforeInstallPromptEvent | null = null
let installed = false
let state: InstallState = { canPrompt: false, installed: false }
const listeners = new Set<() => void>()

function publish(): void {
  const canPrompt = deferred !== null
  if (state.canPrompt === canPrompt && state.installed === installed) return
  state = { canPrompt, installed }
  listeners.forEach((listener) => listener())
}

function offer(event: BeforeInstallPromptEvent | null | undefined): void {
  if (!event || event === deferred) return
  deferred = event
  // Chrome only offers an app it doesn't consider installed — e.g. after the
  // user uninstalled it while this page stayed open.
  installed = false
  publish()
}

function markInstalled(): void {
  installed = true
  deferred = null
  const w = window as InstallWindow
  w.__ddBip = undefined
  publish()
}

function onNativePrompt(event: Event): void {
  // Normally the <head> script got here first; this covers a document served
  // without it (an old cached page). Either way Chrome must not show its own UI.
  event.preventDefault()
  offer(event as BeforeInstallPromptEvent)
}

/** Idempotent. Call once at startup, before the first render. */
export function initInstallPrompt(): void {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  const w = window as InstallWindow
  if (w.__ddInstalled) installed = true
  else if (w.__ddBip) deferred = w.__ddBip
  window.addEventListener('dd:bip', () => offer(w.__ddBip))
  window.addEventListener('dd:appinstalled', markInstalled)
  window.addEventListener('beforeinstallprompt', onNativePrompt)
  window.addEventListener('appinstalled', markInstalled)
  publish()
}

/**
 * Shows the browser's install dialog. Call it straight from a click handler:
 * prompt() needs the click's user activation, so nothing may be awaited first.
 * 'accepted' means the install STARTED — on Android the icon lands a few
 * seconds later, once the WebAPK is minted. 'unavailable' when there is no
 * prompt to show (Safari, Firefox, already installed, or the event was used).
 */
export function promptInstall(): Promise<InstallOutcome> {
  const event = deferred
  if (!event) return Promise.resolve('unavailable')
  // An event shows its dialog once; Chrome sends a fresh one after a dismissal.
  deferred = null
  const w = window as InstallWindow
  if (w.__ddBip === event) w.__ddBip = undefined
  publish()

  // Without user activation prompt() rejects and the event stays usable, so
  // put it back unless a newer one has arrived meanwhile.
  const restore = () => {
    if (deferred === null && !installed) {
      deferred = event
      publish()
    }
  }

  let shown: Promise<unknown>
  try {
    shown = Promise.resolve(event.prompt())
  } catch {
    restore()
    return Promise.resolve('unavailable')
  }
  return new Promise<InstallOutcome>((resolve) => {
    shown.catch(() => {
      restore()
      resolve('unavailable')
    })
    event.userChoice.then(
      (choice) => resolve(choice.outcome === 'accepted' ? 'accepted' : 'dismissed'),
      () => resolve('unavailable'),
    )
  })
}

function subscribe(listener: () => void): () => void {
  initInstallPrompt()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const getSnapshot = () => state
const serverSnapshot: InstallState = { canPrompt: false, installed: false }
const getServerSnapshot = () => serverSnapshot

/**
 * canPrompt: an install dialog can be shown now (Chromium only). installed:
 * this is the installed app, or the app was installed from this page.
 */
export function useInstallPrompt(): {
  canPrompt: boolean
  installed: boolean
  promptInstall: () => Promise<InstallOutcome>
} {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const standalone = useIsStandalone()
  return {
    canPrompt: snapshot.canPrompt && !standalone,
    installed: snapshot.installed || standalone,
    promptInstall,
  }
}
