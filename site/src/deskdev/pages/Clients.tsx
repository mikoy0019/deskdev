import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  BriefcaseIcon, CaretRightIcon, CheckSquareIcon, EnvelopeSimpleIcon, MagnifyingGlassIcon, PhoneIcon, PlusIcon,
} from '@phosphor-icons/react'
import Layout from '../components/Layout'
import EmptyState from '../components/EmptyState'
import { SkeletonBlock, SkeletonLine } from '../components/ui-foundation'
import { IndicatorGroup, LayoutIndicator, useStagger } from '../components/motion'
import ClientModal from '../components/clients/ClientModal'
import { CategoryChip, ClientAvatar, ENGAGEMENT_LABELS, EngagementTag } from '../components/clients/ClientBits'
import { ClientStatusChip } from '../components/Chips'
import { useStore, useCurrentUser } from '../store/useStore'
import { can } from '../lib/permissions'
import { classNames } from '../lib/format'
import type { Client, ClientCategory, ClientStatus, Engagement } from '../lib/types'

type StatusTab = 'all' | ClientStatus

const TABS: [StatusTab, string][] = [
  ['all', 'All'],
  ['active', 'Active'],
  ['paused', 'Paused'],
  ['ended', 'Ended'],
]

// One ruled roster instead of a grid of cards: client · engagement · contact ·
// figures. Phones: the client spans the row, chips and figures stack under it.
const ROW_GRID =
  'grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(0,1.2fr)_5rem_5rem_1.25rem]'

/** Row-shaped placeholder while the store rehydrates. */
function RosterSkeleton() {
  return (
    <div className="card overflow-hidden" role="status" aria-busy="true" aria-label="Loading clients">
      <div className="hidden md:block h-9 border-b border-ink-600" />
      <div className="divide-y divide-ink-600">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={classNames('grid gap-4 px-4 py-4 items-center', ROW_GRID)}>
            <div className="flex items-center gap-3 min-w-0">
              <SkeletonBlock w={36} rounded="full" />
              <div className="flex-1 space-y-2">
                <SkeletonLine w={i % 2 ? '46%' : '62%'} />
                <SkeletonLine w="34%" className="h-3" />
              </div>
            </div>
            <div className="hidden md:flex gap-1.5">
              <SkeletonBlock w={64} h={20} rounded="full" />
              <SkeletonBlock w={48} h={20} rounded="full" />
            </div>
            <SkeletonLine w="70%" className="hidden md:block h-3" />
            <SkeletonLine w={20} className="hidden md:block h-3 justify-self-end" />
            <SkeletonLine w={20} className="hidden md:block h-3 justify-self-end" />
            <span />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Clients() {
  const [searchParams, setSearchParams] = useSearchParams()
  const user = useCurrentUser()
  const clients = useStore((s) => s.clients)
  const clientCategories = useStore((s) => s.clientCategories)
  const projects = useStore((s) => s.projects)
  const tasks = useStore((s) => s.tasks)
  const hydrated = useStore((s) => s.hydrated)

  const canEdit = can(user, 'clients', 'edit')

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [engagementFilter, setEngagementFilter] = useState('')
  const [tab, setTab] = useState<StatusTab>('all')
  const [modalOpen, setModalOpen] = useState(false)

  // Command-palette quick-create lands on ?new=1 → auto-open the create modal
  // (during render — the flag is URL state), then the effect strips the flag.
  const newFlag = searchParams.get('new') === '1'
  const [newSeen, setNewSeen] = useState(false)
  if (newFlag !== newSeen) {
    setNewSeen(newFlag)
    if (newFlag && canEdit) setModalOpen(true)
  }
  useEffect(() => {
    if (!newFlag) return
    const next = new URLSearchParams(searchParams)
    next.delete('new')
    setSearchParams(next, { replace: true })
  }, [newFlag, searchParams, setSearchParams])

  const categoryById = useMemo(
    () => new Map(clientCategories.map((c) => [c.id, c])),
    [clientCategories],
  )

  const counts = useMemo(() => {
    const openTasks = new Map<string, number>()
    const activeProjects = new Map<string, number>()
    for (const t of tasks) {
      if (t.archived || t.status === 'done') continue
      openTasks.set(t.clientId, (openTasks.get(t.clientId) ?? 0) + 1)
    }
    for (const p of projects) {
      if (p.status === 'done') continue
      activeProjects.set(p.clientId, (activeProjects.get(p.clientId) ?? 0) + 1)
    }
    return { openTasks, activeProjects }
  }, [tasks, projects])

  // Search + category + engagement filters (status tab applied after, so tab
  // counts reflect the other filters).
  const base = useMemo(() => {
    const q = search.trim().toLowerCase()
    return clients
      .filter((c) => {
        if (q) {
          const hay = `${c.name} ${c.company ?? ''} ${c.email ?? ''}`.toLowerCase()
          if (!hay.includes(q)) return false
        }
        if (categoryFilter && c.categoryId !== categoryFilter) return false
        if (engagementFilter && c.engagement !== engagementFilter) return false
        return true
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [clients, search, categoryFilter, engagementFilter])

  const tabCounts = useMemo(() => {
    const out: Record<StatusTab, number> = { all: base.length, active: 0, paused: 0, ended: 0 }
    for (const c of base) out[c.status]++
    return out
  }, [base])

  const visible = tab === 'all' ? base : base.filter((c) => c.status === tab)

  const sortedCategories = [...clientCategories].sort((a, b) => a.sortOrder - b.sortOrder)

  // First load of the roster this session: rows arrive 40ms apart, once —
  // never again on a filter keystroke or a tab change.
  const { ref: attachStagger, className: staggerClass } = useStagger<HTMLUListElement>('clients-list')

  return (
    <Layout
      title="Clients"
      subtitle={`${clients.length} ${clients.length === 1 ? 'client' : 'clients'} in your roster`}
    >
      <div className="mx-auto max-w-6xl space-y-4">
        {/* Filter bar */}
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="relative flex-1 min-w-0">
            <MagnifyingGlassIcon
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" aria-hidden
            />
            <input
              type="search"
              className="input w-full pl-9"
              placeholder="Search name, company, or email…"
              aria-label="Search clients"
              enterKeyHint="search"
              autoCapitalize="none"
              autoCorrect="off"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 sm:flex gap-3">
            <select
              className="input min-w-0 sm:w-44"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              aria-label="Filter by category"
            >
              <option value="">All categories</option>
              {sortedCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              className="input min-w-0 sm:w-44"
              value={engagementFilter}
              onChange={(e) => setEngagementFilter(e.target.value)}
              aria-label="Filter by engagement"
            >
              <option value="">All engagements</option>
              {(Object.keys(ENGAGEMENT_LABELS) as Engagement[]).map((e) => (
                <option key={e} value={e}>
                  {ENGAGEMENT_LABELS[e]}
                </option>
              ))}
            </select>
            {canEdit && (
              <button className="btn-primary justify-center max-sm:col-span-2 pointer-coarse:min-h-11" onClick={() => setModalOpen(true)}>
                <PlusIcon size={16} aria-hidden />
                New client
              </button>
            )}
          </div>
        </div>

        {/* Status tabs: the active marker glides to the new tab (instant from the keyboard). */}
        <IndicatorGroup id="clients-status">
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1" role="group" aria-label="Filter by status">
            {TABS.map(([value, label]) => {
              const active = tab === value
              return (
                <button
                  key={value}
                  aria-pressed={active}
                  className={classNames(
                    'chip pressable relative min-h-8 px-3 whitespace-nowrap pointer-coarse:min-h-11 pointer-coarse:px-3.5',
                    active
                      ? 'border-transparent text-brand-700 dark:text-brand-300'
                      : 'border-ink-600 text-ink-200 hover:text-ink-50 hover:border-ink-500',
                  )}
                  onClick={() => setTab(value)}
                >
                  {active && (
                    <LayoutIndicator
                      layoutId="clients-status"
                      radius={999}
                      className="absolute -inset-px border border-brand-500/35 bg-brand-500/12"
                    />
                  )}
                  <span className="relative inline-flex items-center gap-1.5">
                    {label}
                    <span className="tabular-nums text-[11px] opacity-75">{tabCounts[value]}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </IndicatorGroup>

        {/* Roster */}
        {!hydrated ? (
          <RosterSkeleton />
        ) : visible.length === 0 ? (
          <EmptyState
            glyph={clients.length === 0 ? 'clients' : 'search-empty'}
            title={clients.length === 0 ? 'No clients yet' : 'No clients match your filters'}
            description={
              clients.length === 0
                ? 'Add your first client to start tracking projects, tasks, and hours.'
                : 'Try a different search, category, or status tab.'
            }
            action={
              canEdit && clients.length === 0 ? (
                <button className="btn-primary" onClick={() => setModalOpen(true)}>
                  <PlusIcon size={16} aria-hidden />
                  New client
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="card overflow-hidden">
            <div
              className={classNames('hidden md:grid gap-4 px-4 py-2.5 border-b border-ink-600 section-title text-[11px]', ROW_GRID)}
              aria-hidden
            >
              <span>Client</span>
              <span>Engagement</span>
              <span>Contact</span>
              <span className="text-right">Open tasks</span>
              <span className="text-right">Projects</span>
              <span />
            </div>
            <ul ref={attachStagger} className={classNames('divide-y divide-ink-600', staggerClass)}>
              {visible.map((c) => (
                <ClientRow
                  key={c.id}
                  client={c}
                  category={c.categoryId ? categoryById.get(c.categoryId) : undefined}
                  openTasks={counts.openTasks.get(c.id) ?? 0}
                  activeProjects={counts.activeProjects.get(c.id) ?? 0}
                />
              ))}
            </ul>
          </div>
        )}
      </div>

      <ClientModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </Layout>
  )
}

function ClientRow({
  client,
  category,
  openTasks,
  activeProjects,
}: {
  client: Client
  category?: ClientCategory
  openTasks: number
  activeProjects: number
}) {
  const taskFigure = (
    <span className="inline-flex items-center gap-1">
      <CheckSquareIcon size={14} className="text-ink-400 md:hidden" aria-hidden />
      <span className="tabular-nums text-ink-50">{openTasks.toLocaleString()}</span>
      <span className="md:sr-only">open {openTasks === 1 ? 'task' : 'tasks'}</span>
    </span>
  )
  const projectFigure = (
    <span className="inline-flex items-center gap-1">
      <BriefcaseIcon size={14} className="text-ink-400 md:hidden" aria-hidden />
      <span className="tabular-nums text-ink-50">{activeProjects.toLocaleString()}</span>
      <span className="md:sr-only">active {activeProjects === 1 ? 'project' : 'projects'}</span>
    </span>
  )
  return (
    <li data-item-kind="client" data-item-id={client.id} data-item-label={client.name} data-item-path={`/clients/${client.id}`}>
      {/* The whole row is the link. A ruled row can't scale without its
          hairlines shifting, so its press is a deeper tint, on press-down. */}
      <Link
        to={`/clients/${client.id}`}
        className={classNames(
          'group grid gap-x-4 gap-y-2 px-4 py-3.5 items-center',
          'transition-colors duration-150 ease-[ease] hover:bg-ink-700/40 active:bg-ink-700/70 [-webkit-touch-callout:none]',
          'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 focus-visible:ring-offset-0',
          ROW_GRID,
        )}
      >
        <div className="flex items-center gap-3 min-w-0">
          <ClientAvatar client={client} size="sm" />
          <div className="min-w-0">
            <div
              className="text-sm font-medium text-ink-50 truncate text-left group-hover:text-brand-700 dark:group-hover:text-brand-300 transition-colors duration-150 ease-[ease]"
              title={client.name}
              dir="auto"
            >
              {client.name}
            </div>
            {client.company && (
              <div className="text-xs text-ink-300 truncate" title={client.company}>{client.company}</div>
            )}
            {client.notes && (
              <p className="mt-0.5 text-xs text-ink-400 truncate max-md:hidden" title={client.notes}>{client.notes}</p>
            )}
          </div>
        </div>

        {/* Phones: chips + figures on their own line under the name. */}
        <div className="col-span-2 md:col-span-1 row-start-2 md:row-start-auto flex flex-wrap items-center gap-1.5 min-w-0 pl-12 md:pl-0">
          <EngagementTag engagement={client.engagement} />
          <ClientStatusChip status={client.status} />
          {category && <CategoryChip category={category} />}
          <span className="md:hidden ml-auto inline-flex items-center gap-3 text-xs text-ink-300">
            {taskFigure}
            {projectFigure}
          </span>
        </div>

        <div className="hidden md:block min-w-0 space-y-0.5 text-xs text-ink-200">
          {client.email && (
            <div className="flex items-center gap-2 min-w-0">
              <EnvelopeSimpleIcon size={14} className="text-ink-400 shrink-0" aria-hidden />
              <span className="truncate" title={client.email}>{client.email}</span>
            </div>
          )}
          {client.phone && (
            <div className="flex items-center gap-2 min-w-0">
              <PhoneIcon size={14} className="text-ink-400 shrink-0" aria-hidden />
              <span className="truncate tabular-nums">{client.phone}</span>
            </div>
          )}
          {!client.email && !client.phone && <span className="text-ink-400">—</span>}
        </div>

        <span className="hidden md:block text-right text-sm">{taskFigure}</span>
        <span className="hidden md:block text-right text-sm">{projectFigure}</span>

        <CaretRightIcon
          size={16}
          className="justify-self-end text-ink-400 transition-colors duration-150 ease-[ease] group-hover:text-ink-200"
          aria-hidden
        />
      </Link>
    </li>
  )
}
