import { useMemo, useState } from 'react'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Alert, Text, View } from 'react-native'

import FormSheet from '@/components/FormSheet'
import ShareLinkSheet from '@/components/ShareLinkSheet'
import { FormModal } from '@/components/forms'
import { Button, Card, Input, Label } from '@/components/ui'
import { fmtDate } from '@/lib/format'
import { ONBOARDING_FORM, formProgress, onboardingPrefill } from '@/lib/forms'
import { can, isAdmin } from '@/lib/permissions'
import { PHASES, PHASE_LABEL, phaseOf } from '@/lib/projectPhase'
import { quickFormEmail, quickFormState } from '@/lib/quickForm'
import { isHttpsUrl } from '@/lib/showcase'
import { fonts, radius, rgba, useTheme } from '@/lib/theme'
import type { Project, ProjectPhase } from '@/lib/types'
import { useCurrentUser, useStore } from '@/store/useStore'

// The project's stage bar (046) — the mobile counterpart of the web's
// components/projects/ProjectStages.tsx: Onboarding → Development → Launched,
// and the one action each stage needs. Onboarding ends with the form complete
// and "Proceed to development"; development ends with "Development done",
// which takes the live URL and launches the project (its portfolio draft
// follows, 037).

const ICON: Record<ProjectPhase, keyof typeof Feather.glyphMap> = {
  onboarding: 'clipboard',
  development: 'code',
  launched: 'send',
}

/** The enquiry this client came from: the newest lead converted into it. */
function useOriginLead(clientId: string) {
  const leads = useStore((s) => s.leads)
  return useMemo(
    () => leads.filter((l) => l.clientId === clientId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0],
    [leads, clientId],
  )
}

/** "Development done": the live URL, then launched (status done → 037 drafts the portfolio entry). */
function LaunchSheet({ project, onClose }: { project: Project; onClose: () => void }) {
  const p = useTheme()
  const setProjectPhase = useStore((s) => s.setProjectPhase)
  const [url, setUrl] = useState(project.liveUrl ?? '')
  const trimmed = url.trim()
  const error = trimmed && !isHttpsUrl(trimmed) ? 'Use the full https:// address of the live site' : null

  const launch = () => {
    if (error) {
      Alert.alert('Check the address', error)
      return
    }
    const result = setProjectPhase(project.id, 'launched', { liveUrl: trimmed || undefined })
    if (!result.ok) {
      Alert.alert('Not launched', result.error ?? 'Could not launch the project')
      return
    }
    Alert.alert('Launched', trimmed ? 'Its portfolio draft is ready in Portfolio.' : 'The project is marked done.')
    onClose()
  }

  return (
    <FormModal visible title="Development done" onClose={onClose} onSubmit={launch} submitLabel="Mark as launched">
      <Text style={{ fontSize: 14, fontFamily: fonts.sans, color: p.text, lineHeight: 20 }}>
        This marks <Text style={{ fontFamily: fonts.sansSemibold, color: p.textHigh }}>{project.title}</Text> done and
        launched. With the live URL, a portfolio draft is created for the developer to fill in; an admin publishes it to
        the website.
      </Text>
      <View>
        <Label>Live site URL</Label>
        <Input
          value={url}
          onChangeText={setUrl}
          placeholder="https://client-site.com"
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="URL"
        />
        {error ? (
          <Text style={{ fontSize: 12, fontFamily: fonts.sansMedium, color: p.danger, marginTop: 4 }}>{error}</Text>
        ) : !trimmed ? (
          <Text style={{ fontSize: 12, fontFamily: fonts.sans, color: p.warn, marginTop: 4 }}>
            Without a live URL no portfolio draft is created.
          </Text>
        ) : null}
      </View>
    </FormModal>
  )
}

export function ProjectStages({ project }: { project: Project }) {
  const p = useTheme()
  const router = useRouter()
  const user = useCurrentUser()
  const canEdit = can(user, 'projects', 'edit')
  const admin = isAdmin(user)
  const setProjectPhase = useStore((s) => s.setProjectPhase)
  const createFormLink = useStore((s) => s.createFormLink)
  const response = useStore((s) => s.formResponses.find((r) => r.form === ONBOARDING_FORM.key && r.projectId === project.id))
  const portfolio = useStore((s) => s.showcaseItems.find((i) => i.projectId === project.id))
  const client = useStore((s) => s.clients.find((c) => c.id === project.clientId))
  const me = useStore((s) => s.users.find((u) => u.id === s.currentUserId))
  const lead = useOriginLead(project.clientId)
  const [open, setOpen] = useState<'form' | 'share' | 'launch' | null>(null)

  const phase = phaseOf(project)
  const current = PHASES.indexOf(phase)
  const onboarded = response?.status === 'submitted'
  const progress = formProgress(ONBOARDING_FORM, response?.answers ?? {})
  const link = quickFormState(response)
  const prefill = onboardingPrefill({ project, client, lead })
  const customerName = lead?.name ?? client?.name

  const move = (to: ProjectPhase, force = false) => {
    const result = setProjectPhase(project.id, to, { force })
    if (!result.ok) Alert.alert('Not moved', result.error ?? 'Could not change the stage')
  }

  const confirmSkip = () =>
    Alert.alert(
      'Skip onboarding?',
      `Move "${project.title}" to development without the onboarding form? Use this for internal work or projects onboarded elsewhere.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Skip to development', onPress: () => move('development', true) },
      ],
    )

  const confirmReopen = () =>
    Alert.alert('Reopen development?', `Move "${project.title}" back to development? Its portfolio entry stays as it is.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reopen', onPress: () => move('development') },
    ])

  const status =
    phase === 'onboarding'
      ? onboarded
        ? 'Onboarding form complete. Ready for development.'
        : link === 'answered'
          ? 'The client sent their answers — review and complete the form.'
          : `Onboarding form: ${progress.done} of ${progress.required} required answered${link === 'open' ? ' · sent to the client' : ''}.`
      : phase === 'development'
        ? `In development${project.phaseChangedAt ? ` since ${fmtDate(project.phaseChangedAt)}` : ''}.`
        : `Launched${project.phaseChangedAt ? ` ${fmtDate(project.phaseChangedAt)}` : ''}.${portfolio || project.liveUrl ? '' : ' Add the live URL to draft its portfolio entry.'}`

  return (
    <Card style={{ marginBottom: 16, gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 6 }} accessibilityRole="progressbar" accessibilityLabel={`Stage: ${PHASE_LABEL[phase]}`}>
        {PHASES.map((ph, i) => {
          const done = i < current
          const active = i === current
          return (
            <View
              key={ph}
              style={{
                flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
                paddingHorizontal: 8, paddingVertical: 7, borderRadius: radius.md,
                backgroundColor: active ? p.brand : 'transparent',
              }}
            >
              <View
                style={{
                  width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: active ? rgba('#ffffff', 0.2) : done ? rgba(p.success, 0.15) : p.hover,
                }}
              >
                <Feather
                  name={done ? 'check' : ICON[ph]}
                  size={10}
                  color={active ? '#ffffff' : done ? p.success : p.iconMuted}
                />
              </View>
              <Text
                numberOfLines={1}
                style={{
                  flexShrink: 1, fontSize: 12,
                  fontFamily: active ? fonts.sansSemibold : fonts.sansMedium,
                  color: active ? '#ffffff' : done ? p.textHigh : p.textMuted,
                }}
              >
                {PHASE_LABEL[ph]}
              </Text>
            </View>
          )
        })}
      </View>

      <Text style={{ fontSize: 13, fontFamily: fonts.sans, color: link === 'answered' && !onboarded ? p.brandText : p.text, lineHeight: 19 }}>
        {status}
      </Text>

      <View style={{ gap: 8 }}>
        {phase === 'onboarding' ? (
          <>
            <Button
              title={onboarded ? 'View onboarding form' : 'Onboarding form'}
              icon="clipboard"
              variant={onboarded ? 'ghost' : 'primary'}
              onPress={() => setOpen('form')}
            />
            {canEdit && !onboarded && link !== 'answered' ? (
              <Button
                title={link === 'open' ? 'Resend to client' : 'Send to client'}
                icon="send"
                variant="ghost"
                onPress={() => setOpen('share')}
              />
            ) : null}
            {canEdit ? (
              <Button
                title="Proceed to development"
                icon="arrow-right"
                variant={onboarded ? 'primary' : 'ghost'}
                disabled={!onboarded}
                onPress={() => move('development')}
              />
            ) : null}
            {canEdit && admin && !onboarded ? (
              <Button title="Skip onboarding" variant="ghost" onPress={confirmSkip} />
            ) : null}
          </>
        ) : null}

        {phase === 'development' ? (
          <>
            {canEdit ? <Button title="Development done" icon="send" onPress={() => setOpen('launch')} /> : null}
            {response ? <Button title="Onboarding details" icon="clipboard" variant="ghost" onPress={() => setOpen('form')} /> : null}
          </>
        ) : null}

        {phase === 'launched' ? (
          <>
            {portfolio ? (
              <Button title="Fill in its portfolio entry" icon="image" onPress={() => router.push(`/portfolio/${portfolio.id}`)} />
            ) : null}
            {response ? <Button title="Onboarding details" icon="clipboard" variant="ghost" onPress={() => setOpen('form')} /> : null}
            {canEdit ? <Button title="Reopen development" variant="ghost" onPress={confirmReopen} /> : null}
          </>
        ) : null}
      </View>

      {open === 'form' ? (
        <FormSheet
          visible
          template={ONBOARDING_FORM}
          projectId={project.id}
          prefill={prefill}
          completeLabel="Complete onboarding"
          customerName={customerName}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {open === 'share' ? (
        <ShareLinkSheet
          visible
          title={`Send “${ONBOARDING_FORM.customer?.title ?? ONBOARDING_FORM.title}”`}
          intro="They see only the questions meant for them, never your internal notes, with what we already know filled in. The link works for 14 days; a new link closes the old one."
          create={async () => {
            const res = await createFormLink({
              form: ONBOARDING_FORM.key,
              projectId: project.id,
              sharedTo: client?.email ?? lead?.email,
              answers: prefill,
            })
            return res.ok && res.url ? { url: res.url } : { error: res.error }
          }}
          email={(url) =>
            quickFormEmail({
              name: customerName,
              formTitle: ONBOARDING_FORM.customer?.title ?? ONBOARDING_FORM.title,
              url,
              from: me?.fullName,
            })
          }
          projectId={project.id}
          person={{ name: customerName, email: client?.email ?? lead?.email }}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {open === 'launch' ? <LaunchSheet project={project} onClose={() => setOpen(null)} /> : null}
    </Card>
  )
}
