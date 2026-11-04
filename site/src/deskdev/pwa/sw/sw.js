// DeskDev's service worker. A plain script — no imports, no bundler: the
// app/workspace/sw.js route serves this file with the build id stamped in, so
// every deploy changes its bytes and browsers install the new worker. The very
// first install takes over at once; later ones wait until the app posts
// SKIP_WAITING (it asks the user first).
//
// It answers DeskDev's pages network-first with an offline fallback, the
// hashed build files cache-first and the brand images stale-while-revalidate,
// and it shows the OS notifications (pushes and their taps). Everything else —
// Supabase and every other origin, RSC and server-action requests, /api — goes
// to the network untouched.

'use strict'

const BUILD_ID = '__DESKDEV_BUILD_ID__'
const STATIC_CACHE = `deskdev-static-${BUILD_ID}`
const PAGES_CACHE = 'deskdev-pages-v1'
const ASSETS_CACHE = 'deskdev-assets-v1'
const OWN_CACHES = [STATIC_CACHE, PAGES_CACHE, ASSETS_CACHE]
const PAGES_LIMIT = 40
const NAVIGATION_TIMEOUT_MS = 4000
const WARM_TIMEOUT_MS = 8000
const MAX_CACHE_URLS = 300
const DEFAULT_ICON = '/workspace/icons/icon-192.png'
const DEFAULT_BADGE = '/workspace/icons/badge-96.png'
// Which build a cached page came from. The HTML names that build's hashed
// chunks, and only that build's static cache holds them.
const BUILD_HEADER = 'X-DeskDev-Build'
// One entry per screen: ?source=pwa and friends don't change the document,
// and Next.js's Vary list (RSC, Next-Router-*) never applies to a cached page.
const PAGE_MATCH = { ignoreSearch: true, ignoreVary: true }
const EXACT_MATCH = { ignoreVary: true }

const ORIGIN = self.location.origin
// '' on DeskDev's own host (scope '/'), '/workspace' where it's a route of the
// site — lib/basePath.ts's split, read back from the scope the app registered.
const BASE = new URL(self.registration.scope).pathname.replace(/\/+$/, '')
const START_URL = ORIGIN + (BASE || '/')

const noop = () => {}

function inScope(pathname) {
  return BASE === '' || pathname === BASE || pathname.startsWith(`${BASE}/`)
}

function isAppUrl(href) {
  try {
    const url = new URL(href)
    return url.origin === ORIGIN && inScope(url.pathname)
  } catch {
    return false
  }
}

function contentType(response) {
  return (response.headers.get('Content-Type') || '').toLowerCase()
}

// A page worth keeping: the real document, not a redirect or an error.
function isPage(response) {
  return response.status === 200 && !response.redirected && contentType(response).includes('text/html')
}

// A missing file under /workspace answers 200 with DeskDev's HTML: never keep that.
function isAsset(response) {
  return response.ok && !contentType(response).includes('text/html')
}

async function openCache(name) {
  try {
    return await caches.open(name)
  } catch {
    return null // Storage blocked or full: serve from the network.
  }
}

async function matchIn(cache, key, options) {
  if (!cache) return undefined
  try {
    return await cache.match(key, options)
  } catch {
    return undefined
  }
}

function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('timed out')), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

// ── Lifecycle ─────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  // An update waits for SKIP_WAITING; the app shows the prompt. A first
  // install has nothing older to wait for.
  if (!self.registration.active) event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Cleanup is best effort: a failure here must not stop the takeover.
      await removeStaleCaches().catch(noop)
      try {
        if (self.registration.navigationPreload) await self.registration.navigationPreload.enable()
      } catch {
        // Not allowed here: navigations simply fetch from the worker.
      }
      await self.clients.claim()
    })(),
  )
})

async function removeStaleCaches() {
  const names = await caches.keys()
  await Promise.all(
    names
      .filter((name) => name.startsWith('deskdev-') && !OWN_CACHES.includes(name))
      .map((name) => caches.delete(name)),
  )
  await dropOtherBuildsPages()
}

// Pages cached by an older build reference chunks whose cache was just
// deleted (and that a deploy removed from the server): served offline they'd
// boot nothing.
async function dropOtherBuildsPages() {
  const cache = await openCache(PAGES_CACHE)
  if (!cache) return
  const keys = await cache.keys()
  await Promise.all(
    keys.map(async (request) => {
      const response = await cache.match(request, EXACT_MATCH)
      if (!response || response.headers.get(BUILD_HEADER) !== BUILD_ID) await cache.delete(request, EXACT_MATCH)
    }),
  )
}

// ── Fetch ─────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== ORIGIN || passThrough(request, url)) return

  if (request.mode === 'navigate') {
    if (inScope(url.pathname)) handleNavigation(event, url)
  } else if (url.pathname.startsWith('/_next/static/')) {
    serve(event, cacheFirst(request))
  } else if (isBrandAsset(url.pathname)) {
    serve(event, staleWhileRevalidate(request))
  }
  // Anything else goes to the network as if there were no worker.
})

// Per-request data, never a page or a file.
function passThrough(request, url) {
  const headers = request.headers
  return (
    // Next.js's RSC payloads and server actions.
    headers.get('RSC') === '1' ||
    headers.has('Next-Action') ||
    headers.has('X-RSC-Action') ||
    (headers.get('Accept') || '').includes('text/x-component') ||
    url.searchParams.has('_rsc') ||
    url.pathname.endsWith('.rsc') ||
    url.pathname === '/api' ||
    url.pathname.startsWith('/api/') ||
    // Partial responses can't be cached.
    headers.has('Range') ||
    // fetch() rejects these outside same-origin mode (a DevTools quirk).
    (request.cache === 'only-if-cached' && request.mode !== 'same-origin')
  )
}

function isBrandAsset(pathname) {
  return (
    pathname.startsWith('/workspace/icons/') ||
    pathname.startsWith('/workspace/screenshots/') ||
    pathname === '/workspace/favicon.svg' ||
    pathname === '/workspace/og.svg'
  )
}

// Answers with `response`; `done` (cache writes, background refreshes) keeps
// the worker alive until it settles.
function serve(event, { response, done }) {
  event.respondWith(response)
  event.waitUntil(done)
}

function handleNavigation(event, url) {
  const key = ORIGIN + url.pathname
  const network = pageFromNetwork(event)
  serve(event, {
    response: answerNavigation(key, network),
    done: network.then(({ copy }) => copy && savePage(key, copy)).catch(noop),
  })
}

// The page from the network (the browser's preloaded response when it started
// one), with a copy for the cache cloned before anything reads the body.
async function pageFromNetwork(event) {
  let response
  try {
    response = await event.preloadResponse
  } catch {
    // The preload failed; fetch below says whether the network is really gone.
  }
  if (!response) response = await fetch(event.request)
  return { response, copy: isPage(response) ? response.clone() : null }
}

async function answerNavigation(key, network) {
  const fresh = network.then(({ response }) => response)
  let timer
  const slow = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), NAVIGATION_TIMEOUT_MS)
  })
  try {
    const first = await Promise.race([fresh, slow])
    if (first) return first
    // A slow network and a copy on hand: show the copy now. The network answer
    // still lands in the cache through handleNavigation's `done`.
    return (await matchIn(await openCache(PAGES_CACHE), key, PAGE_MATCH)) || (await fresh)
  } catch {
    const cache = await openCache(PAGES_CACHE)
    return (
      (await matchIn(cache, key, PAGE_MATCH)) || (await matchIn(cache, START_URL, PAGE_MATCH)) || offlinePage()
    )
  } finally {
    clearTimeout(timer)
  }
}

async function savePage(key, response) {
  const cache = await openCache(PAGES_CACHE)
  if (!cache) return
  const headers = new Headers(response.headers)
  headers.set(BUILD_HEADER, BUILD_ID)
  // The body is already decoded; the stored copy is no longer the wire bytes.
  headers.delete('Content-Encoding')
  headers.delete('Content-Length')
  await cache.put(key, new Response(response.body, { status: response.status, statusText: response.statusText, headers }))
  // Oldest first (saving a page again moves it to the end). The start page is
  // the offline fallback for every screen, so it never ages out.
  const keys = await cache.keys()
  const excess = keys.length - PAGES_LIMIT
  if (excess <= 0) return
  const evictable = keys.filter((request) => request.url !== START_URL)
  await Promise.all(evictable.slice(0, excess).map((request) => cache.delete(request, EXACT_MATCH)))
}

// The start page is every screen's offline fallback, but the page that
// registered this worker loaded before it existed. Keep a copy from the first
// session on, so the first offline launch (on iOS often the home-screen app's
// second ever) still opens DeskDev.
async function warmStartPage() {
  const cache = await openCache(PAGES_CACHE)
  if (!cache || (await matchIn(cache, START_URL, PAGE_MATCH))) return
  try {
    const response = await withTimeout(fetch(START_URL), WARM_TIMEOUT_MS)
    if (isPage(response)) await savePage(START_URL, response)
  } catch {
    // Offline or slow: a later launch caches it.
  }
}

// Hashed, immutable build files: a cached copy is always right.
function cacheFirst(request) {
  const result = (async () => {
    const cache = await openCache(STATIC_CACHE)
    const hit = await matchIn(cache, request, EXACT_MATCH)
    if (hit) return { response: hit }
    const response = await fetch(request)
    const saved = cache && isAsset(response) ? cache.put(request, response.clone()) : undefined
    return { response, saved }
  })()
  return {
    response: result.then(({ response }) => response),
    done: result.then(({ saved }) => saved).catch(noop),
  }
}

// Icons and images keep their names across deploys: answer from the cache and
// refresh it behind the scenes.
function staleWhileRevalidate(request) {
  const result = (async () => {
    const cache = await openCache(ASSETS_CACHE)
    const cached = await matchIn(cache, request, EXACT_MATCH)
    const network = fetch(request).then((response) => ({
      response,
      copy: cache && isAsset(response) ? response.clone() : null,
    }))
    const saved = network.then(({ copy }) => copy && cache.put(request, copy))
    return { cached, network, saved }
  })()
  return {
    response: result.then(({ cached, network }) => cached || network.then(({ response }) => response)),
    done: result.then(({ saved }) => saved).catch(noop),
  }
}

// ── Messages from the app ─────────────────────────────────────────────────

self.addEventListener('message', (event) => {
  const data = event.data
  if (!data || typeof data !== 'object') return
  let work
  if (data.type === 'SKIP_WAITING') work = self.skipWaiting()
  else if (data.type === 'CACHE_URLS' && Array.isArray(data.urls)) work = Promise.all([cacheUrls(data.urls), warmStartPage()])
  if (work && typeof event.waitUntil === 'function') event.waitUntil(work.catch(noop))
})

// Build files the page loaded before this worker controlled it (a first
// visit), so the first offline launch has them too. Same-origin build files
// only; anything already cached is skipped and failures are left for the next
// real request.
async function cacheUrls(urls) {
  const cache = await openCache(STATIC_CACHE)
  if (!cache) return
  const wanted = new Set()
  for (const raw of urls.slice(0, MAX_CACHE_URLS)) {
    if (typeof raw !== 'string') continue
    try {
      const url = new URL(raw, ORIGIN)
      url.hash = ''
      if (url.origin === ORIGIN && url.pathname.startsWith('/_next/static/')) wanted.add(url.href)
    } catch {
      // Not a URL.
    }
  }
  await Promise.all(
    [...wanted].map(async (href) => {
      try {
        if (await cache.match(href, EXACT_MATCH)) return
        const response = await fetch(href)
        if (isAsset(response)) await cache.put(href, response)
      } catch {
        // Best effort.
      }
    }),
  )
}

// ── Notifications ─────────────────────────────────────────────────────────

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data
  event.waitUntil(openApp(notificationTarget(data && data.url)))
})

// data.url is an app path ('/messages/42', resolved against this host's base)
// or an absolute URL inside the app. Anything else opens the start page.
function notificationTarget(raw) {
  if (typeof raw !== 'string' || raw === '') return START_URL
  try {
    if (raw[0] === '/' && raw[1] !== '/' && raw[1] !== '\\') {
      const path = new URL(raw, ORIGIN)
      let pathname = path.pathname
      // Already carries the base (a withBase() path): don't double it.
      if (BASE && inScope(pathname)) pathname = pathname.slice(BASE.length)
      pathname = (BASE + pathname).replace(/\/+$/, '') || '/'
      return ORIGIN + pathname + path.search + path.hash
    }
    const url = new URL(raw)
    if (url.origin === ORIGIN && inScope(url.pathname)) return url.href
  } catch {
    // Not a URL.
  }
  return START_URL
}

async function appWindows() {
  try {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    return all.filter((client) => isAppUrl(client.url))
  } catch {
    return []
  }
}

// Bring an open DeskDev window forward and let its router move (no reload);
// open one only when there's none.
async function openApp(target) {
  const windows = await appWindows()
  const client =
    windows.find((c) => c.focused) || windows.find((c) => c.visibilityState === 'visible') || windows[0]
  if (client) {
    client.postMessage({ type: 'deskdev:navigate', url: target })
    try {
      await client.focus()
    } catch {
      // Focus can be refused; the window still got the route.
    }
    return
  }
  if (self.clients.openWindow) await self.clients.openWindow(target)
}

self.addEventListener('push', (event) => {
  // iOS revokes the push permission when a push shows nothing, so every push
  // ends in a notification.
  event.waitUntil(showPush(readPush(event.data)))
})

function text(value) {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function badgeCount(value) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined
}

// Declarative Web Push ({web_push: 8030, notification: {…}}) — the same JSON
// iOS 18.4+ shows without us — or the simple {title, body, url, …} shape.
function readPush(data) {
  if (!data) return { title: 'DeskDev' }
  let json
  try {
    json = data.json()
  } catch {
    let body
    try {
      body = data.text()
    } catch {
      // Unreadable payload.
    }
    return { title: 'DeskDev', body: text(body) }
  }
  if (!json || typeof json !== 'object') return { title: 'DeskDev', body: text(json) }
  if (json.web_push === 8030 && json.notification && typeof json.notification === 'object') {
    const n = json.notification
    return {
      title: text(n.title) || 'DeskDev',
      body: text(n.body),
      url: text(n.navigate),
      tag: text(json.tag) || text(n.tag),
      renotify: json.renotify === true || n.renotify === true,
      silent: n.silent === true,
      badge: badgeCount(n.app_badge !== undefined ? n.app_badge : json.app_badge),
      timestamp: json.timestamp !== undefined ? json.timestamp : n.timestamp,
      lang: text(n.lang),
      dir: text(n.dir),
    }
  }
  return {
    title: text(json.title) || 'DeskDev',
    body: text(json.body),
    url: text(json.url) || text(json.navigate),
    tag: text(json.tag),
    renotify: json.renotify === true,
    silent: json.silent === true,
    badge: badgeCount(json.badge),
    timestamp: json.timestamp,
  }
}

async function showPush(message) {
  // Someone looking at DeskDev right now gets it quietly.
  const windows = await appWindows()
  const watching = windows.some((c) => c.focused && c.visibilityState === 'visible')
  const options = {
    body: message.body,
    icon: DEFAULT_ICON,
    badge: DEFAULT_BADGE,
    data: { url: message.url },
    silent: watching || message.silent === true,
  }
  // renotify without a tag throws.
  if (message.tag) {
    options.tag = message.tag
    options.renotify = message.renotify === true
  }
  if (typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)) options.timestamp = message.timestamp
  if (message.lang) options.lang = message.lang
  if (message.dir) options.dir = message.dir
  await Promise.all([self.registration.showNotification(message.title, options), setBadge(message.badge)])
}

// The app-icon badge (iOS 16.4+ home-screen apps, desktop installs; Android
// shows notification dots instead and ignores this).
async function setBadge(count) {
  const nav = self.navigator
  if (count === undefined || !nav) return
  try {
    if (count > 0 && typeof nav.setAppBadge === 'function') await nav.setAppBadge(count)
    else if (count === 0 && typeof nav.clearAppBadge === 'function') await nav.clearAppBadge()
  } catch {
    // Badging not allowed: the notification still shows.
  }
}

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(resubscribe(event).catch(noop))
})

// The push service rotated the subscription. Re-subscribe with the old keys;
// the app saves the new endpoint for the signed-in user on its next launch.
async function resubscribe(event) {
  if (event.newSubscription) return
  const old = event.oldSubscription
  const key = old && old.options && old.options.applicationServerKey
  if (!key) return
  await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
}

// ── Offline page ──────────────────────────────────────────────────────────

function offlinePage() {
  return new Response(OFFLINE_HTML, {
    status: 503,
    statusText: 'Offline',
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

// Self-contained: no fonts, styles or images to fetch while offline. Colours
// mirror the ink tokens in deskdev/index.css (page, title, muted text, top
// bar) and brand-600; a saved theme choice (shared cookie, then localStorage)
// wins over the OS one, as in the app.
const OFFLINE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#eef0f4" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0e1119" media="(prefers-color-scheme: dark)">
<title>Offline · DeskDev</title>
<style>
:root{color-scheme:light;--page:#f5f6f8;--title:#0f172a;--text:#64748b}
:root.dark{color-scheme:dark;--page:#0a0c12;--title:#ffffff;--text:#8a91a3}
@media (prefers-color-scheme:dark){:root:not(.light){color-scheme:dark;--page:#0a0c12;--title:#ffffff;--text:#8a91a3}}
html,body{height:100%;margin:0;background:var(--page)}
body{box-sizing:border-box;display:flex;align-items:center;justify-content:center;padding:calc(24px + env(safe-area-inset-top,0px)) calc(24px + env(safe-area-inset-right,0px)) calc(24px + env(safe-area-inset-bottom,0px)) calc(24px + env(safe-area-inset-left,0px));color:var(--text);font:400 14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%}
main{max-width:320px;text-align:center;animation:rise .2s ease-out both}
svg{display:block;width:48px;height:48px;margin:0 auto 20px}
h1{margin:0 0 4px;color:var(--title);font-size:18px;font-weight:600;letter-spacing:-.01em}
p{margin:0 0 24px}
button{min-width:120px;min-height:44px;padding:0 20px;border:0;border-radius:8px;background:#2563eb;color:#ffffff;font-family:inherit;font-size:14px;font-weight:600;line-height:1;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:background-color .15s ease-out}
button:hover{background:#1d4ed8}
button:focus-visible{outline:2px solid #3b82f6;outline-offset:2px}
@keyframes rise{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){main{animation:none}button{transition:none}}
</style>
</head>
<body>
<main>
<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#2563eb"/><path d="M10 8h6.2c4.6 0 7.8 3.2 7.8 8s-3.2 8-7.8 8H10V8Zm4.3 3.6v8.8h1.7c2.5 0 4-1.7 4-4.4s-1.5-4.4-4-4.4h-1.7Z" fill="#ffffff"/></svg>
<h1>You're offline</h1>
<p>DeskDev will reconnect automatically.</p>
<button type="button" id="retry">Retry</button>
</main>
<script>
(function () {
  // Same read order as the app (deskdev/theme/themeStorage.ts): the shared
  // nixgen-theme cookie, then localStorage nixgen-theme, then the legacy
  // deskdev-theme key. Anything else follows the OS.
  function readMode() {
    try {
      var m = document.cookie.match(/(?:^|; )nixgen-theme=(light|dark)/)
      if (m) return m[1]
    } catch (e) {}
    try {
      var s = localStorage.getItem('nixgen-theme')
      if (s === 'light' || s === 'dark') return s
      s = localStorage.getItem('deskdev-theme')
      if (s === 'light' || s === 'dark') return s
    } catch (e) {}
    return 'system'
  }
  try {
    var mode = readMode()
    if (mode === 'light' || mode === 'dark') {
      document.documentElement.classList.add(mode)
      var metas = document.querySelectorAll('meta[name="theme-color"]')
      for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', mode === 'dark' ? '#0e1119' : '#eef0f4')
    }
  } catch (e) {}
  function retry() { location.reload() }
  document.getElementById('retry').addEventListener('click', retry)
  addEventListener('online', retry)
})()
</script>
</body>
</html>
`
