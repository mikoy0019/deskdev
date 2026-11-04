import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CalendarCheckIcon, CheckCircleIcon, WarningCircleIcon } from '@phosphor-icons/react'
import ConfirmDialog from '../ConfirmDialog'
import { isSupabaseConfigured } from '../../lib/supabase'
import { withBase } from '../../lib/basePath'
import { fmtDate } from '../../lib/format'
import { disconnectWorkspace, getGoogleStatus, startWorkspaceConnect, type WorkspaceStatus } from '../../lib/google'

// Admins: the company Google account (040's google_workspace_link). Every
// meeting with "Sync to Google" goes to its Team Calendar, with a Meet link
// and invites; the booking page (/book) reads its free/busy so customers only
// see open times. Free/busy is an optional permission (048): connected before
// it existed, the account needs one reconnect.

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-[13px] text-ink-100">
      {ok ? (
        <CheckCircleIcon size={15} weight="fill" className="mt-px shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
      ) : (
        <WarningCircleIcon size={15} className="mt-px shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
      )}
      <span>{children}</span>
    </li>
  )
}

export default function CompanyCalendarCard() {
  const [ws, setWs] = useState<WorkspaceStatus | null>(null)
  const [configured, setConfigured] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)

  const load = useCallback(async () => {
    const res = await getGoogleStatus()
    if (res.ok) {
      setWs(res.data.workspace ?? null)
      setConfigured(res.data.configured)
      setError(null)
    } else {
      setError(res.error)
    }
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let cancelled = false
    void (async () => {
      const res = await getGoogleStatus()
      if (cancelled) return
      if (res.ok) {
        setWs(res.data.workspace ?? null)
        setConfigured(res.data.configured)
      } else {
        setError(res.error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Back from Google's consent screen through the back/forward cache.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) setBusy(false)
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [])

  const connect = async () => {
    setBusy(true)
    // GoogleCard on this page settles the return (?google=pending&grant=…).
    const res = await startWorkspaceConnect(`${window.location.origin}${withBase('/settings')}?section=integrations`)
    if (!res.ok) {
      toast.error(res.error)
      setBusy(false)
    }
  }

  const disconnect = async () => {
    setConfirm(false)
    setBusy(true)
    const res = await disconnectWorkspace()
    setBusy(false)
    if (res.ok) {
      toast.success('Company calendar disconnected')
      void load()
    } else {
      toast.error(res.error)
    }
  }

  const connected = Boolean(ws?.connected)
  const revoked = ws?.status === 'revoked'

  return (
    <section className="card p-5" aria-labelledby="company-calendar-title">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-ink-600 bg-ink-700/60 text-ink-300">
          <CalendarCheckIcon size={18} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="company-calendar-title" className="text-sm font-semibold text-ink-50">Company calendar</h2>
          <p className="mt-0.5 text-[13px] leading-relaxed text-ink-300">
            The studio&apos;s Google account. Meetings set to sync land on its Team Calendar with a Meet link and invites,
            and the website&apos;s booking page offers only the times it&apos;s free.
          </p>
        </div>
      </div>

      <div className="mt-4">
        {!isSupabaseConfigured ? (
          <p className="text-[13px] text-ink-300">Available when DeskDev runs on Supabase. This build is in local mode.</p>
        ) : error ? (
          <p className="text-[13px] text-rose-700 dark:text-rose-400">{error}</p>
        ) : !ws ? (
          <p className="text-[13px] text-ink-300">Checking…</p>
        ) : !ws.available ? (
          <p className="text-[13px] text-ink-300">Needs migration 040 on the database first.</p>
        ) : (
          <>
            {connected ? (
              <ul className="space-y-1.5">
                <Check ok>Connected as <strong className="text-ink-50">{ws.email}</strong>{ws.connectedAt ? ` since ${fmtDate(ws.connectedAt)}` : ''}</Check>
                <Check ok={ws.calendarGranted}>{ws.calendarGranted ? 'Team Calendar: meetings sync with Meet links' : 'Team Calendar permission missing — reconnect'}</Check>
                <Check ok={Boolean(ws.freebusyGranted)}>
                  {ws.freebusyGranted
                    ? 'Booking page checks your own Google busy times'
                    : 'Booking page checks only the Team Calendar and DeskDev — reconnect once to include your own busy times'}
                </Check>
              </ul>
            ) : (
              <p className="text-[13px] text-ink-200">
                {revoked
                  ? 'Google stopped accepting the saved permission (password change or removed access). Connect again.'
                  : 'Not connected. Booked calls still land in DeskDev, but without Google invites or Meet links.'}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="btn-primary" disabled={busy || !configured} onClick={() => void connect()}>
                {connected ? 'Reconnect' : 'Connect company Google account'}
              </button>
              {connected && (
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => setConfirm(true)}>
                  Disconnect
                </button>
              )}
            </div>
            {!configured && (
              <p className="mt-2 text-[11px] text-ink-400">The Google sign-in isn&apos;t configured on the server yet (function secrets).</p>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirm}
        title="Disconnect the company calendar"
        message="Meetings stop syncing to Google and the booking page stops checking Google for busy times. Events already on the Team Calendar stay there."
        confirmLabel="Disconnect"
        danger
        onConfirm={() => void disconnect()}
        onClose={() => setConfirm(false)}
      />
    </section>
  )
}
