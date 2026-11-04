// Web-only (not mirrored to mobile). The number on the app icon: unread
// notifications plus unread chat messages. Works in installed apps on iOS
// 16.4+ (once notifications are allowed) and on desktop; Android ignores it
// and shows a notification dot instead.
import { useEffect, useMemo } from 'react'
import { useStore } from '../store/useStore'
import { useUnreadMessageCount } from '../components/messages/useUnreadMessageCount'

function badgeSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.setAppBadge === 'function'
}

/**
 * DeskDev for Windows (desktop/) hosts this app in WebView2, which has no
 * app badge. Its window listens for this message instead and puts the count
 * on its taskbar button (desktop/TaskbarBadge.cs). Null in a browser.
 */
function desktopHost(): { postMessage: (message: unknown) => void } | null {
  if (typeof window === 'undefined') return null
  const host = (window as unknown as { chrome?: { webview?: { postMessage?: unknown } } }).chrome?.webview
  return host && typeof host.postMessage === 'function' ? (host as { postMessage: (message: unknown) => void }) : null
}

function tellDesktop(count: number): void {
  try {
    desktopHost()?.postMessage({ type: 'deskdev:badge', count })
  } catch {
    // The host went away (window closing): nothing to show it on.
  }
}

function setAppBadge(count: number): void {
  tellDesktop(count)
  if (!badgeSupported()) return
  try {
    void navigator.setAppBadge(count).catch(() => {})
  } catch {
    // Permission not granted yet (iOS) or the call is blocked — not worth surfacing.
  }
}

/** Removes the icon badge. Safe to call anywhere, any time. */
export function clearAppBadge(): void {
  tellDesktop(0)
  if (typeof navigator === 'undefined' || typeof navigator.clearAppBadge !== 'function') return
  try {
    void navigator.clearAppBadge().catch(() => {})
  } catch {
    // As above.
  }
}

/** Slices the count is made of; a pull that missed one would undercount. */
const BADGE_TABLES = ['notifications', 'conversations', 'messages']

/** Mount once, inside the router. */
export function useAppBadge(): void {
  const me = useStore((s) => s.currentUserId)
  // `synced`, not `hydrated`: an offline launch hydrates with empty slices
  // (remote mode doesn't persist them), and its 0 would wipe the badge a push
  // just set.
  const synced = useStore((s) => s.synced)
  const partial = useStore((s) => s.loadError?.some((k) => BADGE_TABLES.includes(k)) ?? false)
  const notifications = useStore((s) => s.notifications)
  const unreadMessages = useUnreadMessageCount()
  const unreadNotifications = useMemo(
    () => (me ? notifications.filter((n) => n.userId === me && !n.read).length : 0),
    [notifications, me],
  )
  const count = unreadNotifications + unreadMessages

  useEffect(() => {
    if (!me) {
      clearAppBadge()
      return
    }
    // Before a real pull the store is empty, and a 0 would wipe the badge a
    // push just set; a partial pull would lower it the same way.
    if (!synced || partial) return
    if (count > 0) setAppBadge(count)
    else clearAppBadge()
  }, [me, synced, partial, count])
}
