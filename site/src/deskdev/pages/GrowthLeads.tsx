import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChartBarHorizontalIcon, CurrencyDollarIcon, FireIcon, HandshakeIcon, TrayIcon, TrendUpIcon } from '@phosphor-icons/react'
import Layout from '../components/Layout'
import StatCard, { StatStrip } from '../components/StatCard'
import { SkeletonLine } from '../components/ui-foundation'
import { useStore, useCurrentUser } from '../store/useStore'
import { can } from '../lib/permissions'
import { fmtMoney, fmtPercent } from '../lib/format'
import {
  Section, Bars, RadarList, SectionSkeleton, StatCellSkeleton, useGrowthMetrics,
} from '../components/growth/shared'
import LeadsBoard from '../components/growth/LeadsBoard'
import LeadDrawer from '../components/growth/LeadDrawer'

/** The leads table while loading: its heading, then ruled rows of cells. */
function BoardSkeleton() {
  return (
    <div aria-hidden>
      <div className="mb-2.5 space-y-1.5">
        <SkeletonLine w={64} className="h-4" />
        <SkeletonLine w={168} className="h-3" />
      </div>
      <div className="card overflow-hidden">
        <div className="h-9 border-b border-ink-600" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_1fr] gap-6 px-4 py-4 border-b border-ink-600 last:border-b-0">
            <SkeletonLine w={`${50 + ((i * 13) % 35)}%`} />
            <SkeletonLine w="60%" />
            <SkeletonLine w="45%" className="justify-self-end" />
            <SkeletonLine w="55%" />
            <SkeletonLine w="70%" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** CRM Leads — Growth's own lead pipeline (management surface). */
export default function GrowthLeads() {
  const user = useCurrentUser()
  const canEdit = can(user, 'growth', 'edit')
  const loading = !useStore((s) => s.hydrated)
  const g = useGrowthMetrics()

  // The open lead lives in the URL (?lead=<id>): notifications and pushes link
  // straight to it, and Back closes the drawer.
  const [params, setParams] = useSearchParams()
  const leadId = params.get('lead')
  const openLead = useCallback((id: string) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('lead', id)
      return next
    })
  }, [setParams])
  const closeLead = useCallback(() => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('lead')
      return next
    }, { replace: true })
  }, [setParams])

  return (
    <Layout title="CRM Leads" subtitle="Growth’s own pipeline — separate from the Operations CRM">
      <div className="mx-auto max-w-6xl space-y-8" aria-busy={loading || undefined}>
        <StatStrip className="grid-cols-2 md:grid-cols-4">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => <StatCellSkeleton key={i} />)
          ) : (
            <>
              <StatCard variant="cell" label="Open leads" value={g.open.length} countKey="leads-open" icon={TrayIcon} sub={`${g.leads.length.toLocaleString()} total`} />
              <StatCard variant="cell" label="Pipeline value" value={fmtMoney(g.pipelineValue)} icon={CurrencyDollarIcon} sub={`${g.open.length.toLocaleString()} open leads`} />
              <StatCard variant="cell" label="Win rate" value={fmtPercent(g.conversion)} icon={TrendUpIcon} sub={`${g.won.length} won · ${g.lost.length} lost`} />
              <StatCard variant="cell" label="Won this month" value={g.wonMtd.length} countKey="leads-won-mtd" icon={HandshakeIcon} sub={fmtMoney(g.wonMtdValue)} />
            </>
          )}
        </StatStrip>

        {loading ? <BoardSkeleton /> : <LeadsBoard canEdit={canEdit} onOpen={openLead} focusId={leadId} />}

        {loading ? (
          <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
            <SectionSkeleton rows={4} />
            <SectionSkeleton rows={3} />
          </div>
        ) : (
          <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
            <Section icon={ChartBarHorizontalIcon} title="By source" hint="Where your leads come from">
              <Bars items={g.sources.breakdown} />
            </Section>

            <Section icon={FireIcon} title="Follow-up radar" hint="Overdue follow-ups + hot leads">
              {g.radar.length === 0 ? (
                <p className="text-sm text-ink-300">No overdue follow-ups. Nice.</p>
              ) : (
                <div className="-my-(--card-p)">
                  <RadarList leads={g.radar} today={g.today} onOpen={openLead} />
                </div>
              )}
            </Section>
          </div>
        )}
      </div>

      <LeadDrawer leadId={leadId} loading={loading} onClose={closeLead} />
    </Layout>
  )
}
