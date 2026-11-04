import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Everything push.ts talks to is faked: Supabase (rpc + functions), the
// service-worker registration, the platform, the store and the prefs.
const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  invoke: vi.fn(),
  reg: undefined as unknown,
  os: 'desktop' as string,
  standalone: false,
  categories: { mentions: true, messages: true, tasks: false, reminders: true, workspace: false },
}))

vi.mock('../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    rpc: (...args: unknown[]) => h.rpc(...args),
    functions: { invoke: (...args: unknown[]) => h.invoke(...args) },
  },
}))
vi.mock('./serviceWorker', () => ({ getRegistration: () => Promise.resolve(h.reg) }))
vi.mock('./platform', () => ({
  detectPlatform: () => ({ os: h.os, browser: 'other', inApp: null, isIPad: false, isMobile: h.os !== 'desktop', osVersion: null }),
  isStandalone: () => h.standalone,
}))
vi.mock('../store/useStore', () => ({ useStore: () => null }))
vi.mock('../components/notifications/prefs', () => ({
  loadPrefs: () => ({ desktop: true, voice: false, categories: h.categories }),
  useNotifyPrefs: () => [{ desktop: true, voice: false, categories: h.categories }, () => {}],
}))

import { disablePush, enablePush, getPushState, sendTestPush, syncPushSubscription } from './push'

// A well-formed uncompressed P-256 point: 0x04 then 64 bytes.
const KEY_BYTES = new Uint8Array(65).map((_, i) => (i === 0 ? 4 : i))
const OTHER_KEY = new Uint8Array(65).map((_, i) => (i === 0 ? 4 : 200 - i))
const toB64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

type FakeSub = {
  endpoint: string
  options: { applicationServerKey: ArrayBuffer | null }
  toJSON: () => { keys: { p256dh: string; auth: string } }
  getKey: () => null
  unsubscribe: ReturnType<typeof vi.fn>
}

function fakeSub(endpoint = 'https://push.example/abc', key: Uint8Array = KEY_BYTES): FakeSub {
  return {
    endpoint,
    options: { applicationServerKey: key.slice().buffer },
    toJSON: () => ({ keys: { p256dh: 'P256DH', auth: 'AUTH' } }),
    getKey: () => null,
    unsubscribe: vi.fn(async () => true),
  }
}

let current: FakeSub | null
let fresh: FakeSub
let pushManager: { getSubscription: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> }
const permission = { value: 'default' as NotificationPermission, answer: 'granted' as NotificationPermission }
const requestPermission = vi.fn(async () => {
  permission.value = permission.answer
  return permission.answer
})

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', toB64Url(KEY_BYTES))
  vi.stubGlobal('PushManager', function PushManager() {})
  // defineProperty, not Object.assign: assign would copy the getter's value once.
  const FakeNotification = Object.defineProperties(function Notification() {}, {
    permission: { get: () => permission.value, configurable: true },
    requestPermission: { value: requestPermission, configurable: true },
  })
  vi.stubGlobal('Notification', FakeNotification)
  Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true })
  permission.value = 'default'
  permission.answer = 'granted'
  requestPermission.mockClear()
  h.os = 'desktop'
  h.standalone = false
  h.rpc.mockReset()
  h.rpc.mockResolvedValue({ data: null, error: null })
  h.invoke.mockReset()
  current = null
  fresh = fakeSub('https://push.example/new')
  pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async () => {
      current = fresh
      return fresh
    }),
  }
  h.reg = { pushManager }
  localStorage.clear()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('getPushState', () => {
  it('is unconfigured without a VAPID key, or with a malformed one', async () => {
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', '')
    expect(await getPushState()).toBe('unconfigured')
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'not-a-key')
    expect(await getPushState()).toBe('unconfigured')
  })

  it('asks iOS Safari tabs to install first, but not the installed app', async () => {
    h.os = 'ios'
    expect(await getPushState()).toBe('needs-install')
    h.standalone = true
    expect(await getPushState()).toBe('off')
  })

  it('is unsupported without the Push API', async () => {
    vi.stubGlobal('PushManager', undefined)
    // 'in' sees a stubbed undefined as present; remove it outright.
    delete (window as unknown as Record<string, unknown>).PushManager
    expect(await getPushState()).toBe('unsupported')
  })

  it('follows the permission and the subscription', async () => {
    permission.value = 'denied'
    expect(await getPushState()).toBe('denied')
    permission.value = 'granted'
    expect(await getPushState()).toBe('off')
    current = fakeSub()
    expect(await getPushState()).toBe('on')
  })
})

describe('enablePush', () => {
  it('asks for permission synchronously, inside the gesture', () => {
    void enablePush()
    // No await yet: anything after the first await is outside the tap on iOS.
    expect(requestPermission).toHaveBeenCalledTimes(1)
  })

  it('subscribes with the VAPID key and saves the row for the signed-in user', async () => {
    expect(await enablePush()).toBe('on')
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1)
    const [opts] = pushManager.subscribe.mock.calls[0] as [{ userVisibleOnly: boolean; applicationServerKey: Uint8Array }]
    expect(opts.userVisibleOnly).toBe(true)
    expect([...opts.applicationServerKey]).toEqual([...KEY_BYTES])
    expect(h.rpc).toHaveBeenCalledWith('upsert_push_subscription', {
      p_endpoint: 'https://push.example/new',
      p_p256dh: 'P256DH',
      p_auth: 'AUTH',
      p_app_base: `${window.location.origin}/workspace`,
      p_categories: h.categories,
      p_platform: 'desktop',
      p_user_agent: navigator.userAgent.slice(0, 512),
    })
    expect(localStorage.getItem('deskdev.push-enabled')).toBe('1')
  })

  it('stops at a refused or dismissed prompt', async () => {
    permission.answer = 'denied'
    expect(await enablePush()).toBe('denied')
    permission.value = 'default'
    permission.answer = 'default'
    expect(await enablePush()).toBe('off')
    expect(pushManager.subscribe).not.toHaveBeenCalled()
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('replaces a subscription made with an old VAPID key', async () => {
    const old = fakeSub('https://push.example/old', OTHER_KEY)
    current = old
    expect(await enablePush()).toBe('on')
    expect(old.unsubscribe).toHaveBeenCalled()
    expect(h.rpc.mock.calls[0][1]).toMatchObject({ p_endpoint: 'https://push.example/new' })
  })

  it('unsubscribes again and rejects when the server refuses the row', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'not allowed' } })
    await expect(enablePush()).rejects.toThrow('not allowed')
    expect(fresh.unsubscribe).toHaveBeenCalled()
    expect(localStorage.getItem('deskdev.push-enabled')).toBeNull()
  })

  it('never prompts where push cannot work', async () => {
    h.os = 'ios'
    expect(await enablePush()).toBe('needs-install')
    expect(requestPermission).not.toHaveBeenCalled()
  })
})

describe('disablePush', () => {
  it('deletes the row first, then unsubscribes and forgets the device choice', async () => {
    const sub = fakeSub()
    current = sub
    localStorage.setItem('deskdev.push-enabled', '1')
    const order: string[] = []
    h.rpc.mockImplementation(async () => {
      order.push('rpc')
      return { data: null, error: null }
    })
    sub.unsubscribe.mockImplementation(async () => {
      order.push('unsubscribe')
      return true
    })
    await disablePush()
    expect(h.rpc).toHaveBeenCalledWith('delete_push_subscription', { p_endpoint: sub.endpoint })
    expect(order).toEqual(['rpc', 'unsubscribe'])
    expect(localStorage.getItem('deskdev.push-enabled')).toBeNull()
  })

  it('on sign-out keeps the browser subscription (iOS needs a tap to make a new one)', async () => {
    const sub = fakeSub()
    current = sub
    localStorage.setItem('deskdev.push-enabled', '1')
    await disablePush({ unsubscribe: false })
    expect(h.rpc).toHaveBeenCalledWith('delete_push_subscription', { p_endpoint: sub.endpoint })
    expect(sub.unsubscribe).not.toHaveBeenCalled()
    expect(localStorage.getItem('deskdev.push-enabled')).toBe('1')
  })

  it('on sign-out unsubscribes after all when the row could not be removed', async () => {
    // Offline sign-out: a live endpoint would keep receiving the old account's pushes.
    const sub = fakeSub()
    current = sub
    localStorage.setItem('deskdev.push-enabled', '1')
    h.rpc.mockRejectedValueOnce(new Error('Failed to fetch'))
    await disablePush({ unsubscribe: false })
    expect(sub.unsubscribe).toHaveBeenCalledTimes(1)
    // The device still wants push: the next sign-in renews it where it can.
    expect(localStorage.getItem('deskdev.push-enabled')).toBe('1')

    const refused = fakeSub()
    current = refused
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'JWT expired' } })
    await disablePush({ unsubscribe: false })
    expect(refused.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('tolerates a failing server and a missing subscription', async () => {
    const sub = fakeSub()
    current = sub
    h.rpc.mockRejectedValue(new Error('offline'))
    await expect(disablePush()).resolves.toBeUndefined()
    expect(sub.unsubscribe).toHaveBeenCalled()
    current = null
    await expect(disablePush()).resolves.toBeUndefined()
  })
})

describe('syncPushSubscription (every launch and sign-in)', () => {
  it('re-binds an existing subscription to whoever is signed in now', async () => {
    permission.value = 'granted'
    current = fakeSub()
    expect(await syncPushSubscription()).toBe('on')
    expect(pushManager.subscribe).not.toHaveBeenCalled()
    expect(h.rpc).toHaveBeenCalledWith('upsert_push_subscription', expect.objectContaining({ p_endpoint: 'https://push.example/abc' }))
  })

  it('silently renews a subscription iOS dropped, when this device had push on', async () => {
    permission.value = 'granted'
    localStorage.setItem('deskdev.push-enabled', '1')
    expect(await syncPushSubscription()).toBe('on')
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1)
    expect(h.rpc).toHaveBeenCalledTimes(1)
  })

  it('does not subscribe a device that never turned push on', async () => {
    permission.value = 'granted'
    expect(await syncPushSubscription()).toBe('off')
    expect(pushManager.subscribe).not.toHaveBeenCalled()
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('does nothing without permission, and never prompts', async () => {
    localStorage.setItem('deskdev.push-enabled', '1')
    expect(await syncPushSubscription()).toBe('off')
    permission.value = 'denied'
    expect(await syncPushSubscription()).toBe('denied')
    expect(requestPermission).not.toHaveBeenCalled()
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('moves a subscription made with a rotated VAPID key to the current one', async () => {
    permission.value = 'granted'
    const old = fakeSub('https://push.example/old', OTHER_KEY)
    current = old
    expect(await syncPushSubscription()).toBe('on')
    expect(old.unsubscribe).toHaveBeenCalled()
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1)
  })

  it('stays on when saving fails (offline) — the next launch retries', async () => {
    permission.value = 'granted'
    current = fakeSub()
    h.rpc.mockRejectedValue(new Error('Failed to fetch'))
    expect(await syncPushSubscription()).toBe('on')
  })
})

describe('sendTestPush', () => {
  it('asks send-push for a test and reports whether one went out', async () => {
    h.invoke.mockResolvedValue({ data: { sent: 1, failed: 0, gone: 0, subscriptions: 1 }, error: null })
    expect(await sendTestPush()).toBe(true)
    expect(h.invoke).toHaveBeenCalledWith('send-push', { body: { type: 'test' } })
    h.invoke.mockResolvedValue({ data: { sent: 0, failed: 1, gone: 0, subscriptions: 1 }, error: null })
    expect(await sendTestPush()).toBe(false)
    h.invoke.mockResolvedValue({ data: null, error: new Error('401') })
    expect(await sendTestPush()).toBe(false)
    h.invoke.mockRejectedValue(new Error('offline'))
    expect(await sendTestPush()).toBe(false)
  })
})
