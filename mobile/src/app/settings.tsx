import { useState } from 'react'
import { Feather } from '@expo/vector-icons'
import { Alert, Pressable, Text, View } from 'react-native'

import { Avatar, Button, Card, Chip, Screen, SectionTitle } from '@/components/ui'
import { UserForm } from '@/components/UserForm'
import { useSession } from '@/context/session-context'
import { isSupabaseConfigured } from '@/lib/supabase'
import { fonts, roleChip, useTheme } from '@/lib/theme'
import { useStore } from '@/store/useStore'
import type { User } from '@/lib/types'

export default function Settings() {
  const p = useTheme()
  const { isAdmin } = useSession()
  const users = useStore((s) => s.users)
  const settings = useStore((s) => s.settings)
  const resetSeed = useStore((s) => s.resetSeed)

  const [formOpen, setFormOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const openCreate = () => { setEditingUser(null); setFormOpen(true) }
  const openEdit = (u: User) => { setEditingUser(u); setFormOpen(true) }

  function confirmReset() {
    Alert.alert('Reset demo data', 'This restores all sample data and discards local changes. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: () => { resetSeed(); Alert.alert('Done', 'Demo data restored.') } },
    ])
  }

  if (!isAdmin) {
    return (
      <Screen>
        <Card><Text style={{ color: p.textMuted, fontSize: 14, fontFamily: fonts.sans }}>Settings are available to admins only.</Text></Card>
      </Screen>
    )
  }

  return (
    <Screen scroll>
      <SectionTitle>Workspace</SectionTitle>
      <Card style={{ marginBottom: 20, gap: 10 }}>
        <Row label="Name" value={settings.workspaceName} />
        <Row label="Auto-archive" value={`${settings.autoArchiveDays} days`} />
        <Row label="Backend" value={isSupabaseConfigured ? 'Supabase (connected)' : 'Local mode'} />
      </Card>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <SectionTitle style={{ marginBottom: 0 }}>Team ({users.length})</SectionTitle>
        <Pressable onPress={openCreate} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Feather name="plus" size={14} color={p.brandText} />
          <Text style={{ fontSize: 13, color: p.brandText, fontFamily: fonts.sansSemibold }}>Add user</Text>
        </Pressable>
      </View>
      <Card style={{ marginBottom: 20, gap: 0, padding: 0 }}>
        {users.map((u, i) => (
          <Pressable
            key={u.id}
            onPress={() => openEdit(u)}
            style={({ pressed }) => [
              { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
              i < users.length - 1 && { borderBottomWidth: 1, borderBottomColor: p.border },
              pressed && { backgroundColor: p.hover },
            ]}
          >
            <Avatar name={u.fullName} colorClass={u.avatarColor} size={38} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontFamily: fonts.sansSemibold, color: p.textHigh }}>{u.fullName}</Text>
              <Text style={{ fontSize: 12, fontFamily: fonts.mono, color: p.textMuted }}>{u.email}</Text>
            </View>
            <Chip label={u.role === 'admin' ? 'Admin' : 'Member'} colors={roleChip(u.role)} />
            <Feather name="chevron-right" size={16} color={p.iconMuted} />
          </Pressable>
        ))}
      </Card>

      <SectionTitle>Data</SectionTitle>
      <Card style={{ marginBottom: 20 }}>
        <Text style={{ fontSize: 13, fontFamily: fonts.sans, color: p.textMuted, marginBottom: 12, lineHeight: 19 }}>
          {isSupabaseConfigured
            ? 'Connected to Supabase — changes sync to the cloud.'
            : 'Running in local mode — users and all data persist on this device. Cloud sync activates once Supabase is connected.'}
        </Text>
        <Button title="Reset demo data" icon="refresh-ccw" variant="danger" onPress={confirmReset} />
      </Card>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', marginTop: 8 }}>
        <Feather name="zap" size={12} color={p.iconMuted} />
        <Text style={{ fontSize: 11, fontFamily: fonts.sans, color: p.textMuted }}>DeskDev Studio · local build</Text>
      </View>

      <UserForm visible={formOpen} user={editingUser ?? undefined} onClose={() => setFormOpen(false)} />
    </Screen>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  const p = useTheme()
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ fontSize: 13, fontFamily: fonts.sans, color: p.textMuted }}>{label}</Text>
      <Text style={{ fontSize: 13, fontFamily: fonts.sansSemibold, color: p.textHigh, fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  )
}
