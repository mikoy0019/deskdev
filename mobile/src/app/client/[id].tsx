import { useMemo } from 'react'
import { Feather } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Text, View } from 'react-native'

import EmailThreads from '@/components/EmailThreads'
import { PhaseChip } from '@/components/projects/PhaseChip'
import { Avatar, Button, Card, Chip, EmptyState, Screen, SectionTitle } from '@/components/ui'
import { can } from '@/lib/permissions'
import { phaseOf } from '@/lib/projectPhase'
import {
  accentChip, CLIENT_STATUS_LABELS, clientStatusChip, engagementChip, ENGAGEMENT_LABELS, fonts,
  projectStatusChip, PROJECT_STATUS_LABELS, useTheme,
} from '@/lib/theme'
import type { ClientShowcaseConsent } from '@/lib/types'
import { useCurrentUser, useStore } from '@/store/useStore'
import { useShallow } from 'zustand/react/shallow'

/** Portfolio consent (037) as a header chip; 'unknown' shows nothing. */
const CONSENT_CHIP: Partial<Record<ClientShowcaseConsent, { label: string; accent: 'emerald' | 'rose' }>> = {
  granted: { label: 'Portfolio: yes', accent: 'emerald' },
  declined: { label: 'Portfolio: private', accent: 'rose' },
}

export default function ClientDetail() {
  const p = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()

  const client = useStore((s) => s.clients.find((c) => c.id === id))
  const projects = useStore(useShallow((s) => s.projects.filter((pr) => pr.clientId === id)))
  const tasks = useStore(useShallow((s) => s.tasks.filter((t) => t.clientId === id && !t.archived)))
  const emails = useStore((s) => s.emails)
  const leads = useStore((s) => s.leads)
  const user = useCurrentUser()
  const canEdit = can(user, 'clients', 'edit')

  // The client's emails: on the client, on its projects (e.g. the onboarding
  // form sent from a project), and from the lead it was converted from — the
  // web ClientDetail filter.
  const clientEmails = useMemo(() => {
    const fromLeads = new Set(leads.filter((l) => l.clientId === id).map((l) => l.id))
    const ofProjects = new Set(projects.map((pr) => pr.id))
    return emails.filter(
      (e) => e.clientId === id || (e.leadId && fromLeads.has(e.leadId)) || (e.projectId && ofProjects.has(e.projectId)),
    )
  }, [emails, leads, projects, id])

  if (!client) {
    return <Screen><EmptyState icon="alert-circle" title="Client not found" /></Screen>
  }

  const openTasks = tasks.filter((t) => t.status !== 'done')

  return (
    <Screen scroll>
      <Card style={{ marginBottom: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <Avatar name={client.name} colorClass={client.color} size={48} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 19, fontFamily: fonts.display, color: p.textHigh }}>{client.name}</Text>
            {client.company ? <Text style={{ fontSize: 13, fontFamily: fonts.sans, color: p.textMuted }}>{client.company}</Text> : null}
          </View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          <Chip label={ENGAGEMENT_LABELS[client.engagement]} colors={engagementChip(client.engagement)} />
          <Chip label={CLIENT_STATUS_LABELS[client.status]} colors={clientStatusChip(client.status)} />
          {client.showcaseConsent && CONSENT_CHIP[client.showcaseConsent] ? (
            <Chip
              label={CONSENT_CHIP[client.showcaseConsent]!.label}
              colors={accentChip(CONSENT_CHIP[client.showcaseConsent]!.accent)}
            />
          ) : null}
        </View>
        {client.email ? <InfoRow icon="mail" text={client.email} /> : null}
        {client.phone ? <InfoRow icon="phone" text={client.phone} /> : null}
        {client.notes ? <Text style={{ fontSize: 13, fontFamily: fonts.sans, color: p.text, marginTop: 8, lineHeight: 19 }}>{client.notes}</Text> : null}
        <Button title="End of Day Report" icon="file-text" variant="ghost" onPress={() => router.push('/eod')} style={{ marginTop: 14 }} />
      </Card>

      <SectionTitle>Projects ({projects.length})</SectionTitle>
      <View style={{ gap: 8, marginBottom: 16 }}>
        {projects.length === 0 ? <Card><Text style={{ color: p.textMuted, fontSize: 13, fontFamily: fonts.sans }}>No projects.</Text></Card> :
          projects.map((pr) => (
            <Card key={pr.id} onPress={() => router.push(`/project/${pr.id}`)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ flex: 1, fontSize: 14, fontFamily: fonts.sansSemibold, color: p.textHigh }}>{pr.title}</Text>
                <PhaseChip phase={phaseOf(pr)} />
                <Chip label={PROJECT_STATUS_LABELS[pr.status]} colors={projectStatusChip(p, pr.status)} />
              </View>
            </Card>
          ))}
      </View>

      {/* Email (049): sent from the studio's Gmail by n8n; replies come back the same way. */}
      <SectionTitle>Email</SectionTitle>
      <View style={{ marginBottom: 16 }}>
        <EmailThreads
          emails={clientEmails}
          clientId={client.id}
          person={{ name: client.name, email: client.email }}
          canSend={canEdit}
        />
      </View>

      <SectionTitle>Open tasks ({openTasks.length})</SectionTitle>
      <View style={{ gap: 8 }}>
        {openTasks.length === 0 ? <Card><Text style={{ color: p.textMuted, fontSize: 13, fontFamily: fonts.sans }}>No open tasks.</Text></Card> :
          openTasks.slice(0, 12).map((t) => (
            <Card key={t.id}>
              <Text style={{ fontSize: 14, fontFamily: fonts.sans, color: p.textHigh }}>{t.title}</Text>
            </Card>
          ))}
      </View>
    </Screen>
  )
}

function InfoRow({ icon, text }: { icon: any; text: string }) {
  const p = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
      <Feather name={icon} size={14} color={p.iconMuted} />
      <Text style={{ fontSize: 13, fontFamily: fonts.sans, color: p.text }}>{text}</Text>
    </View>
  )
}
