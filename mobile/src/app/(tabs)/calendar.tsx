import { useMemo, useState } from 'react'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { ScrollView, Text, View } from 'react-native'
import { Calendar } from 'react-native-calendars'

import { Card, EmptyState, Fab, Screen, ScreenHeader, SectionTitle } from '@/components/ui'
import { EventForm } from '@/components/EventForm'
import { useSession } from '@/context/session-context'
import { can } from '@/lib/permissions'
import { fmtDate, fmtTime, isoDate } from '@/lib/format'
import { fonts, layout, radius, space, useTheme } from '@/lib/theme'
import { getEventOccurrences, useStore } from '@/store/useStore'
import type { EventItem } from '@/lib/types'

export default function CalendarScreen() {
  const p = useTheme()
  const router = useRouter()
  const { user } = useSession()
  const canEditEvent = can(user, 'calendar', 'edit')
  const canEditMeeting = can(user, 'meetings', 'edit')

  const clients = useStore((s) => s.clients)
  const events = useStore((s) => s.events)
  const [selected, setSelected] = useState(isoDate())
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<EventItem | null>(null)

  const clientName = (id?: string) => clients.find((c) => c.id === id)?.name
  // Meeting vs event distinction is status-like — sky (info) / emerald (success),
  // never the brand accent (reserved for interaction).
  const kindColor = (kind: EventItem['kind']) => (kind === 'meeting' ? p.info : p.success)

  // Materialize a wide window (this month ± a bit) so dots + agenda share data.
  const [y, m] = selected.split('-').map(Number)
  const rangeEnd = new Date(y, m + 1, 7).toISOString()
  const rangeStart = new Date(y, m - 2, 1).toISOString()

  const occ = useMemo(() => getEventOccurrences(events, rangeStart, rangeEnd), [events, rangeStart, rangeEnd])

  const marked = useMemo(() => {
    const map: Record<string, { marked: boolean; dotColor: string }> = {}
    for (const o of occ) {
      const day = isoDate(new Date(o.startsAt))
      map[day] = { marked: true, dotColor: kindColor(o.event.kind) }
    }
    return {
      ...map,
      [selected]: { ...(map[selected] ?? {}), selected: true, selectedColor: p.brand },
    }
  }, [occ, selected, p.brand, p.info, p.success])

  const dayItems = occ.filter((o) => isoDate(new Date(o.startsAt)) === selected)

  const canEditKind = (e: EventItem) => (e.kind === 'meeting' ? canEditMeeting : canEditEvent)

  const onItemPress = (e: EventItem) => {
    if (canEditKind(e)) { setEditing(e); setFormOpen(true) }
    else if (e.kind === 'meeting') router.push('/meetings')
  }

  const canAdd = canEditEvent || canEditMeeting

  return (
    <Screen wide padded={false} tabScreen header={<ScreenHeader title="Calendar" subtitle={fmtDate(selected)} />}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: space.lg,
          // Clear the floating tab pill, plus the FAB when it's shown.
          paddingBottom: layout.scrollClearance + (canAdd ? 72 : 0),
        }}
      >
        <Calendar
          current={selected}
          onDayPress={(d) => setSelected(d.dateString)}
          markedDates={marked}
          theme={{
            calendarBackground: p.card,
            dayTextColor: p.text,
            monthTextColor: p.textHigh,
            textDisabledColor: p.iconMuted,
            todayTextColor: p.brandText,
            arrowColor: p.brandText,
            textSectionTitleColor: p.textMuted,
            selectedDayTextColor: '#ffffff',
            textDayFontFamily: fonts.sans,
            textMonthFontFamily: fonts.display,
            textDayHeaderFontFamily: fonts.sansSemibold,
            textMonthFontSize: 16,
            textDayHeaderFontSize: 11,
          }}
          style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: p.border, marginBottom: space.lg, overflow: 'hidden' }}
        />

        <SectionTitle>Schedule</SectionTitle>
        {dayItems.length === 0 ? (
          <EmptyState icon="calendar" title="Nothing scheduled" hint="No meetings or events on this day. Tap + to add one." />
        ) : (
          <View style={{ gap: 8 }}>
            {dayItems.map((o) => (
              <Card key={o.occurrenceId} onPress={() => onItemPress(o.event)}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ width: 6, alignSelf: 'stretch', borderRadius: 3, backgroundColor: kindColor(o.event.kind) }} />
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ fontSize: 14, fontFamily: fonts.sansSemibold, color: p.textHigh }}>{o.event.title}</Text>
                    <Text numberOfLines={1} style={{ fontSize: 12, fontFamily: fonts.sans, color: p.textMuted, marginTop: 1 }}>
                      {o.event.allDay ? (
                        'All day'
                      ) : (
                        <Text style={{ fontFamily: fonts.mono, fontVariant: ['tabular-nums'] }}>{fmtTime(o.startsAt)}</Text>
                      )}
                      {clientName(o.event.clientId) ? ` · ${clientName(o.event.clientId)}` : ''}
                    </Text>
                  </View>
                  <Feather name={o.event.kind === 'meeting' ? 'video' : 'calendar'} size={16} color={p.iconMuted} />
                </View>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>

      {canAdd ? (
        <Fab icon="plus" aboveTabBar onPress={() => { setEditing(null); setFormOpen(true) }} />
      ) : null}
      <EventForm
        visible={formOpen}
        event={editing ?? undefined}
        defaultKind="event"
        defaultDate={selected}
        onClose={() => setFormOpen(false)}
      />
    </Screen>
  )
}
