import { useCallback, useMemo, useState } from 'react'
import { CheckIcon, MagnifyingGlassIcon } from '@phosphor-icons/react'
import Modal from '../Modal'
import Avatar from '../Avatar'
import { useStore, useCurrentUser } from '../../store/useStore'
import { classNames } from '../../lib/format'
import { activeUsers } from '../../lib/permissions'
import { useCoarsePointer } from '../../pwa/useMediaQuery'

/** Pick one person for a DM, or several (optionally named) for a group. */
export default function NewChatModal({
  open,
  onClose,
  onStarted,
}: {
  open: boolean
  onClose: () => void
  onStarted: (conversationId: string) => void
}) {
  const me = useCurrentUser()
  const users = useStore((s) => s.users)
  const startConversation = useStore((s) => s.startConversation)
  // Touch: let people see the list before a keyboard covers half of it.
  const coarse = useCoarsePointer()

  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [title, setTitle] = useState('')

  const people = useMemo(() => {
    const q = query.trim().toLowerCase()
    // Someone who can no longer sign in is not offered for a new conversation.
    return activeUsers(users)
      .filter((u) => u.id !== me?.id)
      .filter(
        (u) =>
          !q ||
          u.fullName.toLowerCase().includes(q) ||
          u.email?.toLowerCase().includes(q) ||
          u.title?.toLowerCase().includes(q),
      )
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
  }, [users, me?.id, query])

  // Stable across keystrokes: a close handler made anew on every render is a
  // new prop for the dialog each time someone types in it.
  const close = useCallback(() => {
    setQuery('')
    setPicked([])
    setTitle('')
    onClose()
  }, [onClose])

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  const start = () => {
    const id = startConversation(picked, picked.length > 1 ? title : undefined)
    if (!id) return
    close()
    onStarted(id)
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="New chat"
      footer={
        <>
          <button className="btn-ghost" onClick={close}>
            Cancel
          </button>
          <button className="btn-primary" disabled={picked.length === 0} onClick={start}>
            {picked.length > 1 ? 'Start group chat' : 'Start chat'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="relative block">
          <MagnifyingGlassIcon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" aria-hidden />
          <input
            className="input pl-9 w-full"
            placeholder="Search people"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus={!coarse}
            aria-label="Search people"
          />
        </label>

        {picked.length > 1 && (
          // Label above the field (forms rule); it fades in as the second person is picked.
          <label className="block animate-fade">
            <span className="block text-xs font-medium text-ink-200">Group name</span>
            <input
              className="input mt-1.5 w-full"
              placeholder="Group name (optional)"
              value={title}
              maxLength={80}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
        )}

        <div className="card divide-y divide-ink-600 max-h-72 overflow-y-auto overscroll-contain" role="listbox" aria-multiselectable aria-label="People">
          {people.length === 0 ? (
            // With no search typed the list is empty because no one else can
            // sign in (a new workspace, or everyone else is deactivated).
            <p className="p-4 text-sm text-ink-300 text-center [overflow-wrap:anywhere]">
              {query.trim() ? <>No one matches “{query}”.</> : 'No one else is in the workspace yet.'}
            </p>
          ) : (
            people.map((u) => {
              const on = picked.includes(u.id)
              return (
                <button
                  key={u.id}
                  role="option"
                  aria-selected={on}
                  className={classNames(
                    'pressable-card w-full flex items-center gap-3 px-3 py-2.5 text-left',
                    on ? 'bg-brand-600/10' : 'hover:bg-ink-700/60',
                  )}
                  onClick={() => toggle(u.id)}
                >
                  <Avatar name={u.fullName} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-ink-50 truncate" title={u.fullName}>{u.fullName}</span>
                    {/* A job title is shown as typed; only the bare role gets a capital. */}
                    <span className={classNames('block text-[11px] text-ink-300 truncate', !u.title && 'capitalize')}>
                      {u.title || u.role}
                    </span>
                  </span>
                  <span
                    className={classNames(
                      'size-5 rounded-md border flex items-center justify-center shrink-0 transition-colors duration-150 ease-[ease]',
                      on ? 'bg-brand-600 border-brand-600 text-white' : 'border-ink-500',
                    )}
                    aria-hidden
                  >
                    {on && <CheckIcon size={12} aria-hidden />}
                  </span>
                </button>
              )
            })
          )}
        </div>
      </div>
    </Modal>
  )
}
