import { Text, View } from 'react-native'

import { FilterChip, Input, Label } from '@/components/ui'
import { DateField, SelectField } from '@/components/forms'
import { fieldError, isAnswered, type Answers, type FormField, type FormTemplate } from '@/lib/forms'
import { fonts, space, useTheme } from '@/lib/theme'

// Renders any form template (lib/forms.ts, shared with the web app): sections,
// then each field by type. The values are the caller's — nothing is saved here.

function FieldInput({ field, value, onChange, disabled }: { field: FormField; value: unknown; onChange: (v: unknown) => void; disabled?: boolean }) {
  switch (field.type) {
    case 'textarea':
      return (
        <Input
          multiline
          editable={!disabled}
          value={typeof value === 'string' ? value : ''}
          onChangeText={onChange}
          placeholder={field.placeholder}
          style={{ minHeight: 96, textAlignVertical: 'top' }}
        />
      )
    case 'number':
      return (
        <Input
          editable={!disabled}
          keyboardType="decimal-pad"
          value={typeof value === 'number' ? String(value) : typeof value === 'string' ? value : ''}
          onChangeText={(t) => onChange(t.trim() === '' ? undefined : Number(t.replace(',', '.')))}
          placeholder={field.placeholder ?? '0'}
        />
      )
    case 'date':
      return <DateField value={typeof value === 'string' ? value : undefined} onChange={(d) => !disabled && onChange(d)} />
    case 'select':
      return (
        <SelectField
          value={typeof value === 'string' ? value : undefined}
          options={(field.options ?? []).map((o) => ({ label: o.label, value: o.value }))}
          onChange={(v) => onChange(v)}
          allowNone
          noneLabel="—"
          disabled={disabled}
        />
      )
    case 'multiselect': {
      const picked = Array.isArray(value) ? (value as string[]) : []
      return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {(field.options ?? []).map((o) => (
            <FilterChip
              key={o.value}
              label={o.label}
              active={picked.includes(o.value)}
              onPress={() => {
                if (disabled) return
                onChange(picked.includes(o.value) ? picked.filter((x) => x !== o.value) : [...picked, o.value])
              }}
            />
          ))}
        </View>
      )
    }
    default:
      return (
        <Input
          editable={!disabled}
          value={typeof value === 'string' ? value : ''}
          onChangeText={onChange}
          placeholder={field.placeholder}
          keyboardType={field.type === 'email' ? 'email-address' : field.type === 'tel' ? 'phone-pad' : 'default'}
          autoCapitalize={field.type === 'email' ? 'none' : 'sentences'}
          autoCorrect={field.type !== 'email'}
          textContentType={field.type === 'email' ? 'emailAddress' : field.type === 'tel' ? 'telephoneNumber' : undefined}
        />
      )
  }
}

export default function FormFields({
  template, values, onChange, disabled, showMissing,
}: {
  template: FormTemplate
  values: Answers
  onChange: (key: string, value: unknown) => void
  disabled?: boolean
  /** After a refused submit: flag required fields that are still empty. */
  showMissing?: boolean
}) {
  const p = useTheme()
  return (
    <View style={{ gap: 22 }}>
      {template.sections.map((section) => (
        <View key={section.key} style={{ gap: 14 }}>
          <View>
            <Text style={{ fontSize: 12, fontFamily: fonts.mono, color: p.textMuted, letterSpacing: 1, textTransform: 'uppercase' }}>
              {section.title}
            </Text>
            {section.hint ? <Text style={{ fontSize: 12, fontFamily: fonts.sans, color: p.textMuted, marginTop: 2 }}>{section.hint}</Text> : null}
          </View>
          {section.fields.map((field) => {
            const value = values[field.key]
            const error = fieldError(field, value) ?? (showMissing && field.required && !isAnswered(value) ? 'Required' : null)
            return (
              <View key={field.key}>
                <Label>
                  {field.label}
                  {field.required ? ' *' : ''}
                  {field.internal ? <Text style={{ color: p.textMuted }}> · team only</Text> : null}
                </Label>
                <FieldInput field={field} value={value} onChange={(v) => onChange(field.key, v)} disabled={disabled} />
                {field.hint ? <Text style={{ fontSize: 12, fontFamily: fonts.sans, color: p.textMuted, marginTop: 4 }}>{field.hint}</Text> : null}
                {error ? <Text style={{ fontSize: 12, fontFamily: fonts.sansMedium, color: p.danger, marginTop: 4 }}>{error}</Text> : null}
              </View>
            )
          })}
        </View>
      ))}
    </View>
  )
}
