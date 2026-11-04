import { useEffect, useRef } from 'react'
import { PushPinIcon, PushPinSlashIcon } from '@phosphor-icons/react'
import Avatar from '../Avatar'
import MessageBody from './MessageBody'
import { fmtDateTime } from '../../lib/format'
import { PopoverPanel } from '../motion'
import { useCoarsePointer } from '../../pwa/useMediaQuery'
import type { ChannelMessage, User } from '../../lib/types'

/**
 * Dropdown listing a channel's pinned messages, with jump-to and (for managers)
 * unpin. Grows from the pin button's corner; render it inside <Presence>.
 */
export default function PinnedPanel({
  pinned,
  users,
  meId,
  canManage,
  onJump,
  onUnpin,
  onClose,
}: {
  pinned: ChannelMessage[]
  users: User[]
  meId: string
  canManage: boolean
  onJump: (id: string) => void
  onUnpin: (id: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const coarse = useCoarsePointer()

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const t = setTimeout(() => document.addEventListener('mousedown', onDoc))
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <PopoverPanel
      ref={ref}
      placement="bottom-end"
      className="absolute right-0 top-full mt-2 w-[min(24rem,calc(100vw-2rem))] card z-30 flex flex-col overflow-hidden max-h-[70dvh] max-md:fixed max-md:inset-x-3 max-md:top-[calc(var(--safe-top)_+_3.75rem)] max-md:mt-0 max-md:w-auto max-md:max-h-[calc(var(--app-h)_-_var(--safe-top)_-_5rem)]"
      style={{ boxShadow: 'var(--shadow-3)' }}
      role="dialog"
      aria-label="Pinned messages"
    >
      <div className="shrink-0 px-4 py-3 border-b border-ink-600 flex items-center gap-2">
        <PushPinIcon size={14} className="text-ink-300" aria-hidden />
        <h2 className="text-sm font-semibold text-ink-50">Pinned messages</h2>
      </div>
      {pinned.length === 0 ? (
        <div className="p-6 text-center">
          <span className="mx-auto size-10 rounded-xl border border-ink-600 bg-ink-800 dark:bg-ink-700/60 shadow-(--shadow-2) flex items-center justify-center text-ink-300">
            <PushPinIcon size={18} aria-hidden />
          </span>
          <p className="mt-3 text-sm text-ink-200">No pinned messages yet.</p>
          <p className="mt-1 text-xs text-ink-300">
            {canManage
              ? `${coarse ? 'Tap' : 'Hover'} a message and pick the pin to keep it here.`
              : 'Channel managers can pin important messages.'}
          </p>
        </div>
      ) : (
        <ul className="min-h-0 overflow-y-auto overscroll-contain divide-y divide-ink-600">
          {pinned.map((m) => {
            const name = users.find((u) => u.id === m.senderId)?.fullName ?? 'Former member'
            return (
              <li key={m.id} className="group px-4 py-3 hover:bg-ink-700/40 transition-colors duration-150 ease-[ease]">
                <div className="flex items-center gap-2 min-w-0">
                  <Avatar name={name} size="sm" />
                  <span className="min-w-0 text-xs font-semibold text-ink-50 truncate" title={name}>{name}</span>
                  <span className="shrink-0 text-[10px] tabular-nums text-ink-400 whitespace-nowrap">{fmtDateTime(m.createdAt)}</span>
                  <span className="ml-auto shrink-0 flex items-center gap-1">
                    <button className="btn-ghost px-2 py-0.5 pointer-coarse:py-2 text-xs" onClick={() => onJump(m.id)}>
                      Jump
                    </button>
                    {canManage && (
                      <button
                        className="pressable p-1 pointer-coarse:p-2.5 rounded-md text-ink-300 hover:text-ink-50 hover:bg-ink-700"
                        onClick={() => onUnpin(m.id)}
                        aria-label="Unpin"
                        title="Unpin"
                      >
                        <PushPinSlashIcon size={13} aria-hidden />
                      </button>
                    )}
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-ink-100 whitespace-pre-wrap wrap-break-word line-clamp-4">
                  <MessageBody body={m.body} users={users} meId={meId} />
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </PopoverPanel>
  )
}
