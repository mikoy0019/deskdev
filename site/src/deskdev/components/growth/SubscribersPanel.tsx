import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowCounterClockwiseIcon, DownloadSimpleIcon, EnvelopeSimpleIcon, MagnifyingGlassIcon, ProhibitIcon, TrashIcon, WarningCircleIcon,
} from '@phosphor-icons/react'
import ConfirmDialog from '../ConfirmDialog'
import EmptyState from '../EmptyState'
import { SkeletonLine } from '../ui-foundation'
import { useStagger } from '../motion'
import { Notice, useHeldWhile } from '../settings/formKit'
import { useStore, useCurrentUser } from '../../store/useStore'
import { can } from '../../lib/permissions'
import { isTableMissing } from '../../lib/db'
import { isSupabaseConfigured } from '../../lib/supabase'
import { classNames, fmtDate } from '../../lib/format'
import type { SiteSubscriber } from '../../lib/types'
import { InlineEmpty } from './shared'
import Segmented from './ReportsSegmented'
import { subscribersCsv } from './ReportsMath'

type Filter = 'all' | 'subscribed' | 'unsubscribed'
type ConfirmKind = 'unsubscribe' | 'resubscribe' | 'delete'

/** The confirm dialog's wording, and what to say after, per row action. */
const CONFIRM: Record<ConfirmKind, {
  title: string
  message: (email: string) => string
  confirmLabel: string
  done: string
  failed: string
}> = {
  unsubscribe: {
    title: 'Unsubscribe this address?',
    message: (email) => `${email} stops receiving updates. The address stays on the list as unsubscribed, so it cannot be signed up again by mistake.`,
    confirmLabel: 'Unsubscribe',
    done: 'Unsubscribed',
    failed: 'was not unsubscribed',
  },
  resubscribe: {
    title: 'Subscribe this address again?',
    message: (email) => `${email} starts receiving updates again. Only do this when the person asked for it.`,
    confirmLabel: 'Subscribe again',
    done: 'Subscribed again',
    failed: 'was not subscribed again',
  },
  delete: {
    title: 'Delete this address?',
    message: (email) => `${email} is removed from the list for good. Use this when the person asks for their data to be deleted.`,
    confirmLabel: 'Delete address',
    done: 'Address deleted',
    failed: 'was not deleted',
  },
}

/** Rows drawn at once; a long list grows by this much per "Show more". */
const PAGE = 100

/** Small row action: 28px for a mouse, 44px under a finger. */
const ROW_ICON = 'pressable tap-target shrink-0 rounded-md p-1.5 text-ink-400 hover:bg-ink-700'

// One grid for the header and every row, so the columns line up exactly.
const COLS_EDIT = 'sm:grid sm:grid-cols-[minmax(0,1fr)_6.5rem_7rem_7rem_4rem] sm:items-center sm:gap-4'
const COLS_VIEW = 'sm:grid sm:grid-cols-[minmax(0,1fr)_6.5rem_7rem_7rem] sm:items-center sm:gap-4'

function StatusBadge({ sub }: { sub: SiteSubscriber }) {
  return sub.unsubscribedAt ? (
    <span className="badge badge-neutral" title={`Unsubscribed ${fmtDate(sub.unsubscribedAt)}`}>Unsubscribed</span>
  ) : (
    <span className="badge badge-success">Subscribed</span>
  )
}

/** Hand the browser a file built on this device. Nothing is uploaded. */
function downloadCsv(name: string, csv: string): boolean {
  try {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Safari reads the blob after the click returns; revoke on the next tick.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return true
  } catch {
    return false
  }
}

/**
 * Growth Hub → Subscribers: the addresses from the website sign-up box.
 * growth:view reads the list; growth:edit can unsubscribe someone, put them
 * back when they ask, delete an address on request and export the list. There is no way to add an address
 * here: only the person can sign themselves up.
 */
export default function SubscribersPanel() {
  const user = useCurrentUser()
  const canEdit = can(user, 'growth', 'edit')
  const loading = !useStore((s) => s.hydrated)
  const subscribers = useStore((s) => s.siteSubscribers)
  const unsubscribeSubscriber = useStore((s) => s.unsubscribeSubscriber)
  const resubscribeSubscriber = useStore((s) => s.resubscribeSubscriber)
  const deleteSubscriber = useStore((s) => s.deleteSubscriber)
  // Remote mode on a database without 039 yet: say so instead of "no subscribers".
  const notSetUp = isSupabaseConfigured && isTableMissing('site_subscribers')

  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [confirm, setConfirm] = useState<{ kind: ConfirmKind; sub: SiteSubscriber } | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The dialog keeps its wording while it fades out.
  const held = useHeldWhile(confirm, confirm !== null)
  const { ref: attachStagger, className: staggerClass } = useStagger<HTMLUListElement>('growth-subscribers')

  const sorted = useMemo(
    () => [...subscribers].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [subscribers],
  )
  const counts = useMemo(() => {
    const off = subscribers.filter((s) => s.unsubscribedAt).length
    return { all: subscribers.length, subscribed: subscribers.length - off, unsubscribed: off }
  }, [subscribers])
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return sorted.filter((s) => {
      if (filter === 'subscribed' && s.unsubscribedAt) return false
      if (filter === 'unsubscribed' && !s.unsubscribedAt) return false
      return !q || s.email.toLowerCase().includes(q) || (s.source ?? '').toLowerCase().includes(q)
    })
  }, [sorted, filter, query])

  const exportCsv = () => {
    setError(null)
    const day = new Date().toISOString().slice(0, 10)
    if (downloadCsv(`subscribers-${day}.csv`, subscribersCsv(matches))) {
      toast.success(`Exported ${matches.length.toLocaleString('en-US')} ${matches.length === 1 ? 'address' : 'addresses'}`)
    } else setError('The file could not be saved on this device. Try another browser.')
  }

  const act = () => {
    if (!confirm) return
    const { kind, sub } = confirm
    const run = { delete: deleteSubscriber, unsubscribe: unsubscribeSubscriber, resubscribe: resubscribeSubscriber }[kind]
    if (run(sub.id)) {
      setError(null)
      toast.success(CONFIRM[kind].done)
    } else {
      setError(`${sub.email} ${CONFIRM[kind].failed}. You need edit access to Growth, or the address is already gone.`)
    }
  }

  if (loading) {
    return (
      <div className="card overflow-hidden" aria-busy="true">
        <div className="divide-y divide-ink-600" aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-(--card-p) py-3.5">
              <SkeletonLine w={`${38 + ((i * 13) % 24)}%`} className="h-3.5" />
              <span className="flex-1" />
              <SkeletonLine w={64} className="h-3 max-sm:hidden" />
              <SkeletonLine w={84} className="h-5" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (notSetUp) {
    return (
      <EmptyState
        icon={EnvelopeSimpleIcon}
        title="Subscribers are not set up yet"
        description="The list appears here once the database update for the sign-up box has been applied."
      />
    )
  }

  if (subscribers.length === 0) {
    return (
      <EmptyState
        icon={EnvelopeSimpleIcon}
        title="No subscribers yet"
        description="Addresses from the sign-up box on the website appear here. People add themselves; there is no way to add one by hand."
      />
    )
  }

  const cols = canEdit ? COLS_EDIT : COLS_VIEW
  const visible = matches.slice(0, shown)

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <Segmented
          id="growth-subscribers-filter"
          label="Filter subscribers"
          value={filter}
          onChange={(f) => { setFilter(f); setShown(PAGE) }}
          options={[
            { key: 'all', label: 'All', count: counts.all },
            { key: 'subscribed', label: 'Subscribed', count: counts.subscribed },
            { key: 'unsubscribed', label: 'Unsubscribed', count: counts.unsubscribed },
          ]}
          className="max-sm:flex"
        />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <MagnifyingGlassIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" aria-hidden />
            <input
              type="search"
              className="input w-full pl-9 pointer-coarse:min-h-11"
              placeholder="Search address or source…"
              aria-label="Search subscribers"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setShown(PAGE) }}
            />
          </div>
          {canEdit && (
            <button
              type="button"
              className="btn-secondary shrink-0 pointer-coarse:min-h-11"
              disabled={matches.length === 0}
              onClick={exportCsv}
              title="Download the addresses shown as a CSV file"
            >
              <DownloadSimpleIcon size={14} aria-hidden /> <span>Export<span className="max-sm:sr-only"> CSV</span></span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <Notice tone="danger" icon={WarningCircleIcon} live>
          {error}
        </Notice>
      )}

      <div className="card overflow-hidden">
        {matches.length === 0 ? (
          <InlineEmpty
            title="No address matches"
            description="Try a different search, or show every subscriber."
            action={
              <button type="button" className="btn-secondary pointer-coarse:min-h-11" onClick={() => { setQuery(''); setFilter('all') }}>
                Clear filters
              </button>
            }
          />
        ) : (
          <>
            <div className={classNames('border-b border-ink-600 bg-ink-900/50 px-(--card-p) py-2 max-sm:hidden', cols)} aria-hidden>
              <span className="section-title">Address</span>
              <span className="section-title">Source</span>
              <span className="section-title">Signed up</span>
              <span className="section-title">Status</span>
              {canEdit && <span />}
            </div>
            <ul ref={attachStagger} className={classNames('divide-y divide-ink-600', staggerClass)}>
              {visible.map((sub) => {
                const signedUp = fmtDate(sub.consentAt ?? sub.createdAt)
                return (
                  <li key={sub.id} className={classNames('flex min-w-0 items-center gap-3 px-(--card-p) py-2.5', cols)}>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-ink-50" title={sub.email}>{sub.email}</div>
                      <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-ink-300 sm:hidden">
                        <StatusBadge sub={sub} />
                        <span className="truncate tabular-nums">{[sub.source, signedUp].filter(Boolean).join(' · ')}</span>
                      </div>
                    </div>
                    <div className="truncate text-xs text-ink-300 max-sm:hidden" title={sub.source}>{sub.source || '—'}</div>
                    <div className="text-xs tabular-nums text-ink-300 max-sm:hidden">{signedUp}</div>
                    <div className="max-sm:hidden"><StatusBadge sub={sub} /></div>
                    {canEdit && (
                      <div className="flex shrink-0 justify-end gap-1">
                        {sub.unsubscribedAt ? (
                          <button
                            type="button"
                            className={classNames(ROW_ICON, 'hover:text-ink-50')}
                            title="Subscribe again"
                            aria-label={`Subscribe ${sub.email} again`}
                            onClick={() => setConfirm({ kind: 'resubscribe', sub })}
                          >
                            <ArrowCounterClockwiseIcon size={16} aria-hidden />
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={classNames(ROW_ICON, 'hover:text-amber-700 dark:hover:text-amber-400')}
                            title="Unsubscribe"
                            aria-label={`Unsubscribe ${sub.email}`}
                            onClick={() => setConfirm({ kind: 'unsubscribe', sub })}
                          >
                            <ProhibitIcon size={16} aria-hidden />
                          </button>
                        )}
                        <button
                          type="button"
                          className={classNames(ROW_ICON, 'hover:text-rose-600 dark:hover:text-rose-400')}
                          title="Delete"
                          aria-label={`Delete ${sub.email}`}
                          onClick={() => setConfirm({ kind: 'delete', sub })}
                        >
                          <TrashIcon size={16} aria-hidden />
                        </button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
            {matches.length > visible.length && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-600 bg-ink-900/50 px-(--card-p) py-2.5">
                <span className="text-xs tabular-nums text-ink-300">
                  {visible.length.toLocaleString('en-US')} of {matches.length.toLocaleString('en-US')}
                </span>
                <button type="button" className="btn-ghost text-xs pointer-coarse:min-h-11" onClick={() => setShown((n) => n + PAGE)}>
                  Show more
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirm !== null}
        danger={held?.kind === 'delete'}
        title={held ? CONFIRM[held.kind].title : ''}
        message={held ? CONFIRM[held.kind].message(held.sub.email) : ''}
        confirmLabel={held ? CONFIRM[held.kind].confirmLabel : undefined}
        onConfirm={act}
        onClose={() => setConfirm(null)}
      />
    </div>
  )
}
