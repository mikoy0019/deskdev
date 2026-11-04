import { useStore } from '@/store/useStore'
import { totalUnread } from '@/lib/chat'

/**
 * Unread direct messages for the signed-in user (mobile's tab badges). Lives
 * here, not in the store: the store is shared byte-for-byte with the web app,
 * which has its own hook next to its message components.
 */
export function useUnreadMessageCount(): number {
  // Returns a primitive, so no useShallow needed.
  return useStore((s) => totalUnread(s.conversations, s.messages, s.conversationReads, s.currentUserId))
}
