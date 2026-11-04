import { useState } from 'react'
import * as Clipboard from 'expo-clipboard'
import { Alert, Modal, Pressable, Share, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import EmailComposer from '@/components/EmailComposer'
import { Button, Input, Label } from '@/components/ui'
import { centeredColumn, SHEET_MAX_WIDTH, useResponsive } from '@/lib/responsive'
import { fonts, radius, useTheme } from '@/lib/theme'

/**
 * A link a customer opens (a quick form, the booking page): copy it, hand it
 * to the phone's share sheet (WhatsApp, Viber, SMS…), or send it from DeskDev
 * through the studio's Gmail. `create` runs once, on "Create link" — a quick
 * form's link is minted then and shown only here.
 */
export default function ShareLinkSheet({
  visible, title, intro, create, email, leadId, projectId, person, onShared, onClose,
}: {
  visible: boolean
  title: string
  intro: string
  /** Returns the URL, or throws/returns an error message. */
  create: () => Promise<{ url?: string; error?: string }>
  /** The email that carries the link, built from the URL. */
  email: (url: string) => { subject: string; body: string }
  leadId?: string
  projectId?: string
  person?: { name?: string; email?: string }
  /** Copied, shared or emailed (e.g. log the booking-link touch). */
  onShared?: () => void
  onClose: () => void
}) {
  const p = useTheme()
  const { isTablet } = useResponsive()
  const [url, setUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [composing, setComposing] = useState(false)

  const make = async () => {
    setBusy(true)
    const res = await create()
    setBusy(false)
    if (!res.url) {
      Alert.alert('No link', res.error ?? 'Could not create the link')
      return
    }
    setUrl(res.url)
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView edges={['top', 'bottom']} style={[{ flex: 1, backgroundColor: p.page }, isTablet ? centeredColumn(SHEET_MAX_WIDTH) : null]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: p.border }}>
          <Text style={{ fontSize: 17, fontFamily: fonts.display, color: p.textHigh }}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            <Text style={{ fontSize: 15, fontFamily: fonts.sansMedium, color: p.brandText }}>Done</Text>
          </Pressable>
        </View>
        <View style={{ padding: 16, gap: 14 }}>
          <Text style={{ fontSize: 14, fontFamily: fonts.sans, color: p.text, lineHeight: 20 }}>{intro}</Text>
          {url ? (
            <>
              <View>
                <Label>Link</Label>
                <Input value={url} editable={false} selectTextOnFocus style={{ fontFamily: fonts.mono, fontSize: 12 }} />
              </View>
              <Button title="Send from DeskDev" icon="send" onPress={() => setComposing(true)} />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Button
                  title="Copy"
                  icon="copy"
                  variant="ghost"
                  style={{ flex: 1 }}
                  onPress={async () => {
                    await Clipboard.setStringAsync(url)
                    onShared?.()
                    Alert.alert('Copied', 'The link is on your clipboard.')
                  }}
                />
                <Button
                  title="Share…"
                  icon="share"
                  variant="ghost"
                  style={{ flex: 1 }}
                  onPress={async () => {
                    const { subject, body } = email(url)
                    const result = await Share.share({ message: body, title: subject }).catch(() => null)
                    if (result && result.action === Share.sharedAction) onShared?.()
                  }}
                />
              </View>
            </>
          ) : (
            <Button title="Create link" icon="link" loading={busy} onPress={() => void make()} />
          )}
        </View>
        <View style={{ flex: 1 }} />
        <Text style={{ fontSize: 12, fontFamily: fonts.sans, color: p.textMuted, padding: 16, borderRadius: radius.md }}>
          The link is shown only here. Lose it, and create a new one.
        </Text>
      </SafeAreaView>
      {composing && url ? (
        <EmailComposer
          visible
          leadId={leadId}
          projectId={projectId}
          person={person}
          defaults={{ to: person?.email ? [person.email] : [], ...email(url) }}
          title="Send the link"
          onSent={() => onShared?.()}
          onClose={() => setComposing(false)}
        />
      ) : null}
    </Modal>
  )
}
