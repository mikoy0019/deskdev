import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ArrowRightIcon, ArrowSquareOutIcon, BinocularsIcon, ChartBarIcon, ChatIcon, CurrencyDollarIcon,
  EnvelopeSimpleIcon, HandshakeIcon,
  PaperPlaneTiltIcon, PhoneCallIcon, PlusIcon, SnowflakeIcon, SquaresFourIcon, TargetIcon, TimerIcon,
  TrayIcon, TrendUpIcon, XCircleIcon, XIcon,
} from '@phosphor-icons/react'
import Layout from '../components/Layout'
import StatCard, { StatStrip } from '../components/StatCard'
import { AnimatePresence, StatusDot, TWEEN, m, useInputModality } from '../components/motion'
import { useStore, useCurrentUser } from '../store/useStore'
import { can, isAdmin } from '../lib/permissions'
import { classNames, fmtDuration, fmtMoney, fmtPercent } from '../lib/format'
import {
  Section, Bars, Figures, Meter, RadarList, SECTION_LINK, SECTION_LIST, SECTION_ROW,
  SectionSkeleton, StatCellSkeleton, STAGE_LABEL, UNNAMED_LEAD, fmtCountFit, fmtMoneyFit, httpUrl, useGrowthMetrics,
  useNow,
} from '../components/growth/shared'
import { OutboundRates } from '../components/growth/Outbound'
import Segmented from '../components/growth/ReportsSegmented'
import ReportsPanel from '../components/growth/ReportsPanel'
import SubscribersPanel from '../components/growth/SubscribersPanel'

type HubView = 'overview' | 'reports' | 'subscribers'
const HUB_VIEWS: HubView[] = ['overview', 'reports', 'subscribers']

/** Small row action: 28px for a mouse, 44px under a finger. */
const ROW_ICON = 'pressable tap-target shrink-0 p-1.5 rounded-md text-ink-400 hover:bg-ink-700'
const ROW_TEXT_BTN = 'btn-ghost shrink-0 px-2! py-1! pointer-coarse:min-h-11 text-xs'

/**
 * A row that can leave its list (a posting promoted or dismissed, a cold lead
 * touched): it fades out while the rows below close the gap — spatial
 * consistency, so the list doesn't snap shut under the pointer. The ref must
 * reach the m.li: popLayout uses it to lift the leaving row out of flow at
 * once, so the fade and the glide run together (180ms ease-in-out, no
 * overshoot), not one after the other. Removed from the keyboard, it simply
 * goes. Reduced motion: no glide (the provider drops layout animation), the
 * fade stays.
 */
function LeavingRow({
  children, className, ref,
}: { children: React.ReactNode; className?: string; ref?: React.Ref<HTMLLIElement> }) {
  const glide = useInputModality() !== 'keyboard'
  return (
    <m.li
      ref={ref}
      layout={glide ? 'position' : false}
      transition={TWEEN.move}
      exit={{ opacity: 0, transition: glide ? TWEEN.popoverExit : TWEEN.instant }}
      className={className}
    >
      {children}
    </m.li>
  )
}

/** Growth Hub — the read-only overview. Management lives in the CRM Leads and
 *  Outbound Command sub-pages; this page just surfaces the numbers. */
export default function GrowthHub() {
  const user = useCurrentUser()
  const canEdit = can(user, 'growth', 'edit')
  // Settings → Growth, where the target lives, is the admins'.
  const targetHref = isAdmin(user) ? '/settings?section=growth' : undefined
  const loading = !useStore((s) => s.hydrated)
  const g = useGrowthMetrics()
  const now = useNow()
  const subscriberCount = useStore((s) => s.siteSubscribers.length)

  // /growth?view=reports | subscribers: the view lives in the URL, so a
  // reload or a shared link lands on the same one. Overview keeps a clean URL.
  const [params, setParams] = useSearchParams()
  const wanted = params.get('view') as HubView | null
  const view: HubView = wanted && HUB_VIEWS.includes(wanted) ? wanted : 'overview'
  const setView = (next: HubView) => {
    const p = new URLSearchParams(params)
    if (next === 'overview') p.delete('view')
    else p.set('view', next)
    setParams(p, { replace: true })
  }

  const jobPostings = useStore((s) => s.jobPostings)
  const addLead = useStore((s) => s.addLead)
  const touchLead = useStore((s) => s.touchLead)
  const dismissJobPosting = useStore((s) => s.dismissJobPosting)
  const restoreJobPosting = useStore((s) => s.restoreJobPosting)
  const openJobs = useMemo(
    () => jobPostings.filter((j) => !j.dismissed).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [jobPostings],
  )

  function promoteJob(id: string) {
    if (!canEdit) return
    const j = jobPostings.find((x) => x.id === id)
    if (!j) return
    addLead({ name: j.company || j.title, stage: 'new', source: 'other', notes: `From job posting: ${j.title}${j.url ? `\n${j.url}` : ''}` })
    dismissJobPosting(id)
    toast.success('Added to leads')
  }

  // Dismiss takes the row away at once (it is one of many, and scanning the
  // list is the job), so the way back is offered right after instead of a
  // question before.
  function dismissJob(id: string) {
    dismissJobPosting(id)
    // The app's own button, not Sonner's black pill: 44px under a finger.
    const shown = toast('Posting dismissed', {
      action: (
        <button
          type="button"
          className="btn-secondary ml-auto shrink-0 px-2.5! py-1! text-xs pointer-coarse:min-h-11"
          onClick={() => {
            restoreJobPosting(id)
            toast.dismiss(shown)
          }}
        >
          Undo
        </button>
      ),
    })
  }

  return (
    <Layout title="Growth Hub" subtitle="Your sales pipeline, outreach, and revenue at a glance">
      <div className="mx-auto max-w-6xl space-y-8" aria-busy={loading || undefined}>
        <Segmented
          id="growth-hub-view"
          kind="tab"
          label="Growth Hub views"
          value={view}
          onChange={setView}
          className="max-sm:flex"
          options={[
            { key: 'overview', label: 'Overview', icon: <SquaresFourIcon size={14} weight={view === 'overview' ? 'fill' : 'regular'} /> },
            { key: 'reports', label: 'Reports', icon: <ChartBarIcon size={14} weight={view === 'reports' ? 'fill' : 'regular'} /> },
            {
              key: 'subscribers', label: 'Subscribers', count: loading ? undefined : subscriberCount,
              icon: <EnvelopeSimpleIcon size={14} weight={view === 'subscribers' ? 'fill' : 'regular'} />,
            },
          ]}
        />

        {view === 'reports' && <ReportsPanel />}
        {view === 'subscribers' && <SubscribersPanel />}

        {view === 'overview' && (
        <>
        {/* KPI strip: six figures ruled in one card. */}
        <StatStrip className="grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => <StatCellSkeleton key={i} />)
          ) : (
            <>
              <StatCard variant="cell" label="New leads · 7d" value={g.newThisWeek.length} countKey="growth-new-leads" icon={TrayIcon} sub={`${g.leads.length.toLocaleString()} total`} to="/growth/leads" />
              <StatCard variant="cell" label="Pipeline value" value={fmtMoneyFit(g.pipelineValue)} icon={CurrencyDollarIcon} sub={`${g.open.length.toLocaleString()} open leads`} to="/growth/leads" />
              <StatCard variant="cell" label="Win rate" value={fmtPercent(g.conversion)} icon={TrendUpIcon} sub={`${g.won.length} won · ${g.lost.length} lost`} />
              <StatCard variant="cell" label="Won this month" value={g.wonMtd.length} countKey="growth-won-mtd" icon={HandshakeIcon} sub={fmtMoneyFit(g.wonMtdValue)} />
              <StatCard variant="cell" label="Reply rate" value={fmtPercent(g.outbound.replyRate)} icon={ChatIcon} sub={`${fmtCountFit(g.outbound.contacted)} contacted · 7d`} to="/growth/outbound" />
              {g.monthlyTarget === undefined ? (
                <StatCard variant="cell" label="Goal" value="—" icon={TargetIcon} sub="No target set" keepSub to={targetHref} />
              ) : (
                <StatCard variant="cell" label="Goal" value={fmtPercent(g.goalRatio)} icon={TargetIcon} sub={`${g.wonMtd.length}/${g.monthlyTarget} clients`} />
              )}
            </>
          )}
        </StatStrip>

        {loading ? (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start">
            <div className="space-y-8"><SectionSkeleton rows={3} /><SectionSkeleton rows={5} /></div>
            <div className="space-y-8"><SectionSkeleton rows={3} /><SectionSkeleton rows={2} /></div>
          </div>
        ) : (
          // Two fixed columns (not CSS columns): a list shrinking in one never
          // reshuffles the cards between columns. Left: the numbers; right:
          // the lists to act on. Phones stack them in that order.
          <div className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start">
            <div className="space-y-8 min-w-0">
              {/* Outbound summary → link to full page */}
              <Section
                icon={PaperPlaneTiltIcon}
                title="Outbound Command"
                hint="Your proactive outreach, this week"
                action={<Link to="/growth/outbound" className={SECTION_LINK}>Manage <ArrowRightIcon size={12} aria-hidden /></Link>}
              >
                <OutboundRates contacted={g.outbound.contacted} weeklyTarget={g.weeklyTarget} openRate={g.outbound.openRate} replyRate={g.outbound.replyRate} positiveRate={g.outbound.positiveRate} />
              </Section>

              {/* Inbound Pipeline (read-only summary) */}
              <Section
                icon={TrayIcon}
                title="Inbound Pipeline"
                hint="Leads that came to you"
                action={<Link to="/growth/leads" className={SECTION_LINK}>Leads <ArrowRightIcon size={12} aria-hidden /></Link>}
              >
                <Figures
                  items={[
                    { value: g.newThisWeek.length.toLocaleString(), label: 'new leads · last 7 days' },
                    { value: g.open.length.toLocaleString(), label: 'open in pipeline' },
                  ]}
                />
                <div className="section-title mb-3">By source</div>
                <div className="mb-6"><Bars items={g.sources.breakdown} /></div>
                <div className="section-title mb-2">Follow-up radar</div>
                {g.radar.length === 0 ? (
                  <p className="text-sm text-ink-300">No overdue follow-ups. Nice.</p>
                ) : (
                  <div className="-mb-(--card-p)">
                    <RadarList leads={g.radar} today={g.today} limit={5} />
                  </div>
                )}
              </Section>

              {/* Revenue Forecasting */}
              <Section icon={CurrencyDollarIcon} title="Revenue Forecasting" hint="How leads translate to cash">
                <Figures
                  items={[
                    { value: fmtMoney(g.pipelineValue), label: 'open pipeline value' },
                    { value: fmtPercent(g.conversion), label: 'lead → client conversion' },
                  ]}
                />
                <div className="section-title mb-3">Pipeline funnel</div>
                <div className="mb-6"><Bars items={g.funnel} /></div>
                <div className="section-title mb-3">Revenue by source (won)</div>
                <div className="mb-6"><Bars items={g.sources.roi} format={fmtMoney} /></div>
                {g.monthlyTarget === undefined ? (
                  // No target is a choice (Settings → Growth), not a gap to fill with a default.
                  <div className="flex items-baseline justify-between gap-3 border-t border-ink-600 pt-3.5">
                    <span className="text-xs text-ink-200">Monthly goal</span>
                    <span className="text-xs text-ink-300">
                      No target set.{' '}
                      {targetHref && (
                        <Link to={targetHref} className="text-brand-700 dark:text-brand-400 underline-offset-2 hover:underline">Set one in Settings</Link>
                      )}
                    </span>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-baseline justify-between gap-3 mb-1.5">
                      <span className="text-xs text-ink-200">Monthly goal</span>
                      <span className="text-xs tabular-nums text-ink-50">{g.wonMtd.length} / {g.monthlyTarget} clients</span>
                    </div>
                    <Meter value={g.wonMtd.length} max={g.monthlyTarget} tone="emerald" label="Monthly goal" />
                    <p className="mt-2.5 text-xs text-ink-300">Set targets in <Link to="/settings" className="text-brand-700 dark:text-brand-400 underline-offset-2 hover:underline">Settings</Link>.</p>
                  </div>
                )}
              </Section>
            </div>

            <div className="space-y-8 min-w-0">
              {/* Job leads */}
              <Section icon={BinocularsIcon} title="Job leads" hint="Postings found for you — pitch or apply">
                {openJobs.length === 0 ? (
                  <p className="text-sm text-ink-300">No new postings. The finder adds them here on its schedule.</p>
                ) : (
                  <ul className={classNames(SECTION_LIST, 'relative -my-(--card-p)')}>
                    <AnimatePresence initial={false} mode="popLayout">
                      {openJobs.slice(0, 8).map((j) => (
                        <LeavingRow key={j.id} className={classNames(SECTION_ROW, 'bg-ink-800')}>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-sm text-ink-50 min-w-0">
                              <span className={classNames('badge shrink-0', j.tag === 'lead' ? 'badge-brand' : 'badge-info')}>{j.tag === 'lead' ? 'Lead' : 'Gig'}</span>
                              <span className="truncate" title={j.title}>{j.title}</span>
                            </div>
                            <div className="mt-1 text-xs text-ink-300 truncate">
                              {[j.company, j.location, j.remote ? 'Remote' : null, j.salaryText].filter(Boolean).join(' · ')}
                            </div>
                          </div>
                          {/* Postings arrive from the job finder (scraped), so only http(s) links
                              render — a javascript: or data: URL never becomes a link. */}
                          {httpUrl(j.url) && (
                            <a href={httpUrl(j.url)} target="_blank" rel="noopener noreferrer" className={classNames(ROW_ICON, 'hover:text-brand-600 dark:hover:text-brand-400')} title="Open posting" aria-label={`Open posting: ${j.title}`}>
                              <ArrowSquareOutIcon size={16} aria-hidden />
                            </a>
                          )}
                          {canEdit && (
                            <>
                              <button className={ROW_TEXT_BTN} title="Add to leads" aria-label={`Add to leads: ${j.title}`} onClick={() => promoteJob(j.id)}><PlusIcon size={14} aria-hidden /> Lead</button>
                              <button className={classNames(ROW_ICON, 'hover:text-rose-600 dark:hover:text-rose-400')} title="Dismiss" aria-label={`Dismiss posting: ${j.title}`} onClick={() => dismissJob(j.id)}><XIcon size={16} aria-hidden /></button>
                            </>
                          )}
                        </LeavingRow>
                      ))}
                    </AnimatePresence>
                  </ul>
                )}
              </Section>

              {/* Response time — now real, from the lead event log */}
              <Section
                icon={TimerIcon}
                title="Response time"
                hint="How fast you reply to a new lead"
                action={<Link to="/growth/leads" className={SECTION_LINK}>Leads <ArrowRightIcon size={12} aria-hidden /></Link>}
              >
                <Figures
                  items={[
                    { value: fmtDuration(g.medianResponseMs), label: 'median first reply' },
                    {
                      // The one live marker on the page: leads waiting on you right now.
                      value: (
                        <span className="inline-flex items-center gap-2.5">
                          {g.awaitingFirstReply.length}
                          {g.awaitingFirstReply.length > 0 && <StatusDot tone="away" breathe size="sm" />}
                        </span>
                      ),
                      label: 'awaiting first reply',
                      tone: g.awaitingFirstReply.length > 0 ? 'warn' : undefined,
                    },
                  ]}
                />
                {g.awaitingFirstReply.length > 0 && (
                  <ul className={classNames(SECTION_LIST, '-mt-5 mb-4 border-b border-ink-600')}>
                    {g.awaitingFirstReply.slice(0, 4).map((l) => (
                      <li key={l.id} className={classNames(SECTION_ROW, 'justify-between')}>
                        {/* Opens the lead's drawer on CRM Leads (?lead=<id>). */}
                        <Link to={`/growth/leads?lead=${l.id}`} className="min-w-0 text-sm text-ink-50 truncate hover:underline" dir="auto" title={l.name || undefined}>{l.name || UNNAMED_LEAD}</Link>
                        <span className="shrink-0 text-xs tabular-nums text-amber-700 dark:text-amber-400">
                          waiting {fmtDuration(Math.max(0, now - new Date(l.createdAt).getTime()))}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-ink-300 text-pretty">
                  Speed matters: the classic study found replying within 5 minutes vastly out-converts 30.
                </p>
              </Section>

              {/* Going cold — the "leads stall" fix */}
              <Section
                icon={SnowflakeIcon}
                title="Going cold"
                hint={`Open leads untouched for ${g.staleDays}+ days`}
              >
                {g.goingCold.length === 0 ? (
                  <p className="text-sm text-ink-300">Nothing going cold. Every open lead has been touched recently.</p>
                ) : (
                  <ul className={classNames(SECTION_LIST, 'relative -mt-(--card-p) mb-4 border-b border-ink-600')}>
                    <AnimatePresence initial={false} mode="popLayout">
                      {g.goingCold.slice(0, 6).map((l) => {
                        const days = Math.max(0, Math.floor((now - new Date(g.lastTouchOf(l)).getTime()) / 864e5))
                        const touches = g.touchesByLead.get(l.id) ?? 0
                        return (
                          <LeavingRow key={l.id} className={classNames(SECTION_ROW, 'bg-ink-800')}>
                            <div className="min-w-0 flex-1">
                              <Link to={`/growth/leads?lead=${l.id}`} className="block text-sm text-ink-50 truncate text-left hover:underline" dir="auto" title={l.name || undefined}>{l.name || UNNAMED_LEAD}</Link>
                              <div className="mt-1 flex items-center gap-2 text-xs">
                                <span className="badge badge-warn tabular-nums">{days}d cold</span>
                                <span className="text-ink-300 truncate">{STAGE_LABEL[l.stage]} · {touches} {touches === 1 ? 'touch' : 'touches'}</span>
                              </div>
                            </div>
                            {canEdit && (
                              <button className={ROW_TEXT_BTN} title="Log a touch" aria-label={`Log a touch: ${l.name || UNNAMED_LEAD}`} onClick={() => { touchLead(l.id); toast.success('Touch logged') }}>
                                <PhoneCallIcon size={14} aria-hidden /> Touch
                              </button>
                            )}
                          </LeavingRow>
                        )
                      })}
                    </AnimatePresence>
                  </ul>
                )}
                <p className={classNames('text-xs text-ink-300 text-pretty', g.goingCold.length === 0 && 'mt-3')}>
                  Most deals need 5+ follow-ups; most people stop after one or two.
                </p>
              </Section>

              {/* Loss reasons — makes "no decision" visible */}
              <Section icon={XCircleIcon} title="Why leads are lost" hint="Your biggest competitor is usually indecision">
                {g.lossReasons.length === 0 ? (
                  <p className="text-sm text-ink-300">No losses recorded yet.</p>
                ) : (
                  <>
                    <Bars items={g.lossReasons} />
                    {g.noDecisionValue > 0 && (
                      <p className="mt-4 text-xs text-ink-300 text-pretty">
                        <span className="tabular-nums font-medium text-amber-700 dark:text-amber-400">{fmtMoney(g.noDecisionValue)}</span>{' '}
                        of pipeline died to <span className="text-ink-100">no decision</span> — research puts this at 40–60% of
                        lost B2B deals, and it’s the one you can fix by de-risking the choice.
                      </p>
                    )}
                  </>
                )}
              </Section>
            </div>
          </div>
        )}
        </>
        )}
      </div>
    </Layout>
  )
}
