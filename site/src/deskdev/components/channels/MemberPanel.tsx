import { CrownIcon } from '@phosphor-icons/react'
import Avatar from '../Avatar'
import type { Channel, User } from '../../lib/types'

/**
 * Member list, grouped by role like Discord's: the right-hand column on wide
 * screens, or (variant 'sheet') the body of the Members sheet below lg.
 */
export default function MemberPanel({
  channel,
  members,
  variant = 'panel',
}: {
  channel: Channel
  members: User[]
  variant?: 'panel' | 'sheet'
}) {
  const groups = [
    { label: 'Admins', people: members.filter((u) => u.role === 'admin') },
    { label: 'Members', people: members.filter((u) => u.role !== 'admin') },
  ].filter((g) => g.people.length > 0)

  return (
    <aside
      className={variant === 'panel' ? 'h-full overflow-y-auto overscroll-contain px-3 py-4 bg-ink-850/40' : '-mx-2'}
      aria-label="Channel members"
    >
      {channel.isPrivate && (
        <p className="px-2 mb-3 text-[11px] text-ink-300">Private — only these people (and admins) can see this channel.</p>
      )}
      {groups.map((g) => (
        <section key={g.label} className="mb-5">
          <h3 className="px-2 mb-1.5 section-title text-[10px]">
            {g.label} — <span className="tabular-nums">{g.people.length}</span>
          </h3>
          <ul className="space-y-px">
            {g.people.map((u) => (
              <li key={u.id} className="flex items-center gap-2.5 px-2 py-1.5 pointer-coarse:min-h-[44px] rounded-md">
                <Avatar name={u.fullName} />
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-1 text-sm text-ink-100 min-w-0">
                    <span className="truncate" title={u.fullName}>{u.fullName}</span>
                    {u.id === channel.createdBy && (
                      <CrownIcon size={12} className="text-amber-600 dark:text-amber-400 shrink-0" aria-label="Channel owner" />
                    )}
                  </span>
                  {u.title && <span className="block text-[11px] text-ink-300 truncate">{u.title}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </aside>
  )
}
