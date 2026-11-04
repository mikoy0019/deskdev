import { useEffect, useState } from 'react'

/**
 * "Has this view already played its entrance in this session?" A route the
 * user opens tens of times a day earns its stagger / count-up once; every
 * later visit renders instantly. Keys live for the page session (a reload
 * starts fresh — that is a genuine first load again).
 */

const seen = new Set<string>()

export function hasVisited(key: string): boolean {
  return seen.has(key)
}

export function markVisited(key: string): void {
  seen.add(key)
}

/** Test helper: forget every key. */
export function resetVisits(): void {
  seen.clear()
}

/**
 * True for the whole life of the first mounted instance of `key` this
 * session, false for later mounts. Read at render, recorded at commit, so
 * StrictMode's double render and effect replay can't flip it.
 */
export function useFirstVisit(key: string | undefined): boolean {
  const [first] = useState(() => key !== undefined && !seen.has(key))
  useEffect(() => {
    if (key !== undefined) seen.add(key)
  }, [key])
  return first
}
