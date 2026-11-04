import { useState } from 'react'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Alert, Pressable, ScrollView, Text, View } from 'react-native'

import {
  ActionSheet, Avatar, Card, Chip, EmptyState, Fab, FilterChip, Input, Screen,
} from '@/components/ui'
import { ClientForm } from '@/components/ClientForm'
import { useSession } from '@/context/session-context'
import { can } from '@/lib/permissions'
import {
  CLIENT_STATUS_LABELS, clientStatusChip, engagementChip, ENGAGEMENT_LABELS, fonts, radius,
  space, useTheme,
} from '@/lib/theme'
import { useStore } from '@/store/useStore'
import type { Client, Engagement } from '@/lib/types'

const ENG_FILTERS: { label: string; value: Engagement | 'all' }[] = [
  { label: 'All', value: 'all' },
  ...(['full_time', 'part_time', 'gig_on_call'] as Engagement[]).map((e) => ({
    label: ENGAGEMENT_LABELS[e],
    value: e,
  })),
]

export default function Clients() {
  const p = useTheme()
  const router = useRouter()
  const { user } = useSession()
  const canEdit = can(user, 'clients', 'edit')

  const clients = useStore((s) => s.clients)
  const projects = useStore((s) => s.projects)
  const tasks = useStore((s) => s.tasks)
  const deleteClient = useStore((s) => s.deleteClient)

  const [q, setQ] = useState('')
  const [eng, setEng] = useState<Engagement | 'all'>('all')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Client | undefined>(undefined)
  const [menuFor, setMenuFor] = useState<Client | null>(null)

  const shown = clients.filter(
    (c) =>
      (!q || `${c.name} ${c.company ?? ''} ${c.email ?? ''}`.toLowerCase().includes(q.toLowerCase())) &&
      (eng === 'all' || c.engagement === eng),
  )

  const openCreate = () => {
    setEditing(undefined)
    setFormOpen(true)
  }

  const openEdit = (c: Client) => {
    setEditing(c)
    setFormOpen(true)
  }

  const confirmDelete = (c: Client) => {
    Alert.alert(
      'Delete client?',
      `"${c.name}" and its projects, tasks, and CRM data will be permanently removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          // Refused when the client has retained engagement records (or offline): say why.
          onPress: () => {
            void deleteClient(c.id).then((res) => {
              if (!res.ok) Alert.alert('Could not delete', res.error ?? 'Try again.')
            })
          },
        },
      ],
    )
  }

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: canEdit ? 92 : 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <Input value={q} onChangeText={setQ} placeholder="Search clients…" style={{ marginBottom: 10 }} />
        {/* Was a hand-rolled pill sized by paddingVertical, which sheared the text on longer
            labels and had no pressed state. FilterChip sizes by minHeight and is the one
            filter pill in the app. */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.lg }}>
          {ENG_FILTERS.map((f) => (
            <FilterChip
              key={f.value}
              label={f.label}
              active={eng === f.value}
              onPress={() => setEng(f.value)}
            />
          ))}
        </View>
        {shown.length === 0 ? (
          <EmptyState
            icon="users"
            title={clients.length === 0 ? 'No clients yet' : 'No clients'}
            hint={clients.length === 0 ? 'Add your first client to get started.' : 'No clients match your search.'}
          />
        ) : (
          <View style={{ gap: 10 }}>
            {shown.map((c) => {
              const openProjects = projects.filter((pr) => pr.clientId === c.id && pr.status !== 'done').length
              const openTasks = tasks.filter((t) => t.clientId === c.id && t.status !== 'done' && !t.archived).length
              return (
                <Card key={c.id} onPress={() => router.push(`/client/${c.id}`)}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                    <Avatar name={c.name} colorClass={c.color} imageKey={c.avatarKey ?? null} size={40} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontFamily: fonts.sansSemibold, color: p.textHigh }}>{c.name}</Text>
                      {c.company ? <Text style={{ fontSize: 12, fontFamily: fonts.sans, color: p.textMuted }}>{c.company}</Text> : null}
                    </View>
                    {canEdit ? (
                      <Pressable onPress={() => setMenuFor(c)} hitSlop={10} style={{ padding: 4 }}>
                        <Feather name="more-vertical" size={18} color={p.iconMuted} />
                      </Pressable>
                    ) : (
                      <Feather name="chevron-right" size={18} color={p.iconMuted} />
                    )}
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    <Chip label={ENGAGEMENT_LABELS[c.engagement]} colors={engagementChip(c.engagement)} />
                    <Chip label={CLIENT_STATUS_LABELS[c.status]} colors={clientStatusChip(c.status)} />
                  </View>
                  <Text style={{ fontSize: 12, fontFamily: fonts.sans, color: p.textMuted, fontVariant: ['tabular-nums'] }}>
                    {openProjects} active projects · {openTasks} open tasks
                  </Text>
                </Card>
              )
            })}
          </View>
        )}
      </ScrollView>

      {canEdit ? <Fab icon="plus" onPress={openCreate} /> : null}
      <ClientForm visible={formOpen} client={editing} onClose={() => setFormOpen(false)} />
      <ActionSheet
        visible={menuFor !== null}
        title={menuFor?.name}
        actions={menuFor ? [
          { label: 'Edit', icon: 'edit-2', onPress: () => openEdit(menuFor) },
          { label: 'Delete', icon: 'trash-2', destructive: true, onPress: () => confirmDelete(menuFor) },
        ] : []}
        onClose={() => setMenuFor(null)}
      />
    </Screen>
  )
}
