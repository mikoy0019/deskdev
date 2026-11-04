// @vitest-environment node
// (jsdom's `crypto` has no `subtle`; the Web Push adapter needs WebCrypto.)
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import {
  DEFAULT_NOTIFY_PREFS,
  NOTIFY_CATEGORIES as APP_CATEGORIES,
  categoryOf as appCategoryOf,
  notificationHref,
} from '../lib/notifications'
import type { NotificationType } from '../lib/types'
import {
  ANDROID_CHANNEL,
  BODY_MAX,
  DEFAULT_PUSH_CATEGORIES,
  MAX_PAYLOAD_BYTES,
  NOTIFY_CATEGORIES,
  buildPayload,
  categoryOf,
  chatContent,
  classifyExpoTicket,
  classifyStatus,
  constantTimeEqual,
  conversationTitleFor,
  deliveryFor,
  expoMessage,
  isExpoPushToken,
  isPushServiceEndpoint,
  selectDevices,
  isValidVapidSubject,
  joinAppUrl,
  messageRecipients,
  normalizeCategories,
  notificationContent,
  notificationPath,
  parseTriggerBody,
  payloadBytes,
  preview,
  selectSubscriptions,
  shouldPushNotification,
  testContent,
  topicFor,
  truncate,
  wantsPush,
  type ConversationRow,
  type MessageRow,
  type NotificationRow,
  type ProfileRow,
} from '../../../../supabase/functions/send-push/logic'
import {
  b64urlDecode,
  b64urlEncode,
  encryptPayload,
  importVapid,
  sendWebPush,
  vapidJwt,
} from '../../../../supabase/functions/send-push/webpush'

// Every NotificationType, checked by the compiler: a new type added to
// lib/types.ts without a line here fails the typecheck, and its category is
// then compared below.
const ALL_TYPES: Record<NotificationType, true> = {
  task_assigned: true,
  task_updated: true,
  project_updated: true,
  client_updated: true,
  crm_updated: true,
  event_updated: true,
  meeting_updated: true,
  due_reminder: true,
  channel_mention: true,
  system: true,
  lead_new: true,
  lead_sla: true,
  lead_followup: true,
  lead_assigned: true,
  showcase_ready: true,
  form_submitted: true,
  meeting_booked: true,
  email_received: true,
}
const TYPES = Object.keys(ALL_TYPES) as NotificationType[]

const ME = '11111111-1111-4111-8111-111111111111'
const ANA = '22222222-2222-4222-8222-222222222222'
const BEN = '33333333-3333-4333-8333-333333333333'
const CY = '44444444-4444-4444-8444-444444444444'
const CONV = '55555555-5555-4555-8555-555555555555'
const NOTE = '66666666-6666-4666-8666-666666666666'

const SITE_BASE = 'https://nixgensolutions.com/workspace'
const APP_BASE = 'https://workspace.nixgensolutions.com'
const FCM = 'https://fcm.googleapis.com/fcm/send/abc:def'

function note(over: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: NOTE,
    user_id: ME,
    actor_id: ANA,
    type: 'task_assigned',
    title: "Ana assigned you 'Fix login'",
    body: null,
    entity: 'task',
    entity_id: 'task-1',
    read: false,
    created_at: '2026-10-02T08:00:00.000Z',
    ...over,
  }
}

const people: ProfileRow[] = [
  { id: ME, full_name: 'Me Myself' },
  { id: ANA, full_name: 'Ana' },
  { id: BEN, full_name: 'Ben' },
  { id: CY, full_name: 'Cy' },
]

// ─── Category parity ────────────────────────────────────────────────────────

describe('categories mirror the web app', () => {
  it('categoryOf matches lib/notifications.ts for every NotificationType', () => {
    for (const t of TYPES) expect(categoryOf(t), t).toBe(appCategoryOf(t))
  })

  it('unknown types fall to workspace in both', () => {
    expect(categoryOf('something_new')).toBe('workspace')
    expect(appCategoryOf('something_new' as NotificationType)).toBe('workspace')
  })

  it('sends lead types to the leads switch and showcase drafts to workspace', () => {
    for (const t of ['lead_new', 'lead_sla', 'lead_followup', 'lead_assigned']) expect(categoryOf(t), t).toBe('leads')
    expect(categoryOf('showcase_ready')).toBe('workspace')
  })

  it('has the same category keys and defaults', () => {
    expect([...NOTIFY_CATEGORIES].sort()).toEqual(APP_CATEGORIES.map((c) => c.key).sort())
    expect(DEFAULT_PUSH_CATEGORIES).toEqual(DEFAULT_NOTIFY_PREFS.categories)
  })

  it('pushes website leads under their own switch, on by default', () => {
    expect(categoryOf('lead_new')).toBe('leads')
    expect(wantsPush(null, 'leads')).toBe(true)
    // A subscription saved before 033 has no 'leads' key: still on.
    expect(wantsPush({ mentions: true, workspace: false }, 'leads')).toBe(true)
    expect(wantsPush({ leads: false }, 'leads')).toBe(false)
  })

  it('normalizes stored categories', () => {
    expect(normalizeCategories(null)).toEqual(DEFAULT_PUSH_CATEGORIES)
    expect(normalizeCategories([])).toEqual(DEFAULT_PUSH_CATEGORIES)
    expect(normalizeCategories({ tasks: false, workspace: 'yes', bogus: true })).toEqual({
      ...DEFAULT_PUSH_CATEGORIES,
      tasks: false,
    })
  })

  it('reads a row stored before 033 (no leads key) as leads on', () => {
    const before033 = { mentions: true, messages: true, tasks: true, reminders: true, workspace: false }
    expect(normalizeCategories(before033).leads).toBe(true)
    expect(normalizeCategories({ ...before033, leads: false }).leads).toBe(false)
  })
})

// ─── Links ──────────────────────────────────────────────────────────────────

describe('notificationPath', () => {
  const ctxApp = {
    crmRows: [{ id: 'row-1', tableId: 'tbl-1' }],
    crmColumns: [{ id: 'col-1', tableId: 'tbl-2' }],
    events: [
      { id: 'ev-1', kind: 'meeting' as const },
      { id: 'ev-2', kind: 'event' as const },
    ],
  }
  const cases: { entity: string | null; id: string | null; ctx?: { crmTableId?: string; eventKind?: string } }[] = [
    { entity: 'task', id: 't-1' },
    { entity: 'task', id: null },
    { entity: 'project', id: 'p-1' },
    { entity: 'project', id: null },
    { entity: 'client', id: 'c-1' },
    { entity: 'client', id: null },
    { entity: 'crm_table', id: 'tbl-9' },
    { entity: 'crm_table', id: null },
    { entity: 'crm_row', id: 'row-1', ctx: { crmTableId: 'tbl-1' } },
    { entity: 'crm_row', id: 'row-missing' },
    { entity: 'crm_column', id: 'col-1', ctx: { crmTableId: 'tbl-2' } },
    { entity: 'event', id: 'ev-1', ctx: { eventKind: 'meeting' } },
    { entity: 'event', id: 'ev-2', ctx: { eventKind: 'event' } },
    { entity: 'event', id: 'ev-missing' },
    { entity: 'channel', id: 'ch-1' },
    { entity: 'channel', id: null },
    { entity: 'conversation', id: 'cv-1' },
    { entity: 'conversation', id: null },
    { entity: 'lead', id: 'ld-1' },
    { entity: 'lead', id: null },
    { entity: 'showcase', id: 'sc-1' },
    { entity: 'showcase', id: null },
    { entity: null, id: null },
    { entity: 'something', id: 'x' },
  ]

  it('matches notificationHref for every entity', () => {
    for (const c of cases) {
      const server = notificationPath({ entity: c.entity, entity_id: c.id }, c.ctx)
      const client = notificationHref({ entity: c.entity ?? undefined, entityId: c.id ?? undefined }, ctxApp)
      expect(server, `${c.entity}:${c.id}`).toBe(client)
    }
  })
})

describe('joinAppUrl', () => {
  it('joins onto a subdomain base (origin only)', () => {
    expect(joinAppUrl(APP_BASE, '/messages/abc')).toBe('https://workspace.nixgensolutions.com/messages/abc')
    expect(joinAppUrl(APP_BASE, '/')).toBe('https://workspace.nixgensolutions.com/')
    expect(joinAppUrl(`${APP_BASE}/`, 'tasks?task=1')).toBe('https://workspace.nixgensolutions.com/tasks?task=1')
  })

  it('joins onto a path base without ever producing /workspace/', () => {
    expect(joinAppUrl(SITE_BASE, '/messages/abc')).toBe('https://nixgensolutions.com/workspace/messages/abc')
    expect(joinAppUrl(SITE_BASE, '/')).toBe('https://nixgensolutions.com/workspace')
    expect(joinAppUrl(`${SITE_BASE}/`, '/?x=1')).toBe('https://nixgensolutions.com/workspace?x=1')
    expect(joinAppUrl('http://localhost:6969/workspace', '/tasks?task=t1')).toBe(
      'http://localhost:6969/workspace/tasks?task=t1',
    )
  })
})

// ─── Who gets one ───────────────────────────────────────────────────────────

describe('shouldPushNotification', () => {
  it('skips read rows and your own actions, except due reminders', () => {
    expect(shouldPushNotification(note())).toBe(true)
    expect(shouldPushNotification(note({ read: true }))).toBe(false)
    expect(shouldPushNotification(note({ actor_id: ME }))).toBe(false)
    expect(shouldPushNotification(note({ actor_id: ME, type: 'due_reminder' }))).toBe(true)
    expect(shouldPushNotification(note({ actor_id: null, read: null }))).toBe(true)
  })
})

describe('messageRecipients', () => {
  it('is everyone but the sender, once each', () => {
    expect(messageRecipients({ participant_ids: [ME, ANA, BEN, ANA] }, ANA).sort()).toEqual([BEN, ME].sort())
    expect(messageRecipients({ participant_ids: [ME, ANA] }, null).sort()).toEqual([ANA, ME].sort())
  })
})

describe('selectSubscriptions', () => {
  const subs = [
    { id: 's1', user_id: ME, endpoint: FCM, categories: DEFAULT_PUSH_CATEGORIES },
    { id: 's2', user_id: ME, endpoint: 'https://web.push.apple.com/QX', categories: { messages: false } },
    { id: 's3', user_id: ANA, endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/x', categories: null },
    { id: 's4', user_id: BEN, endpoint: FCM + '2', categories: { workspace: true } },
    { id: 's5', user_id: ME, endpoint: 'https://evil.example.com/collect', categories: DEFAULT_PUSH_CATEGORIES },
  ]

  it('filters by recipient and category, with missing categories at their defaults', () => {
    expect(selectSubscriptions(subs, [ME, ANA], 'messages').map((s) => s.id)).toEqual(['s1', 's3'])
    expect(selectSubscriptions(subs, [ME, ANA, BEN], 'workspace').map((s) => s.id)).toEqual(['s4'])
    expect(selectSubscriptions(subs, [ME], 'tasks').map((s) => s.id)).toEqual(['s1', 's2'])
  })

  it('test pushes ignore the switches but never leave the list of push services', () => {
    expect(selectSubscriptions(subs, [ME], 'test').map((s) => s.id)).toEqual(['s1', 's2'])
  })
})

describe('isPushServiceEndpoint', () => {
  it('accepts the real push services', () => {
    for (const ok of [
      'https://fcm.googleapis.com/fcm/send/x',
      'https://fcm.googleapis.com/wp/x',
      'https://jmt17.google.com/fcm/send/x',
      'https://web.push.apple.com/QOk',
      'https://updates.push.services.mozilla.com/wpush/v2/x',
      'https://wns2-by3p.notify.windows.com/w/?token=x',
    ]) {
      expect(isPushServiceEndpoint(ok), ok).toBe(true)
    }
  })

  it('rejects anything else', () => {
    for (const bad of [
      'http://fcm.googleapis.com/fcm/send/x',
      'https://evilfcm.googleapis.com.example.com/x',
      'https://notfcm.googleapis.co/x',
      'https://user:pw@fcm.googleapis.com/x',
      'https://fcm.googleapis.com:8443/x',
      'https://localhost/x',
      'https://www.google.com/search?q=x',
      'https://google.com/fcm/send/x',
      'https://jmt17.google.com.example.com/fcm/send/x',
      'not a url',
    ]) {
      expect(isPushServiceEndpoint(bad), bad).toBe(false)
    }
  })
})

// ─── What it says ───────────────────────────────────────────────────────────

describe('text helpers', () => {
  it('truncates by code point and never splits an emoji', () => {
    expect(truncate('hello', 5)).toBe('hello')
    expect(truncate('hello world', 6)).toBe('hello…')
    const emoji = '😀'.repeat(10)
    const cut = truncate(emoji, 4)
    expect(cut).toBe('😀😀😀…')
    expect(Array.from(cut)).toHaveLength(4)
  })

  it('previews collapse whitespace and cap at 140', () => {
    expect(preview('  a\n\n b\tc  ')).toBe('a b c')
    const long = preview('x'.repeat(500))
    expect(Array.from(long)).toHaveLength(BODY_MAX)
    expect(long.endsWith('…')).toBe(true)
    expect(preview(null)).toBe('')
  })
})

describe('notificationContent', () => {
  it('builds title, body, link, tag and category for every type', () => {
    for (const t of TYPES) {
      const n = note({ type: t, body: 'Line one\nline two' })
      const c = notificationContent(n)
      expect(c.kind).toBe(appCategoryOf(t))
      expect(c.title).toBe(n.title)
      expect(c.body).toBe('Line one line two')
      expect(c.path).toBe('/tasks?task=task-1')
      expect(c.tag).toBe(`notif:${NOTE}`)
      expect(c.timestamp).toBe(Date.parse('2026-10-02T08:00:00.000Z'))
      expect(c.notificationId).toBe(NOTE)
    }
  })

  it('channel mentions link to the channel; no body stays absent', () => {
    const c = notificationContent(
      note({ type: 'channel_mention', entity: 'channel', entity_id: 'ch-1', title: 'Ana mentioned you in #general' }),
    )
    expect(c).toMatchObject({ kind: 'mentions', path: '/channels/ch-1', title: 'Ana mentioned you in #general' })
    expect(c.body).toBeUndefined()
  })

  it('uses the looked-up context for crm rows and events', () => {
    expect(notificationContent(note({ entity: 'crm_row', entity_id: 'r' }), { crmTableId: 'tbl' }).path).toBe('/crm/tbl')
    expect(notificationContent(note({ entity: 'event', entity_id: 'e' }), { eventKind: 'meeting' }).path).toBe('/meetings')
  })

  it('caps long titles and bodies', () => {
    const c = notificationContent(note({ title: 'T'.repeat(400), body: 'B'.repeat(4000) }))
    expect(Array.from(c.title).length).toBeLessThanOrEqual(120)
    expect(Array.from(c.body!).length).toBe(BODY_MAX)
  })
})

describe('chatContent', () => {
  const msg: MessageRow = {
    id: 'm1',
    conversation_id: CONV,
    sender_id: ANA,
    body: 'Hey, are you   around?\nNeed a hand.',
    created_at: '2026-10-02T09:30:00.000Z',
  }
  const dm: ConversationRow = { id: CONV, title: null, is_group: false, participant_ids: [ME, ANA] }
  const group: ConversationRow = { id: CONV, title: 'Launch crew', is_group: true, participant_ids: [ME, ANA, BEN] }
  const untitled: ConversationRow = { id: CONV, title: null, is_group: true, participant_ids: [ME, ANA, BEN, CY] }

  it('a DM is titled with the sender', () => {
    const c = chatContent(msg, dm, people, ME)
    expect(c).toMatchObject({
      kind: 'messages',
      title: 'Ana',
      body: 'Hey, are you around? Need a hand.',
      path: `/messages/${CONV}`,
      tag: `chat:${CONV}`,
      renotify: true,
    })
  })

  it('a group is "Sender · Group"', () => {
    expect(chatContent(msg, group, people, ME).title).toBe('Ana · Launch crew')
  })

  it('an untitled group names the others as the recipient sees them', () => {
    expect(chatContent(msg, untitled, people, ME).title).toBe('Ana · Ana, Ben, Cy')
    expect(chatContent(msg, untitled, people, BEN).title).toBe('Ana · Me Myself, Ana, Cy')
    expect(conversationTitleFor({ ...untitled, participant_ids: [ME, ANA, BEN, CY, 'x', 'y'] }, [...people, { id: 'x', full_name: 'X' }, { id: 'y', full_name: 'Y' }], ME)).toBe('Ana, Ben +3')
  })

  it('falls back to the thread name when the sender is unknown, and truncates the body at 140', () => {
    const c = chatContent({ ...msg, sender_id: null, body: 'y'.repeat(300) }, group, people, ME)
    expect(c.title).toBe('Launch crew')
    expect(Array.from(c.body!)).toHaveLength(140)
    expect(c.body!.endsWith('…')).toBe(true)
  })
})

describe('testContent', () => {
  it('says push works', () => {
    expect(testContent(1)).toMatchObject({ kind: 'test', title: 'DeskDev', body: 'Push notifications are working.', timestamp: 1 })
  })
})

// ─── The phone app (Expo) ───────────────────────────────────────────────────

const PHONE = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]'

describe('isExpoPushToken', () => {
  it('accepts both Expo token spellings', () => {
    expect(isExpoPushToken(PHONE)).toBe(true)
    expect(isExpoPushToken('ExpoPushToken[AbC-12_xyz789]')).toBe(true)
  })

  it('rejects anything else', () => {
    for (const bad of [
      '',
      'xxxxxxxxxxxxxxxxxxxxxx',
      'ExponentPushToken[]',
      'ExponentPushToken[short]',
      'ExponentPushToken[has space here]',
      `ExponentPushToken[${'a'.repeat(257)}]`,
      ' ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
      FCM,
      null,
      42,
    ]) {
      expect(isExpoPushToken(bad), String(bad)).toBe(false)
    }
  })
})

describe('selectDevices', () => {
  const devices = [
    { id: 'd1', user_id: ME, token: PHONE, categories: DEFAULT_PUSH_CATEGORIES },
    { id: 'd2', user_id: ME, token: 'ExpoPushToken[yyyyyyyyyyyy]', categories: { messages: false } },
    { id: 'd3', user_id: ANA, token: 'ExponentPushToken[zzzzzzzzzzzz]', categories: null },
    { id: 'd4', user_id: ME, token: 'not-a-token', categories: DEFAULT_PUSH_CATEGORIES },
  ]

  it('filters by recipient, category and token shape', () => {
    expect(selectDevices(devices, [ME, ANA], 'messages').map((d) => d.id)).toEqual(['d1', 'd3'])
    expect(selectDevices(devices, [ME], 'tasks').map((d) => d.id)).toEqual(['d1', 'd2'])
    expect(selectDevices(devices, [ME], 'workspace')).toEqual([])
    expect(selectDevices(devices, [ME], 'test').map((d) => d.id)).toEqual(['d1', 'd2'])
  })
})

describe('expoMessage', () => {
  it('carries the in-app path and the notification to mark read', () => {
    const m = expoMessage(notificationContent(note()), PHONE, 4)
    expect(m).toEqual({
      to: PHONE,
      title: "Ana assigned you 'Fix login'",
      data: { path: '/tasks?task=task-1', notificationId: NOTE },
      sound: 'default',
      badge: 4,
      priority: 'default',
      ttl: 259200,
      channelId: ANDROID_CHANNEL,
    })
  })

  it('a chat line is urgent, keeps its body, and groups by conversation on iOS', () => {
    const c = chatContent(
      { id: 'm1', conversation_id: CONV, sender_id: ANA, body: 'Around?', created_at: null },
      { id: CONV, title: null, is_group: false, participant_ids: [ME, ANA] },
      people,
      ME,
    )
    expect(expoMessage(c, PHONE, null)).toEqual({
      to: PHONE,
      title: 'Ana',
      body: 'Around?',
      data: { path: `/messages/${CONV}` },
      sound: 'default',
      priority: 'high',
      ttl: 86400,
      channelId: ANDROID_CHANNEL,
      threadId: `chat:${CONV}`,
    })
  })

  it('leaves the badge off when the count is unknown or nonsense', () => {
    for (const badge of [undefined, null, -1, Number.NaN]) {
      expect(expoMessage(testContent(1), PHONE, badge).badge).toBeUndefined()
    }
    expect(expoMessage(testContent(1), PHONE, 2.7).badge).toBe(2)
  })

  it('stays well under Expo\'s 4 KiB for the longest content', () => {
    const c = notificationContent(note({ title: 'T'.repeat(500), body: 'B'.repeat(4000) }))
    expect(new TextEncoder().encode(JSON.stringify(expoMessage(c, PHONE, 999))).length).toBeLessThan(1024)
  })
})

describe('classifyExpoTicket', () => {
  it('ok is sent; DeviceNotRegistered is gone; the rest fail with a reason', () => {
    expect(classifyExpoTicket({ status: 'ok', id: 'r1' })).toEqual({ outcome: 'sent' })
    expect(classifyExpoTicket({ status: 'error', message: 'x', details: { error: 'DeviceNotRegistered' } }))
      .toEqual({ outcome: 'gone', reason: 'DeviceNotRegistered' })
    expect(classifyExpoTicket({ status: 'error', details: { error: 'InvalidCredentials' } }))
      .toEqual({ outcome: 'failed', reason: 'InvalidCredentials' })
    expect(classifyExpoTicket({ status: 'error', message: 'HTTP 503' })).toEqual({ outcome: 'failed', reason: 'HTTP 503' })
    expect(classifyExpoTicket(undefined)).toEqual({ outcome: 'failed', reason: 'no ticket' })
  })
})

// ─── Payload ────────────────────────────────────────────────────────────────

describe('buildPayload', () => {
  it('is Declarative Web Push with an absolute in-app navigate URL', () => {
    const c = chatContent(
      { id: 'm', conversation_id: CONV, sender_id: ANA, body: 'hi', created_at: '2026-10-02T09:30:00.000Z' },
      { id: CONV, title: null, is_group: false, participant_ids: [ME, ANA] },
      people,
      ME,
    )
    const p = buildPayload(c, APP_BASE, 3)
    expect(p).toEqual({
      web_push: 8030,
      notification: {
        title: 'Ana',
        body: 'hi',
        navigate: `https://workspace.nixgensolutions.com/messages/${CONV}`,
        lang: 'en',
        dir: 'ltr',
        tag: `chat:${CONV}`,
        renotify: true,
        timestamp: Date.parse('2026-10-02T09:30:00.000Z'),
        app_badge: 3,
      },
      mutable: true,
      app_badge: 3,
      tag: `chat:${CONV}`,
      renotify: true,
      timestamp: Date.parse('2026-10-02T09:30:00.000Z'),
    })
    expect(buildPayload(c, SITE_BASE).notification.navigate).toBe(
      `https://nixgensolutions.com/workspace/messages/${CONV}`,
    )
  })

  it('leaves the badge out when unknown, and keeps 0 (which clears it)', () => {
    const p = buildPayload(testContent(1), APP_BASE, null)
    expect('app_badge' in p).toBe(false)
    expect('app_badge' in p.notification).toBe(false)
    expect(buildPayload(testContent(1), APP_BASE, 0).app_badge).toBe(0)
    expect(buildPayload(testContent(1), APP_BASE, -4).app_badge).toBeUndefined()
  })

  it('test push opens the notifications page', () => {
    expect(buildPayload(testContent(1), SITE_BASE).notification.navigate).toBe(
      'https://nixgensolutions.com/workspace/notifications',
    )
  })

  it('stays under 4 KB even with oversized, multibyte content', () => {
    const huge = {
      ...testContent(1),
      title: '漢字😀'.repeat(2000),
      body: '😀'.repeat(5000),
      tag: `chat:${CONV}`,
    }
    const p = buildPayload(huge, `${APP_BASE}/${'a'.repeat(400)}`, 99)
    expect(payloadBytes(p)).toBeLessThanOrEqual(MAX_PAYLOAD_BYTES)
    expect(payloadBytes(p) + 103).toBeLessThan(4096) // + aes128gcm header, delimiter and tag
    expect(p.notification.title.length).toBeGreaterThan(0)
  })

  it('every real-world payload is far below the limit', () => {
    for (const t of TYPES) {
      const c = notificationContent(note({ type: t, title: 'T'.repeat(500), body: 'B'.repeat(4000) }))
      expect(payloadBytes(buildPayload(c, SITE_BASE, 120))).toBeLessThan(1024)
    }
  })
})

describe('delivery hints', () => {
  it('TTL and urgency per kind', () => {
    expect(deliveryFor('messages')).toEqual({ ttl: 86400, urgency: 'high' })
    expect(deliveryFor('mentions')).toEqual({ ttl: 86400, urgency: 'high' })
    expect(deliveryFor('tasks')).toEqual({ ttl: 259200, urgency: 'normal' })
    expect(deliveryFor('reminders')).toEqual({ ttl: 259200, urgency: 'normal' })
    expect(deliveryFor('workspace')).toEqual({ ttl: 259200, urgency: 'normal' })
    expect(deliveryFor('leads')).toEqual({ ttl: 86400, urgency: 'high' })
    expect(deliveryFor('test').urgency).toBe('high')
  })

  it('topics are ≤ 32 URL-safe characters, stable, and distinct per thread', () => {
    const a = topicFor(`chat:${CONV}`)
    const b = topicFor(`chat:${ANA}`)
    for (const t of [a, b, topicFor(`notif:${NOTE}`), topicFor('deskdev-test'), topicFor('')]) {
      expect(t.length).toBeGreaterThan(0)
      expect(t.length).toBeLessThanOrEqual(32)
      expect(t).toMatch(/^[A-Za-z0-9_-]+$/)
    }
    expect(a).toBe(topicFor(`chat:${CONV}`))
    expect(a).not.toBe(b)
    expect(topicFor('deskdev-test')).toBe('deskdev-test')
  })

  it('maps push service statuses', () => {
    expect(classifyStatus(201)).toBe('sent')
    expect(classifyStatus(200)).toBe('sent')
    expect(classifyStatus(404)).toBe('gone')
    expect(classifyStatus(410)).toBe('gone')
    for (const s of [0, 400, 403, 413, 429, 500]) expect(classifyStatus(s)).toBe('failed')
  })
})

describe('plumbing', () => {
  it('validates the VAPID subject the way Apple does', () => {
    expect(isValidVapidSubject('mailto:ops@nixgensolutions.com')).toBe(true)
    expect(isValidVapidSubject('https://nixgensolutions.com')).toBe(true)
    expect(isValidVapidSubject('mailto:me@localhost')).toBe(false)
    expect(isValidVapidSubject('https://localhost')).toBe(false)
    expect(isValidVapidSubject('ops@nixgensolutions.com')).toBe(false)
    expect(isValidVapidSubject('')).toBe(false)
  })

  it('compares secrets in constant time', () => {
    const e = new TextEncoder()
    expect(constantTimeEqual(e.encode('abc'), e.encode('abc'))).toBe(true)
    expect(constantTimeEqual(e.encode('abc'), e.encode('abd'))).toBe(false)
    expect(constantTimeEqual(e.encode('abc'), e.encode('abcd'))).toBe(false)
    expect(constantTimeEqual(new Uint8Array(), new Uint8Array())).toBe(true)
  })

  it('parses only well-formed trigger bodies', () => {
    expect(parseTriggerBody({ type: 'notification', record: { id: NOTE, user_id: ME } })).toEqual({ type: 'notification', id: NOTE })
    expect(parseTriggerBody({ type: 'message', record: { id: CONV } })).toEqual({ type: 'message', id: CONV })
    expect(parseTriggerBody({ type: 'test' })).toBeNull()
    expect(parseTriggerBody({ type: 'message', record: { id: 'nope' } })).toBeNull()
    expect(parseTriggerBody(null)).toBeNull()
  })
})

// ─── Web Push adapter (RFC 8291 / RFC 8292) ─────────────────────────────────

const subtle = globalThis.crypto.subtle

function bytes(b64: string): Uint8Array<ArrayBuffer> {
  const raw = b64urlDecode(b64.replace(/\s+/g, ''))
  const out = new Uint8Array(raw.length)
  out.set(raw)
  return out
}

function ecJwk(pub: Uint8Array, d?: Uint8Array): JsonWebKey {
  return {
    kty: 'EC',
    crv: 'P-256',
    x: b64urlEncode(pub.slice(1, 33)),
    y: b64urlEncode(pub.slice(33, 65)),
    ...(d ? { d: b64urlEncode(d) } : {}),
  }
}

async function hmac(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const k = await subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await subtle.sign('HMAC', k, data))
}

function cat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** The receiving browser's side, written independently from the adapter. */
async function decrypt(body: Uint8Array, uaPublic: Uint8Array, uaPrivate: Uint8Array, auth: Uint8Array): Promise<string> {
  const salt = body.slice(0, 16)
  const idlen = body[20]
  const asPublic = body.slice(21, 21 + idlen)
  const cipher = body.slice(21 + idlen)
  const priv = await subtle.importKey('jwk', ecJwk(uaPublic, uaPrivate), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
  const pub = await subtle.importKey('raw', cat(asPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdh = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256))
  const enc = new TextEncoder()
  const prkKey = await hmac(cat(auth), ecdh)
  const ikm = (await hmac(prkKey, cat(enc.encode('WebPush: info\0'), uaPublic, asPublic, new Uint8Array([1])))).slice(0, 32)
  const prk = await hmac(cat(salt), ikm)
  const cek = (await hmac(prk, cat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16)
  const nonce = (await hmac(prk, cat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12)
  const key = await subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['decrypt'])
  const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, cat(cipher)))
  expect(plain[plain.length - 1]).toBe(2) // last-record delimiter
  return new TextDecoder().decode(plain.slice(0, -1))
}

/** A browser-like subscription made with node:crypto, as base64url strings. */
function fakeSubscription() {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = privateKey.export({ format: 'jwk' })
  const pub = cat(new Uint8Array([4]), b64urlDecode(jwk.x!), b64urlDecode(jwk.y!))
  const auth = globalThis.crypto.getRandomValues(new Uint8Array(16))
  return { pub, priv: b64urlDecode(jwk.d!), auth, p256dh: b64urlEncode(pub), authB64: b64urlEncode(auth) }
}

/** A VAPID pair in the format scripts/generate-vapid-keys.mjs prints. */
function vapidStrings() {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = privateKey.export({ format: 'jwk' })
  const pub = cat(new Uint8Array([4]), b64urlDecode(jwk.x!), b64urlDecode(jwk.y!))
  return { publicKey: b64urlEncode(pub), privateKey: jwk.d! }
}

describe('encryptPayload (RFC 8291)', () => {
  // RFC 8291 §5 and Appendix A.
  const plaintext = 'When I grow up, I want to be a watermelon'
  const asPublic = bytes('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8')
  const asPrivate = bytes('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw')
  const uaPublic = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'
  const uaPrivate = bytes('q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94')
  const auth = 'BTBZMqHH6r4Tts7J_aSIgg'
  const salt = bytes('DGv6ra1nlYgDCS1FRnbzlw')
  const expected = `DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml
    mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT
    pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN`.replace(/\s+/g, '')

  it('reproduces the RFC 8291 example byte for byte', async () => {
    const localKeys: CryptoKeyPair = {
      publicKey: await subtle.importKey('jwk', ecJwk(asPublic), { name: 'ECDH', namedCurve: 'P-256' }, true, []),
      privateKey: await subtle.importKey('jwk', ecJwk(asPublic, asPrivate), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']),
    }
    const out = await encryptPayload(new TextEncoder().encode(plaintext), uaPublic, auth, { salt, localKeys })
    // The RFC's example says Content-Length: 145, but its own body decodes to
    // 144 bytes (86 header + 41 plaintext + delimiter + 16 tag).
    expect(out.length).toBe(144)
    expect(b64urlEncode(out)).toBe(expected)
    expect(await decrypt(out, bytes(uaPublic), uaPrivate, bytes(auth))).toBe(plaintext)
  })

  it('round-trips a real payload with fresh keys and salt each time', async () => {
    const sub = fakeSubscription()
    const json = JSON.stringify(buildPayload(testContent(1), APP_BASE, 2))
    const a = await encryptPayload(new TextEncoder().encode(json), sub.p256dh, sub.authB64)
    const b = await encryptPayload(new TextEncoder().encode(json), sub.p256dh, sub.authB64)
    expect(b64urlEncode(a)).not.toBe(b64urlEncode(b))
    expect(b64urlEncode(a.slice(21, 86))).not.toBe(b64urlEncode(b.slice(21, 86))) // new sender key per message
    expect(await decrypt(a, sub.pub, sub.priv, sub.auth)).toBe(json)
    expect(await decrypt(b, sub.pub, sub.priv, sub.auth)).toBe(json)
  })

  it('rejects malformed subscription keys', async () => {
    await expect(encryptPayload(new Uint8Array(1), 'AAAA', 'BTBZMqHH6r4Tts7J_aSIgg')).rejects.toThrow()
    await expect(encryptPayload(new Uint8Array(1), uaPublic, 'AAAA')).rejects.toThrow()
  })
})

describe('VAPID (RFC 8292)', () => {
  it('imports the generated key format and signs a verifiable ES256 JWT', async () => {
    const keys = vapidStrings()
    const vapid = await importVapid(keys.publicKey, keys.privateKey, 'mailto:ops@nixgensolutions.com')
    const now = Date.parse('2026-10-02T10:00:00Z')
    const jwt = await vapidJwt(vapid, 'https://web.push.apple.com', now)
    const [h, c, s] = jwt.split('.')
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(h)))).toEqual({ typ: 'JWT', alg: 'ES256' })
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(c)))
    expect(claims.aud).toBe('https://web.push.apple.com')
    expect(claims.sub).toBe('mailto:ops@nixgensolutions.com')
    expect(claims.exp - now / 1000).toBeGreaterThan(3600)
    expect(claims.exp - now / 1000).toBeLessThanOrEqual(24 * 3600) // Apple: never more than a day out
    const verifier = await subtle.importKey('raw', bytes(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    const ok = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifier, bytes(s), new TextEncoder().encode(`${h}.${c}`))
    expect(ok).toBe(true)
    // Reused within the hour (Apple: don't refresh more than hourly).
    expect(await vapidJwt(vapid, 'https://web.push.apple.com', now + 30 * 60_000)).toBe(jwt)
    expect(await vapidJwt(vapid, 'https://fcm.googleapis.com', now)).not.toBe(jwt)
  })

  it('refuses a public key that does not belong to the private key', async () => {
    const a = vapidStrings()
    const b = vapidStrings()
    await expect(importVapid(a.publicKey, b.privateKey, 'mailto:ops@nixgensolutions.com')).rejects.toThrow(/not a pair/)
    await expect(importVapid('AAAA', a.privateKey, 'mailto:ops@nixgensolutions.com')).rejects.toThrow(/65-byte/)
  })
})

describe('sendWebPush', () => {
  it('POSTs an encrypted body with the Web Push headers', async () => {
    const keys = vapidStrings()
    const vapid = await importVapid(keys.publicKey, keys.privateKey, 'mailto:ops@nixgensolutions.com')
    const sub = fakeSubscription()
    const payload = JSON.stringify(buildPayload(testContent(1), APP_BASE, 1))
    let seen: { url: string; init: RequestInit } | undefined
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen = { url, init }
      return new Response('', { status: 201 })
    }) as unknown as typeof fetch

    const res = await sendWebPush(
      { endpoint: FCM, p256dh: sub.p256dh, auth: sub.authB64 },
      payload,
      vapid,
      { ttl: 86400, urgency: 'high', topic: topicFor(`chat:${CONV}`) },
      fakeFetch,
    )
    expect(res.status).toBe(201)
    expect(seen!.url).toBe(FCM)
    const h = seen!.init.headers as Record<string, string>
    expect(h['Content-Encoding']).toBe('aes128gcm')
    expect(h.TTL).toBe('86400')
    expect(h.Urgency).toBe('high')
    expect(h.Topic).toBe(topicFor(`chat:${CONV}`))
    expect(h.Authorization).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${keys.publicKey}$`))
    const body = new Uint8Array(seen!.init.body as ArrayBuffer)
    expect(await decrypt(body, sub.pub, sub.priv, sub.auth)).toBe(payload)
  })

  it('reports push service errors and network failures without throwing', async () => {
    const keys = vapidStrings()
    const vapid = await importVapid(keys.publicKey, keys.privateKey, 'mailto:ops@nixgensolutions.com')
    const sub = fakeSubscription()
    const target = { endpoint: 'https://web.push.apple.com/QX', p256dh: sub.p256dh, auth: sub.authB64 }
    const gone = (async () => new Response('{"reason":"Unregistered"}', { status: 410 })) as unknown as typeof fetch
    const down = (async () => {
      throw new TypeError('connection reset')
    }) as unknown as typeof fetch

    expect(await sendWebPush(target, '{}', vapid, { ttl: 60, urgency: 'normal' }, gone)).toEqual({
      status: 410,
      reason: '{"reason":"Unregistered"}',
    })
    const failed = await sendWebPush(target, '{}', vapid, { ttl: 60, urgency: 'normal' }, down)
    expect(failed.status).toBe(0)
    expect(classifyStatus(failed.status)).toBe('failed')
  })

  describe('only a malformed subscription counts as gone', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })
    const never = (async () => {
      throw new Error('must not be sent')
    }) as unknown as typeof fetch

    it('bad keys or endpoint: 410', async () => {
      const keys = vapidStrings()
      const vapid = await importVapid(keys.publicKey, keys.privateKey, 'mailto:ops@nixgensolutions.com')
      const sub = fakeSubscription()
      const opts = { ttl: 60, urgency: 'normal' } as const
      const offCurve = b64urlEncode(cat(new Uint8Array([4]), new Uint8Array(64).fill(1)))
      for (const target of [
        { endpoint: FCM, p256dh: 'AAAA', auth: sub.authB64 },
        { endpoint: FCM, p256dh: sub.p256dh, auth: 'AAAA' },
        { endpoint: FCM, p256dh: '***', auth: sub.authB64 },
        { endpoint: FCM, p256dh: offCurve, auth: sub.authB64 },
        { endpoint: 'not a url', p256dh: sub.p256dh, auth: sub.authB64 },
      ]) {
        const res = await sendWebPush(target, '{}', vapid, opts, never)
        expect(classifyStatus(res.status), JSON.stringify(target)).toBe('gone')
      }
    })

    it('a WebCrypto failure or an oversized payload on our side: failed, never gone', async () => {
      const keys = vapidStrings()
      const vapid = await importVapid(keys.publicKey, keys.privateKey, 'mailto:ops@nixgensolutions.com')
      const sub = fakeSubscription()
      const target = { endpoint: FCM, p256dh: sub.p256dh, auth: sub.authB64 }
      const opts = { ttl: 60, urgency: 'normal' } as const

      vi.spyOn(crypto.subtle, 'generateKey').mockRejectedValueOnce(new Error('ECDH unavailable'))
      const broken = await sendWebPush(target, '{}', vapid, opts, never)
      expect(broken).toEqual({ status: 0, reason: 'ECDH unavailable' })
      expect(classifyStatus(broken.status)).toBe('failed')

      const huge = await sendWebPush(target, 'x'.repeat(5000), vapid, opts, never)
      expect(huge.status).toBe(0)
      expect(classifyStatus(huge.status)).toBe('failed')
    })
  })
})
