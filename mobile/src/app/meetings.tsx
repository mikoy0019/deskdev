import { useMemo, useState } from 'react'
import { Feather } from '@expo/vector-icons'
import { ScrollView, Text, View } from 'react-native'

import { Card, EmptyState, Fab, Screen } from '@/components/ui'
import { EventForm } from '@/components/EventForm'
import { useSession } from '@/context/session-context'
import { can } from '@/lib/permissions'
import { fmtDate, fmtTime, isoDate } from '@/lib/format'
import { fonts, useTheme } from '@/lib/theme'
import { getEventOccurrences, useStore } from '@/store/useStore'
import type { EventItem } from '@/lib/types'

export default function Meetings() {
  const p = useTheme()
  const { user } = useSession()
  const canEdit = can(user, 'meetings', 'edit')
  const clients = useStore((s) => s.clients)
  const events = useStore((s) => s.events)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<EventItem | null>(null)

  const clientName = (id?: string) => clients.find((c) => c.id === id)?.name

  const upcoming = useMemo(() => {
    const start = `${isoDate()}T00:00:00`
    const end = new Date(Date.now() + 14 * 864e5).toISOString()
    return getEventOccurrences(events, start, end).filter((o) => o.event.kind === 'meeting')
  }, [events])

  // Kanban-style day columns (grouped by day).
  const groups = useMemo(() => {
    const map = new Map<string, typeof upcoming>()
    for (const o of upcoming) {
      const day = isoDate(new Date(o.startsAt))
      if (!map.has(day)) map.set(day, [])
      map.get(day)!.push(o)
    }
    return [...map.entries()]
  }, [upcoming])

  const dayLabel = (day: string) => {
    const today = isoDate()
    const tomorrow = isoDate(new Date(Date.now() + 864e5))
    if (day === today) return 'Today'
    if (day === tomorrow) return 'Tomorrow'
    return fmtDate(day)
  }

  const openCreate = () => { setEditing(null); setFormOpen(true) }
  const openEdit = (e: EventItem) => { if (canEdit) { setEditing(e); setFormOpen(true) } }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: canEdit ? 92 : 16 }}>
        {groups.length === 0 ? (
          <EmptyState icon="video" title="No upcoming meetings" hint="Meetings scheduled in the next 14 days show here." />
        ) : (
          groups.map(([day, items]) => (
            <View key={day} style={{ marginBottom: 18 }}>
              <Text style={{ fontSize: 12, fontFamily: fonts.sansSemibold, color: p.textSecondary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{dayLabel(day)}</Text>
              <View style={{ gap: 8 }}>
                {items.map((o) => (
                  <Card key={o.occurrenceId} onPress={() => openEdit(o.event)}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <Text style={{ fontSize: 13, fontFamily: fonts.monoMedium, color: p.brandText, width: 64, fontVariant: ['tabular-nums'] }}>{o.event.allDay ? 'All day' : fmtTime(o.startsAt)}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, fontFamily: fonts.sansSemibold, color: p.textHigh }}>{o.event.title}</Text>
                        <Text style={{ fontSize: 12, fontFamily: fonts.sans, color: p.textMuted }}>{clientName(o.event.clientId) ?? 'No client'}</Text>
                      </View>
                      {o.event.notes ? <Feather name="file-text" size={15} color={p.iconMuted} /> : null}
                      {canEdit ? <Feather name="chevron-right" size={16} color={p.iconMuted} /> : null}
                    </View>
                  </Card>
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {canEdit ? <Fab icon="plus" onPress={openCreate} /> : null}
      <EventForm visible={formOpen} event={editing ?? undefined} defaultKind="meeting" onClose={() => setFormOpen(false)} />
    </Screen>
  )
}
