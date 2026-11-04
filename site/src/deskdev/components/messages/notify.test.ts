import { describe, expect, it } from 'vitest'
import { shouldNotify } from './useMessageNotifications'
import { ANNOUNCE_QUIET_MINUTES, announcement, shouldAnnounce } from './announce'
import type { ChatMessage, Conversation } from '../../lib/types'

const ME = 'me'
const THEM = 'them'
const CONV = 'c1'

const conversation: Conversation = {
  id: CONV,
  isGroup: false,
  participantIds: [ME, THEM],
  createdBy: THEM,
  lastMessageAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const message = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1',
  conversationId: CONV,
  senderId: THEM,
  body: 'hello',
  createdAt: new Date().toISOString(),
  ...over,
})

const ctx = (over: Partial<Parameters<typeof shouldNotify>[1]> = {}) => ({
  me: ME,
  conversation,
  path: '/projects',
  focused: true,
  ...over,
})

describe('shouldNotify', () => {
  it('notifies for a message from someone else while elsewhere in the app', () => {
    expect(shouldNotify(message(), ctx())).toBe(true)
  })

  it('stays quiet for my own message', () => {
    expect(shouldNotify(message({ senderId: ME }), ctx())).toBe(false)
  })

  it('stays quiet when the thread is already open and focused', () => {
    expect(shouldNotify(message(), ctx({ path: `/messages/${CONV}` }))).toBe(false)
  })

  it('still notifies for the open thread when the tab is not focused', () => {
    expect(shouldNotify(message(), ctx({ path: `/messages/${CONV}`, focused: false }))).toBe(true)
  })

  it('stays quiet for a conversation I am not part of, or an unknown one', () => {
    const other = { ...conversation, participantIds: [THEM, 'someone'] }
    expect(shouldNotify(message(), ctx({ conversation: other }))).toBe(false)
    expect(shouldNotify(message(), ctx({ conversation: undefined }))).toBe(false)
  })

  it('stays quiet for a message already past the retention window (a week)', () => {
    const now = new Date('2026-09-15T12:00:00.000Z')
    const old = new Date(now.getTime() - (7 * 24 + 1) * 3_600_000).toISOString()
    expect(shouldNotify(message({ createdAt: old }), ctx({ now }))).toBe(false)
  })
})

describe('announcement', () => {
  it('names the sender', () => {
    expect(announcement('Joshua')).toBe('Boss, message from Joshua')
  })

  it('falls back when the sender is unknown or blank', () => {
    expect(announcement(undefined)).toBe('Boss, you have a new message')
    expect(announcement('   ')).toBe('Boss, you have a new message')
  })
})

describe(`shouldAnnounce — ${ANNOUNCE_QUIET_MINUTES} minute quiet rule`, () => {
  const now = new Date('2026-09-15T12:00:00.000Z').getTime()
  const minutesAgo = (m: number) => now - m * 60_000

  it('speaks for the first message of the session', () => {
    expect(shouldAnnounce(undefined, now)).toBe(true)
  })

  it('stays silent mid-conversation', () => {
    // Just inside the window, whatever the window is set to.
    expect(shouldAnnounce(minutesAgo(0.5), now)).toBe(false)
    expect(shouldAnnounce(minutesAgo(ANNOUNCE_QUIET_MINUTES - 0.5), now)).toBe(false)
  })

  it('speaks again once the chat has been quiet for the window', () => {
    expect(shouldAnnounce(minutesAgo(ANNOUNCE_QUIET_MINUTES), now)).toBe(true)
    expect(shouldAnnounce(minutesAgo(40), now)).toBe(true)
  })
})
