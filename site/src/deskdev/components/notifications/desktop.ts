import { createElement } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { speak, speechSupported } from '../messages/announce'
import { assetUrl, withBase } from '../../lib/basePath'
import { getRegistration } from '../../pwa/serviceWorker'
import { detectPlatform, isStandalone } from '../../pwa/platform'

/**
 * System notifications while DeskDev is running (a tab, or the installed app).
 *
 * They go through the service worker's registration.showNotification():
 * Android has no page Notification constructor at all, and iOS Home Screen
 * apps only display what a service worker shows. The worker's notificationclick
 * handler brings DeskDev forward and routes it. The page constructor is kept
 * only as the desktop fallback while no worker is active (the dev server, or
 * the moments before a first install). Alerts while DeskDev is closed are Web
 * Push — see pwa/push.ts.
 */

export type Permission = 'default' | 'granted' | 'denied' | 'unsupported'

export function notificationPermission(): Permission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission as Permission
}

/** Browsers only grant from a user gesture — call this from a click. */
export async function requestNotificationPermission(): Promise<Permission> {
  if (notificationPermission() === 'unsupported') return 'unsupported'
  try {
    return (await Notification.requestPermission()) as Permission
  } catch {
    return notificationPermission()
  }
}

export interface AlertInput {
  title: string
  body?: string
  /** Same tag replaces instead of stacking. */
  tag: string
  /** App path to open, e.g. '/messages/42' — no base path. */
  href: string
}

function trimBody(body: string | undefined): string | undefined {
  return body && body.length > 140 ? `${body.slice(0, 139)}…` : body
}

/**
 * Show one system notification. Resolves to whether one was shown. Clicking
 * it opens `href` in DeskDev (the worker routes it without a reload).
 */
export async function showDesktopNotification(opts: AlertInput): Promise<boolean> {
  if (notificationPermission() !== 'granted') return false
  const options = {
    body: trimBody(opts.body),
    // Tagging by subject means a burst replaces itself instead of stacking.
    tag: opts.tag,
    renotify: true,
    // Stay on screen until dismissed instead of auto-hiding into the
    // notification centre. Desktop Chrome/Edge honour this; Android, iOS and
    // Firefox ignore it (harmless there).
    requireInteraction: true,
    icon: assetUrl('/icons/icon-192.png'),
    // Android's status-bar glyph: white on transparent.
    badge: assetUrl('/icons/badge-96.png'),
    // App-relative: the worker resolves it against the base its scope implies.
    data: { url: opts.href },
  } as NotificationOptions

  const reg = await getRegistration()
  if (reg?.active) {
    try {
      await reg.showNotification(opts.title, options)
      return true
    } catch {
      // Permission revoked between the check and now, or a bad option.
    }
  }

  // Phones never had a usable page constructor: Android throws, iOS shows nothing.
  if (detectPlatform().isMobile) return false
  try {
    const n = new Notification(opts.title, options)
    n.onclick = () => {
      window.focus()
      window.location.assign(withBase(opts.href))
      n.close()
    }
    return true
  } catch {
    return false
  }
}

/**
 * Where an alert for something new should go. While someone is looking at
 * the installed app, or at DeskDev on a touch device, a system banner is
 * noise on top of the screen they're on — an in-app toast says the same thing.
 */
export function alertChannel(env: { visible: boolean; focused: boolean; standalone: boolean; coarse: boolean }): 'toast' | 'system' {
  return env.visible && env.focused && (env.standalone || env.coarse) ? 'toast' : 'system'
}

/** alertChannel() for this page, right now. */
export function currentAlertChannel(): 'toast' | 'system' {
  if (typeof document === 'undefined') return 'system'
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
  return alertChannel({
    visible: document.visibilityState === 'visible',
    focused: document.hasFocus(),
    standalone: isStandalone(),
    coarse,
  })
}

/** The in-app version: a toast that opens `href` when tapped. */
export function showInAppAlert(opts: AlertInput): void {
  const body = trimBody(opts.body)
  toast(
    () =>
      createElement(
        Link,
        {
          to: opts.href,
          // The toast's id is the alert's tag (same tag replaces instead of stacking).
          onClick: () => toast.dismiss(opts.tag),
          className: 'block min-h-11 -my-1 py-1 text-left',
        },
        createElement('span', { className: 'block font-semibold text-ink-50' }, opts.title),
        body ? createElement('span', { className: 'mt-0.5 block text-ink-200 line-clamp-2' }, body) : null,
      ),
    { id: opts.tag, duration: 6000 },
  )
}

/**
 * Fire a sample notification and announcement from a click.
 *
 * "It doesn't work" has several very different causes — permission, an OS
 * Do Not Disturb, speech never unlocking, or no message ever arriving. This
 * separates them: if the sample appears, the notification path is fine and the
 * problem is upstream in delivery. Resolves to what actually happened.
 */
export async function testNotification(voice: boolean): Promise<{ shown: boolean; spoke: boolean; reason?: string }> {
  const permission = notificationPermission()
  if (permission === 'unsupported') {
    const p = detectPlatform()
    return {
      shown: false,
      spoke: false,
      reason:
        p.os === 'ios' && !isStandalone()
          ? 'On iPhone and iPad, notifications work in the installed app. Add DeskDev to your Home Screen first.'
          : 'This browser has no Notifications API.',
    }
  }
  if (permission !== 'granted') return { shown: false, spoke: false, reason: 'Notifications are not allowed for DeskDev on this device.' }

  const shown = await showDesktopNotification({
    title: 'DeskDev Studio',
    body: 'Test notification — a new mention or message looks like this.',
    tag: 'deskdev-test',
    href: '/notifications',
  })
  if (!shown) {
    return {
      shown: false,
      spoke: false,
      reason: detectPlatform().isMobile
        ? 'The app’s background worker isn’t running yet. Reload DeskDev and try again.'
        : 'This browser could not show the notification.',
    }
  }

  if (!voice) return { shown, spoke: false }
  if (!speechSupported()) return { shown, spoke: false, reason: 'This browser has no speech synthesis.' }
  speak('Boss, this is a test announcement')
  return { shown, spoke: true }
}
