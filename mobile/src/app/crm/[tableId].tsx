import { useState } from 'react'
import { Feather } from '@expo/vector-icons'
import { useLocalSearchParams } from 'expo-router'
import { Alert, Pressable, ScrollView, Text, View } from 'react-native'
import { useShallow } from 'zustand/react/shallow'

import { Button, EmptyState, Screen } from '@/components/ui'
import { ColumnForm } from '@/components/crm/ColumnForm'
import { CellEditor } from '@/components/crm/CellEditor'
import { useSession } from '@/context/session-context'
import { can } from '@/lib/permissions'
import { fmtDate } from '@/lib/format'
import { fonts, useTheme } from '@/lib/theme'
import { useStore } from '@/store/useStore'
import type { CrmCellValue, CrmColumn } from '@/lib/types'

const COL_W = 150

export default function CrmTableDetail() {
  const p = useTheme()
  const { tableId } = useLocalSearchParams<{ tableId: string }>()
  const { user } = useSession()
  const canEdit = can(user, 'crm', 'edit')

  const table = useStore((s) => s.crmTables.find((t) => t.id === tableId))
  const columns = useStore(useShallow((s) => s.crmColumns.filter((c) => c.tableId === tableId).sort((a, b) => a.sortOrder - b.sortOrder)))
  const rows = useStore(useShallow((s) => s.crmRows.filter((r) => r.tableId === tableId).sort((a, b) => a.position - b.position)))
  const setCellValue = useStore((s) => s.setCellValue)
  const addCrmRow = useStore((s) => s.addCrmRow)
  const deleteCrmRow = useStore((s) => s.deleteCrmRow)

  const [columnForm, setColumnForm] = useState<{ column?: CrmColumn } | null>(null)
  const [editingCell, setEditingCell] = useState<{ rowId: string; column: CrmColumn } | null>(null)

  const openCell = (rowId: string, column: CrmColumn, value: CrmCellValue) => {
    if (!canEdit) return
    // Worked out on the web from the row's other cells (057); nothing to type here.
    if (column.type === 'formula') return
    if (column.type === 'checkbox') { setCellValue(rowId, column.id, value !== true); return }
    setEditingCell({ rowId, column })
  }

  const confirmDeleteRow = (rowId: string) =>
    Alert.alert('Delete row?', 'This row will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteCrmRow(rowId) },
    ])

  const editingValue = editingCell
    ? (rows.find((r) => r.id === editingCell.rowId)?.values[editingCell.column.id] ?? null)
    : null

  return (
    <Screen wide padded={false}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderBottomWidth: 1, borderBottomColor: p.border }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: table?.color ?? p.brand }} />
        <Text style={{ flex: 1, fontSize: 17, fontFamily: fonts.display, color: p.textHigh }} numberOfLines={1}>{table?.name ?? 'Table'}</Text>
        {canEdit ? (
          <>
            <Pressable onPress={() => setColumnForm({})} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Feather name="plus" size={14} color={p.brandText} />
              <Text style={{ fontSize: 13, color: p.brandText, fontFamily: fonts.sansSemibold }}>Column</Text>
            </Pressable>
            <Pressable onPress={() => addCrmRow({ tableId })} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Feather name="plus" size={14} color={p.brandText} />
              <Text style={{ fontSize: 13, color: p.brandText, fontFamily: fonts.sansSemibold }}>Row</Text>
            </Pressable>
          </>
        ) : null}
      </View>

      {columns.length === 0 ? (
        <View style={{ padding: 16 }}>
          <EmptyState
            icon="grid"
            title="No columns yet"
            hint={canEdit ? 'Add a column to start building this table.' : 'This table has no columns yet.'}
            action={canEdit ? <Button title="Add column" icon="plus" onPress={() => setColumnForm({})} /> : undefined}
          />
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View>
            <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: p.borderStrong, backgroundColor: p.surface }}>
              {columns.map((c) => (
                <Pressable
                  key={c.id}
                  disabled={!canEdit}
                  onPress={() => setColumnForm({ column: c })}
                  style={{ width: COL_W, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 4 }}
                >
                  <Feather name={iconFor(c.type)} size={12} color={p.iconMuted} />
                  <Text style={{ flex: 1, fontSize: 12, fontFamily: fonts.sansSemibold, color: p.textSecondary }} numberOfLines={1}>{c.name}</Text>
                  {canEdit ? <Feather name="chevron-down" size={12} color={p.iconMuted} /> : null}
                </Pressable>
              ))}
              {canEdit ? <View style={{ width: 44 }} /> : null}
            </View>

            <ScrollView>
              {rows.length === 0 ? (
                <View style={{ padding: 16 }}>
                  <Text style={{ color: p.textMuted, fontSize: 13, fontFamily: fonts.sans }}>No rows yet.{canEdit ? ' Tap “Row” to add one.' : ''}</Text>
                </View>
              ) : (
                rows.map((r) => (
                  <View key={r.id} style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: p.border }}>
                    {columns.map((c) => (
                      <Pressable
                        key={c.id}
                        disabled={!canEdit}
                        onPress={() => openCell(r.id, c, r.values[c.id] ?? null)}
                        style={{ width: COL_W, padding: 10, justifyContent: 'center', minHeight: 44 }}
                      >
                        <Cell column={c} value={r.values[c.id] ?? null} />
                      </Pressable>
                    ))}
                    {canEdit ? (
                      <Pressable onPress={() => confirmDeleteRow(r.id)} style={{ width: 44, alignItems: 'center', justifyContent: 'center' }}>
                        <Feather name="trash-2" size={15} color={p.iconMuted} />
                      </Pressable>
                    ) : null}
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </ScrollView>
      )}

      <ColumnForm
        visible={columnForm !== null}
        tableId={tableId}
        column={columnForm?.column}
        sortOrder={columns.length}
        onClose={() => setColumnForm(null)}
      />
      <CellEditor
        visible={editingCell !== null}
        column={editingCell?.column ?? null}
        value={editingValue}
        onClose={() => setEditingCell(null)}
        onSubmit={(v) => { if (editingCell) setCellValue(editingCell.rowId, editingCell.column.id, v) }}
      />
    </Screen>
  )
}

function iconFor(type: CrmColumn['type']): any {
  switch (type) {
    case 'number': return 'hash'
    case 'select': return 'chevron-down'
    case 'multi_select': return 'tag'
    case 'date': return 'calendar'
    case 'checkbox': return 'check-square'
    case 'url': return 'link'
    default: return 'type'
  }
}

function Cell({ column, value }: { column: CrmColumn; value: CrmCellValue }) {
  const p = useTheme()

  if (column.type === 'checkbox') {
    const checked = value === true
    return (
      <View style={{ width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: checked ? p.brand : p.borderStrong, backgroundColor: checked ? p.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {checked ? <Feather name="check" size={13} color="#ffffff" /> : null}
      </View>
    )
  }

  if ((column.type === 'select' || column.type === 'multi_select') && value != null) {
    const ids = Array.isArray(value) ? value : [String(value)]
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {ids.map((id) => {
          const opt = column.options.find((o) => o.id === id)
          if (!opt) return null
          // Was a raw slate literal (DESIGN.md #9 bans raw slate/gray/zinc): it ignores the
          // theme and reads muddy on dark. iconMuted is the themed equivalent.
          const c = opt.color ?? p.iconMuted
          return (
            <View key={id} style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: c + '26', borderWidth: 1, borderColor: c + '4d' }}>
              <Text style={{ fontSize: 11, fontFamily: fonts.sansMedium, color: c }}>{opt.label}</Text>
            </View>
          )
        })}
      </View>
    )
  }

  if (column.type === 'url' && value) {
    return <Text style={{ fontSize: 13, fontFamily: fonts.sans, color: p.brandText }} numberOfLines={1}>{String(value)}</Text>
  }
  if (column.type === 'date' && value) {
    return <Text style={{ fontSize: 13, fontFamily: fonts.mono, color: p.text, fontVariant: ['tabular-nums'] }}>{fmtDate(String(value))}</Text>
  }
  if (column.type === 'number' && value != null) {
    return <Text style={{ fontSize: 13, fontFamily: fonts.mono, color: p.text, textAlign: 'right', fontVariant: ['tabular-nums'] }}>{Number(value).toLocaleString()}</Text>
  }
  return <Text style={{ fontSize: 13, fontFamily: fonts.sans, color: value != null ? p.text : p.textMuted }} numberOfLines={2}>{value != null ? String(value) : '—'}</Text>
}
