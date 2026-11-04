import type { AuditLogEntry } from '../../lib/types'

// Turns an audit_log row (032) into a line a person can read. Pure, so the
// wording of every action is tested. The rows are written by database
// triggers and the edge functions; this file only reads them.

export type AuditGroup = 'profile' | 'auth' | 'vault' | 'settings' | 'showcase' | 'subscriber' | 'retention' | 'google'

/** Filter order: people first, housekeeping last. */
export const AUDIT_GROUPS: { id: AuditGroup; label: string }[] = [
  { id: 'profile', label: 'People' },
  { id: 'auth', label: 'Sign-in' },
  { id: 'vault', label: 'Vault' },
  { id: 'settings', label: 'Settings' },
  { id: 'showcase', label: 'Showcase' },
  { id: 'subscriber', label: 'Subscribers' },
  { id: 'google', label: 'Google' },
  { id: 'retention', label: 'Retention' },
]

const ACTION_LABEL: Record<string, string> = {
  'profile.created': 'Profile created',
  'profile.deleted': 'Profile deleted',
  'profile.role_changed': 'Role changed',
  'profile.permissions_changed': 'Permissions changed',
  'profile.email_changed': 'Email changed',
  'profile.deactivated': 'Deactivated',
  'profile.reactivated': 'Reactivated',
  'vault.reset_requested': 'Vault reset requested',
  'vault.reset_approved': 'Vault reset approved',
  'vault.archived': 'Vault archived',
  'vault.generation_deleted': 'Vault generation deleted',
  'vault.owner_changed': 'Vault owner changed',
  'vault.access_created': 'Vault account created',
  'vault.access_invited': 'Vault invite made',
  'vault.access_claimed': 'Vault invite claimed',
  'vault.access_removed': 'Vault access removed',
  'vault.password_changed': 'Vault password changed',
  'settings.updated': 'Workspace settings updated',
  'showcase.published': 'Showcase item published',
  'showcase.unpublished': 'Showcase item unpublished',
  'showcase.deleted': 'Showcase item deleted',
  'showcase.seeded': 'Showcase seeded',
  'subscriber.deleted': 'Subscriber deleted',
  'retention.run': 'Retention run',
  'auth.user_created': 'Account created',
  'auth.password_set': 'Password set',
  'auth.user_deleted': 'Account deleted',
  'auth.sign_in_blocked': 'Sign-in blocked',
  'auth.sign_in_restored': 'Sign-in restored',
  'google.export': 'Exported to Google Sheets',
  'google.revoked': 'Google connection revoked',
  'google.keys_rotated': 'Google keys rotated',
  'google.workspace_connected': 'Company Google account connected',
  'google.workspace_disconnected': 'Company Google account disconnected',
  'google.workspace_revoked': 'Company Google access revoked',
}

export function auditGroup(action: string): string {
  return action.split('.', 1)[0]
}

/** The action in words; an action this build does not know reads as its own name, spaced. */
export function auditLabel(action: string): string {
  const known = ACTION_LABEL[action]
  if (known) return known
  const words = action.replace(/[._]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Unknown action'
}

/** Actions that take access away or remove something: marked so they stand out in a long list. */
export function auditIsSensitive(action: string): boolean {
  return /\.(deleted|user_deleted|deactivated|sign_in_blocked|revoked|workspace_revoked|generation_deleted|reset_approved|owner_changed)$/.test(action)
}

const text = (v: unknown): string | null => {
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return null
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** "tasks none → edit, vault view → none" for the keys that differ. */
function permissionDiff(from: unknown, to: unknown): string | null {
  const a = isRecord(from) ? from : {}
  const b = isRecord(to) ? to : {}
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
  const parts = keys
    .filter((k) => (text(a[k]) ?? 'none') !== (text(b[k]) ?? 'none'))
    .map((k) => `${k} ${text(a[k]) ?? 'none'} → ${text(b[k]) ?? 'none'}`)
  return parts.length ? parts.join(', ') : null
}

/**
 * Who or what the action was done to. For a person: their current name, else
 * the name the row kept (a deleted account), else their email.
 */
export function auditTarget(entry: AuditLogEntry, nameOf: (id: string) => string | undefined): string | null {
  const group = auditGroup(entry.action)
  const d = entry.detail ?? {}
  if (group === 'profile' || group === 'auth' || entry.entity === 'profile') {
    return (entry.entityId && nameOf(entry.entityId)) || text(d.full_name) || text(d.email) || 'A removed account'
  }
  if (group === 'google') return text(d.google_email)
  if (group === 'showcase') return text(d.title) ?? text(d.slug)
  if (group === 'subscriber') return text(d.email)
  return null
}

/** The extra facts the row carries, as one short line. null when there are none worth showing. */
export function auditDetail(entry: AuditLogEntry): string | null {
  const d = entry.detail ?? {}
  switch (entry.action) {
    case 'profile.role_changed':
    case 'profile.email_changed': {
      const from = text(d.from)
      const to = text(d.to)
      return from || to ? `${from ?? 'none'} → ${to ?? 'none'}` : null
    }
    case 'profile.permissions_changed':
      return permissionDiff(d.from, d.to)
    case 'profile.created':
    case 'profile.deleted':
    case 'auth.user_created':
    case 'auth.user_deleted':
      return [text(d.email), text(d.role)].filter(Boolean).join(' · ') || null
    case 'profile.deactivated':
      // The local store keeps the role they held; the database row keeps the email.
      return text(d.role) ? `was ${text(d.role)}` : text(d.email)
    case 'profile.reactivated':
      return 'Back as a member with no permissions'
    case 'auth.password_set':
      return d.self === true ? 'Own password' : 'Set by an admin'
    case 'settings.updated': {
      const keys = Object.keys(d)
      return keys.length ? keys.sort().join(', ') : null
    }
    case 'google.export': {
      const tabs = Array.isArray(d.tabs) ? d.tabs : []
      const names = tabs.map((t) => (isRecord(t) ? text(t.tab) : null)).filter(Boolean)
      return names.length ? names.join(', ') : null
    }
    case 'google.workspace_revoked':
      return text(d.reason)
    default:
      break
  }
  // Anything else: the plain values, without ids or nested blobs.
  const parts = Object.entries(d)
    .filter(([k]) => !/(^|_)id$/.test(k) && k !== 'full_name' && k !== 'email' && k !== 'google_email' && k !== 'title')
    .map(([k, v]) => {
      const t = text(v)
      return t ? `${k.replace(/_/g, ' ')} ${t}` : null
    })
    .filter(Boolean)
    .slice(0, 4)
  return parts.length ? parts.join(' · ') : null
}

/**
 * Who did it. Rows written by the database on its own (a cascade, a scheduled
 * job) have no actor: `profile.deleted` from an account removal is one, and
 * the matching `auth.user_deleted` row names the admin.
 */
export function auditActor(entry: AuditLogEntry, nameOf: (id: string) => string | undefined): string {
  if (!entry.actorId) return 'System'
  return nameOf(entry.actorId) ?? 'A removed account'
}
