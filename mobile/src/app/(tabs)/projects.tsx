import { useState } from 'react'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Pressable, ScrollView, Text, View } from 'react-native'

import {
  ActionSheet, Avatar, Card, Chip, Fab, FilterChip, RowSkeleton, Screen, ScreenHeader,
} from '@/components/ui'
import { DraggableCard, type MoveDirection } from '@/components/DraggableCard'
import { ProjectForm } from '@/components/ProjectForm'
import { PhaseChip } from '@/components/projects/PhaseChip'
import { useSession } from '@/context/session-context'
import { can } from '@/lib/permissions'
import { daysUntil, fmtDate } from '@/lib/format'
import { phaseOf } from '@/lib/projectPhase'
import {
  PROJECT_STATUS_LABELS, fonts, layout, projectStatusChip, space, useTheme,
} from '@/lib/theme'
import { useStore } from '@/store/useStore'
import type { Project, ProjectStatus } from '@/lib/types'

const COLUMNS: ProjectStatus[] = ['backlog', 'planning', 'in_progress', 'waiting', 'done']

const COLUMN_WIDTH = 264
/** Scroll offset that rests each column against the board's left gutter. */
const COLUMN_OFFSETS = COLUMNS.map((_, i) => i * (COLUMN_WIDTH + space.md))

export default function Projects() {
  const p = useTheme()
  const router = useRouter()
  const { user, ready } = useSession()
  const canEdit = can(user, 'projects', 'edit')

  const clients = useStore((s) => s.clients)
  const projects = useStore((s) => s.projects)
  const cats = useStore((s) => s.projectCategories)
  const users = useStore((s) => s.users)
  const moveProject = useStore((s) => s.moveProject)

  const [clientId, setClientId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [moving, setMoving] = useState<Project | null>(null)
  // Scroll views must stand down while a card is held, or they eat the drag.
  const [dragging, setDragging] = useState(false)

  const shown = projects.filter((pr) => !clientId || pr.clientId === clientId)
  const clientName = (id?: string) => clients.find((c) => c.id === id)?.name ?? '—'
  const catName = (id?: string) => cats.find((c) => c.id === id)?.name
  const userName = (id?: string) => users.find((u) => u.id === id)?.fullName ?? '?'

  /** Drag committed: shift the card one column left or right. */
  function shift(pr: Project, direction: MoveDirection) {
    const next = COLUMNS[COLUMNS.indexOf(pr.status) + direction]
    if (next) moveProject(pr.id, next, 0)
  }

  return (
    <Screen
      // Kanban columns use the whole width on a tablet too.
      wide
      padded={false}
      tabScreen
      header={
        <ScreenHeader
          title="Projects"
          subtitle={`${shown.length} ${shown.length === 1 ? 'project' : 'projects'}`}
        />
      }
    >
      {/* Sizes to its content — the old 52px cap sheared the client names.
          `flexGrow: 0` stops the ScrollView expanding to fill the column. */}
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

      {/* Vertical scroller on the outside, columns horizontal inside. A
          per-column ScrollView would clip the dragged card at the column edge. */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        scrollEnabled={!dragging}
        contentContainerStyle={styles.boardOuter}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          scrollEnabled={!dragging}
          // Swipe anywhere in the board (including the empty space under the
          // cards) to page between columns. Explicit offsets rather than
          // snapToInterval, which ignores the board's left padding and snaps
          // 16px short of each column.
          snapToOffsets={COLUMN_OFFSETS}
          decelerationRate="fast"
          contentContainerStyle={styles.board}
        >
          {COLUMNS.map((status, colIndex) => {
            const items = shown.filter((pr) => pr.status === status)
            return (
              // flex:1 stretches the column to the full board height so the empty
              // space below the cards is still part of the swipe surface.
              <View key={status} style={{ width: COLUMN_WIDTH, flex: 1 }}>
                <View style={styles.columnHead}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: projectStatusChip(p, status).text }} />
                  <Text style={{ fontSize: 13, fontFamily: fonts.sansSemibold, color: p.textHigh }}>
                    {PROJECT_STATUS_LABELS[status]}
                  </Text>
                  <Text style={{ fontSize: 12, fontFamily: fonts.mono, color: p.textMuted, fontVariant: ['tabular-nums'] }}>
                    {items.length}
                  </Text>
                </View>

                <View style={{ gap: space.sm }}>
                {items.map((pr) => {
                  const days = daysUntil(pr.dueDate)
                  const overdue = days != null && days < 0
                  return (
                    <DraggableCard
                      key={pr.id}
                      enabled={canEdit}
                      canMoveLeft={colIndex > 0}
                      canMoveRight={colIndex < COLUMNS.length - 1}
                      onMove={(dir) => shift(pr, dir)}
                      onOpen={() => router.push(`/project/${pr.id}`)}
                      onDragStateChange={setDragging}
                    >
                      <Card>
                        <Text style={{ fontSize: 14, fontFamily: fonts.sansSemibold, color: p.textHigh, marginBottom: 6 }}>
                          {pr.title}
                        </Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: space.sm }}>
                          <PhaseChip phase={phaseOf(pr)} />
                          {!clientId ? <Chip label={clientName(pr.clientId)} colors={{ bg: p.hover, border: p.border, text: p.textSecondary }} /> : null}
                          {catName(pr.categoryId) ? <Chip label={catName(pr.categoryId)!} colors={projectStatusChip(p, 'planning')} /> : null}
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
                          <Text
                            numberOfLines={1}
                            style={{ fontSize: 11, fontFamily: fonts.mono, color: overdue ? p.danger : p.textMuted, fontVariant: ['tabular-nums'], flex: 1 }}
                          >
                            {pr.dueDate ? `${fmtDate(pr.dueDate)}${overdue ? ' · overdue' : ''}` : 'No due date'}
                          </Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                            {pr.assigneeId ? <Avatar name={userName(pr.assigneeId)} size={22} /> : null}
                            {canEdit ? (
                              // Keeps the board operable without the drag gesture
                              // (accessibility, and any column not adjacent).
                              <Pressable
                                onPress={() => setMoving(pr)}
                                hitSlop={8}
                                accessibilityRole="button"
                                accessibilityLabel={`Move ${pr.title} to another column`}
                              >
                                <Feather name="move" size={15} color={p.iconMuted} />
                              </Pressable>
                            ) : null}
                          </View>
                        </View>
                      </Card>
                    </DraggableCard>
                  )
                })}
                {/* Skeleton until the session resolves — otherwise the column claims "Empty"
                    before we know whether it is. */}
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

      {canEdit ? <Fab icon="plus" onPress={() => setCreating(true)} aboveTabBar /> : null}

      {/* Themed sheet rather than a system Alert (DESIGN.md #5: no default
          alert()/confirm() — every visible surface is a decision). */}
      <ActionSheet
        visible={moving != null}
        title={moving?.title}
        actions={COLUMNS.filter((s) => s !== moving?.status).map((s) => ({
          label: PROJECT_STATUS_LABELS[s],
          icon: 'corner-down-right' as const,
          onPress: () => { if (moving) moveProject(moving.id, s, 0) },
        }))}
        onClose={() => setMoving(null)}
      />

      <ProjectForm visible={creating} defaultClientId={clientId ?? undefined} onClose={() => setCreating(false)} />
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
  boardOuter: {
    // Stretch to the viewport so the empty area below the cards is swipeable.
    flexGrow: 1,
    // Clears the floating tab pill.
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
} as const
