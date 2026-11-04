// Web-only (not mirrored to mobile). Where DeskDev's routes live, which depends
// on the host (see src/lib/hosts.ts): the root of its own subdomain in
// production, /workspace when it's a route of the site (local dev, previews).
// The router handles in-app links via its basename; use withBase() only for
// routes reached outside the router — full-page navigations, email redirects.
import { isWorkspaceHost } from '../../lib/hosts'

// DeskDev renders client-side only (Mount.tsx), so `window` is always there.
export const BASE_PATH =
  typeof window !== 'undefined' && isWorkspaceHost(window.location.host) ? '' : '/workspace'

export function withBase(path: string): string {
  return `${BASE_PATH}${path}`
}

/** Files in public/workspace/ — served at /workspace/* on every host. */
export function assetUrl(path: string): string {
  return `/workspace${path}`
}
