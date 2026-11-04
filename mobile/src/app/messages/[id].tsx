import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Feather } from '@expo/vector-icons'
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useHeaderHeight } from 'expo-router/react-navigation'
import {
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Field, FormModal } from '@/components/forms'
import {
  ActionSheet, Avatar, Button, EmptyState, Input, Screen, type SheetAction,
} from '@/components/ui'
import { useSession } from '@/context/session-context'
import {
  conversationTitle, dayLabel, MAX_MESSAGE_LENGTH, otherParticipants, seenByOthers,
  startsDay, startsRun, threadMessages,
} from '@/lib/chat'
import { fmtTime } from '@/lib/format'
import { fonts, radius, space, useTheme } from '@/lib/theme'
import type { ChatMessage } from '@/lib/types'
import { useStore } from '@/store/useStore'

/** One rendered line of the thread, with its run/day flags precomputed. */
interface ThreadItem {
  message: ChatMessage
  mine: boolean
  newDay: boolean
  runStart: boolean
  runEnd: boolean
  senderName: string
  senderColor?: string
}

export default function ChatThreadScreen() {
  const p = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const headerHeight = useHeaderHeight()
  const { user: me } = useSession()
  const { id: rawId } = useLocalSearchParams<{ id: string }>()
  const conversationId = Array.isArray(rawId) ? rawId[0] : rawId

  // Raw slices only; derived data comes from useMemo (Zustand v5 selectors
  // returning fresh arrays would loop forever).
  const conversations = useStore((s) => s.conversations)
  const allMessages = useStore((s) => s.messages)
  const reads = useStore((s) => s.conversationReads)
  const users = useStore((s) => s.users)
  const sendMessage = useStore((s) => s.sendMessage)
  const editMessage = useStore((s) => s.editMessage)
  const deleteMessage = useStore((s) => s.deleteMessage)
  const markConversationRead = useStore((s) => s.markConversationRead)
  const renameConversation = useStore((s) => s.renameConversation)
  const deleteConversation = useStore((s) => s.deleteConversation)

  const conversation = useMemo(
    () => conversations.find((c) => c.id === conversationId),
    [conversations, conversationId],
  )
  const thread = useMemo(
    () => (conversationId ? threadMessages(allMessages, conversationId) : []),
    [allMessages, conversationId],
  )

  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [sheetMessage, setSheetMessage] = useState<ChatMessage | null>(null)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [keyboardShown, setKeyboardShown] = useState(false)
  const inputRef = useRef<TextInput>(null)

  // Mark read on focus, and again whenever a message lands while focused.
  const lastId = thread[thread.length - 1]?.id
  useFocusEffect(
    useCallback(() => {
      if (conversationId) markConversationRead(conversationId)
    }, [conversationId, thread.length, lastId, markConversationRead]),
  )

  // The composer drops its bottom safe-area padding while the keyboard is up
  // (the keyboard already covers the home indicator).
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const a = Keyboard.addListener(showEvt, () => setKeyboardShown(true))
    const b = Keyboard.addListener(hideEvt, () => setKeyboardShown(false))
    return () => {
      a.remove()
      b.remove()
    }
  }, [])

  // An edited message that disappears (deleted remotely) ends the edit.
  useEffect(() => {
    if (editingId && !thread.some((m) => m.id === editingId)) {
      setEditingId(null)
      setDraft('')
    }
  }, [editingId, thread])

  const meId = me?.id

  const items = useMemo<ThreadItem[]>(() => {
    const out: ThreadItem[] = []
    for (let i = 0; i < thread.length; i++) {
      const m = thread[i]
      const prev = thread[i - 1]
      const next = thread[i + 1]
      const newDay = startsDay(prev, m)
      const sender = users.find((u) => u.id === m.senderId)
      out.push({
        message: m,
        mine: m.senderId === meId,
        newDay,
        runStart: newDay || startsRun(prev, m),
        runEnd: !next || startsDay(m, next) || startsRun(m, next),
        senderName: sender?.fullName ?? 'Former member',
        senderColor: sender?.avatarColor,
      })
    }
    // Inverted list renders index 0 at the bottom — newest first.
    return out.reverse()
  }, [thread, users, meId])

  // ── Missing / deleted conversation ───────────────────────────────────────
  if (!conversation || !me) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Conversation', headerRight: undefined }} />
        <EmptyState
          icon="message-circle"
          title="Conversation unavailable"
          hint="This conversation was deleted or you are no longer part of it."
          action={
            <Button
              title="Back to messages"
              icon="arrow-left"
              variant="ghost"
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/messages'))}
            />
          }
        />
      </Screen>
    )
  }

  const title = conversationTitle(conversation, users, me.id)
  const others = otherParticipants(conversation, users, me.id)
  const subtitle = conversation.isGroup
    ? `${conversation.participantIds.length} members`
    : others[0]?.title || undefined
  const canDelete = conversation.createdBy === me.id || me.role === 'admin'
  const lastMine = [...thread].reverse().find((m) => m.senderId === me.id)
  const lastMessage = thread[thread.length - 1]
  const showSeen =
    Boolean(lastMine) && lastMessage?.id === lastMine?.id && seenByOthers(conversation, lastMine, reads, me.id)

  const canSend = draft.trim().length > 0

  const submit = () => {
    const body = draft.trim()
    if (!body) return
    if (editingId) {
      editMessage(editingId, body)
      setEditingId(null)
    } else if (!sendMessage(conversation.id, body)) {
      Alert.alert('Message not sent', 'This message could not be sent. Try again.')
      return
    }
    setDraft('')
  }

  const startEdit = (m: ChatMessage) => {
    setEditingId(m.id)
    setDraft(m.body)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const cancelEdit = () => {
    setEditingId(null)
    setDraft('')
  }

  const confirmDeleteMessage = (m: ChatMessage) => {
    Alert.alert('Delete message?', 'This removes the message for everyone in the chat.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          if (editingId === m.id) cancelEdit()
          deleteMessage(m.id)
        },
      },
    ])
  }

  const confirmDeleteConversation = () => {
    Alert.alert(
      'Delete conversation?',
      `All messages in "${title}" will be permanently deleted for every member.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteConversation(conversation.id)
            if (router.canGoBack()) router.back()
            else router.replace('/messages')
          },
        },
      ],
    )
  }

  const messageActions: SheetAction[] = sheetMessage
    ? [
        { label: 'Edit', icon: 'edit-2', onPress: () => startEdit(sheetMessage) },
        { label: 'Delete', icon: 'trash-2', destructive: true, onPress: () => confirmDeleteMessage(sheetMessage) },
      ]
    : []

  const conversationActions: SheetAction[] = [
    ...(conversation.isGroup
      ? [{
          label: 'Rename group',
          icon: 'edit-2' as const,
          onPress: () => {
            setRenameValue(conversation.title ?? '')
            setRenameOpen(true)
          },
        }]
      : []),
    ...(canDelete
      ? [{ label: 'Delete conversation', icon: 'trash-2' as const, destructive: true, onPress: confirmDeleteConversation }]
      : []),
  ]

  const renderItem = ({ item }: { item: ThreadItem }) => {
    const { message: m, mine, newDay, runStart, runEnd, senderName, senderColor } = item
    const showSender = !mine && conversation.isGroup
    const meta = [
      runEnd ? fmtTime(m.createdAt) : null,
      runEnd && m.editedAt ? 'edited' : null,
      runEnd && mine && m.id === lastMine?.id && showSeen ? 'Seen' : null,
    ].filter(Boolean)
    const isEditing = editingId === m.id
    const tail = 6

    return (
      <View>
        {newDay ? (
          <View accessibilityRole="header" style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, marginVertical: space.lg }}>
            <View style={{ flex: 1, height: 1, backgroundColor: p.border }} />
            <Text style={{ fontSize: 10, fontFamily: fonts.sansSemibold, color: p.textMuted, textTransform: 'uppercase', letterSpacing: 1 }}>
              {dayLabel(m.createdAt)}
            </Text>
            <View style={{ flex: 1, height: 1, backgroundColor: p.border }} />
          </View>
        ) : null}

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            justifyContent: mine ? 'flex-end' : 'flex-start',
            gap: space.sm,
            marginTop: runStart && !newDay ? space.md : 2,
          }}
        >
          {showSender ? (
            <View style={{ width: 28, paddingTop: runStart ? 18 : 0 }}>
              {runStart ? <Avatar name={senderName} colorClass={senderColor} size={28} /> : null}
            </View>
          ) : null}

          <View style={{ maxWidth: '78%', alignItems: mine ? 'flex-end' : 'flex-start' }}>
            {showSender && runStart ? (
              <Text numberOfLines={1} style={{ fontSize: 11, fontFamily: fonts.sansMedium, color: p.textMuted, marginBottom: 3, marginLeft: 4 }}>
                {senderName}
              </Text>
            ) : null}
            <Pressable
              onLongPress={mine ? () => setSheetMessage(m) : undefined}
              delayLongPress={300}
              accessibilityHint={mine ? 'Long press to edit or delete' : undefined}
              style={({ pressed }) => ({
                paddingHorizontal: 14,
                paddingVertical: 9,
                borderRadius: 18,
                borderBottomRightRadius: mine && runEnd ? tail : 18,
                borderBottomLeftRadius: !mine && runEnd ? tail : 18,
                backgroundColor: mine ? p.brand : p.card,
                borderWidth: mine ? (isEditing ? 2 : 0) : 1,
                borderColor: mine ? p.brandText : p.border,
                opacity: pressed && mine ? 0.85 : 1,
              })}
            >
              <Text
                selectable={!mine}
                style={{ fontSize: 15, lineHeight: 21, fontFamily: fonts.sans, color: mine ? '#ffffff' : p.textHigh }}
              >
                {m.body}
              </Text>
            </Pressable>
            {meta.length > 0 ? (
              <Text style={{ fontSize: 10, fontFamily: fonts.mono, color: p.textMuted, marginTop: 4, marginHorizontal: 4, fontVariant: ['tabular-nums'] }}>
                {meta.join(' · ')}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    )
  }

  return (
    <Screen padded={false}>
      <Stack.Screen
        options={{
          title,
          headerTitle: () => (
            <View style={{ alignItems: Platform.OS === 'ios' ? 'center' : 'flex-start', maxWidth: 240 }}>
              <Text numberOfLines={1} style={{ fontSize: 16, fontFamily: fonts.display, color: p.textHigh }}>
                {title}
              </Text>
              {subtitle ? (
                <Text numberOfLines={1} style={{ fontSize: 11, fontFamily: fonts.mono, color: p.textMuted, fontVariant: ['tabular-nums'] }}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
          ),
          headerRight:
            conversationActions.length > 0
              ? () => (
                  <Pressable
                    onPress={() => setOptionsOpen(true)}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="Conversation options"
                    style={({ pressed }) => ({ padding: 4, opacity: pressed ? 0.6 : 1 })}
                  >
                    <Feather name="more-horizontal" size={22} color={p.textHigh} />
                  </Pressable>
                )
              : undefined,
        }}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
      >
        {thread.length === 0 ? (
          // Not an inverted list: ListEmptyComponent renders upside down there.
          <View style={{ flex: 1, justifyContent: 'center', padding: space.lg }}>
            <EmptyState
              icon={conversation.isGroup ? 'users' : 'message-circle'}
              title={`Start the conversation with ${title}`}
              hint="Messages are only visible to people in this chat."
            />
          </View>
        ) : (
          <FlatList
            inverted
            data={items}
            keyExtractor={(it) => it.message.id}
            renderItem={renderItem}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: space.md, paddingVertical: space.md }}
            accessibilityLabel={`Messages with ${title}`}
          />
        )}

        {/* ── Composer ─────────────────────────────────────────────── */}
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: p.border,
            backgroundColor: p.surface,
            paddingHorizontal: space.md,
            paddingTop: space.sm,
            paddingBottom: keyboardShown ? space.sm : Math.max(insets.bottom, space.sm),
          }}
        >
          {editingId ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4, paddingBottom: space.sm }}>
              <Feather name="edit-2" size={12} color={p.brandText} />
              <Text style={{ flex: 1, fontSize: 12, fontFamily: fonts.sansSemibold, color: p.brandText }}>Editing message</Text>
              <Pressable onPress={cancelEdit} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel editing">
                <Text style={{ fontSize: 12, fontFamily: fonts.sansSemibold, color: p.textSecondary }}>Cancel</Text>
              </Pressable>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
            <TextInput
              ref={inputRef}
              value={draft}
              onChangeText={setDraft}
              placeholder={`Message ${conversation.isGroup ? title : others[0]?.fullName.split(' ')[0] ?? title}`}
              placeholderTextColor={p.textMuted}
              multiline
              maxLength={MAX_MESSAGE_LENGTH}
              textAlignVertical="center"
              style={{
                flex: 1,
                minHeight: 40,
                maxHeight: 120,
                paddingHorizontal: 14,
                paddingTop: Platform.OS === 'ios' ? 10 : 8,
                paddingBottom: Platform.OS === 'ios' ? 10 : 8,
                borderRadius: 20,
                borderWidth: 1,
                borderColor: p.borderStrong,
                backgroundColor: p.hover,
                color: p.textHigh,
                fontSize: 15,
                fontFamily: fonts.sans,
              }}
            />
            <Pressable
              onPress={submit}
              disabled={!canSend}
              accessibilityRole="button"
              accessibilityLabel={editingId ? 'Save edit' : 'Send message'}
              accessibilityState={{ disabled: !canSend }}
              style={({ pressed }) => ({
                width: 40,
                height: 40,
                borderRadius: radius.pill,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: canSend ? p.brand : p.hover,
                borderWidth: canSend ? 0 : 1,
                borderColor: p.border,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Feather name={editingId ? 'check' : 'send'} size={17} color={canSend ? '#ffffff' : p.iconMuted} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      <ActionSheet
        visible={sheetMessage !== null}
        title="Your message"
        actions={messageActions}
        onClose={() => setSheetMessage(null)}
      />
      <ActionSheet
        visible={optionsOpen}
        title={title}
        actions={conversationActions}
        onClose={() => setOptionsOpen(false)}
      />
      <FormModal
        visible={renameOpen}
        title="Rename group"
        submitLabel="Save"
        onClose={() => setRenameOpen(false)}
        onSubmit={() => {
          renameConversation(conversation.id, renameValue)
          setRenameOpen(false)
        }}
      >
        <Field label="Group name">
          <Input
            value={renameValue}
            onChangeText={setRenameValue}
            placeholder="Leave empty to show member names"
            maxLength={80}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => {
              renameConversation(conversation.id, renameValue)
              setRenameOpen(false)
            }}
          />
        </Field>
      </FormModal>
    </Screen>
  )
}
