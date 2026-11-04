import { Fragment, useMemo } from 'react'
import { parseBody } from '../../lib/channels'
import { classNames } from '../../lib/format'
import type { User } from '../../lib/types'

/** Renders a stored channel message: @mentions as pills, links, `inline code`. */
export default function MessageBody({
  body,
  users,
  meId,
}: {
  body: string
  users: User[]
  meId: string | undefined
}) {
  const segments = useMemo(() => parseBody(body), [body])
  return (
    <>
      {segments.map((seg, i) => {
        switch (seg.kind) {
          case 'mention': {
            const u = users.find((x) => x.id === seg.userId)
            return (
              <span
                key={i}
                className={classNames(
                  'px-1 rounded-sm font-medium',
                  seg.userId === meId
                    ? 'bg-amber-500/20 text-amber-800 dark:text-amber-300'
                    : 'bg-brand-500/15 text-brand-600 dark:text-brand-300',
                )}
              >
                @{u?.fullName ?? 'unknown'}
              </span>
            )
          }
          case 'room':
            return (
              <span key={i} className="px-1 rounded-sm font-medium bg-amber-500/20 text-amber-800 dark:text-amber-300">
                {seg.text}
              </span>
            )
          case 'link':
            return (
              <a
                key={i}
                href={seg.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-600 dark:text-brand-400 hover:underline [overflow-wrap:anywhere]"
              >
                {seg.href}
              </a>
            )
          case 'code':
            return (
              <code key={i} className="px-1 py-px rounded-sm bg-ink-700 border border-ink-600 font-mono text-[0.85em] text-ink-50">
                {seg.text}
              </code>
            )
          default:
            return <Fragment key={i}>{seg.text}</Fragment>
        }
      })}
    </>
  )
}
