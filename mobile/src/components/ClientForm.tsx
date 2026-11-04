import { useRef, useState, type ReactNode } from 'react'
import { Feather } from '@expo/vector-icons'
import {
  Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View,
  type TextInput,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useShallow } from 'zustand/react/shallow'

import { Button, FilterChip, Input, Label } from '@/components/ui'
import {
  CLIENT_COLORS, CLIENT_STATUS_LABELS, ENGAGEMENT_LABELS, fonts, radius, useTheme,
} from '@/lib/theme'
import { centeredColumn, SHEET_MAX_WIDTH, useResponsive } from '@/lib/responsive'
import { useStore } from '@/store/useStore'
import type { Client, ClientShowcaseConsent, ClientStatus, Engagement } from '@/lib/types'

const ENGAGEMENTS: Engagement[] = ['full_time', 'part_time', 'gig_on_call']
const STATUSES: ClientStatus[] = ['active', 'paused', 'ended']

/** clients.showcaseConsent (037): copied onto a project's portfolio draft; only 'granted' can publish. */
const CONSENT_OPTIONS: { value: ClientShowcaseConsent; label: string }[] = [
  { value: 'unknown', label: 'Not asked yet' },
  { value: 'granted', label: 'Yes, show their work' },
  { value: 'declined', label: 'No, keep it private' },
]

interface Props {
  visible: boolean
  /** Omit (or pass undefined) to create a new client. */
  client?: Client
  onClose: () => void
}

/** Create / edit a client — the mobile counterpart of the web ClientModal. */
export function ClientForm({ visible, client, onClose }: Props) {
  const p = useTheme()
  const { isTablet } = useResponsive()
  const addClient = useStore((s) => s.addClient)
  const updateClient = useStore((s) => s.updateClient)
  const categories = useStore(
    useShallow((s) => [...s.clientCategories].sort((a, b) => a.sortOrder - b.sortOrder)),
  )

  const [wasVisible, setWasVisible] = useState(false)
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined)
  const [engagement, setEngagement] = useState<Engagement>('full_time')
  const [status, setStatus] = useState<ClientStatus>('active')
  const [timezone, setTimezone] = useState('')
  const [color, setColor] = useState<string>(CLIENT_COLORS[0])
  const [notes, setNotes] = useState('')
  const [showcaseConsent, setShowcaseConsent] = useState<ClientShowcaseConsent>('unknown')

  // Refs for focus-on-open and return-key field advancing (iOS QuickType flow).
  const nameRef = useRef<TextInput>(null)
  const companyRef = useRef<TextInput>(null)
  const emailRef = useRef<TextInput>(null)
  const phoneRef = useRef<TextInput>(null)

  // Seed the form from the target client (or blank) each time the modal opens.
  // Done during render on the closed→open transition — React's "adjust state
  // on prop change" pattern — so there's no reset effect and no extra commit.
  if (visible !== wasVisible) {
    setWasVisible(visible)
    if (visible) {
      setName(client?.name ?? '')
      setCompany(client?.company ?? '')
      setEmail(client?.email ?? '')
      setPhone(client?.phone ?? '')
      setCategoryId(client?.categoryId)
      setEngagement(client?.engagement ?? 'full_time')
      setStatus(client?.status ?? 'active')
      setTimezone(client?.timezone ?? '')
      setColor(client?.color ?? CLIENT_COLORS[0])
      setNotes(client?.notes ?? '')
      setShowcaseConsent(client?.showcaseConsent ?? 'unknown')
    }
  }

  const save = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      Alert.alert('Name required', 'Please enter a client name.')
      return
    }
    const payload = {
      name: trimmed,
      company: company.trim() || undefined,
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      categoryId,
      engagement,
      status,
      timezone: timezone.trim() || undefined,
      color,
      notes: notes.trim() || undefined,
      showcaseConsent,
    }
    if (client) updateClient(client.id, payload)
    else addClient(payload)
    onClose()
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      // iPad: a centred form sheet; Android tablets get a centred column below.
      presentationStyle={isTablet && Platform.OS === 'ios' ? 'formSheet' : undefined}
      onRequestClose={onClose}
      // Focus after the present animation finishes — autoFocus races the slide-in
      // on iOS and the keyboard often fails to raise.
      onShow={() => nameRef.current?.focus()}
    >
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: p.page }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[{ flex: 1 }, isTablet ? centeredColumn(SHEET_MAX_WIDTH) : null]}
        >
          <View
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              paddingHorizontal: 16, paddingVertical: 12,
              borderBottomWidth: 1, borderBottomColor: p.border,
            }}
          >
            <Text style={{ fontSize: 17, fontFamily: fonts.display, color: p.textHigh }}>
              {client ? 'Edit client' : 'New client'}
            </Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Feather name="x" size={22} color={p.iconMuted} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={{ padding: 16, gap: 16 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <Field label="Name *">
              <Input
                ref={nameRef}
                value={name}
                onChangeText={setName}
                placeholder="Client name"
                textContentType="name"
                autoComplete="name"
                returnKeyType="next"
                onSubmitEditing={() => companyRef.current?.focus()}
              />
            </Field>
            <Field label="Company">
              <Input
                ref={companyRef}
                value={company}
                onChangeText={setCompany}
                placeholder="Company"
                textContentType="organizationName"
                autoComplete="organization"
                returnKeyType="next"
                onSubmitEditing={() => emailRef.current?.focus()}
              />
            </Field>
            <Field label="Email">
              <Input
                ref={emailRef}
                value={email}
                onChangeText={setEmail}
                placeholder="name@company.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="emailAddress"
                autoComplete="email"
                returnKeyType="next"
                onSubmitEditing={() => phoneRef.current?.focus()}
              />
            </Field>
            <Field label="Phone">
              <Input
                ref={phoneRef}
                value={phone}
                onChangeText={setPhone}
                placeholder="+1 555 000 0000"
                keyboardType="phone-pad"
                textContentType="telephoneNumber"
                autoComplete="tel"
              />
            </Field>

            {categories.length > 0 ? (
              <Field label="Category">
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <Pill label="None" active={!categoryId} onPress={() => setCategoryId(undefined)} />
                  {categories.map((c) => (
                    <Pill
                      key={c.id}
                      label={c.name}
                      dot={c.color}
                      active={categoryId === c.id}
                      onPress={() => setCategoryId(c.id)}
                    />
                  ))}
                </View>
              </Field>
            ) : null}

            <Field label="Engagement">
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {ENGAGEMENTS.map((e) => (
                  <Pill
                    key={e}
                    label={ENGAGEMENT_LABELS[e]}
                    active={engagement === e}
                    onPress={() => setEngagement(e)}
                  />
                ))}
              </View>
            </Field>

            <Field label="Status">
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {STATUSES.map((s) => (
                  <Pill
                    key={s}
                    label={CLIENT_STATUS_LABELS[s]}
                    active={status === s}
                    onPress={() => setStatus(s)}
                  />
                ))}
              </View>
            </Field>

            <Field label="Timezone">
              <Input
                value={timezone}
                onChangeText={setTimezone}
                placeholder="e.g. America/New_York"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
              />
            </Field>

            <Field label="Color">
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                {CLIENT_COLORS.map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => setColor(c)}
                    hitSlop={8}
                    style={{
                      width: 34, height: 34, borderRadius: 17, backgroundColor: c,
                      borderWidth: 3, borderColor: color === c ? p.textHigh : 'transparent',
                    }}
                  />
                ))}
              </View>
            </Field>

            <Field label="Portfolio consent">
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {CONSENT_OPTIONS.map((o) => (
                  <Pill
                    key={o.value}
                    label={o.label}
                    active={showcaseConsent === o.value}
                    onPress={() => setShowcaseConsent(o.value)}
                  />
                ))}
              </View>
              <Text style={{ fontSize: 12, fontFamily: fonts.sans, color: p.textMuted, marginTop: 6 }}>
                May their finished projects appear on nixgensolutions.com/portfolio? Nothing is published without a yes.
              </Text>
            </Field>

            <Field label="Notes">
              <Input
                value={notes}
                onChangeText={setNotes}
                placeholder="Anything worth remembering about this client…"
                multiline
                style={{ minHeight: 90, textAlignVertical: 'top' }}
              />
            </Field>
          </ScrollView>

          <View
            style={{
              flexDirection: 'row', gap: 10, padding: 16,
              borderTopWidth: 1, borderTopColor: p.border,
            }}
          >
            <Button title="Cancel" variant="ghost" onPress={onClose} style={{ flex: 1 }} />
            <Button
              title={client ? 'Save changes' : 'Add client'}
              onPress={save}
              style={{ flex: 1 }}
            />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  )
}

// ─── Field + Pill helpers ──────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View>
      <Label>{label}</Label>
      {children}
    </View>
  )
}

// The local Pill is gone — it was the last copy of the shared chip, sized by
// paddingVertical (hence the hitSlop patch to claw back a 44pt target) instead of the
// minHeight FilterChip uses. FilterChip now carries the optional `dot`, so it covers
// this case exactly.
const Pill = FilterChip
