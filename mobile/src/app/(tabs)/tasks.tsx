import { useState } from 'react'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Alert, Pressable, ScrollView, Text, View } from 'react-native'

import {
  Avatar, Card, Chip, Fab, FilterChip, HeaderAction, Input, RowSkeleton, Screen, ScreenHeader,
} from '@/components/ui'
import { DraggableCard, type MoveDirection } from '@/components/DraggableCard'
import { TaskForm } from '@/components/TaskForm'
import { useSession } from '@/context/session-context'
import { can } from '@/lib/permissions'
import { fmtDate, fmtMinutes, isoDate } from '@/lib/format'
import { blockedBySubtasksMessage, subtaskProgress } from '@/lib/tasks'
import {
  TASK_STATUS_LABELS, fonts, layout, priorityChip, radius, space, taskStatusChip, useTheme,
} from '@/lib/theme'
import { useStore } from '@/store/useStore'
import type { Task, TaskStatus } from '@/lib/types'

const COLUMNS: TaskStatus[] = ['todo', 'in_progress', 'blocked', 'done']

const COLUMN_WIDTH = 264
/** Scroll offset that rests each column against the board's left gutter. */
const COLUMN_OFFSETS = COLUMNS.map((_, i) => i * (COLUMN_WIDTH + space.md))

export default function Tasks() {
  const p = useTheme()
  const router = useRouter()
  const { user, ready } = useSession()
  const canEdit = can(user, 'tasks', 'edit')

  const clients = useStore((s) => s.clients)
  const tasks = useStore((s) => s.tasks)
  const cats = useStore((s) => s.projectCategories)
  const users = useStore((s) => s.users)
  const timeEntries = useStore((s) => s.timeEntries)
  const addTask = useStore((s) => s.addTask)
  const moveTask = useStore((s) => s.moveTask)

  const [clientId, setClientId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [draft, setDraft] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  // While a card is held, the board's scroll views must stand down or they
  // consume the drag and pan the board sideways instead of moving the card.
  const [dragging, setDragging] = useState(false)

  const openCreate = () => { setEditingTask(null); setFormOpen(true) }
  const openEdit = (t: Task) => { setEditingTask(t); setFormOpen(true) }

  // Subtasks stay off the board — they live under their parent card (which
  // carries a done/total chip) and are managed from its form.
  const shown = tasks.filter(
    (t) =>
      !t.parentTaskId &&
      (!clientId || t.clientId === clientId) &&
      (showArchived || !t.archived),
  )
  const clientName = (id?: string) => clients.find((c) => c.id === id)?.name ?? '—'
  const catName = (id?: string) => cats.find((c) => c.id === id)?.name
  const userName = (id?: string) => users.find((u) => u.id === id)?.fullName ?? '?'
  const minutesFor = (taskId: string) =>
    timeEntries.filter((e) => e.taskId === taskId).reduce((a, e) => a + e.minutes, 0)

  function quickAdd() {
    const title = draft.trim()
    if (!title) return
    if (!clientId) { Alert.alert('Pick a client', 'Select a client filter first to quick-add a task to it.'); return }
    addTask({ clientId, title, priority: 'med' })
    setDraft('')
  }

  /** Drag committed: shift the card one column left or right. */
  function shift(task: Task, direction: MoveDirection) {
    const next = COLUMNS[COLUMNS.indexOf(task.status) + direction]
    if (!next) return
    // Refused when the task still has open subtasks — say why rather than
    // letting the card silently snap back.
    if (!moveTask(task.id, next, 0)) {
      Alert.alert('Subtasks still open', blockedBySubtasksMessage(tasks, task.id))
    }
  }

  return (
    <Screen
      // Kanban columns use the whole width on a tablet too.
      wide
      padded={false}
      tabScreen
      header={
        <ScreenHeader
          title="Tasks"
          subtitle={`${shown.length} ${shown.length === 1 ? 'task' : 'tasks'}`}
          actions={
            <>
              <HeaderAction
                label="Archived"
                icon={showArchived ? 'eye' : 'eye-off'}
                onPress={() => setShowArchived((v) => !v)}
              />
              <HeaderAction label="EOD" icon="file-text" accent onPress={() => router.push('/eod')} />
            </>
          }
        />
      }
    >
      {/* Capping this row at 52px was clipping the chips — that is what sheared
          the client names. It's sized by its content now; `flexGrow: 0` keeps a
          horizontal ScrollView from expanding to fill the column instead. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterRow}
      >
        <FilterChip label="All clients" active={!clientId} onPress={() => setClientId(null)} />
        {clients.map((c) => (
          <FilterChip key={c.id} label={c.name} active={clientId === c.id} onPress={() => setClientId(c.id)} />
        ))}
      </ScrollView>

      {canEdit ? (
        <View style={styles.quickAdd}>
          <Input
            value={draft}
            onChangeText={setDraft}
            placeholder={clientId ? 'Quick add a task…' : 'Pick a client to quick-add'}
            onSubmitEditing={quickAdd}
            style={{ flex: 1 }}
          />
          <Pressable
            onPress={quickAdd}
            accessibilityRole="button"
            accessibilityLabel="Add task"
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

      {/* The board scrolls vertically as a whole, with the columns scrolling
          horizontally inside it. Giving each column its OWN vertical ScrollView
          instead would clip a dragged card at the column edge — a ScrollView
          always clips its children, so the card visibly got sliced in half the
          moment it crossed the boundary. */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        scrollEnabled={!dragging}
        contentContainerStyle={styles.boardOuter}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          scrollEnabled={!dragging}
          // Swiping anywhere in the board — including the empty space under the
          // cards — pages to the next column instead of free-scrolling to a
          // half-column rest.
          //
          // Explicit offsets, not snapToInterval: the interval is measured from
          // scroll 0, which ignores the board's 16px left padding, so every snap
          // point landed 16px early and sliced the column at the edge.
          snapToOffsets={COLUMN_OFFSETS}
          decelerationRate="fast"
          contentContainerStyle={styles.board}
        >
          {COLUMNS.map((status, colIndex) => {
            const items = shown.filter((t) => t.status === status)
            return (
              // flex:1 makes the column (and therefore the horizontal scroller)
              // span the full board height, so the empty space beneath the last
              // card is still part of the swipe surface. Without it the columns
              // are only as tall as their cards and the dead space below them
              // swallows the gesture.
              <View key={status} style={{ width: COLUMN_WIDTH, flex: 1 }}>
                <View style={styles.columnHead}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: taskStatusChip(p, status).text }} />
                  <Text style={{ fontSize: 13, fontFamily: fonts.sansSemibold, color: p.textHigh }}>
                    {TASK_STATUS_LABELS[status]}
                  </Text>
                  <Text style={{ fontSize: 12, fontFamily: fonts.mono, color: p.textMuted, fontVariant: ['tabular-nums'] }}>
                    {items.length}
                  </Text>
                </View>

                <View style={{ gap: space.sm }}>
                {items.map((t) => {
                  const mins = minutesFor(t.id)
                  const subs = subtaskProgress(tasks, t.id)
                  const overdue = t.dueDate && t.dueDate < isoDate() && t.status !== 'done'
                  return (
                    <DraggableCard
                      key={t.id}
                      enabled={canEdit}
                      canMoveLeft={colIndex > 0}
                      canMoveRight={colIndex < COLUMNS.length - 1}
                      onMove={(dir) => shift(t, dir)}
                      onOpen={() => (canEdit ? openEdit(t) : undefined)}
                      onDragStateChange={setDragging}
                    >
                      <Card
                        style={t.status === 'blocked' ? { borderColor: taskStatusChip(p, 'blocked').border } : undefined}
                      >
                        <Text style={{ fontSize: 14, fontFamily: fonts.sansSemibold, color: p.textHigh, marginBottom: space.sm }}>
                          {t.title}
                        </Text>
                        <View style={styles.meta}>
                          {!clientId ? <Chip label={clientName(t.clientId)} colors={{ bg: p.hover, border: p.border, text: p.textSecondary }} /> : null}
                          {catName(t.categoryId) ? <Chip label={catName(t.categoryId)!} colors={{ bg: p.hover, border: p.border, text: p.textSecondary }} /> : null}
                          <Chip label={t.priority.toUpperCase()} colors={priorityChip(p, t.priority)} />
                          {t.dueDate ? (
                            <Text style={{ fontSize: 11, fontFamily: fonts.mono, color: overdue ? p.danger : p.textMuted, fontVariant: ['tabular-nums'] }}>
                              {fmtDate(t.dueDate)}
                            </Text>
                          ) : null}
                          {mins > 0 ? (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                              <Feather name="clock" size={11} color={p.iconMuted} />
                              <Text style={{ fontSize: 11, fontFamily: fonts.mono, color: p.textMuted, fontVariant: ['tabular-nums'] }}>
                                {fmtMinutes(mins)}
                              </Text>
                            </View>
                          ) : null}
                          {/* Subtask progress — the card can't reach Done until this is full. */}
                          {subs.total > 0 ? (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                              <Feather
                                name="check-square"
                                size={11}
                                color={subs.done === subs.total ? p.success : p.iconMuted}
                              />
                              <Text style={{ fontSize: 11, fontFamily: fonts.mono, color: subs.done === subs.total ? p.success : p.textMuted, fontVariant: ['tabular-nums'] }}>
                                {subs.done}/{subs.total}
                              </Text>
                            </View>
                          ) : null}
                          {t.assigneeId ? <Avatar name={userName(t.assigneeId)} size={22} /> : null}
                        </View>
                      </Card>
                    </DraggableCard>
                  )
                })}
                {/* Until the session resolves, `items` is empty — which used to render as
                    "Empty", claiming there are no tasks before we know. Skeleton first,
                    and only say "Empty" once it is actually true. */}
                {!ready ? (
                  <>
                    <RowSkeleton />
                    <RowSkeleton />
                  </>
                ) : items.length === 0 ? (
                  <Text style={{ fontSize: 12, fontFamily: fonts.sans, color: p.textMuted, paddingVertical: space.sm, paddingHorizontal: 2 }}>
                    Empty
                  </Text>
                ) : null}
                </View>
              </View>
            )
          })}
        </ScrollView>
      </ScrollView>

      {canEdit ? <Fab icon="plus" onPress={openCreate} aboveTabBar /> : null}
      <TaskForm
        visible={formOpen}
        task={editingTask ?? undefined}
        defaultClientId={clientId ?? undefined}
        onClose={() => setFormOpen(false)}
        // Switch the open sheet onto the task just created so its subtask
        // list is immediately available. Read from the store, not `tasks` —
        // that binding predates the insert.
        onCreated={(id) =>
          setEditingTask(useStore.getState().tasks.find((t) => t.id === id) ?? null)
        }
      />
    </Screen>
  )
}

const styles = {
  /** A ScrollView grows to fill its flex parent unless told not to. */
  filterScroll: { flexGrow: 0, flexShrink: 0 },
  filterRow: {
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
    gap: space.sm,
    alignItems: 'center',
  },
  quickAdd: {
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: space.lg,
    marginBottom: space.md,
  },
  boardOuter: {
    // flexGrow lets the board stretch to the viewport when the cards don't fill
    // it — that stretched area is what makes the empty space swipeable.
    flexGrow: 1,
    // Clears the floating tab pill — without this the last card sits under it.
    paddingBottom: layout.scrollClearance,
  },
  board: {
    paddingHorizontal: space.lg,
    gap: space.md,
  },
  columnHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: space.sm,
    paddingHorizontal: 2,
  },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  },
} as const
