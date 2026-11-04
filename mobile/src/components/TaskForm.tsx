import { useState } from 'react'
import { Feather } from '@expo/vector-icons'
import { Alert, Pressable, Text, View } from 'react-native'
import { useShallow } from 'zustand/react/shallow'

import { Input } from '@/components/ui'
import { CategoryManager } from '@/components/CategoryManager'
import { SubtaskList } from '@/components/SubtaskList'
import { DateField, Field, FormModal, PillGroup, SelectField, type SelectOption } from '@/components/forms'
import { fonts, PRIORITY_LABELS, TASK_STATUS_LABELS, useTheme } from '@/lib/theme'
import { blockedBySubtasksMessage, openSubtasks, subtasksOf } from '@/lib/tasks'
import { useStore } from '@/store/useStore'
import type { Priority, Task, TaskStatus } from '@/lib/types'

const STATUS_OPTIONS: { label: string; value: TaskStatus }[] = (
  ['todo', 'in_progress', 'blocked', 'done'] as TaskStatus[]
).map((s) => ({ label: TASK_STATUS_LABELS[s], value: s }))

const PRIORITY_OPTIONS: { label: string; value: Priority }[] = (
  ['low', 'med', 'high'] as Priority[]
).map((v) => ({ label: PRIORITY_LABELS[v], value: v }))

/**
 * Create / edit a task. `onCreated` lets the host keep the sheet open on the
 * task it just created, so its subtask list is right there instead of needing
 * the card to be hunted down on the board.
 */
export function TaskForm({
  visible, task, defaultClientId, onClose, onCreated,
}: {
  visible: boolean
  task?: Task
  defaultClientId?: string
  onClose: () => void
  onCreated?: (id: string) => void
}) {
  const p = useTheme()
  const allTasks = useStore((s) => s.tasks)
  const clients = useStore(useShallow((s) => [...s.clients].sort((a, b) => a.name.localeCompare(b.name))))
  const projects = useStore((s) => s.projects)
  const categories = useStore((s) => s.projectCategories)
  const users = useStore((s) => s.users)
  const addTask = useStore((s) => s.addTask)
  const updateTask = useStore((s) => s.updateTask)
  const setTaskStatus = useStore((s) => s.setTaskStatus)
  const deleteTask = useStore((s) => s.deleteTask)

  const [wasVisible, setWasVisible] = useState(false)
  const [title, setTitle] = useState('')
  const [clientId, setClientId] = useState('')
  const [projectId, setProjectId] = useState<string | undefined>(undefined)
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined)
  const [status, setStatus] = useState<TaskStatus>('todo')
  const [priority, setPriority] = useState<Priority>('med')
  const [dueDate, setDueDate] = useState<string | undefined>(undefined)
  const [assigneeId, setAssigneeId] = useState<string | undefined>(undefined)
  const [notes, setNotes] = useState('')
  const [managerOpen, setManagerOpen] = useState(false)

  if (visible !== wasVisible) {
    setWasVisible(visible)
    if (visible) {
      setTitle(task?.title ?? '')
      setClientId(task?.clientId ?? defaultClientId ?? '')
      setProjectId(task?.projectId)
      setCategoryId(task?.categoryId)
      setStatus(task?.status ?? 'todo')
      setPriority(task?.priority ?? 'med')
      setDueDate(task?.dueDate)
      setAssigneeId(task?.assigneeId)
      setNotes(task?.notes ?? '')
      setManagerOpen(false)
    }
  }

  const clientOptions: SelectOption[] = clients.map((c) => ({ label: c.name, value: c.id, dot: c.color }))
  const projectOptions: SelectOption[] = projects
    .filter((pr) => pr.clientId === clientId)
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((pr) => ({ label: pr.title, value: pr.id }))
  const categoryOptions: SelectOption[] = categories
    .filter((c) => c.clientId === clientId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => ({ label: c.name, value: c.id, dot: c.color }))
  const assigneeOptions: SelectOption[] = users.map((u) => ({ label: u.fullName, value: u.id }))

  const changeClient = (id: string | undefined) => {
    setClientId(id ?? '')
    setProjectId(undefined) // project + category are per-client
    setCategoryId(undefined)
  }

  // Subtasks gate their parent: it can't be completed while any is still open.
  const blockers = task ? openSubtasks(allTasks, task.id) : []
  const subtaskCount = task ? subtasksOf(allTasks, task.id).length : 0
  const parent = task?.parentTaskId
    ? allTasks.find((t) => t.id === task.parentTaskId)
    : undefined

  const save = () => {
    const trimmed = title.trim()
    if (!trimmed) { Alert.alert('Title required', 'Please enter a task title.'); return }
    if (!clientId) { Alert.alert('Client required', 'Please pick a client.'); return }
    if (task && status === 'done' && blockers.length > 0) {
      Alert.alert('Subtasks still open', blockedBySubtasksMessage(allTasks, task.id))
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
      notes: notes.trim() || undefined,
    }
    if (task) {
      if (status !== task.status) setTaskStatus(task.id, status)
      updateTask(task.id, fields)
    } else {
      const id = addTask(fields)
      if (status !== 'todo') setTaskStatus(id, status)
      if (onCreated) {
        onCreated(id)
        return
      }
    }
    onClose()
  }

  const confirmDelete = () => {
    if (!task) return
    Alert.alert(
      'Delete task?',
      `"${task.title}" will be removed.${subtaskCount > 0 ? ` Its ${subtaskCount} subtask${subtaskCount === 1 ? '' : 's'} go with it.` : ''} Logged time is kept for reporting but detached.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => { deleteTask(task.id); onClose() } },
      ],
    )
  }

  return (
    <FormModal
      visible={visible}
      title={task ? 'Edit task' : 'New task'}
      onClose={onClose}
      onSubmit={save}
      submitLabel={task ? 'Save changes' : 'Add task'}
      footerLeft={task ? (
        <Pressable onPress={confirmDelete} hitSlop={8} style={{ padding: 10 }}>
          <Feather name="trash-2" size={20} color={p.danger} />
        </Pressable>
      ) : undefined}
    >
      {parent ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Feather name="corner-down-right" size={12} color={p.iconMuted} />
          <Text style={{ fontSize: 12, fontFamily: fonts.sans, color: p.textMuted }} numberOfLines={1}>
            Subtask of <Text style={{ fontFamily: fonts.sansSemibold, color: p.textSecondary }}>{parent.title}</Text>
          </Text>
        </View>
      ) : null}
      <Field label="Title *">
        <Input value={title} onChangeText={setTitle} placeholder="What needs doing?" autoFocus={!task} />
      </Field>
      <Field label="Client *">
        <SelectField value={clientId || undefined} options={clientOptions} onChange={changeClient} placeholder="Select a client" />
      </Field>
      <Field label="Project">
        <SelectField
          value={projectId}
          options={projectOptions}
          onChange={setProjectId}
          allowNone
          noneLabel="No project"
          placeholder="No project"
          disabled={!clientId}
          disabledHint="Pick a client first"
        />
      </Field>
      <Field label="Category">
        <View style={{ gap: 8 }}>
          <SelectField
            value={categoryId}
            options={categoryOptions}
            onChange={setCategoryId}
            allowNone
            noneLabel="No category"
            placeholder="No category"
            disabled={!clientId}
            disabledHint="Pick a client first"
          />
          {clientId ? (
            <Pressable
              onPress={() => setManagerOpen(true)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}
            >
              <Feather name="settings" size={12} color={p.brandText} />
              <Text style={{ fontSize: 12, color: p.brandText, fontFamily: fonts.sansSemibold }}>Manage categories</Text>
            </Pressable>
          ) : null}
        </View>
      </Field>
      <Field label="Status">
        <View style={{ gap: 6 }}>
          <PillGroup options={STATUS_OPTIONS} value={status} onChange={setStatus} />
          {blockers.length > 0 ? (
            <Text style={{ fontSize: 11, fontFamily: fonts.sans, color: status === 'done' ? p.danger : p.textMuted }}>
              {blockers.length} subtask{blockers.length === 1 ? '' : 's'} still open — finish{' '}
              {blockers.length === 1 ? 'it' : 'them'} before completing this task.
            </Text>
          ) : null}
        </View>
      </Field>
      <Field label="Priority">
        <PillGroup options={PRIORITY_OPTIONS} value={priority} onChange={setPriority} />
      </Field>
      <Field label="Due date">
        <DateField value={dueDate} onChange={setDueDate} placeholder="No due date" />
      </Field>
      <Field label="Assignee">
        <SelectField value={assigneeId} options={assigneeOptions} onChange={setAssigneeId} allowNone noneLabel="Unassigned" placeholder="Unassigned" />
      </Field>
      <Field label="Notes">
        <Input value={notes} onChangeText={setNotes} placeholder="Context, links, acceptance criteria…" multiline style={{ minHeight: 90, textAlignVertical: 'top' }} />
      </Field>

      {/* Subtasks — only on a saved top-level task; nesting is one deep. The
          form is only reachable by users with tasks:edit (see tasks.tsx). */}
      {task && !task.parentTaskId ? (
        <SubtaskList task={task} canEdit />
      ) : !task ? (
        <Text style={{ fontSize: 12, fontFamily: fonts.sans, color: p.textMuted }}>
          Add the task first to start adding subtasks — it then stays open until every
          subtask is done.
        </Text>
      ) : null}

      {clientId ? (
        <CategoryManager visible={managerOpen} clientId={clientId} onClose={() => setManagerOpen(false)} />
      ) : null}
    </FormModal>
  )
}
