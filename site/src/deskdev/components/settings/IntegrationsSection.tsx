import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ArrowsClockwiseIcon, ArrowSquareOutIcon, CalendarDotsIcon, CheckIcon, LinkSimpleIcon, PlugsConnectedIcon, TableIcon,
  TreeStructureIcon, WarningCircleIcon, WarningIcon,
} from '@phosphor-icons/react'
import ConfirmDialog from '../ConfirmDialog'
import { Skeleton, StatusDot } from '../motion'
import { CopyGlyph, FieldError, LABEL, Notice, Panel, radioKeys, useCopied } from './formKit'
import EmailSettingsCard from './EmailSettingsCard'
import { useCurrentUser } from '../../store/useStore'
import { isSupabaseConfigured } from '../../lib/supabase'
import { can, isAdmin } from '../../lib/permissions'
import { withBase } from '../../lib/basePath'
import { classNames, fmtDate, fmtRelative } from '../../lib/format'
import { detectPlatform, isStandalone } from '../../pwa/platform'
import { copyText } from '../../pwa/installGuides'
import {
  EXPORT_TABS,
  GOOGLE_RETURN_PARAMS,
  completeGoogleReturn,
  disconnectGoogle,
  exportToGoogleSheets,
  getCalendarFeedStatus,
  getGoogleStatus,
  getWorkspaceCalendarStatus,
  isGoogleAvailable,
  retryFailedCalendarSync,
  revokeCalendarFeed,
  rotateCalendarFeed,
  startGoogleConnect,
  type CalendarFeedScope,
  type CalendarFeedStatus,
  type ExportResult,
  type ExportTab,
  type GooglePurpose,
  type GoogleStatus,
  type WorkspaceCalendarStatus,
} from '../../lib/google'
import {
  STATUS_LABEL,
  cadenceLabel,
  fetchAutomationHealth,
  type AutomationHealthResult,
} from '../../lib/automations'

const LOCAL_MODE = 'Available when DeskDev runs on Supabase. This build is in local mode.'
const MIGRATION_040 = 'supabase/migrations/040_google_workspace_calendar.sql'

interface GoogleState {
  status: GoogleStatus | null
  error: string | null
  /** The error is "the google function gave no answer": a setup state, not a fault on this screen. */
  unreachable: boolean
  reload: () => Promise<void>
}

/**
 * Google (per person), the team calendar (admins), email from DeskDev
 * (admins), the personal calendar feed (anyone who can see the calendar) and
 * automation health (admins).
 */
export default function IntegrationsSection() {
  const user = useCurrentUser()
  const admin = isAdmin(user)
  const seesCalendar = can(user, 'calendar', 'view') || can(user, 'meetings', 'view')

  const [params, setParams] = useSearchParams()
  const [status, setStatus] = useState<GoogleStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unreachable, setUnreachable] = useState(false)

  const apply = useCallback((res: Awaited<ReturnType<typeof getGoogleStatus>>) => {
    if (res.ok) {
      setStatus(res.data)
      setError(null)
      setUnreachable(false)
    } else {
      setError(res.error)
      setUnreachable(Boolean(res.unreachable))
    }
  }, [])

  // Retry / after connect or disconnect / after a revoked grant.
  const reload = useCallback(async () => apply(await getGoogleStatus()), [apply])

  useEffect(() => {
    if (!isGoogleAvailable) return
    let cancelled = false
    void (async () => {
      const res = await getGoogleStatus()
      if (!cancelled) apply(res)
    })()
    return () => {
      cancelled = true
    }
  }, [apply])

  // Google sends the browser back here with ?google=pending&grant=… (or
  // ?google=error&reason=…). The pending grant is stored by `finish` with THIS
  // session's JWT, so a Connect link someone else started never lands on the
  // wrong DeskDev account. Params are stripped before the call resolves.
  useEffect(() => {
    if (!params.get('google')) return
    const outcome = completeGoogleReturn(new URLSearchParams(params))
    for (const k of GOOGLE_RETURN_PARAMS) params.delete(k)
    setParams(params, { replace: true })
    void outcome.then((res) => {
      if (!res) return
      if (res.ok) {
        toast.success(res.purpose === 'workspace' ? 'Team calendar connected' : 'Google connected')
        void reload()
      } else {
        toast.error(res.error)
      }
    })
  }, [params, setParams, reload])

  // An installed iOS app sends Connect to a browser tab; when the person
  // comes back, the connection may have changed underneath this screen.
  useEffect(() => {
    if (!isGoogleAvailable) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [reload])

  const google: GoogleState = { status, error, unreachable, reload }
  return (
    <div className="space-y-5">
      <GoogleCard google={google} />
      {admin && <TeamCalendarCard google={google} />}
      {admin && <EmailSettingsCard />}
      {seesCalendar && <CalendarFeedCard />}
      {user?.role === 'admin' && <AutomationsCard />}
    </div>
  )
}

/** Leaves for Google's consent screen; resolves with an error sentence, or null once the browser is on its way. */
async function connectGoogle(purpose: GooglePurpose, proxied: boolean): Promise<{ error: string | null; newTab: boolean }> {
  // An installed iOS app has no browser chrome and Google refuses embedded
  // sign-in, so the consent screen opens in a browser tab there.
  const newTab = isStandalone() && detectPlatform().os === 'ios'
  const returnTo = `${window.location.origin}${withBase('/settings')}?section=integrations`
  const res = await startGoogleConnect(returnTo, { purpose, proxied, newTab })
  return { error: res.ok ? null : res.error, newTab }
}

/** Back from Google through the back/forward cache: the page never really left, so "Opening Google…" would stick. */
function useUnstickOnReturn(reset: () => void) {
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) reset()
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [reset])
}

const NEW_TAB_HINT = 'Finish in the browser tab that opened, then come back here.'

function StatusLoading({ label }: { label: string }) {
  return (
    // Shaped like the connected row it stands in for; the breathing dot is
    // the one live signal (a request in flight).
    <div aria-busy="true">
      <p className="flex items-center gap-2 text-xs text-ink-300" role="status">
        <StatusDot tone="sync" breathe size="xs" />
        {label}
      </p>
      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton w={220} h={12} />
          <Skeleton w={120} h={10} />
        </div>
        <Skeleton w={104} h={36} rounded="md" />
      </div>
    </div>
  )
}

function StatusError({
  error, onRetry, quiet,
}: {
  error: string
  onRetry: () => void
  /** Not set up yet, rather than broken: the neutral notice, not the red one. */
  quiet?: boolean
}) {
  return (
    <Notice
      tone={quiet ? 'info' : 'danger'}
      icon={quiet ? PlugsConnectedIcon : WarningCircleIcon}
      live={!quiet}
      action={
        <button type="button" className="btn-secondary -my-1 shrink-0 py-1.5 pointer-coarse:min-h-11" onClick={onRetry}>
          Retry
        </button>
      }
    >
      {error}
    </Notice>
  )
}

function GoogleCard({ google }: { google: GoogleState }) {
  const { status, error: loadError, unreachable, reload } = google
  const [busy, setBusy] = useState<'connect' | 'disconnect' | 'export' | null>(null)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [tabs, setTabs] = useState<ExportTab[]>(EXPORT_TABS.map((t) => t.id))
  const [lastExport, setLastExport] = useState<ExportResult | null>(null)

  const unstick = useCallback(() => setBusy((b) => (b === 'connect' ? null : b)), [])
  useUnstickOnReturn(unstick)

  const connect = async () => {
    setBusy('connect')
    setConnectError(null)
    setHint(null)
    const res = await connectGoogle('personal', Boolean(status?.proxied))
    if (res.error) {
      setConnectError(res.error)
      setBusy(null)
    } else if (res.newTab) {
      setHint(NEW_TAB_HINT)
      setBusy(null)
    }
    // Otherwise the page is already leaving for Google; stay busy.
  }

  const disconnect = async () => {
    setConfirmDisconnect(false)
    setBusy('disconnect')
    const res = await disconnectGoogle('personal')
    setBusy(null)
    if (res.ok) {
      toast.success('Google disconnected')
      setLastExport(null)
      void reload()
    } else {
      toast.error(res.error)
    }
  }

  const runExport = async () => {
    if (!tabs.length) return
    setBusy('export')
    const res = await exportToGoogleSheets(tabs)
    setBusy(null)
    if (!res.ok) {
      toast.error(res.error)
      if (res.reauth) void reload()
      return
    }
    setLastExport(res.data)
    toast.success('Exported to Google Sheets')
    if (res.data.skipped.length) {
      toast.error(`Skipped: ${res.data.skipped.map((s) => labelOf(s.tab)).join(', ')}`)
    }
  }

  const toggleTab = (id: ExportTab) =>
    setTabs((cur) => (cur.includes(id) ? cur.filter((t) => t !== id) : [...cur, id]))

  let body: ReactNode
  if (!isGoogleAvailable) {
    body = <Notice tone="info" icon={PlugsConnectedIcon}>{LOCAL_MODE}</Notice>
  } else if (loadError) {
    body = <StatusError error={loadError} quiet={unreachable} onRetry={() => void reload()} />
  } else if (!status) {
    body = <StatusLoading label="Checking your Google connection…" />
  } else if (!status.configured) {
    body = (
      <p className="text-xs text-ink-300">
        Not set up on this workspace yet. An admin needs to create the Google OAuth client and set the
        function secrets (supabase/functions/google/README.md).
      </p>
    )
  } else if (!status.connected) {
    body = (
      <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-ink-300">Not connected. Exports go to your own Drive.</p>
          <button type="button" className="btn-primary pointer-coarse:min-h-11" disabled={busy !== null} onClick={() => void connect()}>
            {busy === 'connect' ? 'Opening Google…' : 'Connect Google'}
          </button>
        </div>
        <FieldError error={connectError} className="mt-3" />
        {hint && <p className="mt-3 text-xs text-ink-300" role="status">{hint}</p>}
      </>
    )
  } else {
    const truncated = lastExport?.tabs.filter((t) => t.truncated) ?? []
    body = (
      <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5 text-sm text-ink-100">
            <StatusDot tone="online" className="mt-1.5 shrink-0" />
            <div className="min-w-0">
              Connected as <span className="font-medium text-ink-50 [overflow-wrap:anywhere]">{status.email}</span>
              {status.connectedAt && (
                <div className="text-[11px] text-ink-300 tabular-nums">since {fmtDate(status.connectedAt)}</div>
              )}
            </div>
          </div>
          <button type="button" className="btn-secondary pointer-coarse:min-h-11" disabled={busy !== null} onClick={() => setConfirmDisconnect(true)}>
            {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </div>

        {!status.driveGranted && (
          <Notice tone="warn" icon={WarningIcon} className="mt-4">
            Drive access is missing from this connection. Disconnect and connect again, leaving the Drive box
            ticked.
          </Notice>
        )}

        {/* Exports are for admins: the function refuses anyone else, so the control is not offered. */}
        {status.exportAllowed && (
          <div className="mt-5 border-t border-ink-600 pt-5">
            <h4 className="section-title mb-3">Export to Google Sheets</h4>
            <div className="flex flex-wrap gap-2">
              {EXPORT_TABS.map((t) => {
                const on = tabs.includes(t.id)
                return (
                  <label
                    key={t.id}
                    className={classNames(
                      'chip pressable cursor-pointer gap-1.5 px-2.5 py-1 focus-within:ring-2 focus-within:ring-brand-500/40 pointer-coarse:min-h-11 pointer-coarse:px-3.5',
                      on
                        ? 'bg-brand-500/15 border-brand-500/30 text-brand-700 dark:text-brand-400'
                        : 'border-ink-500 text-ink-200 hover:border-ink-400 hover:text-ink-50',
                    )}
                  >
                    <input type="checkbox" className="sr-only" checked={on} onChange={() => toggleTab(t.id)} />
                    {/* The tick marks the selected state by shape, not by colour alone. */}
                    {on && <CheckIcon size={13} aria-hidden />}
                    {t.label}
                  </label>
                )
              })}
            </div>
            <p className="mt-3 max-w-[65ch] text-[11px] leading-relaxed text-ink-300">
              Creates a new spreadsheet in your Drive, in the “DeskDev Exports” folder. It holds what you can see in
              DeskDev, up to 5,000 rows per tab.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="btn-primary pointer-coarse:min-h-11"
                disabled={!tabs.length || busy !== null}
                onClick={() => void runExport()}
              >
                {busy === 'export' ? 'Exporting…' : 'Export to Google Sheets'}
              </button>
              {lastExport && (
                <a
                  href={lastExport.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-w-0 items-center gap-1 text-sm text-brand-700 hover:underline dark:text-brand-400 [overflow-wrap:anywhere]"
                >
                  Open {lastExport.title}
                  <ArrowSquareOutIcon size={13} aria-hidden />
                </a>
              )}
            </div>
            {truncated.length > 0 && (
              <Notice tone="warn" icon={WarningIcon} className="mt-3">
                Cut off at 5,000 rows: {truncated.map((t) => labelOf(t.tab)).join(', ')}.
              </Notice>
            )}
          </div>
        )}
      </>
    )
  }

  return (
    <Panel
      title="Google Drive & Sheets"
      icon={TableIcon}
      iconTone={status?.connected ? 'success' : 'neutral'}
      description="Your own Google account, connected for exports. DeskDev can only see the files it creates there."
    >
      {body}

      <ConfirmDialog
        open={confirmDisconnect}
        title="Disconnect Google?"
        message="DeskDev forgets your Google connection and removes its access at Google. Spreadsheets already exported stay in your Drive."
        confirmLabel="Disconnect"
        danger
        onConfirm={() => void disconnect()}
        onClose={() => setConfirmDisconnect(false)}
      />
    </Panel>
  )
}

/** One figure in the sync strip: a small label over a tabular value. */
function Stat({ label, children, tone }: { label: string; children: ReactNode; tone?: 'danger' }) {
  return (
    <div className="min-w-0 px-4 py-3 first:pl-0 max-sm:px-0 max-sm:py-2.5">
      <dt className="text-[11px] text-ink-300">{label}</dt>
      <dd
        className={classNames(
          'mt-0.5 truncate text-sm font-medium tabular-nums',
          tone === 'danger' ? 'text-rose-700 dark:text-rose-400' : 'text-ink-50',
        )}
      >
        {children}
      </dd>
    </div>
  )
}

/** Admins: the company Google account that owns the shared team calendar. */
function TeamCalendarCard({ google }: { google: GoogleState }) {
  const { status, error: loadError, unreachable, reload } = google
  const [sync, setSync] = useState<WorkspaceCalendarStatus | null>(null)
  const [syncMissing, setSyncMissing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'connect' | 'disconnect' | 'retry' | null>(null)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  const applySync = useCallback((res: Awaited<ReturnType<typeof getWorkspaceCalendarStatus>>) => {
    if (res.ok) {
      setSync(res.data)
      setSyncMissing(false)
      setSyncError(null)
    } else if (res.missing) {
      setSyncMissing(true)
    } else {
      setSyncError(res.error)
    }
  }, [])

  // The function's status says whether the grant exists; the database says
  // how the sync is doing. Re-read both whenever the grant changes.
  const linkStatus = status?.workspace.status
  useEffect(() => {
    if (!isGoogleAvailable || !status?.workspace.available) return
    let cancelled = false
    void getWorkspaceCalendarStatus().then((res) => {
      if (!cancelled) applySync(res)
    })
    return () => {
      cancelled = true
    }
  }, [status?.workspace.available, linkStatus, applySync])

  const unstick = useCallback(() => setBusy((b) => (b === 'connect' ? null : b)), [])
  useUnstickOnReturn(unstick)

  const connect = async () => {
    setBusy('connect')
    setConnectError(null)
    setHint(null)
    const res = await connectGoogle('workspace', Boolean(status?.proxied))
    if (res.error) {
      setConnectError(res.error)
      setBusy(null)
    } else if (res.newTab) {
      setHint(NEW_TAB_HINT)
      setBusy(null)
    }
  }

  const disconnect = async () => {
    setConfirmDisconnect(false)
    setBusy('disconnect')
    const res = await disconnectGoogle('workspace')
    setBusy(null)
    if (res.ok) {
      toast.success('Team calendar disconnected')
      void reload()
    } else {
      toast.error(res.error)
    }
  }

  const retry = async () => {
    setBusy('retry')
    setSyncError(null)
    const res = await retryFailedCalendarSync()
    setBusy(null)
    if (!res.ok) {
      setSyncError(res.error)
      return
    }
    toast.success(res.data === 1 ? '1 event queued again' : `${res.data.toLocaleString()} events queued again`)
    applySync(await getWorkspaceCalendarStatus())
  }

  const ws = status?.workspace
  // The database row is the fresher of the two for a revoked grant (Google can pull access at any time).
  const state = sync?.status ?? ws?.status ?? 'disconnected'
  const email = sync?.googleEmail ?? ws?.email ?? null

  let body: ReactNode
  if (!isGoogleAvailable) {
    body = <Notice tone="info" icon={PlugsConnectedIcon}>{LOCAL_MODE}</Notice>
  } else if (loadError) {
    body = <StatusError error={loadError} quiet={unreachable} onRetry={() => void reload()} />
  } else if (!status || !ws) {
    body = <StatusLoading label="Checking the team calendar…" />
  } else if (!status.configured) {
    body = (
      <p className="text-xs text-ink-300">
        Not set up on this workspace yet. An admin needs to create the Google OAuth client and set the
        function secrets (supabase/functions/google/README.md).
      </p>
    )
  } else if (!ws.available || syncMissing) {
    body = (
      <Notice tone="info" icon={CalendarDotsIcon}>
        The team calendar is not set up on the server yet. Deploy the current google function and apply {MIGRATION_040}.
      </Notice>
    )
  } else if (state !== 'active') {
    const revoked = state === 'revoked'
    body = (
      <>
        {revoked && (
          <Notice tone="warn" icon={WarningIcon} className="mb-4">
            Google withdrew access{email ? <> for <span className="font-medium text-ink-50">{email}</span></> : null}
            {sync?.revokedAt ? `, ${fmtRelative(sync.revokedAt)}` : ''}. Changes keep queueing. Connect the same account
            again to send them.
          </Notice>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-ink-300">
            {revoked ? 'Not syncing.' : 'Not connected. Use the company Google account, not a personal one.'}
          </p>
          <button type="button" className="btn-primary pointer-coarse:min-h-11" disabled={busy !== null} onClick={() => void connect()}>
            {busy === 'connect' ? 'Opening Google…' : revoked ? 'Reconnect' : 'Connect company account'}
          </button>
        </div>
        <FieldError error={connectError} className="mt-3" />
        {hint && <p className="mt-3 text-xs text-ink-300" role="status">{hint}</p>}
      </>
    )
  } else {
    const failed = sync?.failed ?? 0
    const pending = sync?.pending ?? 0
    const since = sync?.connectedAt ?? ws.connectedAt
    body = (
      <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5 text-sm text-ink-100">
            <StatusDot tone="online" className="mt-1.5 shrink-0" />
            <div className="min-w-0">
              Connected as <span className="font-medium text-ink-50 [overflow-wrap:anywhere]">{email ?? '—'}</span>
              {since && <div className="text-[11px] text-ink-300 tabular-nums">since {fmtDate(since)}</div>}
            </div>
          </div>
          <button type="button" className="btn-secondary pointer-coarse:min-h-11" disabled={busy !== null} onClick={() => setConfirmDisconnect(true)}>
            {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </div>

        {!ws.calendarGranted && (
          <Notice tone="warn" icon={WarningIcon} className="mt-4">
            Calendar access is missing from this connection. Disconnect and connect again, leaving the Calendar box
            ticked.
          </Notice>
        )}
        {/* The website's booking page (048) also reads this account's own busy
            times when it may. Unset: a function from before booking. */}
        {ws.calendarGranted && ws.freebusyGranted === false && (
          <Notice tone="info" icon={CalendarDotsIcon} className="mt-4">
            The booking page checks only the team calendar and DeskDev meetings. Disconnect and connect again once to
            include this account’s own busy times.
          </Notice>
        )}

        {sync && (
          <div className="mt-5 border-t border-ink-600">
            {/* Hairlines, not boxes: four figures on one line, stacked two-up on a phone. */}
            <dl className="grid grid-cols-2 sm:grid-cols-4 sm:divide-x sm:divide-ink-600">
              <Stat label="Last sync">{sync.lastSyncAt ? fmtRelative(sync.lastSyncAt) : 'Not yet'}</Stat>
              <Stat label="Waiting">{pending.toLocaleString()}</Stat>
              <Stat label="Failed, 7 days" tone={failed > 0 ? 'danger' : undefined}>{failed.toLocaleString()}</Stat>
              <Stat label="Time zone">{sync.calendarTimeZone ?? (sync.calendarReady ? '—' : 'Made on first sync')}</Stat>
            </dl>
            {(failed > 0 || sync.lastError) && (
              <div className="flex flex-wrap items-start justify-between gap-3 border-t border-ink-600 pt-3">
                {sync.lastError ? (
                  <p
                    className="min-w-0 flex-1 basis-60 font-mono text-[11px] leading-relaxed text-rose-700 line-clamp-2 [overflow-wrap:anywhere] dark:text-rose-400"
                    title={sync.lastError}
                  >
                    {sync.lastError}
                  </p>
                ) : (
                  <span />
                )}
                {failed > 0 && (
                  <button type="button" className="btn-secondary shrink-0 pointer-coarse:min-h-11" disabled={busy !== null} onClick={() => void retry()}>
                    <ArrowsClockwiseIcon size={14} className={classNames(busy === 'retry' && 'animate-spin')} aria-hidden />
                    {busy === 'retry' ? 'Retrying…' : 'Retry failed'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        <FieldError error={syncError} className="mt-3" />
      </>
    )
  }

  return (
    <Panel
      title="Team calendar"
      icon={CalendarDotsIcon}
      iconTone={state === 'active' ? 'success' : state === 'revoked' ? 'warn' : 'neutral'}
      description="One company Google account holds the shared team calendar. Events with “Sync to team calendar” on are sent to it, and guests get their invitations from Google. The website’s booking page offers only the times it is free."
    >
      {body}

      <ConfirmDialog
        open={confirmDisconnect}
        title="Disconnect the team calendar?"
        message="DeskDev stops sending events and removes its access at Google. Events already on the team calendar stay there. Connecting the same account again picks up where it left off."
        confirmLabel="Disconnect"
        danger
        onConfirm={() => void disconnect()}
        onClose={() => setConfirmDisconnect(false)}
      />
    </Panel>
  )
}

const FEED_SCOPES: { id: CalendarFeedScope; label: string; hint: string }[] = [
  { id: 'mine', label: 'My events', hint: 'Events you created or are invited to' },
  { id: 'all', label: 'All events', hint: 'Everything you can see in the calendar' },
]

/** A secret .ics address per person: DeskDev events in their own calendar app, no Google sign-in. */
function CalendarFeedCard() {
  const [feed, setFeed] = useState<CalendarFeedStatus | null>(null)
  const [missing, setMissing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [scope, setScope] = useState<CalendarFeedScope>('mine')
  const [busy, setBusy] = useState<'rotate' | 'revoke' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  // The address exists only in this state: the server never shows it again.
  const [freshUrl, setFreshUrl] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'rotate' | 'revoke' | null>(null)
  const [copied, flashCopied] = useCopied()

  const apply = useCallback((res: Awaited<ReturnType<typeof getCalendarFeedStatus>>) => {
    if (res.ok) {
      setFeed(res.data)
      if (res.data.scope) setScope(res.data.scope)
      setMissing(false)
      setLoadError(null)
    } else if (res.missing) {
      setMissing(true)
    } else {
      setLoadError(res.error)
    }
  }, [])

  const load = useCallback(async () => apply(await getCalendarFeedStatus()), [apply])

  useEffect(() => {
    if (!isGoogleAvailable) return
    let cancelled = false
    void getCalendarFeedStatus().then((res) => {
      if (!cancelled) apply(res)
    })
    return () => {
      cancelled = true
    }
  }, [apply])

  const rotate = async () => {
    setConfirm(null)
    setBusy('rotate')
    setActionError(null)
    const res = await rotateCalendarFeed(scope)
    setBusy(null)
    if (!res.ok) {
      setActionError(res.error)
      return
    }
    setFreshUrl(res.data.url)
    void load()
  }

  const revoke = async () => {
    setConfirm(null)
    setBusy('revoke')
    setActionError(null)
    const res = await revokeCalendarFeed()
    setBusy(null)
    if (!res.ok) {
      setActionError(res.error)
      return
    }
    setFreshUrl(null)
    toast.success('Calendar feed turned off')
    void load()
  }

  const copy = async () => {
    if (!freshUrl) return
    if (await copyText(freshUrl)) {
      flashCopied()
      toast.success('Feed address copied')
    } else {
      toast.error('Could not copy. Select the address and copy it by hand.')
    }
  }

  const scopePicker = (
    <div>
      <span className={LABEL} id="feed-scope-label">Include</span>
      <div role="radiogroup" aria-labelledby="feed-scope-label" onKeyDown={radioKeys} className="mt-2 grid gap-2 sm:grid-cols-2">
        {FEED_SCOPES.map((s) => {
          const on = scope === s.id
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              disabled={busy !== null}
              onClick={() => setScope(s.id)}
              className={classNames(
                'pressable flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left pointer-coarse:min-h-11',
                on ? 'border-brand-500/40 bg-brand-500/10' : 'border-ink-600 hover:border-ink-500',
              )}
            >
              {/* The filled ring marks the choice by shape as well as colour. */}
              <span
                aria-hidden
                className={classNames(
                  'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
                  on ? 'border-brand-600 dark:border-brand-400' : 'border-ink-400',
                )}
              >
                {on && <span className="size-2 rounded-full bg-brand-600 dark:bg-brand-400" />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink-50">{s.label}</span>
                <span className="block text-[11px] leading-relaxed text-ink-300">{s.hint}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )

  let body: ReactNode
  if (!isGoogleAvailable) {
    body = <Notice tone="info" icon={PlugsConnectedIcon}>{LOCAL_MODE}</Notice>
  } else if (missing) {
    body = (
      <Notice tone="info" icon={CalendarDotsIcon}>
        Calendar feeds are not set up on the server yet. Apply {MIGRATION_040}.
      </Notice>
    )
  } else if (loadError) {
    body = <StatusError error={loadError} onRetry={() => void load()} />
  } else if (!feed) {
    body = <StatusLoading label="Checking your calendar feed…" />
  } else {
    const scopeChanged = feed.active && feed.scope !== undefined && feed.scope !== scope
    body = (
      <div className="space-y-4">
        {feed.active && (
          <div className="flex min-w-0 items-start gap-2.5 text-sm text-ink-100">
            <StatusDot tone="online" className="mt-1.5 shrink-0" />
            <div className="min-w-0">
              Feed is on
              {feed.hint && (
                <>
                  , address ending <span className="font-mono text-xs text-ink-50">…{feed.hint}</span>
                </>
              )}
              <div className="text-[11px] text-ink-300 tabular-nums">
                {feed.createdAt ? `made ${fmtDate(feed.createdAt)}` : 'made earlier'}
                {' · '}
                {feed.lastUsedAt ? `last read ${fmtRelative(feed.lastUsedAt)}` : 'not read yet'}
              </div>
            </div>
          </div>
        )}

        {freshUrl && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 p-3">
            <label htmlFor="feed-url" className={LABEL}>Your feed address</label>
            <div className="mt-2 flex gap-2">
              <input
                id="feed-url"
                readOnly
                value={freshUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="input min-w-0 flex-1 font-mono text-xs"
              />
              <button type="button" className="btn-secondary shrink-0 pointer-coarse:min-h-11" onClick={() => void copy()}>
                <CopyGlyph copied={copied} />
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-200">
              Copy it now: it is shown once. Add it to your calendar app as a subscription by URL. Anyone who has this
              address can read these events.
            </p>
          </div>
        )}

        {scopePicker}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={feed.active ? 'btn-secondary pointer-coarse:min-h-11' : 'btn-primary pointer-coarse:min-h-11'}
            disabled={busy !== null}
            onClick={() => (feed.active ? setConfirm('rotate') : void rotate())}
          >
            {busy === 'rotate' ? 'Making the address…' : feed.active ? (scopeChanged ? 'Save and make a new address' : 'Make a new address') : 'Create feed address'}
          </button>
          {feed.active && (
            <button type="button" className="btn-ghost pointer-coarse:min-h-11" disabled={busy !== null} onClick={() => setConfirm('revoke')}>
              {busy === 'revoke' ? 'Turning off…' : 'Turn off'}
            </button>
          )}
        </div>
        <FieldError error={actionError} />
      </div>
    )
  }

  return (
    <Panel
      title="Calendar feed"
      icon={LinkSimpleIcon}
      iconTone={feed?.active ? 'success' : 'neutral'}
      description="A private address that shows DeskDev events in your own calendar app. Read-only, and it needs no Google sign-in."
    >
      {body}

      <ConfirmDialog
        open={confirm === 'rotate'}
        title="Make a new feed address?"
        message="The current address stops working at once. Calendar apps that use it need the new one."
        confirmLabel="Make a new address"
        onConfirm={() => void rotate()}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'revoke'}
        title="Turn off the calendar feed?"
        message="The address stops working at once. Calendar apps that use it stop updating."
        confirmLabel="Turn off"
        danger
        onConfirm={() => void revoke()}
        onClose={() => setConfirm(null)}
      />
    </Panel>
  )
}

function labelOf(tab: ExportTab): string {
  return EXPORT_TABS.find((t) => t.id === tab)?.label ?? tab
}

function AutomationsCard() {
  const [state, setState] = useState<AutomationHealthResult | null>(null)
  const [loading, setLoading] = useState(false)

  // The refresh button; the first load is the effect below (state === null
  // doubles as its loading state).
  const refresh = async () => {
    setLoading(true)
    setState(await fetchAutomationHealth())
    setLoading(false)
  }

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let cancelled = false
    void (async () => {
      const res = await fetchAutomationHealth()
      if (!cancelled) setState(res)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  let body: ReactNode
  if (!isSupabaseConfigured) {
    body = <Notice tone="info" icon={PlugsConnectedIcon}>{LOCAL_MODE}</Notice>
  } else if (!state) {
    body = (
      <div aria-busy="true">
        <p className="flex items-center gap-2 text-xs text-ink-300" role="status">
          <StatusDot tone="sync" breathe size="xs" />
          Reading the run log…
        </p>
        <div className="mt-2 divide-y divide-ink-600">
          {[64, 48, 56].map((w) => (
            <div key={w} className="flex items-center gap-3 py-3">
              <div className="flex-1 space-y-2">
                <Skeleton w={`${w}%`} h={12} />
                <Skeleton w={`${w - 20}%`} h={10} />
              </div>
              <Skeleton w={56} h={20} rounded="sm" />
            </div>
          ))}
        </div>
      </div>
    )
  } else if (!state.ok) {
    body = (
      <Notice tone={state.missing ? 'info' : 'danger'} icon={state.missing ? TreeStructureIcon : WarningCircleIcon}>
        {state.missing
          ? 'The run log is not set up yet. Apply supabase/migrations/026_automation_runs.sql.'
          : state.error}
      </Notice>
    )
  } else if (!state.rows.length) {
    body = (
      <p className="rounded-lg border border-dashed border-ink-500 px-4 py-6 text-center text-xs text-ink-300">
        No automations registered yet.
      </p>
    )
  } else {
    body = (
      <div className="-mt-1 divide-y divide-ink-600">
        {state.rows.map((row) => {
          const s = STATUS_LABEL[row.status]
          return (
            <div key={row.job} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
              <div className="min-w-[180px] flex-1">
                <div className="font-mono text-xs font-medium text-ink-50 [overflow-wrap:anywhere]">{row.job}</div>
                <div className="mt-0.5 text-[11px] text-ink-300">
                  {cadenceLabel(row)}
                  {row.description ? ` · ${row.description}` : ''}
                </div>
              </div>
              <div className="text-xs text-ink-300 tabular-nums">
                {row.last_ok_at ? `last ok ${fmtRelative(row.last_ok_at)}` : 'no ok run'}
              </div>
              {row.errors_7d > 0 && (
                <span className="text-xs text-rose-700 dark:text-rose-400 tabular-nums">
                  {row.errors_7d.toLocaleString()} failed in 7d
                </span>
              )}
              <span className={classNames('badge shrink-0 whitespace-nowrap', s.badge)} title={s.hint}>
                {s.label}
              </span>
              {row.status === 'failing' && row.last_error && (
                // Two lines, the rest in the title: a stack trace shouldn't push
                // the next job off screen, nor vanish into one cut line on touch.
                <div
                  className="basis-full font-mono text-[11px] leading-relaxed text-rose-700 line-clamp-2 [overflow-wrap:anywhere] dark:text-rose-400"
                  title={row.last_error}
                >
                  {row.last_error_node ? `${row.last_error_node}: ` : ''}
                  {row.last_error}
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <Panel
      title="Automations"
      icon={TreeStructureIcon}
      description="The n8n workflows, judged by the run log each one writes, not by whether n8n answers."
      aside={
        isSupabaseConfigured ? (
          <button
            className="btn-ghost tap-target -mr-2 -mt-1 shrink-0 p-2"
            disabled={loading}
            onClick={() => void refresh()}
            aria-label="Refresh automation health"
          >
            <ArrowsClockwiseIcon size={16} className={classNames(loading && 'animate-spin')} aria-hidden />
          </button>
        ) : undefined
      }
    >
      {body}
    </Panel>
  )
}
