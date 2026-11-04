import { useMemo, useState } from 'react'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { FlatList, Pressable, Text, View } from 'react-native'

import { Avatar, Button, Card, EmptyState, Fab, Input, Screen } from '@/components/ui'
import { useSession } from '@/context/session-context'
import { conversationTitle, inboxFor, lastMessageOf, unreadCount } from '@/lib/chat'
import { fmtRelative } from '@/lib/format'
import { fonts, radius, space, useTheme } from '@/lib/theme'
import type { Conversation, ChatMessage, User } from '@/lib/types'
import { useStore } from '@/store/useStore'

interface InboxRow {
  conversation: Conversation
  title: string
  last?: ChatMessage
  unread: number
  /** The single other person in a DM — drives the avatar color. */
  peer?: User
}

export default function MessagesInbox() {
  const p = useTheme()
  const router = useRouter()
  const { user } = useSession()
  const me = user?.id

  // Raw slices only — every derived array is built in useMemo (Zustand v5).
  const conversations = useStore((s) => s.conversations)
  const messages = useStore((s) => s.messages)
  const reads = useStore((s) => s.conversationReads)
  const users = useStore((s) => s.users)

  const [query, setQuery] = useState('')

  const rows = useMemo<InboxRow[]>(() => {
    if (!me) return []
    return inboxFor(conversations, me).map((c) => ({
      conversation: c,
      title: conversationTitle(c, users, me),
      last: lastMessageOf(messages, c.id),
      unread: unreadCount(messages, reads, c.id, me),
      peer: c.isGroup ? undefined : users.find((u) => u.id !== me && c.participantIds.includes(u.id)),
    }))
  }, [conversations, messages, reads, users, me])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) => r.title.toLowerCase().includes(q) || (r.last?.body.toLowerCase().includes(q) ?? false),
    )
  }, [rows, query])

  const openNew = () => router.push('/messages/new')

  const renderRow = ({ item }: { item: InboxRow }) => {
    const { conversation: c, title, last, unread, peer } = item
    const bold = unread > 0
    const preview = last
      ? `${last.senderId === me ? 'You: ' : ''}${last.body.replace(/\s+/g, ' ')}`
      : 'No messages yet'
    return (
      <Card onPress={() => router.push({ pathname: '/messages/[id]', params: { id: c.id } })}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          {c.isGroup ? (
            <View
              style={{
                width: 40, height: 40, borderRadius: 20, backgroundColor: p.hover,
                borderWidth: 1, borderColor: p.border, alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Feather name="users" size={17} color={p.textSecondary} />
            </View>
          ) : (
            <Avatar name={title} colorClass={peer?.avatarColor} size={40} />
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Text
                numberOfLines={1}
                style={{ flex: 1, fontSize: 15, fontFamily: bold ? fonts.sansBold : fonts.sansSemibold, color: p.textHigh }}
              >
                {title}
              </Text>
              <Text style={{ fontSize: 11, fontFamily: fonts.mono, color: bold ? p.brandText : p.textMuted, fontVariant: ['tabular-nums'] }}>
                {fmtRelative(last?.createdAt ?? c.lastMessageAt)}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 3 }}>
              <Text
                numberOfLines={1}
                style={{
                  flex: 1, fontSize: 13, lineHeight: 18,
                  fontFamily: bold ? fonts.sansSemibold : fonts.sans,
                  color: bold ? p.text : p.textMuted,
                  fontStyle: last ? 'normal' : 'italic',
                }}
              >
                {preview}
              </Text>
              {unread > 0 ? (
                <View
                  accessibilityLabel={`${unread} unread`}
                  style={{
                    minWidth: 20, height: 20, borderRadius: radius.pill, paddingHorizontal: 6,
                    backgroundColor: p.brand, alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 11, fontFamily: fonts.monoSemibold, fontVariant: ['tabular-nums'] }}>
                    {unread > 99 ? '99+' : unread}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>
      </Card>
    )
  }

  return (
    <Screen padded={false}>
      <FlatList
        data={visible}
        keyExtractor={(r) => r.conversation.id}
        renderItem={renderRow}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: space.lg, paddingBottom: 96, gap: space.sm }}
        ListHeaderComponent={
          rows.length > 0 ? (
            <View style={{ marginBottom: space.sm }}>
              <View style={{ justifyContent: 'center' }}>
                <Feather
                  name="search"
                  size={15}
                  color={p.iconMuted}
                  style={{ position: 'absolute', left: 12, zIndex: 1 }}
                />
                <Input
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search conversations"
                  autoCorrect={false}
                  returnKeyType="search"
                  clearButtonMode="while-editing"
                  style={{ paddingLeft: 34 }}
                />
              </View>
            </View>
          ) : null
        }
        ListEmptyComponent={
          rows.length === 0 ? (
            <EmptyState
              icon="message-circle"
              title="No conversations yet"
              hint="Message a teammate directly or start a group chat."
              action={<Button title="Start a chat" icon="edit-3" onPress={openNew} />}
            />
          ) : (
            <View style={{ alignItems: 'center', paddingVertical: space.xl }}>
              <Text style={{ fontSize: 13, fontFamily: fonts.sans, color: p.textMuted }}>
                No conversations match “{query.trim()}”.
              </Text>
              <Pressable onPress={() => setQuery('')} hitSlop={8} style={{ marginTop: space.sm }}>
                <Text style={{ fontSize: 13, fontFamily: fonts.sansSemibold, color: p.brandText }}>Clear search</Text>
              </Pressable>
            </View>
          )
        }
      />
      <Fab icon="edit-3" onPress={openNew} />
    </Screen>
  )
}
