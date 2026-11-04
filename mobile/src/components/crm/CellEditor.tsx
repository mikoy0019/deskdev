import { useState } from 'react'
import { Feather } from '@expo/vector-icons'
import { Pressable, Switch, Text, View } from 'react-native'
import { Calendar } from 'react-native-calendars'

import { Input } from '@/components/ui'
import { Field, FormModal } from '@/components/forms'
import { fonts, radius, useTheme } from '@/lib/theme'
import type { CrmCellValue, CrmColumn } from '@/lib/types'

/** Edits a single CRM cell, adapting the control to the column type. */
export function CellEditor({
  visible, column, value, onClose, onSubmit,
}: {
  visible: boolean
  column: CrmColumn | null
  value: CrmCellValue
  onClose: () => void
  onSubmit: (v: CrmCellValue) => void
}) {
  const p = useTheme()
  const [wasVisible, setWasVisible] = useState(false)
  const [text, setText] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [bool, setBool] = useState(false)
  const [date, setDate] = useState<string | undefined>(undefined)

  if (visible !== wasVisible) {
    setWasVisible(visible)
    if (visible && column) {
      if (column.type === 'multi_select') setSelected(Array.isArray(value) ? (value as string[]) : [])
      else if (column.type === 'select') setSelected(value != null ? [String(value)] : [])
      else if (column.type === 'checkbox') setBool(value === true)
      else if (column.type === 'date') setDate(value ? String(value) : undefined)
      else setText(value != null ? String(value) : '')
    }
  }

  if (!column) return null

  const submit = (v: CrmCellValue) => { onSubmit(v); onClose() }
  const save = () => {
    switch (column.type) {
      case 'number': {
        const n = text.trim() === '' ? null : Number(text)
        submit(n != null && !Number.isNaN(n) ? n : null)
        break
      }
      case 'checkbox': submit(bool); break
      case 'date': submit(date ?? null); break
      case 'multi_select': submit(selected.length ? selected : null); break
      case 'select': submit(selected[0] ?? null); break
      default: submit(text.trim() === '' ? null : text.trim())
    }
  }

  const toggleOption = (id: string) => {
    if (column.type === 'select') setSelected([id])
    else setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const isText = column.type === 'text' || column.type === 'url'

  return (
    <FormModal visible={visible} title={column.name} onClose={onClose} onSubmit={save} submitLabel="Save">
      {isText ? (
        <Field label={column.type === 'url' ? 'URL' : 'Text'}>
          <Input
            value={text}
            onChangeText={setText}
            autoFocus
            multiline={column.type === 'text'}
            autoCapitalize={column.type === 'url' ? 'none' : 'sentences'}
            keyboardType={column.type === 'url' ? 'url' : 'default'}
            style={column.type === 'text' ? { minHeight: 90, textAlignVertical: 'top' } : undefined}
          />
        </Field>
      ) : null}

      {column.type === 'number' ? (
        <Field label="Number">
          <Input value={text} onChangeText={setText} autoFocus keyboardType="numeric" />
        </Field>
      ) : null}

      {column.type === 'checkbox' ? (
        <Field label="Checked">
          <Switch value={bool} onValueChange={setBool} trackColor={{ true: p.brand, false: p.borderStrong }} />
        </Field>
      ) : null}

      {column.type === 'date' ? (
        <Calendar
          current={date || undefined}
          onDayPress={(d) => setDate(d.dateString)}
          markedDates={date ? { [date]: { selected: true, selectedColor: p.brand } } : {}}
          theme={{
            calendarBackground: p.card,
            dayTextColor: p.text,
            monthTextColor: p.textHigh,
            textDisabledColor: p.iconMuted,
            todayTextColor: p.brandText,
            arrowColor: p.brandText,
            textSectionTitleColor: p.textMuted,
            selectedDayTextColor: '#ffffff',
          }}
          style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: p.border, overflow: 'hidden' }}
        />
      ) : null}

      {column.type === 'select' || column.type === 'multi_select' ? (
        <View style={{ gap: 6 }}>
          {column.options.length === 0 ? (
            <Text style={{ color: p.textMuted, fontSize: 13, fontFamily: fonts.sans }}>No options yet — edit the column to add some.</Text>
          ) : null}
          {column.options.map((o) => {
            const on = selected.includes(o.id)
            return (
              <Pressable
                key={o.id}
                onPress={() => toggleOption(o.id)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: on ? p.brand : p.border, backgroundColor: p.card }}
              >
                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: o.color ?? p.iconMuted }} />
                <Text style={{ flex: 1, color: p.textHigh, fontFamily: fonts.sans }}>{o.label}</Text>
                {on ? <Feather name="check" size={18} color={p.brandText} /> : null}
              </Pressable>
            )
          })}
        </View>
      ) : null}
    </FormModal>
  )
}
