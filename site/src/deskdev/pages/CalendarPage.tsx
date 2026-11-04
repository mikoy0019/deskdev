import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  addDays, addMonths, addWeeks, endOfDay, endOfMonth, endOfWeek, format,
  startOfDay, startOfMonth, startOfWeek,
} from 'date-fns'
import { CaretLeftIcon, CaretRightIcon, PlusIcon } from '@phosphor-icons/react'
import Layout from '../components/Layout'
import MonthGrid from '../components/calendar/MonthGrid'
import WeekView from '../components/calendar/WeekView'
import DayView from '../components/calendar/DayView'
import EventFormModal, { type TeamCalendarState } from '../components/calendar/EventFormModal'
import EventDetailModal from '../components/calendar/EventDetailModal'
import { CalendarSkeleton } from '../components/calendar/calendarShared'
import { IndicatorGroup, LayoutIndicator, StatusDot } from '../components/motion'
import {
  useStore, useCurrentUser, getEventOccurrences, type EventOccurrence,
} from '../store/useStore'
import { can, isAdmin } from '../lib/permissions'
import { getWorkspaceCalendarStatus, isGoogleAvailable } from '../lib/google'
import { classNames, isoDate } from '../lib/format'
import type { EventItem } from '../lib/types'
import { useIsPhone } from '../pwa/useMediaQuery'

type CalView = 'month' | 'week' | 'day'

const VIEWS: [CalView, string][] = [
  ['month', 'Month'],
  ['week', 'Week'],
  ['day', 'Day'],
]

const ICON_BTN =
  'pressable tap-target inline-flex items-center justify-center size-[38px] rounded-md text-ink-200 hover:text-ink-50 hover:bg-ink-700 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500'

export default function CalendarPage() {
  const events = useStore((s) => s.events)
  const hydrated = useStore((s) => s.hydrated)
  const user = useCurrentUser()

  const canEvents = can(user, 'calendar', 'edit')
  const canMeetings = can(user, 'meetings', 'edit')
  const canCreate = canEvents || canMeetings
  // A member who may only book meetings gets the meeting form: name it so.
  const createLabel = !canEvents && canMeetings ? 'New meeting' : 'New event'
  const admin = isAdmin(user)

  // The shared Google calendar, as far as this person may know: connected,
  // not connected, access withdrawn, or unavailable (local mode, 040 not
  // applied, the status call failed). Unavailable is a state of its own so the
  // form never promises a Google invitation nothing will send. Undefined only
  // before the answer.
  const [teamCalendar, setTeamCalendar] = useState<TeamCalendarState | undefined>(
    isGoogleAvailable ? undefined : 'unavailable',
  )
  useEffect(() => {
    if (!isGoogleAvailable) return
    let cancelled = false
    void getWorkspaceCalendarStatus().then((res) => {
      if (cancelled) return
      if (!res.ok || !res.data) {
        setTeamCalendar('unavailable')
        return
      }
      const s = res.data.status
      setTeamCalendar(s === 'active' || s === 'revoked' ? s : 'disconnected')
    })
    return () => {
      cancelled = true
    }
  }, [])

  // The view lives in the URL (?view=week|day; Month is the bare path), so a
  // reload or a shared link opens the same view.
  const [searchParams, setSearchParams] = useSearchParams()
  const viewParam = searchParams.get('view')
  const view: CalView = viewParam === 'week' || viewParam === 'day' ? viewParam : 'month'
  const setView = (v: CalView) => {
    const next = new URLSearchParams(searchParams)
    if (v === 'month') next.delete('view')
    else next.set('view', v)
    setSearchParams(next, { replace: true })
  }
  const [cursor, setCursor] = useState(() => new Date())
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<EventItem | null>(null)
  const [createDate, setCreateDate] = useState<string | undefined>()
  // The occurrence stays set while the detail dialog plays its exit; `open`
  // is what closes it.
  const [detail, setDetail] = useState<EventOccurrence | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  // The week grid is 840px of seven columns — on a phone, a sideways scroll of
  // slivers. Phones get Month and Day only; a chosen Week reads as that day and
  // comes back on its own when the screen is wide again.
  const isPhone = useIsPhone()
  const activeView: CalView = isPhone && view === 'week' ? 'day' : view
  const views = isPhone ? VIEWS.filter(([v]) => v !== 'week') : VIEWS

  const range = useMemo(() => {
    if (activeView === 'month') {
      return {
        start: startOfWeek(startOfMonth(cursor)),
        end: endOfWeek(endOfMonth(cursor)),
      }
    }
    if (activeView === 'week') {
      return { start: startOfWeek(cursor), end: endOfWeek(cursor) }
    }
    return { start: startOfDay(cursor), end: endOfDay(cursor) }
  }, [activeView, cursor])

  const occurrences = useMemo(
    () => getEventOccurrences(events, range.start, range.end),
    [events, range],
  )

  const label = useMemo(() => {
    if (activeView === 'month') return format(cursor, 'MMMM yyyy')
    if (activeView === 'week') {
      return `${format(range.start, 'MMM d')} – ${format(range.end, 'MMM d, yyyy')}`
    }
    // Short form on phones so the label shares a row with the arrows.
    return format(cursor, isPhone ? 'EEE, MMM d, yyyy' : 'EEEE, MMMM d, yyyy')
  }, [activeView, cursor, range, isPhone])

  const step = (dir: 1 | -1) => {
    setCursor((c) => {
      if (activeView === 'month') return addMonths(c, dir)
      if (activeView === 'week') return addWeeks(c, dir)
      return addDays(c, dir)
    })
  }

  const openCreate = (day?: Date) => {
    setEditing(null)
    setCreateDate(day ? isoDate(day) : isoDate(cursor))
    setFormOpen(true)
  }

  const showDay = (day: Date) => {
    setCursor(day)
    setView('day')
  }

  const openDetail = (occ: EventOccurrence) => {
    setDetail(occ)
    setDetailOpen(true)
  }

  // /calendar?event=<id> — a search result opens that event (its next
  // occurrence when it repeats) and shows its day. Kept until the store has
  // the events, then stripped so a reload does not reopen the dialog.
  const eventFlag = hydrated ? searchParams.get('event') : null
  const [eventSeen, setEventSeen] = useState<string | null>(null)
  if (eventFlag !== eventSeen) {
    setEventSeen(eventFlag)
    const found = eventFlag ? events.find((e) => e.id === eventFlag) : undefined
    if (found) {
      const today = startOfDay(new Date())
      const occ = getEventOccurrences([found], today, addDays(today, 366))[0] ?? {
        event: found,
        startsAt: found.startsAt,
        endsAt: found.endsAt,
        occurrenceId: `${found.id}:${isoDate(new Date(found.startsAt))}`,
      }
      setCursor(new Date(occ.startsAt))
      setDetail(occ)
      setDetailOpen(true)
    }
  }
  useEffect(() => {
    if (!eventFlag) return
    const next = new URLSearchParams(searchParams)
    next.delete('event')
    setSearchParams(next, { replace: true })
    if (!events.some((e) => e.id === eventFlag)) toast.error('That event no longer exists')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventFlag])

  return (
    <Layout title="Calendar" subtitle="Events & schedule">
      <div className="space-y-4">
        {/* Toolbar — where you are (period + arrows) on the left; how you look
            at it (view) and what you can do (New event) on the right. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="flex min-w-0 flex-1 basis-[18rem] items-center gap-2">
            <button
              type="button"
              className="btn-secondary pointer-coarse:min-h-11"
              onClick={() => setCursor(new Date())}
            >
              Today
            </button>
            <div className="flex items-center">
              <button type="button" className={ICON_BTN} aria-label="Previous" onClick={() => step(-1)}>
                <CaretLeftIcon size={16} aria-hidden />
              </button>
              <button type="button" className={ICON_BTN} aria-label="Next" onClick={() => step(1)}>
                <CaretRightIcon size={16} aria-hidden />
              </button>
            </div>
            <h2
              className="min-w-0 truncate text-display text-lg sm:text-xl font-semibold text-ink-50 tabular-nums"
              aria-live="polite"
            >
              {label}
            </h2>
          </div>

          <div className="flex items-center gap-2 max-sm:w-full">
            <IndicatorGroup id="calendar-view">
              <div
                className="flex rounded-lg bg-ink-700/70 border border-ink-600 p-0.5"
                role="group"
                aria-label="Calendar view"
              >
                {views.map(([v, name]) => {
                  const active = activeView === v
                  return (
                    <button
                      type="button"
                      key={v}
                      aria-pressed={active}
                      className={classNames(
                        'pressable relative px-3.5 py-1.5 pointer-coarse:min-h-11 pointer-coarse:px-4 rounded-md text-xs font-medium focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500',
                        active ? 'text-ink-50' : 'text-ink-300 hover:text-ink-50',
                      )}
                      onClick={() => setView(v)}
                    >
                      {active && (
                        <LayoutIndicator
                          layoutId="calendar-view"
                          radius={6}
                          className="absolute inset-0 bg-ink-800 border border-ink-600 shadow-(--shadow-1)"
                        />
                      )}
                      <span className="relative">{name}</span>
                    </button>
                  )
                })}
              </div>
            </IndicatorGroup>

            {canCreate && (
              <button type="button" className="btn-primary ml-auto" onClick={() => openCreate()}>
                <PlusIcon size={14} aria-hidden />
                {createLabel}
              </button>
            )}
          </div>
        </div>

        {/* Active view */}
        {!hydrated && events.length === 0 ? (
          <CalendarSkeleton view={activeView} />
        ) : (
          <>
            {activeView === 'month' && (
              <MonthGrid
                cursor={cursor}
                occurrences={occurrences}
                canCreate={canCreate}
                onDayClick={openCreate}
                onOccurrenceClick={openDetail}
                onShowMore={showDay}
              />
            )}
            {activeView === 'week' && (
              <WeekView
                cursor={cursor}
                occurrences={occurrences}
                canCreate={canCreate}
                onDayClick={openCreate}
                onOccurrenceClick={openDetail}
              />
            )}
            {activeView === 'day' && (
              <DayView
                day={cursor}
                occurrences={occurrences}
                onOccurrenceClick={openDetail}
                canCreate={canCreate}
                onCreate={() => openCreate()}
                createLabel={createLabel}
              />
            )}
          </>
        )}

        {/* One quiet line under the grid: where synced events go, and whether they are going. */}
        {teamCalendar && teamCalendar !== 'unavailable' && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-300" role="status">
            <StatusDot tone={teamCalendar === 'active' ? 'online' : teamCalendar === 'revoked' ? 'away' : 'offline'} size="xs" />
            {teamCalendar === 'active' && 'Team calendar connected. Events with sync on are sent to Google.'}
            {teamCalendar === 'revoked' && 'Team calendar is not syncing: Google withdrew access. Changes are kept and sent after an admin reconnects.'}
            {teamCalendar === 'disconnected' && 'Team calendar is not connected. Events stay in DeskDev.'}
            {admin && teamCalendar !== 'active' && (
              <Link
                to="/settings?section=integrations"
                className="font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-400"
              >
                {teamCalendar === 'revoked' ? 'Reconnect' : 'Connect'}
              </Link>
            )}
          </p>
        )}
      </div>

      <EventFormModal
        open={formOpen}
        // Only `open` flips: the title and fields hold still while it leaves.
        onClose={() => setFormOpen(false)}
        initial={editing}
        defaultDate={createDate}
        teamCalendar={teamCalendar}
      />

      {detail && (
        <EventDetailModal
          key={detail.occurrenceId}
          open={detailOpen}
          occurrence={detail}
          onClose={() => setDetailOpen(false)}
          teamCalendar={teamCalendar}
          onEdit={(e) => {
            setDetailOpen(false)
            setEditing(e)
            setFormOpen(true)
          }}
        />
      )}
    </Layout>
  )
}
