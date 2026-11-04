import { useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { ArchiveIcon, ArrowElbowDownRightIcon, BoxArrowUpIcon, ClockIcon, TrashIcon } from '@phosphor-icons/react'
import Modal from '../Modal'
import ConfirmDialog from '../ConfirmDialog'
import TimeLogModal from '../TimeLogModal'
import Avatar from '../Avatar'
import SubtaskList from './SubtaskList'
import TaskComments from './TaskComments'
import CollaboratorsField from './CollaboratorsField'
import { Field, FieldError } from './formBits'
import { PriorityChip, TaskStatusChip } from '../Chips'
import {
  AssigneeSelect, ClientSelect, DateField, PrioritySelect, ProjectCategorySelect, TaskStatusSelect,
} from '../pickers'
import { useStore, useCurrentUser } from '../../store/useStore'
import { can } from '../../lib/permissions'
import { classNames, fmtDate, fmtMinutes } from '../../lib/format'
import { blockedBySubtasksMessage, cleanCollaborators, openSubtasks, subtasksOf } from '../../lib/tasks'
import type { Priority, Task, TaskStatus, TimeEntry } from '../../lib/types'
import { useResetOnChange } from '../../lib/useResetOnChange'

function ReadRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-xs text-ink-300 shrink-0">{label}</span>
      <span className="text-sm text-ink-100 text-right min-w-0">{children}</span>
    </div>
  )
}

/**
 * Create / edit a task. Pass `task` to edit (shows the subtasks + time log +
 * delete + archive controls) or `null` to create. Read-only detail view for
 * users without tasks:edit.
 *
 * `onCreated` lets the host keep the modal open on the task it just created,
 * so its subtask list is one click away; `onOpenTask` lets the subtask rows
 * (and a subtask's link back to its parent) swap which task is being edited.
 */
export default function TaskModal({
  open, onClose, task, defaultClientId, onCreated, onOpenTask,
}: {
  open: boolean
  onClose: () => void
  task: Task | null
  defaultClientId?: string
  onCreated?: (id: string) => void
  onOpenTask?: (id: string) => void
}) {
  const user = useCurrentUser()
  const allTasks = useStore((s) => s.tasks)
  const clients = useStore((s) => s.clients)
  const projects = useStore((s) => s.projects)
  const projectCategories = useStore((s) => s.projectCategories)
  const users = useStore((s) => s.users)
  const timeEntries = useStore((s) => s.timeEntries)
  const addTask = useStore((s) => s.addTask)
  const updateTask = useStore((s) => s.updateTask)
  const deleteTask = useStore((s) => s.deleteTask)
  const deleteTimeEntry = useStore((s) => s.deleteTimeEntry)

  const canEdit = can(user, 'tasks', 'edit')

  const [title, setTitle] = useState('')
  const [clientId, setClientId] = useState('')
  const [projectId, setProjectId] = useState<string | undefined>(undefined)
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined)
  const [status, setStatus] = useState<TaskStatus>('todo')
  const [priority, setPriority] = useState<Priority>('med')
  const [dueDate, setDueDate] = useState<string | undefined>(undefined)
  const [assigneeId, setAssigneeId] = useState<string | undefined>(undefined)
  const [collaboratorIds, setCollaboratorIds] = useState<string[]>([])
  const [notes, setNotes] = useState('')

  const [timeOpen, setTimeOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(false)
  const [pendingEntry, setPendingEntry] = useState<TimeEntry | null>(null)
  // Inline validation — shown under the field that refused, cleared on edit.
  const [errors, setErrors] = useState<{ title?: string; client?: string }>({})
  const titleRef = useRef<HTMLInputElement>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  useResetOnChange([open, task?.id], () => {
    if (!open) return
    setTitle(task?.title ?? '')
    setClientId(task?.clientId ?? defaultClientId ?? (clients.length === 1 ? clients[0].id : ''))
    setProjectId(task?.projectId)
    setCategoryId(task?.categoryId)
    setStatus(task?.status ?? 'todo')
    setPriority(task?.priority ?? 'med')
    setDueDate(task?.dueDate)
    setAssigneeId(task?.assigneeId)
    setCollaboratorIds(task?.collaboratorIds ?? [])
    setNotes(task?.notes ?? '')
    setTimeOpen(false)
    setPendingDelete(false)
    setPendingEntry(null)
    setErrors({})
    setSaveError(null)
  })

  const clientProjects = useMemo(
    () =>
      projects
        .filter((p) => p.clientId === clientId)
        .sort((a, b) => a.title.localeCompare(b.title)),
    [projects, clientId],
  )

  // Subtasks gate their parent: it can't be completed while any of them is open.
  const blockers = useMemo(
    () => (task ? openSubtasks(allTasks, task.id) : []),
    [allTasks, task],
  )
  const parent = task?.parentTaskId
    ? allTasks.find((t) => t.id === task.parentTaskId)
    : undefined
  const subtaskCount = task ? subtasksOf(allTasks, task.id).length : 0

  const entries = useMemo(
    () =>
      task
        ? timeEntries
            .filter((e) => e.taskId === task.id)
            .sort(
              (a, b) =>
                b.entryDate.localeCompare(a.entryDate) ||
                b.createdAt.localeCompare(a.createdAt),
            )
        : [],
    [timeEntries, task],
  )
  const totalMinutes = entries.reduce((sum, e) => sum + e.minutes, 0)

  const nameOf = (id?: string): string =>
    users.find((u) => u.id === id)?.fullName ?? 'Unknown'

  const canDeleteEntry = (e: TimeEntry): boolean =>
    canEdit && !!user && (user.role === 'admin' || e.userId === user.id)

  const changeClient = (id: string) => {
    setClientId(id)
    setErrors((e) => ({ ...e, client: undefined }))
    setProjectId((prev) => {
      if (!prev) return prev
      const p = projects.find((x) => x.id === prev)
      return p && p.clientId === id ? prev : undefined
    })
    // Categories are per-client — drop a selection that no longer applies.
    setCategoryId((prev) =>
      prev && projectCategories.find((c) => c.id === prev)?.clientId === id ? prev : undefined,
    )
  }

  const save = () => {
    if (!canEdit) return
    const trimmed = title.trim()
    const nextErrors = {
      title: trimmed ? undefined : 'Title is required',
      client: clientId ? undefined : 'Pick a client',
    }
    if (nextErrors.title || nextErrors.client) {
      setErrors(nextErrors)
      if (nextErrors.title) titleRef.current?.focus()
      return
    }
    if (task && status === 'done' && blockers.length > 0) {
      toast.error(blockedBySubtasksMessage(allTasks, task.id))
      return
    }
    const fields = {
      title: trimmed,
      clientId,
      projectId,
      categoryId,
      priority,
      dueDate,
      assigneeId,
      collaboratorIds: cleanCollaborators(collaboratorIds, assigneeId),
      notes: notes.trim() || undefined,
    }
    try {
    if (task) {
      updateTask(task.id, { ...fields, status })
      toast.success('Task updated')
    } else {
      const id = addTask({ ...fields, status })
      toast.success('Task added')
      // Stay on the new task when the host supports it, so subtasks can be
      // added straight away instead of hunting the card down on the board.
      if (onCreated) {
        onCreated(id)
        return
      }
    }
    onClose()
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Task could not be saved. Try again.')
    }
  }

  const toggleArchive = () => {
    if (!task) return
    updateTask(task.id, { archived: !task.archived })
    toast.success(task.archived ? 'Task unarchived' : 'Task archived')
    onClose()
  }

  const client = clients.find((c) => c.id === (task?.clientId ?? clientId))
  const project = task?.projectId
    ? projects.find((p) => p.id === task.projectId)
    : undefined
  const assignee = task?.assigneeId
    ? users.find((u) => u.id === task.assigneeId)
    : undefined
  const category = task?.categoryId
    ? projectCategories.find((c) => c.id === task.categoryId)
    : undefined
  const collaborators = (task?.collaboratorIds ?? [])
    .map((id) => users.find((u) => u.id === id))
    .filter((u): u is NonNullable<typeof u> => Boolean(u))

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={task ? 'Edit task' : 'New task'}
        wide
        side={!!task}
        onSubmit={canEdit ? save : undefined}
        footer={
          <>
            {canEdit && task && (
              <div className="mr-auto flex items-center gap-1 max-sm:flex-none!">
                {/* The same quiet rose "Delete" as the meeting, event and project
                    dialogs. Phones drop the word only when Archive shares the row. */}
                <button
                  type="button"
                  className="btn-ghost text-rose-700 dark:text-rose-400 hover:bg-rose-500/10 max-sm:min-h-11"
                  title="Delete task"
                  aria-label="Delete task"
                  onClick={() => setPendingDelete(true)}
                >
                  <TrashIcon size={14} aria-hidden />
                  <span className={task.status === 'done' ? 'max-sm:sr-only' : undefined}>Delete</span>
                </button>
                {task.status === 'done' && (
                  <button
                    type="button"
                    className="pressable tap-target p-2 rounded-md text-ink-300 hover:text-ink-50 hover:bg-ink-700"
                    title={task.archived ? 'Unarchive task' : 'Archive task'}
                    aria-label={task.archived ? 'Unarchive task' : 'Archive task'}
                    onClick={toggleArchive}
                  >
                    {task.archived ? <BoxArrowUpIcon size={16} aria-hidden /> : <ArchiveIcon size={16} aria-hidden />}
                  </button>
                )}
              </div>
            )}
            <button type="button" className="btn-ghost" onClick={onClose}>
              {canEdit ? 'Cancel' : 'Close'}
            </button>
            {canEdit && (
              <button type="submit" className="btn-primary">
                {task ? 'Save changes' : 'Create task'}
              </button>
            )}
          </>
        }
      >
        <div className="space-y-5">
          {parent && (
            <div className="flex items-center gap-1.5 text-xs text-ink-300">
              <ArrowElbowDownRightIcon size={12} className="shrink-0" aria-hidden />
              <span className="shrink-0">Subtask of</span>
              {onOpenTask ? (
                <button
                  className="pressable truncate rounded-sm font-medium text-ink-100 hover:text-brand-600 dark:hover:text-brand-400 pointer-coarse:py-2"
                  title={`Open "${parent.title}"`}
                  onClick={() => onOpenTask(parent.id)}
                >
                  {parent.title}
                </button>
              ) : (
                <span className="truncate font-medium text-ink-100">{parent.title}</span>
              )}
            </div>
          )}
          {canEdit ? (
            <div className="space-y-4">
              <Field label="Title *" error={errors.title}>
                <input
                  ref={titleRef}
                  dir="auto"
                  className="input w-full"
                  value={title}
                  placeholder="What needs doing?"
                  autoFocus={!task}
                  aria-invalid={!!errors.title || undefined}
                  onChange={(e) => {
                    setTitle(e.target.value)
                    if (errors.title) setErrors((x) => ({ ...x, title: undefined }))
                  }}
                />
              </Field>
              {/* Pairs: client / project, status / priority, assignee / due date;
                  category closes the grid across both columns. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Client *" error={errors.client}>
                  <ClientSelect value={clientId} onChange={changeClient} />
                </Field>
                <Field label="Project">
                  {clientId ? (
                    <select
                      className="input w-full"
                      value={projectId ?? ''}
                      onChange={(e) => setProjectId(e.target.value || undefined)}
                    >
                      <option value="">No project</option>
                      {clientProjects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select className="input w-full opacity-60" value="" disabled>
                      <option value="">Select a client first</option>
                    </select>
                  )}
                </Field>
              </div>
              <details open={task ? true : undefined}>
                <summary className="pressable cursor-pointer rounded-md py-2 text-sm text-ink-200">More details (optional)</summary>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field
                  label="Status"
                  hint={
                    blockers.length > 0 && (
                      <p
                        className={classNames(
                          'text-xs',
                          status === 'done'
                            ? 'font-medium text-rose-700 dark:text-rose-400'
                            : 'text-ink-300',
                        )}
                      >
                        {blockers.length} subtask{blockers.length === 1 ? '' : 's'} still
                        open — finish {blockers.length === 1 ? 'it' : 'them'} before
                        completing this task.
                      </p>
                    )
                  }
                >
                  <TaskStatusSelect value={status} onChange={setStatus} />
                </Field>
                <Field label="Priority">
                  <PrioritySelect value={priority} onChange={setPriority} />
                </Field>
                <Field label="Assignee">
                  <AssigneeSelect
                    value={assigneeId}
                    onChange={setAssigneeId}
                    allowUnassigned
                  />
                </Field>
                <Field label="Due date">
                  <DateField value={dueDate} onChange={setDueDate} />
                </Field>
                {/* Not a Field: its <label> would hand a click on the word to the first chip's remove button. */}
                <div className="flex flex-col gap-2 sm:col-span-2">
                  <span className="text-xs font-medium text-ink-200">Collaborators</span>
                  <CollaboratorsField value={collaboratorIds} onChange={setCollaboratorIds} assigneeId={assigneeId} />
                </div>
                <Field label="Category" className="sm:col-span-2">
                  <ProjectCategorySelect
                    clientId={clientId || undefined}
                    value={categoryId}
                    onChange={setCategoryId}
                    allowNone
                  />
                </Field>
              </div>
              <Field label="Description">
                <textarea
                  className="input w-full min-h-[180px] resize-y"
                  value={notes}
                  placeholder="Context, links, acceptance criteria…"
                  onChange={(e) => setNotes(e.target.value)}
                />
              </Field>
              </details>
              {saveError && <FieldError>{saveError}</FieldError>}
            </div>
          ) : (
            task && (
              <div>
                <h3 dir="auto" className="text-sm font-semibold text-ink-50 leading-snug [overflow-wrap:anywhere]">
                  {task.title}
                </h3>
                <div className="mt-2 divide-y divide-ink-600">
                  <ReadRow label="Client">{client?.name ?? '—'}</ReadRow>
                  <ReadRow label="Project">{project?.title ?? '—'}</ReadRow>
                  <ReadRow label="Category">{category?.name ?? '—'}</ReadRow>
                  <ReadRow label="Status">
                    <TaskStatusChip status={task.status} />
                  </ReadRow>
                  <ReadRow label="Priority">
                    <PriorityChip priority={task.priority} />
                  </ReadRow>
                  <ReadRow label="Due date">
                    <span className="tabular-nums">{fmtDate(task.dueDate)}</span>
                  </ReadRow>
                  <ReadRow label="Assignee">
                    {assignee ? (
                      <span className="inline-flex items-center gap-2">
                        <Avatar name={assignee.fullName} size="sm" />
                        {assignee.fullName}
                      </span>
                    ) : (
                      'Unassigned'
                    )}
                  </ReadRow>
                  {collaborators.length > 0 && (
                    <ReadRow label="Collaborators">
                      <span className="inline-flex flex-wrap justify-end gap-x-3 gap-y-1">
                        {collaborators.map((u) => (
                          <span key={u.id} className="inline-flex items-center gap-1.5">
                            <Avatar name={u.fullName} size="sm" />
                            {u.fullName}
                          </span>
                        ))}
                      </span>
                    </ReadRow>
                  )}
                </div>
                {task.notes && (
                  <div className="mt-3">
                    <span className="text-xs text-ink-300">Description</span>
                    <p dir="auto" className="mt-1 text-sm text-ink-100 whitespace-pre-wrap [overflow-wrap:anywhere]">
                      {task.notes}
                    </p>
                  </div>
                )}
              </div>
            )
          )}

          {task && <TaskComments key={`comments:${task.id}`} taskId={task.id} canEdit={canEdit} />}

          {/* Subtasks — only on a saved top-level task; nesting is one deep. */}
          {task && !task.parentTaskId && (
            // Keyed by task: swapping to another task starts a fresh list (no exit/enter crossfade).
            <SubtaskList key={task.id} task={task} canEdit={canEdit} onOpenTask={onOpenTask} />
          )}
          {!task && canEdit && (
            <p className="text-xs text-ink-300">
              Create the task to start adding subtasks — it then stays open until
              every subtask is done.
            </p>
          )}

          {task && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="section-title">Time log</h3>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink-300 whitespace-nowrap">
                    Total{' '}
                    <span className="tabular-nums text-ink-100">
                      {fmtMinutes(totalMinutes)}
                    </span>
                  </span>
                  {canEdit && (
                    <button className="btn-ghost pointer-coarse:min-h-11" onClick={() => setTimeOpen(true)}>
                      <ClockIcon size={14} aria-hidden />
                      Log time
                    </button>
                  )}
                </div>
              </div>
              {entries.length === 0 ? (
                <div className="text-sm text-ink-300 text-center py-5 border border-dashed border-ink-600 rounded-lg">
                  No time logged on this task yet.
                </div>
              ) : (
                <div className="card divide-y divide-ink-600 overflow-hidden">
                  {entries.map((e) => (
                    <div key={e.id} className="flex items-start gap-3 p-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-sm font-medium tabular-nums text-ink-50">
                            {fmtMinutes(e.minutes)}
                          </span>
                          <span className="min-w-0 text-xs text-ink-300 [overflow-wrap:anywhere]">
                            {nameOf(e.userId)} · <span className="tabular-nums">{fmtDate(e.entryDate)}</span>
                          </span>
                        </div>
                        {e.note && (
                          <div className="text-xs text-ink-200 mt-0.5 truncate" title={e.note}>
                            {e.note}
                          </div>
                        )}
                      </div>
                      {canDeleteEntry(e) && (
                        <button
                          className="pressable tap-target p-1.5 rounded-md text-ink-300 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-ink-700 shrink-0 pointer-coarse:-my-2.5"
                          title="Delete entry"
                          aria-label="Delete entry"
                          onClick={() => setPendingEntry(e)}
                        >
                          <TrashIcon size={14} aria-hidden />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      {task && <TimeLogModal open={timeOpen} onClose={() => setTimeOpen(false)} task={task} />}

      <ConfirmDialog
        open={pendingDelete}
        title="Delete task"
        message={
          task
            ? `Delete "${task.title}"?${subtaskCount > 0 ? ` Its ${subtaskCount} subtask${subtaskCount === 1 ? '' : 's'} will be deleted too.` : ''} Time entries are kept for reporting but detached from the task. This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (!task) return
          deleteTask(task.id)
          toast.success('Task deleted')
          onClose()
        }}
        onClose={() => setPendingDelete(false)}
      />

      <ConfirmDialog
        open={pendingEntry !== null}
        title="Delete time entry"
        message={
          pendingEntry
            ? `Delete ${fmtMinutes(pendingEntry.minutes)} logged on ${fmtDate(pendingEntry.entryDate)}? This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (!pendingEntry) return
          deleteTimeEntry(pendingEntry.id)
          toast.success('Entry deleted')
        }}
        onClose={() => setPendingEntry(null)}
      />
    </>
  )
}
