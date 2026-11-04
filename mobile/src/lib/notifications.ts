import type { CrmColumn, CrmRow, EventItem, Notification, NotificationType, PermFeature } from './types'

// Pure notification helpers: where a notification leads, and which kinds the
// user wants to hear about. Browser APIs (Notification, speech) live in
// components/notifications; this file is testable without a DOM.

// ─── Where a notification leads ─────────────────────────────────────────────

export interface HrefContext {
  crmRows: Pick<CrmRow, 'id' | 'tableId'>[]
  crmColumns: Pick<CrmColumn, 'id' | 'tableId'>[]
  events: Pick<EventItem, 'id' | 'kind'>[]
}

/**
 * The page a notification is about. Every notification carries an entity and
 * id, but nothing ever used them — clicking one only marked it read. Rows
 * whose subject is gone (a deleted task) still land somewhere sensible.
 */
export function notificationHref(n: Pick<Notification, 'entity' | 'entityId'>, ctx: HrefContext): string {
  const id = n.entityId
  switch (n.entity) {
    case 'task':
      return id ? `/tasks?task=${id}` : '/tasks'
    case 'project':
      return id ? `/projects/${id}` : '/projects'
    case 'client':
      return id ? `/clients/${id}` : '/clients'
    case 'crm_table':
      return id ? `/crm/${id}` : '/crm'
    case 'crm_row': {
      const tableId = ctx.crmRows.find((r) => r.id === id)?.tableId
      return tableId ? `/crm/${tableId}` : '/crm'
    }
    case 'crm_column': {
      const tableId = ctx.crmColumns.find((c) => c.id === id)?.tableId
      return tableId ? `/crm/${tableId}` : '/crm'
    }
    case 'event': {
      const kind = ctx.events.find((e) => e.id === id)?.kind
      return kind === 'meeting' ? '/meetings' : '/calendar'
    }
    case 'channel':
      return id ? `/channels/${id}` : '/channels'
    case 'conversation':
      return id ? `/messages/${id}` : '/messages'
    case 'lead':
      return id ? `/growth/leads?lead=${id}` : '/growth/leads'
    case 'showcase':
      return id ? `/showcase?item=${id}` : '/showcase'
    default:
      return '/notifications'
  }
}

/**
 * Tags shared with the push sender (supabase/functions/send-push/logic.ts):
 * while a tab is open in the background both the page and the pushed
 * notification fire for one event, and a shared tag makes the second replace
 * the first instead of showing it twice.
 */
export const alertTag = {
  chat: (conversationId: string) => `chat:${conversationId}`,
  notification: (notificationId: string) => `notif:${notificationId}`,
}

// ─── Preferences ────────────────────────────────────────────────────────────

/**
 * Groups the user can switch on and off, coarser than NotificationType.
 * Mirrored in supabase/functions/send-push/logic.ts and in the keys
 * upsert_push_subscription accepts (migration 033) — change all three.
 */
export type NotifyCategory = 'mentions' | 'messages' | 'tasks' | 'reminders' | 'workspace' | 'leads'

/**
 * `feature`: only people who can view that feature ever receive this category
 * (the server checks it, migration 033), so Settings can hide the switch from
 * everyone else.
 */
export const NOTIFY_CATEGORIES: { key: NotifyCategory; label: string; hint: string; feature?: PermFeature }[] = [
  { key: 'mentions', label: 'Mentions & replies', hint: 'Someone @mentions you or replies to you in a channel, or a customer sends back a form' },
  { key: 'messages', label: 'Direct messages', hint: 'New messages in your chats, and emails from leads and clients' },
  { key: 'tasks', label: 'Tasks', hint: 'You are assigned a task, or a task changes' },
  { key: 'reminders', label: 'Due reminders', hint: 'Tasks due today or tomorrow, meetings in the next 24 hours, calls booked on the website' },
  { key: 'workspace', label: 'Workspace updates', hint: 'Clients, projects, CRM and calendar changes (admins)' },
  { key: 'leads', label: 'Leads', hint: 'New website leads, leads waiting on a reply, follow-ups due, leads assigned to you', feature: 'growth' },
]

export function categoryOf(type: NotificationType): NotifyCategory {
  switch (type) {
    // A lead or client emailing back is a message to you (049).
    case 'email_received':
      return 'messages'
    case 'channel_mention':
    // A customer answering the form you sent them is a reply to you.
    case 'form_submitted':
      return 'mentions'
    case 'task_assigned':
    case 'task_updated':
      return 'tasks'
    case 'due_reminder':
    // A call booked on the website is a meeting coming up (048).
    case 'meeting_booked':
      return 'reminders'
    case 'lead_new':
    case 'lead_sla':
    case 'lead_followup':
    case 'lead_assigned':
      return 'leads'
    default:
      // showcase_ready lands here: an admin's review queue, not an interruption.
      return 'workspace'
  }
}

export interface NotifyPrefs {
  /** Master switch for desktop (browser) notifications. */
  desktop: boolean
  /** Spoken announcement on top of the popup. */
  voice: boolean
  categories: Record<NotifyCategory, boolean>
}

/** A desk machine's defaults. A phone or the installed app starts with the voice off (prefs.ts defaultVoice). */
export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = {
  desktop: true,
  voice: true,
  categories: { mentions: true, messages: true, tasks: true, reminders: true, workspace: false, leads: true },
}

/** Fill in anything a stored copy is missing, so new categories default on/off as designed. */
export function normalizePrefs(raw: unknown): NotifyPrefs {
  const r = (raw ?? {}) as Partial<NotifyPrefs>
  return {
    desktop: typeof r.desktop === 'boolean' ? r.desktop : DEFAULT_NOTIFY_PREFS.desktop,
    voice: typeof r.voice === 'boolean' ? r.voice : DEFAULT_NOTIFY_PREFS.voice,
    categories: { ...DEFAULT_NOTIFY_PREFS.categories, ...(r.categories ?? {}) },
  }
}

/** Whether a notification of this type should reach the desktop under these prefs. */
export function wantsDesktop(prefs: NotifyPrefs, category: NotifyCategory): boolean {
  return prefs.desktop && prefs.categories[category]
}

/** Only the kinds that need a person's attention right now get a voice. */
export function wantsVoice(prefs: NotifyPrefs, category: NotifyCategory): boolean {
  return prefs.desktop && prefs.voice && prefs.categories[category] && category !== 'workspace'
}

/** What the voice says for an in-app notification. */
export function spokenLine(n: Pick<Notification, 'type' | 'title'>, actor?: string): string {
  const who = actor?.trim()
  switch (categoryOf(n.type)) {
    case 'mentions':
      return who ? `Boss, ${who} mentioned you` : 'Boss, you were mentioned'
    case 'tasks':
      return n.type === 'task_assigned' && who ? `Boss, ${who} assigned you a task` : 'Boss, a task was updated'
    case 'reminders':
      return 'Boss, you have something due'
    case 'leads':
      switch (n.type) {
        case 'lead_new':
          return 'Boss, you have a new lead'
        case 'lead_assigned':
          return who ? `Boss, ${who} assigned you a lead` : 'Boss, a lead was assigned to you'
        case 'lead_sla':
          return 'Boss, a lead is waiting for a reply'
        default:
          return 'Boss, you have lead follow-ups due'
      }
    default:
      return 'Boss, you have a new notification'
  }
}
