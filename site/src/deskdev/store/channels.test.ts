import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'
import {
  canPostInChannel, canViewChannel, channelBadge, channelMembers, channelTree, channelUnread, decodeMentions,
  encodeMentions, groupReactions, inSpace, mentionQueryAt, mentionsUser, parseBody, slugifyChannelName,
  spaceBadges, spaceOf, STUDIO_SPACE,
} from '../lib/channels'

const s = () => useStore.getState()

let admin: string
let member: string
let carol: string

const signIn = (id: string) => useStore.setState({ currentUserId: id })
const user = (id: string) => s().users.find((u) => u.id === id)!

beforeEach(() => {
  s().resetSeed()
  useStore.setState({
    channelCategories: [], channels: [], channelMessages: [], channelReactions: [], channelReads: [],
    notifications: [],
  })
  ;[admin, member] = s().users.map((u) => u.id)
  carol = s().addUser({ fullName: 'Carol Chan', email: 'carol@example.com' })
  signIn(admin)
})

describe('slugifyChannelName', () => {
  it('lowercases, dashes spaces and drops punctuation', () => {
    expect(slugifyChannelName('  Client Updates!! ')).toBe('client-updates')
    expect(slugifyChannelName('Café — Q3')).toBe('cafe-q3')
    expect(slugifyChannelName('--hello')).toBe('hello')
  })
})

describe('createChannel', () => {
  it('slugifies the name and rejects an empty one', () => {
    const id = s().createChannel({ name: 'Design Reviews' })!
    expect(s().channels.find((c) => c.id === id)?.name).toBe('design-reviews')
    expect(s().createChannel({ name: '!!!' })).toBeNull()
  })

  it('always adds the creator to a private channel', () => {
    signIn(member)
    const id = s().createChannel({ name: 'secret', isPrivate: true, memberIds: [carol] })!
    expect(s().channels.find((c) => c.id === id)?.memberIds.sort()).toEqual([member, carol].sort())
  })

  it('appends to the end of its category', () => {
    const cat = s().createChannelCategory('Projects')!
    s().createChannel({ name: 'one', categoryId: cat })
    const two = s().createChannel({ name: 'two', categoryId: cat })!
    expect(s().channels.find((c) => c.id === two)?.position).toBe(1)
  })
})

describe('access rules', () => {
  it('hides private channels from non-members but not admins', () => {
    signIn(member)
    const id = s().createChannel({ name: 'secret', isPrivate: true })!
    const ch = s().channels.find((c) => c.id === id)!
    expect(canViewChannel(ch, user(carol))).toBe(false)
    expect(canViewChannel(ch, user(admin))).toBe(true)
    expect(channelTree([], s().channels, user(carol))).toEqual([])
  })

  it("keeps a client's space to people who may see clients (030 can_view_channel)", () => {
    const ch = { ...s().channels.find((c) => c.id === s().createChannel({ name: 'acme' }))!, clientId: 'client-1' }
    const noClients = { id: 'x', role: 'member' as const, permissions: { clients: 'none' as const } }
    const viewer = { id: 'y', role: 'member' as const, permissions: { clients: 'view' as const } }
    expect(canViewChannel(ch, noClients)).toBe(false)
    expect(canViewChannel(ch, viewer)).toBe(true)
    expect(canViewChannel(ch, { id: 'z', role: 'admin' as const })).toBe(true)
    // Private AND client space: membership alone isn't enough.
    const priv = { ...ch, isPrivate: true, memberIds: ['x', 'y'] }
    expect(canViewChannel(priv, noClients)).toBe(false)
    expect(canViewChannel(priv, viewer)).toBe(true)
    // The studio space is unaffected.
    expect(canViewChannel({ ...ch, clientId: undefined }, noClients)).toBe(true)
    const everyone = s().users.map((u) => ({ ...u, permissions: { ...u.permissions, clients: 'none' as const } }))
    expect(channelMembers(ch, everyone).every((u) => u.role === 'admin')).toBe(true)
  })

  it('leaves a deactivated account out of the members (and so out of @mentions)', () => {
    const id = s().createChannel({ name: 'team' })!
    const ch = s().channels.find((c) => c.id === id)!
    const off = s().users.map((u) => (u.id === member ? { ...u, deactivatedAt: '2026-10-01T00:00:00.000Z' } : u))
    expect(channelMembers(ch, s().users).map((u) => u.id)).toContain(member)
    expect(channelMembers(ch, off).map((u) => u.id)).not.toContain(member)
    // A private channel keeps the id in memberIds; the list still drops them.
    const priv = { ...ch, isPrivate: true, memberIds: [admin, member] }
    expect(channelMembers(priv, off).map((u) => u.id)).toEqual([admin])
  })

  it('only managers post in announcement channels', () => {
    const id = s().createChannel({ name: 'news', kind: 'announcement' })!
    const ch = s().channels.find((c) => c.id === id)!
    expect(canPostInChannel(ch, user(admin))).toBe(true)
    expect(canPostInChannel(ch, user(member))).toBe(false)
    signIn(member)
    expect(s().sendChannelMessage(id, 'hi')).toBeNull()
  })

  it('stops a non-manager from editing or deleting the channel', () => {
    const id = s().createChannel({ name: 'general' })!
    signIn(member)
    s().updateChannel(id, { name: 'hijacked' })
    s().deleteChannel(id)
    expect(s().channels.find((c) => c.id === id)?.name).toBe('general')
  })
})

describe('messages', () => {
  let ch: string
  beforeEach(() => {
    ch = s().createChannel({ name: 'general' })!
  })

  it('stores mentions as tokens and notifies the mentioned person', () => {
    const id = s().sendChannelMessage(ch, 'hey @carol chan can you look?')!
    const msg = s().channelMessages.find((m) => m.id === id)!
    expect(msg.body).toBe(`hey <@${carol}> can you look?`)
    const n = s().notifications.find((x) => x.userId === carol)
    expect(n?.type).toBe('channel_mention')
    expect(n?.entityId).toBe(ch)
  })

  it('notifies the author of a replied-to message', () => {
    signIn(member)
    const parent = s().sendChannelMessage(ch, 'first')!
    signIn(admin)
    s().sendChannelMessage(ch, 'answer', parent)
    expect(s().notifications.some((n) => n.userId === member && n.title.includes('replied'))).toBe(true)
  })

  it('lets only the author edit, but a manager delete', () => {
    signIn(member)
    const id = s().sendChannelMessage(ch, 'mine')!
    signIn(admin)
    s().editChannelMessage(id, 'changed')
    expect(s().channelMessages.find((m) => m.id === id)?.body).toBe('mine')
    s().deleteChannelMessage(id)
    expect(s().channelMessages.find((m) => m.id === id)).toBeUndefined()
  })

  it('turns replies to a deleted message into plain messages', () => {
    const parent = s().sendChannelMessage(ch, 'parent')!
    const reply = s().sendChannelMessage(ch, 'reply', parent)!
    s().deleteChannelMessage(parent)
    expect(s().channelMessages.find((m) => m.id === reply)?.replyToId).toBeUndefined()
  })

  it('toggles pins for managers only', () => {
    const id = s().sendChannelMessage(ch, 'pin me')!
    signIn(member)
    s().togglePinChannelMessage(id)
    expect(s().channelMessages.find((m) => m.id === id)?.pinnedAt).toBeUndefined()
    signIn(admin)
    s().togglePinChannelMessage(id)
    expect(s().channelMessages.find((m) => m.id === id)?.pinnedBy).toBe(admin)
    s().togglePinChannelMessage(id)
    expect(s().channelMessages.find((m) => m.id === id)?.pinnedAt).toBeUndefined()
  })

  it('toggles a reaction on and off and groups them', () => {
    const id = s().sendChannelMessage(ch, 'react')!
    s().toggleChannelReaction(id, '👍')
    signIn(member)
    s().toggleChannelReaction(id, '👍')
    s().toggleChannelReaction(id, '🎉')
    expect(groupReactions(s().channelReactions, id, member)).toEqual([
      { emoji: '👍', count: 2, mine: true, userIds: [admin, member] },
      { emoji: '🎉', count: 1, mine: true, userIds: [member] },
    ])
    s().toggleChannelReaction(id, '👍')
    expect(groupReactions(s().channelReactions, id, member)[0].count).toBe(1)
  })

  it('counts unread and mentions until the channel is read', () => {
    s().sendChannelMessage(ch, 'hello')
    s().sendChannelMessage(ch, '@everyone standup in 5')
    signIn(member)
    expect(channelUnread(s().channelMessages, s().channelReads, ch, member)).toEqual({ unread: 2, mentions: 1 })
    expect(channelBadge(s().channels, s().channelMessages, s().channelReads, user(member))).toEqual({
      unreadChannels: 1,
      mentions: 1,
    })
    s().markChannelRead(ch)
    expect(channelUnread(s().channelMessages, s().channelReads, ch, member)).toEqual({ unread: 0, mentions: 0 })
    // Your own messages are never unread.
    expect(channelUnread(s().channelMessages, s().channelReads, ch, admin).unread).toBe(0)
  })
})

describe('categories', () => {
  it('keeps channels when their category is deleted', () => {
    const cat = s().createChannelCategory('Temp')!
    const id = s().createChannel({ name: 'kept', categoryId: cat })!
    s().deleteChannelCategory(cat)
    expect(s().channels.find((c) => c.id === id)?.categoryId).toBeUndefined()
    expect(channelTree(s().channelCategories, s().channels, user(admin))[0].category).toBeNull()
  })
})

describe('mention helpers', () => {
  it('round-trips names and tokens', () => {
    const users = s().users
    const encoded = encodeMentions('ping @Carol Chan and @nobody', users)
    expect(encoded).toBe(`ping <@${carol}> and @nobody`)
    expect(decodeMentions(encoded, users)).toBe('ping @Carol Chan and @nobody')
  })

  it('does not treat emails as mentions', () => {
    expect(encodeMentions('mail carol@Carol Chan', s().users)).toBe('mail carol@Carol Chan')
    expect(mentionsUser('write to team@everyone.com', member)).toBe(false)
    expect(parseBody('team@everyone.com')).toEqual([{ kind: 'text', text: 'team@everyone.com' }])
  })

  it('finds the @query at the caret', () => {
    expect(mentionQueryAt('hi @car', 7)).toEqual({ start: 3, query: 'car' })
    expect(mentionQueryAt('hi @', 4)).toEqual({ start: 3, query: '' })
    expect(mentionQueryAt('mail a@b', 8)).toBeNull()
  })

  it('splits a body into render segments', () => {
    expect(parseBody(`see <@${carol}> at https://x.dev/a. run \`npm i\` @here`)).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'mention', userId: carol },
      { kind: 'text', text: ' at ' },
      { kind: 'link', href: 'https://x.dev/a' },
      { kind: 'text', text: '. run ' },
      { kind: 'code', text: 'npm i' },
      { kind: 'text', text: ' ' },
      { kind: 'room', text: '@here' },
    ])
  })
})

describe('spaces', () => {
  it('a channel belongs to the studio unless created for a client', () => {
    const clientId = s().clients[0].id
    const studio = s().createChannel({ name: 'general' })!
    const mine = s().createChannel({ name: 'updates', clientId })!
    expect(spaceOf(s().channels.find((c) => c.id === studio)!)).toBe(STUDIO_SPACE)
    expect(spaceOf(s().channels.find((c) => c.id === mine)!)).toBe(clientId)
    expect(inSpace(s().channels, clientId).map((c) => c.id)).toEqual([mine])
    // An unknown client falls back to the studio.
    const orphan = s().createChannel({ name: 'lost', clientId: 'nope' })!
    expect(s().channels.find((c) => c.id === orphan)?.clientId).toBeUndefined()
  })

  it('keeps a channel in the same space as its category', () => {
    const clientId = s().clients[0].id
    const studioCat = s().createChannelCategory('Studio')!
    const clientCat = s().createChannelCategory('Client', clientId)!
    const ch = s().createChannel({ name: 'x', clientId, categoryId: studioCat })!
    expect(s().channels.find((c) => c.id === ch)?.categoryId).toBeUndefined()
    s().updateChannel(ch, { categoryId: clientCat })
    expect(s().channels.find((c) => c.id === ch)?.categoryId).toBe(clientCat)
    expect(s().channelCategories.find((c) => c.id === clientCat)?.clientId).toBe(clientId)
  })

  it('counts unread per space for the rail', () => {
    const clientId = s().clients[0].id
    const studio = s().createChannel({ name: 'general' })!
    const mine = s().createChannel({ name: 'updates', clientId })!
    s().sendChannelMessage(studio, 'hello')
    s().sendChannelMessage(mine, '@everyone ping')
    signIn(member)
    const badges = spaceBadges(s().channels, s().channelMessages, s().channelReads, user(member))
    expect(badges.get(STUDIO_SPACE)).toEqual({ unreadChannels: 1, mentions: 0 })
    expect(badges.get(clientId)).toEqual({ unreadChannels: 1, mentions: 1 })
  })
})
