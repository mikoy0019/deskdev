import { useMemo } from 'react'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Pressable, Text, View } from 'react-native'

import {
  Avatar, Card, Chip, EmptyState, RowSkeleton, Screen, SectionTitle, StatSkeleton,
  type FeatherIconName,
} from '@/components/ui'
import { useSession } from '@/context/session-context'
import { can } from '@/lib/permissions'
import { fmtMinutes, fmtRelative, fmtTime, fmtDate, isoDate } from '@/lib/format'
import { accentChip, fonts, priorityChip, radius, useTheme } from '@/lib/theme'
import { getEventOccurrences, useStore } from '@/store/useStore'
import { useUnreadMessageCount } from '@/hooks/useUnreadMessageCount'

// Skeleton / StatSkeleton / RowSkeleton now live in @/components/ui so every tab can
// use them — they were good, and stranded here.

// ─── Stat tile (editorial: muted icon chip + display numeral, tabular) ───────

function Stat({ label, value, icon, sub, onPress }: {
  label: string
  value: string | number
  icon: FeatherIconName
  sub?: string
  onPress?: () => void
}) {
  const p = useTheme()
  return (
    <Card onPress={onPress} style={{ flex: 1, minWidth: 150 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text
          numberOfLines={1}
          style={{ flex: 1, fontSize: 11, fontFamily: fonts.sansSemibold, color: p.textMuted, textTransform: 'uppercase', letterSpacing: 1 }}
        >
          {label}
        </Text>
        <View style={{ width: 30, height: 30, borderRadius: radius.md, backgroundColor: p.hover, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name={icon} size={15} color={p.iconMuted} />
        </View>
      </View>
      <Text style={{ marginTop: 10, fontFamily: fonts.display, fontSize: 30, lineHeight: 34, color: p.textHigh, fontVariant: ['tabular-nums'] }}>
        {value}
      </Text>
      {sub ? (
        <Text
          numberOfLines={1}
          style={{ marginTop: 3, fontSize: 11, fontFamily: fonts.mono, color: p.textMuted, fontVariant: ['tabular-nums'] }}
        >
          {sub}
        </Text>
      ) : null}
    </Card>
  )
}

function SectionHeader({ title, onPress, linkLabel }: { title: string; onPress?: () => void; linkLabel?: string }) {
  const p = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
      <SectionTitle style={{ marginBottom: 0 }}>{title}</SectionTitle>
      {onPress ? (
        <Pressable onPress={onPress} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <Text style={{ fontSize: 12, fontFamily: fonts.sansMedium, color: p.brandText }}>{linkLabel ?? 'View all'}</Text>
          <Feather name="arrow-right" size={12} color={p.brandText} />
        </Pressable>
      ) : null}
    </View>
  )
}

export default function Home() {
  const p = useTheme()
  const router = useRouter()
  const { user, ready } = useSession()
  const today = isoDate()

  const clients = useStore((s) => s.clients)
  const tasks = useStore((s) => s.tasks)
  const projects = useStore((s) => s.projects)
  const events = useStore((s) => s.events)
  const timeEntries = useStore((s) => s.timeEntries)
  const activity = useStore((s) => s.taskActivity)
  const users = useStore((s) => s.users)
  const notifications = useStore((s) => s.notifications)

  const canTasks = can(user, 'tasks', 'view')
  const canProjects = can(user, 'projects', 'view')
  const canMeetings = can(user, 'meetings', 'view')

  const clientName = (id?: string) => clients.find((c) => c.id === id)?.name ?? 'No client'
  const userName = (id?: string) => users.find((u) => u.id === id)?.fullName ?? 'Someone'

  const openTasks = tasks.filter((t) => t.status !== 'done' && !t.archived)
  const dueToday = openTasks.filter((t) => t.dueDate === today)
  const overdue = openTasks.filter((t) => t.dueDate && t.dueDate < today)
  const activeProjects = projects.filter((p2) => p2.status !== 'done')
  const unread = notifications.filter((n) => n.userId === user?.id && !n.read).length
  const unreadMessages = useUnreadMessageCount()
  const entriesToday = timeEntries.filter((e) => e.entryDate === today)
  const hoursToday = entriesToday.reduce((a, e) => a + e.minutes, 0)

  const todaysMeetings = useMemo(() => {
    const start = `${today}T00:00:00`
    const end = `${today}T23:59:59`
    return getEventOccurrences(events, start, end).filter((o) => o.event.kind === 'meeting')
  }, [events, today])

  const dueList = [...overdue, ...dueToday].slice(0, 5)
  const recent = [...activity].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6)

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const firstName = user?.fullName.split(' ')[0] ?? 'there'
  const dateLine = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

  const activitySentence = (a: (typeof recent)[number]) => {
    const who = userName(a.actorId)
    const d = a.detail as Record<string, string>
    if (a.action === 'completed') return `${who} completed a task`
    if (a.action === 'status_changed') return `${who} moved a task to ${(d.to ?? '').replace('_', ' ')}`
    if (a.action === 'created') return `${who} created a task`
    if (a.action === 'assigned') return `${who} reassigned a task`
    return `${who} updated a task`
  }

  return (
    // Home's greeting *is* its header, so it stays in the scroll flow rather
    // than using <ScreenHeader> — it should scroll away, not sit pinned.
    <Screen scroll tabScreen>
      {/* ── Greeting ─────────────────────────────────────────────── */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.display, fontSize: 26, lineHeight: 30, color: p.textHigh }}>
            {greeting}, {firstName}
          </Text>
          <Text style={{ marginTop: 4, fontSize: 12, fontFamily: fonts.mono, color: p.textMuted, fontVariant: ['tabular-nums'] }}>
            {dateLine}
          </Text>
        </View>
        <Pressable onPress={() => router.push('/messages')} hitSlop={6} style={{ padding: 6 }} accessibilityLabel={unreadMessages > 0 ? `Messages, ${unreadMessages} unread` : 'Messages'}>
          <Feather name="message-circle" size={20} color={p.textSecondary} />
          {unreadMessages > 0 ? (
            <View style={{ position: 'absolute', top: 0, right: 0, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: p.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}>
              <Text style={{ color: '#fff', fontSize: 9, fontFamily: fonts.monoSemibold, fontVariant: ['tabular-nums'] }}>{unreadMessages > 9 ? '9+' : unreadMessages}</Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable onPress={() => router.push('/notifications')} hitSlop={6} style={{ padding: 6 }}>
          <Feather name="bell" size={20} color={p.textSecondary} />
          {unread > 0 ? (
            <View style={{ position: 'absolute', top: 0, right: 0, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: p.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}>
              <Text style={{ color: '#fff', fontSize: 9, fontFamily: fonts.monoSemibold, fontVariant: ['tabular-nums'] }}>{unread}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      {/* ── Stat row ─────────────────────────────────────────────── */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 20, marginBottom: 20 }}>
        {!ready ? (
          <>
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
          </>
        ) : (
          <>
            {canTasks ? (
              <Stat label="Open tasks" value={openTasks.length} icon="check-square" sub={overdue.length ? `${overdue.length} overdue` : undefined} onPress={() => router.push('/(tabs)/tasks')} />
            ) : null}
            {canTasks ? (
              <Stat label="Due today" value={dueToday.length} icon="clock" onPress={() => router.push('/(tabs)/tasks')} />
            ) : null}
            {canProjects ? (
              <Stat label="Active projects" value={activeProjects.length} icon="briefcase" onPress={() => router.push('/(tabs)/projects')} />
            ) : null}
            {canTasks ? (
              <Stat label="Hours today" value={fmtMinutes(hoursToday)} icon="watch" sub={`${entriesToday.length} ${entriesToday.length === 1 ? 'entry' : 'entries'}`} onPress={() => router.push('/(tabs)/tasks')} />
            ) : null}
          </>
        )}
      </View>

      {/* ── Today's meetings ─────────────────────────────────────── */}
      {canMeetings && (
        <View style={{ marginBottom: 20 }}>
          <SectionHeader title="Today's meetings" onPress={() => router.push('/meetings')} linkLabel="Open" />
          {!ready ? (
            <RowSkeleton />
          ) : todaysMeetings.length === 0 ? (
            <EmptyState icon="video" title="No meetings today" hint="Your schedule is clear. Meetings appear here on the day they occur." />
          ) : (
            <View style={{ gap: 8 }}>
              {todaysMeetings.map((o) => (
                <Card key={o.occurrenceId} onPress={() => router.push('/meetings')}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <Text style={{ fontSize: 13, fontFamily: fonts.monoMedium, color: p.text, width: 64, fontVariant: ['tabular-nums'] }}>{fmtTime(o.startsAt)}</Text>
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={{ fontSize: 14, fontFamily: fonts.sansSemibold, color: p.textHigh }}>{o.event.title}</Text>
                      <Text numberOfLines={1} style={{ fontSize: 12, fontFamily: fonts.sans, color: p.textMuted }}>{clientName(o.event.clientId)}</Text>
                    </View>
                    <Feather name="video" size={16} color={p.iconMuted} />
                  </View>
                </Card>
              ))}
            </View>
          )}
        </View>
      )}

      {/* ── Due & overdue tasks ──────────────────────────────────── */}
      {canTasks && (
        <View style={{ marginBottom: 20 }}>
          <SectionHeader title="Due & overdue tasks" onPress={() => router.push('/(tabs)/tasks')} linkLabel="Open" />
          {!ready ? (
            <RowSkeleton />
          ) : dueList.length === 0 ? (
            <EmptyState icon="check-circle" title="Nothing due" hint="No open tasks are due today or overdue. Nice work." />
          ) : (
            <View style={{ gap: 8 }}>
              {dueList.map((t) => {
                const isOverdue = !!t.dueDate && t.dueDate < today
                return (
                  <Card key={t.id} onPress={() => router.push('/(tabs)/tasks')}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Text numberOfLines={1} style={{ fontSize: 14, fontFamily: fonts.sansSemibold, color: p.textHigh }}>{t.title}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 }}>
                          <Chip label={isOverdue ? 'Overdue' : 'Due today'} colors={accentChip(isOverdue ? 'rose' : 'amber')} />
                          <Text style={{ fontSize: 11, fontFamily: fonts.mono, color: p.textMuted, fontVariant: ['tabular-nums'] }} numberOfLines={1}>
                            {isOverdue ? `was due ${fmtDate(t.dueDate)}` : clientName(t.clientId)}
                          </Text>
                        </View>
                      </View>
                      <Chip label={t.priority.toUpperCase()} colors={priorityChip(p, t.priority)} />
                      {t.assigneeId ? <Avatar name={userName(t.assigneeId)} size={26} /> : null}
                    </View>
                  </Card>
                )
              })}
            </View>
          )}
        </View>
      )}

      {/* ── Recent activity ──────────────────────────────────────── */}
      {canTasks && (
        <View style={{ marginBottom: 24 }}>
          <SectionHeader title="Recent activity" />
          {!ready ? (
            <RowSkeleton />
          ) : recent.length === 0 ? (
            <EmptyState icon="activity" title="No activity yet" hint="Task creations, status moves, and completions show up here as your team works." />
          ) : (
            <Card style={{ gap: 14 }}>
              {recent.map((a) => (
                <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Avatar name={userName(a.actorId)} size={26} />
                  <Text style={{ flex: 1, fontSize: 13, fontFamily: fonts.sans, color: p.text }} numberOfLines={2}>{activitySentence(a)}</Text>
                  <Text style={{ fontSize: 11, fontFamily: fonts.mono, color: p.textMuted, fontVariant: ['tabular-nums'] }}>{fmtRelative(a.createdAt)}</Text>
                </View>
              ))}
            </Card>
          )}
        </View>
      )}

      {/* ── No-access welcome ────────────────────────────────────── */}
      {!canTasks && !canProjects && !canMeetings && (
        <EmptyState
          icon="inbox"
          title="Welcome to DeskDev"
          hint="You don't have access to any workspace features yet. Ask an admin to grant you permissions."
        />
      )}
    </Screen>
  )
}
