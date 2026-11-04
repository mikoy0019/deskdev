import { useMemo } from 'react'
import { useStore } from '../../store/useStore'
import { totalUnread } from '../../lib/chat'

/** Unread messages across the signed-in user's inbox. */
export function useUnreadMessageCount(): number {
  const me = useStore((s) => s.currentUserId)
  const conversations = useStore((s) => s.conversations)
  const messages = useStore((s) => s.messages)
  const reads = useStore((s) => s.conversationReads)
  return useMemo(
    () => totalUnread(conversations, messages, reads, me),
    [conversations, messages, reads, me],
  )
}
