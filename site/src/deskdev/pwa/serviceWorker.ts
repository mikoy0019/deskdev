// Web-only (not mirrored to mobile). Registers DeskDev's service worker and
// runs the update flow: notice a new build, let the user reload into it, and
// recover when a deploy has removed the chunks this page still asks for.
//
// Page ↔ worker protocol (the worker source is pwa/sw/sw.js, served by the
// app/workspace/sw.js route): the page posts {type:'SKIP_WAITING'} and
// {type:'CACHE_URLS', urls}; the worker posts {type:'deskdev:navigate', url}.
import { useSyncExternalStore } from 'react'
import { BASE_PATH } from '../lib/basePath'

/**
 * Same path on every host. The route sends Service-Worker-Allowed: / because
 * the scope is wider than the script's directory.
 */
export const SW_URL = '/workspace/sw.js'

/**
 * DeskDev's URL space: '/workspace' — no trailing slash, since Next.js
 * 308-redirects '/workspace/' and scopes are plain prefix matches — or '/' on
 * the workspace subdomain.
 */
export function swScope(): string {
  return BASE_PATH || '/'
}

const UPDATE_THROTTLE_MS = 30 * 60 * 1000
const UPDATE_INTERVAL_MS = 60 * 60 * 1000
const RELOAD_FALLBACK_MS = 3000
const REGISTRATION_WAIT_MS = 3000
const SECOND_WARM_MS = 15_000
const MAX_WARM_URLS = 300
const MAX_EARLY_MESSAGES = 10
const PRELOAD_RELOAD_KEY = 'deskdev:preload-reload'
const PRELOAD_RELOAD_WINDOW_MS = 60_000

let started = false
let registration: ServiceWorkerRegistration | null = null
let pendingRegistration: Promise<ServiceWorkerRegistration | undefined> | null = null
let hadController = false
let updateReady = false
let reloadRequested = false
let reloading = false
let lastUpdateCheck = 0
/** Background chunk prefetches in flight (runBackgroundPrefetch). */
let prefetching = 0
const warmed = new Set<string>()
const updateListeners = new Set<() => void>()

const noop = () => {}

// Seams for the unit tests: jsdom's location.reload can't be stubbed, and the
// NODE_ENV check is a literal the bundler inlines.
let reloadPage: () => void = () => window.location.reload()
let isProductionBuild = () => process.env.NODE_ENV === 'production'
export function __setTestHooks(hooks: { reload?: () => void; production?: boolean }): void {
  if (hooks.reload) reloadPage = hooks.reload
  if (hooks.production !== undefined) {
    const production = hooks.production
    isProductionBuild = () => production
  }
}

function container(): ServiceWorkerContainer | null {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
  return navigator.serviceWorker ?? null
}

function setUpdateReady(value: boolean): void {
  if (updateReady === value) return
  updateReady = value
  updateListeners.forEach((listener) => listener())
}

function reloadOnce(): void {
  if (reloading) return
  reloading = true
  reloadPage()
}

function onControllerChange(): void {
  if (reloadRequested) {
    reloadOnce()
    return
  }
  // The first worker claiming this page isn't an update: the page already
  // runs the build that worker came with.
  if (!hadController) {
    hadController = true
    return
  }
  // Another tab let a new build take over; this page still runs the old one.
  setUpdateReady(true)
}

/** Runs `run` once the registration has an active worker (never if it goes redundant). */
function whenActive(reg: ServiceWorkerRegistration, run: (worker: ServiceWorker) => void): void {
  if (reg.active) {
    run(reg.active)
    return
  }
  const pending = reg.installing ?? reg.waiting
  if (!pending) return
  const onState = () => {
    if (pending.state !== 'activated' && pending.state !== 'redundant') return
    pending.removeEventListener('statechange', onState)
    if (pending.state === 'activated') run(pending)
  }
  pending.addEventListener('statechange', onState)
}

/** Same-origin build chunks this page has loaded or links to. */
function loadedStaticUrls(): string[] {
  const candidates: string[] = []
  try {
    for (const entry of performance.getEntriesByType('resource')) candidates.push(entry.name)
  } catch {
    // No Resource Timing — the document's own tags still cover the entry chunks.
  }
  document.querySelectorAll<HTMLScriptElement>('script[src]').forEach((el) => candidates.push(el.src))
  document.querySelectorAll<HTMLLinkElement>('link[href]').forEach((el) => candidates.push(el.href))

  const origin = window.location.origin
  const urls = new Set<string>()
  for (const raw of candidates) {
    try {
      const url = new URL(raw, origin)
      if (url.origin === origin && url.pathname.startsWith('/_next/static/')) urls.add(`${url.origin}${url.pathname}${url.search}`)
    } catch {
      // Not a URL — skip it.
    }
  }
  return [...urls].slice(0, MAX_WARM_URLS)
}

/**
 * Hands the worker the chunks this page already loaded. On a first visit they
 * were fetched before the worker existed, so without this the first offline
 * launch would miss them.
 */
function warmCache(worker: ServiceWorker | null | undefined): void {
  if (!worker) return
  const urls = loadedStaticUrls().filter((url) => !warmed.has(url))
  if (urls.length === 0) return
  urls.forEach((url) => warmed.add(url))
  worker.postMessage({ type: 'CACHE_URLS', urls })
}

function checkForUpdate(): void {
  const reg = registration
  if (!reg) return
  const now = Date.now()
  if (now - lastUpdateCheck < UPDATE_THROTTLE_MS) return
  lastUpdateCheck = now
  try {
    // Offline, or the script didn't fetch: the next resume tries again.
    reg.update().catch(noop)
  } catch {
    // update() throws while the registration is being removed.
  }
}

/**
 * Browsers check for a new worker on navigations, but an iOS home-screen app
 * resumes from a frozen state without one — so check on resume and focus too,
 * and hourly while the app stays open.
 */
function watchForUpdates(): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate()
  })
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) checkForUpdate()
  })
  window.addEventListener('focus', checkForUpdate)
  window.setInterval(() => {
    if (document.visibilityState === 'visible') checkForUpdate()
  }, UPDATE_INTERVAL_MS)
}

function track(reg: ServiceWorkerRegistration): void {
  registration = reg
  // register() itself just fetched the script.
  lastUpdateCheck = Date.now()
  if (reg.waiting) setUpdateReady(true)
  reg.addEventListener('updatefound', () => {
    const worker = reg.installing
    if (!worker) return
    worker.addEventListener('statechange', () => {
      // Installed while a worker already controls the page: a new build is
      // waiting. Without a controller it's the first install, not an update.
      if (worker.state === 'installed' && container()?.controller) setUpdateReady(true)
    })
  })
  whenActive(reg, (worker) => {
    warmCache(worker)
    // Once more after the idle prefetch of the main tabs (App.tsx).
    window.setTimeout(() => warmCache(registration?.active), SECOND_WARM_MS)
  })
  watchForUpdates()
}

async function unregisterOurs(sw: ServiceWorkerContainer): Promise<void> {
  const scope = new URL(swScope(), window.location.origin).href
  try {
    const regs = await sw.getRegistrations()
    await Promise.all(
      regs
        .filter((reg) => {
          const script = (reg.active ?? reg.waiting ?? reg.installing)?.scriptURL ?? ''
          return reg.scope === scope || script.endsWith(SW_URL)
        })
        .map((reg) => reg.unregister()),
    )
  } catch {
    // Storage blocked — nothing is registered then either.
  }
}

function claimPreloadReload(): boolean {
  try {
    const now = Date.now()
    const last = Number(window.sessionStorage.getItem(PRELOAD_RELOAD_KEY)) || 0
    if (Math.abs(now - last) < PRELOAD_RELOAD_WINDOW_MS) return false
    window.sessionStorage.setItem(PRELOAD_RELOAD_KEY, String(now))
    return true
  } catch {
    // No storage means no loop guard, so never reload on our own.
    return false
  }
}

/**
 * A lazy chunk failed to load — almost always a deploy that removed the old
 * hashed files this page still references. Reload into the new build, at most
 * once a minute. When we won't reload (offline, or we just did) the event is
 * left alone so the original error reaches the error boundary.
 */
function onPreloadError(event: Event): void {
  // A prefetch nobody asked for must not reload the page under the user. Its
  // error goes to the prefetch's own catch; if the chunk really is gone, the
  // route's import fails again when they open it and recovers then.
  if (prefetching > 0) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  if (!claimPreloadReload()) return
  event.preventDefault()
  if (registration?.waiting) applyUpdate()
  // Not reloadOnce(): the minute guard above already bounds this, and a reload
  // the browser didn't carry out (a beforeunload prompt) must not block the next.
  else reloadPage()
}

/**
 * Warms lazy chunks in the background (the main tabs after sign-in). A chunk
 * that fails here is dropped silently instead of triggering the reload above.
 */
export function runBackgroundPrefetch(loaders: Array<() => Promise<unknown>>): void {
  prefetching++
  void Promise.allSettled(
    loaders.map((load) => {
      try {
        return load()
      } catch (err) {
        return Promise.reject(err)
      }
    }),
  ).finally(() => {
    prefetching--
  })
}

/**
 * Registers the worker — production builds only (next dev serves modules
 * outside /_next/static and has no worker route). Idempotent. A `?nosw` in the
 * URL unregisters it instead: the escape hatch for a broken worker.
 */
export function registerServiceWorker(): void {
  if (started || typeof window === 'undefined') return
  started = true
  window.addEventListener('vite:preloadError', onPreloadError)

  const sw = container()
  if (!sw) return
  if (new URLSearchParams(window.location.search).has('nosw')) {
    void unregisterOurs(sw)
    return
  }
  if (!isProductionBuild()) return

  hadController = Boolean(sw.controller)
  sw.addEventListener('controllerchange', onControllerChange)
  listenForMessages()

  const register = () => {
    pendingRegistration = sw
      .register(SW_URL, { scope: swScope(), updateViaCache: 'none' })
      .then((reg) => {
        track(reg)
        return reg
      })
      .catch((error: unknown) => {
        console.warn('[deskdev] service worker registration failed', error)
        return undefined
      })
  }
  // Don't compete with the page's own first requests.
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}

/**
 * The app's registration, or undefined when there is none. Waits briefly for
 * a first install to activate (showNotification and pushManager.subscribe need
 * an active worker), but always settles — navigator.serviceWorker.ready never
 * resolves when nothing is registered.
 */
export function getRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  const sw = container()
  if (!sw) return Promise.resolve(undefined)
  if (registration?.active) return Promise.resolve(registration)

  let found: ServiceWorkerRegistration | undefined = registration ?? undefined
  const lookup = (async () => {
    if (!found && pendingRegistration) found = await pendingRegistration
    if (!found) found = (await sw.getRegistration(window.location.href)) ?? undefined
    const reg = found
    if (reg && !reg.active) await new Promise<void>((resolve) => whenActive(reg, () => resolve()))
    return reg
  })()

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(found), REGISTRATION_WAIT_MS)
    lookup.then(
      (reg) => {
        clearTimeout(timer)
        resolve(reg)
      },
      () => {
        clearTimeout(timer)
        resolve(found)
      },
    )
  })
}

/**
 * Moves to the waiting build: tells the waiting worker to take over and
 * reloads exactly once when it does (or after a short fallback, in case
 * another tab already activated it).
 */
export function applyUpdate(): void {
  const waiting = registration?.waiting
  if (!waiting) {
    reloadOnce()
    return
  }
  reloadRequested = true
  waiting.postMessage({ type: 'SKIP_WAITING' })
  window.setTimeout(reloadOnce, RELOAD_FALLBACK_MS)
}

function subscribeUpdate(listener: () => void): () => void {
  updateListeners.add(listener)
  return () => updateListeners.delete(listener)
}

const getUpdateReady = () => updateReady
const getServerUpdateReady = () => false

/** updateReady: a new build is installed and waiting for a reload. */
export function useServiceWorkerUpdate(): { updateReady: boolean; applyUpdate: () => void } {
  const ready = useSyncExternalStore(subscribeUpdate, getUpdateReady, getServerUpdateReady)
  return { updateReady: ready, applyUpdate }
}

// Messages from the worker. One listener for the page's life; anything that
// arrives before the app subscribes (a notification tap racing the first
// render) is kept and handed to the first subscriber.
type MessageHandler = (data: unknown) => void
const messageHandlers = new Set<MessageHandler>()
let earlyMessages: unknown[] | null = []
let listening = false

function listenForMessages(): void {
  const sw = container()
  if (listening || !sw) return
  listening = true
  sw.addEventListener('message', (event: MessageEvent) => {
    if (messageHandlers.size > 0) messageHandlers.forEach((handler) => handler(event.data))
    else if (earlyMessages && earlyMessages.length < MAX_EARLY_MESSAGES) earlyMessages.push(event.data)
  })
}

/** Subscribes to messages from the service worker; returns the unsubscribe. */
export function onServiceWorkerMessage(handler: MessageHandler): () => void {
  if (!container()) return noop
  listenForMessages()
  messageHandlers.add(handler)
  const early = earlyMessages
  earlyMessages = null
  early?.forEach((data) => handler(data))
  return () => {
    messageHandlers.delete(handler)
  }
}

// Start listening as soon as DeskDev's code loads, ahead of the first render.
listenForMessages()
