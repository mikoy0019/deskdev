import { useEffect, useRef } from 'react'
import { useStore } from '../../store/useStore'
import { conversationTitle, withinRetention } from '../../lib/chat'
import { alertTag, wantsDesktop, wantsVoice } from '../../lib/notifications'
import { announcement, lastIncomingAt, setLastIncomingAt, shouldAnnounce, speak } from './announce'
import { currentAlertChannel, notificationPermission, showDesktopNotification, showInAppAlert } from '../notifications/desktop'
import { loadPrefs } from '../notifications/prefs'
import { stripBase } from '../../pwa/paths'
import type { ChatMessage, Conversation } from '../../lib/types'

/**
 * Notifications for incoming chat — a system notification, or an in-app toast
 * while the installed app or a touch device is in use (see alertChannel).
 *
 * Mounted once at the app shell, not on the Messages page — the point is to be
 * told about a message while you are somewhere else entirely. Permission and
 * the on/off switches live in components/notifications (Settings →
 * Notifications); this hook only decides whether a given message earns one.
 */

/**
 * Whether one incoming message earns a notification. Pure, so the rules are
 * testable without a browser: not mine, not expired, a thread I am in, and not
 * the thread already open in front of me.
 */
export function shouldNotify(
  msg: ChatMessage,
  ctx: {
    me: string
    conversation: Conversation | undefined
    /** Router path currently shown (no base path), e.g. `/messages/abc`. */
    path: string
    /** Tab visible AND focused. */
    focused: boolean
    now?: Date
  },
): boolean {
  if (msg.senderId === ctx.me) return false
  if (!withinRetention(msg.createdAt, ctx.now ?? new Date())) return false
  if (!ctx.conversation?.participantIds.includes(ctx.me)) return false
  if (ctx.focused && ctx.path === `/messages/${msg.conversationId}`) return false
  return true
}

export function useMessageNotifications(): void {
  const me = useStore((s) => s.currentUserId)
  // Seeded on a pull that really reached the server — see useNotificationAlerts.
  const synced = useStore((s) => s.synced && !s.loadError?.includes('messages'))
  const messages = useStore((s) => s.messages)
  const conversations = useStore((s) => s.conversations)
  const users = useStore((s) => s.users)

  // Messages already accounted for. Seeded once a pull has reached the
  // server — before that the list is empty on a fresh device or an offline
  // start, and the first real pull would fire a day of history as a burst.
  const seen = useRef<Set<string> | null>(null)

  useEffect(() => {
    if (!me) {
      seen.current = null
      return
    }

    if (seen.current === null) {
      if (synced) seen.current = new Set(messages.map((m) => m.id))
      return
    }

    const fresh = messages.filter((m) => !seen.current!.has(m.id))
    for (const m of messages) seen.current.add(m.id)
    if (fresh.length === 0) return

    const prefs = loadPrefs()
    if (!wantsDesktop(prefs, 'messages')) return
    const channel = currentAlertChannel()
    const granted = notificationPermission() === 'granted'
    // A system notification needs the permission; an in-app toast doesn't.
    if (channel === 'system' && !granted) return

    const focused = document.visibilityState === 'visible' && document.hasFocus()
    // The router's path: location.pathname carries the base ('/workspace/…').
    const path = stripBase(window.location.pathname)
    // One announcement per batch, for the last message that earns one — a
    // burst should not queue the voice up behind itself.
    let announce: string | undefined

    for (const m of fresh) {
      const conv = conversations.find((c) => c.id === m.conversationId)
      // Reading that thread right now is its own notification.
      if (!shouldNotify(m, { me, conversation: conv, path, focused })) continue
      if (!conv) continue

      const sender = users.find((u) => u.id === m.senderId)?.fullName
      const thread = conversationTitle(conv, users, me)
      const alert = {
        title: conv.isGroup && sender ? `${sender} · ${thread}` : sender ?? thread,
        body: m.body,
        // Tagging by conversation means a burst replaces itself instead of
        // stacking ten notifications for one chat (and matches the push's tag).
        tag: alertTag.chat(m.conversationId),
        href: `/messages/${m.conversationId}`,
      }
      if (channel === 'toast') showInAppAlert(alert)
      else void showDesktopNotification(alert)
      announce = announcement(sender)
    }

    if (!announce || !granted || !wantsVoice(prefs, 'messages')) return

    // The popup fires for every message; the voice only breaks a quiet spell
    // of ANNOUNCE_QUIET_MINUTES, so an ongoing exchange stays silent.
    const now = Date.now()
    if (shouldAnnounce(lastIncomingAt(), now)) speak(announce)
    setLastIncomingAt(now)
  }, [messages, conversations, users, me, synced])
}
