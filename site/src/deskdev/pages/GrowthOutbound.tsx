import { ChatIcon, EnvelopeSimpleIcon, PaperPlaneTiltIcon, TargetIcon, ThumbsUpIcon } from '@phosphor-icons/react'
import Layout from '../components/Layout'
import StatCard, { StatStrip } from '../components/StatCard'
import { useStore, useCurrentUser } from '../store/useStore'
import { can } from '../lib/permissions'
import { fmtPercent } from '../lib/format'
import { Section, SectionSkeleton, StatCellSkeleton, useGrowthMetrics } from '../components/growth/shared'
import { OutboundRates, CampaignList } from '../components/growth/Outbound'

/** Outbound Command — the manual outreach tracker (campaigns + rates). */
export default function GrowthOutbound() {
  const user = useCurrentUser()
  const canEdit = can(user, 'growth', 'edit')
  const loading = !useStore((s) => s.hydrated)
  const g = useGrowthMetrics()

  return (
    <Layout title="Outbound Command" subtitle="Your proactive outreach — campaigns and performance">
      <div className="mx-auto max-w-6xl space-y-8" aria-busy={loading || undefined}>
        {/* One ruled strip of figures, not four boxes. */}
        <StatStrip className="grid-cols-2 md:grid-cols-4">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => <StatCellSkeleton key={i} />)
          ) : (
            <>
              <StatCard variant="cell" label="Contacted · 7d" value={g.outbound.contacted} countKey="outbound-contacted" icon={TargetIcon} sub={`target ${g.weeklyTarget}`} />
              <StatCard variant="cell" label="Open rate" value={fmtPercent(g.outbound.openRate)} icon={EnvelopeSimpleIcon} sub={`${g.outbound.opens.toLocaleString()} opens`} />
              <StatCard variant="cell" label="Reply rate" value={fmtPercent(g.outbound.replyRate)} icon={ChatIcon} sub={`${g.outbound.replies.toLocaleString()} replies`} />
              <StatCard variant="cell" label="Positive rate" value={fmtPercent(g.outbound.positiveRate)} icon={ThumbsUpIcon} sub={`${g.outbound.positive.toLocaleString()} positive`} />
            </>
          )}
        </StatStrip>

        {loading ? (
          <div className="grid gap-8 lg:grid-cols-[2fr_3fr] lg:items-start">
            <SectionSkeleton rows={3} />
            <SectionSkeleton rows={4} />
          </div>
        ) : (
          // Asymmetric: the summary is a narrow column, the working list gets the room.
          <div className="grid gap-8 lg:grid-cols-[2fr_3fr] lg:items-start">
            <Section icon={TargetIcon} title="This week" hint="Contacted vs target · open / reply / positive rates">
              <OutboundRates contacted={g.outbound.contacted} weeklyTarget={g.weeklyTarget} openRate={g.outbound.openRate} replyRate={g.outbound.replyRate} positiveRate={g.outbound.positiveRate} />
            </Section>

            <Section icon={PaperPlaneTiltIcon} title="Campaigns" hint="Log volume, opens and replies per campaign">
              <CampaignList canEdit={canEdit} />
            </Section>
          </div>
        )}
      </div>
    </Layout>
  )
}
