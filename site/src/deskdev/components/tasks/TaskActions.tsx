import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { DotsThreeIcon } from '@phosphor-icons/react'
import { useStore } from '../../store/useStore'
import type { Task } from '../../lib/types'
import { webHref } from '../../lib/links'
import { blockedBySubtasksMessage } from '../../lib/tasks'
import { appUrl } from '../../pwa/paths'
import Popover from '../crm/Popover'
import Modal from '../Modal'
import ConfirmDialog from '../ConfirmDialog'

export default function TaskActions({ task, canEdit, onOpen, children }: { task: Task; canEdit: boolean; onOpen: (id: string) => void; children: ReactNode }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [point, setPoint] = useState<{ x: number; y: number } | undefined>()
  const [mode, setMode] = useState<'cover' | 'subtask' | 'convert' | null>(null)
  const [value, setValue] = useState('')
  const [deleting, setDeleting] = useState(false)
  const tasks = useStore((s) => s.tasks)
  const addTask = useStore((s) => s.addTask)
  const updateTask = useStore((s) => s.updateTask)
  const setTaskStatus = useStore((s) => s.setTaskStatus)
  const deleteTask = useStore((s) => s.deleteTask)
  const link = () => appUrl(`/tasks?task=${encodeURIComponent(task.id)}`)
  const create = (followUp: boolean) => {
    try {
      const id = addTask({ clientId: task.clientId, projectId: task.projectId, categoryId: task.categoryId, title: followUp ? `Follow up: ${task.title}` : `${task.title} (copy)`, notes: task.notes, assigneeId: task.assigneeId, collaboratorIds: task.collaboratorIds, priority: task.priority, coverUrl: task.coverUrl })
      if (!followUp) for (const sub of tasks.filter((t) => t.parentTaskId === task.id)) addTask({ clientId: sub.clientId, projectId: sub.projectId, parentTaskId: id, title: sub.title, notes: sub.notes, assigneeId: sub.assigneeId, priority: sub.priority })
      setAnchor(null); onOpen(id)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Task could not be created') }
  }
  const start = (next: typeof mode) => { setValue(next === 'cover' ? task.coverUrl ?? '' : ''); setAnchor(null); setMode(next) }
  const candidates = tasks.filter((t) => t.id !== task.id && !t.parentTaskId && t.clientId === task.clientId && t.projectId === task.projectId && !t.archived && t.status !== 'done')
  return <div className="relative" onClick={(e) => { if (!e.currentTarget.contains(e.target as Node)) e.stopPropagation() }} onContextMenu={(e) => {
    if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]')) return
    e.preventDefault(); e.stopPropagation(); setPoint({ x: e.clientX, y: e.clientY }); setAnchor(e.currentTarget)
  }}>
    <div className="absolute right-0 top-7 z-10" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <button type="button" className="pressable rounded-md bg-ink-800 p-1 text-ink-300 hover:text-ink-50" aria-label={`Task actions: ${task.title}`} aria-haspopup="dialog" onClick={(e) => { setPoint(undefined); setAnchor(e.currentTarget) }}><DotsThreeIcon size={18} /></button>
    </div>
    {children}
    <Popover anchor={anchor} point={point} onClose={() => setAnchor(null)} label="Task actions">
      <div className="flex min-w-56 flex-col gap-1 p-2" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="btn-ghost justify-start" onClick={() => { setAnchor(null); onOpen(task.id) }}>Properties</button>
        <button type="button" className="btn-ghost justify-start" onClick={() => { setAnchor(null); onOpen(task.id) }}>Open task details</button>
        <a className="btn-ghost justify-start" href={typeof window === 'undefined' ? '#' : link()} target="_blank" rel="noopener noreferrer">Open in a new tab</a>
        <button type="button" className="btn-ghost justify-start" onClick={async () => { try { await navigator.clipboard.writeText(link()); toast.success('Task link copied'); setAnchor(null) } catch { toast.error('Could not copy the task link') } }}>Copy task link</button>
        {canEdit && <>
          <button type="button" className="btn-ghost justify-start" onClick={() => start('cover')}>Card image</button>
          <button type="button" className="btn-ghost justify-start" onClick={() => create(false)}>Duplicate task</button>
          <button type="button" className="btn-ghost justify-start" onClick={() => create(true)}>Create follow-up task</button>
          <button type="button" className="btn-ghost justify-start" onClick={() => { if (!setTaskStatus(task.id, task.status === 'done' ? 'todo' : 'done')) toast.error(blockedBySubtasksMessage(tasks, task.id)); setAnchor(null) }}>{task.status === 'done' ? 'Reopen task' : 'Mark complete'}</button>
          {!task.parentTaskId && <button type="button" className="btn-ghost justify-start" onClick={() => start('subtask')}>Add subtask</button>}
          <button type="button" className="btn-ghost justify-start" disabled={tasks.some((t) => t.parentTaskId === task.id)} onClick={() => start('convert')}>Convert to {task.parentTaskId ? 'task' : 'subtask'}</button>
          <button type="button" className="btn-ghost justify-start text-rose-600" onClick={() => { setAnchor(null); setDeleting(true) }}>Delete task</button>
        </>}
      </div>
    </Popover>
    <Modal open={mode !== null} onClose={() => setMode(null)} title={mode === 'cover' ? 'Card image' : mode === 'subtask' ? 'Add subtask' : 'Convert task'} onSubmit={() => {
      try {
        if (!canEdit) return
        if (mode === 'cover') {
          const url = value.trim()
          if (url && !/^https:\/\//i.test(webHref(url) ?? '')) { toast.error('Use an HTTPS image URL'); return }
          updateTask(task.id, { coverUrl: url ? webHref(url) : undefined })
        } else if (mode === 'subtask') {
          if (!value.trim()) { toast.error('Give the subtask a title'); return }
          addTask({ clientId: task.clientId, projectId: task.projectId, parentTaskId: task.id, title: value.trim() })
        } else {
          if (!task.parentTaskId && !value) { toast.error('Choose a parent task'); return }
          updateTask(task.id, { parentTaskId: task.parentTaskId ? undefined : value })
        }
        setMode(null)
      } catch (e) { toast.error(e instanceof Error ? e.message : 'Task could not be changed') }
    }} footer={<button type="submit" className="btn-primary">Save</button>}>
      {mode === 'convert' ? task.parentTaskId ? <p>This subtask will become a top-level task.</p> : <label className="text-sm">Parent task<select className="input mt-2 w-full" value={value} onChange={(e) => setValue(e.target.value)}><option value="">Choose a task in this project</option>{candidates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label> : <label className="text-sm">{mode === 'cover' ? 'HTTPS image URL (leave empty to remove)' : 'Subtask title'}<input autoFocus className="input mt-2 w-full" value={value} onChange={(e) => setValue(e.target.value)} /></label>}
    </Modal>
    <ConfirmDialog open={deleting} title="Delete task" message={`Delete "${task.title}" and its subtasks? Time entries are retained. This cannot be undone.`} danger confirmLabel="Delete" onClose={() => setDeleting(false)} onConfirm={() => { if (canEdit) deleteTask(task.id) }} />
  </div>
}
