import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'
import {
  CHAT_RETENTION_HOURS, CHAT_RETENTION_LABEL,
  conversationTitle, dayLabel, inboxFor, lastMessageOf, seenByOthers, startsRun, threadMessages,
  totalUnread, unreadCount, withinRetention,
} from '../lib/chat'
import type { ChatMessage } from '../lib/types'

const s = () => useStore.getState()

let alice: string
let bob: string
let carol: string

const signIn = (id: string) => useStore.setState({ currentUserId: id })

beforeEach(() => {
  s().resetSeed()
  useStore.setState({ conversations: [], messages: [], conversationReads: [] })
  ;[alice, bob] = s().users.map((u) => u.id)
  carol = s().addUser({ fullName: 'Carol Chat', email: 'carol@example.com' })
  signIn(alice)
})

describe('startConversation', () => {
  it('creates a DM with the current user included', () => {
    const id = s().startConversation([bob])!
    const c = s().conversations.find((x) => x.id === id)!
    expect(c.isGroup).toBe(false)
    expect(c.participantIds.sort()).toEqual([alice, bob].sort())
    expect(c.createdBy).toBe(alice)
  })

  it('reuses an existing DM from either side', () => {
    const id = s().startConversation([bob])
    signIn(bob)
    expect(s().startConversation([alice])).toBe(id)
    expect(s().conversations).toHaveLength(1)
  })

  it('makes a group for several people or a named chat', () => {
    const g = s().startConversation([bob, carol], '  Launch  ')!
    const c = s().conversations.find((x) => x.id === g)!
    expect(c.isGroup).toBe(true)
    expect(c.title).toBe('Launch')
    expect(c.participantIds).toHaveLength(3)
  })

  it('refuses empty picks, self-only picks, unknown users and signed-out callers', () => {
    expect(s().startConversation([])).toBeNull()
    expect(s().startConversation([alice])).toBeNull()
    expect(s().startConversation(['nope'])).toBeNull()
    signIn(null as unknown as string)
    expect(s().startConversation([bob])).toBeNull()
  })
})

describe('messages + unread', () => {
  it('sends, orders the inbox, and counts unread for the recipient only', () => {
    const dm = s().startConversation([bob])!
    const group = s().startConversation([bob, carol])!
    s().sendMessage(dm, 'hello')
    s().sendMessage(dm, '  second  ')

    const bodies = s().messages.filter((m) => m.conversationId === dm).map((m) => m.body)
    expect(bodies).toEqual(['hello', 'second'])
    expect(inboxFor(s().conversations, alice)[0].id).toBe(dm)
    expect(inboxFor(s().conversations, alice).map((c) => c.id)).toContain(group)

    // Sender has nothing unread; recipient sees both.
    expect(unreadCount(s().messages, s().conversationReads, dm, alice)).toBe(0)
    expect(unreadCount(s().messages, s().conversationReads, dm, bob)).toBe(2)
    expect(totalUnread(s().conversations, s().messages, s().conversationReads, carol)).toBe(0)

    signIn(bob)
    s().markConversationRead(dm)
    expect(unreadCount(s().messages, s().conversationReads, dm, bob)).toBe(0)
    // Idempotent — no duplicate markers.
    s().markConversationRead(dm)
    expect(s().conversationReads.filter((r) => r.userId === bob)).toHaveLength(1)
  })

  it('shows Seen once the other side has read the latest message', () => {
    const dm = s().startConversation([bob])!
    s().sendMessage(dm, 'ping')
    const conv = s().conversations.find((c) => c.id === dm)!
    const last = s().messages[s().messages.length - 1]
    expect(seenByOthers(conv, last, s().conversationReads, alice)).toBe(false)
    signIn(bob)
    s().markConversationRead(dm)
    expect(seenByOthers(conv, last, s().conversationReads, alice)).toBe(true)
  })

  it('rejects blank messages and non-members', () => {
    const dm = s().startConversation([bob])!
    expect(s().sendMessage(dm, '   ')).toBeNull()
    signIn(carol)
    expect(s().sendMessage(dm, 'sneaky')).toBeNull()
    expect(inboxFor(s().conversations, carol)).toHaveLength(0)
  })

  it('only lets the sender edit or delete a message', () => {
    const dm = s().startConversation([bob])!
    const id = s().sendMessage(dm, 'typo')!
    signIn(bob)
    s().editMessage(id, 'hijack')
    s().deleteMessage(id)
    expect(s().messages.find((m) => m.id === id)?.body).toBe('typo')

    signIn(alice)
    s().editMessage(id, 'fixed')
    const edited = s().messages.find((m) => m.id === id)!
    expect(edited.body).toBe('fixed')
    expect(edited.editedAt).toBeTruthy()
    s().deleteMessage(id)
    expect(s().messages.find((m) => m.id === id)).toBeUndefined()
  })

  it('deleting a conversation removes its messages and read markers', () => {
    const dm = s().startConversation([bob])!
    s().sendMessage(dm, 'bye')
    s().deleteConversation(dm)
    expect(s().conversations).toHaveLength(0)
    expect(s().messages).toHaveLength(0)
    expect(s().conversationReads).toHaveLength(0)
  })
})

describe('chat helpers', () => {
  it('titles DMs by the other person and renames only groups', () => {
    const dm = s().startConversation([bob])!
    const bobName = s().users.find((u) => u.id === bob)!.fullName
    const conv = () => s().conversations.find((c) => c.id === dm)!
    expect(conversationTitle(conv(), s().users, alice)).toBe(bobName)
    s().renameConversation(dm, 'Nope')
    expect(conv().title).toBeUndefined()
  })

  it('groups bursts from the same sender', () => {
    const base: ChatMessage = { id: '1', conversationId: 'c', senderId: 'a', body: 'x', createdAt: '2026-09-15T10:00:00.000Z' }
    expect(startsRun(undefined, base)).toBe(true)
    expect(startsRun(base, { ...base, id: '2', createdAt: '2026-09-15T10:02:00.000Z' })).toBe(false)
    expect(startsRun(base, { ...base, id: '3', createdAt: '2026-09-15T10:20:00.000Z' })).toBe(true)
    expect(startsRun(base, { ...base, id: '4', senderId: 'b' })).toBe(true)
  })

  it('labels days relative to now', () => {
    const now = new Date(2026, 8, 15, 12)
    expect(dayLabel(new Date(2026, 8, 15, 8).toISOString(), now)).toBe('Today')
    expect(dayLabel(new Date(2026, 8, 14, 23).toISOString(), now)).toBe('Yesterday')
  })
})

// The server purge (migration 020, a week since 051) is hourly, so the client is
// what guarantees nothing past the window is ever on screen between runs.
describe('one-week retention', () => {
  const at = (hoursAgo: number, now: Date) =>
    new Date(now.getTime() - hoursAgo * 3_600_000).toISOString()
  const WEEK_H = 7 * 24

  it('is a week, and says so', () => {
    expect(CHAT_RETENTION_HOURS).toBe(WEEK_H)
    expect(CHAT_RETENTION_LABEL).toBe('1 week')
  })

  it('hides messages older than a week and keeps newer ones', () => {
    const now = new Date('2026-09-15T12:00:00.000Z')
    const msgs: ChatMessage[] = [
      { id: 'old', conversationId: 'c', senderId: bob, body: 'last week', createdAt: at(WEEK_H + 1, now) },
      { id: 'edge', conversationId: 'c', senderId: bob, body: 'just inside', createdAt: at(WEEK_H - 0.1, now) },
      { id: 'yesterday', conversationId: 'c', senderId: bob, body: 'kept now', createdAt: at(25, now) },
      { id: 'new', conversationId: 'c', senderId: bob, body: 'today', createdAt: at(1, now) },
    ]
    expect(threadMessages(msgs, 'c', now).map((m) => m.id)).toEqual(['edge', 'yesterday', 'new'])
    expect(lastMessageOf(msgs, 'c', now)?.id).toBe('new')
    expect(withinRetention(at(WEEK_H + 0.1, now), now)).toBe(false)
  })

  it('drops an expired message from unread counts', () => {
    const now = new Date('2026-09-15T12:00:00.000Z')
    const msgs: ChatMessage[] = [
      { id: 'old', conversationId: 'c', senderId: bob, body: 'stale', createdAt: at(WEEK_H + 6, now) },
      { id: 'new', conversationId: 'c', senderId: bob, body: 'fresh', createdAt: at(2, now) },
    ]
    expect(unreadCount(msgs, [], 'c', alice, now)).toBe(1)
  })

  it('removes a conversation idle for the whole window from the inbox', () => {
    const now = new Date('2026-09-15T12:00:00.000Z')
    const id = s().startConversation([bob])!
    const conv = s().conversations.find((c) => c.id === id)!
    expect(inboxFor([conv], alice, now)).toHaveLength(1)

    // A day's quiet no longer clears a thread; a week's does.
    expect(inboxFor([{ ...conv, lastMessageAt: at(25, now) }], alice, now)).toHaveLength(1)
    const stale = { ...conv, lastMessageAt: at(WEEK_H + 1, now) }
    expect(inboxFor([stale], alice, now)).toHaveLength(0)
    expect(totalUnread([stale], [], [], alice, now)).toBe(0)
  })
})
