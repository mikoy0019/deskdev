import { Feather } from '@expo/vector-icons'
import { useRouter, type Href } from 'expo-router'
import { Pressable, Text, View } from 'react-native'

import { Card, EmptyState, Screen } from '@/components/ui'
import { useSession } from '@/context/session-context'
import { fmtRelative } from '@/lib/format'
import { fonts, useTheme } from '@/lib/theme'
import type { Notification } from '@/lib/types'
import { useStore } from '@/store/useStore'

/** Where a notification leads in the app — the mobile counterpart of the web's notificationHref. */
function hrefFor(n: Pick<Notification, 'entity' | 'entityId'>): Href | null {
  const id = n.entityId
  switch (n.entity) {
    case 'lead':
      return id ? `/growth/${id}` : '/growth'
    case 'project':
      return id ? `/project/${id}` : '/projects'
    case 'client':
      return id ? `/client/${id}` : '/clients'
    case 'showcase':
      return id ? `/portfolio/${id}` : '/portfolio'
    case 'conversation':
      return id ? `/messages/${id}` : '/messages'
    case 'task':
      return '/tasks'
    case 'event':
      return '/meetings'
    case 'crm_table':
      return id ? `/crm/${id}` : '/crm'
    case 'crm_row':
    case 'crm_column':
      return '/crm'
    default:
      return null
  }
}

export default function Notifications() {
  const p = useTheme()
  const { user } = useSession()
  const all = useStore((s) => s.notifications)
  const markRead = useStore((s) => s.markRead)
  const markAllRead = useStore((s) => s.markAllRead)
  const router = useRouter()

  const mine = all
    .filter((n) => n.userId === user?.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const unread = mine.filter((n) => !n.read).length

  return (
    <Screen scroll>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <Pressable
          onPress={() => router.push('/notification-settings')}
          hitSlop={8}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
          accessibilityRole="button"
        >
          <Feather name="smartphone" size={14} color={p.brandText} />
          <Text style={{ fontSize: 13, color: p.brandText, fontFamily: fonts.sansSemibold }}>Push settings</Text>
        </Pressable>
        {unread > 0 ? (
          <Pressable onPress={markAllRead} hitSlop={8}>
            <Text style={{ fontSize: 13, color: p.brandText, fontFamily: fonts.sansSemibold, fontVariant: ['tabular-nums'] }}>Mark all read ({unread})</Text>
          </Pressable>
        ) : null}
      </View>

      {mine.length === 0 ? (
        <EmptyState icon="bell" title="No notifications" hint="You're all caught up." />
      ) : (
        <View style={{ gap: 8 }}>
          {mine.map((n) => (
            <Card
              key={n.id}
              onPress={() => {
                markRead(n.id)
                const href = hrefFor(n)
                if (href) router.push(href)
              }}
            >
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {!n.read ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.brand, marginTop: 5 }} /> : <View style={{ width: 8 }} />}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontFamily: n.read ? fonts.sansMedium : fonts.sansSemibold, color: p.textHigh }}>{n.title}</Text>
                  {n.body ? <Text style={{ fontSize: 13, fontFamily: fonts.sans, color: p.textMuted, marginTop: 2, lineHeight: 18 }}>{n.body}</Text> : null}
                  <Text style={{ fontSize: 11, fontFamily: fonts.mono, color: p.textMuted, marginTop: 4 }}>{fmtRelative(n.createdAt)}</Text>
                </View>
                <Feather name="chevron-right" size={16} color={p.iconMuted} />
              </View>
            </Card>
          ))}
        </View>
      )}
    </Screen>
  )
}
