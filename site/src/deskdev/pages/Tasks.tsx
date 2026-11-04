import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  CalendarDotsIcon, ClockIcon, EyeIcon, EyeSlashIcon, FileTextIcon, FunnelSimpleIcon, ListChecksIcon, PlusIcon,
} from '@phosphor-icons/react'
import Layout from '../components/Layout'
import KanbanBoard, { type KanbanColumn } from '../components/KanbanBoard'
import Avatar from '../components/Avatar'
import EodReportModal from '../components/EodReportModal'
import TaskModal from '../components/tasks/TaskModal'
import TaskActions from '../components/tasks/TaskActions'
import { TaskStatusChip } from '../components/Chips'
import { webHref } from '../lib/links'
import { PriorityChip } from '../components/Chips'
import { ClientSelect, PrioritySelect } from '../components/pickers'
import { EmptyState } from '../components/ui-foundation'
import { Skeleton } from '../components/motion'
import Popover from '../components/crm/Popover'
import { useMediaQuery } from '../pwa/useMediaQuery'
import { FieldError, INVALID_INPUT } from '../components/tasks/formBits'
import { useStore, useCurrentUser } from '../store/useStore'
import { can } from '../lib/permissions'
import { classNames, daysUntil, fmtDate, fmtMinutes, fmtRelative, isoDate } from '../lib/format'
import { blockedBySubtasksMessage, subtaskProgress, taskPeople } from '../lib/tasks'
import type { Priority, Task, TaskStatus } from '../lib/types'

// Accents mirror TaskStatusChip (components/Chips.tsx) so a status reads the
// same colour on the column header, the card chip and the detail view.
const COLUMNS: KanbanColumn[] = [
  { key: 'todo', title: 'To Do', accent: 'bg-ink-400' },
  { key: 'in_progress', title: 'In Progress', accent: 'bg-brand-500' },
  { key: 'blocked', title: 'Blocked', accent: 'bg-rose-400' },
  { key: 'done', title: 'Done', accent: 'bg-emerald-400' },
]

function dueTone(days: number | null): string {
  if (days === null) return 'text-ink-300'
  if (days < 0) return 'text-rose-600 dark:text-rose-400'
  if (days <= 1) return 'text-amber-700 dark:text-amber-400'
  return 'text-ink-300'
}

/**
 * The due date on a card. This year's dates drop the year ("Oct 14"), so the
 * date and the logged time share one line in a 235px column; the full date
 * stays in the tooltip.
 */
function fmtDueShort(iso: string): string {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso)
  if (d.getFullYear() !== new Date().getFullYear()) return fmtDate(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Loading board shaped like the task cards themselves — context line, title,
 * "Added …", then due date on the left and priority + avatar on the right —
 * inside the same lanes KanbanBoard draws, so nothing jumps when data lands.
 */
function TasksBoardSkeleton() {
  // A few lane lengths so the board doesn't read as a stamped grid.
  const perColumn = [3, 2, 2, 1]
  return (
    <div
      className="flex md:grid gap-4 overflow-x-hidden pb-2 max-md:-mx-4 max-md:px-4"
      style={{ gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(0, 1fr))` }}
      aria-busy="true"
      aria-label="Loading board"
    >
      {COLUMNS.map((col, ci) => (
        <section key={col.key} className="min-w-[280px] md:min-w-0 rounded-xl border border-ink-600 bg-ink-850/60 flex flex-col">
          <header className="px-3 py-2.5 flex items-center gap-2 border-b border-ink-600">
            <span className={classNames('w-2 h-2 rounded-full shrink-0', col.accent)} aria-hidden />
            <span className="section-title truncate">{col.title}</span>
            <Skeleton w={10} h={12} rounded="sm" className="ml-auto" />
          </header>
          <div className="p-2 space-y-2 min-h-[120px]">
            {Array.from({ length: perColumn[ci] ?? 1 }).map((_, i) => (
              <div key={i} className="card p-3">
                <Skeleton w={i % 2 ? 72 : 96} h={10} />
                <Skeleton w={i % 2 ? '58%' : '78%'} h={14} className="mt-2.5" />
                <Skeleton w={64} h={9} className="mt-2" />
                <div className="mt-3.5 flex items-center gap-2">
                  <Skeleton w={76} h={11} />
                  <Skeleton w={34} h={18} rounded="full" className="ml-auto" />
                  <Skeleton w={24} h={24} rounded="full" />
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

/**
 * The assignee and collaborators of a card, overlapped: three faces, then
 * "+n". One name is spelled out for screen readers and the tooltip.
 */
function PeopleStack({ people }: { people: { id: string; fullName: string }[] }) {
  const shown = people.slice(0, 3)
  const more = people.length - shown.length
  const names = people.map((p) => p.fullName).join(', ')
  return (
    <span className="flex items-center" title={names}>
      <span className="sr-only">{people.length === 1 ? `Assigned to ${names}` : `People: ${names}`}</span>
      {shown.map((p, i) => (
        <span key={p.id} className={classNames('rounded-full ring-2 ring-ink-800', i > 0 && '-ml-2')} aria-hidden>
          <Avatar name={p.fullName} size="sm" />
        </span>
      ))}
      {more > 0 && (
        <span className="-ml-2 flex size-6 items-center justify-center rounded-full bg-ink-700 text-[10px] font-semibold tabular-nums text-ink-100 ring-2 ring-ink-800" aria-hidden>
          +{more}
        </span>
      )}
    </span>
  )
}

export default function Tasks() {
  const user = useCurrentUser()
  const hydrated = useStore((s) => s.hydrated)
  const tasks = useStore((s) => s.tasks)
  const clients = useStore((s) => s.clients)
  const projects = useStore((s) => s.projects)
  const projectCategories = useStore((s) => s.projectCategories)
  const users = useStore((s) => s.users)
  const timeEntries = useStore((s) => s.timeEntries)
  const addTask = useStore((s) => s.addTask)
  const moveTask = useStore((s) => s.moveTask)

  const canEdit = can(user, 'tasks', 'edit')

  // Filters — ?client=<id> is the shared pre-filter contract
  const [searchParams, setSearchParams] = useSearchParams()
  const clientFilter = searchParams.get('client') ?? ''
  const setClientFilter = (id: string) =>
    setSearchParams((previous) => { const next = new URLSearchParams(previous); if (id) next.set('client', id); else next.delete('client'); return next }, { replace: true })

  const [assigneeFilter, setAssigneeFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState<'all' | Priority>('all')
  const [showArchived, setShowArchived] = useState(false)
  const view = searchParams.get('view') === 'list' ? 'list' : 'board'
  const setView = (next: string) => { const params = new URLSearchParams(searchParams); params.set('view', next); setSearchParams(params, { replace: true }) }

  // Quick add
  const [qaTitle, setQaTitle] = useState('')
  const [qaClient, setQaClient] = useState(clientFilter)
  const [qaPriority, setQaPriority] = useState<Priority>('med')
  // Why quick add refused, shown under the bar (cleared as soon as the user fixes it).
  const [qaError, setQaError] = useState<string | null>(null)

  // Phones (below sm, where the filter sheet is a bottom sheet): the three
  // filter selects and Archived fold into one Filters button, and quick add
  // rests as its title field alone — five control rows above the board had
  // pushed the first card past the middle of the screen.
  const compact = useMediaQuery('(max-width: 639.98px)')
  const [filtersAnchor, setFiltersAnchor] = useState<HTMLElement | null>(null)
  const [qaFocused, setQaFocused] = useState(false)
  // Client · priority · Add appear once the composer is in use.
  const qaExpanded = !compact || qaFocused || qaTitle !== '' || qaError !== null
  // Follow the board's client filter (adjusted during render, not in an effect,
  // so the quick-add never paints a frame with the old client).
  const [qaClientFor, setQaClientFor] = useState(clientFilter)
  if (qaClientFor !== clientFilter) {
    setQaClientFor(clientFilter)
    setQaClient(clientFilter)
  }

  // Modals
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [eodOpen, setEodOpen] = useState(false)

  // Command palette quick-create routes to /tasks?new=1 — honour it, then strip
  // the flag so a refresh or back-nav doesn't re-open the create modal. The
  // modal opens during render (the flag is URL state); the effect only strips it.
  const newFlag = searchParams.get('new') === '1'
  const [newSeen, setNewSeen] = useState(false)
  if (newFlag !== newSeen) {
    setNewSeen(newFlag)
    if (newFlag && canEdit) setCreating(true)
  }
  useEffect(() => {
    if (!newFlag) return
    const next = new URLSearchParams(searchParams)
    next.delete('new')
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newFlag])

  // /tasks?task=<id> — a notification about a task lands on that task, not
  // on the board with the card somewhere in it. Stripped after opening.
  // Keep the flag until the store has the tasks — on a cold load in remote
  // mode they arrive after the first render, and a stripped flag opens nothing.
  const taskFlag = hydrated ? searchParams.get('task') : null
  const [taskSeen, setTaskSeen] = useState<string | null>(null)
  if (taskFlag !== taskSeen) {
    setTaskSeen(taskFlag)
    if (taskFlag && tasks.some((t) => t.id === taskFlag)) {
      setCreating(false)
      setEditingId(taskFlag)
    }
  }
  useEffect(() => {
    if (!taskFlag) return
    const next = new URLSearchParams(searchParams)
    next.delete('task')
    setSearchParams(next, { replace: true })
    if (!tasks.some((t) => t.id === taskFlag)) toast.error('That task no longer exists')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskFlag])
  const editingTask = useMemo(
    () => tasks.find((t) => t.id === editingId) ?? null,
    [tasks, editingId],
  )

  /** Point the (already open) modal at another task — parent or subtask. */
  const openTask = (id: string) => {
    setCreating(false)
    setEditingId(id)
  }

  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients])
  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users])
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])
  const categoryById = useMemo(
    () => new Map(projectCategories.map((c) => [c.id, c])),
    [projectCategories],
  )

  const timeByTask = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of timeEntries) {
      if (!e.taskId) continue
      m.set(e.taskId, (m.get(e.taskId) ?? 0) + e.minutes)
    }
    return m
  }, [timeEntries])

  /** done/total per parent, for the card chip. Only parents appear as keys. */
  const subtasksByParent = useMemo(() => {
    const parentIds = new Set(
      tasks.filter((t) => t.parentTaskId).map((t) => t.parentTaskId!),
    )
    return new Map([...parentIds].map((id) => [id, subtaskProgress(tasks, id)]))
  }, [tasks])

  const matchesFilters = (t: Task): boolean =>
    (clientFilter === '' || t.clientId === clientFilter) &&
    (assigneeFilter === '' ||
      (assigneeFilter === 'none'
        ? !t.assigneeId
        : t.assigneeId === assigneeFilter || (t.collaboratorIds ?? []).includes(assigneeFilter))) &&
    (priorityFilter === 'all' || t.priority === priorityFilter)

  // Subtasks are deliberately absent from the board: they live under their
  // parent card (which shows a done/total chip) and are managed in its modal.
  // A column of un-nestable children would say nothing about what gates what.
  const visible = useMemo(
    () =>
      tasks
        .filter(
          (t) =>
            !t.parentTaskId && matchesFilters(t) && (showArchived || !t.archived),
        )
        .sort(
          (a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt),
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, clientFilter, assigneeFilter, priorityFilter, showArchived],
  )

  const listItems = tasks.filter((t) => matchesFilters(t) && (showArchived || !t.archived))
    .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt))

  // Counts what the Done column shows, so subtasks are excluded here too.
  const completedToday = useMemo(() => {
    const today = isoDate()
    return tasks.filter(
      (t) =>
        !t.parentTaskId &&
        matchesFilters(t) &&
        t.status === 'done' &&
        t.completedAt &&
        isoDate(t.completedAt) === today,
    ).length
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, clientFilter, assigneeFilter, priorityFilter])

  // A completed task shows in Done only on its completion day, then drops off
  // the board the next calendar date. It still lives in EOD reports and the
  // Google Sheets activity log — this only hides it from the board.
  const boardItems = useMemo(() => {
    const today = isoDate()
    return visible.filter(
      (t) => t.status !== 'done' || (t.completedAt && isoDate(t.completedAt) === today),
    )
  }, [visible])

  const mineActive = !!user && assigneeFilter === user.id
  const filtersActive =
    clientFilter !== '' || assigneeFilter !== '' || priorityFilter !== 'all'

  // What the Filters button is hiding. Mine has its own toggle beside it.
  const sheetFilterCount =
    (clientFilter !== '' ? 1 : 0) +
    (assigneeFilter !== '' && !mineActive ? 1 : 0) +
    (priorityFilter !== 'all' ? 1 : 0) +
    (showArchived ? 1 : 0)

  const clearFilters = () => {
    setClientFilter('')
    setAssigneeFilter('')
    setPriorityFilter('all')
  }

  const handleMove = (t: Task, toKey: string) => {
    if (!canEdit) {
      toast.error('You have view-only access to tasks')
      return
    }
    const status = toKey as TaskStatus
    // Append to the end of the task's own client board column — positions
    // are scoped per client, so cross-client boards never collide.
    const position = tasks.filter(
      (x) =>
        x.clientId === t.clientId &&
        x.status === status &&
        x.id !== t.id &&
        !x.parentTaskId,
    ).length
    // Refused when the task still has open subtasks — say why rather than
    // letting the card silently snap back.
    if (!moveTask(t.id, status, position)) {
      toast.error(blockedBySubtasksMessage(tasks, t.id))
      return
    }
    if (status === 'done') toast.success('Task completed')
  }

  const submitQuickAdd = (e: React.FormEvent) => {
    e.preventDefault()
    const title = qaTitle.trim()
    if (!title) {
      setQaError('Give the task a title')
      return
    }
    if (!qaClient) {
      setQaError('Pick a client first')
      return
    }
    setQaError(null)
    try {
    addTask({ clientId: qaClient, title, priority: qaPriority })
    toast.success('Task added')
    setQaTitle('')
    } catch (error) {
      setQaError(error instanceof Error ? error.message : 'Task could not be saved. Try again.')
    }
  }

  const renderCard = (t: Task) => {
    const due = daysUntil(t.dueDate)
    const minutes = timeByTask.get(t.id) ?? 0
    const subs = subtasksByParent.get(t.id)
    const people = taskPeople(t)
      .map((id) => userById.get(id))
      .filter((u): u is NonNullable<typeof u> => Boolean(u))
    const category = t.categoryId ? categoryById.get(t.categoryId) : undefined
    const project = t.projectId ? projectById.get(t.projectId) : undefined
    // The line above the title names the project (revision 2); a task with no
    // project falls back to its client, unless the board is already filtered to it.
    const showClient = !project && clientFilter === ''
    const showContext = !!project || showClient || !!category || t.archived
    // The corner "Move to…" chip (KanbanBoard moveControl="corner") sits over
    // the top-right of the card; the first line keeps clear of it.
    const cornerClear = canEdit && 'pr-8'
    const clientName = clientById.get(t.clientId)?.name ?? 'Unknown client'
    return (
      <TaskActions task={t} canEdit={canEdit} onOpen={openTask}>
        {webHref(t.coverUrl) && <img src={t.coverUrl} alt="" referrerPolicy="no-referrer" className="mb-3 h-28 w-full rounded-md object-cover" />}
        {/* Context line — project (or client) · category, then archived. Plain
            text, not pills: the card is already the box, so its metadata stays type. */}
        {showContext && (
          <div className={classNames('mb-1 flex min-w-0 items-center gap-1.5 text-[11px] font-medium leading-5 text-ink-300', cornerClear)}>
            {project && (
              <span className="min-w-0 shrink truncate text-ink-200" title={`${project.title} — ${clientName}`}>
                <span className="sr-only">Project: </span>{project.title}
              </span>
            )}
            {showClient && (
              <span className="min-w-0 shrink truncate" title={clientName}>{clientName}</span>
            )}
            {(project || showClient) && category && <span className="shrink-0 text-ink-400" aria-hidden>·</span>}
            {category && (
              <span className="flex min-w-0 shrink-[2] items-center gap-1" title={category.name}>
                {category.color && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: category.color }} aria-hidden />
                )}
                <span className="truncate">{category.name}</span>
              </span>
            )}
            {t.archived && (
              <span className="badge badge-neutral ml-auto shrink-0 text-[10px]">Archived</span>
            )}
          </div>
        )}

        {/* Title */}
        {/* dir="auto": an Arabic or Hebrew title keeps its own direction (and its
            trailing punctuation on the correct side) inside the LTR board. */}
        <div
          dir="auto"
          className={classNames(
            'text-sm font-medium text-ink-50 leading-snug line-clamp-2 text-start [overflow-wrap:anywhere]',
            !showContext && cornerClear,
          )}
          title={t.title}
        >
          {t.status === 'blocked' && <span className="sr-only">Blocked: </span>}
          {t.title}
        </div>

        {/* When it landed on the board (or, once done, when it was completed). */}
        <div className="mt-1 text-[10px] tabular-nums text-ink-400">
          {t.status === 'done' && t.completedAt
            ? `Completed ${fmtRelative(t.completedAt)}`
            : `Added ${fmtRelative(t.createdAt)}`}
        </div>

        {/* Footer — two zones: due, logged time and subtasks on the left, priority
            + assignee pinned right. Only the left zone wraps (whole chips, never
            mid-value), so every card ends on the same line whatever it carries;
            min-h-6 is the avatar, so an unassigned card is no shorter. */}
        <div className="mt-2.5 flex min-h-6 items-center gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {t.dueDate && (
            <span
              className={classNames(
                'inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] tabular-nums',
                dueTone(due),
              )}
              title={`Due ${fmtDate(t.dueDate)}`}
            >
              <CalendarDotsIcon size={12} aria-hidden />
              {fmtDueShort(t.dueDate)}
            </span>
          )}
          {minutes > 0 && (
            <span
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] tabular-nums text-ink-200"
              title={`${fmtMinutes(minutes)} logged`}
            >
              <ClockIcon size={12} className="text-ink-400" aria-hidden />
              {fmtMinutes(minutes)}
            </span>
          )}
          {/* Subtask progress — the card can't reach Done until this is full. */}
          {subs && subs.total > 0 && (
            <span
              className={classNames(
                'inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] tabular-nums',
                subs.done === subs.total ? 'text-emerald-700 dark:text-emerald-400' : 'text-ink-200',
              )}
              title={`${subs.done} of ${subs.total} subtasks done`}
            >
              <ListChecksIcon
                size={12}
                weight={subs.done === subs.total ? 'fill' : 'regular'}
                className={subs.done === subs.total ? undefined : 'text-ink-400'}
                aria-hidden
              />
              {subs.done}/{subs.total}
            </span>
          )}
          </div>
          <span className="ml-auto flex shrink-0 items-center gap-2">
            <PriorityChip priority={t.priority} />
            {people.length > 0 && <PeopleStack people={people} />}
          </span>
        </div>
      </TaskActions>
    )
  }

  // The filter controls: laid in the toolbar from sm up, stacked in the
  // Filters sheet on phones (where each gets the full width).
  const clientFilterField = (
    <label className="block w-full sm:w-48">
      <span className="sr-only">Filter by client</span>
      <ClientSelect value={clientFilter} onChange={setClientFilter} allowAll />
    </label>
  )
  const assigneeFilterField = (
    <select
      className="input w-full sm:w-40"
      value={assigneeFilter}
      aria-label="Filter by assignee"
      onChange={(e) => setAssigneeFilter(e.target.value)}
    >
      <option value="">All assignees</option>
      <option value="none">Unassigned</option>
      {[...users]
        .sort((a, b) => a.fullName.localeCompare(b.fullName))
        .map((u) => (
          <option key={u.id} value={u.id}>
            {u.fullName}
          </option>
        ))}
    </select>
  )
  const priorityFilterField = (
    <select
      className="input w-full sm:w-36"
      value={priorityFilter}
      aria-label="Filter by priority"
      onChange={(e) => setPriorityFilter(e.target.value as 'all' | Priority)}
    >
      <option value="all">All priorities</option>
      <option value="low">Low</option>
      <option value="med">Medium</option>
      <option value="high">High</option>
    </select>
  )
  const archivedToggle = (
    <button
      type="button"
      className={classNames('btn-ghost', showArchived && 'text-brand-700 dark:text-brand-300')}
      aria-pressed={showArchived}
      title={showArchived ? 'Hide archived tasks' : 'Show archived tasks'}
      onClick={() => setShowArchived((v) => !v)}
    >
      {showArchived ? <EyeIcon size={14} aria-hidden /> : <EyeSlashIcon size={14} aria-hidden />}
      Archived
    </button>
  )

  return (
    <Layout
      title="Tasks"
      // What the board shows: tasks done on an earlier day have left it.
      subtitle={`${view === 'list' ? listItems.length : boardItems.length} tasks in ${view} view`}
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2" aria-label="Task view">
          <button type="button" className="btn-secondary" aria-pressed={view === 'board'} onClick={() => setView('board')}>Board</button>
          <button type="button" className="btn-secondary" aria-pressed={view === 'list'} onClick={() => setView('list')}>List</button>
        </div>
        {/* Toolbar — fixed widths from sm up. On a phone: Filters · Mine and
            the actions share one row; the selects live in the Filters sheet. */}
        <div className="flex flex-wrap items-center gap-2 pointer-coarse:[&_select]:min-h-11">
          {compact ? (
            <button
              type="button"
              className={classNames('btn-secondary', sheetFilterCount > 0 && 'text-brand-700 dark:text-brand-300')}
              aria-haspopup="dialog"
              aria-expanded={filtersAnchor !== null}
              onClick={(e) => setFiltersAnchor(e.currentTarget)}
            >
              <FunnelSimpleIcon size={14} aria-hidden />
              Filters
              {sheetFilterCount > 0 && (
                <span className="text-[11px] font-semibold tabular-nums min-w-5 text-center px-1 py-px rounded-sm bg-brand-500/15">
                  {sheetFilterCount}
                  <span className="sr-only"> active</span>
                </span>
              )}
            </button>
          ) : (
            <>
              {clientFilterField}
              {assigneeFilterField}
            </>
          )}
          {user && (
            <button
              type="button"
              aria-pressed={mineActive}
              className={classNames(
                // The toolbar's own button (38px, 14px), tinted while it filters.
                'btn-secondary sm:pointer-coarse:px-4',
                mineActive && 'border-brand-500/35! bg-brand-500/15! text-brand-700! dark:text-brand-300!',
              )}
              onClick={() => setAssigneeFilter(mineActive ? '' : user.id)}
            >
              Mine
            </button>
          )}
          {!compact && priorityFilterField}
          {!compact && archivedToggle}
          <div className="ml-auto flex items-center gap-2">
            <button className="btn-ghost max-sm:px-2" aria-label="EOD Report" onClick={() => setEodOpen(true)}>
              <FileTextIcon size={14} aria-hidden />
              <span>EOD<span className="max-sm:hidden"> Report</span></span>
            </button>
            {canEdit && (
              <button className="btn-primary" onClick={() => setCreating(true)}>
                <PlusIcon size={14} aria-hidden />
                New task
              </button>
            )}
          </div>
        </div>

        {/* Phones: the filters, as a bottom sheet. */}
        <Popover
          anchor={compact ? filtersAnchor : null}
          onClose={() => setFiltersAnchor(null)}
          label="Filters"
        >
          <div className="space-y-3 px-4 pt-2.5 pb-3 pointer-coarse:[&_select]:min-h-11">
            {clientFilterField}
            {assigneeFilterField}
            {priorityFilterField}
            <div className="flex items-center justify-between gap-2 pt-1">
              {archivedToggle}
              {(filtersActive || showArchived) && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    clearFilters()
                    setShowArchived(false)
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>
        </Popover>

        {/* Quick add */}
        {canEdit && (
          <form
            // Desktop: a composer tray that groups the row. Phones drop the tray —
            // its fields are already boxes, and a box of boxes costs height above the board.
            className="card p-2.5 flex flex-wrap items-center gap-2 pointer-coarse:[&_select]:min-h-11 max-sm:border-0 max-sm:bg-transparent max-sm:p-0 max-sm:shadow-none"
            onSubmit={submitQuickAdd}
            noValidate
            onFocus={() => setQaFocused(true)}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setQaFocused(false)
            }}
          >
            {/* Phones: the title is the whole composer at rest; client · priority · Add
                join it on the next row once it is in use. */}
            <input
              className={classNames('input flex-1 min-w-[180px] max-sm:basis-full pointer-coarse:min-h-11', INVALID_INPUT)}
              value={qaTitle}
              placeholder="Quick add a task… (Enter to save)"
              aria-label="Quick add a task"
              aria-invalid={qaError === 'Give the task a title' || undefined}
              enterKeyHint="done"
              onChange={(e) => {
                setQaTitle(e.target.value)
                if (qaError) setQaError(null)
              }}
            />
            {qaExpanded && (
            <>
            <label
              className={classNames(
                'flex-1 min-w-0 sm:flex-none sm:w-44',
                // The refusal names this field: mark it, as the title is marked.
                qaError === 'Pick a client first' && '[&_.input]:border-rose-500',
              )}
            >
              <span className="sr-only">Client for the new task</span>
              <ClientSelect
                value={qaClient}
                onChange={(id) => {
                  setQaClient(id)
                  if (qaError) setQaError(null)
                }}
              />
            </label>
            <label className="w-[6.5rem] sm:w-32">
              <span className="sr-only">Priority for the new task</span>
              <PrioritySelect value={qaPriority} onChange={setQaPriority} />
            </label>
            {/* Deliberately not disabled. submitQuickAdd already explains both
                failure cases ("Give the task a title" / "Pick a client first"),
                but disabling the button meant the form could never submit and
                those toasts were unreachable — leaving the placeholder's
                "Enter to save" promise silently broken. An enabled control that
                says why it refused beats a dead one that says nothing, and a
                disabled button announces nothing to a screen reader either. */}
            {/* The icon steps aside on phones so the client select keeps its full placeholder. */}
            <button
              type="submit"
              className="btn-primary max-sm:px-3.5"
              // Keeps the title focused on a tap, so the row this button sits in
              // is still there when the click lands.
              onPointerDown={(e) => { if (compact) e.preventDefault() }}
            >
              <PlusIcon size={14} className="max-sm:hidden" aria-hidden />
              Add
            </button>
            </>
            )}
            {qaError && <FieldError className="basis-full px-1 pb-0.5">{qaError}</FieldError>}
          </form>
        )}

        {/* Board */}
        {!hydrated ? (
          <TasksBoardSkeleton />
        ) : (view === 'list' ? listItems : boardItems).length === 0 ? (
          <EmptyState
            glyph="tasks"
            title={filtersActive ? 'No tasks match these filters' : 'No tasks on the board yet'}
            description={
              filtersActive
                ? 'Nothing lines up with the current client, assignee, or priority. Clear a filter to widen the board.'
                : 'Create your first task to start tracking work across To Do, In Progress, Blocked, and Done.'
            }
            action={
              filtersActive ? (
                <button className="btn-secondary" onClick={clearFilters}>
                  Clear filters
                </button>
              ) : canEdit ? (
                <button className="btn-primary" onClick={() => setCreating(true)}>
                  <PlusIcon size={14} aria-hidden />
                  New task
                </button>
              ) : undefined
            }
          />
        ) : view === 'list' ? (
          <div className="card overflow-x-auto">
            <table className="w-full text-left text-sm"><caption className="sr-only">Tasks matching your filters, including completed tasks</caption>
              <thead className="border-b border-ink-600 text-xs text-ink-300"><tr>{['Task', 'Status', 'Assignee', 'Due date', 'Priority', 'Actions'].map((label) => <th key={label} className="p-3 font-medium">{label}</th>)}</tr></thead>
              <tbody>{listItems.map((task) => <tr key={task.id} className="border-b border-ink-600 last:border-0">
                <td className={classNames('p-3', task.parentTaskId && 'pl-7')}><button type="button" className="text-left font-medium hover:underline" onClick={() => openTask(task.id)}>{task.title}</button><p className="text-xs text-ink-300">{task.parentTaskId ? `Subtask of ${tasks.find((t) => t.id === task.parentTaskId)?.title ?? 'task'} - ` : ''}{clientById.get(task.clientId)?.name}</p></td>
                <td className="p-3"><TaskStatusChip status={task.status} /></td>
                <td className="p-3">{userById.get(task.assigneeId ?? '')?.fullName ?? 'Unassigned'}</td>
                <td className="p-3 whitespace-nowrap">{fmtDate(task.dueDate)}</td>
                <td className="p-3"><PriorityChip priority={task.priority} /></td>
                <td className="p-3"><TaskActions task={task} canEdit={canEdit} onOpen={openTask}><span className="block h-12 w-8" /></TaskActions></td>
              </tr>)}</tbody>
            </table>
          </div>
        ) : (
          <KanbanBoard
            canMove={canEdit}
            itemNoun="tasks"
            getCardLabel={(t) => `Open task: ${t.title}`}
            getCardClassName={(t) =>
              t.status === 'blocked' && 'border-rose-500/45 dark:border-rose-500/40'
            }
            moveControl="corner"
            staggerKey="tasks-board"
            columns={COLUMNS}
            items={boardItems}
            getColumn={(t) => t.status}
            renderCard={renderCard}
            onMove={handleMove}
            onCardClick={(t) => setEditingId(t.id)}
            columnFooter={(key) =>
              key === 'done' ? (
                <div className="text-center text-[11px] text-ink-300">
                  <span className="tabular-nums text-ink-200">{completedToday}</span>{' '}
                  completed today
                </div>
              ) : null
            }
          />
        )}
      </div>

      <TaskModal
        open={creating || editingTask !== null}
        onClose={() => {
          setCreating(false)
          setEditingId(null)
        }}
        task={editingTask}
        defaultClientId={clientFilter || undefined}
        // Creating switches the open modal onto the new task so its Subtask
        // button is right there; subtask rows swap the modal the same way.
        onCreated={openTask}
        onOpenTask={openTask}
      />

      <EodReportModal
        open={eodOpen}
        onClose={() => setEodOpen(false)}
        defaultClientId={clientFilter || undefined}
      />
    </Layout>
  )
}
