import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { PlusIcon, SlidersHorizontalIcon, TrashIcon } from '@phosphor-icons/react'
import Modal from '../Modal'
import ConfirmDialog from '../ConfirmDialog'
import {
  AssigneeSelect, ClientSelect, DateField, ProjectCategorySelect, ProjectStatusSelect,
} from '../pickers'
import { Field, FieldError } from '../tasks/formBits'
import { AnimatePresence, TWEEN, m, useInputModality, useReducedMotion } from '../motion'
import { useStore, useCurrentUser } from '../../store/useStore'
import { can } from '../../lib/permissions'
import type { Project, ProjectCategory, ProjectStatus } from '../../lib/types'
import { useResetOnChange } from '../../lib/useResetOnChange'
import { isHttpsUrl } from '../../lib/showcase'
import { phaseOf, statusesFor } from '../../lib/projectPhase'

// A new category's starting swatch: a calm teal that reads on both themes
// (the old default was the violet the design language keeps out).
const DEFAULT_CATEGORY_COLOR = '#0d9488'

/** One editable row in the "Manage categories" panel. */
function CategoryRow({ category }: { category: ProjectCategory }) {
  const updateProjectCategory = useStore((s) => s.updateProjectCategory)
  const deleteProjectCategory = useStore((s) => s.deleteProjectCategory)
  const [name, setName] = useState(category.name)
  const [color, setColor] = useState(category.color ?? DEFAULT_CATEGORY_COLOR)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const commitName = () => {
    const t = name.trim()
    if (!t || t === category.name) {
      setName(category.name)
      return
    }
    updateProjectCategory(category.id, { name: t })
    toast.success('Category renamed')
  }

  const commitColor = () => {
    if (color === category.color) return
    updateProjectCategory(category.id, { color })
    toast.success('Category updated')
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        className="w-8 h-8 rounded-md border border-ink-500 bg-ink-700 p-0.5 cursor-pointer shrink-0 pointer-coarse:w-11 pointer-coarse:h-11"
        value={color}
        aria-label={`Color for ${category.name}`}
        onChange={(e) => setColor(e.target.value)}
        onBlur={commitColor}
      />
      <input
        className="input w-full py-1.5 pointer-coarse:min-h-11"
        value={name}
        aria-label={`Rename ${category.name}`}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            // Commits the name; the project dialog's Enter (save) stays out of it.
            e.preventDefault()
            e.currentTarget.blur()
          }
        }}
      />
      <button
        className="pressable tap-target p-1.5 rounded-md text-ink-300 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-ink-700 shrink-0"
        title="Delete category"
        aria-label={`Delete ${category.name}`}
        onClick={() => setConfirmOpen(true)}
      >
        <TrashIcon size={14} aria-hidden />
      </button>
      <ConfirmDialog
        open={confirmOpen}
        title="Delete category"
        message={`Delete "${category.name}"? Projects using it keep their data but lose this label.`}
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          deleteProjectCategory(category.id)
          toast.success('Category deleted')
        }}
        onClose={() => setConfirmOpen(false)}
      />
    </div>
  )
}

/** Category manager for one client — add / rename / recolor / delete. */
function ManageCategories({ clientId }: { clientId: string }) {
  const projectCategories = useStore((s) => s.projectCategories)
  const addProjectCategory = useStore((s) => s.addProjectCategory)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(DEFAULT_CATEGORY_COLOR)
  const [error, setError] = useState<string | null>(null)

  const categories = projectCategories
    .filter((c) => c.clientId === clientId)
    .sort((a, b) => a.sortOrder - b.sortOrder)

  const add = () => {
    const t = newName.trim()
    if (!t) {
      setError('Category name is required')
      return
    }
    setError(null)
    addProjectCategory({ clientId, name: t, color: newColor })
    setNewName('')
    toast.success('Category added')
  }

  return (
    <div className="rounded-lg border border-ink-600 bg-ink-850/60 p-3 space-y-2">
      {categories.length === 0 && (
        <p className="text-xs text-ink-300">No categories for this client yet.</p>
      )}
      {categories.map((c) => (
        <CategoryRow key={c.id} category={c} />
      ))}
      <div className="flex items-center gap-2 pt-2 border-t border-ink-600">
        <input
          type="color"
          className="w-8 h-8 rounded-md border border-ink-500 bg-ink-700 p-0.5 cursor-pointer shrink-0 pointer-coarse:w-11 pointer-coarse:h-11"
          value={newColor}
          aria-label="New category color"
          onChange={(e) => setNewColor(e.target.value)}
        />
        <input
          className="input w-full py-1.5 pointer-coarse:min-h-11"
          placeholder="New category…"
          aria-label="New category name"
          aria-invalid={!!error || undefined}
          value={newName}
          onChange={(e) => {
            setNewName(e.target.value)
            if (error) setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
        />
        <button className="btn-ghost shrink-0 px-2 pointer-coarse:min-h-11" title="Add category" onClick={add}>
          <PlusIcon size={14} aria-hidden />
          Add
        </button>
      </div>
      {error && <FieldError>{error}</FieldError>}
    </div>
  )
}

interface ProjectModalProps {
  open: boolean
  onClose: () => void
  /** Edit mode when set; create mode otherwise */
  project?: Project | null
  defaultClientId?: string
  defaultStatus?: ProjectStatus
  /** Called after the project is deleted from inside the modal */
  onDeleted?: () => void
}

/** Create / edit / delete a project, with inline category management. */
export default function ProjectModal({
  open, onClose, project, defaultClientId, defaultStatus, onDeleted,
}: ProjectModalProps) {
  const user = useCurrentUser()
  const clients = useStore((s) => s.clients)
  const projectCategories = useStore((s) => s.projectCategories)
  const addProject = useStore((s) => s.addProject)
  const updateProject = useStore((s) => s.updateProject)
  const deleteProject = useStore((s) => s.deleteProject)

  const [title, setTitle] = useState('')
  const [clientId, setClientId] = useState('')
  const [pickedCategoryId, setCategoryId] = useState<string | undefined>(undefined)
  const [status, setStatus] = useState<ProjectStatus>('backlog')
  const [startDate, setStartDate] = useState<string | undefined>(undefined)
  const [dueDate, setDueDate] = useState<string | undefined>(undefined)
  const [budget, setBudget] = useState('')
  const [assigneeId, setAssigneeId] = useState<string | undefined>(undefined)
  const [notes, setNotes] = useState('')
  const [liveUrl, setLiveUrl] = useState('')
  const [manageOpen, setManageOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [errors, setErrors] = useState<{ title?: string; client?: string; budget?: string; liveUrl?: string }>({})
  const titleRef = useRef<HTMLInputElement>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  // The category manager opens inline under its toggle: a 4px fade-rise
  // (prevents the panel popping in), opacity only under reduced motion,
  // instant when toggled from the keyboard.
  const reduce = useReducedMotion()
  const keyboard = useInputModality() === 'keyboard'
  const panelHidden = keyboard
    ? { opacity: 1 }
    : { opacity: 0, transform: reduce ? 'translateY(0px)' : 'translateY(-4px)' }

  useResetOnChange([open, project, defaultClientId, defaultStatus], () => {
    if (!open) return
    setTitle(project?.title ?? '')
    setClientId(project?.clientId ?? defaultClientId ?? (clients.length === 1 ? clients[0].id : ''))
    setCategoryId(project?.categoryId)
    setStatus(project?.status ?? defaultStatus ?? 'backlog')
    setStartDate(project?.startDate)
    setDueDate(project?.dueDate)
    setBudget(project?.budget != null ? String(project.budget) : '')
    setAssigneeId(project?.assigneeId)
    setNotes(project?.notes ?? '')
    setLiveUrl(project?.liveUrl ?? '')
    setManageOpen(false)
    setErrors({})
    setSaveError(null)
  })

  // A category deleted in the manage panel drops out of the pick.
  const categoryId =
    pickedCategoryId && projectCategories.some((c) => c.id === pickedCategoryId && c.clientId === clientId)
      ? pickedCategoryId
      : undefined

  const save = () => {
    if (!can(user, 'projects', 'edit')) return
    const t = title.trim()
    const budgetNum = budget.trim() === '' ? undefined : Number(budget)
    const url = liveUrl.trim()
    const nextErrors = {
      title: t ? undefined : 'Title is required',
      client: clientId ? undefined : 'Select a client',
      budget:
        budgetNum !== undefined && (!Number.isFinite(budgetNum) || budgetNum < 0)
          ? 'Budget must be a positive number'
          : undefined,
      // https only: projects.live_url's CHECK (037), and what the portfolio links to.
      liveUrl: url && !isHttpsUrl(url) ? 'Use the full https:// address of the live site' : undefined,
    }
    if (nextErrors.title || nextErrors.client || nextErrors.budget || nextErrors.liveUrl) {
      setErrors(nextErrors)
      if (nextErrors.title) titleRef.current?.focus()
      return
    }
    const fields = {
      title: t,
      clientId,
      categoryId,
      status,
      startDate,
      dueDate,
      budget: budgetNum,
      assigneeId,
      notes: notes.trim() || undefined,
      liveUrl: url || undefined,
    }
    try {
    if (project) {
      const result = updateProject(project.id, fields)
      if (!result.ok) {
        toast.error(result.error ?? 'Could not save the project')
        return
      }
      toast.success('Project updated')
    } else {
      addProject(fields)
      toast.success('Project created')
    }
    onClose()
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Project could not be saved. Try again.')
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={project ? 'Edit project' : 'New project'}
        onSubmit={save}
        footer={
          <>
            {project && (
              // Phones: icon-only (the word stays for screen readers) so Cancel and
              // "Save changes" keep one line each in the shared footer row.
              <button
                className="btn text-rose-700 dark:text-rose-400 hover:bg-rose-500/10 mr-auto max-sm:flex-none! max-sm:min-w-11 max-sm:justify-center max-sm:px-2.5"
                title="Delete project"
                onClick={() => setConfirmDelete(true)}
              >
                <TrashIcon size={16} aria-hidden />
                <span className="max-sm:sr-only">Delete</span>
              </button>
            )}
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={!can(user, 'projects', 'edit')}>
              {project ? 'Save changes' : 'Create project'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Title *" error={errors.title}>
            <input
              ref={titleRef}
              dir="auto"
              className="input w-full"
              placeholder="e.g. Website redesign"
              value={title}
              autoFocus
              aria-invalid={!!errors.title || undefined}
              onChange={(e) => {
                setTitle(e.target.value)
                if (errors.title) setErrors((x) => ({ ...x, title: undefined }))
              }}
            />
          </Field>

          <Field label="Client *" error={errors.client}>
            <ClientSelect
              value={clientId}
              onChange={(id) => {
                setClientId(id)
                setCategoryId(undefined)
                setErrors((x) => ({ ...x, client: undefined }))
              }}
            />
          </Field>

          <details open={project ? true : undefined}>
            <summary className="pressable cursor-pointer rounded-md py-2 text-sm text-ink-200">More details (optional)</summary>
            <div className="mt-3 space-y-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-ink-200" aria-hidden>Category</span>
              {clientId && (
                <button
                  type="button"
                  className="pressable -my-1 inline-flex items-center gap-1 rounded-md px-1 py-1 text-xs font-medium text-brand-700 hover:text-brand-800 dark:text-brand-400 dark:hover:text-brand-300 pointer-coarse:min-h-11"
                  aria-expanded={manageOpen}
                  onClick={() => setManageOpen((v) => !v)}
                >
                  <SlidersHorizontalIcon size={14} aria-hidden />
                  {manageOpen ? 'Done managing' : 'Manage categories'}
                </button>
              )}
            </div>
            <label className="contents">
              <span className="sr-only">Category</span>
              <ProjectCategorySelect
                clientId={clientId || undefined}
                value={categoryId}
                onChange={setCategoryId}
                allowNone
              />
            </label>
            <AnimatePresence initial={false}>
              {manageOpen && clientId && (
                <m.div
                  key="manage"
                  initial={panelHidden}
                  animate={{ opacity: 1, transform: 'translateY(0px)', transition: keyboard ? TWEEN.instant : TWEEN.popover }}
                  exit={{ ...panelHidden, transition: keyboard ? TWEEN.instant : TWEEN.popoverExit }}
                >
                  <ManageCategories clientId={clientId} />
                </m.div>
              )}
            </AnimatePresence>
          </div>

          {/* A new project starts in onboarding (046), so it can't be created Done;
              Done comes from launching, on the project page. */}
          <Field
            label="Status"
            hint={project && phaseOf(project) === 'launched' ? (
              <p className="text-[11px] text-ink-300">Launched. To change it, use “Reopen development” on the project page.</p>
            ) : undefined}
          >
            <ProjectStatusSelect
              value={status}
              onChange={setStatus}
              allowed={statusesFor(project ?? { phase: 'onboarding', status })}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Start date">
              <DateField value={startDate} onChange={setStartDate} />
            </Field>
            <Field label="Due date">
              <DateField value={dueDate} onChange={setDueDate} min={startDate} />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Budget (USD)" error={errors.budget}>
              <input
                type="number"
                inputMode="decimal"
                className="input w-full tabular-nums"
                placeholder="0"
                min={0}
                value={budget}
                aria-invalid={!!errors.budget || undefined}
                onChange={(e) => {
                  setBudget(e.target.value)
                  if (errors.budget) setErrors((x) => ({ ...x, budget: undefined }))
                }}
              />
            </Field>
            <Field label="Assignee">
              <AssigneeSelect value={assigneeId} onChange={setAssigneeId} allowUnassigned />
            </Field>
          </div>

          <Field
            label="Live site URL"
            error={errors.liveUrl}
            hint={
              <p className="text-[11px] leading-snug text-ink-400">
                When the project is Done and has a live URL, a portfolio draft is created for the developer to fill in.
              </p>
            }
          >
            <input
              type="url"
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
              className="input w-full"
              placeholder="https://client-site.com"
              value={liveUrl}
              aria-invalid={!!errors.liveUrl || undefined}
              onChange={(e) => {
                setLiveUrl(e.target.value)
                if (errors.liveUrl) setErrors((x) => ({ ...x, liveUrl: undefined }))
              }}
            />
          </Field>

          <Field label="Notes">
            <textarea
              className="input w-full min-h-[80px] resize-y"
              placeholder="Scope, links, context…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
            </div>
          </details>
          {saveError && <FieldError>{saveError}</FieldError>}
        </div>
      </Modal>

      {project && (
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
            onClose()
            onDeleted?.()
          }}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </>
  )
}
