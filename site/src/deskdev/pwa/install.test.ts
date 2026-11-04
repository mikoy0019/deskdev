import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type InstallModule = typeof import('./install')
type Choice = { outcome: 'accepted' | 'dismissed'; platform: string }
type InstallWindow = Window & { __ddBip?: Event; __ddInstalled?: boolean; IS_REACT_ACT_ENVIRONMENT?: boolean }

const w = window as InstallWindow
w.IS_REACT_ACT_ENVIRONMENT = true

/** Chrome's event, minus the browser: prompt() and userChoice are driven by the test. */
class FakePromptEvent extends Event {
  readonly platforms = ['web']
  readonly userChoice: Promise<Choice>
  readonly prompt = vi.fn(() => Promise.resolve())
  private settle!: (choice: Choice) => void

  constructor() {
    super('beforeinstallprompt', { cancelable: true })
    this.userChoice = new Promise((resolve) => {
      this.settle = resolve
    })
  }

  choose(outcome: Choice['outcome']) {
    this.settle({ outcome, platform: 'web' })
  }
}

/** What the workspace layout's <head> script does on beforeinstallprompt. */
function headScriptCatches(event: FakePromptEvent) {
  event.preventDefault()
  w.__ddBip = event
  window.dispatchEvent(new Event('dd:bip'))
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

// Every test gets a fresh module (its state is module-level); the listeners
// each copy adds to window are removed again so they can't react to later tests.
const added: [string, EventListenerOrEventListenerObject][] = []
let mod: InstallModule

async function load(): Promise<InstallModule> {
  vi.resetModules()
  mod = await import('./install')
  return mod
}

beforeEach(() => {
  const original = window.addEventListener.bind(window)
  // As a plain EventTarget: Window's overloads defeat mockImplementation's typing.
  vi.spyOn(window as EventTarget, 'addEventListener').mockImplementation(
    (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) => {
      if (!listener) return
      added.push([type, listener])
      original(type, listener, options)
    },
  )
  delete w.__ddBip
  delete w.__ddInstalled
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  for (const [type, listener] of added.splice(0)) window.removeEventListener(type, listener)
  delete w.__ddBip
  delete w.__ddInstalled
})

describe('initInstallPrompt', () => {
  it('adopts a prompt the <head> script caught before the app loaded', async () => {
    const event = new FakePromptEvent()
    w.__ddBip = event
    const { initInstallPrompt, useInstallPrompt } = await load()
    initInstallPrompt()
    const { result, unmount } = renderHook(useInstallPrompt)
    expect(result.current).toMatchObject({ canPrompt: true, installed: false })
    unmount()
  })

  it('adopts an install the <head> script saw', async () => {
    w.__ddInstalled = true
    const { initInstallPrompt, useInstallPrompt } = await load()
    initInstallPrompt()
    const { result, unmount } = renderHook(useInstallPrompt)
    expect(result.current).toMatchObject({ canPrompt: false, installed: true })
    unmount()
  })

  it('is idempotent', async () => {
    const { initInstallPrompt } = await load()
    initInstallPrompt()
    const count = added.length
    initInstallPrompt()
    initInstallPrompt()
    expect(added.length).toBe(count)
  })

  it('picks up prompts relayed later through dd:bip', async () => {
    const { initInstallPrompt, useInstallPrompt } = await load()
    initInstallPrompt()
    const { result, unmount } = renderHook(useInstallPrompt)
    expect(result.current.canPrompt).toBe(false)
    act(() => headScriptCatches(new FakePromptEvent()))
    expect(result.current.canPrompt).toBe(true)
    unmount()
  })

  it('catches the native event itself when the <head> script is missing', async () => {
    const { initInstallPrompt, useInstallPrompt } = await load()
    initInstallPrompt()
    const { result, unmount } = renderHook(useInstallPrompt)
    const event = new FakePromptEvent()
    act(() => {
      window.dispatchEvent(event)
    })
    // No mini-infobar: Chrome's own UI is suppressed.
    expect(event.defaultPrevented).toBe(true)
    expect(result.current.canPrompt).toBe(true)
    unmount()
  })

  it('marks the app installed on appinstalled and drops the prompt', async () => {
    const { initInstallPrompt, useInstallPrompt } = await load()
    initInstallPrompt()
    const { result, unmount } = renderHook(useInstallPrompt)
    act(() => headScriptCatches(new FakePromptEvent()))
    act(() => {
      w.__ddInstalled = true
      w.__ddBip = undefined
      window.dispatchEvent(new Event('dd:appinstalled'))
    })
    expect(result.current).toMatchObject({ canPrompt: false, installed: true })
    await expect(result.current.promptInstall()).resolves.toBe('unavailable')
    unmount()
  })

  it('also hears the native appinstalled event', async () => {
    const { initInstallPrompt, useInstallPrompt } = await load()
    initInstallPrompt()
    const { result, unmount } = renderHook(useInstallPrompt)
    act(() => {
      window.dispatchEvent(new Event('appinstalled'))
    })
    expect(result.current.installed).toBe(true)
    unmount()
  })
})

describe('promptInstall', () => {
  it("is 'unavailable' without a stashed event", async () => {
    const { initInstallPrompt, promptInstall } = await load()
    initInstallPrompt()
    await expect(promptInstall()).resolves.toBe('unavailable')
  })

  it('calls prompt() synchronously, inside the click', async () => {
    const event = new FakePromptEvent()
    w.__ddBip = event
    const { initInstallPrompt, promptInstall } = await load()
    initInstallPrompt()
    const pending = promptInstall()
    // Before any await: user activation would be gone after one.
    expect(event.prompt).toHaveBeenCalledTimes(1)
    event.choose('accepted')
    await expect(pending).resolves.toBe('accepted')
  })

  it("reports 'accepted' and uses the event up", async () => {
    const event = new FakePromptEvent()
    w.__ddBip = event
    const { initInstallPrompt, useInstallPrompt } = await load()
    initInstallPrompt()
    const { result, unmount } = renderHook(useInstallPrompt)
    let pending!: Promise<string>
    act(() => {
      pending = result.current.promptInstall()
    })
    event.choose('accepted')
    await expect(pending).resolves.toBe('accepted')
    expect(result.current.canPrompt).toBe(false)
    expect(w.__ddBip).toBeUndefined()
    await expect(result.current.promptInstall()).resolves.toBe('unavailable')
    expect(event.prompt).toHaveBeenCalledTimes(1)
    unmount()
  })

  it("reports 'dismissed', then offers the fresh event Chrome sends", async () => {
    const first = new FakePromptEvent()
    w.__ddBip = first
    const { initInstallPrompt, useInstallPrompt } = await load()
    initInstallPrompt()
    const { result, unmount } = renderHook(useInstallPrompt)
    let pending!: Promise<string>
    act(() => {
      pending = result.current.promptInstall()
    })
    first.choose('dismissed')
    await expect(pending).resolves.toBe('dismissed')
    expect(result.current.canPrompt).toBe(false)

    const second = new FakePromptEvent()
    act(() => headScriptCatches(second))
    expect(result.current.canPrompt).toBe(true)
    let again!: Promise<string>
    act(() => {
      again = result.current.promptInstall()
    })
    expect(second.prompt).toHaveBeenCalledTimes(1)
    second.choose('accepted')
    await expect(again).resolves.toBe('accepted')
    unmount()
  })

  it('keeps the event when prompt() is refused without a user gesture', async () => {
    const event = new FakePromptEvent()
    event.prompt.mockImplementation(() => Promise.reject(new DOMException('needs a gesture', 'NotAllowedError')))
    w.__ddBip = event
    const { initInstallPrompt, useInstallPrompt } = await load()
    initInstallPrompt()
    const { result, unmount } = renderHook(useInstallPrompt)
    let pending!: Promise<string>
    act(() => {
      pending = result.current.promptInstall()
    })
    await act(async () => {
      await expect(pending).resolves.toBe('unavailable')
    })
    expect(result.current.canPrompt).toBe(true)
    unmount()
  })

  it("is 'unavailable' when prompt() throws", async () => {
    const event = new FakePromptEvent()
    event.prompt.mockImplementation(() => {
      throw new DOMException('already used', 'InvalidStateError')
    })
    w.__ddBip = event
    const { initInstallPrompt, promptInstall } = await load()
    initInstallPrompt()
    await expect(promptInstall()).resolves.toBe('unavailable')
  })
})

describe('useInstallPrompt in the installed app', () => {
  it('reports installed and never offers a prompt', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === '(display-mode: standalone)',
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    )
    w.__ddBip = new FakePromptEvent()
    const { initInstallPrompt, useInstallPrompt } = await load()
    initInstallPrompt()
    const { result, unmount } = renderHook(useInstallPrompt)
    expect(result.current).toMatchObject({ canPrompt: false, installed: true })
    unmount()
  })
})
