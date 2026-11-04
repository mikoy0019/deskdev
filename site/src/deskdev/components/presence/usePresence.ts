import { create } from 'zustand'
import type { PresenceStatus } from '../../lib/presence'

/**
 * Who is here now, by user id. Kept apart from the main store: it is live
 * state from the presence channel, never persisted or synced to tables.
 * `live` is false while the channel is down (or refused), so the panel can
 * say the statuses are not current instead of showing everyone offline.
 */
export const usePresence = create<{ online: Record<string, PresenceStatus>; live: boolean }>(() => ({
  online: {},
  live: false,
}))
