import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  ArrowDownIcon, ArrowUpIcon, ClockCounterClockwiseIcon, CloudSlashIcon, ImagesIcon, PaperPlaneTiltIcon, PlusIcon,
  TargetIcon, TimerIcon, UsersThreeIcon, XIcon,
} from '@phosphor-icons/react'
import Avatar from '../Avatar'
import { Skeleton } from '../motion'
import { useStore } from '../../store/useStore'
import { activeUsers, can } from '../../lib/permissions'
import { isValidBusinessHours } from '../../lib/leads'
import { isTableMissing } from '../../lib/db'
import { isSupabaseConfigured } from '../../lib/supabase'
import { classNames, fmtDuration, fmtRelative } from '../../lib/format'
import type { User, WorkspaceSettings } from '../../lib/types'
import { RETENTION_WINDOWS } from '../../../components/legal/facts'
import { FieldError, focusFirstInvalid, FormField, INPUT_INVALID, LABEL, Notice, Panel, Switch } from './formKit'
import BookingSection from './BookingSection'

/**
 * Settings → Growth (admins only): the workspace-wide rules behind the lead
 * inbox, the website's booking page and the showcase. They live in
 * workspace_settings (033), so every device sees the same values. The form
 * mirrors the server's checks, so a value accepted here is never refused there.
 */

const NUMBER = 'input w-full tabular-nums sm:w-32'
const NOT_SAVED = 'Not saved. Only an admin can change these settings.'
/** 033's booking-URL CHECK: https, a host with a dot, no spaces. */
const HTTPS_URL = /^https:\/\/[^\s/]+\.[^\s]+$/i

const WEEKDAYS: { iso: number; short: string; long: string }[] = [
  { iso: 1, short: 'Mon', long: 'Monday' },
  { iso: 2, short: 'Tue', long: 'Tuesday' },
  { iso: 3, short: 'Wed', long: 'Wednesday' },
  { iso: 4, short: 'Thu', long: 'Thursday' },
  { iso: 5, short: 'Fri', long: 'Friday' },
  { iso: 6, short: 'Sat', long: 'Saturday' },
  { iso: 7, short: 'Sun', long: 'Sunday' },
]

/** Digits only: '12' → 12, anything else (empty, '1.5', '-3', '1e3') → null. */
function whole(text: string): number | null {
  const t = text.trim()
  return /^\d{1,9}$/.test(t) ? Number(t) : null
}

function rangeError(n: number | null, min: number, max: number): string | undefined {
  return n === null || n < min || n > max
    ? `Enter a whole number from ${min.toLocaleString('en-US')} to ${max.toLocaleString('en-US')}`
    : undefined
}

/** Every zone this browser knows, with the saved one always in the list. */
function timeZones(current: string): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  let zones: string[] = []
  try {
    zones = intl.supportedValuesOf?.('timeZone') ?? []
  } catch {
    zones = []
  }
  return [...new Set(['UTC', current, ...zones])].sort((a, b) => a.localeCompare(b))
}

type Save = (patch: Partial<WorkspaceSettings>) => boolean

/** Who last changed the workspace row, and when: one line under the panels. */
function Stamp({ at, by }: { at?: string; by?: string }) {
  if (!at) return null
  return (
    <p className="px-1 text-[11px] text-ink-300">
      Last changed <span className="tabular-nums">{fmtRelative(at)}</span>{by ? ` by ${by}` : ''}
    </p>
  )
}

/** A switch with its label and one line of help, as a ruled row inside a panel. */
function SwitchRow({
  title, hint, on, onChange,
}: { title: string; hint: ReactNode; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ink-50">{title}</div>
        <p className="mt-0.5 max-w-[65ch] text-xs leading-relaxed text-ink-300 text-pretty">{hint}</p>
      </div>
      <Switch on={on} onChange={onChange} label={title} />
    </div>
  )
}

// ─── Reply times ────────────────────────────────────────────────────────────

function ReplyPanel({ ws, save }: { ws: WorkspaceSettings; save: Save }) {
  const [sla, setSla] = useState(String(ws.growthSlaMinutes))
  const [escalate, setEscalate] = useState(String(ws.growthEscalateMinutes))
  const [hours, setHours] = useState(ws.growthBusinessHours)
  const [errors, setErrors] = useState<{ sla?: string; escalate?: string; days?: string; time?: string; tz?: string; form?: string }>({})
  const zones = useMemo(() => timeZones(ws.growthBusinessHours.tz), [ws.growthBusinessHours.tz])

  const clear = (key: keyof typeof errors) => setErrors((e) => (e[key] || e.form ? { ...e, [key]: undefined, form: undefined } : e))
  const toggleDay = (iso: number) => {
    setHours((h) => ({ ...h, days: h.days.includes(iso) ? h.days.filter((d) => d !== iso) : [...h.days, iso].sort((a, b) => a - b) }))
    clear('days')
  }

  const submit = () => {
    const slaN = whole(sla)
    const escN = whole(escalate)
    const next: typeof errors = {
      sla: rangeError(slaN, 5, 10080),
      escalate: rangeError(escN, 5, 43200),
    }
    if (!next.sla && !next.escalate && (escN as number) < (slaN as number)) {
      next.escalate = 'Must be at least the reply time'
    }
    if (hours.days.length === 0) next.days = 'Pick at least one working day'
    if (!hours.start || !hours.end) next.time = 'Set both times'
    else if (hours.start >= hours.end) next.time = 'Closing time must be after opening time'
    if (!next.days && !next.time && !isValidBusinessHours(hours)) next.tz = 'Pick a time zone from the list'
    setErrors(next)
    if (Object.values(next).some(Boolean)) {
      focusFirstInvalid()
      return
    }
    const ok = save({ growthSlaMinutes: slaN as number, growthEscalateMinutes: escN as number, growthBusinessHours: hours })
    if (ok) {
      // Show what was stored ("015" is 15), so the form reads as saved.
      setSla(String(slaN))
      setEscalate(String(escN))
      toast.success('Reply times saved')
    } else setErrors({ form: NOT_SAVED })
  }

  const slaN = whole(sla)
  const escN = whole(escalate)
  const saved = ws.growthBusinessHours
  const dirty =
    sla !== String(ws.growthSlaMinutes) ||
    escalate !== String(ws.growthEscalateMinutes) ||
    hours.start !== saved.start || hours.end !== saved.end || hours.tz !== saved.tz ||
    [...hours.days].sort().join() !== [...saved.days].sort().join()
  return (
    <Panel
      title="Reply times"
      icon={TimerIcon}
      dirty={dirty}
      description="How long the team has to answer a new website lead. The clock only runs during working hours."
      footer={<button type="button" className="btn-primary" onClick={submit}>Save reply times</button>}
    >
      <div className="grid grid-cols-1 gap-x-5 gap-y-5 sm:grid-cols-2">
        <FormField
          label="First reply due within (minutes)"
          hint={slaN ? <>That is <span className="tabular-nums">{fmtDuration(slaN * 60_000)}</span> of working time. 5 to 10,080.</> : '5 to 10,080.'}
          error={errors.sla}
        >
          {(p) => (
            <input
              {...p} type="text" inputMode="numeric" autoComplete="off" maxLength={5}
              className={classNames(NUMBER, INPUT_INVALID)} value={sla}
              onChange={(e) => { setSla(e.target.value); clear('sla') }}
            />
          )}
        </FormField>
        <FormField
          label="Alert every admin after (minutes)"
          hint={escN ? <>Still no reply after <span className="tabular-nums">{fmtDuration(escN * 60_000)}</span> of working time. At least the reply time.</> : 'At least the reply time.'}
          error={errors.escalate}
        >
          {(p) => (
            <input
              {...p} type="text" inputMode="numeric" autoComplete="off" maxLength={5}
              className={classNames(NUMBER, INPUT_INVALID)} value={escalate}
              onChange={(e) => { setEscalate(e.target.value); clear('escalate') }}
            />
          )}
        </FormField>
      </div>

      <div className="mt-6 border-t border-ink-600 pt-5">
        <h4 className="section-title mb-4">Working hours</h4>
        <div className="grid grid-cols-1 gap-y-5">
          <div className="flex min-w-0 flex-col gap-2">
            <span id="growth-days-label" className={LABEL}>Working days</span>
            <div role="group" aria-labelledby="growth-days-label" aria-describedby={errors.days ? 'growth-days-error' : undefined} className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((d) => {
                const on = hours.days.includes(d.iso)
                return (
                  <button
                    key={d.iso}
                    type="button"
                    aria-pressed={on}
                    aria-label={d.long}
                    onClick={() => toggleDay(d.iso)}
                    className={classNames(
                      'pressable inline-flex h-8 min-w-11 items-center justify-center rounded-md border px-2 text-xs font-medium pointer-coarse:h-11 pointer-coarse:min-w-12',
                      on
                        ? 'border-brand-500/40 bg-brand-500/12 text-brand-700 dark:text-brand-300'
                        : 'border-ink-500 text-ink-300 hover:border-ink-400 hover:text-ink-50',
                    )}
                  >
                    {d.short}
                  </button>
                )
              })}
            </div>
            <FieldError id="growth-days-error" error={errors.days} />
          </div>

          <div className="grid grid-cols-2 gap-x-5 gap-y-5 sm:grid-cols-[8.5rem_8.5rem_minmax(0,1fr)]">
            <FormField label="Opens">
              {(p) => (
                <input
                  {...p} type="time" className={classNames('input w-full tabular-nums', INPUT_INVALID)}
                  aria-invalid={errors.time ? true : undefined} value={hours.start}
                  onChange={(e) => { setHours((h) => ({ ...h, start: e.target.value })); clear('time') }}
                />
              )}
            </FormField>
            <FormField label="Closes">
              {(p) => (
                <input
                  {...p} type="time" className={classNames('input w-full tabular-nums', INPUT_INVALID)}
                  aria-invalid={errors.time ? true : undefined} value={hours.end}
                  onChange={(e) => { setHours((h) => ({ ...h, end: e.target.value })); clear('time') }}
                />
              )}
            </FormField>
            <FormField label="Time zone" error={errors.tz} className="max-sm:col-span-2">
              {(p) => (
                <select
                  {...p} className={classNames('input w-full', INPUT_INVALID)} value={hours.tz}
                  onChange={(e) => { setHours((h) => ({ ...h, tz: e.target.value })); clear('tz') }}
                >
                  {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
                </select>
              )}
            </FormField>
            <FieldError error={errors.time} className="col-span-full -mt-3" />
          </div>
        </div>
      </div>
      <FieldError error={errors.form} className="mt-4" />
    </Panel>
  )
}

// ─── Lead owners ────────────────────────────────────────────────────────────

const ROW_ICON = 'pressable tap-target shrink-0 rounded-md p-1.5 text-ink-400 hover:bg-ink-700 hover:text-ink-50 disabled:opacity-35 disabled:hover:bg-transparent'

function OwnersPanel({ ws, save, users }: { ws: WorkspaceSettings; save: Save; users: User[] }) {
  const byId = useMemo(() => new Map(users.map((u) => [u.id, u])), [users])
  // People who have left drop out of the draft, as they do on the server.
  const [pool, setPool] = useState(() => ws.growthOwnerPool.filter((id) => byId.has(id) && !byId.get(id)?.deactivatedAt))
  const [pick, setPick] = useState('')
  const [error, setError] = useState<string | null>(null)

  // An owner has to be able to work the lead, so only Growth editors are offered.
  const candidates = useMemo(
    () => activeUsers(users)
      .filter((u) => can(u, 'growth', 'edit') && !pool.includes(u.id))
      .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [users, pool],
  )
  const full = pool.length >= 50
  // Against the same list the draft started from (the saved pool, minus people who left).
  const dirty = pool.join() !== ws.growthOwnerPool.filter((id) => byId.has(id) && !byId.get(id)?.deactivatedAt).join()

  const move = (i: number, by: -1 | 1) => {
    setPool((p) => {
      const j = i + by
      if (j < 0 || j >= p.length) return p
      const next = [...p]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
    setError(null)
  }
  const add = () => {
    if (!pick || full) return
    setPool((p) => (p.includes(pick) ? p : [...p, pick]))
    setPick('')
    setError(null)
  }
  const submit = () => {
    if (save({ growthOwnerPool: pool })) {
      setError(null)
      toast.success('Lead owners saved')
    } else setError(NOT_SAVED)
  }

  return (
    <Panel
      title="Lead owners"
      icon={UsersThreeIcon}
      dirty={dirty}
      description="New website leads go to these people in turn, top to bottom. With nobody listed, admins take them."
      footer={<button type="button" className="btn-primary" onClick={submit}>Save lead owners</button>}
    >
      {pool.length === 0 ? (
        <p className="rounded-lg border border-dashed border-ink-500 px-4 py-5 text-center text-sm text-ink-300">
          Nobody in the rotation. Admins take new leads in turn.
        </p>
      ) : (
        <ol className="divide-y divide-ink-600 rounded-lg border border-ink-600">
          {pool.map((id, i) => {
            const u = byId.get(id)
            const name = u?.fullName ?? 'Unknown person'
            const lost = !u || !can(u, 'growth', 'edit')
            return (
              <li key={id} className="flex min-w-0 items-center gap-3 px-3 py-2">
                <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-ink-400">{i + 1}</span>
                <Avatar name={name} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-ink-50" title={name}>{name}</div>
                  {lost && <div className="truncate text-xs text-amber-700 dark:text-amber-400">Cannot edit Growth any more</div>}
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button type="button" className={ROW_ICON} disabled={i === 0} aria-label={`Move ${name} up`} title="Move up" onClick={() => move(i, -1)}>
                    <ArrowUpIcon size={16} aria-hidden />
                  </button>
                  <button type="button" className={ROW_ICON} disabled={i === pool.length - 1} aria-label={`Move ${name} down`} title="Move down" onClick={() => move(i, 1)}>
                    <ArrowDownIcon size={16} aria-hidden />
                  </button>
                  <button
                    type="button" className={classNames(ROW_ICON, 'hover:text-rose-600 dark:hover:text-rose-400')}
                    aria-label={`Remove ${name}`} title="Remove"
                    onClick={() => { setPool((p) => p.filter((x) => x !== id)); setError(null) }}
                  >
                    <XIcon size={16} aria-hidden />
                  </button>
                </div>
              </li>
            )
          })}
        </ol>
      )}

      <FormField
        className="mt-4"
        label="Add a person"
        hint={
          full
            ? 'The rotation holds 50 people at most.'
            : candidates.length === 0
              ? 'Everyone who can edit Growth is already listed.'
              : 'Only people who can edit Growth are offered.'
        }
      >
        {(p) => (
          <div className="flex gap-2">
            <select
              {...p} className="input min-w-0 flex-1 sm:max-w-xs" value={pick}
              disabled={full || candidates.length === 0}
              onChange={(e) => setPick(e.target.value)}
            >
              <option value="">Choose…</option>
              {candidates.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
            </select>
            <button type="button" className="btn-secondary shrink-0 pointer-coarse:min-h-11" disabled={!pick || full} onClick={add}>
              <PlusIcon size={14} aria-hidden /> Add
            </button>
          </div>
        )}
      </FormField>
      <FieldError error={error} className="mt-4" />
    </Panel>
  )
}

// ─── Website replies ────────────────────────────────────────────────────────

function RepliesPanel({ ws, save, flip }: { ws: WorkspaceSettings; save: Save; flip: Save }) {
  const [url, setUrl] = useState(ws.growthBookingUrl ?? '')
  const [error, setError] = useState<string | undefined>()

  const submit = () => {
    const trimmed = url.trim()
    if (trimmed && (!HTTPS_URL.test(trimmed) || trimmed.length > 2048)) {
      setError(trimmed.length > 2048 ? 'That address is too long (2,048 characters at most)' : 'Enter a full address that starts with https://')
      focusFirstInvalid()
      return
    }
    if (save({ growthBookingUrl: trimmed })) {
      setUrl(trimmed)
      toast.success(trimmed ? 'Booking link saved' : 'Booking link removed')
    } else setError(NOT_SAVED)
  }

  return (
    <Panel
      title="Website replies"
      icon={PaperPlaneTiltIcon}
      iconTone={ws.growthAutoReply ? 'brand' : 'neutral'}
      dirty={url.trim() !== (ws.growthBookingUrl ?? '')}
      footer={<button type="button" className="btn-primary" onClick={submit}>Save booking link</button>}
    >
      <div className="space-y-5">
        <SwitchRow
          title="Automatic reply"
          hint="Email each new website lead straight away to say the message arrived."
          on={ws.growthAutoReply}
          onChange={(v) => flip({ growthAutoReply: v })}
        />
        <div className="border-t border-ink-600 pt-5">
          <FormField
            label="Booking link"
            hint="Where a lead can book a call. It goes in the automatic reply. Leave empty for none."
            error={error}
            className="max-w-xl"
          >
            {(p) => (
              <input
                {...p} type="url" inputMode="url" autoComplete="off" spellCheck={false} maxLength={2048}
                className={classNames('input w-full', INPUT_INVALID)} placeholder="https://"
                value={url}
                onChange={(e) => { setUrl(e.target.value); if (error) setError(undefined) }}
              />
            )}
          </FormField>
        </div>
      </div>
    </Panel>
  )
}

// ─── Pipeline ───────────────────────────────────────────────────────────────

function PipelinePanel({ ws, save, flip }: { ws: WorkspaceSettings; save: Save; flip: Save }) {
  const [stale, setStale] = useState(String(ws.growthStaleDays))
  const [target, setTarget] = useState(ws.growthMonthlyClientTarget === undefined ? '' : String(ws.growthMonthlyClientTarget))
  const [errors, setErrors] = useState<{ stale?: string; target?: string; form?: string }>({})

  const submit = () => {
    const staleN = whole(stale)
    const targetN = target.trim() === '' ? undefined : whole(target)
    const next: typeof errors = {
      stale: rangeError(staleN, 1, 365),
      target: targetN === undefined ? undefined : rangeError(targetN, 0, 10000),
    }
    setErrors(next)
    if (next.stale || next.target) {
      focusFirstInvalid()
      return
    }
    const ok = save({ growthStaleDays: staleN as number, growthMonthlyClientTarget: targetN ?? undefined })
    if (ok) {
      // Show what was stored ("07" is 7), so the form reads as saved.
      setStale(String(staleN))
      setTarget(targetN === undefined || targetN === null ? '' : String(targetN))
      toast.success('Pipeline settings saved')
    } else setErrors({ form: NOT_SAVED })
  }

  const dirty =
    stale !== String(ws.growthStaleDays) ||
    target.trim() !== (ws.growthMonthlyClientTarget === undefined ? '' : String(ws.growthMonthlyClientTarget))

  return (
    <Panel
      title="Pipeline"
      icon={TargetIcon}
      dirty={dirty}
      description="Used by the Growth Hub: the monthly goal and the going-cold list."
      footer={<button type="button" className="btn-primary" onClick={submit}>Save pipeline</button>}
    >
      <div className="grid grid-cols-1 gap-x-5 gap-y-5 sm:grid-cols-2">
        <FormField label="Lead goes cold after (days)" hint="Open leads nobody has touched for this long get flagged. 1 to 365." error={errors.stale}>
          {(p) => (
            <input
              {...p} type="text" inputMode="numeric" autoComplete="off" maxLength={3}
              className={classNames(NUMBER, INPUT_INVALID)} value={stale}
              onChange={(e) => { setStale(e.target.value); setErrors((er) => ({ ...er, stale: undefined, form: undefined })) }}
            />
          )}
        </FormField>
        <FormField label="Monthly client target" hint="New clients to win each month. Leave empty for no target." error={errors.target}>
          {(p) => (
            <input
              {...p} type="text" inputMode="numeric" autoComplete="off" maxLength={5}
              className={classNames(NUMBER, INPUT_INVALID)} value={target}
              onChange={(e) => { setTarget(e.target.value); setErrors((er) => ({ ...er, target: undefined, form: undefined })) }}
            />
          )}
        </FormField>
      </div>
      <div className="mt-6 border-t border-ink-600 pt-5">
        <SwitchRow
          title="Tell every Growth editor about a new lead"
          hint="Off: only the lead's owner is notified."
          on={ws.growthNotifyAll}
          onChange={(v) => flip({ growthNotifyAll: v })}
        />
      </div>
      <FieldError error={errors.form} className="mt-4" />
    </Panel>
  )
}

// ─── Retention (read-only) ──────────────────────────────────────────────────

const RETENTION: { what: string; then: string; after: string }[] = [
  { what: 'Quarantined leads', then: 'Deleted', after: RETENTION_WINDOWS.spam_leads },
  { what: 'Lost leads', then: 'Personal details removed', after: RETENTION_WINDOWS.lost_lead_pii },
  { what: 'Notifications', then: 'Deleted', after: RETENTION_WINDOWS.notifications },
  { what: 'Sign-up attempt records', then: 'Cleared', after: RETENTION_WINDOWS.subscriber_attempts },
]

function RetentionPanel() {
  return (
    <Panel
      title="Data retention"
      icon={ClockCounterClockwiseIcon}
      description="Set by the database and stated in the privacy policy. Shown here for reference; they cannot be changed from this screen."
      bodyClassName="pb-2 pt-3"
    >
      <dl className="divide-y divide-ink-600">
        {RETENTION.map((r) => (
          <div key={r.what} className="flex items-baseline justify-between gap-4 py-3">
            <dt className="min-w-0 text-sm text-ink-50">
              {r.what}
              <span className="block text-xs text-ink-300">{r.then}</span>
            </dt>
            <dd className="shrink-0 text-sm tabular-nums text-ink-100">after {r.after}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  )
}

// ─── Section ────────────────────────────────────────────────────────────────

function PanelSkeleton({ fields }: { fields: number }) {
  return (
    <div className="card space-y-5 p-5" aria-hidden>
      <div className="flex items-center gap-4">
        <Skeleton w={40} h={40} rounded="lg" />
        <div className="flex-1 space-y-2"><Skeleton w="32%" h={14} /><Skeleton w="64%" h={12} /></div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i} className="space-y-2"><Skeleton w="45%" h={12} /><Skeleton h={36} /></div>
        ))}
      </div>
    </div>
  )
}

export default function GrowthSection() {
  const loading = !useStore((s) => s.hydrated)
  const ws = useStore((s) => s.workspaceSettings)
  const users = useStore((s) => s.users)
  const updateWorkspaceSettings = useStore((s) => s.updateWorkspaceSettings)
  // Remote mode on a database without 033 yet: saves stay in this browser.
  const localOnly = isSupabaseConfigured && isTableMissing('workspace_settings')

  if (loading) {
    return (
      <div className="space-y-5" aria-busy="true">
        <PanelSkeleton fields={4} />
        <PanelSkeleton fields={2} />
        <PanelSkeleton fields={2} />
      </div>
    )
  }

  const save: Save = (patch) => updateWorkspaceSettings(patch)
  // A switch applies at once; if the store refuses, say why instead of silently snapping back.
  const flip: Save = (patch) => {
    const ok = updateWorkspaceSettings(patch)
    if (!ok) toast.error(NOT_SAVED)
    return ok
  }

  return (
    <div className="space-y-5">
      {localOnly && (
        <Notice tone="warn" icon={CloudSlashIcon}>
          Workspace settings are not set up on the server yet. Changes are kept in this browser only until the database update is applied.
        </Notice>
      )}

      <ReplyPanel ws={ws} save={save} />
      <OwnersPanel ws={ws} save={save} users={users} />
      <RepliesPanel ws={ws} save={save} flip={flip} />
      {/* The website's own booking page (048): saved on its own. */}
      <BookingSection />
      <PipelinePanel ws={ws} save={save} flip={flip} />

      <Panel
        title="Showcase"
        icon={ImagesIcon}
        iconTone={ws.showcaseAutoPublish ? 'brand' : 'neutral'}
        description={
          <>
            <p>
              Automatic publishing. When a finished project has the client’s consent, it is filed as ready, and it goes live
              once its link check passes.
            </p>
            <p className="mt-1">The link check does not run on its own yet, so for now an admin publishes each item by hand.</p>
          </>
        }
        aside={<Switch on={ws.showcaseAutoPublish} onChange={(v) => flip({ showcaseAutoPublish: v })} label="Automatic publishing" />}
      />

      <RetentionPanel />
      <Stamp at={ws.updatedAt} by={users.find((u) => u.id === ws.updatedBy)?.fullName} />
    </div>
  )
}
