import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { CalendarDotsIcon, CaretDownIcon, CaretRightIcon, ListChecksIcon, PlusIcon } from '@phosphor-icons/react'
import Layout from '../components/Layout'
import Avatar from '../components/Avatar'
import { PhaseChip, StatusChip } from '../components/Chips'
import { phaseOf, statusesFor } from '../lib/projectPhase'
import { EmptyState } from '../components/ui-foundation'
import ProjectModal from '../components/projects/ProjectModal'
import CategoryPill, { ColorChip, hexPillStyle } from '../components/projects/CategoryPill'
import { ClientSelect } from '../components/pickers'
import {
  AnimatePresence, IndicatorGroup, LayoutIndicator, SPRING, Skeleton, TWEEN, isKeyboardInitiated, m, useStagger,
} from '../components/motion'
import { useStore, useCurrentUser } from '../store/useStore'
import { can } from '../lib/permissions'
import { classNames, daysUntil, fmtDate, fmtMoney } from '../lib/format'
import type { Project, ProjectStatus } from '../lib/types'

const STATUSES: { key: ProjectStatus; title: string; accent: string }[] = [
  { key: 'backlog', title: 'Backlog', accent: 'bg-ink-400' },
  { key: 'planning', title: 'Planning', accent: 'bg-sky-400' },
  { key: 'in_progress', title: 'In Progress', accent: 'bg-brand-500' },
  { key: 'waiting', title: 'Waiting', accent: 'bg-amber-400' },
  { key: 'done', title: 'Done', accent: 'bg-emerald-400' },
]

const STATUS_ORDER: Record<ProjectStatus, number> = {
  in_progress: 0,
  waiting: 1,
  planning: 2,
  backlog: 3,
  done: 4,
}

// The list's column grid, shared by the headings, the rows and the skeleton
// so all three line up to the pixel.
const ROW_GRID = 'md:grid-cols-[minmax(0,1fr)_150px_150px_120px_110px_80px]'

/** Loading rows shaped like the real ones: dot + title + chips, then the cells. */
function ProjectsSkeleton() {
  return (
    <div className="card overflow-hidden" aria-busy="true" aria-label="Loading projects">
      <div className={classNames('hidden md:grid gap-3 px-4 py-2.5 border-b border-ink-600', ROW_GRID)}>
        {[56, 44, 52, 28, 44, 36].map((w, i) => (
          <Skeleton key={i} w={w} h={10} className={i >= 4 ? 'ml-auto' : undefined} />
        ))}
      </div>
      <ul className="divide-y divide-ink-600">
        {[62, 48, 70, 54, 40, 58].map((w, i) => (
          <li key={i} className={classNames('grid grid-cols-2 gap-x-3 gap-y-2.5 px-4 py-3.5 items-center', ROW_GRID)}>
            <div className="col-span-2 md:col-span-1 flex items-start gap-3">
              <Skeleton w={8} h={8} rounded="full" className="mt-1.5 shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton w={`${w}%`} h={14} />
                <div className="flex gap-1.5">
                  <Skeleton w={84} h={18} rounded="full" />
                  <Skeleton w={64} h={18} rounded="full" />
                </div>
              </div>
            </div>
            <Skeleton w={104} h={26} />
            <div className="flex items-center gap-2">
              <Skeleton w={24} h={24} rounded="full" className="shrink-0" />
              <Skeleton w={64} h={12} />
            </div>
            <Skeleton w={84} h={12} />
            <Skeleton w={60} h={12} className="md:ml-auto" />
            <Skeleton w={40} h={20} className="md:ml-auto" />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** done/total tasks — a quiet figure that turns emerald when every task is done. */
function TaskProgress({ stats }: { stats: { open: number; total: number } }) {
  const complete = stats.open === 0
  return (
    <span
      className={classNames(
        'inline-flex items-center gap-1 whitespace-nowrap text-[11px] tabular-nums',
        complete ? 'text-emerald-700 dark:text-emerald-400' : 'text-ink-200',
      )}
      title={`${stats.open} open of ${stats.total} tasks`}
    >
      <ListChecksIcon
        size={12}
        weight={complete ? 'fill' : 'regular'}
        className={complete ? undefined : 'text-ink-400'}
        aria-hidden
      />
      {stats.total - stats.open}/{stats.total}
    </span>
  )
}

/**
 * A row leaving the list after its status changed (the Active filter dropping
 * a project that just went to Done) fades out; anything else — a filter
 * change — removes rows at once. `custom` is read at exit time.
 */
const ROW_VARIANTS = {
  exit: (armed: boolean) => ({ opacity: 0, transition: armed ? TWEEN.popoverExit : TWEEN.instant }),
}

function dueTone(days: number | null, status: ProjectStatus): string {
  if (days === null || status === 'done') return 'text-ink-300'
  if (days < 0) return 'text-rose-600 dark:text-rose-400'
  if (days <= 3) return 'text-amber-700 dark:text-amber-400'
  return 'text-ink-300'
}

/**
 * Projects as a flat, scannable list — one row per project, active work first.
 * Status changes go through the inline select (editors) instead of drag.
 */
export default function Projects() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const user = useCurrentUser()
  const hydrated = useStore((s) => s.hydrated)
  const projects = useStore((s) => s.projects)
  const clients = useStore((s) => s.clients)
  const projectCategories = useStore((s) => s.projectCategories)
  const users = useStore((s) => s.users)
  const tasks = useStore((s) => s.tasks)
  const moveProject = useStore((s) => s.moveProject)

  const canEdit = can(user, 'projects', 'edit')

  const clientFilter = searchParams.get('client') ?? ''
  const [categoryFilter, setCategoryFilter] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState<string | undefined>(undefined)
  const [statusFilter, setStatusFilter] = useState<'active' | 'all' | ProjectStatus>('active')
  const [modalOpen, setModalOpen] = useState(false)
  // Armed by a status change from a pointer: the list re-sorts by status, so
  // the changed row glides to its new place instead of teleporting there
  // (spatial consistency, SPRING.ui). Any filter change disarms it — filtering
  // swaps the list at once. Keyboard changes stay instant (frequency gate);
  // reduced motion drops layout animation globally (MotionConfig).
  const [reorderArmed, setReorderArmed] = useState(false)
  const filterKey = `${searchParams.get('client') ?? ''}|${categoryFilter}|${assigneeFilter ?? ''}|${statusFilter}`
  const [armedFor, setArmedFor] = useState(filterKey)
  if (armedFor !== filterKey) {
    setArmedFor(filterKey)
    setReorderArmed(false)
  }

  const setClientFilter = (id: string) => {
    const next = new URLSearchParams(searchParams)
    if (id) next.set('client', id)
    else next.delete('client')
    setSearchParams(next, { replace: true })
    setCategoryFilter('')
  }

  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients])
  const categoryById = useMemo(() => new Map(projectCategories.map((c) => [c.id, c])), [projectCategories])
  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users])

  const clientCategories = useMemo(
    () => projectCategories.filter((c) => c.clientId === clientFilter).sort((a, b) => a.sortOrder - b.sortOrder),
    [projectCategories, clientFilter],
  )

  /** open/total tasks per project, for the row's progress column. */
  const taskStats = useMemo(() => {
    const m = new Map<string, { open: number; total: number }>()
    for (const t of tasks) {
      if (!t.projectId || t.archived || t.parentTaskId) continue
      const s = m.get(t.projectId) ?? { open: 0, total: 0 }
      s.total++
      if (t.status !== 'done') s.open++
      m.set(t.projectId, s)
    }
    return m
  }, [tasks])

  // Everything the client, category and assignee filters let through. The
  // status tabs count this list, so each tab says how many rows it will show.
  const scoped = useMemo(
    () =>
      projects
        .filter((p) => !clientFilter || p.clientId === clientFilter)
        .filter((p) => !categoryFilter || p.categoryId === categoryFilter)
        .filter((p) => !assigneeFilter || p.assigneeId === assigneeFilter),
    [projects, clientFilter, categoryFilter, assigneeFilter],
  )

  const counts = useMemo(() => {
    const c: Record<ProjectStatus, number> = { backlog: 0, planning: 0, in_progress: 0, waiting: 0, done: 0 }
    for (const p of scoped) c[p.status]++
    return c
  }, [scoped])

  const filtered = useMemo(
    () =>
      scoped
        .filter((p) =>
          statusFilter === 'all' ? true : statusFilter === 'active' ? p.status !== 'done' : p.status === statusFilter,
        )
        .sort(
          (a, b) =>
            STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
            (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
            a.position - b.position,
        ),
    [scoped, statusFilter],
  )

  // Command palette quick-create routes to /projects?new=1 — honour it, then
  // strip the flag so a refresh or back-nav doesn't re-open the modal. The
  // modal opens during render (the flag is URL state); the effect only strips it.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newFlag])

  const changeStatus = (p: Project, status: ProjectStatus) => {
    if (status === p.status) return
    // Positions are scoped per client; append to the end of the new status.
    const position = projects
      .filter((x) => x.clientId === p.clientId && x.status === status)
      .reduce((m, x) => Math.max(m, x.position + 1), 0)
    const result = moveProject(p.id, status, position)
    if (!result.ok) {
      toast.error(result.error ?? 'Could not change the status')
      return
    }
    setReorderArmed(!isKeyboardInitiated())
    toast.success(`Moved to ${STATUSES.find((s) => s.key === status)?.title ?? status}`)
  }

  const activeCount = scoped.length - counts.done
  // Rows re-measure for the reorder glide only when the order itself changes.
  const orderKey = filtered.map((p) => p.id).join()

  // First load of the list this session: rows arrive 40ms apart (never on filters).
  const { ref: attachStagger, className: staggerClass } = useStagger<HTMLUListElement>('projects-list')

  const statusTabs = [
    { key: 'active', title: 'Active', count: activeCount },
    ...STATUSES.map((s) => ({ key: s.key, title: s.title, count: counts[s.key], accent: s.accent })),
    { key: 'all', title: 'All', count: scoped.length },
  ] as { key: typeof statusFilter; title: string; count: number; accent?: string }[]

  return (
    <Layout
      title="Projects"
      subtitle={`${activeCount} active · ${counts.done} done`}
    >
      <div className="space-y-4">
        {/* Toolbar — phones: the two filters share a row, the action takes the next. */}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center pointer-coarse:[&_select]:min-h-11">
          <label className="min-w-0 sm:w-60">
            <span className="sr-only">Filter by client</span>
            <ClientSelect value={clientFilter} onChange={setClientFilter} allowAll />
          </label>
          <label className="min-w-0 sm:w-52">
            <span className="sr-only">Filter by assignee</span>
            {/* Its own select, not AssigneeSelect: that picker's empty option reads
                "Unassigned", but here empty means every assignee. */}
            <select
              className="input w-full"
              value={assigneeFilter ?? ''}
              onChange={(e) => setAssigneeFilter(e.target.value || undefined)}
            >
              <option value="">All assignees</option>
              {[...users]
                .sort((a, b) => a.fullName.localeCompare(b.fullName))
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
            </select>
          </label>
          {canEdit && (
            <button className="btn-primary col-span-2 sm:ml-auto pointer-coarse:min-h-11" onClick={() => setModalOpen(true)}>
              <PlusIcon size={14} aria-hidden />
              New project
            </button>
          )}
        </div>

        {/* Status filter — the selected tab's fill glides to the new one. */}
        <IndicatorGroup id="projects-status">
          {/* Phones: one line that scrolls sideways (bleeding to the screen edges)
              instead of two tall rows of 44px chips above the list. */}
          <div
            className="flex items-center gap-1.5 max-sm:-mx-4 max-sm:overflow-x-auto max-sm:overscroll-x-contain max-sm:px-4 max-sm:py-px max-sm:[scrollbar-width:none] sm:flex-wrap"
            role="group"
            aria-label="Filter by status"
          >
            {statusTabs.map((s) => {
              const active = statusFilter === s.key
              return (
                <button
                  key={s.key}
                  aria-pressed={active}
                  className={classNames(
                    'chip pressable relative min-h-8 shrink-0 whitespace-nowrap px-2.5 pointer-coarse:min-h-11 pointer-coarse:px-3',
                    active
                      ? 'border-transparent text-brand-700 dark:text-brand-300'
                      : 'border-ink-500 text-ink-300 hover:text-ink-100 hover:border-ink-400',
                  )}
                  onClick={() => setStatusFilter(s.key)}
                >
                  {active && (
                    <LayoutIndicator
                      layoutId="projects-status"
                      radius={999}
                      className="absolute -inset-px border border-brand-500/35 bg-brand-500/12"
                    />
                  )}
                  <span className="relative inline-flex items-center gap-1.5">
                    {s.accent && <span className={classNames('w-1.5 h-1.5 rounded-full', s.accent)} aria-hidden />}
                    {s.title}
                    <span className="tabular-nums text-[10px] opacity-75">{s.count}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </IndicatorGroup>

        {/* Category chips for the selected client */}
        {clientFilter !== '' && clientCategories.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by category">
            <button
              aria-pressed={categoryFilter === ''}
              className={classNames(
                'chip pressable min-h-8 px-2.5 pointer-coarse:min-h-11 pointer-coarse:px-3',
                categoryFilter === ''
                  ? 'bg-ink-700 text-ink-50 border-ink-400'
                  : 'border-ink-500 text-ink-300 hover:text-ink-100 hover:border-ink-400',
              )}
              onClick={() => setCategoryFilter('')}
            >
              All categories
            </button>
            {clientCategories.map((c) => {
              const active = categoryFilter === c.id
              return (
                <button
                  key={c.id}
                  aria-pressed={active}
                  className={classNames(
                    'chip pressable min-h-8 max-w-full px-2.5 pointer-coarse:min-h-11 pointer-coarse:px-3',
                    active
                      ? 'bg-ink-700 text-ink-50 border-ink-400'
                      : 'border-ink-500 text-ink-300 hover:text-ink-100 hover:border-ink-400',
                  )}
                  style={active ? hexPillStyle(c.color) : undefined}
                  onClick={() => setCategoryFilter(active ? '' : c.id)}
                >
                  {c.color && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} aria-hidden />
                  )}
                  <span className="truncate">{c.name}</span>
                </button>
              )
            })}
          </div>
        )}

        {!hydrated ? (
          <ProjectsSkeleton />
        ) : filtered.length === 0 ? (
          <EmptyState
            glyph="projects"
            title={projects.length === 0 ? 'No projects yet' : 'No projects match these filters'}
            description={
              projects.length === 0
                ? 'Spin up the first project to start tracking scope, budget and status.'
                : 'Try a different client, status or assignee — or clear the filters to see everything.'
            }
            action={
              canEdit && projects.length === 0 ? (
                <button className="btn-primary" onClick={() => setModalOpen(true)}>
                  <PlusIcon size={14} aria-hidden />
                  New project
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="card overflow-hidden">
            {/* Column headings — desktop only; rows stack on phones. */}
            <div
              className={classNames('hidden md:grid gap-3 px-4 py-2.5 border-b border-ink-600 section-title text-[10px]', ROW_GRID)}
              aria-hidden
            >
              <span>Project</span>
              <span>Status</span>
              <span>Assignee</span>
              <span>Due</span>
              <span className="text-right">Budget</span>
              <span className="text-right">Tasks</span>
            </div>
            <ul ref={attachStagger} className={classNames('relative divide-y divide-ink-600', staggerClass)}>
              <AnimatePresence initial={false} mode="popLayout" custom={reorderArmed}>
              {filtered.map((p) => {
                const client = clientById.get(p.clientId)
                const category = p.categoryId ? categoryById.get(p.categoryId) : undefined
                const assignee = p.assigneeId ? userById.get(p.assigneeId) : undefined
                const du = daysUntil(p.dueDate)
                const stats = taskStats.get(p.id)
                const accent = STATUSES.find((s) => s.key === p.status)?.accent
                const open = () => navigate(`/projects/${p.id}`)
                return (
                  // Phones: the project spans both columns, then status · assignee,
                  // due · budget and tasks pair up — 4 lines a row instead of 6.
                  <m.li
                    key={p.id}
                    data-item-kind="project" data-item-id={p.id} data-item-label={p.title} data-item-path={`/projects/${p.id}`}
                    layout="position"
                    layoutDependency={orderKey}
                    transition={{ layout: reorderArmed ? SPRING.ui : TWEEN.instant }}
                    variants={ROW_VARIANTS}
                    exit="exit"
                    className={classNames(
                      'group grid grid-cols-2 gap-x-3 gap-y-2.5 bg-ink-800 px-4 py-3.5 items-center hover:bg-ink-700/40 transition-colors duration-150 ease-[ease]',
                      ROW_GRID,
                    )}
                  >
                    {/* Project */}
                    <button
                      className="pressable-card col-span-2 md:col-span-1 min-w-0 text-left flex items-start gap-3 rounded-md focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500"
                      onClick={open}
                      aria-label={`Open project: ${p.title}`}
                    >
                      <span className={classNames('mt-1.5 w-2 h-2 rounded-full shrink-0', accent)} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span
                          dir="auto"
                          className="block text-start text-sm font-medium max-md:text-base max-md:font-semibold leading-snug text-ink-50 line-clamp-2 [overflow-wrap:anywhere] group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors duration-150 ease-[ease]"
                          title={p.title}
                        >
                          {p.title}
                        </span>
                        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <PhaseChip phase={phaseOf(p)} className="text-[11px]" />
                            {client && clientFilter === '' && (
                              <ColorChip color={client.color} className="max-w-56 text-[11px]">
                                {client.name}
                              </ColorChip>
                            )}
                            {category && <CategoryPill category={category} />}
                        </span>
                      </span>
                      {/* Phones: progress rides the title line rather than taking a row of its own. */}
                      {stats && (
                        <span className="mt-0.5 shrink-0 md:hidden">
                          <TaskProgress stats={stats} />
                        </span>
                      )}
                      <CaretRightIcon size={16} className="md:hidden text-ink-400 shrink-0 mt-0.5" aria-hidden />
                    </button>

                    {/* Status — a quiet select: reads as a label, shows its edge on hover / focus.
                        Only the statuses its stage allows: Done comes from launching on the
                        project page, so a launched project's status just reads. */}
                    <div className="flex items-center md:block">
                      {canEdit && phaseOf(p) !== 'launched' ? (
                        // Phones: the status reads as its small chip, and the select lies
                        // invisibly over it (the platform picker on tap). Shown as a field
                        // there, the 16px phone input size made it the largest text in the row.
                        <div className="relative md:w-full md:max-w-[160px] max-md:inline-flex max-md:min-h-11 max-md:items-center max-md:gap-1 max-md:rounded-md max-md:has-focus-visible:ring-2 max-md:has-focus-visible:ring-brand-500">
                          <span className="md:hidden"><StatusChip status={p.status} /></span>
                          <CaretDownIcon size={12} className="md:hidden text-ink-400" aria-hidden />
                          <span
                            className={classNames('pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full max-md:hidden', accent)}
                            aria-hidden
                          />
                          {/* focus:bg + the option colours: a transparent select hands Chrome
                              a white option list, under near-white text in the dark theme. */}
                          <select
                            className="input w-full py-1 pl-6 text-xs border-transparent! bg-transparent! shadow-none! hover:border-ink-500! focus:border-brand-500! focus:bg-ink-850! [&>option]:bg-ink-800 [&>option]:text-ink-50 pointer-coarse:min-h-11 max-md:absolute max-md:inset-0 max-md:h-full max-md:cursor-pointer max-md:opacity-0"
                            value={p.status}
                            aria-label={`Status of ${p.title}`}
                            onChange={(e) => changeStatus(p, e.target.value as ProjectStatus)}
                          >
                            {STATUSES.filter((s) => s.key === p.status || statusesFor(p).includes(s.key)).map((s) => (
                              <option key={s.key} value={s.key}>
                                {s.title}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <StatusChip status={p.status} />
                      )}
                    </div>

                    {/* Assignee */}
                    <div className="flex items-center gap-2 min-w-0 text-xs text-ink-200">
                      {assignee ? (
                        <>
                          <Avatar name={assignee.fullName} size="sm" />
                          <span className="truncate" title={assignee.fullName}>{assignee.fullName}</span>
                        </>
                      ) : (
                        <span className="text-ink-300">Unassigned</span>
                      )}
                    </div>

                    {/* Due */}
                    <div className={classNames('flex flex-wrap items-center gap-x-1 text-[11px] tabular-nums', dueTone(du, p.status))}>
                      {p.dueDate ? (
                        <>
                          <CalendarDotsIcon size={12} className="shrink-0" aria-hidden />
                          <span className="md:hidden text-ink-300 mr-1">Due</span>
                          <span className="whitespace-nowrap">{fmtDate(p.dueDate)}</span>
                          {du !== null && du < 0 && p.status !== 'done' && (
                            <span className="text-[10px] uppercase tracking-wide">overdue</span>
                          )}
                        </>
                      ) : (
                        <span className="text-ink-400">—</span>
                      )}
                    </div>

                    {/* Budget */}
                    <div className="text-xs tabular-nums text-ink-100 whitespace-nowrap md:text-right">
                      {p.budget != null && p.budget > 0 ? (
                        <>
                          <span className="md:hidden text-ink-300 mr-1">Budget</span>
                          {fmtMoney(p.budget)}
                        </>
                      ) : (
                        <span className="text-ink-400">—</span>
                      )}
                    </div>

                    {/* Tasks — desktop column (phones show it on the title line). */}
                    <div className="hidden md:block md:text-right">
                      {stats ? (
                        <TaskProgress stats={stats} />
                      ) : (
                        <span className="text-[11px] text-ink-300">no tasks</span>
                      )}
                    </div>
                  </m.li>
                )
              })}
              </AnimatePresence>
            </ul>
          </div>
        )}
      </div>

      <ProjectModal open={modalOpen} onClose={() => setModalOpen(false)} defaultClientId={clientFilter || undefined} />
    </Layout>
  )
}
