import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowSquareOutIcon, CopySimpleIcon } from '@phosphor-icons/react'
import { useStore } from '../../store/useStore'
import { can } from '../../lib/permissions'
import { bookingPageUrl } from '../../lib/booking'
import { Switch } from './formKit'

// Admin-only: the public booking page (048, nixgensolutions.com/book). Free
// times are the Growth business hours above, minus the company Google
// calendar's busy times and DeskDev meetings; a booking becomes a meeting on
// the lead, synced to Google with a Meet link and an invite. Saved on its own
// (a database without 048 keeps the rest of Growth saving).

const LABEL = 'block text-xs font-medium text-ink-200 mb-1.5'
const HINT = 'mt-1 text-[11px] text-ink-300'
const GROUP = 'pt-4 border-t border-ink-600'
const GROUP_TITLE = 'text-xs font-semibold uppercase tracking-wider text-ink-300 mb-3'

/** A labelled on/off row: the switch at the right, its explanation under the label. */
function ToggleRow({
  label, hint, on, onChange,
}: {
  label: string
  hint: ReactNode
  on: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-start gap-4">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-ink-50">{label}</div>
        <div className="mt-0.5 text-xs text-ink-300">{hint}</div>
      </div>
      <Switch on={on} onChange={onChange} label={label} />
    </div>
  )
}

const DURATIONS = [15, 20, 30, 45, 60, 90]
const NOTICE = [
  { value: 0, label: 'No minimum' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 240, label: '4 hours' },
  { value: 1440, label: '1 day' },
  { value: 2880, label: '2 days' },
]
const AHEAD = [7, 14, 21, 30, 60]
const BUFFER = [0, 5, 10, 15, 30]

export default function BookingSection() {
  const ws = useStore((s) => s.workspaceSettings)
  const users = useStore((s) => s.users)
  const updateWorkspaceSettings = useStore((s) => s.updateWorkspaceSettings)

  const [enabled, setEnabled] = useState(ws.bookingEnabled)
  const [title, setTitle] = useState(ws.bookingTitle)
  const [minutes, setMinutes] = useState(ws.bookingMinutes)
  const [notice, setNotice] = useState(ws.bookingNoticeMinutes)
  const [ahead, setAhead] = useState(ws.bookingDaysAhead)
  const [buffer, setBuffer] = useState(ws.bookingBufferMinutes)
  const [hostId, setHostId] = useState(ws.bookingHostId ?? '')

  const hosts = useMemo(
    () => users.filter((u) => !u.deactivatedAt && can(u, 'growth', 'edit')).sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [users],
  )
  const pageUrl = bookingPageUrl()
  const autoReplyUsesPage = ws.growthBookingUrl === pageUrl
  // Keep a saved value visible even if it isn't one of the presets.
  const withCurrent = (list: number[], v: number) => (list.includes(v) ? list : [...list, v].sort((a, b) => a - b))

  const save = () => {
    const t = title.trim()
    if (!t || t.length > 80) {
      toast.error('The meeting name must be 1–80 characters')
      return
    }
    const ok = updateWorkspaceSettings({
      bookingEnabled: enabled,
      bookingTitle: t,
      bookingMinutes: minutes,
      bookingNoticeMinutes: notice,
      bookingDaysAhead: ahead,
      bookingBufferMinutes: buffer,
      bookingHostId: hostId || undefined,
    })
    if (ok) toast.success('Booking settings saved')
    else toast.error('Only an admin can change booking settings')
  }

  const useForAutoReply = () => {
    if (updateWorkspaceSettings({ growthBookingUrl: pageUrl })) toast.success('The auto-reply now links to the booking page')
    else toast.error('Could not update the auto-reply link')
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pageUrl)
      toast.success('Link copied')
    } catch {
      toast.error('Your browser blocked the clipboard')
    }
  }

  return (
    <section className="card p-5" aria-labelledby="booking-title">
      <h2 id="booking-title" className="text-sm font-semibold text-ink-50">Booking page</h2>
      <p className="mt-1 text-xs text-ink-300">
        Customers pick a free time on the website. Free times are your business hours above, minus your company Google
        calendar (Settings → Integrations) and DeskDev meetings.
      </p>

      <div className="mt-4 space-y-4">
        <ToggleRow
          label="Take bookings on the website"
          hint="Off: the booking page says online booking isn’t open and points to the contact form."
          on={enabled}
          onChange={setEnabled}
        />

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-ink-600 px-3 py-2">
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-200">{pageUrl}</span>
          <button type="button" className="btn-ghost px-2! py-1! text-xs" onClick={() => void copy()}>
            <CopySimpleIcon size={13} aria-hidden /> Copy
          </button>
          <a className="btn-ghost px-2! py-1! text-xs" href={pageUrl} target="_blank" rel="noreferrer">
            <ArrowSquareOutIcon size={13} aria-hidden /> Open
          </a>
        </div>
        {!autoReplyUsesPage && (
          <p className="text-[12px] text-ink-300">
            The website auto-reply {ws.growthBookingUrl ? 'links to another booking link' : 'has no booking link'}.{' '}
            <button type="button" className="font-medium text-brand-600 dark:text-brand-400 hover:underline" onClick={useForAutoReply}>
              Use this page instead
            </button>
          </p>
        )}

        <div className={GROUP}>
          <h3 className={GROUP_TITLE}>The meeting</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="booking-name" className={LABEL}>Meeting name</label>
              <input id="booking-name" className="input w-full" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
              <p className={HINT}>Shown on the page and in the calendar invite.</p>
            </div>
            <div>
              <label htmlFor="booking-host" className={LABEL}>Who takes the call</label>
              <select id="booking-host" className="input w-full" value={hostId} onChange={(e) => setHostId(e.target.value)}>
                <option value="">The lead’s owner (else an admin)</option>
                {hosts.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
              </select>
              <p className={HINT}>Their DeskDev meetings count as busy.</p>
            </div>
            <div>
              <label htmlFor="booking-length" className={LABEL}>Length</label>
              <select id="booking-length" className="input w-full" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                {withCurrent(DURATIONS, minutes).map((m) => <option key={m} value={m}>{m} minutes</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="booking-buffer" className={LABEL}>Buffer around meetings</label>
              <select id="booking-buffer" className="input w-full" value={buffer} onChange={(e) => setBuffer(Number(e.target.value))}>
                {withCurrent(BUFFER, buffer).map((m) => <option key={m} value={m}>{m === 0 ? 'None' : `${m} minutes`}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="booking-notice" className={LABEL}>Minimum notice</label>
              <select id="booking-notice" className="input w-full" value={notice} onChange={(e) => setNotice(Number(e.target.value))}>
                {NOTICE.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
                {!NOTICE.some((n) => n.value === notice) && <option value={notice}>{notice} minutes</option>}
              </select>
            </div>
            <div>
              <label htmlFor="booking-ahead" className={LABEL}>Bookable up to</label>
              <select id="booking-ahead" className="input w-full" value={ahead} onChange={(e) => setAhead(Number(e.target.value))}>
                {withCurrent(AHEAD, ahead).map((d) => <option key={d} value={d}>{d} days ahead</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <Link className="text-xs text-ink-400 hover:text-ink-200" to="/settings?section=integrations">
          Company calendar →
        </Link>
        <button type="button" className="btn-primary" onClick={save}>
          Save booking settings
        </button>
      </div>
    </section>
  )
}
