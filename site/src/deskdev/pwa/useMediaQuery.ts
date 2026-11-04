// Web-only (not mirrored to mobile). Live media-query and connectivity hooks.
// useSyncExternalStore keeps every reader in step with the browser and is safe
// to render without a window (it then reports the server snapshot).
import { useCallback, useSyncExternalStore } from 'react'
import { STANDALONE_QUERIES, isStandalone } from './platform'

/** Below Tailwind's md breakpoint — where DeskDev switches to the phone shell. */
export const PHONE_QUERY = '(max-width: 767.98px)'

const noop = () => {}

function supportsMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
}

// One MediaQueryList per query: getSnapshot runs on every render.
const lists = new Map<string, MediaQueryList>()

function mediaList(query: string): MediaQueryList | null {
  if (!supportsMatchMedia()) return null
  let list = lists.get(query)
  if (!list) {
    list = window.matchMedia(query)
    lists.set(query, list)
  }
  return list
}

function watch(list: MediaQueryList, onChange: () => void): () => void {
  // Safari before 14 only has the deprecated listener API.
  if (typeof list.addEventListener === 'function') {
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }
  list.addListener(onChange)
  return () => list.removeListener(onChange)
}

/** Whether `query` matches right now; false where matchMedia is missing. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = mediaList(query)
      return list ? watch(list, onChange) : noop
    },
    [query],
  )
  const getSnapshot = () => mediaList(query)?.matches ?? false
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

/** The phone shell: narrower than 768px. */
export function useIsPhone(): boolean {
  return useMediaQuery(PHONE_QUERY)
}

function subscribeStandalone(onChange: () => void): () => void {
  const stops = STANDALONE_QUERIES.map((query) => mediaList(query)).flatMap((list) => (list ? [watch(list, onChange)] : []))
  return () => stops.forEach((stop) => stop())
}

/**
 * Running as the installed app. Live: desktop Chrome moves the tab into an app
 * window when you install from it, flipping display-mode without a reload.
 */
export function useIsStandalone(): boolean {
  return useSyncExternalStore(subscribeStandalone, isStandalone, () => false)
}

/** A touch-first device (finger-sized targets, no hover). */
export function useCoarsePointer(): boolean {
  return useMediaQuery('(pointer: coarse)')
}

function subscribeOnline(onChange: () => void): () => void {
  if (typeof window === 'undefined') return noop
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

const onlineNow = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false)

/** navigator.onLine, kept live by the online/offline events. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, onlineNow, () => true)
}
