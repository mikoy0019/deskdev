import type { User, PermFeature, PermLevel } from './types'

/** Every permission-gated feature area. Home + Notifications are always open. */
export const ALL_FEATURES: PermFeature[] = [
  'projects', 'tasks', 'clients', 'crm', 'calendar', 'meetings', 'growth', 'courses', 'showcase',
]

/** Sensible starting permissions for a new member — view everything. */
export const DEFAULT_MEMBER_PERMISSIONS: Record<PermFeature, PermLevel> = {
  projects: 'view',
  tasks: 'view',
  clients: 'view',
  crm: 'view',
  calendar: 'view',
  meetings: 'view',
  growth: 'view',
  courses: 'view',
  showcase: 'view',
}

/**
 * An offboarded account (032 deactivated_at). The server already demotes it
 * to a member with no permissions; the app also treats it as having none, so
 * a stale profile copy can't keep showing controls.
 */
export function isDeactivated(user: Pick<User, 'deactivatedAt'> | null | undefined): boolean {
  return Boolean(user?.deactivatedAt)
}

/** Users a picker (assignee, owner, attendee, owner pool) should offer. */
export function activeUsers<T extends Pick<User, 'deactivatedAt'>>(users: T[]): T[] {
  return users.filter((u) => !u.deactivatedAt)
}

/**
 * Can this user act on a feature at the given level?
 * Mirrors the SQL has_perm() helper: admins implicitly have edit on
 * everything (plus Settings); members are checked against their
 * permissions map, where 'edit' also satisfies 'view'.
 */
export function can(
  user: User | null | undefined,
  feature: PermFeature,
  level: 'view' | 'edit',
): boolean {
  if (!user) return false
  if (isDeactivated(user)) return false
  if (user.role === 'admin') return true
  const granted = user.permissions?.[feature] ?? 'none'
  if (granted === 'none') return false
  if (level === 'view') return granted === 'view' || granted === 'edit'
  return granted === 'edit'
}

/** Admin, and not offboarded — the gate for admin-only actions (publishing, settings, audit). */
export function isAdmin(user: User | null | undefined): boolean {
  return Boolean(user && user.role === 'admin' && !isDeactivated(user))
}
