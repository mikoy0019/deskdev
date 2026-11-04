// The web side of the platform seam. The store and the shared lib files
// (mirrored byte-for-byte to mobile/src/lib, scripts/check-shared-drift.mjs)
// reach the browser only through this module; mobile/src/lib/platform.ts
// exports the same names for React Native. Keep the two in step.

import { SITE_ORIGIN as SITE_FROM_HOSTS } from '../../lib/hosts'

/**
 * The public site's origin (nixgensolutions.com), for links customers open:
 * quick forms, the booking page. Null on a deployment without the host split
 * — the site is then this origin.
 */
export const SITE_ORIGIN: string | null = SITE_FROM_HOSTS

/** Where the persisted store lives: localStorage, never throwing (full or blocked storage). */
export function persistStorage() {
  return {
    getItem: (k: string) => localStorage.getItem(k),
    setItem: (k: string, v: string) => {
      try {
        localStorage.setItem(k, v)
      } catch (err) {
        console.warn('[store] persist failed:', err)
      }
    },
    removeItem: (k: string) => localStorage.removeItem(k),
  }
}

/**
 * This device's part of signing out, before the session goes: its push row
 * (while the session can still delete it) and the app badge. Bounded: sign-out
 * never waits on it for long.
 */
export async function signOutCleanup(): Promise<void> {
  const push = import('../pwa/push').then((m) => m.disablePush({ unsubscribe: false })).catch(() => undefined)
  await Promise.race([push, new Promise<void>((r) => setTimeout(r, 3000))])
  await import('../pwa/useAppBadge').then((m) => m.clearAppBadge()).catch(() => undefined)
}

/** A random UUID v4 — every row id the app creates. */
export function newId(): string {
  return crypto.randomUUID()
}

/** Cryptographically random bytes. */
export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length))
}

/** Lowercase hex SHA-256 of the UTF-8 text. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
