import { useMemo, useState } from 'react'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { FlatList, Pressable, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Avatar, Button, EmptyState, Input, Label, Screen } from '@/components/ui'
import { useSession } from '@/context/session-context'
import { fonts, radius, space, useTheme } from '@/lib/theme'
import type { User } from '@/lib/types'
import { useStore } from '@/store/useStore'

export default function NewChat() {
  const p = useTheme()
  const router = useRouter()
  const { user } = useSession()
  const users = useStore((s) => s.users)
  const startConversation = useStore((s) => s.startConversation)

  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [groupName, setGroupName] = useState('')

  const people = useMemo(
    () =>
      users
        .filter((u) => u.id !== user?.id)
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [users, user?.id],
  )

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return people
    return people.filter(
      (u) =>
        u.fullName.toLowerCase().includes(q) ||
        (u.email?.toLowerCase().includes(q) ?? false) ||
        (u.title?.toLowerCase().includes(q) ?? false),
    )
  }, [people, query])

  const toggle = (id: string) =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))

  const isGroup = selected.length > 1

  const start = () => {
    const id = startConversation(selected, isGroup ? groupName : undefined)
    if (id) router.replace({ pathname: '/messages/[id]', params: { id } })
  }

  const renderPerson = ({ item: u }: { item: User }) => {
    const checked = selected.includes(u.id)
    return (
      <Pressable
        onPress={() => toggle(u.id)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        style={({ pressed }) => [
          {
            flexDirection: 'row', alignItems: 'center', gap: space.md,
            paddingVertical: space.md, paddingHorizontal: space.md,
            borderRadius: radius.lg, borderWidth: 1,
            backgroundColor: p.card, borderColor: checked ? p.brand : p.border,
          },
          pressed && { backgroundColor: p.hover },
        ]}
      >
        <Avatar name={u.fullName} colorClass={u.avatarColor} size={36} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 15, fontFamily: fonts.sansSemibold, color: p.textHigh }}>
            {u.fullName}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: 12, fontFamily: fonts.sans, color: p.textMuted, marginTop: 1 }}>
            {u.title || u.email || (u.role === 'admin' ? 'Admin' : 'Member')}
          </Text>
        </View>
        <View
          style={{
            width: 22, height: 22, borderRadius: radius.sm, borderWidth: 1.5,
            borderColor: checked ? p.brand : p.borderStrong,
            backgroundColor: checked ? p.brand : 'transparent',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          {checked ? <Feather name="check" size={14} color="#fff" /> : null}
        </View>
      </Pressable>
    )
  }

  return (
    <Screen padded={false}>
      <FlatList
        data={visible}
        keyExtractor={(u) => u.id}
        renderItem={renderPerson}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: space.lg, gap: space.sm }}
        ListHeaderComponent={
          <View style={{ gap: space.md, marginBottom: space.sm }}>
            <Input
              value={query}
              onChangeText={setQuery}
              placeholder="Search people"
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode="while-editing"
            />
            {isGroup ? (
              <View>
                <Label>Group name (optional)</Label>
                <Input
                  value={groupName}
                  onChangeText={setGroupName}
                  placeholder="e.g. Launch team"
                  maxLength={80}
                />
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="users"
            title={people.length === 0 ? 'No teammates yet' : 'No one matches'}
            hint={people.length === 0 ? 'Once other people have accounts you can message them here.' : 'Try a different name or email.'}
          />
        }
      />
      <SafeAreaView edges={['bottom']} style={{ borderTopWidth: 1, borderTopColor: p.border, backgroundColor: p.surface }}>
        <View style={{ padding: space.lg }}>
          <Button
            title={
              selected.length === 0
                ? 'Start chat'
                : isGroup
                  ? `Start group chat (${selected.length})`
                  : 'Start chat'
            }
            icon="message-circle"
            onPress={start}
            disabled={selected.length === 0}
          />
        </View>
      </SafeAreaView>
    </Screen>
  )
}
