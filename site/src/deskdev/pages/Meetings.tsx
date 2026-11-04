import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { addDays, differenceInCalendarDays, format, startOfDay } from 'date-fns'
import {
  CaretDownIcon, CaretLeftIcon, CaretRightIcon, FileTextIcon, MapPinIcon, PlusIcon,
  RepeatIcon, ScrollIcon, VideoCameraIcon,
} from '@phosphor-icons/react'
import Layout from '../components/Layout'
import KanbanBoard, { type KanbanColumn } from '../components/KanbanBoard'
import EodReportModal from '../components/EodReportModal'
import MeetingModal, { type MeetingModalState } from '../components/meetings/MeetingModal'
import { ClientSelect } from '../components/pickers'
import { EmptyState, SkeletonBoard } from '../components/ui-foundation'
import { StatusDot } from '../components/motion'
import { displayColor, firstLiveId, isLiveMeeting, useNow } from '../components/calendar/calendarShared'
import { useStore, useCurrentUser, getEventOccurrences, type EventOccurrence } from '../store/useStore'
import { can } from '../lib/permissions'
import { webHref } from '../lib/links'
import { classNames, fmtDate, fmtTime, fmtTimeRangeParts, isoDate } from '../lib/format'
import { useCoarsePointer } from '../pwa/useMediaQuery'

interface MeetingCard {
  id: string
  occ: EventOccurrence
}

export default function Meetings() {
  const user = useCurrentUser()
  const canEdit = can(user, 'meetings', 'edit')
  // The board only drags with a fine pointer (KanbanBoard); touch reschedules
  // through each card's "Move to…" select, so say that instead.
  const coarse = useCoarsePointer()
  const subtitle = !canEdit
    ? 'Kanban by day'
    : coarse
      ? 'Kanban by day — use Move to… to reschedule'
      : 'Kanban by day — drag to reschedule'

  const events = useStore((s) => s.events)
  const clients = useStore((s) => s.clients)
  const updateEvent = useStore((s) => s.updateEvent)
  const hydrated = useStore((s) => s.hydrated)

  const [searchParams, setSearchParams] = useSearchParams()
  const clientFilter = searchParams.get('client') ?? ''
  const setClientFilter = (id: string) => {
    const next = new URLSearchParams(searchParams)
    if (id) next.set('client', id)
    else next.delete('client')
    setSearchParams(next, { replace: true })
  }

  const [weekOffset, setWeekOffset] = useState(0)
  const [modal, setModal] = useState<MeetingModalState>(null)
  const [eodOpen, setEodOpen] = useState(false)
  const [pastOpen, setPastOpen] = useState(false)
  // Stable: this page re-renders every 30s for the live clock, and a dialog
  // must not see a new close handler each time while someone types notes.
  const closeModal = useCallback(() => setModal(null), [])
  const closeEod = useCallback(() => setEodOpen(false), [])

  // Home's empty-state CTA and the command palette route here as /meetings?new=1.
  // Without this the user lands on an empty board and nothing opens. Strip the flag
  // afterwards so a refresh or back-nav doesn't re-open the create modal.
  // The modal opens during render (the flag is URL state); the effect strips it.
  const newFlag = searchParams.get('new') === '1'
  const [newSeen, setNewSeen] = useState(false)
  if (newFlag !== newSeen) {
    setNewSeen(newFlag)
    // A view-only member following the link got an empty "Meeting details" dialog.
    if (newFlag && canEdit) setModal({ mode: 'create', startsAt: new Date().toISOString() })
  }
  useEffect(() => {
    if (!newFlag) return
    const next = new URLSearchParams(searchParams)
    next.delete('new')
    setSearchParams(next, { replace: true })
  }, [newFlag, searchParams, setSearchParams])

  // /meetings?event=<id> — a search result opens that meeting and shows the
  // week that holds it (the next occurrence when it repeats). Kept until the
  // store has the events, then stripped so a reload does not reopen the dialog.
  const eventFlag = hydrated ? searchParams.get('event') : null
  const [eventSeen, setEventSeen] = useState<string | null>(null)
  if (eventFlag !== eventSeen) {
    setEventSeen(eventFlag)
    const found = eventFlag ? events.find((e) => e.id === eventFlag && e.kind === 'meeting') : undefined
    if (found) {
      const today = startOfDay(new Date())
      const nextOcc = getEventOccurrences([found], today, addDays(today, 366))[0]
      const day = startOfDay(new Date(nextOcc?.startsAt ?? found.startsAt))
      setWeekOffset(Math.floor(differenceInCalendarDays(day, today) / 7))
      setModal({ mode: 'edit', event: found })
    }
  }
  useEffect(() => {
    if (!eventFlag) return
    const next = new URLSearchParams(searchParams)
    next.delete('event')
    setSearchParams(next, { replace: true })
    if (!events.some((e) => e.id === eventFlag && e.kind === 'meeting')) toast.error('That meeting no longer exists')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventFlag])

  const clientById = useMemo(
    () => new Map(clients.map((c) => [c.id, c])),
    [clients],
  )

  const meetings = useMemo(
    () =>
      events.filter(
        (e) => e.kind === 'meeting' && (!clientFilter || e.clientId === clientFilter),
      ),
    [events, clientFilter],
  )

  // ─── 7-day board range ─────────────────────────────────────────────────────
  const baseDay = useMemo(
    () => addDays(startOfDay(new Date()), weekOffset * 7),
    [weekOffset],
  )
  const days = useMemo(() => [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(baseDay, i)), [baseDay])

  const columns: KanbanColumn[] = useMemo(
    () =>
      days.map((day, i) => ({
        key: isoDate(day),
        title:
          weekOffset === 0 && i === 0
            ? 'Today'
            : weekOffset === 0 && i === 1
              ? 'Tomorrow'
              : format(day, 'EEE d MMM'),
        accent: weekOffset === 0 && i === 0 ? 'bg-brand-500' : undefined,
      })),
    [days, weekOffset],
  )

  const items: MeetingCard[] = useMemo(() => {
    const rangeEnd = new Date(addDays(baseDay, 7).getTime() - 1)
    return getEventOccurrences(meetings, baseDay, rangeEnd).map((occ) => ({
      id: occ.occurrenceId,
      occ,
    }))
  }, [meetings, baseDay])

  // A meeting in progress carries the live dot; the first one also breathes.
  const now = useNow()
  const breatheId = firstLiveId(items.map((it) => it.occ), now)

  // ─── Past 7 days (for EOD note review) ─────────────────────────────────────
  const pastMeetings = useMemo(() => {
    const todayStart = startOfDay(new Date())
    const now = new Date()
    return getEventOccurrences(meetings, addDays(todayStart, -7), now)
      .filter((occ) => new Date(occ.startsAt) < now)
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
  }, [meetings])

  const weekLabel =
    weekOffset === 0
      ? 'This week'
      : weekOffset === 1
        ? 'Next week'
        : weekOffset === -1
          ? 'Last week'
          : `${format(baseDay, 'd MMM')} – ${format(days[6], 'd MMM')}`

  const reschedule = (item: MeetingCard, toKey: string) => {
    if (!canEdit) {
      toast.error('View-only access')
      return
    }
    const { event, startsAt, endsAt } = item.occ
    if (event.recurrence !== 'none') {
      toast.error('Recurring meeting — edit the series instead')
      return
    }
    const [y, m, d] = toKey.split('-').map(Number)
    const oldStart = new Date(startsAt)
    const newStart = new Date(oldStart)
    newStart.setFullYear(y, m - 1, d)
    const duration = endsAt ? new Date(endsAt).getTime() - oldStart.getTime() : 0
    updateEvent(event.id, {
      startsAt: newStart.toISOString(),
      endsAt: endsAt ? new Date(newStart.getTime() + duration).toISOString() : undefined,
    })
    toast.success('Meeting rescheduled')
  }

  const newMeetingAt = (dayKey: string) => {
    const [y, m, d] = dayKey.split('-').map(Number)
    setModal({ mode: 'create', startsAt: new Date(y, m - 1, d, 9, 0).toISOString() })
  }

  // "New meeting" books into the week on screen: now on this week, 9:00 on the
  // first day of any other.
  const newMeeting = () => {
    if (weekOffset === 0) setModal({ mode: 'create', startsAt: new Date().toISOString() })
    else newMeetingAt(isoDate(baseDay))
  }

  const emptyTitle =
    weekOffset === 0
      ? 'Nothing scheduled this week'
      : Math.abs(weekOffset) === 1
        ? `Nothing scheduled ${weekLabel.toLowerCase()}`
        : `Nothing scheduled for ${weekLabel}`

  const renderCard = (item: MeetingCard) => {
    const { event, startsAt, endsAt } = item.occ
    const client = event.clientId ? clientById.get(event.clientId) : undefined
    const hasNotes = Boolean(event.notes?.trim())
    const live = isLiveMeeting(item.occ, now)
    const joinHref = webHref(event.meetingLink)
    return (
      <div data-item-kind="meeting" data-item-id={event.id} data-item-label={event.title} className="space-y-1.5">
        {/* pr-8: the corner "Move to…" chip sits over the end of this line. */}
        <div className={classNames('flex items-center gap-1.5 text-[11px] font-medium text-ink-300', canEdit && 'pr-8')}>
          {live ? (
            <StatusDot tone="live" size="xs" breathe={item.id === breatheId} label="In progress" />
          ) : (
            event.color && (
              <span
                className="size-2 rounded-full shrink-0"
                style={{ backgroundColor: displayColor(event.color) }}
                aria-hidden
              />
            )
          )}
          {/* The range stays on one line: the columns have a floor wide enough
              for the longest one ("11:30 AM – 12:30 PM"). */}
          <span
            className="whitespace-nowrap tabular-nums"
            title={`${fmtTime(startsAt)}${endsAt ? ` – ${fmtTime(endsAt)}` : ''}`}
          >
            {(() => {
              const { start, end } = fmtTimeRangeParts(startsAt, endsAt)
              return (
                <>
                  <span className="whitespace-nowrap">{start}</span>
                  {end && (
                    <>
                      {' – '}
                      <span className="whitespace-nowrap">{end}</span>
                    </>
                  )}
                </>
              )
            })()}
          </span>
          {event.recurrence !== 'none' && (
            <RepeatIcon size={12} className="shrink-0 text-ink-300" aria-label="Recurring" />
          )}
        </div>
        {joinHref && (
          <a href={joinHref} target="_blank" rel="noopener noreferrer" className="btn-secondary text-xs min-h-9"
            aria-label={`Join meeting: ${event.title}`} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <VideoCameraIcon size={14} aria-hidden /> Join meeting
          </a>
        )}
        <div className="text-sm font-medium text-ink-50 leading-snug line-clamp-3 [overflow-wrap:anywhere]" title={event.title}>
          {event.title}
        </div>
        {(client || event.location || event.meetingLink || hasNotes) && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {client && (
              <span className="badge badge-info block max-w-full truncate" title={client.name}>
                {client.name}
              </span>
            )}
            {event.location && <MapPinIcon size={12} className="shrink-0 text-ink-300" aria-label="Location" />}
            {event.meetingLink && (
              <VideoCameraIcon size={12} className="shrink-0 text-ink-300" aria-label="Meeting link" />
            )}
            {hasNotes && (
              <FileTextIcon size={12} className="shrink-0 text-emerald-700 dark:text-emerald-400" aria-label="Has notes" />
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <Layout title="Meetings" subtitle={subtitle}>
      <div className="space-y-6">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="block w-full sm:w-56 pointer-coarse:[&_select]:min-h-11">
            <span className="sr-only">Filter by client</span>
            <ClientSelect value={clientFilter} onChange={setClientFilter} allowAll />
          </label>

          {/* Phones: the week stepper is its own row, label centred between the
              arrows; the actions share the row below. */}
          <div className="flex items-center gap-0.5 max-sm:w-full max-sm:justify-between">
            <button
              className="btn-ghost tap-target size-[38px] p-0"
              aria-label="Previous week"
              onClick={() => setWeekOffset((w) => w - 1)}
            >
              <CaretLeftIcon size={16} aria-hidden />
            </button>
            <button
              className={classNames(
                'btn-ghost min-w-30 justify-center text-sm tabular-nums pointer-coarse:min-h-11',
                weekOffset !== 0 && 'text-brand-700 dark:text-brand-400',
              )}
              title={weekOffset === 0 ? 'Showing the next 7 days' : 'Back to this week'}
              // On another week the label names that week (the same words as an
              // arrow beside it) while the button goes back: say both.
              aria-label={weekOffset === 0 ? undefined : `${weekLabel}. Back to this week`}
              onClick={() => setWeekOffset(0)}
            >
              {weekLabel}
            </button>
            <button
              className="btn-ghost tap-target size-[38px] p-0"
              aria-label="Next week"
              onClick={() => setWeekOffset((w) => w + 1)}
            >
              <CaretRightIcon size={16} aria-hidden />
            </button>
          </div>

          <div className="ml-auto flex items-center gap-2 max-sm:w-full">
            <button className="btn-ghost max-sm:btn-secondary" aria-label="EOD Report" onClick={() => setEodOpen(true)}>
              <ScrollIcon size={14} aria-hidden />
              <span>EOD<span className="max-sm:hidden"> Report</span></span>
            </button>
            {canEdit && (
              <button className="btn-primary max-sm:flex-1" onClick={newMeeting}>
                <PlusIcon size={14} aria-hidden />
                New meeting
              </button>
            )}
          </div>
        </div>

        {/* Board — 7 day columns */}
        {!hydrated ? (
          <SkeletonBoard columns={columns} cards={2} />
        ) : items.length === 0 ? (
          // Previously this rendered 7 columns of "Drop … here" placeholders, which reads
          // as a broken board rather than as "nothing scheduled".
          <EmptyState
            glyph="meetings"
            title={clientFilter ? 'No meetings for this client' : emptyTitle}
            description={
              clientFilter
                ? 'Clear the client filter, or jump to another week.'
                : 'Book a meeting and it will land on the day it belongs to.'
            }
            action={
              canEdit ? (
                <button className="btn-primary" onClick={newMeeting}>
                  <PlusIcon size={14} aria-hidden />
                  New meeting
                </button>
              ) : undefined
            }
          />
        ) : (
        <KanbanBoard
          canMove={canEdit}
          itemNoun="meetings"
          staggerKey="meetings"
          // Seven equal columns were ~138px at 1440: times wrapped and titles ran to
          // three lines. A floor keeps each card readable; the week scrolls sideways.
          minColumnWidth={220}
          moveControl="corner"
          getCardLabel={(item) => `Open meeting: ${item.occ.event.title}`}
          columns={columns}
          items={items}
          getColumn={(item) => isoDate(item.occ.startsAt)}
          renderCard={renderCard}
          onMove={reschedule}
          onCardClick={(item) => setModal({ mode: 'edit', event: item.occ.event })}
          // Every day gets the same footer, so the columns end on one line. It
          // used to show on empty days only, which left a bare ruled strip
          // under the busy ones (and under every column for view-only members).
          columnFooter={canEdit ? (key) => (
              <button
                type="button"
                className="pressable w-full text-[11px] font-medium text-ink-300 hover:text-ink-50 py-1.5 pointer-coarse:min-h-11 rounded-md hover:bg-ink-700/70 flex items-center justify-center gap-1 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500"
                aria-label={`Add a meeting on ${format(new Date(`${key}T00:00:00`), 'EEEE, MMMM d')}`}
                onClick={() => newMeetingAt(key)}
              >
                <PlusIcon size={12} aria-hidden />
                meeting
              </button>
            ) : undefined}
        />
        )}

        {/* Past 7 days — review notes for EOD. Only when there is something to
            review: an expandable row that opens onto nothing is noise. */}
        {pastMeetings.length > 0 && (
        <section className="card overflow-hidden">
          <button
            type="button"
            aria-expanded={pastOpen}
            aria-controls="meetings-past"
            className="w-full flex items-center gap-2.5 px-4 py-3 pointer-coarse:min-h-12 text-left hover:bg-ink-700/40 transition-colors duration-150 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 select-none"
            onClick={() => setPastOpen((v) => !v)}
          >
            <span className="section-title">Past 7 days</span>
            <span className="text-[11px] font-semibold tabular-nums min-w-5 text-center px-1.5 py-px rounded-sm bg-ink-700 text-ink-100">
              {pastMeetings.length}
            </span>
            <span className="text-xs text-ink-300 hidden sm:inline">
              review meeting notes for EOD reports
            </span>
            {/* One caret that turns (state indication), not two icons swapping. */}
            <CaretDownIcon
              size={16}
              className={classNames(
                'ml-auto shrink-0 text-ink-300 transition-transform duration-200 ease-out motion-reduce:transition-none [html[data-input=keyboard]_&]:transition-none',
                pastOpen && 'rotate-180',
              )}
              aria-hidden
            />
          </button>

          {pastOpen && (
            <div id="meetings-past" className="animate-fade [html[data-input=keyboard]_&]:animate-none border-t border-ink-600 divide-y divide-ink-600">
              {pastMeetings.map((occ) => {
                const client = occ.event.clientId
                  ? clientById.get(occ.event.clientId)
                  : undefined
                const hasNotes = Boolean(occ.event.notes?.trim())
                return (
                  <button
                    type="button"
                    key={occ.occurrenceId}
                    className="pressable-card w-full grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[10rem_minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-0.5 px-4 py-2.5 pointer-coarse:py-3 text-left hover:bg-ink-700/40 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
                    onClick={() => setModal({ mode: 'edit', event: occ.event })}
                  >
                    <div className="whitespace-nowrap tabular-nums text-xs text-ink-300 max-sm:col-span-2 max-sm:order-first">
                      {fmtDate(occ.startsAt)} · {fmtTime(occ.startsAt)}
                    </div>
                    <div className="min-w-0 text-sm text-ink-50 truncate" title={occ.event.title}>
                      {occ.event.title}
                    </div>
                    {client && (
                      <span className="badge badge-info hidden sm:block max-w-48 truncate" title={client.name}>
                        {client.name}
                      </span>
                    )}
                    {!client && <span className="hidden sm:block" aria-hidden />}
                    {hasNotes ? (
                      <span className="badge badge-success">
                        <FileTextIcon size={10} aria-hidden />
                        Notes
                      </span>
                    ) : (
                      <span className="badge badge-neutral">No notes</span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </section>
        )}
      </div>

      <MeetingModal state={modal} onClose={closeModal} readOnly={!canEdit} />
      <EodReportModal
        open={eodOpen}
        onClose={closeEod}
        defaultClientId={clientFilter || undefined}
      />
    </Layout>
  )
}
