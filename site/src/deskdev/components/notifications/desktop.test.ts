import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  reg: undefined as unknown,
  os: 'desktop' as string,
  standalone: false,
}))

vi.mock('../../pwa/serviceWorker', () => ({ getRegistration: () => Promise.resolve(h.reg) }))
vi.mock('../../pwa/platform', () => ({
  detectPlatform: () => ({ os: h.os, browser: 'other', inApp: null, isIPad: false, isMobile: h.os !== 'desktop', osVersion: null }),
  isStandalone: () => h.standalone,
}))
vi.mock('../messages/announce', () => ({ speak: vi.fn(), speechSupported: () => true }))

import { alertChannel, showDesktopNotification, testNotification } from './desktop'
import { alertTag } from '../../lib/notifications'
import {
  chatContent,
  notificationContent,
  type ConversationRow,
  type MessageRow,
  type NotificationRow,
  type ProfileRow,
} from '../../../../../supabase/functions/send-push/logic'

const constructed: { title: string; options: NotificationOptions; onclick?: () => void }[] = []
let permission: NotificationPermission

beforeEach(() => {
  permission = 'granted'
  constructed.length = 0
  h.os = 'desktop'
  h.standalone = false
  h.reg = undefined
  function FakeNotification(this: { onclick?: () => void; close: () => void }, title: string, options: NotificationOptions) {
    const entry: (typeof constructed)[number] = { title, options }
    constructed.push(entry)
    this.close = () => {}
    Object.defineProperty(this, 'onclick', {
      set: (fn: () => void) => {
        entry.onclick = fn
      },
    })
  }
  Object.defineProperty(FakeNotification, 'permission', { get: () => permission, configurable: true })
  vi.stubGlobal('Notification', FakeNotification)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('alertChannel', () => {
  const env = { visible: true, focused: true, standalone: false, coarse: false }

  it('uses an in-app toast only while someone is looking at the installed app or a touch screen', () => {
    expect(alertChannel({ ...env, standalone: true })).toBe('toast')
    expect(alertChannel({ ...env, coarse: true })).toBe('toast')
  })

  it('uses a system notification on a desktop tab, or whenever DeskDev is not in front', () => {
    expect(alertChannel(env)).toBe('system')
    expect(alertChannel({ ...env, standalone: true, visible: false })).toBe('system')
    expect(alertChannel({ ...env, coarse: true, focused: false })).toBe('system')
  })
})

describe('showDesktopNotification', () => {
  const alert = { title: 'Alex', body: 'hello', tag: 'deskdev-chat-1', href: '/messages/1' }

  it('goes through the service worker with an app-relative link and PNG icons', async () => {
    const showNotification = vi.fn(async () => {})
    h.reg = { active: {}, showNotification }
    expect(await showDesktopNotification(alert)).toBe(true)
    expect(showNotification).toHaveBeenCalledTimes(1)
    const [title, options] = showNotification.mock.calls[0] as unknown as [string, NotificationOptions & { renotify: boolean }]
    expect(title).toBe('Alex')
    expect(options).toMatchObject({
      body: 'hello',
      tag: 'deskdev-chat-1',
      renotify: true,
      icon: '/workspace/icons/icon-192.png',
      badge: '/workspace/icons/badge-96.png',
      data: { url: '/messages/1' },
    })
    expect(constructed).toHaveLength(0)
  })

  it('trims long bodies', async () => {
    const showNotification = vi.fn(async () => {})
    h.reg = { active: {}, showNotification }
    await showDesktopNotification({ ...alert, body: 'x'.repeat(300) })
    const [, options] = showNotification.mock.calls[0] as unknown as [string, NotificationOptions]
    expect(options.body).toHaveLength(140)
  })

  it('falls back to the page constructor on desktop without an active worker', async () => {
    expect(await showDesktopNotification(alert)).toBe(true)
    expect(constructed).toHaveLength(1)
    expect(constructed[0].options).toMatchObject({ data: { url: '/messages/1' } })
    expect(typeof constructed[0].onclick).toBe('function')
  })

  it('never uses the constructor on a phone (Android throws, iOS shows nothing)', async () => {
    h.os = 'android'
    expect(await showDesktopNotification(alert)).toBe(false)
    h.os = 'ios'
    h.reg = { active: null, showNotification: vi.fn() }
    expect(await showDesktopNotification(alert)).toBe(false)
    expect(constructed).toHaveLength(0)
  })

  it('shows nothing without permission', async () => {
    permission = 'default'
    const showNotification = vi.fn(async () => {})
    h.reg = { active: {}, showNotification }
    expect(await showDesktopNotification(alert)).toBe(false)
    expect(showNotification).not.toHaveBeenCalled()
  })
})

describe('testNotification', () => {
  it('tells an iPhone Safari tab to install the app', async () => {
    vi.stubGlobal('Notification', undefined)
    delete (window as unknown as Record<string, unknown>).Notification
    h.os = 'ios'
    const result = await testNotification(false)
    expect(result.shown).toBe(false)
    expect(result.reason).toMatch(/Home Screen/)
  })

  it('explains a phone whose worker is not running yet', async () => {
    h.os = 'android'
    const result = await testNotification(false)
    expect(result).toMatchObject({ shown: false, spoke: false })
    expect(result.reason).toMatch(/Reload DeskDev/)
  })

  it('resolves shown and spoke once the worker shows it', async () => {
    h.reg = { active: {}, showNotification: vi.fn(async () => {}) }
    expect(await testNotification(true)).toEqual({ shown: true, spoke: true })
  })
})

describe('alertTag', () => {
  // The page and the push for one event must share a tag, or a background tab
  // shows the same message twice.
  it('matches the tags send-push uses', () => {
    const n: NotificationRow = {
      id: 'n1', user_id: 'u1', actor_id: 'u2', type: 'mention', title: 'Ana mentioned you',
      body: null, entity: null, entity_id: null, read: false,
    }
    expect(alertTag.notification('n1')).toBe(notificationContent(n).tag)
    const msg: MessageRow = { id: 'm1', conversation_id: 'c1', sender_id: 'u2', body: 'hi' }
    const conv: ConversationRow = { id: 'c1', title: null, is_group: false, participant_ids: ['u1', 'u2'] }
    const profiles: ProfileRow[] = [{ id: 'u2', full_name: 'Ana' }]
    expect(alertTag.chat('c1')).toBe(chatContent(msg, conv, profiles, 'u1').tag)
  })
})
