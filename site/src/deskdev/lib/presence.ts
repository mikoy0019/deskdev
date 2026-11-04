import type { User } from './types'
import { isDeactivated } from './permissions'

/** Revision 7: who is here right now. Live over a Realtime presence channel (056). */
export type PresenceStatus = 'active' | 'away'

/** The private Realtime topic every signed-in tab joins, keyed by user id. */
export const PRESENCE_TOPIC = 'deskdev-presence'

/** No pointer or key for this long, or the tab hidden: away. */
export const AWAY_AFTER_MS = 5 * 60_000
export const PRESENCE_HEARTBEAT_MS = 30_000
export const PRESENCE_EXPIRES_MS = 90_000

/**
 * A channel's presence state (one entry per user, one meta per tab or
 * device) as one status per person: active when any of their tabs is.
 */
export function aggregatePresence(state: Record<string, ReadonlyArray<{ status?: unknown; at?: unknown }>>, now = Date.now()): Record<string, PresenceStatus> {
  const out: Record<string, PresenceStatus> = {}
  for (const [key, metas] of Object.entries(state)) {
    const live = metas?.filter((m) => m.at === undefined || (typeof m.at === 'string' && Number.isFinite(Date.parse(m.at)) && now - Date.parse(m.at) < PRESENCE_EXPIRES_MS))
    if (!live?.length) continue
    out[key] = live.some((m) => m.status === 'active') ? 'active' : 'away'
  }
  return out
}

export interface PeopleByStatus {
  active: User[]
  away: User[]
  offline: User[]
}

/**
 * Every active account, sorted into active, away and offline (you first in
 * your group, then by name). Deactivated accounts are left out.
 */
export function groupPeople(users: User[], online: Record<string, PresenceStatus>, meId?: string | null): PeopleByStatus {
  const out: PeopleByStatus = { active: [], away: [], offline: [] }
  const order = (a: User, b: User) => (a.id === meId ? -1 : b.id === meId ? 1 : a.fullName.localeCompare(b.fullName))
  for (const u of users) {
    if (isDeactivated(u)) continue
    const s = online[u.id]
    out[s === 'active' ? 'active' : s === 'away' ? 'away' : 'offline'].push(u)
  }
  out.active.sort(order)
  out.away.sort(order)
  out.offline.sort(order)
  return out
}
