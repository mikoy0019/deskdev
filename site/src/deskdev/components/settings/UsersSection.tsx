import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowCounterClockwiseIcon, PencilSimpleIcon, ProhibitIcon, TrashIcon, UserPlusIcon, WarningCircleIcon, XIcon,
} from '@phosphor-icons/react'
import ConfirmDialog from '../ConfirmDialog'
import { RoleChip } from '../Chips'
import { useStagger } from '../motion'
import UserAvatar from './UserAvatar'
import UserModal, { FEATURE_META } from './UserModal'
import { Notice, Panel, useHeldWhile } from './formKit'
import { useStore, useCurrentUser } from '../../store/useStore'
import { isDeactivated } from '../../lib/permissions'
import { classNames, fmtDate } from '../../lib/format'
import type { PermLevel, User } from '../../lib/types'

const LEVEL_STYLES: Record<PermLevel, string> = {
  edit: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-800 dark:text-emerald-400',
  view: 'bg-amber-500/15 border-amber-500/30 text-amber-800 dark:text-amber-400',
  none: 'bg-ink-700 border-ink-600 text-ink-300',
}

const LEVEL_LABEL: Record<PermLevel, string> = { edit: 'Edit', view: 'View', none: 'None' }

/**
 * The key to the letter tiles, once above the list: what the three colours
 * mean, then what each letter stands for. Hidden from screen readers, which
 * get each row's permissions spelled out instead.
 */
function PermLegend() {
  return (
    <div
      aria-hidden
      className="-mx-5 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-ink-600 bg-ink-900/50 px-5 py-2.5 text-[11px] text-ink-300"
    >
      {/* Phones: the three levels take their own line, the letters wrap below. */}
      <span className="flex items-center gap-x-4 max-sm:basis-full">
        {(['edit', 'view', 'none'] as const).map((level) => (
          <span key={level} className="flex items-center gap-1.5">
            <span className={classNames('size-3 shrink-0 rounded-[3px] border', LEVEL_STYLES[level])} />
            {LEVEL_LABEL[level]}
          </span>
        ))}
        <span className="h-3 w-px bg-ink-600 max-sm:hidden" />
      </span>
      {FEATURE_META.map((f) => (
        <span key={f.key} className="whitespace-nowrap">
          <span className="font-mono font-semibold text-ink-200">{f.letter}</span> {f.label}
        </span>
      ))}
    </div>
  )
}

/** One letter badge per feature — green edit / amber view / gray none. */
function PermSummary({ user }: { user: User }) {
  const levels = FEATURE_META.map((f) => ({
    ...f,
    level: (user.role === 'admin' ? 'edit' : user.permissions[f.key] ?? 'none') as PermLevel,
  }))
  return (
    <div
      role="img"
      aria-label={`Permissions: ${levels.map((l) => `${l.label} ${l.level}`).join(', ')}`}
      className="flex shrink-0 items-center gap-1"
    >
      {levels.map((l) => (
        <span
          key={l.key}
          aria-hidden
          title={`${l.label}: ${LEVEL_LABEL[l.level]}`}
          className={classNames(
            'flex size-5 items-center justify-center rounded-[4px] border font-mono text-[10px] font-semibold',
            LEVEL_STYLES[l.level],
          )}
        >
          {l.letter}
        </span>
      ))}
    </div>
  )
}

const ICON_BTN = 'pressable tap-target rounded-md p-1.5 disabled:cursor-not-allowed disabled:opacity-60'
const ICON_BTN_QUIET = 'text-ink-300 hover:bg-ink-700 hover:text-ink-50'
const ICON_BTN_DANGER = 'text-ink-300 hover:bg-rose-500/10 hover:text-rose-700 dark:hover:text-rose-400'

/** Admin-only: manage workspace users + per-feature permissions. */
export default function UsersSection() {
  const me = useCurrentUser()
  const users = useStore((s) => s.users)
  const adminDeleteUser = useStore((s) => s.adminDeleteUser)
  const adminDeactivateUser = useStore((s) => s.adminDeactivateUser)
  const adminReactivateUser = useStore((s) => s.adminReactivateUser)

  const [inviteOpen, setInviteOpen] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [deleting, setDeleting] = useState<User | null>(null)
  const [deactivating, setDeactivating] = useState<User | null>(null)
  // The id whose deactivate / reactivate request is in flight: its row holds still.
  const [pendingId, setPendingId] = useState<string | null>(null)
  // A refusal (the last-admin guard, a 409) stays on screen until dismissed;
  // a toast would be gone before it is read.
  const [refusal, setRefusal] = useState<string | null>(null)
  // The confirms keep naming the user through their exit fade.
  const shownDeleting = useHeldWhile(deleting, deleting !== null)
  const shownDeactivating = useHeldWhile(deactivating, deactivating !== null)
  // First visit this session: rows settle in 40ms apart (never on later edits).
  const { ref: attachStagger, className: staggerClass } = useStagger<HTMLUListElement>('settings-users')

  // Admins, then everyone else by name; deactivated accounts last.
  const { active, inactive } = useMemo(() => {
    const byName = (a: User, b: User) => a.fullName.localeCompare(b.fullName)
    return {
      active: users
        .filter((u) => !isDeactivated(u))
        .sort((a, b) => (a.role === 'admin' ? 0 : 1) - (b.role === 'admin' ? 0 : 1) || byName(a, b)),
      inactive: users.filter((u) => isDeactivated(u)).sort(byName),
    }
  }, [users])

  const deactivate = async (u: User) => {
    setRefusal(null)
    setPendingId(u.id)
    const res = await adminDeactivateUser(u.id)
    setPendingId(null)
    if (res.ok) toast.success(`${u.fullName} deactivated`)
    else setRefusal(res.error ?? 'Could not deactivate the user')
  }

  const reactivate = async (u: User) => {
    setRefusal(null)
    setPendingId(u.id)
    const res = await adminReactivateUser(u.id)
    setPendingId(null)
    if (res.ok) toast.success(`${u.fullName} reactivated as a member with no permissions`)
    else setRefusal(res.error ?? 'Could not reactivate the user')
  }

  const row = (u: User) => {
    const isSelf = u.id === me?.id
    const off = isDeactivated(u)
    const busy = pendingId === u.id
    const sub = [u.email ?? '—', off ? null : u.title].filter(Boolean).join(' · ')
    return (
      <li key={u.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3.5 sm:flex-nowrap" aria-busy={busy || undefined}>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {/* A deactivated account recedes: the row is history, not a teammate. */}
          <span className={classNames('shrink-0', off && 'opacity-50 grayscale')}>
            <UserAvatar user={u} />
          </span>
          <div className="min-w-0">
            {/* On a 320px phone the "You" chip drops under the name rather than squeezing it to a letter a line. */}
            <div className="flex min-w-0 items-start gap-x-2 gap-y-1 max-[359px]:flex-wrap">
              <span
                className={classNames(
                  'line-clamp-2 text-sm font-medium [overflow-wrap:anywhere]',
                  off ? 'text-ink-200' : 'text-ink-50',
                )}
                title={u.fullName}
              >
                {u.fullName}
              </span>
              {isSelf && (
                <span className="chip shrink-0 border-brand-500/30 bg-brand-500/15 text-[10px] text-brand-700 dark:text-brand-400">
                  You
                </span>
              )}
            </div>
            <div className="truncate text-xs text-ink-300" title={sub}>
              {sub}
            </div>
          </div>
        </div>
        {/* Phones: role + access take a second line under the name; the
            actions stay on the first, beside it. On the narrowest screens
            (320px) the tiles drop under the role instead of being cut off. */}
        <div className="flex items-center gap-x-3 gap-y-1.5 sm:shrink-0 max-sm:order-last max-sm:basis-full max-sm:flex-wrap max-sm:pl-11">
          {off ? (
            <>
              <span className="badge badge-neutral shrink-0 whitespace-nowrap">
                <ProhibitIcon size={11} aria-hidden />
                Deactivated
              </span>
              {u.deactivatedAt && (
                <span className="text-xs text-ink-300 tabular-nums">{fmtDate(u.deactivatedAt)}</span>
              )}
            </>
          ) : (
            <>
              <RoleChip role={u.role} />
              <PermSummary user={u} />
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 max-sm:-mr-2">
          {off ? (
            <button
              type="button"
              className="btn-secondary mr-1 px-2.5 py-1 text-xs pointer-coarse:min-h-11"
              disabled={busy}
              onClick={() => void reactivate(u)}
            >
              <ArrowCounterClockwiseIcon size={13} aria-hidden />
              {busy ? 'Reactivating…' : 'Reactivate'}
            </button>
          ) : (
            <>
              <button
                type="button"
                className={classNames(ICON_BTN, ICON_BTN_QUIET)}
                title="Edit user"
                aria-label={`Edit ${u.fullName}`}
                onClick={() => setEditing(u)}
              >
                <PencilSimpleIcon size={16} aria-hidden />
              </button>
              <button
                type="button"
                className={classNames(ICON_BTN, isSelf ? 'text-ink-400' : ICON_BTN_QUIET)}
                title={isSelf ? "You can't deactivate your own account" : 'Deactivate user'}
                aria-label={isSelf ? "You can't deactivate your own account" : `Deactivate ${u.fullName}`}
                disabled={isSelf || busy}
                onClick={() => setDeactivating(u)}
              >
                <ProhibitIcon size={16} aria-hidden />
              </button>
            </>
          )}
          <button
            type="button"
            className={classNames(ICON_BTN, isSelf ? 'text-ink-400' : ICON_BTN_DANGER)}
            title={isSelf ? "You can't delete your own account" : 'Delete user'}
            aria-label={isSelf ? "You can't delete your own account" : `Delete ${u.fullName}`}
            disabled={isSelf || busy}
            onClick={() => setDeleting(u)}
          >
            <TrashIcon size={16} aria-hidden />
          </button>
        </div>
      </li>
    )
  }

  return (
    <>
      <Panel
        title="Team"
        description={
          <span className="tabular-nums">
            {users.length.toLocaleString()} {users.length === 1 ? 'user' : 'users'} in this workspace
            {inactive.length > 0 && ` · ${inactive.length.toLocaleString()} deactivated`}
          </span>
        }
        aside={
          <button type="button" className="btn-primary shrink-0 pointer-coarse:min-h-11" onClick={() => setInviteOpen(true)}>
            <UserPlusIcon size={14} aria-hidden />
            Invite user
          </button>
        }
        bodyClassName="pt-4"
      >
        {refusal && (
          <Notice
            tone="danger"
            icon={WarningCircleIcon}
            live
            className="mb-4"
            action={
              <button
                type="button"
                className="pressable tap-target -my-1 -mr-1 rounded-md p-1 text-ink-300 hover:bg-ink-700 hover:text-ink-50"
                aria-label="Dismiss"
                onClick={() => setRefusal(null)}
              >
                <XIcon size={14} aria-hidden />
              </button>
            }
          >
            {refusal}
          </Notice>
        )}
        <PermLegend />
        <ul ref={attachStagger} className={classNames('-mx-5 divide-y divide-ink-600 border-t border-ink-600', staggerClass)}>
          {active.map(row)}
        </ul>
        {inactive.length > 0 && (
          <>
            {/* A recessed band, not a second card: same list, a quieter chapter. */}
            <h4 className="section-title -mx-5 flex items-baseline gap-2 border-y border-ink-600 bg-ink-900/50 px-5 py-2">
              Deactivated
              <span className="text-[11px] font-medium tabular-nums text-ink-400">{inactive.length.toLocaleString()}</span>
            </h4>
            <ul className="-mx-5 divide-y divide-ink-600">{inactive.map(row)}</ul>
          </>
        )}
      </Panel>

      <UserModal
        open={inviteOpen || editing !== null}
        onClose={() => {
          setInviteOpen(false)
          setEditing(null)
        }}
        user={editing}
      />

      <ConfirmDialog
        open={deactivating !== null}
        title="Deactivate user"
        message={
          shownDeactivating
            ? `Deactivate ${shownDeactivating.fullName}? They can no longer sign in. Their role, permissions, push notifications and Google connection are removed. Their work and history stay, and you can reactivate them later.`
            : ''
        }
        confirmLabel="Deactivate"
        danger
        onConfirm={() => {
          if (deactivating) void deactivate(deactivating)
        }}
        onClose={() => setDeactivating(null)}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete user"
        message={
          shownDeleting
            ? `Delete ${shownDeleting.fullName}? Their task and project assignments will become unassigned. This can't be undone.`
            : ''
        }
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (!deleting) return
          // Optimistic removal — adminDeleteUser rolls the user back into the
          // store when the remote delete fails.
          void adminDeleteUser(deleting.id).then((res) => {
            if (res.ok) toast.success('User deleted')
            else toast.error(res.error ?? 'Could not delete user')
          })
        }}
        onClose={() => setDeleting(null)}
      />
    </>
  )
}
