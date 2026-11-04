import { useId, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { CalendarDotsIcon, PlugsConnectedIcon, PlusIcon, VideoCameraIcon, XIcon } from '@phosphor-icons/react'
import Modal from '../Modal'
import { ClientSelect, DateField, DateTimeField, RecurrenceSelect } from '../pickers'
import { Field, FieldError } from '../tasks/formBits'
import { Notice, Switch } from '../settings/formKit'
import { IndicatorGroup, LayoutIndicator } from '../motion'
import { useStore, useCurrentUser, type AttendeeInput } from '../../store/useStore'
import { activeUsers, can } from '../../lib/permissions'
import { isGoogleAvailable } from '../../lib/google'
import { classNames, isoDate } from '../../lib/format'
import { webHref } from '../../lib/links'
import type { EventItem, EventKind, Recurrence } from '../../lib/types'
import { ColorSwatches } from './calendarShared'
import { SyncBadgePill } from './SyncBadgePill'
import { browserTimeZone, isTimeZone, parseGuestInput, timeZoneOptions, type TeamCalendarState } from './calendarSync'
import { useResetOnChange } from '../../lib/useResetOnChange'

type Errors = { title?: string; start?: string; end?: string; link?: string; guest?: string }

export type { TeamCalendarState }

/** Create / edit modal for events and meetings — respects per-kind permissions. */
export default function EventFormModal({
  open, onClose, initial, defaultDate, teamCalendar,
}: {
  open: boolean
  onClose: () => void
  /** Edit mode when set */
  initial?: EventItem | null
  /** YYYY-MM-DD prefill for create (from clicking an empty day) */
  defaultDate?: string
  teamCalendar?: TeamCalendarState
}) {
  const user = useCurrentUser()
  const addEvent = useStore((s) => s.addEvent)
  const updateEvent = useStore((s) => s.updateEvent)
  const setEventAttendees = useStore((s) => s.setEventAttendees)
  const users = useStore((s) => s.users)
  const initialId = initial?.id
  // Select the stable array and filter outside: a selector that builds a new
  // array every time would re-render forever (Zustand v5).
  const allGuests = useStore((s) => s.eventAttendees)
  const savedGuests = useMemo(
    () => (initialId ? allGuests.filter((a) => a.eventId === initialId) : []),
    [allGuests, initialId],
  )

  const canEvents = can(user, 'calendar', 'edit')
  const canMeetings = can(user, 'meetings', 'edit')

  const [kind, setKind] = useState<EventKind>('event')
  const [title, setTitle] = useState('')
  const [clientId, setClientId] = useState('')
  const [allDay, setAllDay] = useState(false)
  const [startsAt, setStartsAt] = useState<string | undefined>()
  const [endsAt, setEndsAt] = useState<string | undefined>()
  const [location, setLocation] = useState('')
  const [meetingLink, setMeetingLink] = useState('')
  const [notes, setNotes] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState<string | undefined>()
  const [recurrence, setRecurrence] = useState<Recurrence>('none')
  const [recurrenceUntil, setRecurrenceUntil] = useState<string | undefined>()
  const [timezone, setTimezone] = useState(browserTimeZone)
  const [syncGoogle, setSyncGoogle] = useState(false)
  const [addMeet, setAddMeet] = useState(false)
  const [guests, setGuests] = useState<AttendeeInput[]>([])
  const [guestDraft, setGuestDraft] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const formRef = useRef<HTMLDivElement>(null)
  const colorLabelId = useId()
  const zones = useMemo(() => timeZoneOptions(timezone), [timezone])
  // Deactivated people and accounts without an address cannot be invited.
  const teammates = useMemo(
    () => activeUsers(users).filter((u) => u.email).sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [users],
  )

  useResetOnChange([open, initial, defaultDate, canEvents], () => {
    if (!open) return
    setErrors({})
    setGuestDraft('')
    if (initial) {
      // A zone saved by an older client (or none) falls back to this browser's.
      setTimezone(isTimeZone(initial.timezone) ? initial.timezone : browserTimeZone())
      setSyncGoogle(Boolean(initial.syncGoogle))
      setAddMeet(Boolean(initial.addMeet))
      setGuests(savedGuests.map((a) => ({ email: a.email, profileId: a.profileId })))
      setKind(initial.kind)
      setTitle(initial.title)
      setClientId(initial.clientId ?? '')
      setAllDay(initial.allDay)
      setStartsAt(initial.startsAt)
      setEndsAt(initial.endsAt)
      setLocation(initial.location ?? '')
      setMeetingLink(initial.meetingLink ?? '')
      setNotes(initial.notes ?? '')
      setDescription(initial.description ?? '')
      setColor(initial.color)
      setRecurrence(initial.recurrence)
      setRecurrenceUntil(initial.recurrenceUntil)
    } else {
      setTimezone(browserTimeZone())
      setSyncGoogle(false)
      setAddMeet(false)
      setGuests([])
      setKind(canEvents ? 'event' : 'meeting')
      setTitle('')
      setClientId('')
      setAllDay(false)
      setStartsAt(
        defaultDate ? new Date(`${defaultDate}T09:00`).toISOString() : undefined,
      )
      setEndsAt(undefined)
      setLocation('')
      setMeetingLink('')
      setNotes('')
      setDescription('')
      setColor(undefined)
      setRecurrence('none')
      setRecurrenceUntil(undefined)
    }
  })

  const isMeeting = kind === 'meeting'
  // Google cannot work on this build: the group below is shown, but switched
  // off, so nobody believes a guest was invited when nothing was sent.
  const unavailable = teamCalendar === 'unavailable'
  const noun = isMeeting ? 'Meeting' : 'Event'
  const showKindToggle = !initial && canEvents && canMeetings

  /** Show the refusals under their fields and move focus to the first one. */
  const refuse = (next: Errors) => {
    setErrors(next)
    requestAnimationFrame(() => {
      formRef.current
        ?.querySelector<HTMLElement>('[data-invalid] input, [data-invalid] select')
        ?.focus()
    })
  }

  const clearError = (key: keyof Errors) => {
    if (errors[key]) setErrors((x) => ({ ...x, [key]: undefined }))
  }

  const nameFor = (g: AttendeeInput) => (g.profileId ? users.find((u) => u.id === g.profileId)?.fullName : undefined)

  /** Adds typed or pasted addresses; a teammate's address is tied to their profile. */
  const addGuests = (raw: string): boolean => {
    const { emails, rejected } = parseGuestInput(raw)
    if (emails.length) {
      setGuests((cur) => {
        const have = new Set(cur.map((g) => g.email))
        const add = emails
          .filter((e) => !have.has(e))
          .map((email) => ({ email, profileId: teammates.find((u) => u.email?.toLowerCase() === email)?.id }))
        return [...cur, ...add]
      })
    }
    if (rejected.length) {
      setGuestDraft(rejected.join(' '))
      setErrors((x) => ({ ...x, guest: `Not an email address: ${rejected.join(', ')}` }))
      return false
    }
    setGuestDraft('')
    clearError('guest')
    return true
  }

  const submit = () => {
    const t = title.trim()
    const found: Errors = {}
    if (!t) found.title = 'Title is required'
    if (!startsAt) found.start = allDay ? 'Pick a start date' : 'Pick a start time'
    if (found.title || found.start || !startsAt) {
      refuse(found)
      return
    }
    // Normalize all-day events to local day bounds
    const start = allDay
      ? new Date(`${isoDate(startsAt)}T00:00`).toISOString()
      : startsAt
    const end = endsAt
      ? allDay
        ? new Date(`${isoDate(endsAt)}T23:59`).toISOString()
        : endsAt
      : undefined
    if (end && end < start) {
      refuse({ end: 'End must be after start' })
      return
    }
    // Stored as an absolute http(s) URL: a bare "meet.google.com/…" would open
    // as a DeskDev path, and any other scheme is refused.
    const link = isMeeting ? webHref(meetingLink) : undefined
    if (isMeeting && meetingLink.trim() && !link) {
      refuse({ link: 'Meeting link must be a web address' })
      return
    }
    // An address still sitting in the box counts: nobody expects it to be dropped on save.
    let invited = guests
    if (guestDraft.trim()) {
      const { emails, rejected } = parseGuestInput(guestDraft)
      if (rejected.length) {
        refuse({ guest: `Not an email address: ${rejected.join(', ')}` })
        return
      }
      const have = new Set(guests.map((g) => g.email))
      invited = [
        ...guests,
        ...emails
          .filter((e) => !have.has(e))
          .map((email) => ({ email, profileId: teammates.find((u) => u.email?.toLowerCase() === email)?.id })),
      ]
    }
    const payload = {
      kind,
      title: t,
      description: description.trim() || undefined,
      clientId: clientId || undefined,
      startsAt: start,
      endsAt: end,
      allDay,
      location: location.trim() || undefined,
      meetingLink: link,
      notes: isMeeting ? notes.trim() || undefined : undefined,
      color,
      recurrence,
      recurrenceUntil: recurrence !== 'none' ? recurrenceUntil : undefined,
      // The database only takes a real IANA zone; the picker offers nothing else.
      timezone: isTimeZone(timezone) ? timezone : undefined,
      syncGoogle,
      // Meet is made by Google on the team calendar, so it means nothing without the sync.
      addMeet: syncGoogle && addMeet,
    }
    let eventId: string
    if (initial) {
      updateEvent(initial.id, payload)
      eventId = initial.id
    } else {
      eventId = addEvent(payload)
    }
    // false = no edit access for this kind; the event itself was saved.
    const guestsSaved = setEventAttendees(eventId, invited)
    if (guestsSaved) toast.success(initial ? `${noun} updated` : `${noun} created`)
    else toast.error(`${noun} saved, but the guest list was not: you do not have edit access.`)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? `Edit ${noun.toLowerCase()}` : `New ${noun.toLowerCase()}`}
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary">
            {initial ? 'Save changes' : `Create ${noun.toLowerCase()}`}
          </button>
        </>
      }
    >
      <div ref={formRef} className="space-y-4">
        {showKindToggle && (
          <IndicatorGroup id="event-kind">
            <div className="flex rounded-lg bg-ink-700/70 border border-ink-600 p-0.5" role="group" aria-label="Type">
              {(
                [
                  ['event', 'Event', CalendarDotsIcon],
                  ['meeting', 'Meeting', VideoCameraIcon],
                ] as const
              ).map(([k, label, Icon]) => {
                const active = kind === k
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={active}
                    className={classNames(
                      'pressable relative flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 pointer-coarse:min-h-11 rounded-md text-xs font-medium focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500',
                      active ? 'text-ink-50' : 'text-ink-300 hover:text-ink-50',
                    )}
                    onClick={() => {
                      setKind(k)
                      clearError('link')
                    }}
                  >
                    {active && (
                      <LayoutIndicator
                        layoutId="event-kind"
                        radius={6}
                        className="absolute inset-0 bg-ink-800 border border-ink-600 shadow-(--shadow-1)"
                      />
                    )}
                    <Icon size={14} weight={active ? 'fill' : 'regular'} className="relative" aria-hidden />
                    <span className="relative">{label}</span>
                  </button>
                )
              })}
            </div>
          </IndicatorGroup>
        )}

        <div data-invalid={errors.title ? '' : undefined}>
          <Field label="Title *" error={errors.title}>
            <input
              className="input w-full aria-invalid:border-rose-500 aria-invalid:focus:border-rose-500 aria-invalid:focus:ring-rose-500/20"
              value={title}
              placeholder={isMeeting ? 'e.g. Weekly sync with client' : 'e.g. Portfolio launch'}
              autoFocus
              aria-invalid={!!errors.title || undefined}
              onChange={(e) => {
                setTitle(e.target.value)
                clearError('title')
              }}
            />
          </Field>
        </div>

        <Field label="Client">
          <ClientSelect value={clientId} onChange={setClientId} allowNone />
        </Field>

        <label className="inline-flex items-center gap-2.5 text-sm text-ink-100 cursor-pointer select-none pointer-coarse:min-h-11">
          <input
            type="checkbox"
            className="size-4 accent-brand-600"
            checked={allDay}
            onChange={(e) => {
              setAllDay(e.target.checked)
              clearError('start')
            }}
          />
          All day
        </label>

        {/* Two native date-time fields don't fit side by side in this dialog
            (each needs ~220px; "09:00 AM" lost its M). Dates alone do. */}
        <div className={classNames('grid grid-cols-1 gap-3', allDay && 'sm:grid-cols-2')}>
          <div data-invalid={errors.start ? '' : undefined}>
          <Field label={allDay ? 'Start date *' : 'Starts *'} error={errors.start}>
            {allDay ? (
              <DateField
                value={startsAt ? isoDate(startsAt) : undefined}
                onChange={(v) => {
                  setStartsAt(v ? new Date(`${v}T00:00`).toISOString() : undefined)
                  clearError('start')
                  clearError('end')
                }}
              />
            ) : (
              <DateTimeField
                valueIso={startsAt}
                onChange={(v) => {
                  setStartsAt(v)
                  clearError('start')
                  clearError('end')
                }}
              />
            )}
          </Field>
          </div>
          <div data-invalid={errors.end ? '' : undefined}>
          <Field label={allDay ? 'End date' : 'Ends'} error={errors.end}>
            {allDay ? (
              <DateField
                value={endsAt ? isoDate(endsAt) : undefined}
                min={startsAt ? isoDate(startsAt) : undefined}
                onChange={(v) => {
                  setEndsAt(v ? new Date(`${v}T23:59`).toISOString() : undefined)
                  clearError('end')
                }}
              />
            ) : (
              <DateTimeField
                valueIso={endsAt}
                onChange={(v) => {
                  setEndsAt(v)
                  clearError('end')
                }}
              />
            )}
          </Field>
          </div>
        </div>

        {!allDay && (
          <Field label="Time zone">
            <select className="input w-full" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {zones.map((z) => (
                <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Location">
          <input
            className="input w-full"
            value={location}
            placeholder="Office, address, or 'Remote'"
            onChange={(e) => setLocation(e.target.value)}
          />
        </Field>

        {isMeeting && (
          <div data-invalid={errors.link ? '' : undefined}>
            <Field label="Meeting link" error={errors.link}>
              <input
                className="input w-full aria-invalid:border-rose-500 aria-invalid:focus:border-rose-500 aria-invalid:focus:ring-rose-500/20"
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                value={meetingLink}
                placeholder="https://meet.google.com/…"
                aria-invalid={!!errors.link || undefined}
                onChange={(e) => {
                  setMeetingLink(e.target.value)
                  clearError('link')
                }}
              />
            </Field>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <span id={colorLabelId} className="text-xs font-medium text-ink-200">Color</span>
          <ColorSwatches value={color} onChange={setColor} labelledBy={colorLabelId} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Repeats">
            <RecurrenceSelect value={recurrence} onChange={setRecurrence} />
          </Field>
          {recurrence !== 'none' && (
            <Field label="Repeats until">
              <DateField
                value={recurrenceUntil}
                min={startsAt ? isoDate(startsAt) : undefined}
                onChange={setRecurrenceUntil}
              />
            </Field>
          )}
        </div>

        {/* Team calendar: one hairline-bounded group, so the two switches and
            the guest list read as what leaves DeskDev for Google. */}
        <div className="space-y-4 border-y border-ink-600 py-4">
          {unavailable && (
            <Notice tone="info" icon={PlugsConnectedIcon}>
              {isGoogleAvailable
                ? 'Team calendar is not set up yet. Events stay in DeskDev and no invitations are sent.'
                : 'Available when DeskDev runs on Supabase. This build is in local mode.'}
            </Notice>
          )}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={classNames('text-sm font-medium', unavailable ? 'text-ink-300' : 'text-ink-50')}>
                  Sync to team calendar
                </span>
                {initial && syncGoogle && <SyncBadgePill event={initial} teamCalendar={teamCalendar} />}
              </div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink-300">
                {unavailable
                  ? 'Stays in DeskDev. Nothing is sent to Google.'
                  : syncGoogle && teamCalendar && teamCalendar !== 'active'
                  ? 'The team calendar is not connected. This is sent once an admin connects it.'
                  : 'Puts this on the shared Google calendar and keeps it up to date.'}
              </p>
            </div>
            <Switch on={syncGoogle} onChange={setSyncGoogle} label="Sync to team calendar" disabled={unavailable} />
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <span className={classNames('text-sm font-medium', syncGoogle && !unavailable ? 'text-ink-50' : 'text-ink-300')}>
                Add Google Meet
              </span>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink-300">
                {syncGoogle ? 'Google makes the join link on the first sync.' : 'Needs the team calendar sync.'}
              </p>
            </div>
            <Switch on={syncGoogle && addMeet} onChange={setAddMeet} label="Add Google Meet" disabled={!syncGoogle || unavailable} />
          </div>

          <div data-invalid={errors.guest ? '' : undefined} className="flex flex-col gap-2">
            <span className="text-xs font-medium text-ink-200">Guests</span>
            {guests.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {guests.map((g) => {
                  const name = nameFor(g)
                  return (
                    <li
                      key={g.email}
                      className="chip max-w-full gap-1 border-ink-500 py-0.5 pl-2.5 pr-0.5 text-ink-100"
                      title={name ? `${name} (${g.email})` : g.email}
                    >
                      <span className="truncate">{name ?? g.email}</span>
                      <button
                        type="button"
                        className="pressable tap-target flex size-5 shrink-0 items-center justify-center rounded-full text-ink-300 hover:bg-ink-700 hover:text-ink-50"
                        aria-label={`Remove ${name ?? g.email}`}
                        onClick={() => setGuests((cur) => cur.filter((x) => x.email !== g.email))}
                      >
                        <XIcon size={11} aria-hidden />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
              <select
                className="input w-full disabled:opacity-60"
                value=""
                disabled={unavailable}
                aria-label="Add a teammate"
                onChange={(e) => {
                  const u = teammates.find((x) => x.id === e.target.value)
                  if (u?.email) addGuests(u.email)
                }}
              >
                <option value="">Add a teammate…</option>
                {teammates
                  .filter((u) => !guests.some((g) => g.email === u.email?.toLowerCase()))
                  .map((u) => (
                    <option key={u.id} value={u.id}>{u.fullName}</option>
                  ))}
              </select>
              <div className="flex gap-2">
                <input
                  className="input min-w-0 flex-1 disabled:opacity-60 aria-invalid:border-rose-500 aria-invalid:focus:border-rose-500 aria-invalid:focus:ring-rose-500/20"
                  type="email"
                  disabled={unavailable}
                  inputMode="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  multiple
                  value={guestDraft}
                  placeholder="name@company.com"
                  aria-label="Guest email"
                  aria-invalid={!!errors.guest || undefined}
                  onChange={(e) => {
                    setGuestDraft(e.target.value)
                    clearError('guest')
                  }}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ',') && guestDraft.trim()) {
                      e.preventDefault()
                      addGuests(guestDraft)
                    }
                  }}
                  onPaste={(e) => {
                    const pasted = e.clipboardData.getData('text')
                    if (/[\s,;]/.test(pasted.trim())) {
                      e.preventDefault()
                      addGuests(`${guestDraft} ${pasted}`)
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn-secondary shrink-0 pointer-coarse:min-h-11"
                  disabled={unavailable || !guestDraft.trim()}
                  onClick={() => addGuests(guestDraft)}
                >
                  <PlusIcon size={14} aria-hidden />
                  Add
                </button>
              </div>
            </div>
            {errors.guest ? (
              <FieldError>{errors.guest}</FieldError>
            ) : (
              <p className="text-[11px] leading-relaxed text-ink-300">
                {syncGoogle && !unavailable
                  ? 'Guests get their invitation from Google. They never see notes or the client.'
                  : 'Invitations go out only for events on the team calendar.'}
              </p>
            )}
          </div>
        </div>

        <Field label="Description">
          <textarea
            className="input w-full min-h-[72px] resize-y"
            value={description}
            placeholder="What's this about?"
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        {isMeeting && (
          <Field label="Meeting notes">
            <textarea
              className="input w-full min-h-[72px] resize-y"
              value={notes}
              placeholder="Agenda, prep, follow-ups…"
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        )}
      </div>
    </Modal>
  )
}
