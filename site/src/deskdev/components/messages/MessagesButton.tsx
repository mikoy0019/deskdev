import { Link } from 'react-router-dom'
import { ChatCircleIcon } from '@phosphor-icons/react'
import { useUnreadMessageCount } from './useUnreadMessageCount'
import { classNames } from '../../lib/format'

/** Topbar shortcut to the inbox with an unread badge — sits beside the bell. */
export default function MessagesButton({ className }: { className?: string }) {
  const unread = useUnreadMessageCount()
  return (
    <Link
      to="/messages"
      className={classNames(
        'pressable relative p-2 rounded-lg text-ink-200 hover:text-ink-50 hover:bg-ink-700',
        className,
      )}
      title="Messages"
      aria-label={unread > 0 ? `Messages, ${unread} unread` : 'Messages'}
    >
      <ChatCircleIcon size={16} aria-hidden />
      {unread > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-brand-600 text-white text-[9px] font-semibold tabular-nums flex items-center justify-center ring-2 ring-ink-850">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  )
}
