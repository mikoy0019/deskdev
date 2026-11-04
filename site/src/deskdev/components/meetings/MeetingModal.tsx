import { useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowSquareOutIcon, BriefcaseIcon, ClockIcon, MapPinIcon, TrashIcon,
} from '@phosphor-icons/react'
import Modal from '../Modal'
import ConfirmDialog from '../ConfirmDialog'
import { ClientSelect, DateField, DateTimeField, RecurrenceSelect } from '../pickers'
import { Field } from '../tasks/formBits'
import { useStore } from '../../store/useStore'
import { fmtDateTime } from '../../lib/format'
import { webHref } from '../../lib/links'
import type { EventItem, Recurrence } from '../../lib/types'
import { ColorSwatches, EVENT_COLORS, displayColor } from '../calendar/calendarShared'
import { useResetOnChange } from '../../lib/useResetOnChange'

const COLORS = EVENT_COLORS

export type MeetingModalState =
  | { mode: 'create'; startsAt: string }
  | { mode: 'edit'; event: EventItem }
  | null

type Errors = { title?: string; start?: string; end?: string; link?: string }

/** Meeting detail modal — create + edit (with notes) or read-only view. */
export default function MeetingModal({
  state, onClose, readOnly,
}: {
  state: MeetingModalState
  onClose: () => void
  /** View-permission users get a static detail view */
  readOnly?: boolean
}) {
  const clients = useStore((s) => s.clients)
  const addEvent = useStore((s) => s.addEvent)
  const updateEvent = useStore((s) => s.updateEvent)
  const deleteEvent = useStore((s) => s.deleteEvent)

  // Keep the last target while the dialog plays its exit: `state` going null
  // closes it, `shown` keeps its content on screen until it has left.
  const [shown, setShown] = useState<MeetingModalState>(state)
  if (state !== null && state !== shown) setShown(state)
  const open = state !== null
  const current = state ?? shown

  const event = current?.mode === 'edit' ? current.event : undefined
  // Older rows (or mobile ones) may hold a bare host or another scheme.
  const joinHref = webHref(event?.meetingLink)

  const [title, setTitle] = useState('')
  const [clientId, setClientId] = useState('')
  const [startsAt, setStartsAt] = useState<string | undefined>(undefined)
  const [endsAt, setEndsAt] = useState<string | undefined>(undefined)
  const [location, setLocation] = useState('')
  const [link, setLink] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [notes, setNotes] = useState('')
  const [recurrence, setRecurrence] = useState<Recurrence>('none')
  const [recurrenceUntil, setRecurrenceUntil] = useState<string | undefined>(undefined)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const formRef = useRef<HTMLDivElement>(null)
  const colorLabelId = useId()

  useResetOnChange([state], () => {
    if (!state) return
    if (state.mode === 'edit') {
      const e = state.event
      setTitle(e.title)
      setClientId(e.clientId ?? '')
      setStartsAt(e.startsAt)
      setEndsAt(e.endsAt)
      setLocation(e.location ?? '')
      setLink(e.meetingLink ?? '')
      setColor(e.color ?? COLORS[0])
      setNotes(e.notes ?? '')
      setRecurrence(e.recurrence)
      setRecurrenceUntil(e.recurrenceUntil)
    } else {
      setTitle('')
      setClientId('')
      setStartsAt(state.startsAt)
      setEndsAt(new Date(new Date(state.startsAt).getTime() + 60 * 60 * 1000).toISOString())
      setLocation('')
      setLink('')
      setColor(COLORS[0])
      setNotes('')
      setRecurrence('none')
      setRecurrenceUntil(undefined)
    }
    setConfirmDelete(false)
    setErrors({})
  })

  if (!current) return null

  /** Show the refusals under their fields and move focus to the first one. */
  const refuse = (next: Errors) => {
    setErrors(next)
    requestAnimationFrame(() => {
      formRef.current?.querySelector<HTMLElement>('[data-invalid] input')?.focus()
    })
  }

  const clearError = (key: keyof Errors) => {
    if (errors[key]) setErrors((x) => ({ ...x, [key]: undefined }))
  }

  const save = () => {
    const found: Errors = {}
    if (!title.trim()) found.title = 'Meeting needs a title'
    if (!startsAt) found.start = 'Pick a start time'
    if (found.title || found.start || !startsAt) {
      refuse(found)
      return
    }
    if (endsAt && endsAt <= startsAt) {
      refuse({ end: 'End must be after start' })
      return
    }
    // Absolute http(s) only: a bare "zoom.us/j/…" would open as a DeskDev path.
    const meetingLink = webHref(link)
    if (link.trim() && !meetingLink) {
      refuse({ link: 'Meeting link must be a web address' })
      return
    }
    const patch = {
      title: title.trim(),
      clientId: clientId || undefined,
      startsAt,
      endsAt,
      location: location.trim() || undefined,
      meetingLink,
      color,
      notes,
      recurrence,
      recurrenceUntil: recurrence === 'none' ? undefined : recurrenceUntil,
    }
    if (event) {
      updateEvent(event.id, patch)
      toast.success('Meeting updated')
    } else {
      addEvent({ ...patch, kind: 'meeting', allDay: false })
      toast.success('Meeting created')
    }
    onClose()
  }

  const saveNotesOnBlur = () => {
    if (!event || readOnly || !open) return
    if (notes !== (event.notes ?? '')) {
      updateEvent(event.id, { notes })
      toast.success('Notes saved')
    }
  }

  // ─── Read-only detail view ─────────────────────────────────────────────────
  if (readOnly) {
    const client = clients.find((c) => c.id === (event?.clientId ?? ''))
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Meeting details"
        footer={
          <button className="btn-ghost" onClick={onClose}>
            Close
          </button>
        }
      >
        <div className="space-y-4 text-sm">
          <h3 className="flex items-start gap-2.5 text-display text-xl font-semibold leading-snug text-ink-50 [overflow-wrap:anywhere]">
            <span
              className="mt-[0.55em] size-2.5 rounded-full shrink-0"
              style={{ backgroundColor: displayColor(event?.color) }}
              aria-hidden
            />
            <span className="min-w-0">{event?.title}</span>
          </h3>
          <div className="space-y-3 border-t border-ink-600 pt-4">
            <div className="flex items-start gap-3">
              <ClockIcon size={16} className="mt-0.5 shrink-0 text-ink-300" aria-hidden />
              <span className="tabular-nums text-ink-100">
                {fmtDateTime(event?.startsAt)}
                {event?.endsAt && ` – ${fmtDateTime(event.endsAt)}`}
              </span>
            </div>
            {client && (
              <div className="flex items-start gap-3 text-ink-200 [overflow-wrap:anywhere]">
                <BriefcaseIcon size={16} className="mt-0.5 shrink-0 text-ink-300" aria-hidden />
                <span className="min-w-0">Client: {client.name}</span>
              </div>
            )}
            {event?.location && (
              <div className="flex items-start gap-3 text-ink-200 [overflow-wrap:anywhere]">
                <MapPinIcon size={16} className="mt-0.5 shrink-0 text-ink-300" aria-hidden />
                <span className="min-w-0">Location: {event.location}</span>
              </div>
            )}
            {joinHref && (
              <a
                className="pressable inline-flex items-center gap-1.5 rounded-sm font-medium text-brand-700 dark:text-brand-400 underline-offset-2 hover:underline pointer-coarse:min-h-11"
                href={joinHref}
                target="_blank"
                rel="noreferrer"
              >
                <ArrowSquareOutIcon size={14} aria-hidden />
                Join link
              </a>
            )}
          </div>
          <div className="border-t border-ink-600 pt-4">
            <div className="section-title mb-1.5">Meeting notes</div>
            {event?.notes?.trim() ? (
              <p className="max-w-[65ch] leading-relaxed text-ink-100 whitespace-pre-wrap [overflow-wrap:anywhere]">{event.notes}</p>
            ) : (
              <p className="text-ink-300">No notes yet.</p>
            )}
          </div>
        </div>
      </Modal>
    )
  }

  // ─── Editable form ─────────────────────────────────────────────────────────
  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={event ? 'Edit meeting' : 'New meeting'}
        wide
        onSubmit={save}
        footer={
          <>
            {event && (
              <button
                className="btn-ghost text-rose-700 hover:bg-rose-500/10 hover:text-rose-800 max-sm:flex-none! sm:mr-auto dark:text-rose-400 dark:hover:text-rose-300"
                onClick={() => setConfirmDelete(true)}
              >
                <TrashIcon size={14} aria-hidden />
                Delete
              </button>
            )}
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              {event ? 'Save' : 'Create meeting'}
            </button>
          </>
        }
      >
        <div ref={formRef} className="space-y-4">
          <div data-invalid={errors.title ? '' : undefined}>
            <Field label="Title *" error={errors.title}>
              <input
                className="input w-full aria-invalid:border-rose-500 aria-invalid:focus:border-rose-500 aria-invalid:focus:ring-rose-500/20"
                value={title}
                autoFocus={!event}
                placeholder="e.g. Weekly client sync"
                aria-invalid={!!errors.title || undefined}
                onChange={(e) => {
                  setTitle(e.target.value)
                  clearError('title')
                }}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Client">
              <ClientSelect value={clientId} onChange={setClientId} allowNone />
            </Field>
            <div className="flex flex-col gap-2">
              <span id={colorLabelId} className="text-xs font-medium text-ink-200">Color</span>
              <ColorSwatches value={color} onChange={setColor} labelledBy={colorLabelId} />
            </div>
            <div data-invalid={errors.start ? '' : undefined}>
              <Field label="Starts *" error={errors.start}>
                <DateTimeField
                  valueIso={startsAt}
                  onChange={(v) => {
                    setStartsAt(v)
                    clearError('start')
                    clearError('end')
                  }}
                />
              </Field>
            </div>
            <div data-invalid={errors.end ? '' : undefined}>
              <Field label="Ends" error={errors.end}>
                <DateTimeField
                  valueIso={endsAt}
                  onChange={(v) => {
                    setEndsAt(v)
                    clearError('end')
                  }}
                />
              </Field>
            </div>
            <Field label="Location">
              <input
                className="input w-full"
                value={location}
                placeholder="Office, cafe, on-site…"
                onChange={(e) => setLocation(e.target.value)}
              />
            </Field>
            <div data-invalid={errors.link ? '' : undefined}>
              <Field label="Meeting link" error={errors.link}>
                <input
                  className="input w-full aria-invalid:border-rose-500 aria-invalid:focus:border-rose-500 aria-invalid:focus:ring-rose-500/20"
                  type="url"
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  value={link}
                  placeholder="https://meet.google.com/…"
                  aria-invalid={!!errors.link || undefined}
                  onChange={(e) => {
                    setLink(e.target.value)
                    clearError('link')
                  }}
                />
              </Field>
            </div>
            <Field label="Repeats">
              <RecurrenceSelect value={recurrence} onChange={setRecurrence} />
            </Field>
            {recurrence !== 'none' && (
              <Field label="Repeats until">
                <DateField value={recurrenceUntil} onChange={setRecurrenceUntil} />
              </Field>
            )}
          </div>

          <Field label="Meeting notes — shows up in EOD reports">
            <textarea
              className="input w-full min-h-[140px] resize-y leading-relaxed"
              value={notes}
              placeholder="Decisions, action items, blockers discussed…"
              onChange={(e) => setNotes(e.target.value)}
              onBlur={saveNotesOnBlur}
            />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete meeting"
        message={`Delete "${event?.title}"? This can't be undone.`}
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (event) {
            deleteEvent(event.id)
            toast.success('Meeting deleted')
          }
          onClose()
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  )
}
