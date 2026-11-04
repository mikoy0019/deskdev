import { useEffect, useRef } from 'react'
import { useStore } from '../../store/useStore'
import { alertTag, categoryOf, notificationHref, spokenLine, wantsDesktop, wantsVoice } from '../../lib/notifications'
import { armSpeechPriming, lastIncomingAt, setLastIncomingAt, shouldAnnounce, speak } from '../messages/announce'
import { currentAlertChannel, notificationPermission, showDesktopNotification, showInAppAlert } from './desktop'
import { loadPrefs } from './prefs'
import { usePushSync } from '../../pwa/push'

/**
 * Popups (and a voice) for in-app notifications: mentions, task assignments,
 * due reminders, workspace updates — whatever the preferences allow. Mounted
 * once at the app shell so it works on any page. It also keeps this device's
 * Web Push subscription in step (usePushSync), for alerts while DeskDev is closed.
 *
 * Chat messages have their own hook (useMessageNotifications): they are not
 * notification rows, they are messages.
 */
export function useNotificationAlerts(): void {
  usePushSync()

  const me = useStore((s) => s.currentUserId)
  // Seeded on a pull that really reached the server: after an offline start
  // the list is empty, and the first real pull would otherwise fire a burst.
  const synced = useStore((s) => s.synced && !s.loadError?.includes('notifications'))
  const notifications = useStore((s) => s.notifications)
  const users = useStore((s) => s.users)
  const crmRows = useStore((s) => s.crmRows)
  const crmColumns = useStore((s) => s.crmColumns)
  const events = useStore((s) => s.events)

  // Rows already accounted for, so signing in with a week of unread history
  // does not fire a burst of popups.
  const seen = useRef<Set<string> | null>(null)

  useEffect(
    () =>
      armSpeechPriming(() => {
        const prefs = loadPrefs()
        return prefs.desktop && prefs.voice
      }),
    [],
  )

  useEffect(() => {
    if (!me) {
      seen.current = null
      return
    }
    if (seen.current === null) {
      if (synced) seen.current = new Set(notifications.map((n) => n.id))
      return
    }

    const fresh = notifications.filter((n) => !seen.current!.has(n.id))
    for (const n of notifications) seen.current.add(n.id)
    if (fresh.length === 0) return

    const prefs = loadPrefs()
    const channel = currentAlertChannel()
    const granted = notificationPermission() === 'granted'
    // A system notification needs the permission; an in-app toast doesn't.
    if (channel === 'system' && !granted) return
    // One announcement per batch, for the last row that earns one.
    let line: string | undefined

    for (const n of fresh) {
      if (n.userId !== me || n.read) continue
      // Your own actions don't need announcing back to you — except reminders,
      // which this device files on your behalf.
      if (n.actorId === me && n.type !== 'due_reminder') continue
      const category = categoryOf(n.type)
      if (!wantsDesktop(prefs, category)) continue

      const alert = {
        title: n.title,
        body: n.body,
        tag: alertTag.notification(n.id),
        href: notificationHref(n, { crmRows, crmColumns, events }),
      }
      if (channel === 'toast') showInAppAlert(alert)
      else void showDesktopNotification(alert)
      if (granted && wantsVoice(prefs, category)) {
        line = spokenLine(n, users.find((u) => u.id === n.actorId)?.fullName)
      }
    }

    if (!line) return
    // The voice only breaks a quiet spell (see announce.ts), and the quiet
    // clock is shared with chat so the two never talk over each other.
    const now = Date.now()
    if (shouldAnnounce(lastIncomingAt(), now)) speak(line)
    setLastIncomingAt(now)
  }, [notifications, users, crmRows, crmColumns, events, me, synced])
}
