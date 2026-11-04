import { useMemo, useState } from 'react'
import { CheckIcon, MagnifyingGlassIcon, PlusIcon, XIcon } from '@phosphor-icons/react'
import Avatar from '../Avatar'
import Popover from '../crm/Popover'
import { useStore } from '../../store/useStore'
import { MAX_COLLABORATORS } from '../../store/entityValidation'
import { activeUsers } from '../../lib/permissions'
import { classNames } from '../../lib/format'

/**
 * The people working on a task besides its assignee (revision 2): chips for
 * who is on it, and "Add people" opening a searchable checklist of active
 * teammates. The assignee is left out of the list; someone deactivated since
 * they were added keeps their chip until removed.
 */
export default function CollaboratorsField({
  value,
  onChange,
  assigneeId,
}: {
  value: string[]
  onChange: (ids: string[]) => void
  assigneeId?: string
}) {
  const users = useStore((s) => s.users)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [query, setQuery] = useState('')

  const byId = useMemo(() => new Map(users.map((u) => [u.id, u])), [users])
  const chosen = value.filter((id) => id !== assigneeId)
  const people = useMemo(() => {
    const q = query.trim().toLowerCase()
    return activeUsers(users)
      .filter((u) => u.id !== assigneeId && (!q || u.fullName.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q)))
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
  }, [users, assigneeId, query])

  const toggle = (id: string) =>
    onChange(chosen.includes(id) ? chosen.filter((c) => c !== id) : [...chosen, id])
  const full = chosen.length >= MAX_COLLABORATORS

  return (
    <div>
      <ul className="flex flex-wrap items-center gap-1.5" aria-label="Collaborators">
        {chosen.map((id) => {
          const u = byId.get(id)
          const name = u?.fullName ?? 'Former teammate'
          return (
            <li key={id} className="chip gap-1.5 border-ink-600 bg-ink-700/60 py-0.5 pl-1 pr-1 text-ink-100">
              <Avatar name={name} size="sm" />
              <span className="max-w-36 truncate text-xs" title={name}>{name}</span>
              <button
                type="button"
                className="pressable flex size-5 items-center justify-center rounded text-ink-300 hover:bg-ink-600 hover:text-ink-50 pointer-coarse:size-8"
                aria-label={`Remove ${name}`}
                onClick={() => onChange(chosen.filter((c) => c !== id))}
              >
                <XIcon size={11} aria-hidden />
              </button>
            </li>
          )
        })}
        <li>
          <button
            type="button"
            className="btn-ghost h-7 gap-1 px-2 text-xs"
            aria-haspopup="dialog"
            aria-expanded={anchor !== null}
            onClick={(e) => {
              setQuery('')
              setAnchor(anchor ? null : e.currentTarget)
            }}
          >
            <PlusIcon size={12} aria-hidden /> {chosen.length ? 'Add people' : 'Add collaborators'}
          </button>
        </li>
      </ul>

      <Popover anchor={anchor} onClose={() => setAnchor(null)} label="Collaborators">
        <div className="w-72 max-w-full space-y-2 p-2">
          <label className="relative block">
            <MagnifyingGlassIcon size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" aria-hidden />
            <input
              className="input w-full pl-9"
              placeholder="Search people"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search people"
            />
          </label>
          <div className="max-h-64 divide-y divide-ink-600 overflow-y-auto overscroll-contain rounded-md border border-ink-600" role="listbox" aria-multiselectable aria-label="People">
            {people.length === 0 ? (
              <p className="p-4 text-center text-sm text-ink-300 [overflow-wrap:anywhere]">
                {query.trim() ? `No one matches “${query.trim()}”.` : 'No other active teammates.'}
              </p>
            ) : (
              people.map((u) => {
                const on = chosen.includes(u.id)
                return (
                  <button
                    key={u.id}
                    type="button"
                    role="option"
                    aria-selected={on}
                    disabled={!on && full}
                    className={classNames(
                      'pressable-card flex w-full items-center gap-3 px-3 py-2 text-left pointer-coarse:min-h-11 disabled:opacity-50',
                      on ? 'bg-brand-600/10' : 'hover:bg-ink-700/60',
                    )}
                    onClick={() => toggle(u.id)}
                  >
                    <Avatar name={u.fullName} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink-50">{u.fullName}</span>
                    <span
                      className={classNames(
                        'flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors duration-150',
                        on ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-500',
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
          <p className="px-1 text-[11px] tabular-nums text-ink-300">
            {full ? `That’s the most a task can have (${MAX_COLLABORATORS}).` : `${chosen.length} selected`}
          </p>
        </div>
      </Popover>
    </div>
  )
}
