import { useEffect, useRef } from 'react'
import * as Notifications from 'expo-notifications'
import { usePathname, useRouter } from 'expo-router'
import { Platform } from 'react-native'

import { useSession } from '@/context/session-context'
import { useUnreadMessageCount } from '@/hooks/useUnreadMessageCount'
import { onPushTokenChange, syncPushDevice } from '@/lib/push'
import { hrefPath, pushNotificationId, routeForPush } from '@/lib/pushRoute'
import { useStore } from '@/store/useStore'

/** Launch / sign-in sync waits for the app's own first requests. */
const START_DELAY_MS = 2000

/** The screen on show, so a push about it doesn't also pop a banner. */
let activePath: string | null = null

// A push that arrives while the app is open shows as a banner too, unless it
// is about the screen already open (the chat you're typing in). Native only:
// the web build has no notification module behind these calls.
if (Platform.OS !== 'web') Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const here = activePath !== null && hrefPath(routeForPush(notification.request.content.data)) === activePath
    return {
      shouldShowBanner: !here,
      shouldShowList: !here,
      shouldPlaySound: !here,
      shouldSetBadge: true,
    }
  },
})

/**
 * Push wiring for the whole app; renders nothing. Mount once, inside the
 * session and the router:
 *   - a tapped push opens its screen (also when it launched the app) and
 *     marks its notification read
 *   - this phone's push row follows sign-in and token changes
 *   - the icon badge follows unread notifications + unread chat, like the
 *     number send-push puts on it
 * Nothing on the web build: expo-notifications has no native module there
 * (useLastNotificationResponse throws), and a browser has its own badge.
 */
export default function PushBridge() {
  return Platform.OS === 'web' ? null : <NativePushBridge />
}

function NativePushBridge() {
  const { user, ready } = useSession()
  const router = useRouter()
  const pathname = usePathname()
  const markRead = useStore((s) => s.markRead)
  const unreadNotifications = useStore((s) => s.notifications.filter((n) => n.userId === user?.id && !n.read).length)
  const unreadMessages = useUnreadMessageCount()
  const lastResponse = Notifications.useLastNotificationResponse()
  const handled = useRef<string | null>(null)

  useEffect(() => {
    activePath = pathname
  }, [pathname])

  // Taps — including the one that cold-started the app, which waits here
  // until the session is ready and the router can take it.
  useEffect(() => {
    if (!ready || !user || !lastResponse) return
    if (lastResponse.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return
    const key = `${lastResponse.notification.request.identifier}:${lastResponse.notification.date}`
    if (handled.current === key) return
    handled.current = key
    const data = lastResponse.notification.request.content.data
    const notificationId = pushNotificationId(data)
    if (notificationId) markRead(notificationId)
    router.push(routeForPush(data))
    Notifications.clearLastNotificationResponse()
  }, [lastResponse, ready, user, markRead, router])

  // This phone's row follows whoever is signed in.
  const userId = user?.id
  useEffect(() => {
    if (!ready || !userId) return
    const timer = setTimeout(() => void syncPushDevice(), START_DELAY_MS)
    return () => clearTimeout(timer)
  }, [ready, userId])

  useEffect(() => onPushTokenChange(() => void syncPushDevice()), [])

  // The icon badge needs no push: a chat line or notification that arrives
  // while the app is open (realtime) counts too. iOS shows it once
  // notifications are allowed; Android launchers that support badges show it.
  const synced = useStore((s) => s.synced)
  const badge = user ? unreadNotifications + unreadMessages : 0
  useEffect(() => {
    if (!ready || Platform.OS === 'web') return
    // Before a real pull the store is empty, and a 0 would wipe the badge a
    // push just set (the web's useAppBadge waits the same way).
    if (userId && !synced) return
    Notifications.setBadgeCountAsync(badge).catch(() => false)
  }, [badge, ready, synced, userId])

  return null
}
