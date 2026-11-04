import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { addDays, format, parseISO, startOfWeek } from 'date-fns'
import {
  ArrowLeftIcon, ArrowRightIcon, BriefcaseIcon, CheckSquareIcon, ClockIcon, EnvelopeSimpleIcon, FileTextIcon,
  GlobeIcon, PencilSimpleIcon, PhoneIcon, TrashIcon, VideoCameraIcon,
} from '@phosphor-icons/react'
import Layout from '../components/Layout'
import EmptyState from '../components/EmptyState'
import { SkeletonBlock, SkeletonLine } from '../components/ui-foundation'
import ConfirmDialog from '../components/ConfirmDialog'
import EodReportModal from '../components/EodReportModal'
import ClientModal from '../components/clients/ClientModal'
import EmailThreads from '../components/email/EmailThreads'
import ClientConsentControl from '../components/showcase/ClientConsentControl'
import PictureMenu from '../components/PictureMenu'
import { CategoryChip, ClientAvatar, EngagementTag } from '../components/clients/ClientBits'
import {
  ClientStatusChip, PriorityChip, StatusChip,
} from '../components/Chips'
import { useStore, useCurrentUser, getEventOccurrences } from '../store/useStore'
import { can } from '../lib/permissions'
import { classNames, fmtDate, fmtDateTime, fmtMinutes, isoDate } from '../lib/format'
import type { ProjectStatus } from '../lib/types'

const PRIORITY_RANK = { high: 0, med: 1, low: 2 } as const

const PROJECT_STATUS_ORDER: ProjectStatus[] = [
  'in_progress', 'planning', 'waiting', 'backlog', 'done',
]

/** Row geometry for every list in a block: ruled, edge to edge in its card. */
const ROW = 'flex items-center gap-3 px-4 py-2.5 min-w-0'
const BLOCK_LINK =
  'inline-flex items-center gap-1 text-xs font-medium text-brand-700 dark:text-brand-400 hover:text-brand-600 dark:hover:text-brand-300 transition-colors duration-150 ease-[ease] pointer-coarse:-my-2.5 pointer-coarse:py-3.5 [-webkit-touch-callout:none]'

/**
 * A titled block: heading + count on the page (as on Home), its rows ruled in
 * one card under it — no icon tile, no box inside a box.
 */
function Block({
  icon: Icon,
  title,
  count,
  action,
  children,
}: {
  icon: typeof BriefcaseIcon
  title: string
  count?: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  const id = `client-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return (
    <section aria-labelledby={id} className="min-w-0">
      <div className="flex items-end justify-between gap-3 mb-2.5">
        <h2 id={id} className="flex items-center gap-2 min-w-0 text-display text-base font-semibold text-ink-50">
          <Icon size={16} className="shrink-0 text-ink-400" aria-hidden />
          <span className="truncate">{title}</span>
          {count !== undefined && <span className="font-sans text-sm font-normal tabular-nums text-ink-300">{count}</span>}
        </h2>
        {action}
      </div>
      <div className="card overflow-hidden">{children}</div>
    </section>
  )
}

/** A block's quiet empty line, inside its card. */
function BlockEmpty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-sm text-ink-300">{children}</p>
}

export default function ClientDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const user = useCurrentUser()

  const clients = useStore((s) => s.clients)
  const clientCategories = useStore((s) => s.clientCategories)
  const projects = useStore((s) => s.projects)
  const tasks = useStore((s) => s.tasks)
  const events = useStore((s) => s.events)
  const timeEntries = useStore((s) => s.timeEntries)
  const deleteClient = useStore((s) => s.deleteClient)
  const hydrated = useStore((s) => s.hydrated)
  const emails = useStore((s) => s.emails)
  const leads = useStore((s) => s.leads)

  const canEdit = can(user, 'clients', 'edit')
  const canSeeProjects = can(user, 'projects', 'view')
  const today = isoDate(new Date())

  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [eodOpen, setEodOpen] = useState(false)

  const client = clients.find((c) => c.id === id)
  // The client's emails: on the client, on its projects (e.g. the onboarding
  // form sent from a project), and from the lead it was converted from.
  const clientEmails = useMemo(() => {
    const fromLeads = new Set(leads.filter((l) => l.clientId === id).map((l) => l.id))
    const ofProjects = new Set(projects.filter((p) => p.clientId === id).map((p) => p.id))
    return emails.filter(
      (e) => e.clientId === id || (e.leadId && fromLeads.has(e.leadId)) || (e.projectId && ofProjects.has(e.projectId)),
    )
  }, [emails, leads, projects, id])
  const category = client?.categoryId
    ? clientCategories.find((c) => c.id === client.categoryId)
    : undefined

  const clientProjects = useMemo(
    () =>
      projects
        .filter((p) => p.clientId === id)
        .sort(
          (a, b) =>
            PROJECT_STATUS_ORDER.indexOf(a.status) - PROJECT_STATUS_ORDER.indexOf(b.status) ||
            a.position - b.position,
        ),
    [projects, id],
  )

  const projectStatusCounts = useMemo(() => {
    const out = new Map<ProjectStatus, number>()
    for (const p of clientProjects) out.set(p.status, (out.get(p.status) ?? 0) + 1)
    return PROJECT_STATUS_ORDER.filter((s) => out.has(s)).map(
      (s) => [s, out.get(s) ?? 0] as const,
    )
  }, [clientProjects])

  const openTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.clientId === id && !t.archived && t.status !== 'done')
        .sort((a, b) => {
          if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) {
            return a.dueDate.localeCompare(b.dueDate)
          }
          if (a.dueDate && !b.dueDate) return -1
          if (!a.dueDate && b.dueDate) return 1
          return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
        }),
    [tasks, id],
  )

  const upcomingMeetings = useMemo(() => {
    const now = new Date()
    const horizon = addDays(now, 90)
    const clientMeetings = events.filter((e) => e.kind === 'meeting' && e.clientId === id)
    return getEventOccurrences(clientMeetings, now, horizon)
      .filter((o) => new Date(o.startsAt).getTime() >= now.getTime())
      .slice(0, 5)
  }, [events, id])

  const week = useMemo(() => {
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
    const startKey = isoDate(weekStart)
    const endKey = isoDate(addDays(weekStart, 6))
    const entries = timeEntries.filter(
      (t) => t.clientId === id && t.entryDate >= startKey && t.entryDate <= endKey,
    )
    const perDay = new Map<string, number>()
    let total = 0
    for (const e of entries) {
      total += e.minutes
      perDay.set(e.entryDate, (perDay.get(e.entryDate) ?? 0) + e.minutes)
    }
    return {
      total,
      days: [...perDay.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    }
  }, [timeEntries, id])

  // Loading — content-shaped skeleton that mirrors the header + the two columns.
  if (!hydrated) {
    return (
      <Layout title="Client" subtitle="Loading…">
        <div className="space-y-8 max-w-6xl mx-auto" role="status" aria-busy="true" aria-label="Loading client">
          <SkeletonLine w={112} className="h-3.5" />
          <div className="flex items-start gap-4">
            <SkeletonBlock w={56} rounded="full" />
            <div className="flex-1 space-y-2.5">
              <SkeletonLine w="34%" className="h-6" />
              <SkeletonLine w="22%" />
              <div className="flex gap-1.5 pt-1">
                <SkeletonBlock w={72} h={20} rounded="full" />
                <SkeletonBlock w={56} h={20} rounded="full" />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-8">
            {[4, 3].map((rows, col) => (
              <div key={col} className="space-y-8">
                {[0, 1].map((b) => (
                  <div key={b}>
                    <SkeletonLine w={132} className="h-4 mb-3" />
                    <div className="card divide-y divide-ink-600">
                      {Array.from({ length: rows - b }).map((_, i) => (
                        <div key={i} className="flex items-center gap-3 px-4 py-3">
                          <SkeletonLine w={`${42 + ((i * 11 + b * 7) % 30)}%`} />
                          <div className="flex-1" />
                          <SkeletonLine w={64} className="h-3" />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </Layout>
    )
  }

  if (!client) {
    return (
      <Layout title="Client" subtitle="Not found">
        <div className="max-w-md mx-auto">
          <EmptyState
            glyph="search-empty"
            title="Client not found"
            description="This client doesn't exist or may have been deleted."
            action={
              <Link to="/clients" className="btn-primary">
                Back to clients
              </Link>
            }
          />
        </div>
      </Layout>
    )
  }

  const contactLink =
    'inline-flex items-center gap-2 min-w-0 text-sm text-ink-200 hover:text-ink-50 transition-colors duration-150 ease-[ease] pointer-coarse:min-h-11 [-webkit-touch-callout:none]'

  return (
    <Layout title={client.name} subtitle={client.company ?? 'Client detail'}>
      <div className="space-y-8 max-w-6xl mx-auto">
        <div className="space-y-5">
          {/* Desktop's way back. Phones already have one: the top bar's chevron
              (shellNav sends /clients/:id to /clients), so a second would be noise. */}
          <Link
            to="/clients"
            className="max-md:hidden inline-flex items-center gap-1.5 text-sm text-ink-300 hover:text-ink-50 transition-colors duration-150 ease-[ease] pointer-coarse:py-2"
          >
            <ArrowLeftIcon size={16} aria-hidden />
            Back to clients
          </Link>

          {/* Header: on the page, not in a card — the client is the subject here. */}
          <header className="flex flex-col md:flex-row md:items-start gap-5">
            <div className="flex items-start gap-4 flex-1 min-w-0">
              {user?.role === 'admin' ? (
                <PictureMenu owner={{ kind: 'clients', id: client.id }} currentKey={client.avatarKey} subject={`${client.name}'s`}>
                  <ClientAvatar client={client} size="lg" />
                </PictureMenu>
              ) : (
                <ClientAvatar client={client} size="lg" />
              )}
              <div className="flex-1 min-w-0">
                <h2 dir="auto" className="text-display text-2xl md:text-[1.75rem] font-semibold leading-tight text-ink-50 text-balance text-left [overflow-wrap:anywhere]">
                  {client.name}
                </h2>
                {client.company && (
                  <div className="mt-1 text-sm text-ink-300 [overflow-wrap:anywhere]">{client.company}</div>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <EngagementTag engagement={client.engagement} />
                  <ClientStatusChip status={client.status} />
                  {category && <CategoryChip category={category} />}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0 [&>button]:whitespace-nowrap max-sm:[&>button]:flex-1 max-sm:[&>button]:min-h-11">
              <button className="btn-secondary" onClick={() => setEodOpen(true)}>
                <FileTextIcon size={16} aria-hidden />
                EOD report
              </button>
              {canEdit && (
                <>
                  <button className="btn-ghost" onClick={() => setEditOpen(true)}>
                    <PencilSimpleIcon size={16} aria-hidden />
                    Edit
                  </button>
                  <button
                    className="btn-ghost text-rose-700 dark:text-rose-400 hover:text-rose-800 hover:bg-rose-500/10 dark:hover:text-rose-300"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <TrashIcon size={16} aria-hidden />
                    Delete
                  </button>
                </>
              )}
            </div>
          </header>

          {(client.email || client.phone || client.timezone || client.notes) && (
            // From lg up these are the page's own two columns (3fr / 2fr, 2rem apart), so
            // the notes start on the same line as the right-hand column below.
            <div className="border-t border-ink-600 pt-4 grid gap-x-4 gap-y-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-x-8">
              <div className="flex flex-col gap-y-1.5 min-w-0">
                {/* mailto:/tel: — on a phone, tap to write or call. */}
                {client.email && (
                  <a href={`mailto:${client.email}`} className={contactLink}>
                    <EnvelopeSimpleIcon size={16} className="text-ink-400 shrink-0" aria-hidden />
                    {/* The detail view is where the address is read in full: wrap, don't clip. */}
                    <span className="min-w-0 [overflow-wrap:anywhere]">{client.email}</span>
                  </a>
                )}
                {client.phone && (
                  <a href={`tel:${client.phone.replace(/[^\d+]/g, '')}`} className={contactLink}>
                    <PhoneIcon size={16} className="text-ink-400 shrink-0" aria-hidden />
                    <span className="tabular-nums">{client.phone}</span>
                  </a>
                )}
                {client.timezone && (
                  <span className="inline-flex items-center gap-2 min-w-0 text-sm text-ink-200">
                    <GlobeIcon size={16} className="text-ink-400 shrink-0" aria-hidden />
                    <span className="truncate">{client.timezone}</span>
                  </span>
                )}
              </div>
              {client.notes && (
                <div className="min-w-0">
                  <h3 className="section-title mb-1.5">Notes</h3>
                  <p className="text-sm text-ink-200 leading-relaxed whitespace-pre-wrap max-w-[65ch] [overflow-wrap:anywhere]">
                    {client.notes}
                  </p>
                </div>
              )}
            </div>
          )}

          <ClientConsentControl client={client} />
        </div>

        {/* Asymmetric: the work (projects, tasks) gets the wide column, time
            (meetings, hours) the narrow one. */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-8 lg:items-start">
          <div className="space-y-8 min-w-0">
            {/* Projects */}
            <Block
              icon={BriefcaseIcon}
              title="Projects"
              count={clientProjects.length > 0 ? clientProjects.length : undefined}
              action={
                <Link to={`/projects?client=${client.id}`} className={BLOCK_LINK}>
                  View board
                  <ArrowRightIcon size={12} aria-hidden />
                </Link>
              }
            >
              {clientProjects.length === 0 ? (
                <BlockEmpty>No projects for this client yet.</BlockEmpty>
              ) : (
                <>
                  <div className="flex flex-wrap gap-x-3 gap-y-2 px-4 py-3 border-b border-ink-600 bg-ink-850/40">
                    {projectStatusCounts.map(([status, count]) => (
                      <span key={status} className="inline-flex items-center gap-1.5 text-xs text-ink-200">
                        <StatusChip status={status} />
                        <span className="tabular-nums">{count}</span>
                      </span>
                    ))}
                  </div>
                  <ul className="divide-y divide-ink-600">
                    {clientProjects.map((p) => {
                      const inner = (
                        <>
                          <span className="flex-1 min-w-0 text-sm text-ink-50 truncate" title={p.title}>
                            {p.title}
                          </span>
                          {p.dueDate && (
                            <span className="text-xs tabular-nums text-ink-300 shrink-0 max-sm:hidden">
                              {fmtDate(p.dueDate)}
                            </span>
                          )}
                          <StatusChip status={p.status} />
                        </>
                      )
                      return (
                        <li key={p.id}>
                          {canSeeProjects ? (
                            <Link
                              to={`/projects/${p.id}`}
                              className={classNames(
                                ROW,
                                'transition-colors duration-150 ease-[ease] hover:bg-ink-700/40 active:bg-ink-700/70 [-webkit-touch-callout:none] pointer-coarse:min-h-11',
                                'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 focus-visible:ring-offset-0',
                              )}
                            >
                              {inner}
                            </Link>
                          ) : (
                            <div className={ROW}>{inner}</div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </>
              )}
            </Block>

            {/* Open tasks */}
            <Block
              icon={CheckSquareIcon}
              title="Open tasks"
              count={openTasks.length > 0 ? openTasks.length : undefined}
              action={
                <Link to={`/tasks?client=${client.id}`} className={BLOCK_LINK}>
                  View board
                  <ArrowRightIcon size={12} aria-hidden />
                </Link>
              }
            >
              {openTasks.length === 0 ? (
                <BlockEmpty>No open tasks — all clear.</BlockEmpty>
              ) : (
                <ul className="divide-y divide-ink-600">
                  {openTasks.slice(0, 8).map((t) => {
                    const overdue = !!t.dueDate && t.dueDate < today
                    return (
                      <li key={t.id} className={ROW}>
                        <span className="flex-1 min-w-0 text-sm text-ink-50 truncate" title={t.title}>
                          {t.title}
                        </span>
                        {t.dueDate && (
                          <span className={classNames('text-xs shrink-0', overdue ? 'text-rose-700 dark:text-rose-400' : 'text-ink-300')}>
                            Due{' '}
                            <span className="tabular-nums">{fmtDate(t.dueDate)}</span>
                          </span>
                        )}
                        <PriorityChip priority={t.priority} />
                      </li>
                    )
                  })}
                  {openTasks.length > 8 && (
                    <li className="px-4 py-2.5 text-xs text-ink-300">
                      <span className="tabular-nums">+{openTasks.length - 8}</span> more on the board
                    </li>
                  )}
                </ul>
              )}
            </Block>

            {/* Email (049): sent through the studio's Gmail by n8n; replies come back the same way. */}
            <Block icon={EnvelopeSimpleIcon} title="Email" count={clientEmails.length > 0 ? clientEmails.length : undefined}>
              <div className="px-4 py-3">
                <EmailThreads
                  emails={clientEmails}
                  clientId={client.id}
                  person={{ name: client.name, email: client.email }}
                  canSend={canEdit}
                />
              </div>
            </Block>
          </div>

          <div className="space-y-8 min-w-0">
            {/* Upcoming meetings */}
            <Block
              icon={VideoCameraIcon}
              title="Upcoming meetings"
              count={upcomingMeetings.length > 0 ? upcomingMeetings.length : undefined}
              action={
                <Link to={`/meetings?client=${client.id}`} className={BLOCK_LINK}>
                  All meetings
                  <ArrowRightIcon size={12} aria-hidden />
                </Link>
              }
            >
              {upcomingMeetings.length === 0 ? (
                <BlockEmpty>No meetings scheduled.</BlockEmpty>
              ) : (
                <ul className="divide-y divide-ink-600">
                  {upcomingMeetings.map((o) => (
                    <li key={o.occurrenceId} className={classNames(ROW, 'items-start')}>
                      <span
                        className={classNames('mt-1.5 size-2 rounded-full shrink-0', !o.event.color && 'bg-brand-500')}
                        style={o.event.color ? { backgroundColor: o.event.color } : undefined}
                        aria-hidden
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-ink-50 truncate" title={o.event.title}>{o.event.title}</div>
                        <div className="mt-0.5 text-xs tabular-nums text-ink-300">
                          {fmtDateTime(o.startsAt)}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Block>

            {/* Hours this week */}
            <Block
              icon={ClockIcon}
              title="Hours this week"
              action={
                <span className="tabular-nums text-sm font-semibold text-ink-50">
                  {fmtMinutes(week.total)}
                </span>
              }
            >
              {week.days.length === 0 ? (
                <BlockEmpty>No time logged this week.</BlockEmpty>
              ) : (
                <ul className="divide-y divide-ink-600">
                  {week.days.map(([day, minutes]) => (
                    <li key={day} className={classNames(ROW, 'justify-between')}>
                      <span className="text-sm text-ink-100 tabular-nums">
                        {format(parseISO(day), 'EEE, MMM d')}
                      </span>
                      <span className="text-sm text-ink-50 font-medium tabular-nums">
                        {fmtMinutes(minutes)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Block>
          </div>
        </div>
      </div>

      <ClientModal open={editOpen} onClose={() => setEditOpen(false)} client={client} />
      <ConfirmDialog
        open={deleteOpen}
        title="Delete client"
        message={`Delete "${client.name}"? All of their projects, tasks, time entries, and CRM tables will be removed as well.`}
        confirmLabel="Delete client"
        danger
        onConfirm={async () => {
          const result = await deleteClient(client.id)
          if (!result.ok) { toast.error(result.error); return }
          toast.success('Client deleted')
          navigate('/clients')
        }}
        onClose={() => setDeleteOpen(false)}
      />
      <EodReportModal
        open={eodOpen}
        onClose={() => setEodOpen(false)}
        defaultClientId={client.id}
      />
    </Layout>
  )
}
