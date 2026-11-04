import { useState } from 'react'
import { Feather } from '@expo/vector-icons'
import * as Clipboard from 'expo-clipboard'
import { Alert, Pressable, ScrollView, Text, View } from 'react-native'

import { Button, Card, FilterChip, Screen, SectionTitle } from '@/components/ui'
import { buildEodReport } from '@/lib/eod'
import { isoDate } from '@/lib/format'
import { fonts, radius, space, useTheme } from '@/lib/theme'
import { useStore } from '@/store/useStore'

export default function Eod() {
  const p = useTheme()
  const clients = useStore((s) => s.clients)
  const tasks = useStore((s) => s.tasks)
  const activity = useStore((s) => s.taskActivity)
  const events = useStore((s) => s.events)
  const timeEntries = useStore((s) => s.timeEntries)
  const users = useStore((s) => s.users)

  const [clientId, setClientId] = useState<string | null>(clients[0]?.id ?? null)
  const date = isoDate()

  const client = clients.find((c) => c.id === clientId) ?? null
  const report = client
    ? buildEodReport({
        client,
        date,
        tasks: tasks.filter((t) => t.clientId === client.id),
        activity: activity.filter((a) => a.clientId === client.id),
        events: events.filter((e) => e.clientId === client.id),
        timeEntries: timeEntries.filter((e) => e.clientId === client.id),
        users,
      })
    : ''

  async function copy() {
    await Clipboard.setStringAsync(report)
    Alert.alert('Copied', 'Report copied to clipboard.')
  }

  return (
    <Screen scroll>
      <SectionTitle>Client</SectionTitle>
      {/* Client names are long — the old hand-rolled pill sized by paddingVertical and
          sheared descenders off the bottom. FilterChip sizes by minHeight. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: space.sm, paddingBottom: space.xs }}
        style={{ marginBottom: space.xl }}
      >
        {clients.map((c) => (
          <FilterChip
            key={c.id}
            label={c.name}
            active={clientId === c.id}
            onPress={() => setClientId(c.id)}
          />
        ))}
      </ScrollView>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <SectionTitle style={{ marginBottom: 0 }}>Report · {date}</SectionTitle>
        <Button title="Copy" icon="copy" variant="ghost" onPress={copy} style={{ paddingHorizontal: 12, minHeight: 36 }} />
      </View>

      <Card>
        {report ? (
          <Text style={{ fontFamily: fonts.mono, fontSize: 12, color: p.text, lineHeight: 18 }}>{report}</Text>
        ) : (
          <View style={{ alignItems: 'center', paddingVertical: 24, gap: 8 }}>
            <Feather name="file-text" size={22} color={p.iconMuted} />
            <Text style={{ color: p.textMuted, fontSize: 13, fontFamily: fonts.sans }}>Pick a client to generate a report.</Text>
          </View>
        )}
      </Card>
    </Screen>
  )
}
