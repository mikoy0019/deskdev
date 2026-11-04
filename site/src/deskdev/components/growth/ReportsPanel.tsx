import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRightIcon, CompassIcon, HandshakeIcon, ListChecksIcon, SealCheckIcon, StackIcon, TargetIcon, TimerIcon,
  TrayIcon,
} from '@phosphor-icons/react'
import EmptyState from '../EmptyState'
import StatCard, { StatStrip } from '../StatCard'
import { useStore, useCurrentUser } from '../../store/useStore'
import { isAdmin } from '../../lib/permissions'
import { serviceLabel } from '../../lib/leads'
import { fmtDuration, fmtPercent } from '../../lib/format'
import {
  Bars, Meter, Section, SECTION_LINK, SectionSkeleton, StatCellSkeleton, useGrowthMetrics, useNow,
} from './shared'
import Segmented from './ReportsSegmented'
import {
  REPORT_RANGES, conversionStats, replyStats, reportLeads, tally, utmSource, type ReportRange,
} from './ReportsMath'

const FORM_LABEL: Record<string, string> = {
  contact: 'Contact form',
  email: 'Email',
  import: 'Import',
}

/** A known form key gets its name; anything else shows as the site sent it. */
const formLabel = (key: string) => FORM_LABEL[key] ?? key.slice(0, 40)

/** One ruled line of a breakdown: what, then the count on the right edge. */
function CountRow({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'warn' | 'bad' }) {
  const dot = tone === 'good' ? 'bg-emerald-500' : tone === 'warn' ? 'bg-amber-500' : tone === 'bad' ? 'bg-rose-500' : 'bg-ink-400'
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="flex min-w-0 items-center gap-2 text-sm text-ink-100">
        <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${dot}`} />
        <span className="truncate">{label}</span>
      </dt>
      <dd className="shrink-0 text-sm tabular-nums text-ink-50">{value.toLocaleString('en-US')}</dd>
    </div>
  )
}

/**
 * Growth Hub → Reports: where leads come from, how fast they get a reply,
 * and how many become clients. Read-only; everything is worked out from the
 * leads already in the store, so it is the same in local and remote mode.
 */
export default function ReportsPanel() {
  const user = useCurrentUser()
  const loading = !useStore((s) => s.hydrated)
  const leads = useStore((s) => s.leads)
  const workspace = useStore((s) => s.workspaceSettings)
  const g = useGrowthMetrics()
  const now = useNow()

  const [range, setRange] = useState<ReportRange>('90d')
  const [touch, setTouch] = useState<'first' | 'last'>('first')

  const r = useMemo(() => {
    const inRange = reportLeads(leads, range, now)
    return {
      leads: inRange,
      bySource: tally(inRange, (l) => [utmSource(l, touch)], 'No source tag'),
      byForm: tally(inRange, (l) => [l.form], 'No form').map((t) => ({ ...t, label: t.label === 'No form' ? t.label : formLabel(t.label) })),
      byService: tally(inRange, (l) => l.services ?? [], 'Not chosen').map((t) => ({ ...t, label: t.label === 'Not chosen' ? t.label : serviceLabel(t.label) })),
      reply: replyStats(inRange, now),
      conversion: conversionStats(inRange),
    }
  }, [leads, range, touch, now])

  const target = workspace.growthMonthlyClientTarget
  const staleDays = workspace.growthStaleDays
  const judged = r.reply.onTime + r.reply.late + r.reply.breached

  if (loading) {
    return (
      <div className="space-y-8" aria-busy="true">
        <StatStrip className="grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <StatCellSkeleton key={i} />)}
        </StatStrip>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start">
          <div className="space-y-8"><SectionSkeleton rows={4} /><SectionSkeleton rows={3} /></div>
          <div className="space-y-8"><SectionSkeleton rows={4} /><SectionSkeleton rows={2} /></div>
        </div>
      </div>
    )
  }

  const rangePicker = (
    <Segmented id="growth-report-range" label="Period" value={range} onChange={setRange} options={REPORT_RANGES} />
  )

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-xs text-ink-300">Leads received in the period. Quarantined leads are left out.</p>
        {rangePicker}
      </div>

      {r.leads.length === 0 ? (
        <EmptyState
          glyph="search-empty"
          title={leads.some((l) => !l.spam) ? 'No leads in this period' : 'No leads yet'}
          description={
            leads.some((l) => !l.spam)
              ? 'Pick a longer period to see earlier leads.'
              : 'Leads from the website form, and the ones you add, are counted here.'
          }
          action={
            range !== 'all' && leads.some((l) => !l.spam) ? (
              <button type="button" className="btn-secondary pointer-coarse:min-h-11" onClick={() => setRange('all')}>
                Show all time
              </button>
            ) : (
              <Link to="/growth/leads" className="btn-secondary pointer-coarse:min-h-11">
                Open leads <ArrowRightIcon size={14} aria-hidden />
              </Link>
            )
          }
        />
      ) : (
        <>
          <StatStrip className="grid-cols-2 xl:grid-cols-4">
            <StatCard variant="cell" keepSub label="Leads" value={r.leads.length} icon={TrayIcon} sub={`${r.reply.replied.toLocaleString('en-US')} got a reply`} />
            <StatCard
              variant="cell" keepSub label="Became clients" value={fmtPercent(r.conversion.rate ?? 0)} icon={HandshakeIcon}
              sub={`${r.conversion.converted.toLocaleString('en-US')} of ${r.conversion.total.toLocaleString('en-US')} leads`}
            />
            <StatCard
              variant="cell" keepSub label="Median first reply" value={fmtDuration(r.reply.medianMs)} icon={TimerIcon}
              sub={r.reply.replied > 0 ? `over ${r.reply.replied.toLocaleString('en-US')} replies` : 'no replies yet'}
            />
            <StatCard
              variant="cell" keepSub label="Replied in time" value={r.reply.hitRate === null ? '—' : fmtPercent(r.reply.hitRate)} icon={SealCheckIcon}
              sub={judged > 0 ? `${r.reply.onTime.toLocaleString('en-US')} of ${judged.toLocaleString('en-US')} with a deadline` : 'no deadlines yet'}
            />
          </StatStrip>

          <div className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start">
            <div className="min-w-0 space-y-8">
              <Section
                icon={CompassIcon}
                title="Leads by source"
                hint={touch === 'first' ? 'The campaign tag on the first visit' : 'The campaign tag on the visit that sent the form'}
                action={
                  <Segmented
                    id="growth-report-touch"
                    label="Which visit"
                    value={touch}
                    onChange={setTouch}
                    options={[{ key: 'first', label: 'First touch' }, { key: 'last', label: 'Last touch' }]}
                  />
                }
              >
                <Bars items={r.bySource} />
              </Section>

              <Section icon={StackIcon} title="Leads by service" hint="What people asked for. A lead can pick more than one.">
                <Bars items={r.byService} />
              </Section>
            </div>

            <div className="min-w-0 space-y-8">
              <Section
                icon={TimerIcon}
                title="Reply time"
                hint={`First reply due within ${fmtDuration(workspace.growthSlaMinutes * 60_000)} of working time`}
                action={<Link to="/growth/leads" className={SECTION_LINK}>Leads <ArrowRightIcon size={12} aria-hidden /></Link>}
              >
                {judged + r.reply.waiting === 0 ? (
                  <p className="text-sm text-ink-300 text-pretty">
                    No lead in this period had a reply deadline. Website leads get one; leads added by hand do not.
                  </p>
                ) : (
                  <>
                    <div className="mb-1.5 flex items-baseline justify-between gap-3">
                      <span className="text-xs text-ink-200">Replied in time</span>
                      <span className="text-xs tabular-nums text-ink-50">
                        {r.reply.onTime.toLocaleString('en-US')} / {judged.toLocaleString('en-US')}
                      </span>
                    </div>
                    <Meter value={r.reply.onTime} max={judged} tone="emerald" label="Replied in time" />
                    <dl className="-mb-2.5 mt-3 divide-y divide-ink-600">
                      <CountRow label="Replied in time" value={r.reply.onTime} tone="good" />
                      <CountRow label="Replied late" value={r.reply.late} tone="warn" />
                      <CountRow label="No reply, past the deadline" value={r.reply.breached} tone="bad" />
                      <CountRow label="Waiting, still in time" value={r.reply.waiting} />
                    </dl>
                  </>
                )}
              </Section>

              <Section icon={ListChecksIcon} title="Leads by form" hint="Which form or channel each lead came through">
                <Bars items={r.byForm} />
              </Section>

              <Section icon={TargetIcon} title="This month" hint="Against the workspace target">
                {target === undefined ? (
                  <p className="text-sm text-ink-300 text-pretty">
                    No monthly target set.{' '}
                    {isAdmin(user) && (
                      <Link to="/settings?section=growth" className="text-brand-700 underline-offset-2 hover:underline dark:text-brand-400">
                        Set one in Settings
                      </Link>
                    )}
                  </p>
                ) : (
                  <>
                    <div className="mb-1.5 flex items-baseline justify-between gap-3">
                      <span className="text-xs text-ink-200">Clients won</span>
                      <span className="text-xs tabular-nums text-ink-50">
                        {g.wonMtd.length.toLocaleString('en-US')} / {target.toLocaleString('en-US')}
                      </span>
                    </div>
                    <Meter value={g.wonMtd.length} max={target} tone="emerald" label="Clients won this month" />
                  </>
                )}
                <div className="mt-4 flex items-center justify-between gap-3 border-t border-ink-600 pt-3">
                  <span className="min-w-0 text-sm text-ink-100 text-pretty">
                    Going cold <span className="text-ink-300">· open, untouched for {staleDays}+ days</span>
                  </span>
                  <span className={`shrink-0 text-sm tabular-nums ${g.goingCold.length > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-ink-50'}`}>
                    {g.goingCold.length.toLocaleString('en-US')}
                  </span>
                </div>
              </Section>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
