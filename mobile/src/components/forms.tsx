import { useState, type ReactNode } from 'react'
import { Feather } from '@expo/vector-icons'
import {
  KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Calendar } from 'react-native-calendars'

import { Button, FilterChip, Label, type FeatherIconName } from '@/components/ui'
import { fmtDate } from '@/lib/format'
import { centeredColumn, SHEET_MAX_WIDTH, useResponsive } from '@/lib/responsive'
import { CLIENT_COLORS, fonts, radius, space, useTheme } from '@/lib/theme'

// ─── FormModal ─────────────────────────────────────────────────────────────────

/** Full-screen create/edit modal scaffold: header + scrollable body + footer. */
export function FormModal({
  visible, title, onClose, onSubmit, submitLabel = 'Save', submitDisabled, footerLeft, children,
}: {
  visible: boolean
  title: string
  onClose: () => void
  onSubmit: () => void
  submitLabel?: string
  submitDisabled?: boolean
  /** Optional element pinned to the left of the footer (e.g. a delete button). */
  footerLeft?: ReactNode
  children: ReactNode
}) {
  const p = useTheme()
  const { isTablet } = useResponsive()
  return (
    // iPad: a centred form sheet instead of a page that fills the screen.
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={isTablet && Platform.OS === 'ios' ? 'formSheet' : undefined}
      onRequestClose={onClose}
    >
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: p.page }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          // Elsewhere (Android tablets, the web build) the form is a centred column.
          style={[{ flex: 1 }, isTablet ? centeredColumn(SHEET_MAX_WIDTH) : null]}
        >
          <View
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              paddingHorizontal: 16, paddingVertical: 12,
              borderBottomWidth: 1, borderBottomColor: p.border,
            }}
          >
            <Text style={{ fontSize: 17, fontFamily: fonts.display, color: p.textHigh }}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Feather name="x" size={22} color={p.iconMuted} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={{ padding: 16, gap: 16 }}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>

          <View
            style={{
              flexDirection: 'row', gap: 10, padding: 16,
              borderTopWidth: 1, borderTopColor: p.border, alignItems: 'center',
            }}
          >
            {footerLeft}
            <Button title="Cancel" variant="ghost" onPress={onClose} style={{ flex: 1 }} />
            <Button title={submitLabel} onPress={onSubmit} disabled={submitDisabled} style={{ flex: 1 }} />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  )
}

// ─── Field ─────────────────────────────────────────────────────────────────────

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View>
      <Label>{label}</Label>
      {children}
    </View>
  )
}

// ─── PillGroup (single-select enum pills) ──────────────────────────────────────

export interface PillOption<T extends string> {
  label: string
  value: T
  /** Optional colored dot before the label. */
  dot?: string
}

/**
 * Single-select pill row for forms. A thin wrapper over FilterChip — it used to be a
 * fourth hand-rolled copy of the same pill, sized by paddingVertical (so it sheared long
 * labels) and with no pressed state.
 */
export function PillGroup<T extends string>({
  options, value, onChange,
}: {
  options: PillOption<T>[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      {options.map((o) => (
        <FilterChip
          key={o.value}
          label={o.label}
          dot={o.dot}
          active={o.value === value}
          onPress={() => onChange(o.value)}
        />
      ))}
    </View>
  )
}

// ─── SelectField (pressable → bottom-sheet option list) ─────────────────────────

export interface SelectOption {
  label: string
  value: string
  /** Optional colored dot. */
  dot?: string
  /** Optional secondary text on the right. */
  hint?: string
}

export function SelectField({
  value, options, onChange, placeholder = 'Select…', allowNone, noneLabel = 'None', disabled, disabledHint,
}: {
  value?: string
  options: SelectOption[]
  onChange: (value: string | undefined) => void
  placeholder?: string
  allowNone?: boolean
  noneLabel?: string
  disabled?: boolean
  /** Shown in the field when disabled (e.g. "Pick a client first"). */
  disabledHint?: string
}) {
  const p = useTheme()
  const [open, setOpen] = useState(false)
  const sheetMaxWidth = useResponsive().isTablet ? SHEET_MAX_WIDTH : undefined
  const selected = options.find((o) => o.value === value)
  const text = disabled ? (disabledHint ?? placeholder) : (selected?.label ?? placeholder)
  return (
    <>
      <Pressable
        onPress={() => !disabled && setOpen(true)}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 8,
          backgroundColor: p.hover, borderColor: p.borderStrong, borderWidth: 1,
          borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 11,
          opacity: disabled ? 0.6 : 1,
        }}
      >
        {selected?.dot ? (
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: selected.dot }} />
        ) : null}
        <Text style={{ flex: 1, fontSize: 14, fontFamily: fonts.sans, color: selected && !disabled ? p.textHigh : p.textMuted }}>
          {text}
        </Text>
        <Feather name="chevron-down" size={16} color={p.iconMuted} />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: p.overlay }} onPress={() => setOpen(false)}>
          <SafeAreaView edges={['bottom']}>
            <Pressable
              style={[
                {
                  marginHorizontal: 10, marginBottom: 6, maxHeight: 420, borderRadius: 16, borderWidth: 1,
                  backgroundColor: p.card, borderColor: p.border, overflow: 'hidden',
                },
                // A tablet's full width would put the options a long way from the thumb.
                centeredColumn(sheetMaxWidth),
              ]}
              onPress={() => {}}
            >
              <ScrollView keyboardShouldPersistTaps="handled">
                {allowNone ? (
                  <OptionRow label={noneLabel} selected={!value} onPress={() => { onChange(undefined); setOpen(false) }} />
                ) : null}
                {options.length === 0 && !allowNone ? (
                  <View style={{ padding: 18 }}>
                    <Text style={{ color: p.textMuted, fontSize: 13, fontFamily: fonts.sans, textAlign: 'center' }}>No options yet.</Text>
                  </View>
                ) : null}
                {options.map((o, i) => (
                  <OptionRow
                    key={o.value}
                    label={o.label}
                    dot={o.dot}
                    hint={o.hint}
                    selected={o.value === value}
                    topBorder={i > 0 || allowNone}
                    onPress={() => { onChange(o.value); setOpen(false) }}
                  />
                ))}
              </ScrollView>
            </Pressable>
          </SafeAreaView>
        </Pressable>
      </Modal>
    </>
  )
}

function OptionRow({
  label, dot, hint, selected, topBorder, onPress,
}: {
  label: string
  dot?: string
  hint?: string
  selected: boolean
  topBorder?: boolean
  onPress: () => void
}) {
  const p = useTheme()
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          flexDirection: 'row', alignItems: 'center', gap: 10,
          paddingVertical: 14, paddingHorizontal: 16,
        },
        topBorder ? { borderTopWidth: 1, borderTopColor: p.border } : null,
        pressed ? { backgroundColor: p.hover } : null,
      ]}
    >
      {dot ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: dot }} /> : null}
      <Text style={{ flex: 1, fontSize: 15, fontFamily: fonts.sans, color: p.text }}>{label}</Text>
      {hint ? <Text style={{ fontSize: 12, fontFamily: fonts.sans, color: p.textMuted }}>{hint}</Text> : null}
      {selected ? <Feather name="check" size={18} color={p.brandText} /> : null}
    </Pressable>
  )
}

// ─── ColorPicker (swatches) ─────────────────────────────────────────────────────

export function ColorPicker({
  value, onChange, colors = CLIENT_COLORS,
}: {
  value?: string
  onChange: (color: string) => void
  colors?: string[]
}) {
  const p = useTheme()
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
      {colors.map((c) => (
        <Pressable
          key={c}
          onPress={() => onChange(c)}
          style={{
            width: 34, height: 34, borderRadius: 17, backgroundColor: c,
            borderWidth: 3, borderColor: value === c ? p.textHigh : 'transparent',
          }}
        />
      ))}
    </View>
  )
}

// ─── DateField (pressable → calendar sheet) ─────────────────────────────────────

export function DateField({
  value, onChange, placeholder = 'Pick a date', icon = 'calendar',
}: {
  /** YYYY-MM-DD or undefined. */
  value?: string
  onChange: (date: string | undefined) => void
  placeholder?: string
  icon?: FeatherIconName
}) {
  const p = useTheme()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 8,
          backgroundColor: p.hover, borderColor: p.borderStrong, borderWidth: 1,
          borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 11,
        }}
      >
        <Feather name={icon} size={15} color={p.iconMuted} />
        <Text style={{ flex: 1, fontSize: 14, fontFamily: fonts.sans, color: value ? p.textHigh : p.textMuted }}>
          {value ? fmtDate(value) : placeholder}
        </Text>
        {value ? (
          <Pressable onPress={() => onChange(undefined)} hitSlop={10}>
            <Feather name="x" size={16} color={p.iconMuted} />
          </Pressable>
        ) : null}
      </Pressable>

      <Modal visible={open} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, justifyContent: 'center', padding: 20, backgroundColor: p.overlay }} onPress={() => setOpen(false)}>
          {/* A month grid reads best around phone width, whatever the screen. */}
          <Pressable onPress={() => {}} style={centeredColumn(420)}>
            <Calendar
              current={value || undefined}
              onDayPress={(d) => { onChange(d.dateString); setOpen(false) }}
              markedDates={value ? { [value]: { selected: true, selectedColor: p.brand } } : {}}
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
          </Pressable>
        </Pressable>
      </Modal>
    </>
  )
}
