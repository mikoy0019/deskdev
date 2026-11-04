import { useEffect, useMemo, useRef, useState } from 'react'
import { UsersThreeIcon, XIcon } from '@phosphor-icons/react'
import Avatar from '../Avatar'
import { OverlayRoot, Presence, Scrim, SheetPanel, StatusDot } from '../motion'
import { useStore, useCurrentUser } from '../../store/useStore'
import { groupPeople, type PresenceStatus } from '../../lib/presence'
import { isSupabaseConfigured } from '../../lib/supabase'
import { classNames } from '../../lib/format'
import type { User } from '../../lib/types'
import { usePresence } from './usePresence'

/**
 * The bottom of the right rail (revision 7): a people icon with how many are
 * active now. It opens a panel over the rail listing everyone, active (their
 * picture ringed in a soft green), away, and offline.
 */
export function PeopleRailButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const users = useStore((s) => s.users)
  const me = useCurrentUser()
  const online = usePresence((s) => s.online)
  const people = useMemo(() => groupPeople(users, online, me?.id), [users, online, me?.id])
  const active = people.active.length

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`People: ${active} active now`}
        title="People"
        onClick={() => setOpen(true)}
        className={classNames(
          'pressable relative flex size-12 items-center justify-center rounded-full bg-ink-800 text-ink-200 shadow-[inset_0_0_0_1px_rgb(var(--ink-600))]',
          'hover:bg-ink-700 hover:text-ink-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-850',
          className,
        )}
      >
        <UsersThreeIcon size={20} aria-hidden />
        <span
          className="badge badge-success absolute -bottom-1 left-1/2 -translate-x-1/2 min-w-[22px] justify-center px-1 py-0 text-[10px] leading-4 tabular-nums"
          aria-hidden
        >
          {active > 99 ? '99+' : active}
        </span>
      </button>
      <PeoplePanel open={open} onClose={() => { setOpen(false); triggerRef.current?.focus({ preventScroll: true }) }} />
    </>
  )
}

function PeoplePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const users = useStore((s) => s.users)
  const me = useCurrentUser()
  const { online, live } = usePresence()
  const people = useMemo(() => groupPeople(users, online, me?.id), [users, online, me?.id])
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('[aria-label="User actions"], [aria-label="User properties"]')) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  return (
    <Presence>
      {open && (
        <OverlayRoot key="people" className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="people-title">
          <Scrim onClick={onClose} />
          <SheetPanel
            edge="right"
            onDismiss={onClose}
            className="absolute inset-y-0 right-0 flex w-80 max-w-[85vw] flex-col border-l border-ink-600 bg-ink-850 pr-(--safe-right) shadow-(--shadow-3)"
          >
            <header className="flex items-start gap-3 border-b border-ink-600 px-4 pb-3 pt-4">
              <div className="min-w-0 flex-1">
                <h2 id="people-title" className="text-display text-base font-semibold text-ink-50">People</h2>
                <p className="mt-0.5 text-xs tabular-nums text-ink-300">
                  {people.active.length} active · {people.away.length} away · {people.offline.length} offline
                </p>
              </div>
              <button ref={closeRef} type="button" className="btn-ghost tap-target -mr-1.5 p-1.5 text-ink-300" aria-label="Close" onClick={onClose}>
                <XIcon size={16} aria-hidden />
              </button>
            </header>

            {isSupabaseConfigured && !live && (
              <p className="mx-4 mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-ink-100">
                Live status isn’t reaching this tab right now, so everyone shows as offline. It returns on its own when the connection does.
              </p>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-3">
              <Group title="Active now" people={people.active} status="active" meId={me?.id} />
              <Group title="Away" people={people.away} status="away" meId={me?.id} />
              <Group title="Offline" people={people.offline} meId={me?.id} />
            </div>
          </SheetPanel>
        </OverlayRoot>
      )}
    </Presence>
  )
}

function Group({ title, people, status, meId }: { title: string; people: User[]; status?: PresenceStatus; meId?: string }) {
  if (people.length === 0) return null
  return (
    <section className="mb-3" aria-label={title}>
      <h3 className="section-title px-2 pb-1.5">
        {title} <span className="tabular-nums text-ink-400">{people.length}</span>
      </h3>
      <ul>
        {people.map((u) => (
          <li key={u.id}>
          <button type="button" data-person-id={u.id} aria-label={`User actions: ${u.fullName}`} className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-ink-700">
            <span
              className={classNames(
                'relative shrink-0 rounded-full',
                // The "glowing green" of the revision: a ring and a soft halo, still.
                status === 'active' && 'ring-2 ring-emerald-500 shadow-[0_0_0_3px_rgb(16_185_129/0.18),0_0_12px_rgb(16_185_129/0.45)]',
                status === 'away' && 'ring-2 ring-amber-500/70',
                !status && 'opacity-60',
              )}
            >
              <Avatar name={u.fullName} color={u.avatarColor} size="md" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-ink-50">
                {u.fullName}
                {u.id === meId && <span className="text-ink-300"> (you)</span>}
              </span>
              <span className="block truncate text-[11px] capitalize text-ink-300">{u.title || u.role}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-ink-300">
              <StatusDot tone={status === 'active' ? 'online' : status === 'away' ? 'away' : 'offline'} />
              {status === 'active' ? 'Active' : status === 'away' ? 'Away' : 'Offline'}
            </span>
          </button></li>
        ))}
      </ul>
    </section>
  )
}
