import type {
  Channel, ChannelCategory, ChannelMessage, ChannelReaction, ChannelRead, User,
} from './types'
import { activeUsers, isDeactivated } from './permissions'

// Pure channel helpers shared by the store, the channel list and the room view.
// Local mode has no RLS, so every reader filters by the viewer explicitly —
// these rules mirror can_view_channel / can_manage_channel / can_post_channel
// in migrations 023 and 030. Keep the two in step.

export const MAX_CHANNEL_MESSAGE_LENGTH = 4000
export const MAX_CHANNEL_NAME_LENGTH = 50
export const MAX_CHANNEL_TOPIC_LENGTH = 300

/** The reaction bar's one-click set. Any emoji can still be added from the picker. */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '👀', '✅']
export const EMOJI_PICKER = [
  '👍', '👎', '❤️', '🔥', '😂', '😮', '😢', '🎉', '👀', '✅', '❌', '🙏',
  '💯', '🚀', '👏', '🤔', '😅', '😍', '🙌', '💡', '⚠️', '📌', '⭐', '☕',
]

// ─── Names ───────────────────────────────────────────────────────────────────

/**
 * Discord-style slug: lowercase, spaces become dashes, anything else outside
 * [a-z0-9_-] is dropped. Matches the channels.name CHECK in migration 023.
 */
export function slugifyChannelName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+/, '')
    .slice(0, MAX_CHANNEL_NAME_LENGTH)
}

export function isValidChannelName(name: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,49}$/.test(name)
}

// ─── Spaces ──────────────────────────────────────────────────────────────────
// A space is what the rail lists: the studio (STUDIO_SPACE) or one client.
// Channels and categories carry `clientId`; unset means the studio.

/** Rail key for studio-wide channels (those with no clientId). */
export const STUDIO_SPACE = 'studio'

/** The space key a channel or category belongs to. */
export function spaceOf(row: { clientId?: string }): string {
  return row.clientId ?? STUDIO_SPACE
}

/** Rows of one space. */
export function inSpace<T extends { clientId?: string }>(rows: T[], space: string): T[] {
  return rows.filter((r) => spaceOf(r) === space)
}

// ─── Access ──────────────────────────────────────────────────────────────────

type Viewer = (Pick<User, 'id' | 'role'> & { permissions?: User['permissions']; deactivatedAt?: string }) | null | undefined

/** A client's space is for people who may see clients (clients:view); admins always. */
function seesClientSpaces(user: NonNullable<Viewer>): boolean {
  if (user.role === 'admin') return true
  const granted = user.permissions?.clients
  return granted === 'view' || granted === 'edit'
}

/** Mirrors can_view_channel() in migration 030: private membership AND, in a client's space, clients:view. */
export function canViewChannel(channel: Channel, user: Viewer): boolean {
  if (!user || isDeactivated(user)) return false
  if (channel.clientId && !seesClientSpaces(user)) return false
  return !channel.isPrivate || user.role === 'admin' || channel.memberIds.includes(user.id)
}

/** Creator or admin: edit/delete the channel, pin, remove anyone's message. */
export function canManageChannel(channel: Channel, user: Viewer): boolean {
  if (!user || !canViewChannel(channel, user)) return false
  return user.role === 'admin' || channel.createdBy === user.id
}

export function canPostInChannel(channel: Channel, user: Viewer): boolean {
  if (!canViewChannel(channel, user)) return false
  return channel.kind === 'text' || canManageChannel(channel, user)
}

export function canManageCategory(category: ChannelCategory, user: Viewer): boolean {
  if (!user || isDeactivated(user)) return false
  return user.role === 'admin' || category.createdBy === user.id
}

/**
 * Who is "in" the channel: everyone for a public one, its members for a
 * private one, and in a client's space only those who may see clients.
 */
export function channelMembers(channel: Channel, users: User[]): User[] {
  // Deactivated accounts are out: they cannot read the channel or be mentioned.
  const list = activeUsers(channel.isPrivate ? users.filter((u) => channel.memberIds.includes(u.id)) : users)
    .filter((u) => !channel.clientId || seesClientSpaces(u))
  return [...list].sort((a, b) => a.fullName.localeCompare(b.fullName))
}

const byPosition = <T extends { position: number; createdAt: string }>(a: T, b: T) =>
  a.position - b.position || a.createdAt.localeCompare(b.createdAt)

export interface ChannelGroup {
  category: ChannelCategory | null
  channels: Channel[]
}

/**
 * The channel list as the sidebar draws it: uncategorised channels first,
 * then each category in order. Empty categories stay (so you can add to them);
 * channels the viewer cannot see are dropped. A channel pointing at a deleted
 * category falls back to the uncategorised group.
 */
export function channelTree(
  categories: ChannelCategory[],
  channels: Channel[],
  user: Viewer,
): ChannelGroup[] {
  const visible = channels.filter((c) => canViewChannel(c, user)).sort(byPosition)
  const known = new Set(categories.map((c) => c.id))
  const loose = visible.filter((c) => !c.categoryId || !known.has(c.categoryId))
  const groups: ChannelGroup[] = loose.length > 0 ? [{ category: null, channels: loose }] : []
  for (const category of [...categories].sort(byPosition)) {
    groups.push({ category, channels: visible.filter((c) => c.categoryId === category.id) })
  }
  return groups
}

/** Next position at the end of a category (or the uncategorised group). */
export function nextChannelPosition(channels: Channel[], categoryId: string | undefined): number {
  const sibling = channels.filter((c) => (c.categoryId ?? null) === (categoryId ?? null))
  return sibling.reduce((max, c) => Math.max(max, c.position + 1), 0)
}

// ─── Messages ────────────────────────────────────────────────────────────────

/** A channel's messages, oldest first. */
export function channelMessagesOf(messages: ChannelMessage[], channelId: string): ChannelMessage[] {
  return messages
    .filter((m) => m.channelId === channelId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function latestChannelMessage(
  messages: ChannelMessage[],
  channelId: string,
): ChannelMessage | undefined {
  let latest: ChannelMessage | undefined
  for (const m of messages) {
    if (m.channelId !== channelId) continue
    if (!latest || m.createdAt > latest.createdAt) latest = m
  }
  return latest
}

/** Pinned messages of a channel, most recently pinned first. */
export function pinnedMessages(messages: ChannelMessage[], channelId: string): ChannelMessage[] {
  return messages
    .filter((m) => m.channelId === channelId && m.pinnedAt)
    .sort((a, b) => (b.pinnedAt ?? '').localeCompare(a.pinnedAt ?? ''))
}

/**
 * Whether a message starts a new visual group (avatar + name row): a different
 * author, a reply, or a gap long enough that it reads as a new burst.
 */
export function startsGroup(prev: ChannelMessage | undefined, msg: ChannelMessage, gapMinutes = 7): boolean {
  if (!prev || msg.replyToId) return true
  if (prev.senderId !== msg.senderId) return true
  return new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() > gapMinutes * 60_000
}

/** Whether a day divider belongs before this message (calendar day changed). */
export function startsNewDay(prev: ChannelMessage | undefined, msg: ChannelMessage): boolean {
  if (!prev) return true
  return new Date(prev.createdAt).toDateString() !== new Date(msg.createdAt).toDateString()
}

// ─── Read state ──────────────────────────────────────────────────────────────

/** Latest read marker for a user in a channel (duplicates from racing devices: latest wins). */
export function channelLastReadAt(reads: ChannelRead[], channelId: string, userId: string): string | undefined {
  let latest: string | undefined
  for (const r of reads) {
    if (r.channelId !== channelId || r.userId !== userId) continue
    if (!latest || r.lastReadAt > latest) latest = r.lastReadAt
  }
  return latest
}

export interface ChannelUnread {
  /** Messages from others since the viewer's marker. */
  unread: number
  /** Of those, how many mention the viewer (directly or via @everyone). */
  mentions: number
}

/**
 * Unread state for one channel. A channel the viewer has never opened counts
 * everything in it as unread — the same as joining a Discord server.
 */
export function channelUnread(
  messages: ChannelMessage[],
  reads: ChannelRead[],
  channelId: string,
  userId: string,
): ChannelUnread {
  const since = channelLastReadAt(reads, channelId, userId) ?? ''
  let unread = 0
  let mentions = 0
  for (const m of messages) {
    if (m.channelId !== channelId || m.senderId === userId || m.createdAt <= since) continue
    unread++
    if (mentionsUser(m.body, userId)) mentions++
  }
  return { unread, mentions }
}

/** Per-space unread state, for the rail's badges. Keys are space keys. */
export function spaceBadges(
  channels: Channel[],
  messages: ChannelMessage[],
  reads: ChannelRead[],
  user: Viewer,
): Map<string, { unreadChannels: number; mentions: number }> {
  const out = new Map<string, { unreadChannels: number; mentions: number }>()
  if (!user) return out
  for (const c of channels) {
    if (!canViewChannel(c, user)) continue
    const u = channelUnread(messages, reads, c.id, user.id)
    const key = spaceOf(c)
    const cur = out.get(key) ?? { unreadChannels: 0, mentions: 0 }
    if (u.unread > 0) cur.unreadChannels++
    cur.mentions += u.mentions
    out.set(key, cur)
  }
  return out
}

/** Sidebar badge: mentions across every visible channel, or unread channels if none. */
export function channelBadge(
  channels: Channel[],
  messages: ChannelMessage[],
  reads: ChannelRead[],
  user: Viewer,
): { unreadChannels: number; mentions: number } {
  if (!user) return { unreadChannels: 0, mentions: 0 }
  let unreadChannels = 0
  let mentions = 0
  for (const c of channels) {
    if (!canViewChannel(c, user)) continue
    const u = channelUnread(messages, reads, c.id, user.id)
    if (u.unread > 0) unreadChannels++
    mentions += u.mentions
  }
  return { unreadChannels, mentions }
}

/** Id of the first message the viewer has not read — draws the "New" divider. */
export function firstUnreadId(
  messages: ChannelMessage[],
  since: string | undefined,
  userId: string,
): string | undefined {
  if (!since) return undefined
  return messages.find((m) => m.createdAt > since && m.senderId !== userId)?.id
}

// ─── Mentions ────────────────────────────────────────────────────────────────
// Stored form: `<@userId>` for a person, `@everyone` / `@here` for the room.
// The composer shows and edits `@Full Name`; encode/decode translate.

const MENTION_TOKEN = /<@([0-9a-zA-Z-]+)>/g
const ROOM_MENTION = /(^|[^\w@])@(everyone|here)\b/

export function mentionsUser(body: string, userId: string): boolean {
  if (ROOM_MENTION.test(body)) return true
  for (const m of body.matchAll(MENTION_TOKEN)) if (m[1] === userId) return true
  return false
}

/** Ids of people mentioned by name token (not @everyone). */
export function mentionedUserIds(body: string): string[] {
  return [...new Set([...body.matchAll(MENTION_TOKEN)].map((m) => m[1]))]
}

export function mentionsEveryone(body: string): boolean {
  return ROOM_MENTION.test(body)
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** `@Full Name` → `<@id>` for every known user. Longest names first so "Ann Lee" beats "Ann". */
export function encodeMentions(text: string, users: User[]): string {
  const sorted = [...users].filter((u) => u.fullName.trim()).sort((a, b) => b.fullName.length - a.fullName.length)
  let out = text
  for (const u of sorted) {
    const re = new RegExp(`(^|[^\\w<])@${escapeRegExp(u.fullName.trim())}(?![\\w])`, 'gi')
    out = out.replace(re, (_, pre: string) => `${pre}<@${u.id}>`)
  }
  return out
}

/** `<@id>` → `@Full Name`, for putting a stored message back into the composer. */
export function decodeMentions(body: string, users: User[]): string {
  return body.replace(MENTION_TOKEN, (whole, id: string) => {
    const u = users.find((x) => x.id === id)
    return u ? `@${u.fullName}` : whole
  })
}

/**
 * The `@partial` being typed at the caret, if any — drives the mention
 * autocomplete. `start` is the index of the `@`.
 */
export function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const upto = text.slice(0, caret)
  const m = /(^|\s)@([^\s@<>]{0,30})$/.exec(upto)
  if (!m) return null
  return { start: caret - m[2].length - 1, query: m[2] }
}

// ─── Rendering ───────────────────────────────────────────────────────────────

export type BodySegment =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; userId: string }
  | { kind: 'room'; text: '@everyone' | '@here' }
  | { kind: 'link'; href: string }
  | { kind: 'code'; text: string }

const SEGMENT = /(<@[0-9a-zA-Z-]+>)|((?<![\w@])@(?:everyone|here)\b)|(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])|(`[^`\n]+`)/g

/** Split a stored body into render segments: mentions, links and `inline code`. */
export function parseBody(body: string): BodySegment[] {
  const out: BodySegment[] = []
  let last = 0
  for (const m of body.matchAll(SEGMENT)) {
    const at = m.index ?? 0
    if (at > last) out.push({ kind: 'text', text: body.slice(last, at) })
    if (m[1]) out.push({ kind: 'mention', userId: m[1].slice(2, -1) })
    else if (m[2]) out.push({ kind: 'room', text: m[2] as '@everyone' | '@here' })
    else if (m[3]) out.push({ kind: 'link', href: m[3] })
    else if (m[4]) out.push({ kind: 'code', text: m[4].slice(1, -1) })
    last = at + m[0].length
  }
  if (last < body.length) out.push({ kind: 'text', text: body.slice(last) })
  return out
}

/** One-line plain-text preview (reply quotes, pinned list). */
export function plainPreview(body: string, users: User[], max = 120): string {
  const flat = decodeMentions(body, users).replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

// ─── Reactions ───────────────────────────────────────────────────────────────

export interface ReactionGroup {
  emoji: string
  count: number
  mine: boolean
  userIds: string[]
}

/** Reactions on one message, grouped by emoji in first-used order. */
export function groupReactions(
  reactions: ChannelReaction[],
  messageId: string,
  userId: string | null | undefined,
): ReactionGroup[] {
  const groups = new Map<string, ReactionGroup & { first: string }>()
  for (const r of reactions) {
    if (r.messageId !== messageId) continue
    const g = groups.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false, userIds: [], first: r.createdAt }
    if (g.userIds.includes(r.userId)) continue
    g.count++
    g.userIds.push(r.userId)
    if (r.userId === userId) g.mine = true
    if (r.createdAt < g.first) g.first = r.createdAt
    groups.set(r.emoji, g)
  }
  return [...groups.values()]
    .sort((a, b) => a.first.localeCompare(b.first))
    .map(({ emoji, count, mine, userIds }) => ({ emoji, count, mine, userIds }))
}
