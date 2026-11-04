import { useState } from 'react'
import { Feather } from '@expo/vector-icons'
import { Alert, Pressable, Text, View } from 'react-native'
import { useShallow } from 'zustand/react/shallow'

import { Button, Input } from '@/components/ui'
import { CategoryManager } from '@/components/CategoryManager'
import { DateField, Field, FormModal, PillGroup, SelectField, type SelectOption } from '@/components/forms'
import { isHttpsUrl } from '@/lib/showcase'
import { fonts, PROJECT_STATUS_LABELS, useTheme } from '@/lib/theme'
import { useStore } from '@/store/useStore'
import type { Project, ProjectStatus } from '@/lib/types'

const STATUS_OPTIONS: { label: string; value: ProjectStatus }[] = (
  ['backlog', 'planning', 'in_progress', 'waiting', 'done'] as ProjectStatus[]
).map((s) => ({ label: PROJECT_STATUS_LABELS[s], value: s }))

export function ProjectForm({
  visible, project, defaultClientId, onClose,
}: {
  visible: boolean
  project?: Project
  defaultClientId?: string
  onClose: () => void
}) {
  const p = useTheme()
  const clients = useStore(useShallow((s) => [...s.clients].sort((a, b) => a.name.localeCompare(b.name))))
  const categories = useStore((s) => s.projectCategories)
  const users = useStore((s) => s.users)
  const addProject = useStore((s) => s.addProject)
  const updateProject = useStore((s) => s.updateProject)
  const deleteProject = useStore((s) => s.deleteProject)

  const [wasVisible, setWasVisible] = useState(false)
  const [title, setTitle] = useState('')
  const [clientId, setClientId] = useState('')
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined)
  const [status, setStatus] = useState<ProjectStatus>('backlog')
  const [startDate, setStartDate] = useState<string | undefined>(undefined)
  const [dueDate, setDueDate] = useState<string | undefined>(undefined)
  const [budget, setBudget] = useState('')
  const [assigneeId, setAssigneeId] = useState<string | undefined>(undefined)
  const [notes, setNotes] = useState('')
  const [liveUrl, setLiveUrl] = useState('')
  const [managerOpen, setManagerOpen] = useState(false)

  if (visible !== wasVisible) {
    setWasVisible(visible)
    if (visible) {
      setTitle(project?.title ?? '')
      setClientId(project?.clientId ?? defaultClientId ?? '')
      setCategoryId(project?.categoryId)
      setStatus(project?.status ?? 'backlog')
      setStartDate(project?.startDate)
      setDueDate(project?.dueDate)
      setBudget(project?.budget != null ? String(project.budget) : '')
      setAssigneeId(project?.assigneeId)
      setNotes(project?.notes ?? '')
      setLiveUrl(project?.liveUrl ?? '')
      setManagerOpen(false)
    }
  }

  const clientOptions: SelectOption[] = clients.map((c) => ({ label: c.name, value: c.id, dot: c.color }))
  const categoryOptions: SelectOption[] = categories
    .filter((c) => c.clientId === clientId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => ({ label: c.name, value: c.id, dot: c.color }))
  const assigneeOptions: SelectOption[] = users.map((u) => ({ label: u.fullName, value: u.id }))

  const changeClient = (id: string | undefined) => {
    setClientId(id ?? '')
    setCategoryId(undefined) // categories are per-client
  }

  const save = () => {
    const trimmed = title.trim()
    if (!trimmed) { Alert.alert('Title required', 'Please enter a project title.'); return }
    if (!clientId) { Alert.alert('Client required', 'Please pick a client.'); return }
    const url = liveUrl.trim()
    // https only: projects.live_url's CHECK (037), and what the portfolio links to.
    if (url && !isHttpsUrl(url)) { Alert.alert('Live site URL', 'Use the full https:// address of the live site.'); return }
    const budgetNum = budget.trim() ? Number(budget) : undefined
    const payload = {
      title: trimmed,
      clientId,
      categoryId,
      status,
      startDate,
      dueDate,
      budget: budgetNum != null && !Number.isNaN(budgetNum) ? budgetNum : undefined,
      assigneeId,
      notes: notes.trim() || undefined,
      liveUrl: url || undefined,
    }
    if (project) updateProject(project.id, payload)
    else addProject(payload)
    onClose()
  }

  const confirmDelete = () => {
    if (!project) return
    Alert.alert(
      'Delete project?',
      `"${project.title}" will be removed. Its tasks are detached, not deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          // Refused when the project has retained engagement records (or offline): say why.
          onPress: () => {
            void deleteProject(project.id).then((res) => {
              if (res.ok) onClose()
              else Alert.alert('Could not delete', res.error ?? 'Try again.')
            })
          },
        },
      ],
    )
  }

  return (
    <FormModal
      visible={visible}
      title={project ? 'Edit project' : 'New project'}
      onClose={onClose}
      onSubmit={save}
      submitLabel={project ? 'Save changes' : 'Add project'}
      footerLeft={project ? (
        <Pressable onPress={confirmDelete} hitSlop={8} style={{ padding: 10 }}>
          <Feather name="trash-2" size={20} color={p.danger} />
        </Pressable>
      ) : undefined}
    >
      <Field label="Title *">
        <Input value={title} onChangeText={setTitle} placeholder="Project title" autoFocus={!project} />
      </Field>
      <Field label="Client *">
        <SelectField value={clientId || undefined} options={clientOptions} onChange={changeClient} placeholder="Select a client" />
      </Field>
      <Field label="Category">
        <View style={{ gap: 8 }}>
          <SelectField
            value={categoryId}
            options={categoryOptions}
            onChange={setCategoryId}
            allowNone
            disabled={!clientId}
            disabledHint="Pick a client first"
            placeholder="No category"
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
        <PillGroup options={STATUS_OPTIONS} value={status} onChange={setStatus} />
      </Field>
      <Field label="Start date">
        <DateField value={startDate} onChange={setStartDate} placeholder="No start date" />
      </Field>
      <Field label="Due date">
        <DateField value={dueDate} onChange={setDueDate} placeholder="No due date" />
      </Field>
      <Field label="Budget">
        <Input value={budget} onChangeText={setBudget} placeholder="0" keyboardType="numeric" />
      </Field>
      <Field label="Assignee">
        <SelectField value={assigneeId} options={assigneeOptions} onChange={setAssigneeId} allowNone noneLabel="Unassigned" placeholder="Unassigned" />
      </Field>
      <Field label="Live site URL">
        <Input
          value={liveUrl}
          onChangeText={setLiveUrl}
          placeholder="https://client-site.com"
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="URL"
        />
        <Text style={{ fontSize: 12, fontFamily: fonts.sans, color: p.textMuted, marginTop: 4 }}>
          When the project is launched with a live URL, a portfolio draft is created for the developer to fill in.
        </Text>
      </Field>
      <Field label="Notes">
        <Input value={notes} onChangeText={setNotes} placeholder="Scope, links, context…" multiline style={{ minHeight: 90, textAlignVertical: 'top' }} />
      </Field>

      {clientId ? (
        <CategoryManager visible={managerOpen} clientId={clientId} onClose={() => setManagerOpen(false)} />
      ) : null}
    </FormModal>
  )
}
