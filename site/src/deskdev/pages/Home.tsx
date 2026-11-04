import { useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { format, startOfDay, endOfDay } from 'date-fns'
import {
  ArrowRightIcon, BellIcon, CalendarDotIcon, CalendarPlusIcon, ClockIcon, KanbanIcon,
  ListChecksIcon, MapPinIcon, VideoCameraIcon,
} from '@phosphor-icons/react'
import Layout from '../components/Layout'
import StatCard, { StatStrip } from '../components/StatCard'
import EmptyState from '../components/EmptyState'
import Avatar from '../components/Avatar'
import SetupGuide from '../components/home/SetupGuide'
import { PriorityChip, RoleChip } from '../components/Chips'
import { SkeletonLine, SkeletonBlock } from '../components/ui-foundation'
import { AnimatedNumber, StatusDot, useStagger } from '../components/motion'
import { useNow } from '../components/growth/shared'
import { useStore, useCurrentUser, getEventOccurrences } from '../store/useStore'
import { can } from '../lib/permissions'
import { classNames, fmtMinutes, fmtRelative, fmtTime, fmtDate, isoDate } from '../lib/format'
import { webHref } from '../lib/links'
import type { Task, TaskActivity, TaskStatus, User } from '../lib/types'

const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  done: 'Done',
}

function greetingWord(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function activitySentence(a: TaskActivity, tasks: Task[], users: User[]): string {
  const detailTitle = typeof a.detail.title === 'string' ? a.detail.title : undefined
  const title =
    detailTitle ??
    tasks.find((t) => t.id === a.taskId)?.title ??
    'a task'
  switch (a.action) {
    case 'created':
      return `created task "${title}"`
    case 'completed':
      return `completed "${title}"`
    case 'deleted':
      return `deleted task "${title}"`
    case 'assigned': {
      const assigneeId =
        typeof a.detail.assigneeId === 'string' ? a.detail.assigneeId : undefined
      const assignee = users.find((u) => u.id === assigneeId)?.fullName
      return assignee ? `assigned "${title}" to ${assignee}` : `unassigned "${title}"`
    }
    case 'status_changed': {
      const to = typeof a.detail.to === 'string' ? a.detail.to : undefined
      const label = to && to in TASK_STATUS_LABEL ? TASK_STATUS_LABEL[to as TaskStatus] : to
      return label ? `moved "${title}" to ${label}` : `changed the status of "${title}"`
    }
    default:
      return `updated "${title}"`
  }
}

/**
 * "3m ago" for something that already happened. A row stamped a little in the
 * future (another device's clock running ahead) reads "now", never "in 4h".
 */
function sinceLabel(iso: string, now: number): string {
  return new Date(iso).getTime() > now ? 'now' : fmtRelative(iso)
}

/** "in 45m" / "in 2h 5m": whole minutes until a start, never "in 0m". */
function untilLabel(iso: string, now: number): string {
  return `in ${fmtMinutes(Math.max(1, Math.ceil((new Date(iso).getTime() - now) / 60_000)))}`
}

/** Recent activity rows a phone shows before "Show all". */
const ACTIVITY_ROWS_ON_PHONES = 6

/** Open work by status, in board order. Done tasks are not open. */
const OPEN_STATUSES: { status: Exclude<TaskStatus, 'done'>; label: string; swatch: string }[] = [
  { status: 'todo', label: 'To do', swatch: 'bg-ink-400 dark:bg-ink-300' },
  { status: 'in_progress', label: 'In progress', swatch: 'bg-brand-600 dark:bg-brand-400' },
  { status: 'blocked', label: 'Blocked', swatch: 'bg-rose-600 dark:bg-rose-400' },
]

// Same cell shell as StatCard's `variant="cell"`, spanning the strip's width
// below xl and two rows from xl.
const LEAD_TILE =
  'density-card max-sm:p-3 col-span-3 xl:col-span-1 xl:row-span-2 flex flex-row items-end gap-5 sm:gap-8 ' +
  'xl:flex-col xl:items-stretch xl:gap-0 border-r border-b border-ink-600'

/**
 * The strip's lead tile: open tasks, and how they split across the board. A
 * hairline bar (each status's share) over a legend of exact counts. Below xl
 * it runs the strip's full width, figure left and split right; from xl it
 * stands two rows tall beside the other figures. The bar never moves on its
 * own: data being read stays still (the figure counts in on first load only).
 */
function OpenTasksTile({ tasks }: { tasks: Task[] }) {
  const counts = OPEN_STATUSES.map((s) => ({ ...s, n: tasks.filter((t) => t.status === s.status).length }))
  const total = tasks.length
  return (
    <Link
      to="/tasks"
      className={classNames(
        LEAD_TILE,
        'group transition-colors duration-150 ease-[ease] hover:bg-ink-700/40 active:bg-ink-700/70 [-webkit-touch-callout:none] focus-visible:ring-inset focus-visible:ring-offset-0',
      )}
    >
      <div className="min-w-0 shrink-0">
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs font-medium leading-4 text-ink-300">Open tasks</span>
          <ListChecksIcon
            size={16}
            aria-hidden
            className="hidden shrink-0 text-ink-400 transition-colors duration-150 ease-[ease] group-hover:text-brand-600 dark:group-hover:text-brand-400 xl:block"
          />
        </div>
        <div className="mt-2 sm:mt-4 text-metric text-[1.75rem] sm:text-[2.5rem] leading-none text-ink-50">
          <AnimatedNumber value={total} countKey="home-open-tasks" />
        </div>
      </div>
      <div className="min-w-0 flex-1 xl:mt-auto xl:pt-6">
        {/* Shares, not progress: each segment is its status's count. */}
        <div
          className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-ink-700"
          role="img"
          aria-label={counts.map((c) => `${c.n.toLocaleString()} ${c.label.toLowerCase()}`).join(', ')}
        >
          {total > 0 &&
            counts.map((c) =>
              c.n > 0 ? (
                <span
                  key={c.status}
                  className={classNames('h-full min-w-1.5', c.swatch)}
                  style={{ flexGrow: c.n } as CSSProperties}
                />
              ) : null,
            )}
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-2 sm:gap-3" aria-hidden>
          {counts.map((c) => (
            <div key={c.status} className="min-w-0">
              <dt className="flex items-center gap-1.5 text-[11px] leading-4 text-ink-300">
                <span className={classNames('size-1.5 shrink-0 rounded-[2px]', c.swatch)} />
                <span className="truncate">{c.label}</span>
              </dt>
              <dd className="mt-0.5 pl-3 text-sm font-medium leading-5 tabular-nums text-ink-100">
                {c.n.toLocaleString()}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Link>
  )
}

function SectionHeader({
  title, count, to, linkLabel,
}: {
  title: string
  /** Item count beside the title — omitted while loading or when zero. */
  count?: number
  to?: string
  linkLabel?: string
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      {/* Headings carry the weight (display face, ink-50); the eyebrow style is
          kept for the quieter labels inside the stat strip and the date. */}
      <h2 className="flex min-w-0 items-baseline gap-2 text-display text-base font-semibold text-ink-50">
        <span className="truncate">{title}</span>
        {count ? (
          <span className="font-sans text-sm font-normal tabular-nums text-ink-300">{count}</span>
        ) : null}
      </h2>
      {to && (
        // Negative margin: a finger-sized target without making the header row taller.
        <Link
          to={to}
          className="pressable group inline-flex shrink-0 items-center gap-1 rounded-sm text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 pointer-coarse:-my-3 pointer-coarse:min-h-11 pointer-coarse:py-3"
        >
          {linkLabel ?? 'View all'}
          <ArrowRightIcon
            size={12}
            aria-hidden
            className="transition-[translate] duration-150 ease-out hover-fine:group-hover:translate-x-0.5"
          />
        </Link>
      )}
    </div>
  )
}

/** Content-shaped placeholder for a single stat cell. */
function StatTileSkeleton({ className, sub }: { className?: string; sub?: 'always' | 'wide' }) {
  return (
    <div className={classNames('density-card max-sm:p-3 flex flex-col justify-between border-r border-b border-ink-600', className)}>
      <div className="flex items-start justify-between max-sm:min-h-8">
        <SkeletonLine w="52%" className="h-3" />
        <SkeletonBlock w={16} h={16} rounded="md" />
      </div>
      <div className="mt-2 sm:mt-4">
        <SkeletonBlock w={56} h={28} rounded="md" className="max-sm:h-5!" />
        {/* The sub line the loaded cell will have, so the strip keeps its height. */}
        {sub && <SkeletonLine w={52} className={classNames('mt-2 h-3', sub === 'wide' && 'max-sm:hidden')} />}
      </div>
    </div>
  )
}

/** The lead tile's placeholder: label, figure, the bar and its legend. */
function OpenTasksTileSkeleton() {
  return (
    <div className={LEAD_TILE}>
      <div className="shrink-0">
        <SkeletonLine w={72} className="h-3" />
        <SkeletonBlock w={64} h={36} rounded="md" className="mt-2 sm:mt-4" />
      </div>
      <div className="min-w-0 flex-1 xl:mt-auto xl:pt-6">
        <SkeletonLine className="h-1.5" />
        <div className="mt-3 grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => <SkeletonLine key={i} w="70%" className="h-3" />)}
        </div>
      </div>
    </div>
  )
}

/**
 * Rows shaped like the list that replaces them — a meeting's time column, a
 * task's badge line, an activity row's avatar — so nothing jumps when the
 * data lands.
 */
function RowsSkeleton({ kind, count }: { kind: 'meetings' | 'tasks' | 'activity'; count: number }) {
  return (
    <div className="card divide-y divide-ink-600 overflow-hidden" role="status" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="density-row flex items-center gap-4 px-4">
          {kind === 'meetings' && <SkeletonLine w={64} className="h-3" />}
          {kind === 'activity' && <SkeletonBlock w={24} rounded="full" />}
          <div className="min-w-0 flex-1 space-y-2 py-0.5">
            <SkeletonLine w={['62%', '48%', '56%', '40%'][i % 4]} />
            {kind !== 'activity' && <SkeletonLine w={kind === 'tasks' ? 72 : '34%'} className="h-3" />}
          </div>
          {kind === 'tasks' && <SkeletonBlock w={24} rounded="full" />}
          {kind === 'activity' && <SkeletonLine w={36} className="h-3" />}
        </div>
      ))}
    </div>
  )
}

export default function Home() {
  const user = useCurrentUser()
  const hydrated = useStore((s) => s.hydrated)
  const tasks = useStore((s) => s.tasks)
  const projects = useStore((s) => s.projects)
  const clients = useStore((s) => s.clients)
  const users = useStore((s) => s.users)
  const events = useStore((s) => s.events)
  const timeEntries = useStore((s) => s.timeEntries)
  const taskActivity = useStore((s) => s.taskActivity)
  const notifications = useStore((s) => s.notifications)

  const canTasks = can(user, 'tasks', 'view')
  const canProjects = can(user, 'projects', 'view')
  const canMeetings = can(user, 'meetings', 'view')
  const canEditMeetings = can(user, 'meetings', 'edit')

  const loading = !hydrated

  const today = isoDate()
  const firstName = user?.fullName.split(' ')[0] ?? 'there'

  const openTasks = useMemo(
    () => tasks.filter((t) => t.status !== 'done' && !t.archived),
    [tasks],
  )
  const dueTodayCount = useMemo(
    () => openTasks.filter((t) => t.dueDate === today).length,
    [openTasks, today],
  )
  const activeProjects = useMemo(
    () => projects.filter((p) => p.status !== 'done').length,
    [projects],
  )
  const todayMeetings = useMemo(
    () =>
      getEventOccurrences(events, startOfDay(new Date()), endOfDay(new Date()))
        .filter((o) => o.event.kind === 'meeting'),
    [events],
  )
  // Admins see the studio's day; everyone else sees their own hours.
  const todayEntries = useMemo(
    () =>
      timeEntries.filter(
        (e) => e.entryDate === today && (user?.role === 'admin' || e.userId === user?.id),
      ),
    [timeEntries, today, user?.role, user?.id],
  )
  const minutesToday = todayEntries.reduce((sum, e) => sum + e.minutes, 0)
  const unread = useMemo(
    () => notifications.filter((n) => n.userId === user?.id && !n.read).length,
    [notifications, user?.id],
  )

  const dueTasks = useMemo(
    () =>
      openTasks
        .filter((t) => t.dueDate && t.dueDate <= today)
        .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '')),
    [openTasks, today],
  )

  // Only the last 48h, newest first. No slice — the list scrolls past 8 rows
  // (see the fixed-height wrapper below) rather than truncating. The store's
  // sweepActivity() hard-deletes rows past this window (backed up to Sheets), so
  // this filter is mostly a guard for rows not yet swept.
  const now = useNow()
  const recentActivity = useMemo(() => {
    const cutoff = now - 48 * 60 * 60 * 1000
    return [...taskActivity]
      .filter((a) => new Date(a.createdAt).getTime() >= cutoff)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [taskActivity, now])

  const clientName = (id?: string): string | undefined =>
    clients.find((c) => c.id === id)?.name

  // Live state the list carries: the meeting happening right now breathes
  // (the one perpetual motion on Home), and the next one is marked.
  const liveId = todayMeetings.find(
    (o) => o.endsAt && new Date(o.startsAt).getTime() <= now && now < new Date(o.endsAt).getTime(),
  )?.occurrenceId
  const nextId = todayMeetings.find((o) => new Date(o.startsAt).getTime() > now)?.occurrenceId

  // First load of each list this session cascades in (40ms apart); revisits,
  // new rows and refetches land still.
  const { ref: attachMeetings, className: meetingsCascade } = useStagger<HTMLDivElement>('home-meetings')
  const { ref: attachDue, className: dueCascade } = useStagger<HTMLDivElement>('home-due')
  const { ref: attachActivity, className: activityCascade } = useStagger<HTMLDivElement>('home-activity')
  // Phones: the list is part of the page (no scroller inside a scroller), so
  // it starts with the latest few and the rest come on request.
  const [allActivity, setAllActivity] = useState(false)
  const hiddenOnPhones = Math.max(0, recentActivity.length - ACTIVITY_ROWS_ON_PHONES)
  // Two columns on wide screens: the day's meetings narrower, the work wider.
  const both = canMeetings && canTasks

  return (
    <Layout title="Home" subtitle="Your day at a glance">
      <div className="mx-auto max-w-6xl space-y-8">
        {/* ── Greeting ────────────────────────────────────────────── */}
        {/* The date is the eyebrow, the greeting the headline. It's an h2: the
            Topbar already renders the page's one h1 ("Home"). */}
        <header className="pt-1">
          <p className="section-title tabular-nums">
            {format(new Date(), 'EEEE, MMMM d, yyyy')}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="text-display text-[1.75rem] font-medium leading-tight text-ink-50 md:text-4xl">
              {greetingWord()}, {firstName}
            </h2>
            {user && <RoleChip role={user.role} />}
          </div>
        </header>

        {/* ── First run ────────────────────────────────────────────── */}
        {/* A new workspace's admin gets the next steps; everyone else, and
            every workspace already in use, gets nothing here. */}
        <SetupGuide />

        {/* ── Stat strip ──────────────────────────────────────────── */}
        {/* One ruled card laid out as a small bento: open tasks leads with its
            split across the board, the day's figures sit beside it, hours on a
            double cell. Every figure links to where it comes from. */}
        <StatStrip
          className={canTasks ? 'grid-cols-3 xl:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))]' : 'grid-cols-3'}
        >
          {loading ? (
            <>
              {canTasks && <OpenTasksTileSkeleton />}
              {Array.from({ length: canTasks ? 5 : 3 }).map((_, i) => (
                <StatTileSkeleton
                  key={i}
                  className={canTasks && i === 3 ? 'col-span-2' : undefined}
                  sub={canTasks ? (i === 3 ? 'always' : i === 4 ? 'wide' : undefined) : i === 2 ? 'wide' : undefined}
                />
              ))}
            </>
          ) : (
            <>
              {canTasks && <OpenTasksTile tasks={openTasks} />}
              {canTasks && (
                <StatCard
                  variant="cell"
                  label="Due today"
                  countKey="home-due-today"
                  value={dueTodayCount}
                  icon={CalendarDotIcon}
                  to="/tasks"
                />
              )}
              {canProjects && (
                <StatCard
                  variant="cell"
                  label="Active projects"
                  countKey="home-active-projects"
                  value={activeProjects}
                  icon={KanbanIcon}
                  to="/projects"
                />
              )}
              {canMeetings && (
                <StatCard
                  variant="cell"
                  label="Meetings today"
                  countKey="home-meetings-today"
                  value={todayMeetings.length}
                  icon={VideoCameraIcon}
                  to="/meetings"
                />
              )}
              {canTasks && (
                <StatCard
                  variant="cell"
                  className="col-span-2"
                  keepSub
                  label={user?.role === 'admin' ? 'Hours today' : 'My hours today'}
                  value={fmtMinutes(minutesToday)}
                  icon={ClockIcon}
                  sub={`${todayEntries.length} ${todayEntries.length === 1 ? 'entry' : 'entries'}`}
                  to="/tasks"
                />
              )}
              <StatCard
                variant="cell"
                label="Unread"
                countKey="home-unread"
                value={unread}
                icon={BellIcon}
                sub="notifications"
                to="/notifications"
              />
            </>
          )}
        </StatStrip>

        {/* grid-cols-1, not the implicit auto track: a truncated title's nowrap text
            still counts at full width in an auto track and pushed the cards past
            a phone's edge. minmax(0,1fr) lets `truncate` do its job. */}
        <div className="grid grid-cols-1 gap-x-6 gap-y-8 lg:grid-cols-12 lg:items-stretch">
          {/* Stretched columns, so two empty states end level; a list card
              hugs its rows instead of padding itself out to the neighbour. */}
          {/* ── Today's meetings ──────────────────────────────────── */}
          {canMeetings && (
            <section className={classNames('flex min-w-0 flex-col', both ? 'lg:col-span-5' : 'lg:col-span-12')}>
              <SectionHeader
                title="Today's meetings"
                count={loading ? undefined : todayMeetings.length}
                to="/meetings"
                linkLabel="Open meetings"
              />
              {loading ? (
                <RowsSkeleton kind="meetings" count={3} />
              ) : todayMeetings.length === 0 ? (
                <EmptyState
                  compact
                  className="flex-1"
                  glyph="meetings"
                  title="No meetings today"
                  description="Your schedule is clear. Meetings appear here on the day they occur."
                  action={
                    canEditMeetings ? (
                      <Link to="/meetings?new=1" className="btn-secondary">
                        <CalendarPlusIcon size={14} aria-hidden />
                        Schedule meeting
                      </Link>
                    ) : undefined
                  }
                />
              ) : (
                // The card hugs its rows: stretched to the neighbour's height it
                // left a blank strip of card under the last meeting.
                <div className="card overflow-hidden">
                  <div ref={attachMeetings} className={classNames('divide-y divide-ink-600', meetingsCascade)}>
                    {todayMeetings.map((o) => {
                      const live = o.occurrenceId === liveId
                      const next = o.occurrenceId === nextId
                      const join = webHref(o.event.meetingLink)
                      return (
                        <div key={o.occurrenceId} className="density-row flex items-start gap-4 px-4">
                          {/* Tabular figures in the UI face: "10:00 AM" and "2:00 PM" share a column. */}
                          <div className="w-18 shrink-0 whitespace-nowrap text-sm leading-5 tabular-nums text-ink-100">
                            {fmtTime(o.startsAt)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="truncate text-sm font-medium text-ink-50" title={o.event.title}>
                                {o.event.title}
                              </span>
                              {live ? (
                                <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-rose-700 dark:text-rose-400">
                                  <StatusDot tone="live" breathe size="xs" />
                                  Live
                                </span>
                              ) : next ? (
                                <span className="shrink-0 text-[11px] font-medium text-brand-600 dark:text-brand-400">Next</span>
                              ) : null}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-300">
                              {/* The next meeting counts down (per minute) on its meta line, where it
                                  doesn't take width from the title. */}
                              {next && (
                                <span className="whitespace-nowrap tabular-nums text-brand-600 dark:text-brand-400">
                                  {untilLabel(o.startsAt, now)}
                                </span>
                              )}
                              {clientName(o.event.clientId) && (
                                <span className="max-w-full truncate" title={clientName(o.event.clientId)}>{clientName(o.event.clientId)}</span>
                              )}
                              {o.event.endsAt && (
                                <span className="whitespace-nowrap tabular-nums">until {fmtTime(o.endsAt)}</span>
                              )}
                              {o.event.location && (
                                <span className="inline-flex max-w-full items-center gap-1" title={o.event.location}>
                                  <MapPinIcon size={12} className="shrink-0" aria-hidden />
                                  <span className="truncate">{o.event.location}</span>
                                </span>
                              )}
                            </div>
                          </div>
                          {join && (
                            <a
                              href={join}
                              target="_blank"
                              rel="noreferrer"
                              className="pressable tap-target -my-1 shrink-0 rounded-md p-1.5 text-brand-600 hover:bg-brand-500/10 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 pointer-coarse:-my-2.5"
                              title="Join meeting"
                              aria-label={`Join meeting: ${o.event.title}`}
                            >
                              <VideoCameraIcon size={16} weight={live ? 'fill' : 'regular'} aria-hidden />
                            </a>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ── Due & overdue tasks ───────────────────────────────── */}
          {canTasks && (
            <section className={classNames('flex min-w-0 flex-col', both ? 'lg:col-span-7' : 'lg:col-span-12')}>
              <SectionHeader
                title="Due & overdue tasks"
                count={loading ? undefined : dueTasks.length}
                to="/tasks"
                linkLabel="Open tasks"
              />
              {loading ? (
                <RowsSkeleton kind="tasks" count={3} />
              ) : dueTasks.length === 0 ? (
                <EmptyState
                  compact
                  className="flex-1"
                  glyph="tasks"
                  title="Nothing due"
                  description="No open tasks are due today or overdue. Nice work."
                  action={
                    <Link to="/tasks" className="btn-secondary">
                      View all tasks
                    </Link>
                  }
                />
              ) : (
                <div
                  ref={attachDue}
                  className={classNames('card divide-y divide-ink-600 overflow-hidden', dueCascade)}
                >
                  {dueTasks.map((t) => {
                    const overdue = (t.dueDate ?? '') < today
                    const assignee = users.find((u) => u.id === t.assigneeId)
                    return (
                      <Link
                        key={t.id}
                        // The task itself, not its client's board.
                        to={`/tasks?task=${t.id}`}
                        className="pressable-card density-row flex items-center gap-3 px-4 hover:bg-ink-700/50 focus-visible:ring-inset focus-visible:ring-offset-0"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-ink-50" title={t.title}>
                            {t.title}
                          </div>
                          <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px]">
                            {overdue ? (
                              <>
                                <span className="badge badge-danger">Overdue</span>
                                <span className="truncate tabular-nums text-ink-400">
                                  was due {fmtDate(t.dueDate)}
                                </span>
                              </>
                            ) : (
                              <span className="badge badge-warn">Due today</span>
                            )}
                          </div>
                        </div>
                        {clientName(t.clientId) && (
                          <span className="chip hidden max-w-36 shrink-0 border-ink-600 bg-ink-700/60 text-ink-200 sm:inline-flex" title={clientName(t.clientId)}>
                            <span className="truncate">{clientName(t.clientId)}</span>
                          </span>
                        )}
                        <PriorityChip priority={t.priority} />
                        {assignee && <Avatar name={assignee.fullName} color={assignee.avatarColor} size="sm" />}
                      </Link>
                    )
                  })}
                </div>
              )}
            </section>
          )}
        </div>

        {/* ── Recent activity ─────────────────────────────────────── */}
        {canTasks && (
          <section>
            <SectionHeader
              title="Recent activity"
              count={loading ? undefined : recentActivity.length}
            />
            {loading ? (
              <RowsSkeleton kind="activity" count={4} />
            ) : recentActivity.length === 0 ? (
              <EmptyState
                compact
                glyph="tasks"
                title="No activity yet"
                description="Task creations, status moves, and completions show up here as your team works."
              />
            ) : (
              <div className="card overflow-hidden">
                {/* From sm: sized to ~8 rows; a 9th+ (within the 48h window)
                    scrolls. It is a focusable region so keyboard users can
                    scroll it too. Phones: rows wrap to two lines, so a fixed
                    box cut the last one in half; there it is plain page
                    content, the latest six with the rest behind "Show all". */}
                <div
                  tabIndex={0}
                  role="region"
                  aria-label="Recent activity"
                  ref={attachActivity}
                  className={classNames(
                    'divide-y divide-ink-600 sm:max-h-100 sm:overflow-y-auto sm:overscroll-contain',
                    !allActivity && 'max-sm:[&>*:nth-child(n+7)]:hidden',
                    activityCascade,
                  )}
                >
                  {recentActivity.map((a) => {
                    const actor = users.find((u) => u.id === a.actorId)
                    return (
                      <div key={a.id} className="density-row flex items-center gap-3 px-4">
                        <Avatar name={actor?.fullName ?? '?'} color={actor?.avatarColor} size="sm" />
                        <div className="min-w-0 flex-1 text-sm text-ink-200 [overflow-wrap:anywhere]">
                          <span className="font-medium text-ink-50">
                            {actor?.fullName ?? 'Someone'}
                          </span>{' '}
                          {activitySentence(a, tasks, users)}
                        </div>
                        <div className="shrink-0 text-[11px] tabular-nums text-ink-400">
                          {sinceLabel(a.createdAt, now)}
                        </div>
                      </div>
                    )
                  })}
                </div>
                {hiddenOnPhones > 0 && !allActivity && (
                  <button
                    type="button"
                    className="pressable-card flex min-h-11 w-full items-center justify-center px-4 text-xs font-medium text-brand-600 hover:bg-ink-700/50 focus-visible:ring-inset focus-visible:ring-offset-0 dark:text-brand-400 sm:hidden"
                    onClick={() => setAllActivity(true)}
                  >
                    Show all {recentActivity.length.toLocaleString()}
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        {!canTasks && !canProjects && !canMeetings && (
          <EmptyState
            glyph="clients"
            title="Welcome to DeskDev"
            description="You don't have access to any workspace features yet. Ask an admin to grant you permissions."
          />
        )}
      </div>
    </Layout>
  )
}
