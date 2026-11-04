// Web-only (not mirrored to mobile). Converting between full URLs and router
// paths. BASE_PATH is '' on DeskDev's own subdomain and '/workspace' where it
// is a route of the site (lib/basePath.ts decides from the host).
import { BASE_PATH } from '../lib/basePath'

function insideBase(pathname: string): boolean {
  return !BASE_PATH || pathname === BASE_PATH || pathname.startsWith(`${BASE_PATH}/`)
}

/** '/workspace/tasks' → '/tasks' and '/workspace' → '/' (with BASE_PATH '/workspace'). */
export function stripBase(pathname: string): string {
  if (!BASE_PATH || !insideBase(pathname)) return pathname || '/'
  return pathname.slice(BASE_PATH.length) || '/'
}

/**
 * A router path with the base in front. The app root is the bare base:
 * '/workspace/' 308-redirects to '/workspace', and a manifest or worker scope
 * of '/workspace' wouldn't match the slashed form anyway.
 */
function baseJoin(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  if (!BASE_PATH) return p
  if (p === '/' || p.startsWith('/?') || p.startsWith('/#')) return `${BASE_PATH}${p.slice(1)}`
  return `${BASE_PATH}${p}`
}

/** Absolute URL of an app path: '/tasks' → 'https://host/workspace/tasks'. */
export function appUrl(path: string): string {
  return `${window.location.origin}${baseJoin(path)}`
}

/**
 * Origin plus base, without a trailing slash — e.g.
 * 'https://workspace.nixgensolutions.com'. Push subscriptions store it so the
 * server can build links that land in this install.
 */
export function appBase(): string {
  return `${window.location.origin}${BASE_PATH}`
}

/**
 * The router path (with search and hash) for a URL inside this app, or null
 * for anything else — another origin, or a same-origin page outside the base.
 * Used to route service-worker and launch-queue URLs without a reload.
 */
export function appPathFromUrl(url: string, from: string = window.location.href): string | null {
  let target: URL
  let current: URL
  try {
    current = new URL(from)
    target = new URL(url, current)
  } catch {
    return null
  }
  if (target.origin !== current.origin || !insideBase(target.pathname)) return null
  return `${stripBase(target.pathname)}${target.search}${target.hash}`
}
