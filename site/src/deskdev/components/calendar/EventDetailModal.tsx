import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowSquareOutIcon, BriefcaseIcon, CalendarDotsIcon, ClockIcon, GlobeHemisphereWestIcon, MapPinIcon,
  PencilSimpleIcon, RepeatIcon, TrashIcon, UserIcon, UsersIcon, VideoCameraIcon,
} from '@phosphor-icons/react'
import Modal from '../Modal'
import ConfirmDialog from '../ConfirmDialog'
import { useStore, useCurrentUser, type EventOccurrence } from '../../store/useStore'
import { can } from '../../lib/permissions'
import { classNames, fmtDate, fmtTime } from '../../lib/format'
import { webHref } from '../../lib/links'
import type { EventItem } from '../../lib/types'
import { eventColor, isRecurring, occTimeLabel } from './calendarShared'
import { SyncBadgePill } from './SyncBadgePill'
import { RSVP_LABEL, browserTimeZone, googleTemplateUrl, isTimeZone, syncBadge, type TeamCalendarState } from './calendarSync'

function DetailRow({
  icon: Icon, children,
}: {
  icon: typeof ClockIcon
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3 text-sm text-ink-100">
      <Icon size={16} className="text-ink-300 mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">{children}</div>
    </div>
  )
}

const RECURRENCE_LABELS: Record<EventItem['recurrence'], string> = {
  none: '',
  daily: 'Repeats daily',
  weekly: 'Repeats weekly',
  monthly: 'Repeats monthly',
}

/** Read-only occurrence detail with Edit / Delete for permitted users. */
export default function EventDetailModal({
  open = true, occurrence, onClose, onEdit, teamCalendar,
}: {
  /** False plays the exit; the occurrence stays set until the parent drops it. */
  open?: boolean
  occurrence: EventOccurrence | null
  onClose: () => void
  onEdit: (event: EventItem) => void
  teamCalendar?: TeamCalendarState
}) {
  const user = useCurrentUser()
  const clients = useStore((s) => s.clients)
  const users = useStore((s) => s.users)
  const deleteEvent = useStore((s) => s.deleteEvent)
  const eventId = occurrence?.event.id
  // The stable array, filtered outside the selector (Zustand v5: a selector
  // returning a new array each time re-renders forever).
  const allGuests = useStore((s) => s.eventAttendees)
  const guests = useMemo(
    () => (eventId ? allGuests.filter((a) => a.eventId === eventId) : []),
    [allGuests, eventId],
  )
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  if (!occurrence) return null

  const e = occurrence.event
  const isMeeting = e.kind === 'meeting'
  const noun = isMeeting ? 'Meeting' : 'Event'
  const canEdit = can(user, isMeeting ? 'meetings' : 'calendar', 'edit')
  const color = eventColor(e)
  const client = e.clientId ? clients.find((c) => c.id === e.clientId) : undefined
  // Rows saved before links were checked (or from mobile) may hold a bare host or another scheme.
  const meetingHref = webHref(e.meetingLink)
  const creator = e.createdBy ? users.find((u) => u.id === e.createdBy) : undefined
  const sync = syncBadge(e, teamCalendar)
  // Needs no permission and no connection: it opens Google's own form, prefilled.
  const googleHref = googleTemplateUrl(e)
  // Worth saying only when the event was planned somewhere else.
  const plannedZone = !e.allDay && isTimeZone(e.timezone) && e.timezone !== browserTimeZone() ? e.timezone : null

  const deleteMessage = isRecurring(e)
    ? `Delete "${e.title}"? This is a recurring ${noun.toLowerCase()} — the entire series (every occurrence) will be deleted.`
    : `Delete "${e.title}"? This cannot be undone.`

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={`${noun} details`}
        footer={
          canEdit ? (
            <>
              {/* A details view has one filled action, Edit. Delete stays quiet (the
                  confirm dialog carries the weight) and keeps its own width on a
                  phone, so the thumb rests on Edit. */}
              <button
                className="btn-ghost text-rose-700 hover:bg-rose-500/10 hover:text-rose-800 max-sm:flex-none! sm:mr-auto dark:text-rose-400 dark:hover:text-rose-300"
                onClick={() => setConfirmingDelete(true)}
              >
                <TrashIcon size={14} aria-hidden />
                Delete
              </button>
              <button className="btn-primary" onClick={() => onEdit(e)}>
                <PencilSimpleIcon size={14} aria-hidden />
                Edit
              </button>
            </>
          ) : undefined
        }
      >
        <div className="space-y-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={classNames('badge', isMeeting ? 'badge-info' : 'badge-neutral')}>
                {isMeeting ? <VideoCameraIcon size={11} aria-hidden /> : <CalendarDotsIcon size={11} aria-hidden />}
                {noun}
              </span>
              {isRecurring(e) && (
                <span className="badge badge-neutral">
                  <RepeatIcon size={11} aria-hidden />
                  {RECURRENCE_LABELS[e.recurrence]}
                  {e.recurrenceUntil ? ` until ${fmtDate(e.recurrenceUntil)}` : ''}
                </span>
              )}
              <SyncBadgePill event={e} teamCalendar={teamCalendar} />
            </div>
            <h3 className="mt-3 flex items-start gap-2.5 text-display text-xl font-semibold leading-snug text-ink-50 [overflow-wrap:anywhere]">
              <span
                className="mt-[0.55em] size-2.5 rounded-full shrink-0"
                style={{ backgroundColor: color }}
                aria-hidden
              />
              <span className="min-w-0">{e.title}</span>
            </h3>
          </div>

          <div className="space-y-3 border-t border-ink-600 pt-4">
            <DetailRow icon={ClockIcon}>
              {fmtDate(occurrence.startsAt)}
              {' · '}
              <span className="tabular-nums">{occTimeLabel(occurrence)}</span>
              {occurrence.endsAt &&
                !e.allDay &&
                fmtDate(occurrence.endsAt) !== fmtDate(occurrence.startsAt) && (
                  <span className="text-ink-300"> (ends {fmtDate(occurrence.endsAt)}, <span className="tabular-nums">{fmtTime(occurrence.endsAt)}</span>)</span>
                )}
            </DetailRow>
            {plannedZone && (
              <DetailRow icon={GlobeHemisphereWestIcon}>
                <span className="text-ink-200">Shown in your time. Planned in {plannedZone.replace(/_/g, ' ')}.</span>
              </DetailRow>
            )}
            {client && (
              <DetailRow icon={BriefcaseIcon}>{client.name}{client.company ? ` — ${client.company}` : ''}</DetailRow>
            )}
            {e.location && <DetailRow icon={MapPinIcon}>{e.location}</DetailRow>}
            {meetingHref && (
              <DetailRow icon={VideoCameraIcon}>
                <a
                  href={meetingHref}
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand-700 dark:text-brand-400 underline-offset-2 hover:underline [overflow-wrap:anywhere]"
                >
                  {e.meetingLink}
                </a>
              </DetailRow>
            )}
            {creator && (
              <DetailRow icon={UserIcon}>
                <span className="text-ink-200">Created by {creator.fullName}</span>
              </DetailRow>
            )}
            {guests.length > 0 && (
              <DetailRow icon={UsersIcon}>
                <ul className="space-y-1">
                  {guests.map((g) => {
                    const name = g.profileId ? users.find((u) => u.id === g.profileId)?.fullName : g.displayName
                    return (
                      <li key={g.id} className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 [overflow-wrap:anywhere]" title={g.email}>
                          {name ?? g.email}
                          {g.optional && <span className="text-ink-300"> (optional)</span>}
                        </span>
                        {/* Google owns the reply; DeskDev only shows it. */}
                        <span className="shrink-0 text-xs text-ink-300">{RSVP_LABEL[g.responseStatus] ?? RSVP_LABEL.needsAction}</span>
                      </li>
                    )
                  })}
                </ul>
              </DetailRow>
            )}
          </div>

          {sync?.tone === 'error' && (
            <p role="status" className="rounded-lg border border-rose-500/30 bg-rose-500/8 px-3 py-2 text-xs leading-relaxed text-ink-100 [overflow-wrap:anywhere]">
              This did not reach the team calendar{sync.detail ? `: ${sync.detail.replace(/\.$/, '')}.` : '.'} An admin can retry it in Settings, under Integrations.
            </p>
          )}

          {e.description && (
            <div>
              <h4 className="section-title mb-1.5">Description</h4>
              <p className="max-w-[65ch] text-sm leading-relaxed text-ink-100 whitespace-pre-wrap [overflow-wrap:anywhere]">{e.description}</p>
            </div>
          )}

          {isMeeting && e.notes && (
            <div>
              <h4 className="section-title mb-1.5">Meeting notes</h4>
              <p className="max-w-[65ch] text-sm leading-relaxed text-ink-100 whitespace-pre-wrap [overflow-wrap:anywhere]">{e.notes}</p>
            </div>
          )}

          {googleHref && (
            <a
              href={googleHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-brand-700 underline-offset-2 hover:underline dark:text-brand-400 pointer-coarse:min-h-11"
            >
              Add to Google Calendar
              <ArrowSquareOutIcon size={13} aria-hidden />
            </a>
          )}

          {isMeeting && !canEdit && (
            <p className="text-xs text-ink-300 border-t border-ink-600 pt-3">
              You have read-only access to meetings.
            </p>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmingDelete}
        title={`Delete ${noun.toLowerCase()}`}
        message={deleteMessage}
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          deleteEvent(e.id)
          toast.success(`${noun} deleted`)
          onClose()
        }}
        onClose={() => setConfirmingDelete(false)}
      />
    </>
  )
}
