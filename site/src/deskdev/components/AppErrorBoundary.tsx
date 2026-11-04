import { Component, type ErrorInfo, type ReactNode } from 'react'
import { WarningIcon } from '@phosphor-icons/react'
// The site's lib, not DeskDev's mirrored one: the reporter is web-only.
import { clientErrorDigest } from '../../lib/clientErrors'

type ErrorReporter = (error: Error, info: ErrorInfo) => void

// App-wide error-reporting hook point. errorReporting.ts sets it when Root.tsx
// loads, before the first render: componentDidCatch runs in the commit, ahead
// of every effect, so a reporter set from an effect would miss a first-render
// crash.
let reporter: ErrorReporter | null = null

export function setErrorReporter(fn: ErrorReporter | null): void {
  reporter = fn
}

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Catches render/lifecycle errors anywhere below it and shows a designed
 * fallback instead of a white screen. Class component on purpose — error
 * boundaries have no hook equivalent, and we don't want a dependency for it.
 */
export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[deskdev] Uncaught render error', error, info.componentStack)
    reporter?.(error, info)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      // min-h-dvh + safe-area padding: this can be the whole screen of the installed app.
      <div className="min-h-dvh flex items-center justify-center bg-ink-900 px-[max(1rem,var(--safe-left),var(--safe-right))] pt-[max(1rem,var(--safe-top))] pb-[max(1rem,var(--safe-bottom))]">
        <div className="card w-full max-w-md p-8 text-center">
          <div className="mx-auto size-12 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center">
            <WarningIcon size={22} className="text-rose-600 dark:text-rose-400" aria-hidden />
          </div>
          <h1 className="mt-4 text-display text-xl font-semibold text-ink-50">Something went wrong</h1>
          <p className="mt-2 text-sm text-ink-200">
            An unexpected error broke this screen. Reloading usually fixes it — your data is safe.
          </p>
          <div className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-ink-700/60 border border-ink-600 px-3 py-1.5 font-mono text-[11px]">
            <span className="text-ink-300">digest</span>
            {/* The id the report carries, so a digest someone quotes finds its log line. */}
            <span className="text-ink-100">{clientErrorDigest(error)}</span>
          </div>
          <div>
            <button type="button" className="btn-primary mt-5 pointer-coarse:min-h-[44px]" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      </div>
    )
  }
}
