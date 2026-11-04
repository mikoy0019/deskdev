import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root as ReactRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A render error that AppErrorBoundary catches raises no window 'error' event,
// so the boundary's own report is the only one a crashed screen ever sends.
// These cases render a component that throws, the way a broken screen would,
// and look at what leaves the browser. They fail if the boundary stops calling
// its reporter, if reportBoundaryErrors() stops setting one, or if Root.tsx
// stops calling reportBoundaryErrors() before the first render.

// Each case loads the boundary afresh (the reporter keeps per-page-load state,
// so the modules are reset), and that import, icon set included, is inside
// the test. On a busy machine or a small CI runner it alone can pass the
// default five seconds.
vi.setConfig({ testTimeout: 30_000 })

type Post = { url: string; body: Record<string, unknown> }

let fetchMock: ReturnType<typeof vi.fn>
let container: HTMLElement
let root: ReactRoot | null = null
let windowErrors: number

const countWindowError = () => {
  windowErrors += 1
}

function posts(): Post[] {
  return fetchMock.mock.calls.map(([url, init]) => ({
    url: String(url),
    body: JSON.parse(String((init as RequestInit).body)),
  }))
}

function Broken({ message }: { message: string }): ReactNode {
  throw new TypeError(message)
}

/** Renders a screen that throws under the boundary, as App.tsx wraps every screen. */
async function crash(message: string): Promise<void> {
  const { default: AppErrorBoundary } = await import('./components/AppErrorBoundary')
  root = createRoot(container)
  await act(async () => {
    root!.render(createElement(AppErrorBoundary, null, createElement(Broken, { message })))
  })
}

beforeEach(() => {
  // The reporter counts and remembers per page load: each case gets its own.
  vi.resetModules()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 204 }))
  vi.stubGlobal('fetch', fetchMock)
  // React and the boundary both print the error they caught.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  window.history.replaceState(null, '', '/workspace/tasks?assignee=ada@example.com')
  container = document.createElement('div')
  document.body.appendChild(container)
  windowErrors = 0
  window.addEventListener('error', countWindowError)
  window.addEventListener('unhandledrejection', countWindowError)
})

afterEach(async () => {
  window.removeEventListener('error', countWindowError)
  window.removeEventListener('unhandledrejection', countWindowError)
  if (root) await act(async () => root!.unmount())
  root = null
  container.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.doUnmock('./App')
  vi.doUnmock('./errorReporting')
})

describe('reportBoundaryErrors', () => {
  it('reports a render crash caught by AppErrorBoundary: one post, from the workspace, as a boundary error', async () => {
    const { reportBoundaryErrors } = await import('./errorReporting')
    reportBoundaryErrors()

    await crash('Cannot read properties of undefined')

    // The fallback is on screen, and nothing reached the window listeners.
    expect(container.textContent).toContain('Something went wrong')
    expect(windowErrors).toBe(0)

    const sent = posts()
    expect(sent).toHaveLength(1)
    expect(sent[0].url).toBe('/api/client-errors')
    expect(sent[0].body).toMatchObject({
      app: 'workspace',
      kind: 'boundary',
      name: 'TypeError',
      message: 'Cannot read properties of undefined',
      path: '/workspace/tasks',
    })
    // The digest the screen shows is the one the report carries.
    expect(container.textContent).toContain(String(sent[0].body.digest))
    // Path only: the query string stays in the browser.
    expect(JSON.stringify(sent[0].body)).not.toContain('ada@example.com')
  })

  it('is what sends it: a boundary with no reporter set shows the fallback and posts nothing', async () => {
    const { setErrorReporter } = await import('./components/AppErrorBoundary')
    setErrorReporter(null)

    await crash('nobody is told')

    expect(container.textContent).toContain('Something went wrong')
    expect(posts()).toEqual([])
  })

  it('calls the reporter straight from componentDidCatch, with the error React caught', async () => {
    const { default: AppErrorBoundary, setErrorReporter } = await import('./components/AppErrorBoundary')
    const reporter = vi.fn()
    setErrorReporter(reporter)
    const error = new Error('x')
    const info = { componentStack: '\n    at Broken' }

    new AppErrorBoundary({ children: null }).componentDidCatch(error, info)

    expect(reporter).toHaveBeenCalledExactlyOnceWith(error, info)
  })
})

describe('Root.tsx', () => {
  it('arms the boundary reporter when the module loads, before anything renders', async () => {
    const reportBoundaryErrors = vi.fn()
    const watchWindowErrors = vi.fn(() => () => {})
    vi.doMock('./errorReporting', () => ({ reportBoundaryErrors, watchWindowErrors }))
    // The whole app is not needed to see what Root does on import.
    vi.doMock('./App', () => ({ default: () => null }))

    await import('./Root')

    // An effect would be too late: componentDidCatch runs in the commit, ahead
    // of every effect, so a first-render crash would find no reporter.
    expect(reportBoundaryErrors).toHaveBeenCalledTimes(1)
    expect(watchWindowErrors).not.toHaveBeenCalled()
  })
})
