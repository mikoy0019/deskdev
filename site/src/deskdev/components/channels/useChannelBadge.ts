import { useMemo } from 'react'
import { useStore, useCurrentUser } from '../../store/useStore'
import { channelBadge } from '../../lib/channels'

/** Channels nav badge: unread mentions if any, otherwise the number of unread channels. */
export function useChannelBadge(): { unreadChannels: number; mentions: number } {
  const me = useCurrentUser()
  const channels = useStore((s) => s.channels)
  const messages = useStore((s) => s.channelMessages)
  const reads = useStore((s) => s.channelReads)
  return useMemo(() => channelBadge(channels, messages, reads, me), [channels, messages, reads, me])
}
