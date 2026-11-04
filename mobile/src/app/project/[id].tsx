import { useState } from 'react'
import { Feather } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Linking, Pressable, Text, View } from 'react-native'

import { Card, Chip, EmptyState, Screen, SectionTitle } from '@/components/ui'
import { ProjectForm } from '@/components/ProjectForm'
import { PhaseChip } from '@/components/projects/PhaseChip'
import { ProjectStages } from '@/components/projects/ProjectStages'
import { useSession } from '@/context/session-context'
import { can } from '@/lib/permissions'
import { fmtDate, fmtMoney } from '@/lib/format'
import { phaseOf } from '@/lib/projectPhase'
import {
  accentChip, fonts, neutralChip, PROJECT_STATUS_LABELS, projectStatusChip, radius, rgba, taskStatusChip,
  TASK_STATUS_LABELS, useTheme, type Accent,
} from '@/lib/theme'
import { useStore } from '@/store/useStore'
import { useShallow } from 'zustand/react/shallow'
import type { ProjectStatus, ShowcaseStatus } from '@/lib/types'

const STATUSES: ProjectStatus[] = ['backlog', 'planning', 'in_progress', 'waiting', 'done']

/** A portfolio entry's status, as the web's Portfolio desk names it. */
const SHOWCASE_STATUS: Record<ShowcaseStatus, { label: string; accent?: Accent }> = {
  draft: { label: 'Draft' },
  ready: { label: 'Ready for review', accent: 'amber' },
  published: { label: 'Live on site', accent: 'emerald' },
  hidden: { label: 'Hidden' },
  archived: { label: 'Archived' },
}

export default function ProjectDetail() {
  const p = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { user } = useSession()
  const canEdit = can(user, 'projects', 'edit')

  const project = useStore((s) => s.projects.find((pr) => pr.id === id))
  const client = useStore((s) => s.clients.find((c) => c.id === project?.clientId))
  const category = useStore((s) => s.projectCategories.find((c) => c.id === project?.categoryId))
  const tasks = useStore(useShallow((s) => s.tasks.filter((t) => t.projectId === id)))
  const moveProject = useStore((s) => s.moveProject)
  // Drafted by 037's showcase_on_project once the project is launched with a live URL.
  const portfolio = useStore((s) => s.showcaseItems.find((i) => i.projectId === id))

  const [editing, setEditing] = useState(false)

  if (!project) {
    return <Screen><EmptyState icon="alert-circle" title="Project not found" /></Screen>
  }

  return (
    <Screen scroll>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 6 }}>
        <Text style={{ flex: 1, fontSize: 21, fontFamily: fonts.display, color: p.textHigh }}>{project.title}</Text>
        {canEdit ? (
          <Pressable onPress={() => setEditing(true)} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4 }}>
            <Feather name="edit-2" size={16} color={p.brandText} />
            <Text style={{ fontSize: 13, color: p.brandText, fontFamily: fonts.sansSemibold }}>Edit</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
        <PhaseChip phase={phaseOf(project)} />
        <Chip label={PROJECT_STATUS_LABELS[project.status]} colors={projectStatusChip(p, project.status)} />
        {category ? (
          // Raw slate ignored the theme and read muddy on dark (DESIGN.md #9).
          // One themed fallback, resolved once instead of three times.
          <Chip
            label={category.name}
            colors={(() => {
              const c = category.color ?? p.iconMuted
              return { bg: rgba(c, 0.15), border: rgba(c, 0.3), text: c }
            })()}
          />
        ) : null}
        {client ? (
          <Pressable onPress={() => router.push(`/client/${client.id}`)}>
            <Chip label={client.name} colors={{ bg: p.hover, border: p.border, text: p.textSecondary }} />
          </Pressable>
        ) : null}
      </View>

      {/* Onboarding → Development → Launched, and the action the stage needs. */}
      <ProjectStages project={project} />

      <Card style={{ marginBottom: 16, gap: 8 }}>
        <Row label="Start" value={project.startDate ? fmtDate(project.startDate) : '—'} />
        <Row label="Due" value={project.dueDate ? fmtDate(project.dueDate) : '—'} />
        <Row label="Budget" value={project.budget != null ? fmtMoney(project.budget) : '—'} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <Text style={{ fontSize: 13, fontFamily: fonts.sans, color: p.textMuted }}>Live site</Text>
          {project.liveUrl ? (
            <Pressable
              onPress={() => void Linking.openURL(project.liveUrl!)}
              hitSlop={8}
              accessibilityRole="link"
              style={{ flexShrink: 1 }}
            >
              <Text numberOfLines={1} style={{ fontSize: 13, fontFamily: fonts.sansMedium, color: p.brandText }}>
                {project.liveUrl.replace(/^https:\/\//, '')}
              </Text>
            </Pressable>
          ) : (
            <Text style={{ fontSize: 13, fontFamily: fonts.monoMedium, color: p.textHigh }}>—</Text>
          )}
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <Text style={{ fontSize: 13, fontFamily: fonts.sans, color: p.textMuted }}>Portfolio</Text>
          {portfolio ? (
            <Pressable
              onPress={() => router.push(`/portfolio/${portfolio.id}`)}
              hitSlop={8}
              accessibilityRole="link"
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
            >
              <Chip
                label={SHOWCASE_STATUS[portfolio.status].label}
                colors={SHOWCASE_STATUS[portfolio.status].accent ? accentChip(SHOWCASE_STATUS[portfolio.status].accent!) : neutralChip(p)}
              />
              <Text style={{ fontSize: 13, fontFamily: fonts.sansMedium, color: p.brandText }}>Open entry</Text>
            </Pressable>
          ) : (
            <Text style={{ flexShrink: 1, textAlign: 'right', fontSize: 12, fontFamily: fonts.sans, color: p.textMuted }}>
              {project.status === 'done' && !project.liveUrl ? 'Add the live URL to draft one' : 'Drafted when launched with a live URL'}
            </Text>
          )}
        </View>
        {project.notes ? <Text style={{ fontSize: 13, fontFamily: fonts.sans, color: p.text, marginTop: 4, lineHeight: 19 }}>{project.notes}</Text> : null}
      </Card>

      {canEdit ? (
        <>
          <SectionTitle>Move to</SectionTitle>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {STATUSES.filter((s) => s !== project.status).map((s) => (
              <Pressable key={s} onPress={() => moveProject(project.id, s, 0)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: p.border, backgroundColor: p.card }}>
                <Text style={{ fontSize: 12, fontFamily: fonts.sansSemibold, color: p.textSecondary }}>{PROJECT_STATUS_LABELS[s]}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      <SectionTitle>Tasks ({tasks.length})</SectionTitle>
      <View style={{ gap: 8 }}>
        {tasks.length === 0 ? <Card><Text style={{ color: p.textMuted, fontSize: 13, fontFamily: fonts.sans }}>No tasks linked to this project.</Text></Card> :
          tasks.map((t) => (
            <Card key={t.id}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Feather name="check-circle" size={15} color={t.status === 'done' ? p.success : p.iconMuted} />
                <Text style={{ flex: 1, fontSize: 14, fontFamily: fonts.sans, color: p.textHigh }}>{t.title}</Text>
                <Chip label={TASK_STATUS_LABELS[t.status]} colors={taskStatusChip(p, t.status)} />
              </View>
            </Card>
          ))}
      </View>

      <ProjectForm visible={editing} project={project} onClose={() => setEditing(false)} />
    </Screen>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  const p = useTheme()
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ fontSize: 13, fontFamily: fonts.sans, color: p.textMuted }}>{label}</Text>
      <Text style={{ fontSize: 13, fontFamily: fonts.monoMedium, color: p.textHigh, fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  )
}
