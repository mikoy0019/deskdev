// Runs the real service-worker source (sw.js, as the app/workspace/sw.js route
// serves it) inside a hand-made ServiceWorkerGlobalScope: captured listeners,
// an in-memory CacheStorage, a clients mock and a fetch mock.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveThemeMode, type ThemeSources } from '../../theme/themeStorage'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BUILD = 'test-build'
const SOURCE = readFileSync(path.join(HERE, 'sw.js'), 'utf8').replaceAll('__DESKDEV_BUILD_ID__', BUILD)
const ORIGIN = 'https://app.test'
const STATIC = `deskdev-static-${BUILD}`
const PAGES = 'deskdev-pages-v1'
const ASSETS = 'deskdev-assets-v1'

// ── Fakes ─────────────────────────────────────────────────────────────────

interface FakeRequest {
  url: string
  method: string
  mode: string
  cache: string
  headers: Headers
}

type Key = string | { url: string }

function keyUrl(key: Key): string {
  return new URL(typeof key === 'string' ? key : key.url, ORIGIN).href
}

function withoutSearch(href: string): string {
  const url = new URL(href)
  url.search = ''
  url.hash = ''
  return url.href
}

class FakeCache {
  entries = new Map<string, Response>()

  async match(key: Key, options: { ignoreSearch?: boolean } = {}) {
    const wanted = keyUrl(key)
    for (const [href, response] of this.entries) {
      const same = options.ignoreSearch ? withoutSearch(href) === withoutSearch(wanted) : href === wanted
      if (same) return response.clone()
    }
    return undefined
  }

  async put(key: Key, response: Response) {
    const href = keyUrl(key)
    // Like the Cache API: a re-put entry moves to the end.
    this.entries.delete(href)
    this.entries.set(href, response)
  }

  async delete(key: Key) {
    return this.entries.delete(keyUrl(key))
  }

  async keys() {
    return [...this.entries.keys()].map((url) => ({ url }))
  }

  urls() {
    return [...this.entries.keys()]
  }
}

class FakeCacheStorage {
  stores = new Map<string, FakeCache>()

  async open(name: string) {
    let cache = this.stores.get(name)
    if (!cache) {
      cache = new FakeCache()
      this.stores.set(name, cache)
    }
    return cache
  }

  async keys() {
    return [...this.stores.keys()]
  }

  async delete(name: string) {
    return this.stores.delete(name)
  }

  get(name: string) {
    return this.stores.get(name)
  }
}

interface FakeWindow {
  url: string
  focused: boolean
  visibilityState: 'visible' | 'hidden'
  postMessage: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
}

function windowClient(url: string, state: Partial<Pick<FakeWindow, 'focused' | 'visibilityState'>> = {}): FakeWindow {
  return {
    url,
    focused: state.focused ?? false,
    visibilityState: state.visibilityState ?? 'hidden',
    postMessage: vi.fn(),
    focus: vi.fn(async () => undefined),
  }
}

function request(url: string, init: Partial<Omit<FakeRequest, 'headers'>> & { headers?: Record<string, string> } = {}): FakeRequest {
  return {
    url: new URL(url, ORIGIN).href,
    method: init.method ?? 'GET',
    mode: init.mode ?? 'cors',
    cache: init.cache ?? 'default',
    headers: new Headers(init.headers),
  }
}

function html(body = '<!doctype html><title>DeskDev</title>', status = 200) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

function file(body: string, type: string, status = 200) {
  return new Response(body, { status, headers: { 'Content-Type': type } })
}

type Handler = (event: Record<string, unknown>) => void
type FetchImpl = (input: string | FakeRequest) => Promise<Response>

function loadWorker(opts: { scope?: '' | '/workspace'; active?: boolean; fetch?: FetchImpl; windows?: FakeWindow[] } = {}) {
  const base = opts.scope ?? '/workspace'
  const listeners = new Map<string, Handler[]>()
  const caches = new FakeCacheStorage()
  const windows = opts.windows ?? []
  const fetchMock = vi.fn<FetchImpl>(opts.fetch ?? (async () => html()))
  const registration = {
    scope: `${ORIGIN}${base}${base ? '' : '/'}`,
    active: opts.active ? {} : null,
    navigationPreload: { enable: vi.fn(async () => undefined) },
    showNotification: vi.fn<(title: string, options?: Record<string, unknown>) => Promise<void>>(async () => undefined),
    pushManager: { subscribe: vi.fn(async () => ({})) },
  }
  const clients = {
    matchAll: vi.fn(async () => windows),
    openWindow: vi.fn(async () => null),
    claim: vi.fn(async () => undefined),
  }
  const navigator = { setAppBadge: vi.fn(async () => undefined), clearAppBadge: vi.fn(async () => undefined) }
  const self = {
    location: { origin: ORIGIN },
    registration,
    clients,
    navigator,
    skipWaiting: vi.fn(async () => undefined),
    addEventListener(type: string, handler: Handler) {
      listeners.set(type, [...(listeners.get(type) ?? []), handler])
    },
  }
  new Function('self', 'caches', 'fetch', SOURCE)(self, caches, fetchMock)

  /** Fires an extendable event; resolves once every waitUntil promise has settled. */
  async function dispatch(type: string, fields: Record<string, unknown> = {}) {
    const waits: Promise<unknown>[] = []
    let response: Promise<Response> | undefined
    const event = {
      ...fields,
      waitUntil(p: Promise<unknown>) {
        waits.push(Promise.resolve(p))
      },
      respondWith(p: Promise<Response> | Response) {
        response = Promise.resolve(p)
      },
    }
    for (const handler of listeners.get(type) ?? []) handler(event)
    const answered = response ? await response : undefined
    await Promise.allSettled(waits)
    // Background work chained off waitUntil promises (cache trims, refreshes).
    await flush()
    return { response: answered, responded: response !== undefined, waits }
  }

  /** A fetch event without waiting for anything: for the timeout tests. */
  function dispatchFetch(req: FakeRequest, preloadResponse?: Promise<Response | undefined>) {
    const waits: Promise<unknown>[] = []
    let response: Promise<Response> | undefined
    const event = {
      request: req,
      preloadResponse,
      waitUntil: (p: Promise<unknown>) => waits.push(Promise.resolve(p)),
      respondWith: (p: Promise<Response>) => {
        response = Promise.resolve(p)
      },
    }
    for (const handler of listeners.get('fetch') ?? []) handler(event)
    return { response, waits }
  }

  const fetchEvent = (req: FakeRequest, preloadResponse?: Promise<Response | undefined>) =>
    dispatch('fetch', { request: req, preloadResponse })

  return { self, caches, clients, registration, navigator, fetch: fetchMock, dispatch, dispatchFetch, fetchEvent, base }
}

async function flush() {
  // setImmediate, not setTimeout: Windows timers tick at ~15ms.
  for (let i = 0; i < 10; i++) await new Promise<void>((resolve) => setImmediate(resolve))
}

afterEach(() => {
  vi.useRealTimers()
})

// ── Lifecycle ─────────────────────────────────────────────────────────────

describe('install and activate', () => {
  it('takes over at once on a first install', async () => {
    const sw = loadWorker()
    await sw.dispatch('install')
    expect(sw.self.skipWaiting).toHaveBeenCalledTimes(1)
  })

  it('makes an update wait for SKIP_WAITING', async () => {
    const sw = loadWorker({ active: true })
    await sw.dispatch('install')
    expect(sw.self.skipWaiting).not.toHaveBeenCalled()
    await sw.dispatch('message', { data: { type: 'SKIP_WAITING' } })
    expect(sw.self.skipWaiting).toHaveBeenCalledTimes(1)
  })

  it('drops other builds’ caches and pages, enables navigation preload and claims clients', async () => {
    const sw = loadWorker()
    await (await sw.caches.open('deskdev-static-old')).put('/_next/static/a.js', file('a', 'text/javascript'))
    await (await sw.caches.open(STATIC)).put('/_next/static/b.js', file('b', 'text/javascript'))
    await sw.caches.open(ASSETS)
    await sw.caches.open('someone-elses-cache')
    const pages = await sw.caches.open(PAGES)
    const current = html()
    current.headers.set('X-DeskDev-Build', BUILD)
    await pages.put(`${ORIGIN}/workspace/tasks`, current)
    const stale = html()
    stale.headers.set('X-DeskDev-Build', 'old')
    await pages.put(`${ORIGIN}/workspace/calendar`, stale)

    await sw.dispatch('activate')

    expect(await sw.caches.keys()).toEqual([STATIC, ASSETS, 'someone-elses-cache', PAGES])
    expect(pages.urls()).toEqual([`${ORIGIN}/workspace/tasks`])
    expect(sw.registration.navigationPreload.enable).toHaveBeenCalled()
    expect(sw.clients.claim).toHaveBeenCalled()
  })

  it('still claims clients when navigation preload is refused', async () => {
    const sw = loadWorker()
    sw.registration.navigationPreload.enable.mockRejectedValue(new Error('nope'))
    await sw.dispatch('activate')
    expect(sw.clients.claim).toHaveBeenCalled()
  })
})

// ── Fetch ─────────────────────────────────────────────────────────────────

describe('fetch: requests left to the network', () => {
  const cases: [string, FakeRequest][] = [
    ['a POST', request('/workspace/tasks', { method: 'POST', mode: 'navigate' })],
    ['another origin', request('https://abc.supabase.co/rest/v1/tasks')],
    ['a cross-origin navigation', request('https://example.com/', { mode: 'navigate' })],
    ['an RSC request (header)', request('/workspace/tasks', { mode: 'navigate', headers: { RSC: '1' } })],
    ['an RSC request (_rsc)', request('/workspace/tasks?_rsc=abc', { mode: 'navigate' })],
    ['an RSC request (.rsc)', request('/workspace/tasks.rsc')],
    ['a server action', request('/workspace', { headers: { 'Next-Action': 'abc' } })],
    ['/api', request('/api/contact')],
    ['/api navigation', request('/api/contact', { mode: 'navigate' })],
    ['a range request', request('/_next/static/media/a.mp4', { headers: { Range: 'bytes=0-' } })],
    ['any other file', request('/workspace/data.json')],
    ['a root file', request('/favicon.ico')],
  ]
  it.each(cases)('ignores %s', async (_name, req) => {
    const sw = loadWorker()
    const { responded } = await sw.fetchEvent(req)
    expect(responded).toBe(false)
  })

  it('ignores navigations outside the /workspace scope', async () => {
    const sw = loadWorker({ scope: '/workspace' })
    expect((await sw.fetchEvent(request('/about', { mode: 'navigate' }))).responded).toBe(false)
    expect((await sw.fetchEvent(request('/workspaces', { mode: 'navigate' }))).responded).toBe(false)
  })

  it('answers every navigation on its own host (scope /)', async () => {
    const sw = loadWorker({ scope: '' })
    expect((await sw.fetchEvent(request('/tasks', { mode: 'navigate' }))).responded).toBe(true)
  })
})

describe('fetch: navigations', () => {
  it('goes to the network first and keeps the page by pathname', async () => {
    const sw = loadWorker()
    const { response } = await sw.fetchEvent(request('/workspace/tasks?source=pwa#x', { mode: 'navigate' }))
    expect(response?.status).toBe(200)
    expect(await response?.text()).toContain('DeskDev')
    const pages = sw.caches.get(PAGES)!
    expect(pages.urls()).toEqual([`${ORIGIN}/workspace/tasks`])
    const saved = await pages.match(`${ORIGIN}/workspace/tasks`)
    expect(saved?.headers.get('X-DeskDev-Build')).toBe(BUILD)
  })

  it('uses the navigation preload response when there is one', async () => {
    const sw = loadWorker()
    const { response } = await sw.fetchEvent(
      request('/workspace/tasks', { mode: 'navigate' }),
      Promise.resolve(html('<p>preloaded</p>')),
    )
    expect(await response?.text()).toBe('<p>preloaded</p>')
    expect(sw.fetch).not.toHaveBeenCalled()
  })

  it('falls back to fetch when the preload fails', async () => {
    const sw = loadWorker()
    const { response } = await sw.fetchEvent(
      request('/workspace/tasks', { mode: 'navigate' }),
      Promise.reject(new Error('preload failed')),
    )
    expect(response?.status).toBe(200)
    expect(sw.fetch).toHaveBeenCalledTimes(1)
  })

  it('keeps only 200 HTML documents', async () => {
    const responses = [html('missing', 404), file('{}', 'application/json'), html('error', 500)]
    const sw = loadWorker({ fetch: async () => responses.shift()! })
    for (let i = 0; i < 3; i++) {
      const { response } = await sw.fetchEvent(request(`/workspace/p${i}`, { mode: 'navigate' }))
      expect(response).toBeDefined()
    }
    expect(sw.caches.get(PAGES)?.urls() ?? []).toEqual([])
  })

  it('serves the cached page when the network is down', async () => {
    let online = true
    const sw = loadWorker({ fetch: async () => (online ? html('<p>tasks</p>') : Promise.reject(new TypeError('offline'))) })
    await sw.fetchEvent(request('/workspace/tasks', { mode: 'navigate' }))
    online = false
    const { response } = await sw.fetchEvent(request('/workspace/tasks?again=1', { mode: 'navigate' }))
    expect(await response?.text()).toBe('<p>tasks</p>')
  })

  it('falls back to the start page, then to the offline page', async () => {
    let online = true
    const sw = loadWorker({ fetch: async () => (online ? html('<p>home</p>') : Promise.reject(new TypeError('offline'))) })
    await sw.fetchEvent(request('/workspace?source=pwa', { mode: 'navigate' }))
    online = false

    const fallback = await sw.fetchEvent(request('/workspace/calendar', { mode: 'navigate' }))
    expect(await fallback.response?.text()).toBe('<p>home</p>')

    await sw.caches.get(PAGES)!.delete(`${ORIGIN}/workspace`)
    const offline = await sw.fetchEvent(request('/workspace/calendar', { mode: 'navigate' }))
    expect(offline.response?.status).toBe(503)
    expect(offline.response?.headers.get('Content-Type')).toContain('text/html')
    const body = await offline.response!.text()
    expect(body).toContain("You're offline")
    expect(body).toContain('DeskDev will reconnect automatically')
    expect(body).toContain('id="retry"')
    expect(body).toContain('prefers-color-scheme')
    // Nothing to fetch while offline.
    expect(body).not.toMatch(/(src|href)="http/)
  })

  it('uses / as the start page on its own host', async () => {
    let online = true
    const sw = loadWorker({ scope: '', fetch: async () => (online ? html('<p>home</p>') : Promise.reject(new TypeError('offline'))) })
    await sw.fetchEvent(request('/', { mode: 'navigate' }))
    expect(sw.caches.get(PAGES)!.urls()).toEqual([`${ORIGIN}/`])
    online = false
    const { response } = await sw.fetchEvent(request('/projects/7', { mode: 'navigate' }))
    expect(await response?.text()).toBe('<p>home</p>')
  })

  it('serves the cached copy after 4s of a slow network, then refreshes it', async () => {
    let finish: (r: Response) => void = () => {}
    let slow = false
    const sw = loadWorker({
      fetch: async () => (slow ? new Promise<Response>((resolve) => (finish = resolve)) : html('<p>old</p>')),
    })
    await sw.fetchEvent(request('/workspace/tasks', { mode: 'navigate' }))
    slow = true

    vi.useFakeTimers()
    const { response, waits } = sw.dispatchFetch(request('/workspace/tasks', { mode: 'navigate' }))
    let answered: Response | undefined
    void response!.then((r) => (answered = r))
    await vi.advanceTimersByTimeAsync(3900)
    expect(answered).toBeUndefined()
    await vi.advanceTimersByTimeAsync(200)
    expect(await answered?.text()).toBe('<p>old</p>')

    finish(html('<p>new</p>'))
    await vi.advanceTimersByTimeAsync(0)
    await Promise.all(waits)
    vi.useRealTimers()
    await flush()
    expect(await (await sw.caches.get(PAGES)!.match(`${ORIGIN}/workspace/tasks`))?.text()).toBe('<p>new</p>')
  })

  it('keeps waiting for a slow network when nothing is cached', async () => {
    let finish: (r: Response) => void = () => {}
    const sw = loadWorker({ fetch: () => new Promise<Response>((resolve) => (finish = resolve)) })
    vi.useFakeTimers()
    const { response } = sw.dispatchFetch(request('/workspace/tasks', { mode: 'navigate' }))
    let answered: Response | undefined
    void response!.then((r) => (answered = r))
    await vi.advanceTimersByTimeAsync(5000)
    expect(answered).toBeUndefined()
    finish(html('<p>late</p>'))
    await vi.advanceTimersByTimeAsync(0)
    expect(await answered?.text()).toBe('<p>late</p>')
  })

  it('caps the page cache, oldest first, but never evicts the start page', async () => {
    const sw = loadWorker()
    await sw.fetchEvent(request('/workspace', { mode: 'navigate' }))
    for (let i = 0; i < 45; i++) await sw.fetchEvent(request(`/workspace/p/${i}`, { mode: 'navigate' }))
    const urls = sw.caches.get(PAGES)!.urls()
    expect(urls).toHaveLength(40)
    expect(urls).toContain(`${ORIGIN}/workspace`)
    expect(urls).not.toContain(`${ORIGIN}/workspace/p/0`)
    expect(urls).toContain(`${ORIGIN}/workspace/p/44`)
  })
})

describe('fetch: build files and brand assets', () => {
  it('serves /_next/static cache-first', async () => {
    const sw = loadWorker({ fetch: async () => file('chunk', 'text/javascript') })
    const req = request('/_next/static/chunks/app-123.js')
    expect(await (await sw.fetchEvent(req)).response?.text()).toBe('chunk')
    expect(await (await sw.fetchEvent(req)).response?.text()).toBe('chunk')
    expect(sw.fetch).toHaveBeenCalledTimes(1)
    expect(sw.caches.get(STATIC)!.urls()).toEqual([`${ORIGIN}/_next/static/chunks/app-123.js`])
  })

  it('never keeps HTML or failed responses as build files', async () => {
    const responses = [html('<p>DeskDev</p>'), file('gone', 'text/plain', 404)]
    const sw = loadWorker({ fetch: async () => responses.shift()! })
    await sw.fetchEvent(request('/_next/static/chunks/missing.js'))
    await sw.fetchEvent(request('/_next/static/chunks/gone.js'))
    expect(sw.caches.get(STATIC)!.urls()).toEqual([])
  })

  it('serves brand assets stale-while-revalidate', async () => {
    let version = 1
    const sw = loadWorker({ fetch: async () => file(`icon v${version}`, 'image/png') })
    const paths = ['/workspace/icons/icon-192.png', '/workspace/favicon.svg', '/workspace/og.svg', '/workspace/screenshots/wide-home.png']
    for (const p of paths) expect(await (await sw.fetchEvent(request(p))).response?.text()).toBe('icon v1')
    version = 2
    const icon = request('/workspace/icons/icon-192.png')
    // The cached copy answers; the fresh one replaces it behind the scenes.
    expect(await (await sw.fetchEvent(icon)).response?.text()).toBe('icon v1')
    expect(await (await sw.fetchEvent(icon)).response?.text()).toBe('icon v2')
    expect(sw.caches.get(ASSETS)!.urls()).toHaveLength(4)
  })

  it('does not keep an HTML answer for a missing asset', async () => {
    const sw = loadWorker({ fetch: async () => html() })
    await sw.fetchEvent(request('/workspace/icons/nope.png'))
    expect(sw.caches.get(ASSETS)!.urls()).toEqual([])
  })
})

// ── Messages ──────────────────────────────────────────────────────────────

describe('CACHE_URLS', () => {
  it('adds same-origin build files that are not cached yet and ignores failures', async () => {
    const sw = loadWorker({
      fetch: async (input) => {
        const url = typeof input === 'string' ? input : input.url
        if (url.endsWith('broken.js')) throw new TypeError('offline')
        if (url.includes('/_next/static/')) return file('js', 'text/javascript')
        return html('<p>home</p>')
      },
    })
    await (await sw.caches.open(STATIC)).put(`${ORIGIN}/_next/static/cached.js`, file('cached', 'text/javascript'))
    await sw.dispatch('message', {
      data: {
        type: 'CACHE_URLS',
        urls: [
          `${ORIGIN}/_next/static/a.js`,
          '/_next/static/b.css',
          `${ORIGIN}/_next/static/cached.js`,
          `${ORIGIN}/_next/static/broken.js`,
          'https://cdn.example.com/_next/static/x.js',
          `${ORIGIN}/workspace/tasks`,
          42,
        ],
      },
    })
    const urls = sw.caches.get(STATIC)!.urls()
    expect(urls.sort()).toEqual(
      [`${ORIGIN}/_next/static/a.js`, `${ORIGIN}/_next/static/b.css`, `${ORIGIN}/_next/static/cached.js`].sort(),
    )
    const fetched = sw.fetch.mock.calls.map(([input]) => (typeof input === 'string' ? input : input.url))
    expect(fetched).not.toContain(`${ORIGIN}/_next/static/cached.js`)
    expect(fetched).not.toContain('https://cdn.example.com/_next/static/x.js')
    // The start page is kept too, for the first offline launch.
    expect(sw.caches.get(PAGES)!.urls()).toEqual([`${ORIGIN}/workspace`])
  })

  it('ignores unknown messages', async () => {
    const sw = loadWorker()
    await sw.dispatch('message', { data: { type: 'NOPE' } })
    await sw.dispatch('message', { data: 'SKIP_WAITING' })
    expect(sw.self.skipWaiting).not.toHaveBeenCalled()
  })
})

// ── Notifications ─────────────────────────────────────────────────────────

function click(url?: unknown) {
  return { notification: { data: url === undefined ? undefined : { url }, close: vi.fn() } }
}

describe('notificationclick', () => {
  it.each([
    ['/workspace', '/messages/42', `${ORIGIN}/workspace/messages/42`],
    ['/workspace', '/messages/42?thread=1', `${ORIGIN}/workspace/messages/42?thread=1`],
    ['/workspace', '/workspace/tasks', `${ORIGIN}/workspace/tasks`],
    ['/workspace', '/', `${ORIGIN}/workspace`],
    ['/workspace', `${ORIGIN}/workspace/calendar`, `${ORIGIN}/workspace/calendar`],
    ['/workspace', `${ORIGIN}/about`, `${ORIGIN}/workspace`],
    ['/workspace', 'https://evil.test/workspace', `${ORIGIN}/workspace`],
    ['/workspace', '//evil.test/x', `${ORIGIN}/workspace`],
    ['/workspace', undefined, `${ORIGIN}/workspace`],
    ['', '/messages/42', `${ORIGIN}/messages/42`],
    ['', '/', `${ORIGIN}/`],
    ['', `${ORIGIN}/tasks`, `${ORIGIN}/tasks`],
    ['', 'https://evil.test/tasks', `${ORIGIN}/`],
  ] as const)('scope %j: %j opens %s', async (scope, url, target) => {
    const sw = loadWorker({ scope })
    const event = click(url)
    await sw.dispatch('notificationclick', event)
    expect(event.notification.close).toHaveBeenCalled()
    expect(sw.clients.openWindow).toHaveBeenCalledWith(target)
  })

  it('focuses an open window and routes it instead of opening another', async () => {
    const hidden = windowClient(`${ORIGIN}/workspace/tasks`)
    const visible = windowClient(`${ORIGIN}/workspace`, { visibilityState: 'visible' })
    const site = windowClient(`${ORIGIN}/about`, { focused: true, visibilityState: 'visible' })
    const sw = loadWorker({ windows: [site, hidden, visible] })
    await sw.dispatch('notificationclick', click('/messages/7'))
    expect(sw.clients.matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true })
    expect(visible.postMessage).toHaveBeenCalledWith({ type: 'deskdev:navigate', url: `${ORIGIN}/workspace/messages/7` })
    expect(visible.focus).toHaveBeenCalled()
    expect(site.postMessage).not.toHaveBeenCalled()
    expect(hidden.postMessage).not.toHaveBeenCalled()
    expect(sw.clients.openWindow).not.toHaveBeenCalled()
  })

  it('prefers the focused window, then any window in scope', async () => {
    const first = windowClient(`${ORIGIN}/workspace/a`)
    const focused = windowClient(`${ORIGIN}/workspace/b`, { focused: true, visibilityState: 'visible' })
    const sw = loadWorker({ windows: [first, focused] })
    await sw.dispatch('notificationclick', click('/tasks'))
    expect(focused.postMessage).toHaveBeenCalled()

    const only = windowClient(`${ORIGIN}/workspace/a`)
    const sw2 = loadWorker({ windows: [only] })
    await sw2.dispatch('notificationclick', click('/tasks'))
    expect(only.postMessage).toHaveBeenCalledWith({ type: 'deskdev:navigate', url: `${ORIGIN}/workspace/tasks` })
  })
})

function pushData(payload: unknown) {
  return {
    json: () => (typeof payload === 'string' ? JSON.parse(payload) : payload),
    text: () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
  }
}

describe('push', () => {
  it('shows a Declarative Web Push message', async () => {
    const sw = loadWorker()
    await sw.dispatch('push', {
      data: pushData({
        web_push: 8030,
        notification: {
          title: 'Ana mentioned you',
          body: 'Can you check the brief?',
          navigate: `${ORIGIN}/workspace/messages/42`,
          lang: 'en',
          dir: 'ltr',
          app_badge: 3,
        },
        mutable: true,
        tag: 'conversation-42',
        renotify: true,
        timestamp: 1_790_000_000_000,
      }),
    })
    expect(sw.registration.showNotification).toHaveBeenCalledWith('Ana mentioned you', {
      body: 'Can you check the brief?',
      icon: '/workspace/icons/icon-192.png',
      badge: '/workspace/icons/badge-96.png',
      data: { url: `${ORIGIN}/workspace/messages/42` },
      silent: false,
      tag: 'conversation-42',
      renotify: true,
      timestamp: 1_790_000_000_000,
      lang: 'en',
      dir: 'ltr',
    })
    expect(sw.navigator.setAppBadge).toHaveBeenCalledWith(3)
  })

  it('shows the simple shape, without renotify when there is no tag', async () => {
    const sw = loadWorker()
    await sw.dispatch('push', { data: pushData({ title: 'Task assigned', body: 'Logo review', url: '/tasks/9', renotify: true, badge: 0 }) })
    const [title, options] = sw.registration.showNotification.mock.calls[0]
    expect(title).toBe('Task assigned')
    expect(options).toMatchObject({ body: 'Logo review', data: { url: '/tasks/9' }, silent: false })
    expect(options).not.toHaveProperty('renotify')
    expect(options).not.toHaveProperty('tag')
    expect(sw.navigator.clearAppBadge).toHaveBeenCalled()
    expect(sw.navigator.setAppBadge).not.toHaveBeenCalled()
  })

  it('always shows something, even for text or empty payloads', async () => {
    const sw = loadWorker()
    await sw.dispatch('push', { data: pushData('plain words') })
    await sw.dispatch('push', { data: null })
    const calls = sw.registration.showNotification.mock.calls
    expect(calls[0][0]).toBe('DeskDev')
    expect(calls[0][1]).toMatchObject({ body: 'plain words' })
    expect(calls[1][0]).toBe('DeskDev')
  })

  it('stays quiet while someone is looking at DeskDev', async () => {
    const sw = loadWorker({ windows: [windowClient(`${ORIGIN}/workspace/tasks`, { focused: true, visibilityState: 'visible' })] })
    await sw.dispatch('push', { data: pushData({ title: 'New message' }) })
    expect(sw.registration.showNotification.mock.calls[0][1]).toMatchObject({ silent: true })
  })

  it('is not silenced by a focused window outside the app', async () => {
    const sw = loadWorker({ windows: [windowClient(`${ORIGIN}/about`, { focused: true, visibilityState: 'visible' })] })
    await sw.dispatch('push', { data: pushData({ title: 'New message' }) })
    expect(sw.registration.showNotification.mock.calls[0][1]).toMatchObject({ silent: false })
  })

  it('resubscribes when the push service rotates the subscription', async () => {
    const sw = loadWorker()
    const key = new Uint8Array([4, 1, 2])
    await sw.dispatch('pushsubscriptionchange', { oldSubscription: { options: { applicationServerKey: key } } })
    expect(sw.registration.pushManager.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: key })
  })
})

describe('offline page theme', () => {
  async function offlineScript(): Promise<string> {
    const sw = loadWorker({ fetch: async () => Promise.reject(new TypeError('offline')) })
    const { response } = await sw.fetchEvent(request('/workspace/tasks', { mode: 'navigate' }))
    expect(response?.status).toBe(503)
    const body = await response!.text()
    const m = body.match(/<script>([\s\S]*?)<\/script>/)
    expect(m).not.toBeNull()
    return m![1]
  }

  /** Runs the page's inline script against fake cookie/localStorage; returns the root's theme class. */
  function applyTheme(script: string, sources: ThemeSources): string | null {
    const classes = new Set<string>()
    const metas = [{ setAttribute: vi.fn() }, { setAttribute: vi.fn() }]
    const document = {
      cookie: sources.cookie ?? '',
      documentElement: { classList: { add: (c: string) => classes.add(c) } },
      querySelectorAll: () => metas,
      getElementById: () => ({ addEventListener: vi.fn() }),
    }
    const store: Record<string, string | null> = { 'nixgen-theme': sources.stored, 'deskdev-theme': sources.legacy }
    const localStorage = { getItem: (k: string) => store[k] ?? null }
    new Function('document', 'localStorage', 'addEventListener', 'location', script)(
      document,
      localStorage,
      vi.fn(),
      { reload: vi.fn() },
    )
    const applied = [...classes]
    expect(applied.length).toBeLessThanOrEqual(1)
    if (applied[0]) {
      const color = applied[0] === 'dark' ? '#0e1119' : '#eef0f4'
      for (const meta of metas) expect(meta.setAttribute).toHaveBeenCalledWith('content', color)
    }
    return applied[0] ?? null
  }

  it('prefers the shared nixgen-theme cookie, then localStorage, then the legacy key', async () => {
    const script = await offlineScript()
    expect(applyTheme(script, { cookie: 'a=1; nixgen-theme=light', stored: 'dark', legacy: 'dark' })).toBe('light')
    expect(applyTheme(script, { cookie: null, stored: 'dark', legacy: 'light' })).toBe('dark')
    expect(applyTheme(script, { cookie: null, stored: null, legacy: 'light' })).toBe('light')
    expect(applyTheme(script, { cookie: null, stored: null, legacy: 'system' })).toBeNull()
    expect(applyTheme(script, { cookie: null, stored: null, legacy: null })).toBeNull()
  })

  it('agrees with the app for every combination of sources', async () => {
    const script = await offlineScript()
    const cookies = [null, '', 'nixgen-theme=light', 'a=1; nixgen-theme=dark', 'nixgen-theme=x', 'xnixgen-theme=dark']
    const values = [null, 'light', 'dark', 'system', 'bogus']
    for (const cookie of cookies) {
      for (const stored of values) {
        for (const legacy of values) {
          const sources = { cookie, stored, legacy }
          const mode = resolveThemeMode(sources)
          expect(applyTheme(script, sources), JSON.stringify(sources)).toBe(mode === 'system' ? null : mode)
        }
      }
    }
  })

  it('keeps the OS theme when storage and cookies are blocked', async () => {
    const script = await offlineScript()
    const document = {
      get cookie(): string {
        throw new Error('blocked')
      },
      documentElement: { classList: { add: vi.fn() } },
      querySelectorAll: () => [],
      getElementById: () => ({ addEventListener: vi.fn() }),
    }
    const localStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
    }
    expect(() =>
      new Function('document', 'localStorage', 'addEventListener', 'location', script)(document, localStorage, vi.fn(), { reload: vi.fn() }),
    ).not.toThrow()
    expect(document.documentElement.classList.add).not.toHaveBeenCalled()
  })
})
