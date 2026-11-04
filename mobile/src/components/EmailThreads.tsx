import { useMemo, useState } from 'react'
import { Feather } from '@expo/vector-icons'
import { Alert, Pressable, Text, View } from 'react-native'

import EmailComposer, { type ComposeDefaults } from '@/components/EmailComposer'
import { Button, Card, Chip } from '@/components/ui'
import { emailTime, replySubject, snippet, threadsOf } from '@/lib/email'
import { fmtDateTime, fmtRelative } from '@/lib/format'
import { accentChip, fonts, neutralChip, useTheme } from '@/lib/theme'
import type { Email } from '@/lib/types'
import { useStore } from '@/store/useStore'

function Message({ email }: { email: Email }) {
  const p = useTheme()
  const users = useStore((s) => s.users)
  const retryEmail = useStore((s) => s.retryEmail)
  const [open, setOpen] = useState(false)
  const inbound = email.direction === 'in'
  const sender = inbound
    ? email.fromName || email.fromEmail || 'Them'
    : users.find((u) => u.id === email.createdBy)?.fullName ?? email.fromName ?? 'Us'
  const status =
    email.status === 'queued' ? { label: 'Queued', colors: neutralChip(p) }
    : email.status === 'sending' ? { label: 'Sending…', colors: accentChip('sky') }
    : email.status === 'failed' ? { label: 'Failed', colors: accentChip('rose') }
    : null

  return (
    <Pressable
      onPress={() => setOpen((v) => !v)}
      style={{ borderWidth: 1, borderColor: p.border, borderRadius: 10, padding: 10, gap: 4 }}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Feather name={inbound ? 'arrow-down-left' : 'arrow-up-right'} size={13} color={inbound ? p.brandText : p.iconMuted} />
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, fontFamily: fonts.sansSemibold, color: p.textHigh }}>{sender}</Text>
        {status && !inbound ? <Chip label={status.label} colors={status.colors} /> : null}
        <Text style={{ fontSize: 11, fontFamily: fonts.mono, color: p.textMuted }}>{fmtRelative(emailTime(email))}</Text>
      </View>
      {open ? (
        <>
          <Text style={{ fontSize: 11, fontFamily: fonts.sans, color: p.textMuted }}>
            {inbound ? `From ${email.fromEmail ?? ''}` : `To ${email.toEmails.join(', ')}`} · {fmtDateTime(emailTime(email))}
          </Text>
          <Text selectable style={{ fontSize: 14, fontFamily: fonts.sans, color: p.text, lineHeight: 20 }}>{email.bodyText}</Text>
        </>
      ) : (
        <Text numberOfLines={2} style={{ fontSize: 13, fontFamily: fonts.sans, color: p.textMuted }}>{snippet(email.bodyText)}</Text>
      )}
      {email.status === 'failed' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <Text numberOfLines={2} style={{ flex: 1, fontSize: 12, fontFamily: fonts.sans, color: p.danger }}>{email.error ?? 'Gmail refused it'}</Text>
          <Button
            title="Send again"
            variant="ghost"
            onPress={async () => {
              const res = await retryEmail(email.id)
              if (!res.ok) Alert.alert('Not sent', res.error ?? 'Could not send it again')
            }}
          />
        </View>
      ) : null}
    </Pressable>
  )
}

/**
 * The email conversations on a lead, client or project: newest thread first,
 * messages expand on tap, Reply keeps the Gmail thread. Status follows n8n's
 * send over realtime; replies arrive from the inbox check.
 */
export default function EmailThreads({
  emails, leadId, clientId, projectId, person, canSend,
}: {
  emails: Email[]
  leadId?: string
  clientId?: string
  projectId?: string
  person?: { name?: string; email?: string }
  canSend: boolean
}) {
  const p = useTheme()
  const threads = useMemo(() => threadsOf(emails), [emails])
  const [compose, setCompose] = useState<ComposeDefaults | null>(null)
  const [showAll, setShowAll] = useState(false)
  const shown = showAll ? threads : threads.slice(0, 3)

  return (
    <View style={{ gap: 10 }}>
      {threads.length === 0 ? (
        <Card><Text style={{ fontSize: 13, fontFamily: fonts.sans, color: p.textMuted }}>No emails yet.</Text></Card>
      ) : (
        shown.map((t) => (
          <Card key={t.key} style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, fontFamily: fonts.sansSemibold, color: p.textHigh }}>{t.subject}</Text>
              {canSend ? (
                <Pressable
                  hitSlop={10}
                  onPress={() => {
                    const lastIn = [...t.messages].reverse().find((m) => m.direction === 'in')
                    const to = lastIn?.fromEmail ? [lastIn.fromEmail] : t.last.toEmails
                    setCompose({ to, subject: replySubject(t.subject), inReplyTo: (lastIn ?? t.last).id })
                  }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Reply to ${t.subject}`}
                >
                  <Feather name="corner-up-left" size={14} color={p.brandText} />
                  <Text style={{ fontSize: 13, fontFamily: fonts.sansMedium, color: p.brandText }}>Reply</Text>
                </Pressable>
              ) : null}
            </View>
            {t.messages.map((m) => <Message key={m.id} email={m} />)}
          </Card>
        ))
      )}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {canSend ? (
          <Button title="Write email" icon="edit-3" variant="ghost" onPress={() => setCompose({ to: person?.email ? [person.email] : [] })} />
        ) : null}
        {threads.length > 3 ? (
          <Button title={showAll ? 'Show fewer' : `All ${threads.length}`} variant="ghost" onPress={() => setShowAll((v) => !v)} />
        ) : null}
      </View>
      {compose ? (
        <EmailComposer
          visible
          leadId={leadId}
          clientId={clientId}
          projectId={projectId}
          person={person}
          defaults={compose}
          title={compose.inReplyTo ? 'Reply' : 'New email'}
          onClose={() => setCompose(null)}
        />
      ) : null}
    </View>
  )
}
