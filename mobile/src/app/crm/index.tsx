import { useState } from 'react'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Alert, Pressable, ScrollView, Text, View } from 'react-native'

import { ActionSheet, Card, EmptyState, Fab, Screen } from '@/components/ui'
import { TableForm } from '@/components/crm/TableForm'
import { useSession } from '@/context/session-context'
import { can } from '@/lib/permissions'
import { fmtRelative } from '@/lib/format'
import { fonts, useTheme } from '@/lib/theme'
import { useStore } from '@/store/useStore'
import type { CrmTable } from '@/lib/types'

export default function CrmTablesList() {
  const p = useTheme()
  const router = useRouter()
  const { user } = useSession()
  const canEdit = can(user, 'crm', 'edit')
  const tables = useStore((s) => s.crmTables)
  const columns = useStore((s) => s.crmColumns)
  const rows = useStore((s) => s.crmRows)
  const clients = useStore((s) => s.clients)
  const deleteCrmTable = useStore((s) => s.deleteCrmTable)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<CrmTable | undefined>(undefined)
  const [menuFor, setMenuFor] = useState<CrmTable | null>(null)

  const clientName = (id?: string) => clients.find((c) => c.id === id)?.name
  const openCreate = () => { setEditing(undefined); setFormOpen(true) }
  const openEdit = (t: CrmTable) => { setEditing(t); setFormOpen(true) }
  const confirmDelete = (t: CrmTable) =>
    Alert.alert('Delete table?', `"${t.name}" and all its columns and rows will be permanently removed.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteCrmTable(t.id) },
    ])

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: canEdit ? 92 : 16 }}>
        {tables.length === 0 ? (
          <EmptyState
            icon="grid"
            title="No tables yet"
            hint={canEdit ? 'Create your first custom CRM table.' : 'Custom CRM tables show here.'}
          />
        ) : (
          <View style={{ gap: 10 }}>
            {tables.map((t) => {
              const colCount = columns.filter((c) => c.tableId === t.id).length
              const rowCount = rows.filter((r) => r.tableId === t.id).length
              return (
                <Card key={t.id} onPress={() => router.push(`/crm/${t.id}`)}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.color ?? p.brand }} />
                    <Text style={{ flex: 1, fontSize: 15, fontFamily: fonts.sansSemibold, color: p.textHigh }}>{t.name}</Text>
                    {canEdit ? (
                      <Pressable onPress={() => setMenuFor(t)} hitSlop={10} style={{ padding: 4 }}>
                        <Feather name="more-vertical" size={18} color={p.iconMuted} />
                      </Pressable>
                    ) : (
                      <Feather name="chevron-right" size={18} color={p.iconMuted} />
                    )}
                  </View>
                  <Text style={{ fontSize: 12, fontFamily: fonts.sans, color: p.textMuted, fontVariant: ['tabular-nums'] }}>
                    {colCount} columns · {rowCount} rows
                    {clientName(t.clientId) ? ` · ${clientName(t.clientId)}` : ''} · {fmtRelative(t.updatedAt)}
                  </Text>
                </Card>
              )
            })}
          </View>
        )}
      </ScrollView>

      {canEdit ? <Fab icon="plus" onPress={openCreate} /> : null}
      <TableForm visible={formOpen} table={editing} onClose={() => setFormOpen(false)} />
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
