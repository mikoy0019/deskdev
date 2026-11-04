import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CheckSquareIcon, PlusIcon, SquareIcon, TrashIcon } from '@phosphor-icons/react'
import ConfirmDialog from '../ConfirmDialog'
import Avatar from '../Avatar'
import { FieldError } from './formBits'
import { AnimatePresence, TWEEN, m, useInputModality, useReducedMotion } from '../motion'
import { useStore } from '../../store/useStore'
import { classNames, daysUntil, fmtDate } from '../../lib/format'
import { subtaskProgress, subtasksOf } from '../../lib/tasks'
import type { Task } from '../../lib/types'

/**
 * The subtask checklist under a task. Subtasks are real tasks (own assignee,
 * due date and time log) so a row can be opened in the full editor, but the
 * common case — jot down the steps, tick them off — stays inline.
 *
 * Only rendered for a task that already exists, and never for a subtask:
 * nesting is one level deep.
 */
export default function SubtaskList({
  task, canEdit, onOpenTask,
}: {
  task: Task
  canEdit: boolean
  onOpenTask?: (id: string) => void
}) {
  const tasks = useStore((s) => s.tasks)
  const users = useStore((s) => s.users)
  const addTask = useStore((s) => s.addTask)
  const setTaskStatus = useStore((s) => s.setTaskStatus)
  const deleteTask = useStore((s) => s.deleteTask)

  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Rows and the add form arrive / leave with a 4px fade-rise (preventing a
  // jarring change — a step popping into the list). Opacity only under
  // reduced motion; nothing at all when the keyboard drove it (Enter to add,
  // Escape to close), per the frequency gate.
  const reduce = useReducedMotion()
  const keyboard = useInputModality() === 'keyboard'
  const hidden = keyboard
    ? { opacity: 1 }
    : { opacity: 0, transform: reduce ? 'translateY(0px)' : 'translateY(-4px)' }
  const shown = { opacity: 1, transform: 'translateY(0px)' }
  const enter = keyboard ? TWEEN.instant : TWEEN.popover
  const leave = keyboard ? TWEEN.instant : TWEEN.popoverExit

  const subtasks = useMemo(() => subtasksOf(tasks, task.id), [tasks, task.id])
  const { done, total } = subtaskProgress(tasks, task.id)
  const allDone = total > 0 && done === total

  const submit = () => {
    const title = draft.trim()
    if (!title) {
      setError('Give the subtask a title')
      return
    }
    setError(null)
    // A subtask belongs to the same client and project as its parent — the
    // parent is the only place it can be reached from.
    try {
    addTask({
      clientId: task.clientId,
      projectId: task.projectId,
      categoryId: task.categoryId,
      parentTaskId: task.id,
      title,
      priority: task.priority,
    })
    setDraft('')
    toast.success('Subtask added')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Subtask could not be saved. Try again.')
    }
  }

  const toggle = (sub: Task) => {
    if (!canEdit) return
    setTaskStatus(sub.id, sub.status === 'done' ? 'todo' : 'done')
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="section-title">Subtasks</h3>
        <div className="flex items-center gap-2">
          {total > 0 && (
            <span
              className={classNames(
                'text-xs tabular-nums',
                allDone ? 'text-emerald-600 dark:text-emerald-400' : 'text-ink-300',
              )}
            >
              {done}/{total} done
            </span>
          )}
          {canEdit && (
            <button
              className="btn-ghost pointer-coarse:min-h-11"
              onClick={() => setAdding((v) => !v)}
              aria-expanded={adding}
            >
              <PlusIcon size={14} aria-hidden />
              Subtask
            </button>
          )}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {canEdit && adding && (
          // Not a <form>: the task dialog around it is one, and forms do not nest.
          <m.div
            key="add"
            className="mb-2"
            initial={hidden}
            animate={{ ...shown, transition: enter }}
            exit={{ ...hidden, transition: leave }}
          >
            <div className="flex items-center gap-2">
              <input
                className="input flex-1 pointer-coarse:min-h-11"
                value={draft}
                placeholder="What's the next step? (Enter to add)"
                aria-label="New subtask"
                aria-invalid={!!error || undefined}
                enterKeyHint="done"
                autoFocus
                onChange={(e) => {
                  setDraft(e.target.value)
                  if (error) setError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    // Adds the subtask; the dialog's own Enter (save) stays out of it.
                    e.preventDefault()
                    submit()
                  }
                  if (e.key === 'Escape') {
                    // Close only the add row — not the task modal around it.
                    e.stopPropagation()
                    e.nativeEvent.stopImmediatePropagation()
                    setDraft('')
                    setError(null)
                    setAdding(false)
                  }
                }}
              />
              {/* Not disabled: a disabled default button blocks Enter, so the
                  "Give the subtask a title" refusal below could never show. */}
              <button type="button" className="btn-primary pointer-coarse:min-h-11" onClick={submit}>
                Add
              </button>
            </div>
            {error && <FieldError className="mt-2">{error}</FieldError>}
          </m.div>
        )}
      </AnimatePresence>

      {subtasks.length === 0 && (
        <div className="text-sm text-ink-300 text-center py-5 border border-dashed border-ink-600 rounded-lg">
          No subtasks yet.
          {canEdit && ' Break this task into steps — it stays open until they are all done.'}
        </div>
      )}
      {/* Always mounted (hidden while empty) so the presence below survives the
          empty → first-row switch and the first subtask animates in too.
          On touch the toggle, title and delete grow to finger size; negative
          margins stop the icon buttons from making each row taller still. */}
      <div className={subtasks.length > 0 ? 'card divide-y divide-ink-600 overflow-hidden' : 'hidden'}>
        <AnimatePresence initial={false}>
          {subtasks.map((sub) => {
            const isDone = sub.status === 'done'
            const assignee = sub.assigneeId
              ? users.find((u) => u.id === sub.assigneeId)
              : undefined
            const due = daysUntil(sub.dueDate)
            return (
              <m.div
                key={sub.id}
                className="flex items-center gap-2.5 p-2.5"
                initial={hidden}
                animate={{ ...shown, transition: enter }}
                exit={{ opacity: 0, transition: leave }}
              >
                <button
                  className={classNames(
                    'pressable tap-target shrink-0 rounded-md p-0.5 pointer-coarse:p-2 pointer-coarse:-my-1',
                    isDone
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-ink-300 hover:text-ink-50',
                    !canEdit && 'cursor-default',
                  )}
                  title={
                    canEdit
                      ? isDone
                        ? 'Reopen subtask'
                        : 'Mark subtask done'
                      : undefined
                  }
                  aria-label={isDone ? `Reopen ${sub.title}` : `Complete ${sub.title}`}
                  aria-pressed={isDone}
                  disabled={!canEdit}
                  onClick={() => toggle(sub)}
                >
                  {isDone ? <CheckSquareIcon size={16} weight="fill" aria-hidden /> : <SquareIcon size={16} aria-hidden />}
                </button>

                <button
                  dir="auto"
                  className={classNames(
                    'pressable flex-1 min-w-0 text-start text-sm truncate rounded-sm hover:text-brand-600 dark:hover:text-brand-400 pointer-coarse:py-1.5',
                    isDone ? 'text-ink-300 line-through' : 'text-ink-50',
                  )}
                  title={`Open "${sub.title}"`}
                  onClick={() => onOpenTask?.(sub.id)}
                >
                  {sub.title}
                </button>

                {sub.archived && (
                  <span className="badge badge-neutral text-[10px] shrink-0">Archived</span>
                )}
                {sub.dueDate && (
                  <span
                    className={classNames(
                      'shrink-0 text-[11px] tabular-nums',
                      !isDone && due !== null && due < 0
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-ink-300',
                    )}
                    title={`Due ${fmtDate(sub.dueDate)}`}
                  >
                    {fmtDate(sub.dueDate)}
                  </span>
                )}
                {assignee && <Avatar name={assignee.fullName} size="sm" />}
                {canEdit && (
                  <button
                    className="pressable tap-target shrink-0 p-1.5 pointer-coarse:p-2 pointer-coarse:-my-1 rounded-md text-ink-300 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-ink-700"
                    title="Delete subtask"
                    aria-label={`Delete ${sub.title}`}
                    onClick={() => setPendingDelete(sub)}
                  >
                    <TrashIcon size={14} aria-hidden />
                  </button>
                )}
              </m.div>
            )
          })}
        </AnimatePresence>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete subtask"
        message={
          pendingDelete
            ? `Delete "${pendingDelete.title}"? Its time entries are kept for reporting but detached. This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (!pendingDelete) return
          deleteTask(pendingDelete.id)
          toast.success('Subtask deleted')
        }}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  )
}
