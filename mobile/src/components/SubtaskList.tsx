import { useState } from 'react'
import { Feather } from '@expo/vector-icons'
import { Alert, Pressable, Text, View } from 'react-native'

import { Input } from '@/components/ui'
import { fmtDate } from '@/lib/format'
import { fonts, radius, space, useTheme } from '@/lib/theme'
import { subtaskProgress, subtasksOf } from '@/lib/tasks'
import { useStore } from '@/store/useStore'
import type { Task } from '@/lib/types'

/**
 * The subtask checklist under a task, mirroring the web modal's section.
 * Subtasks are real tasks that live under a parent instead of on the board,
 * and the parent stays open until every one of them is done.
 *
 * Rendered only for a saved top-level task — nesting is one level deep.
 */
export function SubtaskList({ task, canEdit }: { task: Task; canEdit: boolean }) {
  const p = useTheme()
  const tasks = useStore((s) => s.tasks)
  const addTask = useStore((s) => s.addTask)
  const setTaskStatus = useStore((s) => s.setTaskStatus)
  const deleteTask = useStore((s) => s.deleteTask)

  const [draft, setDraft] = useState('')

  const subtasks = subtasksOf(tasks, task.id)
  const { done, total } = subtaskProgress(tasks, task.id)
  const allDone = total > 0 && done === total

  const add = () => {
    const title = draft.trim()
    if (!title) return
    // A subtask inherits the parent's client and project — the parent is the
    // only place it can be reached from.
    addTask({
      clientId: task.clientId,
      projectId: task.projectId,
      categoryId: task.categoryId,
      parentTaskId: task.id,
      title,
      priority: task.priority,
    })
    setDraft('')
  }

  const confirmDelete = (sub: Task) => {
    Alert.alert('Delete subtask?', `"${sub.title}" will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteTask(sub.id) },
    ])
  }

  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Text style={{ fontSize: 13, fontFamily: fonts.sansSemibold, color: p.textHigh }}>
          Subtasks
        </Text>
        {total > 0 ? (
          <Text
            style={{
              fontSize: 12,
              fontFamily: fonts.mono,
              color: allDone ? p.success : p.textMuted,
              fontVariant: ['tabular-nums'],
            }}
          >
            {done}/{total} done
          </Text>
        ) : null}
      </View>

      {subtasks.length === 0 ? (
        <Text style={{ fontSize: 12, fontFamily: fonts.sans, color: p.textMuted }}>
          {canEdit
            ? 'No subtasks yet. Break this task into steps — it stays open until they are all done.'
            : 'No subtasks.'}
        </Text>
      ) : (
        <View
          style={{
            borderWidth: 1,
            borderColor: p.border,
            borderRadius: radius.md,
            overflow: 'hidden',
          }}
        >
          {subtasks.map((sub, i) => {
            const isDone = sub.status === 'done'
            return (
              <View
                key={sub.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.sm,
                  paddingHorizontal: space.md,
                  paddingVertical: 10,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: p.border,
                }}
              >
                <Pressable
                  onPress={() =>
                    canEdit ? setTaskStatus(sub.id, isDone ? 'todo' : 'done') : undefined
                  }
                  hitSlop={8}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isDone }}
                  accessibilityLabel={sub.title}
                >
                  <Feather
                    name={isDone ? 'check-square' : 'square'}
                    size={18}
                    color={isDone ? p.success : p.iconMuted}
                  />
                </Pressable>

                <Text
                  numberOfLines={2}
                  style={{
                    flex: 1,
                    fontSize: 13,
                    fontFamily: fonts.sans,
                    color: isDone ? p.textMuted : p.textHigh,
                    textDecorationLine: isDone ? 'line-through' : 'none',
                  }}
                >
                  {sub.title}
                </Text>

                {sub.dueDate ? (
                  <Text
                    style={{
                      fontSize: 11,
                      fontFamily: fonts.mono,
                      color: p.textMuted,
                      fontVariant: ['tabular-nums'],
                    }}
                  >
                    {fmtDate(sub.dueDate)}
                  </Text>
                ) : null}

                {canEdit ? (
                  <Pressable onPress={() => confirmDelete(sub)} hitSlop={8}>
                    <Feather name="trash-2" size={15} color={p.iconMuted} />
                  </Pressable>
                ) : null}
              </View>
            )
          })}
        </View>
      )}

      {canEdit ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Input
            value={draft}
            onChangeText={setDraft}
            placeholder="Add a subtask…"
            onSubmitEditing={add}
            returnKeyType="done"
            style={{ flex: 1 }}
          />
          <Pressable
            onPress={add}
            accessibilityRole="button"
            accessibilityLabel="Add subtask"
            style={{
              width: 44,
              borderRadius: radius.md,
              backgroundColor: p.brand,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Feather name="plus" size={20} color="#fff" />
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}
