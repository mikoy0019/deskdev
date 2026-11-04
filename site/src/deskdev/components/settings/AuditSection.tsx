import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowsClockwiseIcon, ClockCounterClockwiseIcon, ListMagnifyingGlassIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { Skeleton } from '../motion'
import { Notice, Panel, radioKeys } from './formKit'
import { useStore } from '../../store/useStore'
import { isSupabaseConfigured } from '../../lib/supabase'
import { classNames, fmtDate, fmtTime } from '../../lib/format'
import {
  AUDIT_GROUPS, auditActor, auditDetail, auditGroup, auditIsSensitive, auditLabel, auditTarget, type AuditGroup,
} from './auditLabels'

type Filter = 'all' | AuditGroup

type Load =
  | { state: 'loading' }
  | { state: 'ready'; hasMore: boolean }
  | { state: 'unavailable' }
  | { state: 'error'; error: string }

/** Admin-only: who changed what. Read-only, newest first, paged 100 at a time. */
export default function AuditSection() {
  const entries = useStore((s) => s.auditLog)
  const users = useStore((s) => s.users)
  const loadAuditLog = useStore((s) => s.loadAuditLog)

  // Local mode keeps its rows in the store, so there is nothing to wait for.
  const [load, setLoad] = useState<Load>(isSupabaseConfigured ? { state: 'loading' } : { state: 'ready', hasMore: false })
  const [busy, setBusy] = useState<'refresh' | 'more' | null>(null)
  const [moreError, setMoreError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  const settle = useCallback((res: Awaited<ReturnType<typeof loadAuditLog>>) => {
    if (!res.ok) setLoad({ state: 'error', error: res.error ?? 'Could not load the audit log' })
    else if (res.unavailable) setLoad({ state: 'unavailable' })
    else setLoad({ state: 'ready', hasMore: res.hasMore })
  }, [])

  useEffect(() => {
    let cancelled = false
    void loadAuditLog().then((res) => {
      if (!cancelled) settle(res)
    })
    return () => {
      cancelled = true
    }
  }, [loadAuditLog, settle])

  const refresh = async () => {
    setBusy('refresh')
    setMoreError(null)
    settle(await loadAuditLog())
    setBusy(null)
  }

  const loadMore = async () => {
    setBusy('more')
    setMoreError(null)
    const res = await loadAuditLog({ more: true })
    setBusy(null)
    // The rows already on screen stay; only the paging failed.
    if (!res.ok) setMoreError(res.error ?? 'Could not load older entries')
    else setLoad({ state: 'ready', hasMore: res.hasMore })
  }

  const nameOf = useMemo(() => {
    const names = new Map(users.map((u) => [u.id, u.fullName]))
    return (id: string) => names.get(id)
  }, [users])

  // Only the groups that have rows get a filter, so the bar never offers an empty list.
  const groups = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of entries) counts.set(auditGroup(e.action), (counts.get(auditGroup(e.action)) ?? 0) + 1)
    return AUDIT_GROUPS.filter((g) => counts.has(g.id)).map((g) => ({ ...g, count: counts.get(g.id) ?? 0 }))
  }, [entries])

  const activeFilter: Filter = filter !== 'all' && !groups.some((g) => g.id === filter) ? 'all' : filter
  const shown = useMemo(
    () => (activeFilter === 'all' ? entries : entries.filter((e) => auditGroup(e.action) === activeFilter)),
    [entries, activeFilter],
  )

  let body
  if (load.state === 'loading') {
    body = (
      <div className="-mx-5 divide-y divide-ink-600 border-t border-ink-600" aria-busy="true" aria-label="Loading the audit log">
        {[52, 38, 60, 44, 56, 40].map((w, i) => (
          <div key={i} className="grid gap-x-5 gap-y-2 px-5 py-3.5 sm:grid-cols-[11rem_minmax(0,1fr)_9rem]">
            <Skeleton w={96} h={11} className="max-sm:order-last" />
            <div className="space-y-2">
              <Skeleton w={`${w}%`} h={13} />
              <Skeleton w={`${w - 18}%`} h={10} />
            </div>
            <Skeleton w={84} h={11} className="max-sm:hidden sm:justify-self-end" />
          </div>
        ))}
      </div>
    )
  } else if (load.state === 'unavailable') {
    body = (
      <Notice tone="info" icon={ListMagnifyingGlassIcon}>
        The audit log is not set up yet. Apply supabase/migrations/032_account_lifecycle.sql.
      </Notice>
    )
  } else if (load.state === 'error') {
    body = (
      <Notice
        tone="danger"
        icon={WarningCircleIcon}
        live
        action={
          <button type="button" className="btn-secondary -my-1 shrink-0 py-1.5 pointer-coarse:min-h-11" disabled={busy !== null} onClick={() => void refresh()}>
            Retry
          </button>
        }
      >
        {load.error}
      </Notice>
    )
  } else if (entries.length === 0) {
    body = (
      <div className="flex flex-col items-center px-4 pb-6 pt-8 text-center">
        <div
          className="flex size-14 items-center justify-center rounded-xl border border-ink-600 bg-ink-800 text-ink-300 shadow-(--shadow-2) dark:bg-ink-700/60"
          aria-hidden
        >
          <ClockCounterClockwiseIcon size={24} />
        </div>
        <p className="mt-5 text-display text-base font-semibold text-ink-50">Nothing logged yet</p>
        <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-ink-300 text-pretty">
          Role and permission changes, deactivations, vault resets and Google connections are listed here as they happen.
        </p>
      </div>
    )
  } else {
    body = (
      <>
        {groups.length > 1 && (
          <div
            role="radiogroup"
            aria-label="Filter by area"
            onKeyDown={radioKeys}
            className="-mx-5 mb-4 flex gap-1.5 overflow-x-auto overscroll-x-contain px-5 pb-px [scrollbar-width:none]"
          >
            {[{ id: 'all' as Filter, label: 'All', count: entries.length }, ...groups].map((g) => {
              const on = activeFilter === g.id
              return (
                <button
                  key={g.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  tabIndex={on ? 0 : -1}
                  onClick={() => setFilter(g.id)}
                  className={classNames(
                    'chip pressable shrink-0 gap-1.5 whitespace-nowrap px-2.5 py-1 pointer-coarse:min-h-11 pointer-coarse:px-3.5',
                    on
                      ? 'border-brand-500/30 bg-brand-500/15 text-brand-700 dark:text-brand-400'
                      : 'border-ink-500 text-ink-200 hover:border-ink-400 hover:text-ink-50',
                  )}
                >
                  {g.label}
                  <span className={classNames('font-mono text-[10px] tabular-nums', on ? 'opacity-80' : 'text-ink-400')}>
                    {g.count.toLocaleString()}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        <ol className="-mx-5 divide-y divide-ink-600 border-t border-ink-600">
          {shown.map((e) => {
            const target = auditTarget(e, nameOf)
            const detail = auditDetail(e)
            const actor = auditActor(e, nameOf)
            const sensitive = auditIsSensitive(e.action)
            return (
              <li key={e.id} className="grid gap-x-5 gap-y-1 px-5 py-3 sm:grid-cols-[11rem_minmax(0,1fr)_9rem] sm:items-baseline">
                <time
                  dateTime={e.at}
                  className="font-mono text-[11px] leading-5 tabular-nums text-ink-300 max-sm:order-last max-sm:pl-3.5 sm:whitespace-nowrap"
                  title={new Date(e.at).toLocaleString()}
                >
                  {fmtDate(e.at)}
                  <span className="text-ink-400"> · </span>
                  {fmtTime(e.at)}
                  <span className="sm:hidden">
                    <span className="text-ink-400"> · </span>
                    <span className="font-sans">{actor}</span>
                  </span>
                </time>
                <div className="flex min-w-0 gap-2">
                  {/* Shape as well as colour: a ring for routine rows, a filled dot where access was removed. */}
                  <span
                    aria-hidden
                    className={classNames(
                      'mt-[7px] size-1.5 shrink-0 rounded-full',
                      sensitive ? 'bg-rose-500' : 'border border-ink-400',
                    )}
                  />
                  <div className="min-w-0">
                    <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm leading-5 [overflow-wrap:anywhere]">
                      <span className="font-medium text-ink-50">{auditLabel(e.action)}</span>
                      {target && <span className="min-w-0 text-ink-200">{target}</span>}
                    </p>
                    {detail && (
                      <p className="mt-0.5 text-xs leading-relaxed text-ink-300 [overflow-wrap:anywhere]">{detail}</p>
                    )}
                  </div>
                </div>
                <div className="truncate text-xs leading-5 text-ink-300 max-sm:hidden sm:text-right" title={actor}>
                  {actor}
                </div>
              </li>
            )
          })}
        </ol>

        {moreError && (
          <Notice tone="danger" icon={WarningCircleIcon} live className="mt-4">
            {moreError}
          </Notice>
        )}
      </>
    )
  }

  const ready = load.state === 'ready' && entries.length > 0
  return (
    <Panel
      title="Audit log"
      icon={ClockCounterClockwiseIcon}
      description="Who changed roles, access and workspace settings. Entries are written by the server and cannot be edited or deleted."
      aside={
        isSupabaseConfigured ? (
          <button
            type="button"
            className="btn-ghost tap-target -mr-2 -mt-1 shrink-0 p-2"
            disabled={busy !== null || load.state === 'loading'}
            onClick={() => void refresh()}
            aria-label="Refresh the audit log"
          >
            <ArrowsClockwiseIcon size={16} className={classNames(busy === 'refresh' && 'animate-spin')} aria-hidden />
          </button>
        ) : undefined
      }
      bodyClassName={ready ? 'pt-4' : undefined}
      footer={
        ready ? (
          <>
            <span className="mr-auto text-xs text-ink-300 tabular-nums">
              {shown.length.toLocaleString()} {shown.length === 1 ? 'entry' : 'entries'}
              {!isSupabaseConfigured && ' · local build, kept on this device'}
            </span>
            {load.state === 'ready' && load.hasMore && (
              <button type="button" className="btn-secondary pointer-coarse:min-h-11" disabled={busy !== null} onClick={() => void loadMore()}>
                {busy === 'more' ? 'Loading…' : 'Load older entries'}
              </button>
            )}
          </>
        ) : undefined
      }
    >
      {body}
    </Panel>
  )
}
