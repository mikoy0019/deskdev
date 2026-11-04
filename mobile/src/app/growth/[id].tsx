import { useMemo, useState, type ReactNode } from 'react'
import { Feather } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Alert, Linking, Pressable, Text, View } from 'react-native'
import { useShallow } from 'zustand/react/shallow'

import EmailThreads from '@/components/EmailThreads'
import FormSheet from '@/components/FormSheet'
import ShareLinkSheet from '@/components/ShareLinkSheet'
import { DateField, FormModal, PillGroup, SelectField } from '@/components/forms'
import {
  ACTION_LABEL, LOST_REASONS, LOST_REASON_LABEL, SOURCE_LABEL, STAGES, STAGE_ACCENT, STAGE_LABEL, slaLine, useNow,
} from '@/components/growth/leadBits'
import { ActionSheet, Button, Card, Chip, EmptyState, Input, Label, Screen, SectionTitle } from '@/components/ui'
import { bookingEmail, bookingPageUrl } from '@/lib/booking'
import { DISCOVERY_FORM, discoveryPrefill, formProgress } from '@/lib/forms'
import { fmtDate, fmtDateTime, fmtMoney, fmtRelative } from '@/lib/format'
import {
  SCORE_RULE_LABEL, budgetLabel, leadTouches, serviceLabel, slaState, timelineLabel,
} from '@/lib/leads'
import { webHref } from '@/lib/links'
import { can } from '@/lib/permissions'
import { quickFormEmail, quickFormState } from '@/lib/quickForm'
import { accentChip, fonts, neutralChip, radius, rgba, space, useTheme } from '@/lib/theme'
import type { Lead, LeadSource, LeadStage, LeadTouch } from '@/lib/types'
import { useCurrentUser, useStore, type LeadTouchAction } from '@/store/useStore'

// One lead, on the phone — the web's LeadDrawer: the website brief in their
// words, the score and why, where they came from, the reply clock, owner and
// follow-up, touches (each stops the clock), meetings, email, the discovery
// form (filled in during the call or sent as a quick form), and the history.

const TOUCHES: { action: LeadTouchAction; label: string; icon: 'mail' | 'phone-call' | 'file-text' | 'users' }[] = [
  { action: 'email_sent', label: 'Replied by email', icon: 'mail' },
  { action: 'call_logged', label: 'Called', icon: 'phone-call' },
  { action: 'proposal_sent', label: 'Sent proposal', icon: 'file-text' },
  { action: 'meeting_booked', label: 'Meeting booked', icon: 'users' },
]

const SOURCES: LeadSource[] = ['seo', 'referral', 'linkedin', 'outbound', 'website', 'other']

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ marginBottom: 18 }}>
      <SectionTitle>{title}</SectionTitle>
      {children}
    </View>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  const p = useTheme()
  return (
    <View style={{ minWidth: '45%', flexGrow: 1 }}>
      <Text style={{ fontSize: 11, fontFamily: fonts.mono, color: p.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</Text>
      <Text style={{ fontSize: 14, fontFamily: fonts.sans, color: p.textHigh, marginTop: 2 }}>{value}</Text>
    </View>
  )
}

function ContactRow({ icon, text, url }: { icon: 'mail' | 'phone' | 'briefcase'; text: string; url?: string }) {
  const p = useTheme()
  const content = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 }}>
      <Feather name={icon} size={15} color={p.iconMuted} />
      <Text style={{ fontSize: 14, fontFamily: fonts.sans, color: url ? p.brandText : p.text }}>{text}</Text>
    </View>
  )
  if (!url) return content
  return (
    <Pressable onPress={() => void Linking.openURL(url)} accessibilityRole="link" accessibilityLabel={text} hitSlop={6}>
      {content}
    </Pressable>
  )
}

/** "google / cpc · q4-launch", or the referrer's host, or "Direct". */
function channelOf(touch: LeadTouch): string {
  const tagged = [touch.utm_source, touch.utm_medium].filter(Boolean).join(' / ')
  if (tagged) return touch.utm_campaign ? `${tagged} · ${touch.utm_campaign}` : tagged
  if (touch.gclid) return 'Google Ads'
  if (touch.referrer) {
    try {
      return new URL(touch.referrer).host
    } catch {
      return touch.referrer
    }
  }
  return 'Direct'
}

function TouchCard({ label, touch }: { label: string; touch: LeadTouch }) {
  const p = useTheme()
  return (
    <Card style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ fontSize: 12, fontFamily: fonts.mono, color: p.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</Text>
        {touch.at ? <Text style={{ fontSize: 11, fontFamily: fonts.mono, color: p.textMuted }}>{fmtDateTime(touch.at)}</Text> : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <Fact label="Channel" value={channelOf(touch)} />
        {touch.landing_page ? <Fact label="Landed on" value={touch.landing_page} /> : null}
        {touch.referrer ? <Fact label="Referrer" value={touch.referrer} /> : null}
        {touch.utm_term ? <Fact label="Term" value={touch.utm_term} /> : null}
      </View>
    </Card>
  )
}

/** Name, company and contact details — a lead added on the phone starts as "New lead". */
function EditDetails({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const updateLead = useStore((s) => s.updateLead)
  const [name, setName] = useState(lead.name)
  const [company, setCompany] = useState(lead.company ?? '')
  const [email, setEmail] = useState(lead.email ?? '')
  const [phone, setPhone] = useState(lead.phone ?? '')
  const [value, setValue] = useState(lead.value ? String(lead.value) : '')
  const [source, setSource] = useState<LeadSource>(lead.source)
  return (
    <FormModal
      visible
      title="Lead details"
      onClose={onClose}
      onSubmit={() => {
        if (!name.trim()) {
          Alert.alert('Name needed', 'Give the lead a name.')
          return
        }
        const amount = Number(value.replace(',', '.'))
        updateLead(lead.id, {
          name: name.trim(),
          company: company.trim() || undefined,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          value: Number.isFinite(amount) && amount > 0 ? amount : 0,
          source,
        })
        onClose()
      }}
    >
      <View>
        <Label>Name</Label>
        <Input value={name} onChangeText={setName} />
      </View>
      <View>
        <Label>Company</Label>
        <Input value={company} onChangeText={setCompany} />
      </View>
      <View>
        <Label>Email</Label>
        <Input value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
      </View>
      <View>
        <Label>Phone</Label>
        <Input value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      </View>
      <View>
        <Label>Estimated value (USD)</Label>
        <Input value={value} onChangeText={setValue} keyboardType="decimal-pad" placeholder="0" />
      </View>
      <View>
        <Label>Source</Label>
        <PillGroup options={SOURCES.map((s) => ({ label: SOURCE_LABEL[s], value: s }))} value={source} onChange={setSource} />
      </View>
    </FormModal>
  )
}

export default function LeadProfile() {
  const p = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const user = useCurrentUser()
  const canView = can(user, 'growth', 'view')
  const canEdit = can(user, 'growth', 'edit')
  const canConvert = canEdit && can(user, 'clients', 'edit')
  const now = useNow()

  const lead = useStore((s) => s.leads.find((l) => l.id === id))
  const users = useStore((s) => s.users)
  const clients = useStore((s) => s.clients)
  const activity = useStore(useShallow((s) => s.leadActivity.filter((a) => a.leadId === id)))
  const meetings = useStore(useShallow((s) => s.events.filter((e) => e.leadId === id)))
  const emails = useStore(useShallow((s) => s.emails.filter((e) => e.leadId === id)))
  const discovery = useStore((s) => s.formResponses.find((r) => r.form === DISCOVERY_FORM.key && r.leadId === id && !r.projectId))
  const bookingTitle = useStore((s) => s.workspaceSettings.bookingTitle)
  const bookingEnabled = useStore((s) => s.workspaceSettings.bookingEnabled)
  const moveLeadStage = useStore((s) => s.moveLeadStage)
  const setLeadSpam = useStore((s) => s.setLeadSpam)
  const assignLead = useStore((s) => s.assignLead)
  const setLeadFollowUp = useStore((s) => s.setLeadFollowUp)
  const logLeadTouch = useStore((s) => s.logLeadTouch)
  const convertLead = useStore((s) => s.convertLead)
  const createFormLink = useStore((s) => s.createFormLink)

  const [askLost, setAskLost] = useState(false)
  const [editing, setEditing] = useState(false)
  const [sheet, setSheet] = useState<'booking' | 'discovery' | 'discoveryLink' | null>(null)
  const [converting, setConverting] = useState(false)

  const owners = useMemo(
    () => users.filter((u) => !u.deactivatedAt && can(u, 'growth', 'view')).sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [users],
  )
  const history = useMemo(() => [...activity].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [activity])
  const sortedMeetings = useMemo(() => [...meetings].sort((a, b) => a.startsAt.localeCompare(b.startsAt)), [meetings])

  if (!canView) {
    return <Screen><EmptyState icon="lock" title="No access to Growth" hint="Ask an admin for Growth access." /></Screen>
  }
  if (!lead) {
    return <Screen><EmptyState icon="alert-circle" title="Lead not found" hint="It may have been deleted or converted." /></Screen>
  }

  const me = users.find((u) => u.id === user?.id)?.fullName
  const sla = slaLine(slaState(lead, now))
  const touches = leadTouches(lead.attribution)
  const breakdown = Object.entries(lead.scoreBreakdown ?? {}).filter(([, pts]) => pts > 0)
  const existingClient = lead.existingClientId ? clients.find((c) => c.id === lead.existingClientId) : undefined
  const isOpen = !lead.spam && lead.stage !== 'won' && lead.stage !== 'lost'
  const fromSite = Boolean(lead.form || lead.message || lead.services?.length || lead.budgetBand || lead.timeline)
  const prefill = discoveryPrefill(lead)
  const linkState = quickFormState(discovery)
  const discoveryDone = discovery?.status === 'submitted'
  const progress = formProgress(DISCOVERY_FORM, discovery?.answers ?? {})
  const firstName = lead.name?.split(/\s+/)[0] || 'The lead'
  const discoveryState = discoveryDone
    ? `Completed ${fmtDate(discovery?.submittedAt)}`
    : linkState === 'answered'
      ? `${firstName} sent their answers ${fmtRelative(discovery?.customerSubmittedAt)} — review and complete`
      : linkState === 'open'
        ? `Sent to ${discovery?.sharedTo ?? firstName} · open until ${fmtDate(discovery?.shareExpiresAt)}`
        : discovery
          ? `Draft · ${progress.done} of ${progress.required} required`
          : 'Not started'

  const touch = (action: LeadTouchAction, label: string) => {
    if (logLeadTouch(lead.id, action)) Alert.alert('Logged', label)
    else Alert.alert('Not logged', 'Could not log that touch.')
  }

  const changeStage = (stage: LeadStage) => {
    if (stage === lead.stage) return
    if (stage === 'lost') {
      setAskLost(true)
      return
    }
    moveLeadStage(lead.id, stage)
  }

  const toggleSpam = () => {
    const spam = !lead.spam
    if (!setLeadSpam(lead.id, spam, spam ? 'manual' : undefined)) Alert.alert('Not changed', 'Could not change quarantine.')
  }

  const convert = async () => {
    setConverting(true)
    const res = await convertLead(lead.id)
    setConverting(false)
    if (!res.ok) {
      Alert.alert('Not converted', res.error ?? 'Could not convert the lead.')
      return
    }
    Alert.alert(
      'Client created',
      `${lead.company || lead.name} is now a client, with a project in onboarding and its starter tasks.`,
      res.projectId
        ? [
            { text: 'Stay here', style: 'cancel' },
            { text: 'Open project', onPress: () => router.push(`/project/${res.projectId}`) },
          ]
        : [{ text: 'OK' }],
    )
  }

  return (
    <Screen scroll>
      {/* Who, and where they stand */}
      <Card style={{ marginBottom: 18, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 20, fontFamily: fonts.display, color: p.textHigh }}>{lead.name || 'Unnamed lead'}</Text>
            {lead.company && lead.company !== lead.name ? (
              <Text style={{ fontSize: 13, fontFamily: fonts.sans, color: p.textMuted, marginTop: 2 }}>{lead.company}</Text>
            ) : null}
          </View>
          {canEdit ? (
            <Pressable onPress={() => setEditing(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Edit lead details" style={{ padding: 6 }}>
              <Feather name="edit-2" size={18} color={p.iconMuted} />
            </Pressable>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          <Chip label={STAGE_LABEL[lead.stage]} colors={accentChip(STAGE_ACCENT[lead.stage])} />
          <Chip label={SOURCE_LABEL[lead.source]} colors={neutralChip(p)} />
          {typeof lead.score === 'number' ? (
            <Chip label={`${lead.hot ? 'Hot · ' : ''}Score ${lead.score}`} colors={lead.hot ? accentChip('rose') : neutralChip(p)} />
          ) : null}
          {(lead.submissionCount ?? 1) > 1 ? <Chip label={`Wrote ${lead.submissionCount}×`} colors={accentChip('sky')} /> : null}
          {sla ? <Chip label={sla.text} colors={accentChip(sla.accent)} /> : null}
          {lead.firstRespondedAt && lead.slaDueAt ? <Chip label={`Replied ${fmtRelative(lead.firstRespondedAt)}`} colors={accentChip('emerald')} /> : null}
          {lead.value > 0 ? <Chip label={fmtMoney(lead.value)} colors={neutralChip(p)} /> : null}
        </View>
        <View>
          {lead.email ? <ContactRow icon="mail" text={lead.email} url={`mailto:${lead.email}`} /> : null}
          {lead.phone ? <ContactRow icon="phone" text={lead.phone} url={`tel:${lead.phone.replace(/[^0-9+]/g, '')}`} /> : null}
          {existingClient ? <ContactRow icon="briefcase" text={`Existing client: ${existingClient.name}`} /> : null}
        </View>
      </Card>

      {/* Stage */}
      <Section title="Stage">
        {canEdit && !lead.spam ? (
          <PillGroup options={STAGES.map((s) => ({ label: STAGE_LABEL[s], value: s }))} value={lead.stage} onChange={changeStage} />
        ) : (
          <Chip label={STAGE_LABEL[lead.stage]} colors={accentChip(STAGE_ACCENT[lead.stage])} />
        )}
        {lead.stage === 'lost' && lead.lostReason ? (
          <Text style={{ fontSize: 13, fontFamily: fonts.sans, color: p.textMuted, marginTop: 6 }}>Lost: {LOST_REASON_LABEL[lead.lostReason]}</Text>
        ) : null}
      </Section>

      {lead.spam ? (
        <View style={{ marginBottom: 18, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: rgba(p.warn, 0.35), backgroundColor: rgba(p.warn, 0.08), gap: 10 }}>
          <Text style={{ fontSize: 13, fontFamily: fonts.sans, color: p.text, lineHeight: 19 }}>
            Quarantined{lead.spamReason ? ` (${lead.spamReason.replace(/_/g, ' ')})` : ''}. Nobody was notified and no auto-reply went out.
            If this is a real enquiry, release it to start the reply clock.
          </Text>
          {canEdit ? <Button title="Not spam — release" icon="check-circle" onPress={toggleSpam} /> : null}
        </View>
      ) : null}

      {/* What they sent */}
      {fromSite ? (
        <Section title="From the website">
          <Card style={{ gap: 12 }}>
            {lead.lastSubmittedAt ? (
              <Text style={{ fontSize: 11, fontFamily: fonts.mono, color: p.textMuted }}>{fmtDateTime(lead.lastSubmittedAt)}</Text>
            ) : null}
            {lead.message ? (
              <Text selectable style={{ fontSize: 14, fontFamily: fonts.sans, color: p.textHigh, lineHeight: 21 }}>{lead.message}</Text>
            ) : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {lead.services?.length ? <Fact label="Services" value={lead.services.map(serviceLabel).join(', ')} /> : null}
              {lead.budgetBand ? <Fact label="Budget" value={budgetLabel(lead.budgetBand) ?? lead.budgetBand} /> : null}
              {lead.timeline ? <Fact label="Timeline" value={timelineLabel(lead.timeline) ?? lead.timeline} /> : null}
              {lead.consentAt ? <Fact label="Consent" value={fmtDate(lead.consentAt)} /> : null}
            </View>
          </Card>
        </Section>
      ) : null}

      {/* Why the score */}
      {breakdown.length > 0 ? (
        <Section title={`Score ${lead.score ?? ''}`}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {breakdown.map(([rule, pts]) => (
              <Chip key={rule} label={`${SCORE_RULE_LABEL[rule] ?? rule.replace(/_/g, ' ')} +${pts}`} colors={neutralChip(p)} />
            ))}
          </View>
        </Section>
      ) : null}

      {/* Where they came from */}
      {touches.first || touches.last ? (
        <Section title="Where they came from">
          <View style={{ gap: 8 }}>
            {touches.first ? <TouchCard label="First visit" touch={touches.first} /> : null}
            {touches.last ? <TouchCard label="Latest source" touch={touches.last} /> : null}
          </View>
        </Section>
      ) : null}

      {/* Work it */}
      {canEdit && !lead.spam ? (
        <Section title="Work this lead">
          <View style={{ gap: 12 }}>
            <View>
              <Label>Owner</Label>
              <SelectField
                value={lead.ownerId}
                options={owners.map((u) => ({ label: u.fullName, value: u.id }))}
                onChange={(v) => {
                  if (!assignLead(lead.id, v)) Alert.alert('Not changed', 'Could not change the owner.')
                }}
                allowNone
                noneLabel="Unassigned"
                placeholder="Unassigned"
              />
            </View>
            <View>
              <Label>Next follow-up</Label>
              <DateField
                value={lead.followUp}
                onChange={(d) => {
                  if (!setLeadFollowUp(lead.id, d)) Alert.alert('Not set', 'Could not set the follow-up.')
                }}
              />
            </View>
            {isOpen ? (
              <View style={{ gap: 8 }}>
                <Button title="Send booking link" icon="calendar" onPress={() => setSheet('booking')} />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                  {TOUCHES.map((t) => (
                    <Button key={t.action} title={t.label} icon={t.icon} variant="ghost" onPress={() => touch(t.action, t.label)} />
                  ))}
                </View>
              </View>
            ) : null}
            <Button
              title="Mark as spam"
              icon="slash"
              variant="ghost"
              onPress={() =>
                Alert.alert('Move to quarantine?', 'It leaves the pipeline and every metric until someone releases it.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Quarantine', style: 'destructive', onPress: toggleSpam },
                ])
              }
            />
          </View>
        </Section>
      ) : null}

      {/* Meetings */}
      {sortedMeetings.length > 0 ? (
        <Section title="Meetings">
          <View style={{ gap: 8 }}>
            {sortedMeetings.map((m) => {
              const past = new Date(m.endsAt ?? m.startsAt).getTime() < now
              const meet = webHref(m.meetingLink)
              return (
                <Card key={m.id} style={{ opacity: past ? 0.7 : 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Feather name="video" size={16} color={p.iconMuted} />
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={{ fontSize: 14, fontFamily: fonts.sansSemibold, color: p.textHigh }}>{m.title}</Text>
                      <Text style={{ fontSize: 12, fontFamily: fonts.sans, color: p.textMuted, marginTop: 2 }}>
                        {fmtDateTime(m.startsAt)}
                        {m.bookedVia === 'website' ? ' · booked on the website' : ''}
                        {m.syncStatus === 'error' ? ' · Google sync failed' : ''}
                      </Text>
                    </View>
                    {meet && !past ? <Button title="Join" variant="ghost" onPress={() => void Linking.openURL(meet)} /> : null}
                  </View>
                </Card>
              )
            })}
          </View>
        </Section>
      ) : null}

      {/* Email */}
      {!lead.spam ? (
        <Section title="Email">
          <EmailThreads emails={emails} leadId={lead.id} person={{ name: lead.name, email: lead.email }} canSend={canEdit} />
        </Section>
      ) : null}

      {/* Forms */}
      {!lead.spam ? (
        <Section title="Forms">
          <Card style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Feather name="clipboard" size={16} color={p.iconMuted} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontFamily: fonts.sansSemibold, color: p.textHigh }}>{DISCOVERY_FORM.title}</Text>
                <Text style={{ fontSize: 12, fontFamily: fonts.sans, color: linkState === 'answered' && !discoveryDone ? p.brandText : p.textMuted, marginTop: 2 }}>
                  {discoveryState}
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button
                title={discoveryDone || linkState === 'answered' || !canEdit ? 'Open' : discovery ? 'Continue' : 'Fill in'}
                variant="ghost"
                style={{ flex: 1 }}
                onPress={() => setSheet('discovery')}
              />
              {canEdit && !discoveryDone && linkState !== 'answered' ? (
                <Button
                  title={linkState === 'open' ? 'Resend' : 'Send to lead'}
                  icon="send"
                  variant="ghost"
                  style={{ flex: 1 }}
                  onPress={() => setSheet('discoveryLink')}
                />
              ) : null}
            </View>
          </Card>
        </Section>
      ) : null}

      {/* Convert */}
      {canConvert && !lead.spam && lead.stage !== 'won' && !lead.clientId ? (
        <Section title="Won it?">
          <Button title="Convert to client" icon="user-plus" loading={converting} onPress={() => void convert()} />
          <Text style={{ fontSize: 12, fontFamily: fonts.sans, color: p.textMuted, marginTop: 6 }}>
            Creates the client and a project in onboarding with its starter tasks, and marks the lead won.
          </Text>
        </Section>
      ) : null}

      {/* History */}
      <Section title="History">
        {history.length === 0 ? (
          <Text style={{ fontSize: 13, fontFamily: fonts.sans, color: p.textMuted }}>Nothing logged yet.</Text>
        ) : (
          <View style={{ gap: 6 }}>
            {history.map((a) => {
              const actor = a.actorId ? users.find((u) => u.id === a.actorId) : undefined
              return (
                <View key={a.id} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                  <Text style={{ flex: 1, fontSize: 13, fontFamily: fonts.sans, color: p.text }}>
                    {ACTION_LABEL[a.action] ?? a.action}
                    <Text style={{ color: p.textMuted }}> · {actor ? actor.fullName : a.actorId ? 'Someone' : 'Automation'}</Text>
                  </Text>
                  <Text style={{ fontSize: 11, fontFamily: fonts.mono, color: p.textMuted }}>{fmtRelative(a.createdAt)}</Text>
                </View>
              )
            })}
          </View>
        )}
      </Section>

      <ActionSheet
        visible={askLost}
        title="Why was it lost?"
        actions={LOST_REASONS.map((r) => ({ label: LOST_REASON_LABEL[r], onPress: () => moveLeadStage(lead.id, 'lost', r) }))}
        onClose={() => setAskLost(false)}
      />

      {editing ? <EditDetails lead={lead} onClose={() => setEditing(false)} /> : null}

      {sheet === 'discovery' ? (
        <FormSheet
          visible
          template={DISCOVERY_FORM}
          leadId={lead.id}
          prefill={prefill}
          completeLabel="Complete discovery"
          customerName={lead.name}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {sheet === 'discoveryLink' ? (
        <ShareLinkSheet
          visible
          title={`Send “${DISCOVERY_FORM.customer?.title ?? DISCOVERY_FORM.title}”`}
          intro="They see only the questions meant for them — never your internal notes — with what we already know filled in. The link works for 14 days and closes once they send their answers."
          create={async () => {
            const r = await createFormLink({ form: DISCOVERY_FORM.key, leadId: lead.id, sharedTo: lead.email, answers: prefill })
            return r.ok ? { url: r.url } : { error: r.error }
          }}
          email={(url) => quickFormEmail({ name: lead.name, formTitle: DISCOVERY_FORM.customer?.title ?? DISCOVERY_FORM.title, url, from: me })}
          leadId={lead.id}
          person={{ name: lead.name, email: lead.email }}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {sheet === 'booking' ? (
        <ShareLinkSheet
          visible
          title="Send booking link"
          intro={
            bookingEnabled
              ? `${lead.name || 'They'} pick a free time for a ${bookingTitle.toLowerCase()}; the call lands on this lead with a Meet link and a calendar invite.`
              : 'Online booking is off, so the page will say it isn’t open. Turn it on in the web app: Settings → Growth → Booking page.'
          }
          create={async () => ({ url: bookingPageUrl({ name: lead.name, email: lead.email }) })}
          email={(url) => bookingEmail({ name: lead.name, url, title: bookingTitle, from: me })}
          leadId={lead.id}
          person={{ name: lead.name, email: lead.email }}
          onShared={() => logLeadTouch(lead.id, 'booking_link_sent', { url: bookingPageUrl() })}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </Screen>
  )
}
