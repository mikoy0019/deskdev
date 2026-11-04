import { useState } from 'react'
import { Alert, Text, View } from 'react-native'

import { FormModal } from '@/components/forms'
import { Button, Input, Label } from '@/components/ui'
import { bookingPageUrl } from '@/lib/booking'
import { draftError, parseAddresses } from '@/lib/email'
import { isSupabaseConfigured } from '@/lib/supabase'
import { fonts, useTheme } from '@/lib/theme'
import { useStore } from '@/store/useStore'

export interface ComposeDefaults {
  to?: string[]
  cc?: string[]
  subject?: string
  body?: string
  inReplyTo?: string
}

/**
 * Write an email about a lead, client or project. Send queues it in the shared
 * store; n8n sends it from the studio's Gmail with the signature added, and
 * the thread shows it go from Sending to Sent.
 */
export default function EmailComposer({
  visible, leadId, clientId, projectId, person, defaults, title = 'New email', onSent, onClose,
}: {
  visible: boolean
  leadId?: string
  clientId?: string
  projectId?: string
  person?: { name?: string; email?: string }
  defaults?: ComposeDefaults
  title?: string
  onSent?: (id: string) => void
  onClose: () => void
}) {
  const p = useTheme()
  const sendEmail = useStore((s) => s.sendEmail)
  const fromName = useStore((s) => s.workspaceSettings.emailFromName)
  const [to, setTo] = useState((defaults?.to ?? []).join(', '))
  const [cc, setCc] = useState((defaults?.cc ?? []).join(', '))
  const [subject, setSubject] = useState(defaults?.subject ?? '')
  const [body, setBody] = useState(defaults?.body ?? '')

  const send = () => {
    const draft = { to: parseAddresses(to), cc: parseAddresses(cc), subject, body }
    const problem = draftError(draft)
    if (problem) {
      Alert.alert('Not sent', problem)
      return
    }
    const result = sendEmail({ ...draft, leadId, clientId, projectId, inReplyTo: defaults?.inReplyTo })
    if (!result.ok || !result.id) {
      Alert.alert('Not sent', result.error ?? 'Could not queue the email')
      return
    }
    if (!isSupabaseConfigured) Alert.alert('Queued', 'Sending needs the live workspace.')
    onSent?.(result.id)
    onClose()
  }

  return (
    <FormModal visible={visible} title={title} onClose={onClose} onSubmit={send} submitLabel="Send">
      <View>
        <Label>To</Label>
        <Input value={to} onChangeText={setTo} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} placeholder="name@company.com" />
      </View>
      <View>
        <Label>Cc</Label>
        <Input value={cc} onChangeText={setCc} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
      </View>
      <View>
        <Label>Subject</Label>
        <Input value={subject} onChangeText={setSubject} maxLength={300} />
      </View>
      <View>
        <Label>Message</Label>
        <Input value={body} onChangeText={setBody} multiline style={{ minHeight: 200, textAlignVertical: 'top' }} />
      </View>
      <Button
        title="Insert booking link"
        icon="calendar"
        variant="ghost"
        onPress={() => {
          const url = bookingPageUrl({ name: person?.name, email: person?.email })
          setBody((b) => `${b}${b && !b.endsWith('\n') ? '\n\n' : ''}Pick a time for a call here: ${url}\n`)
        }}
      />
      <Text style={{ fontSize: 12, fontFamily: fonts.sans, color: p.textMuted }}>From {fromName} · your signature is added when it sends.</Text>
    </FormModal>
  )
}
