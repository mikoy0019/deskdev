import type { ChatMessage, Conversation, ConversationRead, User } from './types'

// Pure chat helpers shared by the store, the inbox and the thread view.
// Local mode has no RLS, so every reader filters by the viewer explicitly.

/**
 * Chat is ephemeral: nothing older than this is shown, and `purge_expired_chat()`
 * (migration 020, hourly via pg_cron) deletes it server-side. The filters below
 * are the second layer — a late, failed or unscheduled purge must never surface
 * a message past the window. Keep in step with `public.chat_retention()`
 * (a week since migration 051).
 */
export const CHAT_RETENTION_DAYS = 7

export const CHAT_RETENTION_HOURS = CHAT_RETENTION_DAYS * 24

/** The window in words, for the screens that promise it. */
export const CHAT_RETENTION_LABEL = CHAT_RETENTION_DAYS === 7 ? '1 week' : `${CHAT_RETENTION_DAYS} days`

const RETENTION_MS = CHAT_RETENTION_HOURS * 3_600_000

/** Whether a timestamp is still inside the retention window. */
export function withinRetention(iso: string, now: Date = new Date()): boolean {
  return now.getTime() - new Date(iso).getTime() < RETENTION_MS
}

/**
 * Conversations the user belongs to, most recently active first.
 * A thread idle for the whole window is already gone server-side; hide it here
 * too rather than showing a row that is about to vanish.
 */
export function inboxFor(
  conversations: Conversation[],
  userId: string | null | undefined,
  now: Date = new Date(),
): Conversation[] {
  if (!userId) return []
  return conversations
    .filter((c) => c.participantIds.includes(userId) && withinRetention(c.lastMessageAt, now))
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
}

/** Messages of one conversation still inside the retention window, oldest first. */
export function threadMessages(
  messages: ChatMessage[],
  conversationId: string,
  now: Date = new Date(),
): ChatMessage[] {
  return messages
    .filter((m) => m.conversationId === conversationId && withinRetention(m.createdAt, now))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/** Latest unexpired message of a conversation, if any. */
export function lastMessageOf(
  messages: ChatMessage[],
  conversationId: string,
  now: Date = new Date(),
): ChatMessage | undefined {
  let latest: ChatMessage | undefined
  for (const m of messages) {
    if (m.conversationId !== conversationId) continue
    if (!withinRetention(m.createdAt, now)) continue
    if (!latest || m.createdAt > latest.createdAt) latest = m
  }
  return latest
}

/**
 * When `userId` last read the conversation. Several markers can exist for the
 * same pair (two devices racing the first insert) — the latest wins.
 */
export function lastReadAt(
  reads: ConversationRead[],
  conversationId: string,
  userId: string,
): string | undefined {
  let latest: string | undefined
  for (const r of reads) {
    if (r.conversationId !== conversationId || r.userId !== userId) continue
    if (!latest || r.lastReadAt > latest) latest = r.lastReadAt
  }
  return latest
}

/** Messages from other people newer than the user's read marker. */
export function unreadCount(
  messages: ChatMessage[],
  reads: ConversationRead[],
  conversationId: string,
  userId: string,
  now: Date = new Date(),
): number {
  const since = lastReadAt(reads, conversationId, userId) ?? ''
  let n = 0
  for (const m of messages) {
    if (!withinRetention(m.createdAt, now)) continue
    if (m.conversationId === conversationId && m.senderId !== userId && m.createdAt > since) n++
  }
  return n
}

/** Total unread messages across the user's inbox — drives nav badges. */
export function totalUnread(
  conversations: Conversation[],
  messages: ChatMessage[],
  reads: ConversationRead[],
  userId: string | null | undefined,
  now: Date = new Date(),
): number {
  if (!userId) return 0
  return inboxFor(conversations, userId, now).reduce(
    (sum, c) => sum + unreadCount(messages, reads, c.id, userId, now),
    0,
  )
}

/** Everyone in the conversation except the viewer. */
export function otherParticipants(conversation: Conversation, users: User[], userId: string | null | undefined): User[] {
  return conversation.participantIds
    .filter((id) => id !== userId)
    .map((id) => users.find((u) => u.id === id))
    .filter((u): u is User => Boolean(u))
}

/** Group name, or the other person's name for a DM. */
export function conversationTitle(conversation: Conversation, users: User[], userId: string | null | undefined): string {
  if (conversation.title?.trim()) return conversation.title.trim()
  const others = otherParticipants(conversation, users, userId)
  if (others.length === 0) return 'Unknown user'
  if (others.length <= 3) return others.map((u) => u.fullName).join(', ')
  return `${others.slice(0, 2).map((u) => u.fullName).join(', ')} +${others.length - 2}`
}

/** Existing one-to-one conversation between two users, so "New chat" reopens it. */
export function findDirectConversation(
  conversations: Conversation[],
  a: string,
  b: string,
): Conversation | undefined {
  return conversations.find(
    (c) =>
      !c.isGroup &&
      c.participantIds.length === 2 &&
      c.participantIds.includes(a) &&
      c.participantIds.includes(b),
  )
}

/**
 * Whether a message starts a new visual run in the thread: a different sender,
 * or a gap long enough that it reads as a new burst.
 */
export function startsRun(prev: ChatMessage | undefined, msg: ChatMessage, gapMinutes = 5): boolean {
  if (!prev) return true
  if (prev.senderId !== msg.senderId) return true
  return new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() > gapMinutes * 60_000
}

/** Whether a date divider belongs before this message (calendar day changed). */
export function startsDay(prev: ChatMessage | undefined, msg: ChatMessage): boolean {
  if (!prev) return true
  return new Date(prev.createdAt).toDateString() !== new Date(msg.createdAt).toDateString()
}

/** "Today" / "Yesterday" / "Mon, Sep 14" divider label. */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86_400_000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  })
}

/**
 * Whether the other side of a DM has read the viewer's latest message —
 * shows "Seen" under it. Groups skip this (whose "seen" would it be?).
 */
export function seenByOthers(
  conversation: Conversation,
  message: ChatMessage | undefined,
  reads: ConversationRead[],
  userId: string | null | undefined,
): boolean {
  if (!message || !userId || conversation.isGroup || message.senderId !== userId) return false
  const other = conversation.participantIds.find((id) => id !== userId)
  if (!other) return false
  const read = lastReadAt(reads, conversation.id, other)
  return Boolean(read && read >= message.createdAt)
}

export const MAX_MESSAGE_LENGTH = 4000
