import { Component, lazy, type ComponentType, type ReactNode } from 'react'

/**
 * A route's code could not be fetched (offline, or a deploy removed the file).
 * Typed so the route boundary can tell it from a bug in the screen itself.
 */
export class ChunkLoadError extends Error {
  constructor(cause?: unknown) {
    super('This screen could not be loaded')
    this.name = 'ChunkLoadError'
    this.cause = cause
  }
}

// What browsers and bundlers say when a dynamic import's file can't be fetched.
const FETCH_FAILURE =
  /dynamically imported module|importing a module script failed|loading chunk|chunkloaderror|failed to fetch|load failed|networkerror/i

/** A failed import that is about the network, not about the module's own code. */
export function isChunkLoadFailure(err: unknown, online: boolean): boolean {
  if (err instanceof ChunkLoadError) return true
  if (!online) return true
  const message = err instanceof Error ? `${err.name} ${err.message}` : String(err)
  return FETCH_FAILURE.test(message)
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

/**
 * Runs a dynamic import, trying once more after a short pause (a dropped
 * request on a train is the common case). A fetch failure that survives the
 * retry rejects with ChunkLoadError; an error thrown by the module itself is
 * passed through untouched.
 */
export async function importWithRetry<T>(
  load: () => Promise<T>,
  { retries = 1, delayMs = 400, online = isOnline }: { retries?: number; delayMs?: number; online?: () => boolean } = {},
): Promise<T> {
  let attempt = 0
  for (;;) {
    try {
      return await load()
    } catch (err) {
      if (!isChunkLoadFailure(err, online())) throw err
      if (attempt >= retries) throw new ChunkLoadError(err)
      attempt++
      await wait(delayMs)
    }
  }
}

type PageModule = { default: ComponentType }

// React.lazy keeps a failed import for good, so each page whose load failed
// leaves a way to swap in a fresh one here (reset), with its import to try.
const failedPages = new Map<() => void, () => Promise<unknown>>()

/**
 * Tries the import of every page that failed to load. The ones that load now
 * are reset, so they render on their next visit; true when none is left.
 */
export async function retryFailedPages(): Promise<boolean> {
  const entries = [...failedPages]
  const results = await Promise.allSettled(entries.map(([, load]) => load()))
  entries.forEach(([reset], i) => {
    if (results[i].status !== 'fulfilled') return
    failedPages.delete(reset)
    reset()
  })
  return failedPages.size === 0
}

/**
 * `lazy()` for a route: retries the import once, fails with ChunkLoadError,
 * and can be tried again later (RouteBoundary's Retry, or the connection
 * coming back).
 */
export function lazyPage(load: () => Promise<PageModule>): ComponentType {
  const make = () =>
    lazy(() =>
      importWithRetry(load).catch((err: unknown) => {
        failedPages.set(reset, load)
        throw err
      }),
    )
  let Page = make()
  function reset() {
    Page = make()
  }
  return function LazyPage() {
    const Current = Page
    return <Current />
  }
}

if (typeof window !== 'undefined') {
  // Back online: a screen that failed while offline loads on its next visit.
  window.addEventListener('online', () => void retryFailedPages())
}

interface BoundaryProps {
  children: ReactNode
  /** Rendered in place of the screen when its code can't be loaded. */
  fallback: (retry: () => void) => ReactNode
}

/**
 * Sits around one lazy route. A screen whose code can't be fetched shows a
 * message with a retry in its own place, inside the app shell, instead of
 * taking the whole app down to the "Something went wrong" screen. Any other
 * error is rethrown to the app-wide boundary.
 */
export class RouteBoundary extends Component<BoundaryProps, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  private mounted = false

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidMount(): void {
    this.mounted = true
    window.addEventListener('online', this.onOnline)
  }

  componentWillUnmount(): void {
    this.mounted = false
    window.removeEventListener('online', this.onOnline)
  }

  /** The connection is back: show the screen if its code loads now. */
  onOnline = (): void => {
    if (!this.state.error) return
    void retryFailedPages().then((loaded) => {
      if (loaded && this.mounted) this.setState({ error: null })
    })
  }

  /** The Retry button. */
  retry = (): void => {
    if (!this.state.error) return
    void retryFailedPages().then((loaded) => {
      if (loaded) {
        if (this.mounted) this.setState({ error: null })
        return
      }
      // Chromium keeps a failed import for the life of the page and never
      // fetches it again, so with a connection only a reload can load the
      // screen. Offline there is nothing to fetch: stay on the message.
      if (isOnline()) window.location.reload()
    })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    if (!(error instanceof ChunkLoadError)) throw error
    return this.props.fallback(this.retry)
  }
}
