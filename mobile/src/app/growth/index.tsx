import { useMemo, useState } from 'react'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { ScrollView, Text, View } from 'react-native'

import { Card, Chip, EmptyState, Fab, FilterChip, Screen } from '@/components/ui'
import { SOURCE_LABEL, STAGES, STAGE_ACCENT, STAGE_LABEL, slaLine, useNow } from '@/components/growth/leadBits'
import { compareBySla, inboxTab, isOpenLead, slaState, type LeadInboxTab } from '@/lib/leads'
import { fmtMoney } from '@/lib/format'
import { can } from '@/lib/permissions'
import { accentChip, fonts, neutralChip, space, useTheme } from '@/lib/theme'
import type { Lead } from '@/lib/types'
import { useCurrentUser, useStore } from '@/store/useStore'

// Growth's leads, on the phone: the web's CRM Leads inbox (LeadsBoard +
// lib/leads inboxTab). A website brief arrives in New with its reply clock;
// quarantined ones wait apart until someone releases them.

type Tab = LeadInboxTab | 'all'

const TABS: { key: Tab; label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'quarantine', label: 'Quarantine' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All' },
]

const EMPTY: Record<Tab, { title: string; hint: string }> = {
  new: { title: 'Nothing waiting', hint: 'New website briefs land here until someone replies.' },
  pipeline: { title: 'No open deals', hint: 'Leads you have replied to move here.' },
  quarantine: { title: 'Quarantine is empty', hint: 'Briefs that look like spam wait here for review.' },
  closed: { title: 'Nothing closed yet', hint: 'Won and lost leads end up here.' },
  all: { title: 'No leads yet', hint: 'Website briefs and leads you add show up here.' },
}

function LeadRow({ lead, now, onPress }: { lead: Lead; now: number; onPress: () => void }) {
  const p = useTheme()
  const sla = slaLine(slaState(lead, now))
  return (
    <Card onPress={onPress}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {lead.hot ? <Feather name="zap" size={13} color={p.danger} accessibilityLabel="Hot lead" /> : null}
            <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 15, fontFamily: fonts.sansSemibold, color: p.textHigh }}>
              {lead.name || 'Unnamed lead'}
            </Text>
          </View>
          {lead.company && lead.company !== lead.name ? (
            <Text numberOfLines={1} style={{ fontSize: 13, fontFamily: fonts.sans, color: p.textMuted }}>{lead.company}</Text>
          ) : null}
        </View>
        <Chip label={STAGE_LABEL[lead.stage]} colors={accentChip(STAGE_ACCENT[lead.stage])} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 8 }}>
        <Chip label={SOURCE_LABEL[lead.source]} colors={neutralChip(p)} />
        {/* A site brief whose source is already 'Website' needs no second chip. */}
        {lead.form && lead.source !== 'website' ? <Chip label="Website form" colors={neutralChip(p)} /> : null}
        {sla ? <Chip label={sla.text} colors={accentChip(sla.accent)} /> : null}
        {typeof lead.score === 'number' && lead.score > 0 ? (
          <Text style={{ fontSize: 12, fontFamily: fonts.mono, color: p.textMuted }}>score {lead.score}</Text>
        ) : null}
        {lead.value > 0 ? (
          <Text style={{ marginLeft: 'auto', fontSize: 12, fontFamily: fonts.mono, color: p.textSecondary }}>{fmtMoney(lead.value)}</Text>
        ) : null}
      </View>
    </Card>
  )
}

export default function GrowthLeads() {
  const p = useTheme()
  const router = useRouter()
  const user = useCurrentUser()
  const canView = can(user, 'growth', 'view')
  const canEdit = can(user, 'growth', 'edit')
  const leads = useStore((s) => s.leads)
  const hydrated = useStore((s) => s.hydrated)
  const addLead = useStore((s) => s.addLead)
  const now = useNow()
  const [tab, setTab] = useState<Tab>('new')

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { new: 0, pipeline: 0, quarantine: 0, closed: 0, all: leads.length }
    for (const l of leads) c[inboxTab(l)] += 1
    return c
  }, [leads])

  const shown = useMemo(() => {
    const list = tab === 'all' ? [...leads] : leads.filter((l) => inboxTab(l) === tab)
    if (tab === 'new') return list.sort((a, b) => compareBySla(a, b, now))
    return list.sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage) || b.value - a.value)
  }, [leads, tab, now])

  const open = leads.filter(isOpenLead).length
  const awaiting = leads.filter((l) => isOpenLead(l) && !l.firstRespondedAt).length

  if (!canView) {
    return <Screen><EmptyState icon="lock" title="No access to Growth" hint="Ask an admin for Growth access." /></Screen>
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: space.md }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Card style={{ flex: 1 }}>
            <Text style={{ fontSize: 12, fontFamily: fonts.sans, color: p.textMuted }}>Open leads</Text>
            <Text style={{ fontSize: 24, fontFamily: fonts.display, color: p.textHigh, marginTop: 2 }}>{open}</Text>
          </Card>
          <Card style={{ flex: 1 }}>
            <Text style={{ fontSize: 12, fontFamily: fonts.sans, color: p.textMuted }}>Awaiting first reply</Text>
            <Text style={{ fontSize: 24, fontFamily: fonts.display, color: awaiting > 0 ? p.warn : p.textHigh, marginTop: 2 }}>{awaiting}</Text>
          </Card>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          {TABS.map((t) => (
            <FilterChip key={t.key} label={`${t.label} ${counts[t.key]}`} active={tab === t.key} onPress={() => setTab(t.key)} />
          ))}
        </ScrollView>

        {!hydrated ? (
          <Text style={{ fontSize: 13, fontFamily: fonts.sans, color: p.textMuted }}>Loading…</Text>
        ) : shown.length === 0 ? (
          <EmptyState icon="inbox" title={EMPTY[tab].title} hint={EMPTY[tab].hint} />
        ) : (
          <View style={{ gap: space.sm }}>
            {shown.map((l) => (
              <LeadRow key={l.id} lead={l} now={now} onPress={() => router.push(`/growth/${l.id}`)} />
            ))}
          </View>
        )}
      </ScrollView>
      {canEdit ? (
        <Fab
          icon="plus"
          onPress={() => {
            const id = addLead({ name: 'New lead' })
            router.push(`/growth/${id}`)
          }}
        />
      ) : null}
    </Screen>
  )
}
