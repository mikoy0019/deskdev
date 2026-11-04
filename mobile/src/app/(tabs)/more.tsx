import { Feather } from '@expo/vector-icons'
import { useRouter, type Href } from 'expo-router'
import { Pressable, Text, View } from 'react-native'

import { Avatar, Card, Chip, Screen, ScreenHeader, SectionTitle } from '@/components/ui'
import { useSession } from '@/context/session-context'
import { can } from '@/lib/permissions'
import { fonts, radius, roleChip, useTheme, type ChipColors } from '@/lib/theme'
import { useStore, type ThemeMode } from '@/store/useStore'
import { useUnreadMessageCount } from '@/hooks/useUnreadMessageCount'
import type { FeatherIconName } from '@/components/ui'

export default function More() {
  const p = useTheme()
  const router = useRouter()
  const { user, isAdmin } = useSession()
  const logout = useStore((s) => s.logout)
  const themeMode = useStore((s) => s.settings.themeMode)
  const updateSettings = useStore((s) => s.updateSettings)
  const unreadMessages = useUnreadMessageCount()

  type Row = { icon: FeatherIconName; label: string; href: Href; show: boolean; badge?: number }
  const rows: Row[] = [
    { icon: 'trending-up', label: 'Leads', href: '/growth', show: can(user, 'growth', 'view') },
    { icon: 'users', label: 'Clients', href: '/clients', show: can(user, 'clients', 'view') },
    { icon: 'grid', label: 'CRM Tables', href: '/crm', show: can(user, 'crm', 'view') },
    { icon: 'video', label: 'Meetings', href: '/meetings', show: can(user, 'meetings', 'view') },
    { icon: 'image', label: 'Portfolio', href: '/portfolio', show: can(user, 'showcase', 'view') },
    { icon: 'file-text', label: 'End of Day Report', href: '/eod', show: true },
    { icon: 'message-circle', label: 'Messages', href: '/messages', show: true, badge: unreadMessages },
    { icon: 'bell', label: 'Notifications', href: '/notifications', show: true },
    { icon: 'smartphone', label: 'Push notifications', href: '/notification-settings', show: true },
    { icon: 'lock', label: 'Vault', href: '/vault', show: isAdmin },
    { icon: 'settings', label: 'Settings', href: '/settings', show: isAdmin },
  ]

  const modes: { key: ThemeMode; icon: FeatherIconName }[] = [
    { key: 'light', icon: 'sun' },
    { key: 'dark', icon: 'moon' },
    { key: 'system', icon: 'smartphone' },
  ]

  return (
    <Screen scroll tabScreen header={<ScreenHeader title="More" />}>
      {user ? (
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <Avatar name={user.fullName} colorClass={user.avatarColor} size={44} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, fontFamily: fonts.display, color: p.textHigh }}>{user.fullName}</Text>
            <Text numberOfLines={1} style={{ fontSize: 12, fontFamily: fonts.mono, color: p.textMuted, marginTop: 1 }}>{user.email}</Text>
          </View>
          <Chip label={user.role === 'admin' ? 'Admin' : 'Member'} colors={roleChip(user.role) as ChipColors} />
        </Card>
      ) : null}

      <SectionTitle>Workspace</SectionTitle>
      <Card style={{ marginBottom: 20, padding: 0 }}>
        {rows.filter((r) => r.show).map((r, i, arr) => (
          <Pressable
            key={r.label}
            onPress={() => router.push(r.href)}
            style={({ pressed }) => [
              { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 14 },
              i < arr.length - 1 && { borderBottomWidth: 1, borderBottomColor: p.border },
              pressed && { backgroundColor: p.hover },
            ]}
          >
            <Feather name={r.icon} size={18} color={p.textSecondary} />
            <Text style={{ flex: 1, fontSize: 15, fontFamily: fonts.sansMedium, color: p.textHigh }}>{r.label}</Text>
            {r.badge ? (
              <View
                accessibilityLabel={`${r.badge} unread`}
                style={{ minWidth: 20, height: 20, borderRadius: radius.pill, paddingHorizontal: 6, backgroundColor: p.brand, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ color: '#fff', fontSize: 11, fontFamily: fonts.monoSemibold, fontVariant: ['tabular-nums'] }}>
                  {r.badge > 99 ? '99+' : r.badge}
                </Text>
              </View>
            ) : null}
            <Feather name="chevron-right" size={18} color={p.iconMuted} />
          </Pressable>
        ))}
      </Card>

      <SectionTitle>Appearance</SectionTitle>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 24 }}>
        {modes.map((mode) => {
          const active = themeMode === mode.key
          return (
            <Pressable
              key={mode.key}
              onPress={() => updateSettings({ themeMode: mode.key })}
              style={{
                flex: 1, alignItems: 'center', gap: 6, paddingVertical: 14, borderRadius: radius.lg, borderWidth: 1,
                backgroundColor: active ? p.brand : p.card, borderColor: active ? p.brand : p.border,
              }}
            >
              <Feather name={mode.icon} size={18} color={active ? '#fff' : p.textSecondary} />
              <Text style={{ fontSize: 12, fontFamily: fonts.sansSemibold, textTransform: 'capitalize', color: active ? '#fff' : p.textSecondary }}>{mode.key}</Text>
            </Pressable>
          )
        })}
      </View>

      <Pressable
        onPress={logout}
        style={({ pressed }) => [
          { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: radius.lg, borderWidth: 1, borderColor: p.border },
          pressed && { backgroundColor: p.hover },
        ]}
      >
        <Feather name="log-out" size={16} color={p.danger} />
        <Text style={{ fontSize: 14, fontFamily: fonts.sansSemibold, color: p.danger }}>Log out</Text>
      </Pressable>

      <Text style={{ textAlign: 'center', fontSize: 11, fontFamily: fonts.mono, color: p.textMuted, marginTop: 24 }}>DeskDev Studio · local build</Text>
    </Screen>
  )
}
