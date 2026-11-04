import { useState } from 'react'
import { Feather } from '@expo/vector-icons'
import { Alert, Pressable, Text, View } from 'react-native'

import { Input } from '@/components/ui'
import { ColorPicker, Field, FormModal, PillGroup, type PillOption } from '@/components/forms'
import { SWATCHES, fonts, radius, useTheme } from '@/lib/theme'
import { useStore } from '@/store/useStore'
import type { CrmColumn, CrmColumnType, CrmSelectOption } from '@/lib/types'

const TYPE_OPTIONS: PillOption<CrmColumnType>[] = [
  { label: 'Text', value: 'text' },
  { label: 'Number', value: 'number' },
  { label: 'Select', value: 'select' },
  { label: 'Multi', value: 'multi_select' },
  { label: 'Date', value: 'date' },
  { label: 'Checkbox', value: 'checkbox' },
  { label: 'URL', value: 'url' },
]

const optId = () => `opt-${Math.random().toString(36).slice(2, 9)}`

export function ColumnForm({
  visible, tableId, column, sortOrder, onClose,
}: {
  visible: boolean
  tableId: string
  column?: CrmColumn
  sortOrder?: number
  onClose: () => void
}) {
  const p = useTheme()
  const addCrmColumn = useStore((s) => s.addCrmColumn)
  const updateCrmColumn = useStore((s) => s.updateCrmColumn)
  const deleteCrmColumn = useStore((s) => s.deleteCrmColumn)

  const [wasVisible, setWasVisible] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<CrmColumnType>('text')
  const [options, setOptions] = useState<CrmSelectOption[]>([])
  const [optLabel, setOptLabel] = useState('')
  const [optColor, setOptColor] = useState(SWATCHES[0])

  if (visible !== wasVisible) {
    setWasVisible(visible)
    if (visible) {
      setName(column?.name ?? '')
      setType(column?.type ?? 'text')
      setOptions(column?.options ?? [])
      setOptLabel('')
      setOptColor(SWATCHES[0])
    }
  }

  const isSelect = type === 'select' || type === 'multi_select'

  const addOption = () => {
    const l = optLabel.trim()
    if (!l) return
    setOptions((prev) => [...prev, { id: optId(), label: l, color: optColor }])
    setOptLabel('')
  }
  const removeOption = (id: string) => setOptions((prev) => prev.filter((o) => o.id !== id))

  const save = () => {
    const n = name.trim()
    if (!n) { Alert.alert('Name required', 'Enter a column name.'); return }
    const opts = isSelect ? options : []
    if (column) updateCrmColumn(column.id, { name: n, type, options: opts })
    else addCrmColumn({ tableId, name: n, type, options: opts, sortOrder })
    onClose()
  }

  const confirmDelete = () => {
    if (!column) return
    Alert.alert(
      'Delete column?',
      `"${column.name}" and its cell data will be removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => { deleteCrmColumn(column.id); onClose() } },
      ],
    )
  }

  return (
    <FormModal
      visible={visible}
      title={column ? 'Edit column' : 'New column'}
      onClose={onClose}
      onSubmit={save}
      submitLabel={column ? 'Save changes' : 'Add column'}
      footerLeft={column ? (
        <Pressable onPress={confirmDelete} hitSlop={8} style={{ padding: 10 }}>
          <Feather name="trash-2" size={20} color={p.danger} />
        </Pressable>
      ) : undefined}
    >
      <Field label="Name *">
        <Input value={name} onChangeText={setName} placeholder="Column name" autoFocus={!column} />
      </Field>
      <Field label="Type">
        <PillGroup options={TYPE_OPTIONS} value={type} onChange={setType} />
      </Field>
      {isSelect ? (
        <Field label="Options">
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Input value={optLabel} onChangeText={setOptLabel} placeholder="Add an option" style={{ flex: 1 }} onSubmitEditing={addOption} />
              <Pressable onPress={addOption} style={{ width: 44, borderRadius: radius.md, backgroundColor: p.brand, alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="plus" size={20} color="#ffffff" />
              </Pressable>
            </View>
            <ColorPicker value={optColor} onChange={setOptColor} colors={SWATCHES} />
            <View style={{ gap: 6 }}>
              {options.map((o) => (
                <View key={o.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: p.card, borderWidth: 1, borderColor: p.border, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 8 }}>
                  <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: o.color ?? p.iconMuted }} />
                  <Text style={{ flex: 1, color: p.textHigh, fontSize: 14, fontFamily: fonts.sans }}>{o.label}</Text>
                  <Pressable onPress={() => removeOption(o.id)} hitSlop={8}>
                    <Feather name="x" size={16} color={p.iconMuted} />
                  </Pressable>
                </View>
              ))}
            </View>
          </View>
        </Field>
      ) : null}
    </FormModal>
  )
}
