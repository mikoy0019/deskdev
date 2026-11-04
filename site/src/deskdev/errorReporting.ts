// Web-only (not mirrored to mobile). Connects DeskDev to the browser error
// reporter it shares with the marketing site (src/lib/clientErrors.ts), which
// posts a scrubbed report to /api/client-errors on DeskDev's own host. The
// limits (five a page load, each error once, silent offline) and the Vault
// rule (name and digest only) live there, so this file is wiring.
import { installClientErrorListeners, reportClientError } from '../lib/clientErrors'
import { setErrorReporter } from './components/AppErrorBoundary'

/**
 * What AppErrorBoundary catches. Call when the app's first module loads, not
 * from an effect (see setErrorReporter). React's component stack stays in the
 * console: the server keeps the error's own stack only.
 */
export function reportBoundaryErrors(): void {
  setErrorReporter((error) => reportClientError(error, { app: 'workspace', kind: 'boundary' }))
}

/**
 * What no boundary catches: errors in event handlers and timers, and rejected
 * promises nobody awaited (a failed write, a screen's chunk that would not
 * load). Returns the function that stops listening.
 */
export function watchWindowErrors(): () => void {
  return installClientErrorListeners('workspace')
}
