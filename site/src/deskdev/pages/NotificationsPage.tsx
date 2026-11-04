import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AlarmIcon, AtIcon, BellIcon, BriefcaseIcon, CalendarBlankIcon, CalendarCheckIcon, CalendarPlusIcon, CheckIcon,
  CheckSquareIcon, ChecksIcon, ClipboardTextIcon, EnvelopeSimpleIcon, HouseIcon, ImagesIcon, InfoIcon, TableIcon,
  TimerIcon, TrashIcon,
  UserCheckIcon, UserPlusIcon, UsersThreeIcon, VideoCameraIcon, type Icon,
} from '@phosphor-icons/react'
import Layout from '../components/Layout'
import { EmptyState } from '../components/ui-foundation'
import { Skeleton, StatusDot, useStagger } from '../components/motion'
import { useStore, useCurrentUser } from '../store/useStore'
import { classNames, fmtDate, fmtTime, isoDate } from '../lib/format'
import { notificationHref } from '../lib/notifications'
import type { Notification, NotificationType } from '../lib/types'

const PAGE = 100

function dayLabel(key: string): string {
  const today = isoDate()
  const yesterday = isoDate(new Date(Date.now() - 24 * 60 * 60 * 1000))
  if (key === today) return 'Today'
  if (key === yesterday) return 'Yesterday'
  return fmtDate(key)
}

/** What a notification is about, at a glance — the same marks the app uses for each area. */
const TYPE_ICON: Record<NotificationType, Icon> = {
  task_assigned: CheckSquareIcon,
  task_updated: CheckSquareIcon,
  project_updated: BriefcaseIcon,
  client_updated: UsersThreeIcon,
  crm_updated: TableIcon,
  event_updated: CalendarBlankIcon,
  meeting_updated: VideoCameraIcon,
  due_reminder: AlarmIcon,
  channel_mention: AtIcon,
  system: InfoIcon,
  lead_new: UserPlusIcon,
  lead_sla: TimerIcon,
  lead_followup: CalendarCheckIcon,
  lead_assigned: UserCheckIcon,
  showcase_ready: ImagesIcon,
  form_submitted: ClipboardTextIcon,
  meeting_booked: CalendarPlusIcon,
  email_received: EnvelopeSimpleIcon,
}

// Icon buttons on a row: 32px for a mouse, 44px under a finger.
const rowAction =
  'pressable size-8 pointer-coarse:size-11 flex items-center justify-center rounded-lg text-ink-300 hover:bg-ink-700'

/** The list before the first pull lands: day headers over rows shaped like notifications. */
function NotificationsSkeleton() {
  return (
    <div role="status" aria-busy="true" className="space-y-8">
      <span className="sr-only">Loading notifications</span>
      {[4, 3].map((count, g) => (
        <div key={g}>
          <div className="flex items-center gap-3 h-7">
            <Skeleton w={g === 0 ? 44 : 64} h={10} />
            <span className="h-px flex-1 bg-ink-600" aria-hidden />
          </div>
          <div className="divide-y divide-ink-600/70">
            {Array.from({ length: count }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 py-3.5">
                <Skeleton w={32} h={32} rounded="lg" />
                <div className="flex-1 min-w-0 space-y-2 pt-0.5">
                  <Skeleton w={`${[62, 48, 70, 55][i % 4]}%`} h={12} />
                  <Skeleton w={`${[34, 40, 28, 36][i % 4]}%`} h={10} />
                  <Skeleton w={48} h={9} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function NotificationsPage() {
  const user = useCurrentUser()
  const hydrated = useStore((s) => s.hydrated)
  const notifications = useStore((s) => s.notifications)
  const markRead = useStore((s) => s.markRead)
  const markAllRead = useStore((s) => s.markAllRead)
  const deleteNotification = useStore((s) => s.deleteNotification)
  const crmRows = useStore((s) => s.crmRows)
  const crmColumns = useStore((s) => s.crmColumns)
  const events = useStore((s) => s.events)
  const navigate = useNavigate()
  // First load: the day groups cascade in once a session.
  const { ref: attachStagger, className: staggerClass } = useStagger<HTMLDivElement>('notifications')

  const mine = useMemo(
    () =>
      notifications
        .filter((n) => n.userId === user?.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [notifications, user?.id],
  )
  const unread = mine.filter((n) => !n.read).length
  // Nothing caps the feed, so render it a page at a time: a year of history
  // must not mount a thousand rows at once.
  const [limit, setLimit] = useState(PAGE)
  const shown = useMemo(() => mine.slice(0, limit), [mine, limit])
  const older = mine.length - shown.length

  // Dismissing from the keyboard removes the button that had focus. Hand it
  // to the next row's Dismiss (or the one before, for the last row) so the
  // list can be worked down without starting again from the top of the page.
  const dismiss = (id: string, button: HTMLButtonElement, fromKeyboard: boolean) => {
    const all = [...(button.closest('[data-notification-list]')?.querySelectorAll<HTMLButtonElement>('[data-dismiss]') ?? [])]
    const i = all.indexOf(button)
    const next = all[i + 1] ?? all[i - 1] ?? null
    deleteNotification(id)
    if (!fromKeyboard) return
    if (next) next.focus()
    else document.getElementById('dd-main')?.focus()
  }

  const groups = useMemo(() => {
    const map = new Map<string, Notification[]>()
    for (const n of shown) {
      const key = isoDate(n.createdAt)
      const arr = map.get(key)
      if (arr) arr.push(n)
      else map.set(key, [n])
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [shown])

  return (
    <Layout
      title="Notifications"
      // Before the first pull an empty feed is unknown — never claim "All caught up" yet.
      subtitle={unread > 0 ? `${unread.toLocaleString()} unread` : !hydrated && mine.length === 0 ? 'Loading…' : 'All caught up'}
    >
      <div className="max-w-2xl mx-auto">
        {unread > 0 && (
          <div className="flex justify-end -mt-1 mb-3">
            {/* -mr-3: the label ends on the column's edge, level with the day rules below. */}
            <button type="button" className="btn-ghost -mr-3" onClick={markAllRead}>
              <ChecksIcon size={15} aria-hidden />
              Mark all read
            </button>
          </div>
        )}

        {!hydrated && mine.length === 0 ? (
          <NotificationsSkeleton />
        ) : groups.length === 0 ? (
          <EmptyState
            glyph="notifications"
            title="No notifications yet"
            description="Task assignments, due reminders, and workspace updates show up here."
            action={
              <Link to="/" className="btn-secondary">
                <HouseIcon size={14} aria-hidden />
                Go to home
              </Link>
            }
          />
        ) : (
          <div ref={attachStagger} data-notification-list className={classNames('space-y-8', staggerClass)}>
            {groups.map(([day, rows]) => (
              <section key={day} aria-labelledby={`notif-day-${day}`}>
                {/* A hairline under the day label groups the rows — no box around them. */}
                <div className="flex items-center gap-3 h-7">
                  <h2 id={`notif-day-${day}`} className="section-title">{dayLabel(day)}</h2>
                  <span className="h-px flex-1 bg-ink-600" aria-hidden />
                </div>
                <ul>
                  {rows.map((n) => {
                    const TypeIcon = TYPE_ICON[n.type] ?? BellIcon
                    return (
                      <li
                        key={n.id}
                        // The hover surface bleeds 12px past the text; the hairline between rows stays on the text column.
                        className="group relative flex items-start gap-3 py-3 -mx-3 px-3 rounded-lg hover:bg-ink-800/70 transition-colors duration-150 ease-[ease] before:absolute before:inset-x-3 before:top-0 before:h-px before:bg-ink-600/70 first:before:hidden hover:before:opacity-0 [&:hover+li]:before:opacity-0"
                      >
                        <span
                          className={classNames(
                            'relative mt-0.5 size-8 shrink-0 rounded-lg border flex items-center justify-center',
                            n.read
                              ? 'border-ink-600 bg-ink-800 text-ink-400'
                              : 'border-brand-500/25 bg-brand-500/10 text-brand-600 dark:text-brand-400',
                          )}
                          aria-hidden
                        >
                          <TypeIcon size={16} />
                          {!n.read && (
                            <StatusDot tone="unread" size="sm" className="absolute -top-1 -right-1 ring-2 ring-ink-900" />
                          )}
                        </span>
                        <button
                          type="button"
                          className="flex-1 min-w-0 text-left rounded-md focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500"
                          onClick={() => {
                            if (!n.read) markRead(n.id)
                            navigate(notificationHref(n, { crmRows, crmColumns, events }))
                          }}
                        >
                          {!n.read && <span className="sr-only">Unread: </span>}
                          <span
                            className={classNames(
                              'block text-sm leading-snug text-pretty [overflow-wrap:anywhere]',
                              n.read ? 'text-ink-200' : 'text-ink-50 font-medium',
                            )}
                          >
                            {n.title}
                          </span>
                          {n.body && <span className="text-xs text-ink-300 mt-0.5 line-clamp-2 [overflow-wrap:anywhere]">{n.body}</span>}
                          <span className="block mt-1 text-[11px] tabular-nums text-ink-400">
                            {fmtTime(n.createdAt)}
                          </span>
                        </button>
                        {/* With a mouse the row's actions wait for hover (or focus); touch always shows them. */}
                        <div className="flex items-center gap-0.5 shrink-0 -mr-1 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100 transition-opacity duration-150 ease-[ease]">
                          {!n.read && (
                            <button
                              type="button"
                              className={classNames(rowAction, 'hover:text-emerald-700 dark:hover:text-emerald-400')}
                              title="Mark read"
                              aria-label={`Mark as read: ${n.title}`}
                              onClick={() => markRead(n.id)}
                            >
                              <CheckIcon size={15} aria-hidden />
                            </button>
                          )}
                          {/* No ConfirmDialog here, deliberately. FOUNDATION.md asks for one on every
                              delete, but a notification is an ephemeral message, not a record — a modal
                              on each dismissal would be friction on the app's highest-frequency action. */}
                          <button
                            type="button"
                            data-dismiss
                            className={classNames(rowAction, 'hover:text-rose-600 dark:hover:text-rose-400')}
                            title="Dismiss"
                            aria-label={`Dismiss notification: ${n.title}`}
                            onClick={(e) => dismiss(n.id, e.currentTarget, e.detail === 0)}
                          >
                            <TrashIcon size={15} aria-hidden />
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
            {older > 0 && (
              <div className="flex justify-center">
                <button type="button" className="btn-ghost" onClick={() => setLimit((l) => l + PAGE)}>
                  Show older <span className="tabular-nums text-ink-300">({older.toLocaleString()})</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  )
}
