import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

type SwModule = typeof import('./serviceWorker')
;(window as Window & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ORIGIN = window.location.origin
const SCRIPT = `${ORIGIN}/workspace/sw.js`

// ── Fakes for navigator.serviceWorker ──────────────────────────────────────

class FakeWorker extends EventTarget {
  state: ServiceWorkerState
  readonly scriptURL: string
  readonly postMessage = vi.fn()

  constructor(state: ServiceWorkerState, scriptURL = SCRIPT) {
    super()
    this.state = state
    this.scriptURL = scriptURL
  }

  become(state: ServiceWorkerState) {
    this.state = state
    this.dispatchEvent(new Event('statechange'))
  }
}

class FakeRegistration extends EventTarget {
  readonly scope: string
  installing: FakeWorker | null = null
  waiting: FakeWorker | null = null
  active: FakeWorker | null = null
  readonly update = vi.fn(() => Promise.resolve())
  readonly unregister = vi.fn(() => Promise.resolve(true))

  constructor(scope = `${ORIGIN}/workspace`) {
    super()
    this.scope = scope
  }

  /** A new build's worker starts installing. */
  found(worker: FakeWorker) {
    this.installing = worker
    this.dispatchEvent(new Event('updatefound'))
  }

  activate(worker: FakeWorker) {
    if (this.installing === worker) this.installing = null
    if (this.waiting === worker) this.waiting = null
    this.active = worker
    worker.become('activated')
  }
}

class FakeContainer extends EventTarget {
  controller: FakeWorker | null = null
  registration = new FakeRegistration()
  /** Whether a registration already exists (an earlier visit). */
  registered = false
  others: FakeRegistration[] = []
  readonly register = vi.fn((url: string, options?: RegistrationOptions) => {
    void url
    void options
    this.registered = true
    return Promise.resolve(this.registration)
  })
  readonly getRegistration = vi.fn((url?: string) => {
    void url
    return Promise.resolve(this.registered ? this.registration : undefined)
  })
  readonly getRegistrations = vi.fn(() => Promise.resolve([this.registration, ...this.others]))
}

/** A returning visit: an active worker that controls the page. */
function controlled(container: FakeContainer): FakeWorker {
  const active = new FakeWorker('activated')
  container.registration.active = active
  container.controller = active
  return active
}

// ── Harness ────────────────────────────────────────────────────────────────

let container: FakeContainer | null
let reload: Mock<() => void>
let visibility: DocumentVisibilityState
const added: [EventTarget, string, EventListenerOrEventListenerObject][] = []

function trackListeners(target: EventTarget) {
  const original = target.addEventListener.bind(target)
  vi.spyOn(target, 'addEventListener').mockImplementation(
    (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) => {
      if (listener) added.push([target, type, listener])
      original(type, listener, options)
    },
  )
}

function shadow(target: object, key: string, get: () => unknown) {
  Object.defineProperty(target, key, { configurable: true, get })
}

function unshadow(target: object, key: string) {
  delete (target as Record<string, unknown>)[key]
}

function installContainer(): FakeContainer {
  container = new FakeContainer()
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container })
  return container
}

/** A fresh copy of the module (its state is module-level). */
async function load(opts: { production?: boolean; base?: '' | '/workspace' } = {}): Promise<SwModule> {
  vi.resetModules()
  const base = opts.base ?? '/workspace'
  vi.doMock('../lib/basePath', () => ({
    BASE_PATH: base,
    withBase: (path: string) => `${base}${path}`,
    assetUrl: (path: string) => `/workspace${path}`,
  }))
  const mod = await import('./serviceWorker')
  mod.__setTestHooks({ production: opts.production ?? true, reload: () => reload() })
  return mod
}

/** Lets promise chains (register → track → …) run. */
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

function renderHook<T>(hook: () => T) {
  const result = { current: undefined as T }
  function Probe() {
    result.current = hook()
    return null
  }
  const root = createRoot(document.createElement('div'))
  act(() => root.render(createElement(Probe)))
  return { result, unmount: () => act(() => root.unmount()) }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  container = null
  reload = vi.fn<() => void>()
  visibility = 'visible'
  trackListeners(window)
  trackListeners(document)
  shadow(document, 'visibilityState', () => visibility)
  shadow(document, 'readyState', () => 'complete')
  window.sessionStorage.clear()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.doUnmock('../lib/basePath')
  for (const [target, type, listener] of added.splice(0)) target.removeEventListener(type, listener)
  unshadow(navigator, 'serviceWorker')
  unshadow(navigator, 'onLine')
  unshadow(document, 'visibilityState')
  unshadow(document, 'readyState')
  unshadow(performance, 'getEntriesByType')
  document.head.innerHTML = ''
  window.history.replaceState(null, '', '/')
})

// ── Tests ──────────────────────────────────────────────────────────────────

describe('SW_URL and swScope', () => {
  it('scopes the worker to /workspace where DeskDev is a route of the site', async () => {
    const { SW_URL, swScope } = await load({ base: '/workspace' })
    expect(SW_URL).toBe('/workspace/sw.js')
    expect(swScope()).toBe('/workspace')
  })

  it("scopes it to the root on DeskDev's own subdomain", async () => {
    const { SW_URL, swScope } = await load({ base: '' })
    expect(SW_URL).toBe('/workspace/sw.js')
    expect(swScope()).toBe('/')
  })
})

describe('registerServiceWorker', () => {
  it('registers the worker for the app scope, bypassing the HTTP cache', async () => {
    const sw = installContainer()
    const { registerServiceWorker } = await load()
    registerServiceWorker()
    await flush()
    expect(sw.register).toHaveBeenCalledTimes(1)
    expect(sw.register).toHaveBeenCalledWith('/workspace/sw.js', { scope: '/workspace', updateViaCache: 'none' })
  })

  it("uses scope '/' on the workspace subdomain", async () => {
    const sw = installContainer()
    const { registerServiceWorker } = await load({ base: '' })
    registerServiceWorker()
    await flush()
    expect(sw.register).toHaveBeenCalledWith('/workspace/sw.js', { scope: '/', updateViaCache: 'none' })
  })

  it("waits for the page's load event before registering", async () => {
    shadow(document, 'readyState', () => 'interactive')
    const sw = installContainer()
    const { registerServiceWorker } = await load()
    registerServiceWorker()
    await flush()
    expect(sw.register).not.toHaveBeenCalled()
    window.dispatchEvent(new Event('load'))
    await flush()
    expect(sw.register).toHaveBeenCalledTimes(1)
  })

  it('is idempotent', async () => {
    const sw = installContainer()
    const { registerServiceWorker } = await load()
    registerServiceWorker()
    registerServiceWorker()
    registerServiceWorker()
    await flush()
    expect(sw.register).toHaveBeenCalledTimes(1)
  })

  it('does nothing in development builds', async () => {
    const sw = installContainer()
    const { registerServiceWorker } = await load({ production: false })
    registerServiceWorker()
    await flush()
    expect(sw.register).not.toHaveBeenCalled()
    expect(sw.getRegistrations).not.toHaveBeenCalled()
  })

  it('does nothing where service workers are unsupported', async () => {
    const { registerServiceWorker, getRegistration } = await load()
    expect(() => registerServiceWorker()).not.toThrow()
    await expect(getRegistration()).resolves.toBeUndefined()
  })

  it("unregisters DeskDev's worker on ?nosw and skips registering", async () => {
    window.history.replaceState(null, '', '/workspace/tasks?nosw')
    const sw = installContainer()
    sw.registration.active = new FakeWorker('activated')
    // The subdomain's registration: another scope, same script.
    const subdomain = new FakeRegistration(`${ORIGIN}/`)
    subdomain.active = new FakeWorker('activated')
    const unrelated = new FakeRegistration(`${ORIGIN}/other`)
    unrelated.active = new FakeWorker('activated', `${ORIGIN}/other/sw.js`)
    sw.others = [subdomain, unrelated]

    const { registerServiceWorker } = await load()
    registerServiceWorker()
    await flush()
    expect(sw.registration.unregister).toHaveBeenCalledTimes(1)
    expect(subdomain.unregister).toHaveBeenCalledTimes(1)
    expect(unrelated.unregister).not.toHaveBeenCalled()
    expect(sw.register).not.toHaveBeenCalled()
  })
})

describe('the update flow', () => {
  it('flags a build that was already waiting at startup', async () => {
    const sw = installContainer()
    controlled(sw)
    sw.registration.waiting = new FakeWorker('installed')
    const { registerServiceWorker, useServiceWorkerUpdate } = await load()
    const { result, unmount } = renderHook(useServiceWorkerUpdate)
    expect(result.current.updateReady).toBe(false)
    registerServiceWorker()
    await act(flush)
    expect(result.current.updateReady).toBe(true)
    unmount()
  })

  it('flags a new build once it has installed behind the running one', async () => {
    const sw = installContainer()
    controlled(sw)
    const { registerServiceWorker, useServiceWorkerUpdate } = await load()
    const { result, unmount } = renderHook(useServiceWorkerUpdate)
    registerServiceWorker()
    await act(flush)
    const next = new FakeWorker('installing')
    act(() => sw.registration.found(next))
    expect(result.current.updateReady).toBe(false)
    act(() => {
      sw.registration.installing = null
      sw.registration.waiting = next
      next.become('installed')
    })
    expect(result.current.updateReady).toBe(true)
    unmount()
  })

  it('treats the very first install as no update', async () => {
    const sw = installContainer()
    const { registerServiceWorker, useServiceWorkerUpdate } = await load()
    const { result, unmount } = renderHook(useServiceWorkerUpdate)
    const first = new FakeWorker('installing')
    sw.registration.installing = first
    registerServiceWorker()
    await act(flush)
    act(() => sw.registration.found(first))
    act(() => first.become('installed'))
    act(() => {
      sw.registration.activate(first)
      sw.controller = first
      sw.dispatchEvent(new Event('controllerchange'))
    })
    expect(result.current.updateReady).toBe(false)
    expect(reload).not.toHaveBeenCalled()
    unmount()
  })

  it('flags a build that another tab let take over', async () => {
    const sw = installContainer()
    controlled(sw)
    const { registerServiceWorker, useServiceWorkerUpdate } = await load()
    const { result, unmount } = renderHook(useServiceWorkerUpdate)
    registerServiceWorker()
    await act(flush)
    act(() => {
      sw.dispatchEvent(new Event('controllerchange'))
    })
    expect(result.current.updateReady).toBe(true)
    expect(reload).not.toHaveBeenCalled()
    unmount()
  })

  it('applyUpdate hands over to the waiting worker and reloads exactly once', async () => {
    const sw = installContainer()
    controlled(sw)
    const waiting = new FakeWorker('installed')
    sw.registration.waiting = waiting
    const { registerServiceWorker, applyUpdate } = await load()
    registerServiceWorker()
    await flush()

    applyUpdate()
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    expect(reload).not.toHaveBeenCalled()
    sw.dispatchEvent(new Event('controllerchange'))
    sw.dispatchEvent(new Event('controllerchange'))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('applyUpdate still reloads if control never changes hands', async () => {
    const sw = installContainer()
    controlled(sw)
    sw.registration.waiting = new FakeWorker('installed')
    const { registerServiceWorker, applyUpdate } = await load()
    registerServiceWorker()
    await flush()
    applyUpdate()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(reload).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('applyUpdate just reloads when the new build already took over', async () => {
    const sw = installContainer()
    controlled(sw)
    const { registerServiceWorker, applyUpdate } = await load()
    registerServiceWorker()
    await flush()
    applyUpdate()
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('update checks', () => {
  const MINUTE = 60_000

  async function registered() {
    const sw = installContainer()
    controlled(sw)
    const mod = await load()
    mod.registerServiceWorker()
    await flush()
    return sw.registration
  }

  it('checks on resume, focus and bfcache restores — at most every 30 minutes', async () => {
    const reg = await registered()
    // register() itself just fetched the script.
    document.dispatchEvent(new Event('visibilitychange'))
    expect(reg.update).not.toHaveBeenCalled()

    vi.setSystemTime(Date.now() + 31 * MINUTE)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(reg.update).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event('focus'))
    expect(reg.update).toHaveBeenCalledTimes(1)

    vi.setSystemTime(Date.now() + 31 * MINUTE)
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }))
    expect(reg.update).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    expect(reg.update).toHaveBeenCalledTimes(2)

    vi.setSystemTime(Date.now() + 31 * MINUTE)
    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(reg.update).toHaveBeenCalledTimes(2)
    window.dispatchEvent(new Event('focus'))
    expect(reg.update).toHaveBeenCalledTimes(3)
  })

  it('checks hourly while the app stays open and visible', async () => {
    const reg = await registered()
    await vi.advanceTimersByTimeAsync(60 * MINUTE)
    expect(reg.update).toHaveBeenCalledTimes(1)
    visibility = 'hidden'
    await vi.advanceTimersByTimeAsync(60 * MINUTE)
    expect(reg.update).toHaveBeenCalledTimes(1)
    visibility = 'visible'
    await vi.advanceTimersByTimeAsync(60 * MINUTE)
    expect(reg.update).toHaveBeenCalledTimes(2)
  })

  it('shrugs off a failed check (offline)', async () => {
    const reg = await registered()
    reg.update.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')))
    vi.setSystemTime(Date.now() + 31 * MINUTE)
    window.dispatchEvent(new Event('focus'))
    await flush()
    expect(reg.update).toHaveBeenCalledTimes(1)
  })
})

describe('cache warming', () => {
  function stubResources(names: string[]) {
    Object.defineProperty(performance, 'getEntriesByType', {
      configurable: true,
      value: vi.fn((type: string) => (type === 'resource' ? names.map((name) => ({ name })) : [])),
    })
  }

  function addTag(tag: 'script' | 'link', url: string) {
    const el = document.createElement(tag)
    if (tag === 'script') (el as HTMLScriptElement).src = url
    else (el as HTMLLinkElement).href = url
    document.head.appendChild(el)
  }

  it("hands the active worker this page's build files, and nothing else", async () => {
    stubResources([
      `${ORIGIN}/_next/static/chunks/index-abc.js`,
      `${ORIGIN}/_next/static/css/layout.123.css?v=1#x`,
      'https://cdn.example/_next/static/chunks/foreign.js',
      `${ORIGIN}/workspace/icons/icon-192.png`,
      `${ORIGIN}/_next/static/chunks/index-abc.js`,
    ])
    addTag('script', '/_next/static/chunks/framework-def.js')
    addTag('link', '/_next/static/media/inter.woff2')
    addTag('link', 'https://fonts.example/inter.css')

    const sw = installContainer()
    const active = controlled(sw)
    const { registerServiceWorker } = await load()
    registerServiceWorker()
    await flush()

    expect(active.postMessage).toHaveBeenCalledTimes(1)
    expect(active.postMessage).toHaveBeenCalledWith({
      type: 'CACHE_URLS',
      urls: [
        `${ORIGIN}/_next/static/chunks/index-abc.js`,
        `${ORIGIN}/_next/static/css/layout.123.css?v=1`,
        `${ORIGIN}/_next/static/chunks/framework-def.js`,
        `${ORIGIN}/_next/static/media/inter.woff2`,
      ],
    })
  })

  it('warms a first install once it activates, then only what loaded since', async () => {
    stubResources([`${ORIGIN}/_next/static/chunks/index-abc.js`])
    const sw = installContainer()
    const first = new FakeWorker('installing')
    sw.registration.installing = first
    const { registerServiceWorker } = await load()
    registerServiceWorker()
    await flush()
    expect(first.postMessage).not.toHaveBeenCalled()

    sw.registration.activate(first)
    expect(first.postMessage).toHaveBeenCalledWith({
      type: 'CACHE_URLS',
      urls: [`${ORIGIN}/_next/static/chunks/index-abc.js`],
    })

    // The idle prefetch of the main tabs lands a few chunks more.
    addTag('script', '/_next/static/chunks/Projects-123.js')
    await vi.advanceTimersByTimeAsync(15_000)
    expect(first.postMessage).toHaveBeenCalledTimes(2)
    expect(first.postMessage).toHaveBeenLastCalledWith({
      type: 'CACHE_URLS',
      urls: [`${ORIGIN}/_next/static/chunks/Projects-123.js`],
    })
  })
})

describe('vite:preloadError (a deploy removed the chunks this page asks for)', () => {
  const preloadError = () => new Event('vite:preloadError', { cancelable: true })

  it('reloads into the new build and swallows the error', async () => {
    const { registerServiceWorker } = await load()
    registerServiceWorker()
    const event = preloadError()
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('never loops: one reload a minute at most', async () => {
    const { registerServiceWorker } = await load()
    registerServiceWorker()
    window.dispatchEvent(preloadError())
    expect(reload).toHaveBeenCalledTimes(1)

    // The reloaded page fails again straight away: let the error through.
    const again = preloadError()
    window.dispatchEvent(again)
    expect(again.defaultPrevented).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)

    vi.setSystemTime(Date.now() + 61_000)
    window.dispatchEvent(preloadError())
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('remembers the last reload across page loads', async () => {
    window.sessionStorage.setItem('deskdev:preload-reload', String(Date.now() - 5_000))
    const { registerServiceWorker } = await load()
    registerServiceWorker()
    const event = preloadError()
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('leaves the error alone while offline', async () => {
    shadow(navigator, 'onLine', () => false)
    const { registerServiceWorker } = await load()
    registerServiceWorker()
    const event = preloadError()
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('never reloads for a background prefetch, and recovers once it settles', async () => {
    const { registerServiceWorker, runBackgroundPrefetch } = await load()
    registerServiceWorker()
    let fail!: (err: Error) => void
    const swallowed = vi.fn()
    runBackgroundPrefetch([
      () =>
        new Promise((_, reject) => {
          fail = (err) => {
            // What Vite's preload helper does before the import rejects.
            const event = preloadError()
            window.dispatchEvent(event)
            swallowed(event.defaultPrevented)
            reject(err)
          }
        }),
      () => {
        throw new Error('sync failure')
      },
    ])
    fail(new Error('chunk gone'))
    await flush()
    expect(swallowed).toHaveBeenCalledWith(false)
    expect(reload).not.toHaveBeenCalled()

    // The route's own import failing afterwards still recovers.
    const event = preloadError()
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('activates a waiting build before reloading', async () => {
    const sw = installContainer()
    controlled(sw)
    const waiting = new FakeWorker('installed')
    sw.registration.waiting = waiting
    const { registerServiceWorker } = await load()
    registerServiceWorker()
    await flush()

    window.dispatchEvent(preloadError())
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    expect(reload).not.toHaveBeenCalled()
    sw.dispatchEvent(new Event('controllerchange'))
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('getRegistration', () => {
  it('resolves the active registration', async () => {
    const sw = installContainer()
    controlled(sw)
    const { registerServiceWorker, getRegistration } = await load()
    registerServiceWorker()
    await flush()
    await expect(getRegistration()).resolves.toBe(sw.registration)
  })

  it('resolves undefined when nothing is registered, instead of hanging like .ready', async () => {
    installContainer()
    const { getRegistration } = await load({ production: false })
    await expect(getRegistration()).resolves.toBeUndefined()
  })

  it("finds an earlier visit's registration for this page", async () => {
    const sw = installContainer()
    controlled(sw)
    sw.registered = true
    const { getRegistration } = await load({ production: false })
    await expect(getRegistration()).resolves.toBe(sw.registration)
    expect(sw.getRegistration).toHaveBeenCalledWith(window.location.href)
  })

  it('waits for a first install to activate', async () => {
    const sw = installContainer()
    const first = new FakeWorker('installing')
    sw.registration.installing = first
    const { registerServiceWorker, getRegistration } = await load()
    registerServiceWorker()
    await flush()

    let settled: ServiceWorkerRegistration | undefined | null = null
    void getRegistration().then((reg) => {
      settled = reg
    })
    await flush()
    expect(settled).toBeNull()
    sw.registration.activate(first)
    await flush()
    expect(settled).toBe(sw.registration)
  })

  it('stops waiting after a few seconds', async () => {
    const sw = installContainer()
    sw.registration.installing = new FakeWorker('installing')
    const { registerServiceWorker, getRegistration } = await load()
    registerServiceWorker()
    await flush()

    let settled: ServiceWorkerRegistration | undefined | null = null
    void getRegistration().then((reg) => {
      settled = reg
    })
    await vi.advanceTimersByTimeAsync(3_000)
    expect(settled).toBe(sw.registration)
  })
})

describe('onServiceWorkerMessage', () => {
  const navigate = { type: 'deskdev:navigate', url: `${ORIGIN}/workspace/messages/42` }

  it('hands messages that beat the first subscriber to it', async () => {
    const sw = installContainer()
    const { onServiceWorkerMessage } = await load()
    sw.dispatchEvent(new MessageEvent('message', { data: navigate }))
    const handler = vi.fn()
    const stop = onServiceWorkerMessage(handler)
    expect(handler).toHaveBeenCalledWith(navigate)
    stop()
  })

  it('delivers to every subscriber until it unsubscribes', async () => {
    const sw = installContainer()
    const { onServiceWorkerMessage } = await load()
    const first = vi.fn()
    const second = vi.fn()
    const stopFirst = onServiceWorkerMessage(first)
    const stopSecond = onServiceWorkerMessage(second)
    sw.dispatchEvent(new MessageEvent('message', { data: { type: 'ping' } }))
    stopFirst()
    sw.dispatchEvent(new MessageEvent('message', { data: navigate }))
    expect(first.mock.calls).toEqual([[{ type: 'ping' }]])
    expect(second.mock.calls).toEqual([[{ type: 'ping' }], [navigate]])
    stopSecond()
  })

  it('is a harmless no-op without service-worker support', async () => {
    const { onServiceWorkerMessage } = await load()
    const stop = onServiceWorkerMessage(vi.fn())
    expect(() => stop()).not.toThrow()
  })
})
