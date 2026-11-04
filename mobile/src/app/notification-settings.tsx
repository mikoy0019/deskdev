import { useCallback, useEffect, useState } from 'react'
import { Alert, AppState, Linking, Switch, Text, View } from 'react-native'

import { Button, Card, Screen, SectionTitle } from '@/components/ui'
import { useSession } from '@/context/session-context'
import { NOTIFY_CATEGORIES } from '@/lib/notifications'
import { can } from '@/lib/permissions'
import {
  disablePush,
  enablePush,
  getPushState,
  loadPushCategories,
  pushUnavailableReason,
  savePushCategories,
  sendTestPush,
  type PushCategories,
  type PushState,
} from '@/lib/push'
import { fonts, useTheme } from '@/lib/theme'

/**
 * Push for this phone: on/off, a test push, and which kinds to send here —
 * the phone's version of the web app's Settings → Notifications. The switches
 * belong to this device, like the web's (a work laptop and a personal phone
 * want different things).
 */
export default function NotificationSettings() {
  const p = useTheme()
  const { user } = useSession()
  const [state, setState] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)
  const [categories, setCategories] = useState<PushCategories | null>(null)
  const unavailable = pushUnavailableReason()

  const refresh = useCallback(() => {
    void getPushState().then(setState)
  }, [])

  useEffect(() => {
    refresh()
    void loadPushCategories().then(setCategories)
    // Permission is often changed in the phone's Settings; pick it up on return.
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') refresh()
    })
    return () => sub.remove()
  }, [refresh])

  const turnOn = async () => {
    setBusy(true)
    try {
      const next = await enablePush()
      setState(next)
      if (next === 'denied') Alert.alert('Notifications are blocked', 'Allow notifications for DeskDev in your phone’s Settings.')
    } catch (error) {
      Alert.alert('Push is not on', error instanceof Error ? error.message : 'Could not turn on push')
    } finally {
      setBusy(false)
    }
  }

  const turnOff = async () => {
    setBusy(true)
    await disablePush()
    setState(await getPushState())
    setBusy(false)
  }

  const test = async () => {
    setBusy(true)
    const result = await sendTestPush()
    setBusy(false)
    if (result.sent > 0) Alert.alert('Sent', `A test notification went to ${result.sent === 1 ? 'your device' : `${result.sent} of your devices`}.`)
    else Alert.alert('Nothing sent', result.error ?? 'No device took it.')
  }

  const toggle = (key: keyof PushCategories, value: boolean) => {
    if (!categories) return
    const next = { ...categories, [key]: value }
    setCategories(next)
    void savePushCategories(next)
  }

  const shown = NOTIFY_CATEGORIES.filter((c) => !c.feature || can(user, c.feature, 'view'))

  return (
    <Screen scroll>
      <Card style={{ gap: 12, marginBottom: 20 }}>
        <Text style={{ fontSize: 15, fontFamily: fonts.sansSemibold, color: p.textHigh }}>
          {state === 'on' ? 'On for this phone' : state === 'denied' ? 'Blocked on this phone' : state === 'unavailable' ? 'Not available here' : 'Off'}
        </Text>
        <Text style={{ fontSize: 13, fontFamily: fonts.sans, color: p.textMuted, lineHeight: 19 }}>
          {unavailable
            ?? (state === 'on'
              ? 'Messages, mentions, tasks and the rest you pick below arrive here even when DeskDev is closed.'
              : state === 'denied'
                ? 'Notifications for DeskDev are switched off in your phone’s Settings. Allow them there, then come back.'
                : 'Get a notification for new messages, mentions, tasks and leads, even when DeskDev is closed.')}
        </Text>
        {state === null ? null : state === 'on' ? (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title="Send test" icon="send" style={{ flex: 1 }} loading={busy} onPress={() => void test()} />
            <Button title="Turn off" variant="ghost" style={{ flex: 1 }} disabled={busy} onPress={() => void turnOff()} />
          </View>
        ) : state === 'denied' ? (
          <Button title="Open Settings" icon="settings" variant="ghost" onPress={() => void Linking.openSettings()} />
        ) : state === 'off' ? (
          <Button title="Turn on push" icon="bell" loading={busy} onPress={() => void turnOn()} />
        ) : null}
      </Card>

      <SectionTitle>Send me</SectionTitle>
      <Card style={{ padding: 0, marginBottom: 20 }}>
        {categories
          ? shown.map((c, i) => (
              <View
                key={c.key}
                style={[
                  { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
                  i < shown.length - 1 && { borderBottomWidth: 1, borderBottomColor: p.border },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontFamily: fonts.sansMedium, color: p.textHigh }}>{c.label}</Text>
                  <Text style={{ fontSize: 12, fontFamily: fonts.sans, color: p.textMuted, marginTop: 2, lineHeight: 17 }}>{c.hint}</Text>
                </View>
                <Switch
                  value={categories[c.key]}
                  onValueChange={(v) => toggle(c.key, v)}
                  trackColor={{ true: p.brand, false: p.borderStrong }}
                  accessibilityLabel={c.label}
                />
              </View>
            ))
          : null}
      </Card>
      <Text style={{ fontSize: 12, fontFamily: fonts.sans, color: p.textMuted, lineHeight: 17 }}>
        These switches are for this phone only. The web app has its own in Settings → Notifications.
      </Text>
    </Screen>
  )
}
