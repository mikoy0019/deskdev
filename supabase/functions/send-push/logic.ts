// DeskDev Studio — send-push: pure logic.
//
// Everything that decides WHO gets a push and WHAT it says lives here, with no
// Deno or npm imports, so the site's Vitest suite can import this file
// directly (site/src/deskdev/pwa/sendPushLogic.test.ts). index.ts does the I/O.
//
// Several pieces mirror the web app on purpose — the push must read exactly
// like the in-app notification it stands in for:
//   categoryOf          ↔ site/src/deskdev/lib/notifications.ts categoryOf
//   notificationPath    ↔ site/src/deskdev/lib/notifications.ts notificationHref
//   shouldPushNotification ↔ components/notifications/useNotificationAlerts.ts
//   chat title / body   ↔ components/messages/useMessageNotifications.ts
//   joinAppUrl          ↔ site/src/deskdev/pwa/paths.ts appUrl (baseJoin)
// The test file compares the first one against the real export, so a new
// NotificationType that is not mapped here fails the suite.

// ─── Categories ─────────────────────────────────────────────────────────────

// 'leads' arrived with migration 033. Only Growth viewers ever receive lead
// notifications (033's guard and the intake RPC pick the recipients), so the
// switch defaulting on means "on for the Growth team".
export type NotifyCategory = 'mentions' | 'messages' | 'tasks' | 'reminders' | 'workspace' | 'leads'

export const NOTIFY_CATEGORIES: readonly NotifyCategory[] = ['mentions', 'messages', 'tasks', 'reminders', 'workspace', 'leads']

/**
 * Same defaults as the column default (migration 033, was 029) and
 * DEFAULT_NOTIFY_PREFS. A row stored before 033 has no 'leads' key, which
 * normalizeCategories reads as on.
 */
export const DEFAULT_PUSH_CATEGORIES: Readonly<Record<NotifyCategory, boolean>> = {
  mentions: true,
  messages: true,
  tasks: true,
  reminders: true,
  workspace: false,
  leads: true,
}

/** What a push is about. 'test' bypasses the category switches. */
export type PushKind = NotifyCategory | 'test'

export function categoryOf(type: string): NotifyCategory {
  switch (type) {
    // A lead or client emailing back is a message to you (049).
    case 'email_received':
      return 'messages'
    case 'channel_mention':
    // A customer answering the form you sent them is a reply to you (047).
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

/** A stored categories object with anything missing or malformed back at its default. */
export function normalizeCategories(raw: unknown): Record<NotifyCategory, boolean> {
  const out = { ...DEFAULT_PUSH_CATEGORIES }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>
    for (const key of NOTIFY_CATEGORIES) {
      if (typeof r[key] === 'boolean') out[key] = r[key] as boolean
    }
  }
  return out
}

export function wantsPush(categories: unknown, kind: PushKind): boolean {
  if (kind === 'test') return true
  return normalizeCategories(categories)[kind]
}

// ─── Rows (snake_case, as PostgREST returns them) ───────────────────────────

export interface NotificationRow {
  id: string
  user_id: string
  actor_id: string | null
  type: string
  title: string
  body: string | null
  entity: string | null
  entity_id: string | null
  read: boolean | null
  created_at?: string | null
}

export interface MessageRow {
  id: string
  conversation_id: string
  sender_id: string | null
  body: string
  created_at?: string | null
}

export interface ConversationRow {
  id: string
  title: string | null
  is_group: boolean
  participant_ids: string[]
}

export interface ProfileRow {
  id: string
  full_name: string | null
}

export interface SubscriptionRow {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  app_base: string
  categories: unknown
  failure_count?: number | null
}

// ─── Who gets one ───────────────────────────────────────────────────────────

/**
 * Whether a notifications row earns a push at all. Same rule as the in-app
 * popup: unread, and not your own action echoed back to you — except due
 * reminders, which your own device files on your behalf.
 */
export function shouldPushNotification(n: Pick<NotificationRow, 'user_id' | 'actor_id' | 'type' | 'read'>): boolean {
  if (n.read) return false
  if (n.actor_id && n.actor_id === n.user_id && n.type !== 'due_reminder') return false
  return true
}

/** Everyone in the conversation except the person who wrote the message. */
export function messageRecipients(conv: Pick<ConversationRow, 'participant_ids'>, senderId: string | null): string[] {
  const seen = new Set<string>()
  for (const id of conv.participant_ids ?? []) {
    if (!id || id === senderId) continue
    seen.add(id)
  }
  return [...seen]
}

/** The subscriptions of these users that want this kind of push. */
export function selectSubscriptions<T extends Pick<SubscriptionRow, 'user_id' | 'categories' | 'endpoint'>>(
  subs: T[],
  recipients: string[],
  kind: PushKind,
): T[] {
  const who = new Set(recipients)
  return subs.filter((s) => who.has(s.user_id) && wantsPush(s.categories, kind) && isPushServiceEndpoint(s.endpoint))
}

/**
 * Push services DeskDev will POST to. The endpoint comes from the browser, so
 * without a list the function could be pointed at any URL. Mirrored in
 * migration 029 (public.is_push_service_endpoint) — change both together.
 *   Chromium (Chrome, Edge on Android, Samsung, Opera, Brave): fcm.googleapis.com
 *   Safari / iOS / macOS: web.push.apple.com     Firefox: updates.push.services.mozilla.com
 *   Edge on Windows: *.notify.windows.com
 */
const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'push.apple.com', 'push.services.mozilla.com', 'notify.windows.com']

export function isPushServiceEndpoint(endpoint: string): boolean {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return false
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false
  if (url.port && url.port !== '443') return false
  const host = url.hostname.toLowerCase()
  if (PUSH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return true
  // Chrome also hands out FCM endpoints on Google hosts such as
  // jmt17.google.com/fcm/send/…; accept those only under /fcm/.
  return host.endsWith('.google.com') && url.pathname.startsWith('/fcm/')
}

// ─── The phone app (Expo push, migration 050) ──────────────────────────────

export interface DeviceRow {
  id: string
  user_id: string
  token: string
  platform: string
  categories: unknown
  failure_count?: number | null
}

/**
 * An Expo push token, ExponentPushToken[…]. Mirrored in migration 050
 * (public.is_expo_push_token) — change both together.
 */
export function isExpoPushToken(token: unknown): token is string {
  return typeof token === 'string' && /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,256}\]$/.test(token)
}

/** The phones of these users that want this kind of push. */
export function selectDevices<T extends Pick<DeviceRow, 'user_id' | 'categories' | 'token'>>(
  devices: T[],
  recipients: string[],
  kind: PushKind,
): T[] {
  const who = new Set(recipients)
  return devices.filter((d) => who.has(d.user_id) && wantsPush(d.categories, kind) && isExpoPushToken(d.token))
}

// ─── Where it leads ─────────────────────────────────────────────────────────

/** Facts the server looks up for entities whose link depends on another row. */
export interface NotificationContext {
  /** crm_rows.table_id / crm_columns.table_id for crm_row / crm_column notifications. */
  crmTableId?: string | null
  /** events.kind for event notifications. */
  eventKind?: string | null
}

/** App-relative path for a notification — notificationHref, server side. */
export function notificationPath(n: Pick<NotificationRow, 'entity' | 'entity_id'>, ctx: NotificationContext = {}): string {
  const id = n.entity_id
  switch (n.entity) {
    case 'task':
      return id ? `/tasks?task=${id}` : '/tasks'
    case 'project':
      return id ? `/projects/${id}` : '/projects'
    case 'client':
      return id ? `/clients/${id}` : '/clients'
    case 'crm_table':
      return id ? `/crm/${id}` : '/crm'
    case 'crm_row':
    case 'crm_column':
      return ctx.crmTableId ? `/crm/${ctx.crmTableId}` : '/crm'
    case 'event':
      return ctx.eventKind === 'meeting' ? '/meetings' : '/calendar'
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
 * Absolute URL inside the install that subscribed. app_base is origin + base
 * path without a trailing slash ('https://workspace.example.com' or
 * 'https://example.com/workspace'). The app root is the bare base: Next.js
 * 308-redirects '/workspace/' to '/workspace', and the scope has no slash.
 */
export function joinAppUrl(appBase: string, path: string): string {
  const base = appBase.trim().replace(/\/+$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  let hasPath = false
  try {
    hasPath = new URL(base).pathname !== '/'
  } catch {
    hasPath = false
  }
  if (hasPath && (p === '/' || p.startsWith('/?') || p.startsWith('/#'))) return `${base}${p.slice(1)}`
  return `${base}${p}`
}

// ─── What it says ───────────────────────────────────────────────────────────

/** Cut to `max` characters (code points, so an emoji is never split), ending in '…'. */
export function truncate(text: string, max: number): string {
  const chars = Array.from(text)
  if (chars.length <= max) return text
  return `${chars.slice(0, Math.max(max - 1, 0)).join('').trimEnd()}…`
}

/** One line of a message for a notification body: whitespace collapsed, ≤ max chars. */
export function preview(text: string | null | undefined, max = 140): string {
  return truncate((text ?? '').replace(/\s+/g, ' ').trim(), max)
}

export const TITLE_MAX = 120
export const BODY_MAX = 140

export interface PushContent {
  kind: PushKind
  title: string
  body?: string
  /** App-relative path, e.g. '/messages/<id>'. */
  path: string
  tag: string
  renotify?: boolean
  silent?: boolean
  /** Epoch milliseconds of the event. */
  timestamp?: number
  /** The notifications row this stands in for; the phone app marks it read on tap. */
  notificationId?: string
}

function epoch(iso: string | null | undefined): number | undefined {
  if (!iso) return undefined
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : undefined
}

export function notificationContent(n: NotificationRow, ctx: NotificationContext = {}): PushContent {
  const body = n.body ? preview(n.body, BODY_MAX) : ''
  return {
    kind: categoryOf(n.type),
    title: truncate(n.title?.trim() || 'DeskDev', TITLE_MAX),
    body: body || undefined,
    path: notificationPath(n, ctx),
    tag: `notif:${n.id}`,
    timestamp: epoch(n.created_at),
    notificationId: n.id,
  }
}

function nameOf(profiles: ProfileRow[], id: string | null | undefined): string | undefined {
  if (!id) return undefined
  return profiles.find((p) => p.id === id)?.full_name?.trim() || undefined
}

/** conversationTitle() from lib/chat.ts: group name, or the other people as seen by `viewerId`. */
export function conversationTitleFor(conv: ConversationRow, profiles: ProfileRow[], viewerId: string): string {
  if (conv.title?.trim()) return conv.title.trim()
  const others = conv.participant_ids
    .filter((id) => id !== viewerId)
    .map((id) => nameOf(profiles, id))
    .filter((n): n is string => Boolean(n))
  if (others.length === 0) return 'Unknown user'
  if (others.length <= 3) return others.join(', ')
  return `${others.slice(0, 2).join(', ')} +${others.length - 2}`
}

/** "Sender · Group" for groups, "Sender" for a DM — like the in-app popup. */
export function chatContent(
  msg: MessageRow,
  conv: ConversationRow,
  profiles: ProfileRow[],
  recipientId: string,
): PushContent {
  const sender = nameOf(profiles, msg.sender_id)
  const thread = conversationTitleFor(conv, profiles, recipientId)
  const title = conv.is_group && sender ? `${sender} · ${thread}` : sender ?? thread
  return {
    kind: 'messages',
    title: truncate(title, TITLE_MAX),
    body: preview(msg.body, BODY_MAX) || undefined,
    path: `/messages/${msg.conversation_id}`,
    tag: `chat:${msg.conversation_id}`,
    // Same tag for the whole thread, so a burst replaces itself — but each new
    // line should still buzz.
    renotify: true,
    timestamp: epoch(msg.created_at),
  }
}

export function testContent(now: number = Date.now()): PushContent {
  return {
    kind: 'test',
    title: 'DeskDev',
    body: 'Push notifications are working.',
    path: '/notifications',
    tag: 'deskdev-test',
    renotify: true,
    timestamp: now,
  }
}

// ─── Delivery hints ─────────────────────────────────────────────────────────

export type Urgency = 'very-low' | 'low' | 'normal' | 'high'

/**
 * TTL: how long the push service keeps it for an offline device. A chat line
 * or mention a day late is noise; a task change is still worth seeing after a
 * weekend. Urgency 'high' wakes a dozing phone; the rest can wait for it.
 * Leads are speed-to-lead: wake the phone, and a day-old alert is stale (the
 * SLA sweep will have escalated by then).
 */
export function deliveryFor(kind: PushKind): { ttl: number; urgency: Urgency } {
  switch (kind) {
    case 'messages':
    case 'mentions':
    case 'leads':
      return { ttl: 24 * 3600, urgency: 'high' }
    case 'test':
      return { ttl: 3600, urgency: 'high' }
    default:
      return { ttl: 72 * 3600, urgency: 'normal' }
  }
}

/** FNV-1a 32-bit, hex. Only for shortening topics deterministically. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * RFC 8030 Topic: ≤ 32 characters of the URL-safe base64 alphabet. A newer
 * push with the same topic replaces one still waiting at the push service, so
 * an offline phone gets the latest line of a chat, not twenty. Long tags keep
 * a readable prefix plus a hash of the whole tag.
 */
export function topicFor(tag: string): string {
  const clean = tag.replace(/[^A-Za-z0-9_-]/g, '-')
  if (clean.length > 0 && clean.length <= 32) return clean
  return `${clean.slice(0, 23)}-${fnv1a(tag)}`
}

// ─── The payload ────────────────────────────────────────────────────────────

/**
 * Declarative Web Push (WebKit, iOS/iPadOS 18.4+, macOS Safari 18.5+): the OS
 * shows `notification` itself, no service worker needed. Older browsers hand
 * the same JSON to the service worker's push handler (site/src/deskdev/pwa/
 * sw/sw.js), which reads it too. `mutable: true` lets the worker override it.
 *
 * tag / renotify / timestamp / app_badge appear twice on purpose: the Push
 * API draft reads tag, renotify and timestamp from `notification`, WebKit
 * moved app_badge to the top level (May 2025), and DeskDev's own contract put
 * them the other way round. Parsers ignore members they do not read.
 */
export interface DeclarativePush {
  web_push: 8030
  notification: {
    title: string
    body?: string
    navigate: string
    lang: 'en'
    dir: 'ltr'
    silent?: boolean
    tag?: string
    renotify?: boolean
    timestamp?: number
    app_badge?: number
  }
  mutable: true
  app_badge?: number
  tag?: string
  renotify?: boolean
  timestamp?: number
}

/**
 * Apple caps the payload at 4 KB, and the encrypted record adds 103 bytes
 * (86-byte header, padding delimiter, 16-byte tag). Stay well clear.
 */
export const MAX_PAYLOAD_BYTES = 3072

export function payloadBytes(payload: DeclarativePush): number {
  return new TextEncoder().encode(JSON.stringify(payload)).length
}

function assemble(c: PushContent, navigate: string, title: string, body: string | undefined, badge: number | undefined): DeclarativePush {
  const notification: DeclarativePush['notification'] = { title, navigate, lang: 'en', dir: 'ltr' }
  if (body) notification.body = body
  if (c.silent) notification.silent = true
  notification.tag = c.tag
  if (c.renotify) notification.renotify = true
  if (c.timestamp !== undefined) notification.timestamp = c.timestamp
  if (badge !== undefined) notification.app_badge = badge

  const out: DeclarativePush = { web_push: 8030, notification, mutable: true }
  if (badge !== undefined) out.app_badge = badge
  out.tag = c.tag
  if (c.renotify) out.renotify = true
  if (c.timestamp !== undefined) out.timestamp = c.timestamp
  return out
}

/**
 * The JSON for one subscription. `badge` is the recipient's unread count
 * (notifications + chat), or null/undefined to leave the icon alone. Shrinks
 * the body, then the title, until the payload fits MAX_PAYLOAD_BYTES.
 */
export function buildPayload(c: PushContent, appBase: string, badge?: number | null): DeclarativePush {
  const navigate = joinAppUrl(appBase, c.path)
  const b = typeof badge === 'number' && Number.isFinite(badge) && badge >= 0 ? Math.floor(badge) : undefined
  let title = c.title.trim() || 'DeskDev'
  let body = c.body
  let payload = assemble(c, navigate, title, body, b)
  while (payloadBytes(payload) > MAX_PAYLOAD_BYTES) {
    if (body && Array.from(body).length > 1) {
      body = truncate(body, Math.floor(Array.from(body).length / 2))
    } else if (body) {
      body = undefined
    } else if (Array.from(title).length > 8) {
      title = truncate(title, Math.floor(Array.from(title).length / 2))
    } else {
      break // Only the navigate URL is left, and that cannot shrink.
    }
    payload = assemble(c, navigate, title, body, b)
  }
  return payload
}

// ─── The phone app's message (Expo push API) ────────────────────────────────

/** Created by the app (lib/push.ts) and named as the plugin's defaultChannel in app.json. */
export const ANDROID_CHANNEL = 'default'

/** Expo takes at most 100 messages per request. */
export const EXPO_BATCH = 100

/**
 * One message for https://exp.host/--/api/v2/push/send. `data.path` is the
 * web app's path for the same notification (notificationPath); the phone app
 * maps it to its own screen (mobile/src/lib/pushRoute.ts).
 */
export interface ExpoMessage {
  to: string
  title: string
  body?: string
  data: { path: string; notificationId?: string }
  sound: 'default'
  /** iOS icon badge; Android launchers count notifications themselves. */
  badge?: number
  priority: 'high' | 'default'
  ttl: number
  channelId: string
  /** iOS: one group per chat, like the Messages app. */
  threadId?: string
}

export function expoMessage(c: PushContent, token: string, badge?: number | null): ExpoMessage {
  const { ttl, urgency } = deliveryFor(c.kind)
  const msg: ExpoMessage = {
    to: token,
    title: c.title.trim() || 'DeskDev',
    data: { path: c.path },
    sound: 'default',
    // 'default' is APNs priority 10 and FCM normal: on time, without waking a
    // dozing Android phone for a task change.
    priority: urgency === 'high' ? 'high' : 'default',
    ttl,
    channelId: ANDROID_CHANNEL,
  }
  if (c.body) msg.body = c.body
  if (c.notificationId) msg.data.notificationId = c.notificationId
  if (typeof badge === 'number' && Number.isFinite(badge) && badge >= 0) msg.badge = Math.floor(badge)
  if (c.tag.startsWith('chat:')) msg.threadId = c.tag
  return msg
}

/** A push ticket, one per message, in the order sent. */
export interface ExpoTicket {
  status?: string
  id?: string
  message?: string
  details?: { error?: string } | null
}

/**
 * ok → sent; DeviceNotRegistered → the app was uninstalled or the token
 * rolled, drop the row; anything else (MessageRateExceeded, InvalidCredentials,
 * MismatchSenderId …) counts as a failure kept for diagnosis — those are
 * usually our FCM / APNs setup, not the phone.
 */
export function classifyExpoTicket(ticket: ExpoTicket | null | undefined): { outcome: SendOutcome; reason?: string } {
  if (ticket?.status === 'ok') return { outcome: 'sent' }
  const code = ticket?.details?.error
  if (code === 'DeviceNotRegistered') return { outcome: 'gone', reason: code }
  return { outcome: 'failed', reason: code ?? ticket?.message ?? 'no ticket' }
}

// ─── Plumbing helpers ───────────────────────────────────────────────────────

export type SendOutcome = 'sent' | 'gone' | 'failed'

/** 2xx delivered; 404/410 the subscription is dead and should be deleted. */
export function classifyStatus(status: number): SendOutcome {
  if (status >= 200 && status < 300) return 'sent'
  if (status === 404 || status === 410) return 'gone'
  return 'failed'
}

/**
 * VAPID `sub` must be a real contact. Apple answers 403 BadJwtToken for
 * anything else, including mailto:…@localhost.
 */
export function isValidVapidSubject(subject: string | null | undefined): boolean {
  const s = (subject ?? '').trim()
  if (/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(s)) return !/@localhost$/i.test(s)
  if (/^https:\/\//i.test(s)) {
    try {
      const host = new URL(s).hostname
      return host !== 'localhost' && host.includes('.')
    } catch {
      return false
    }
  }
  return false
}

/** Equality that takes the same time wherever the first difference is. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

export type TriggerCall = { type: 'notification' | 'message'; id: string }

/** The body migration 029's triggers send: {type, record: {id, …}}. */
export function parseTriggerBody(raw: unknown): TriggerCall | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { type?: unknown; record?: { id?: unknown } | null }
  if (r.type !== 'notification' && r.type !== 'message') return null
  const id = r.record?.id
  return isUuid(id) ? { type: r.type, id } : null
}
