import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ArrowLeftIcon, FolderDashedIcon, PencilSimpleIcon, PlusIcon, TrashIcon,
} from '@phosphor-icons/react'
import Layout from '../components/Layout'
import Avatar from '../components/Avatar'
import EmptyState from '../components/EmptyState'
import { Glyph } from '../components/ui-foundation'
import ConfirmDialog from '../components/ConfirmDialog'
import ProjectModal from '../components/projects/ProjectModal'
import ProjectStages from '../components/projects/ProjectStages'
import EngagementPanel from '../components/projects/EngagementPanel'
import ProjectShowcasePanel from '../components/showcase/ProjectShowcasePanel'
import CategoryPill, { ColorChip } from '../components/projects/CategoryPill'
import { StatusChip, TaskStatusChip } from '../components/Chips'
import { FieldError, INVALID_INPUT } from '../components/tasks/formBits'
import { Skeleton, useStagger } from '../components/motion'
import { useStore, useCurrentUser } from '../store/useStore'
import { can } from '../lib/permissions'
import { classNames, daysUntil, fmtDate, fmtMoney } from '../lib/format'

/** One label / value row of the details panel. */
function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 px-4 py-2.5">
      <dt className="shrink-0 text-xs text-ink-300">{label}</dt>
      <dd className="flex min-w-0 justify-end text-right text-sm text-ink-50">{children}</dd>
    </div>
  )
}

/** The loading shape of this page — same columns, same rhythm, no jump when it lands. */
function DetailSkeleton() {
  return (
    <div className="max-w-6xl" aria-busy="true" aria-label="Loading project">
      <Skeleton w={128} h={14} />
      <Skeleton w="min(28rem, 80%)" h={30} className="mt-6" />
      <Skeleton w="min(26rem, 100%)" h={38} rounded="lg" className="mt-6" />
      <div className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-4 max-lg:order-2">
          <Skeleton w={64} h={12} />
          <Skeleton h={14} />
          <Skeleton w="72%" h={14} />
          <div className="space-y-3 border-t border-ink-600 pt-8">
            <Skeleton w={80} h={12} />
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 py-1.5">
                <Skeleton w={76} h={20} rounded="full" />
                <Skeleton w={i === 1 ? '48%' : '62%'} h={14} />
              </div>
            ))}
          </div>
        </div>
        <div className="divide-y divide-ink-600 rounded-lg border border-ink-600 max-lg:order-1">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex min-h-12 items-center justify-between px-4">
              <Skeleton w={52} h={12} />
              <Skeleton w={i === 4 ? 96 : 84} h={14} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function ProjectDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const user = useCurrentUser()
  const projects = useStore((s) => s.projects)
  const clients = useStore((s) => s.clients)
  const projectCategories = useStore((s) => s.projectCategories)
  const tasks = useStore((s) => s.tasks)
  const users = useStore((s) => s.users)
  const addTask = useStore((s) => s.addTask)

  const canEdit = can(user, 'projects', 'edit')
  const canEditTasks = can(user, 'tasks', 'edit')

  const [editOpen, setEditOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [qaError, setQaError] = useState<string | null>(null)
  // The route reuses this component across projects: drop a refusal (and the
  // draft) that belonged to the previous one.
  const [qaFor, setQaFor] = useState(id)
  if (qaFor !== id) {
    setQaFor(id)
    setQaError(null)
    setNewTaskTitle('')
  }
  const deleteProject = useStore((s) => s.deleteProject)

  const hydrated = useStore((s) => s.hydrated)
  const project = projects.find((p) => p.id === id)

  const linkedTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.projectId === id && !t.archived)
        .sort((a, b) => a.position - b.position),
    [tasks, id],
  )

  // First visit of this project's task list this session: a 40ms cascade.
  const { ref: attachStagger, className: staggerClass } = useStagger<HTMLUListElement>(`project-tasks-${id ?? ''}`)

  // A cold deep link (a notification, a shared URL) renders before the store
  // has loaded — hold a skeleton until it has, or every one flashes "not found".
  if (!project && !hydrated) {
    return (
      <Layout title="Project" subtitle="Loading…">
        <DetailSkeleton />
      </Layout>
    )
  }

  if (!project) {
    return (
      <Layout title="Project" subtitle="Not found">
        <EmptyState
          icon={FolderDashedIcon}
          title="Project not found"
          hint="It may have been deleted or the link is wrong."
          action={
            <Link to="/projects" className="btn-primary">
              Back to projects
            </Link>
          }
        />
      </Layout>
    )
  }

  const client = clients.find((c) => c.id === project.clientId)
  const category = project.categoryId
    ? projectCategories.find((c) => c.id === project.categoryId)
    : undefined
  const assignee = project.assigneeId
    ? users.find((u) => u.id === project.assigneeId)
    : undefined
  const dueIn = daysUntil(project.dueDate)
  const overdue = dueIn !== null && dueIn < 0 && project.status !== 'done'

  // Same contract as the board's quick add: the button always submits and an
  // empty title is refused inline, so Enter never silently does nothing.
  const quickAddTask = () => {
    const t = newTaskTitle.trim()
    if (!t) {
      setQaError('Give the task a title')
      return
    }
    setQaError(null)
    try {
    addTask({ clientId: project.clientId, projectId: project.id, title: t })
    setNewTaskTitle('')
    toast.success('Task added')
    } catch (error) {
      setQaError(error instanceof Error ? error.message : 'Task could not be saved. Try again.')
    }
  }

  return (
    <Layout
      title={project.title}
      subtitle={`${linkedTasks.length} task${linkedTasks.length === 1 ? '' : 's'}`}
    >
      {/* Left-aligned to the page gutter: centred, the column sat 20px in from
          the top bar title and from every list page. The same width as Client
          detail, so the header actions end where the top bar's do. */}
      <div className="max-w-6xl">
        <Link
          to="/projects"
          className="pressable -ml-1 inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-sm text-ink-200 hover:text-ink-50 pointer-coarse:min-h-11"
        >
          <ArrowLeftIcon size={14} aria-hidden />
          Back to projects
        </Link>

        {/* Header — the title carries the page; actions sit quietly beside it. */}
        <header className="mt-5 flex items-start justify-between gap-4">
          <h2 dir="auto" className="min-w-0 text-display text-2xl font-semibold leading-tight text-ink-50 text-balance [overflow-wrap:anywhere] md:text-[1.75rem]">
            {project.title}
          </h2>
          {canEdit && (
            // The same labelled pair as Client detail. Phones keep the icons
            // alone, so the title has the row.
            <div className="flex shrink-0 items-center gap-2 max-sm:gap-0.5">
              <button
                className="btn-ghost tap-target max-sm:px-2.5"
                aria-label="Edit project"
                onClick={() => setEditOpen(true)}
              >
                <PencilSimpleIcon size={16} aria-hidden />
                <span className="max-sm:hidden">Edit</span>
              </button>
              <button
                className="btn-ghost tap-target text-rose-700 hover:bg-rose-500/10 hover:text-rose-800 max-sm:px-2.5 dark:text-rose-400 dark:hover:text-rose-300"
                aria-label="Delete project"
                onClick={() => setConfirmDelete(true)}
              >
                <TrashIcon size={16} aria-hidden />
                <span className="max-sm:hidden">Delete</span>
              </button>
            </div>
          )}
        </header>

        {/* Onboarding → Development → Launched, and the action the stage needs. */}
        <ProjectStages project={project} />

        {/* Phones read top to bottom: details, notes, tasks, then Showcase
            (rarely touched, so it does not stand between the details and the
            work). From lg the details and Showcase stack in the right-hand
            column. No status picker here: a five-way task-style row next to
            the stage bar let a project be "Onboarding" and "Done" at once, so
            the stage bar is the one control and the status only reads. */}
        <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1fr)_18rem] lg:grid-rows-[auto_1fr] lg:gap-y-0">
          {/* Details — one quiet panel of label / value rows, hairlines between. */}
          <aside aria-label="Project details" className="lg:col-start-2 lg:row-start-1">
            <dl className="divide-y divide-ink-600 rounded-lg border border-ink-600 bg-ink-850/40">
              <DetailRow label="Status">
                <StatusChip status={project.status} />
              </DetailRow>
              <DetailRow label="Client">
                {client ? (
                  <Link
                    to={`/clients/${client.id}`}
                    // The chip is 22px tall: under a finger the link grows to 44px
                    // without moving the row.
                    className="pressable flex min-w-0 max-w-full rounded-full pointer-coarse:-my-[11px] pointer-coarse:py-[11px]"
                  >
                    <ColorChip color={client.color} className="hover:border-ink-400">
                      {client.name}
                    </ColorChip>
                  </Link>
                ) : (
                  <span className="text-ink-400">—</span>
                )}
              </DetailRow>
              <DetailRow label="Category">
                {category ? <CategoryPill category={category} /> : <span className="text-ink-400">—</span>}
              </DetailRow>
              <DetailRow label="Start">
                <span className="tabular-nums">{fmtDate(project.startDate)}</span>
              </DetailRow>
              <DetailRow label="Due">
                <span
                  className={classNames(
                    'tabular-nums',
                    overdue && 'text-rose-700 dark:text-rose-400',
                  )}
                >
                  {fmtDate(project.dueDate)}
                </span>
              </DetailRow>
              <DetailRow label="Budget">
                <span className="tabular-nums">{fmtMoney(project.budget)}</span>
              </DetailRow>
              <DetailRow label="Assignee">
                {assignee ? (
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <Avatar name={assignee.fullName} size="sm" />
                    <span className="truncate" title={assignee.fullName}>{assignee.fullName}</span>
                  </span>
                ) : (
                  <span className="text-ink-300">Unassigned</span>
                )}
              </DetailRow>
            </dl>
          </aside>

          <div className="min-w-0 lg:col-start-1 lg:row-span-2 lg:row-start-1">
            {/* Notes */}
            <section aria-labelledby="project-notes">
              <h3 id="project-notes" className="text-display text-base font-semibold text-ink-50 mb-3">Notes</h3>
              {project.notes ? (
                <p dir="auto" className="max-w-[65ch] whitespace-pre-wrap text-sm leading-relaxed text-ink-100 [overflow-wrap:anywhere]">
                  {project.notes}
                </p>
              ) : (
                <p className="text-sm text-ink-300">No notes yet.</p>
              )}
            </section>

            {/* Tasks */}
            <section aria-labelledby="project-tasks" className="mt-8 border-t border-ink-600 pt-8">
              <h3 id="project-tasks" className="flex items-baseline gap-2 text-display text-base font-semibold text-ink-50 mb-3">
                Tasks
                {linkedTasks.length > 0 && <span className="font-sans text-sm font-normal tabular-nums text-ink-300">{linkedTasks.length}</span>}
              </h3>
              {linkedTasks.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-ink-600 py-8 text-center">
                  <Glyph name="tasks" size={28} className="text-ink-400" />
                  <p className="text-sm text-ink-300">
                    No tasks linked yet{canEditTasks ? ' — add one below.' : '.'}
                  </p>
                </div>
              ) : (
                <ul ref={attachStagger} className={classNames('divide-y divide-ink-600', staggerClass)}>
                  {linkedTasks.map((t) => {
                    const taskAssignee = t.assigneeId
                      ? users.find((u) => u.id === t.assigneeId)
                      : undefined
                    return (
                      <li key={t.id}>
                        {/* Lands on the task itself (Tasks opens ?task=<id>), not the board. */}
                        <Link
                          to={`/tasks?task=${t.id}`}
                          className="pressable-card -mx-3 flex min-h-12 items-center gap-3 rounded-lg px-3 py-2 hover:bg-ink-700/40"
                        >
                          <span className="w-[6.5rem] shrink-0">
                            <TaskStatusChip status={t.status} />
                          </span>
                          <span dir="auto" className="min-w-0 flex-1 truncate text-start text-sm text-ink-50" title={t.title}>
                            {t.title}
                          </span>
                          {taskAssignee && <Avatar name={taskAssignee.fullName} size="sm" />}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}

              {canEditTasks && (
                <form
                  className="mt-4 flex flex-wrap gap-2"
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault()
                    quickAddTask()
                  }}
                >
                  <input
                    className={classNames('input min-w-0 flex-1 pointer-coarse:min-h-11', INVALID_INPUT)}
                    placeholder="Quick add a task for this project…"
                    aria-label="Quick add a task for this project"
                    aria-invalid={!!qaError || undefined}
                    enterKeyHint="done"
                    value={newTaskTitle}
                    onChange={(e) => {
                      setNewTaskTitle(e.target.value)
                      if (qaError) setQaError(null)
                    }}
                  />
                  <button type="submit" className="btn-primary shrink-0 pointer-coarse:min-h-11">
                    <PlusIcon size={14} aria-hidden />
                    Add
                  </button>
                  {qaError && <FieldError className="basis-full px-1">{qaError}</FieldError>}
                </form>
              )}
            </section>
          </div>

          {/* The panel brings its own 24px top margin: on phones the grid gap
              already separates it from the tasks. */}
          <div className="max-lg:-mt-6 lg:col-start-2 lg:row-start-2">
            <ProjectShowcasePanel project={project} />
          </div>
        </div>
      </div>

      <div className="max-w-6xl"><EngagementPanel project={project} /></div>

      <ProjectModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        project={project}
        onDeleted={() => navigate('/projects')}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete project"
        message={`Delete "${project.title}"? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          const result = await deleteProject(project.id)
          if (!result.ok) { toast.error(result.error); return }
          toast.success('Project deleted')
          navigate('/projects')
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </Layout>
  )
}
