import { useState } from 'react'

/**
 * Runs `reset` during render on the first render and whenever any of `deps`
 * changes (compared with Object.is, like an effect's deps).
 *
 * This is React's "adjust state when a prop changes" pattern, used by the
 * modals to re-seed their form each time they open. Unlike doing it in a
 * useEffect, there is no painted frame of stale values and no second commit.
 * `reset` must only set this component's own state — no other side effects.
 * Every dep must be stable between renders (a primitive or a stored object),
 * or the reset would loop.
 */
export function useResetOnChange(deps: readonly unknown[], reset: () => void): void {
  const [prev, setPrev] = useState<readonly unknown[] | null>(null)
  const changed =
    prev === null ||
    prev.length !== deps.length ||
    deps.some((dep, i) => !Object.is(dep, prev[i]))
  if (changed) {
    setPrev(deps)
    reset()
  }
}
