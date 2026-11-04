import { useState } from 'react'
import { Feather } from '@expo/vector-icons'
import { Alert, Pressable, Switch, View } from 'react-native'
import { useShallow } from 'zustand/react/shallow'

import { Input } from '@/components/ui'
import { ColorPicker, DateField, Field, FormModal, PillGroup, SelectField, type SelectOption } from '@/components/forms'
import { isoDate } from '@/lib/format'
import { webHref } from '@/lib/links'
import { SWATCHES, useTheme } from '@/lib/theme'
import { useStore } from '@/store/useStore'
import type { EventItem, EventKind, Recurrence } from '@/lib/types'


const KIND_OPTIONS: { label: string; value: EventKind }[] = [
  { label: 'Event', value: 'event' },
  { label: 'Meeting', value: 'meeting' },
]

const RECUR_OPTIONS: { label: string; value: Recurrence }[] = [
  { label: 'None', value: 'none' },
  { label: 'Daily', value: 'daily' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Monthly', value: 'monthly' },
]

const pad = (n: number) => String(n).padStart(2, '0')
const toTime = (iso: string) => {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const combine = (date: string, time: string, allDay: boolean): string => {
  const d = new Date(`${date}T00:00:00`)
  if (!allDay) {
    const [h, m] = time.split(':')
    d.setHours(Number(h) || 0, Number(m) || 0, 0, 0)
  }
  return d.toISOString()
}

export function EventForm({
  visible, event, defaultKind = 'event', defaultDate, onClose,
}: {
  visible: boolean
  event?: EventItem
  /** Kind for a new item (calendar → event, meetings → meeting). */
  defaultKind?: EventKind
  /** ISO date (YYYY-MM-DD) preselected for a new item. */
  defaultDate?: string
  onClose: () => void
}) {
  const p = useTheme()
  const clients = useStore(useShallow((s) => [...s.clients].sort((a, b) => a.name.localeCompare(b.name))))
  const addEvent = useStore((s) => s.addEvent)
  const updateEvent = useStore((s) => s.updateEvent)
  const deleteEvent = useStore((s) => s.deleteEvent)

  const [wasVisible, setWasVisible] = useState(false)
  const [kind, setKind] = useState<EventKind>('event')
  const [title, setTitle] = useState('')
  const [clientId, setClientId] = useState<string | undefined>(undefined)
  const [date, setDate] = useState<string | undefined>(undefined)
  const [allDay, setAllDay] = useState(false)
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('10:00')
  const [location, setLocation] = useState('')
  const [meetingLink, setMeetingLink] = useState('')
  const [notes, setNotes] = useState('')
  const [color, setColor] = useState(SWATCHES[0])
  const [recurrence, setRecurrence] = useState<Recurrence>('none')
  const [recurrenceUntil, setRecurrenceUntil] = useState<string | undefined>(undefined)

  if (visible !== wasVisible) {
    setWasVisible(visible)
    if (visible) {
      setKind(event?.kind ?? defaultKind)
      setTitle(event?.title ?? '')
      setClientId(event?.clientId)
      setDate(event ? isoDate(new Date(event.startsAt)) : (defaultDate ?? isoDate()))
      setAllDay(event?.allDay ?? false)
      setStartTime(event ? toTime(event.startsAt) : '09:00')
      setEndTime(event?.endsAt ? toTime(event.endsAt) : '10:00')
      setLocation(event?.location ?? '')
      setMeetingLink(event?.meetingLink ?? '')
      setNotes(event?.notes ?? '')
      setColor(event?.color ?? SWATCHES[0])
      setRecurrence(event?.recurrence ?? 'none')
      setRecurrenceUntil(event?.recurrenceUntil)
    }
  }

  const clientOptions: SelectOption[] = clients.map((c) => ({ label: c.name, value: c.id, dot: c.color }))

  const save = () => {
    const trimmed = title.trim()
    if (!trimmed) { Alert.alert('Title required', 'Please enter a title.'); return }
    if (!date) { Alert.alert('Date required', 'Please pick a date.'); return }
    const startsAt = combine(date, startTime, allDay)
    const endsAt = allDay ? undefined : combine(date, endTime, false)
    // Absolute http(s) only: a bare host would open as a path on the web app.
    const link = kind === 'meeting' ? webHref(meetingLink) : undefined
    if (kind === 'meeting' && meetingLink.trim() && !link) {
      Alert.alert('Meeting link', 'Meeting link must be a web address.')
      return
    }
    const payload = {
      kind,
      title: trimmed,
      clientId,
      startsAt,
      endsAt,
      allDay,
      location: location.trim() || undefined,
      meetingLink: link,
      notes: notes.trim() || undefined,
      color,
      recurrence,
      recurrenceUntil: recurrence === 'none' ? undefined : recurrenceUntil,
    }
    if (event) updateEvent(event.id, payload)
    else addEvent(payload)
    onClose()
  }

  const confirmDelete = () => {
    if (!event) return
    Alert.alert(
      `Delete ${event.kind}?`,
      `"${event.title}" will be removed${event.recurrence !== 'none' ? ', including the whole recurring series' : ''}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => { deleteEvent(event.id); onClose() } },
      ],
    )
  }

  const label = kind === 'meeting' ? 'meeting' : 'event'

  return (
    <FormModal
      visible={visible}
      title={event ? `Edit ${label}` : `New ${label}`}
      onClose={onClose}
      onSubmit={save}
      submitLabel={event ? 'Save changes' : `Add ${label}`}
      footerLeft={event ? (
        <Pressable onPress={confirmDelete} hitSlop={8} style={{ padding: 10 }}>
          <Feather name="trash-2" size={20} color={p.danger} />
        </Pressable>
      ) : undefined}
    >
      <Field label="Type">
        <PillGroup options={KIND_OPTIONS} value={kind} onChange={setKind} />
      </Field>
      <Field label="Title *">
        <Input value={title} onChangeText={setTitle} placeholder={`${label[0].toUpperCase()}${label.slice(1)} title`} autoFocus={!event} />
      </Field>
      <Field label="Client">
        <SelectField value={clientId} options={clientOptions} onChange={setClientId} allowNone noneLabel="No client" placeholder="No client" />
      </Field>
      <Field label="Date *">
        <DateField value={date} onChange={setDate} placeholder="Pick a date" />
      </Field>
      <Field label="All day">
        <Switch value={allDay} onValueChange={setAllDay} trackColor={{ true: p.brand, false: p.borderStrong }} />
      </Field>
      {!allDay ? (
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Field label="Start (HH:MM)">
              <Input value={startTime} onChangeText={setStartTime} placeholder="09:00" keyboardType="numbers-and-punctuation" />
            </Field>
          </View>
          <View style={{ flex: 1 }}>
            <Field label="End (HH:MM)">
              <Input value={endTime} onChangeText={setEndTime} placeholder="10:00" keyboardType="numbers-and-punctuation" />
            </Field>
          </View>
        </View>
      ) : null}
      <Field label="Location">
        <Input value={location} onChangeText={setLocation} placeholder="Where?" />
      </Field>
      {kind === 'meeting' ? (
        <Field label="Meeting link">
          <Input value={meetingLink} onChangeText={setMeetingLink} placeholder="https://…" autoCapitalize="none" keyboardType="url" />
        </Field>
      ) : null}
      <Field label="Color">
        <ColorPicker value={color} onChange={setColor} colors={SWATCHES} />
      </Field>
      <Field label="Repeats">
        <PillGroup options={RECUR_OPTIONS} value={recurrence} onChange={setRecurrence} />
      </Field>
      {recurrence !== 'none' ? (
        <Field label="Repeat until">
          <DateField value={recurrenceUntil} onChange={setRecurrenceUntil} placeholder="No end date" />
        </Field>
      ) : null}
      <Field label={kind === 'meeting' ? 'Notes' : 'Description'}>
        <Input value={notes} onChangeText={setNotes} placeholder="Details, agenda, links…" multiline style={{ minHeight: 90, textAlignVertical: 'top' }} />
      </Field>
    </FormModal>
  )
}
