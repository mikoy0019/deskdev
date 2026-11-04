import { useState } from 'react'
import { Alert } from 'react-native'
import { useShallow } from 'zustand/react/shallow'

import { Input } from '@/components/ui'
import { ColorPicker, Field, FormModal, SelectField, type SelectOption } from '@/components/forms'
import { useStore } from '@/store/useStore'
import { SWATCHES } from '@/lib/theme'
import type { CrmTable } from '@/lib/types'

export function TableForm({
  visible, table, onClose,
}: {
  visible: boolean
  table?: CrmTable
  onClose: () => void
}) {
  const clients = useStore(useShallow((s) => [...s.clients].sort((a, b) => a.name.localeCompare(b.name))))
  const addCrmTable = useStore((s) => s.addCrmTable)
  const updateCrmTable = useStore((s) => s.updateCrmTable)

  const [wasVisible, setWasVisible] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState(SWATCHES[0])
  const [clientId, setClientId] = useState<string | undefined>(undefined)

  if (visible !== wasVisible) {
    setWasVisible(visible)
    if (visible) {
      setName(table?.name ?? '')
      setColor(table?.color ?? SWATCHES[0])
      setClientId(table?.clientId)
    }
  }

  const clientOptions: SelectOption[] = clients.map((c) => ({ label: c.name, value: c.id, dot: c.color }))

  const save = () => {
    const n = name.trim()
    if (!n) { Alert.alert('Name required', 'Enter a table name.'); return }
    if (table) updateCrmTable(table.id, { name: n, color, clientId })
    else addCrmTable({ name: n, color, clientId })
    onClose()
  }

  return (
    <FormModal
      visible={visible}
      title={table ? 'Edit table' : 'New table'}
      onClose={onClose}
      onSubmit={save}
      submitLabel={table ? 'Save changes' : 'Create table'}
    >
      <Field label="Name *">
        <Input value={name} onChangeText={setName} placeholder="e.g. Leads Tracker" autoFocus={!table} />
      </Field>
      <Field label="Client">
        <SelectField value={clientId} options={clientOptions} onChange={setClientId} allowNone noneLabel="No client" placeholder="No client" />
      </Field>
      <Field label="Color">
        <ColorPicker value={color} onChange={setColor} colors={SWATCHES} />
      </Field>
    </FormModal>
  )
}
