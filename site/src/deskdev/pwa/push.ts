// Web-only (not mirrored to mobile). Web Push for this device: subscribe with
// the VAPID key, tell Supabase where to send (push_subscriptions, through the
// security-definer RPCs in migration 029), and keep that row current. The
// sender is supabase/functions/send-push; supabase/PUSH.md has the runbook.
//
// iOS only pushes to Home Screen apps, wants the permission prompt straight
// from a tap, and can drop a subscription silently — so the state below
// distinguishes "install first", and every launch re-checks the subscription.
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { useStore } from '../store/useStore'
import { loadPrefs, useNotifyPrefs } from '../components/notifications/prefs'
import { detectPlatform, isStandalone } from './platform'
import { getRegistration } from './serviceWorker'
import { appBase } from './paths'

export type PushState = 'unsupported' | 'unconfigured' | 'needs-install' | 'denied' | 'off' | 'on'

/** Remembers that this device asked for push, so a subscription iOS dropped is quietly renewed. */
const DEVICE_KEY = 'deskdev.push-enabled'
/** Launch / sign-in sync waits for the app's own first requests. */
const START_DELAY_MS = 2000
/** Category switches are flipped in runs; one upsert for the lot. */
const DEBOUNCE_MS = 800

/**
 * The VAPID public key (base64url, uncompressed P-256). Read on each call —
 * still a literal `process.env.NEXT_PUBLIC_*`, so the build inlines it.
 */
function vapidKey(): Uint8Array<ArrayBuffer> | null {
  const raw = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim()
  if (!raw) return null
  try {
    const bytes = base64UrlToBytes(raw)
    // 0x04 + X + Y. Anything else would make every subscribe() throw.
    return bytes.length === 65 && bytes[0] === 4 ? bytes : null
  } catch {
    return null
  }
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const raw = atob(padded)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function bytesToBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return ''
  let raw = ''
  for (const byte of new Uint8Array(buffer)) raw += String.fromCharCode(byte)
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function supported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/** The states that need no async look at the subscription; null when it's on/off/denied. */
function quickState(): PushState | null {
  if (!isSupabaseConfigured || !vapidKey()) return 'unconfigured'
  // iOS pushes only to Home Screen apps; a Safari tab must install first.
  if (detectPlatform().os === 'ios' && !isStandalone()) return 'needs-install'
  if (!supported()) return 'unsupported'
  return null
}

function deviceWantsPush(): boolean {
  try {
    return localStorage.getItem(DEVICE_KEY) === '1'
  } catch {
    return false
  }
}

function setDeviceWantsPush(on: boolean): void {
  try {
    if (on) localStorage.setItem(DEVICE_KEY, '1')
    else localStorage.removeItem(DEVICE_KEY)
  } catch {
    // Storage blocked: no silent renewal, the switch in Settings still works.
  }
}

async function currentSubscription(reg?: ServiceWorkerRegistration): Promise<PushSubscription | null> {
  const registration = reg ?? (await getRegistration())
  if (!registration?.pushManager) return null
  try {
    return await registration.pushManager.getSubscription()
  } catch {
    return null
  }
}

/** False when the subscription was made with another VAPID key (keys rotated). */
function sameKey(sub: PushSubscription, key: Uint8Array): boolean {
  const used = sub.options?.applicationServerKey
  if (!used) return true // Not reported by this browser: nothing to compare.
  const bytes = new Uint8Array(used)
  return bytes.length === key.length && bytes.every((b, i) => b === key[i])
}

function subscribe(reg: ServiceWorkerRegistration, key: Uint8Array<ArrayBuffer>): Promise<PushSubscription> {
  // userVisibleOnly: every push shows a notification — Safari revokes the
  // permission of sites that push silently, and Chrome requires it.
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
}

/** Binds the endpoint to the signed-in user and refreshes where its links land. */
async function saveSubscription(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON()
  const { error } = await supabase.rpc('upsert_push_subscription', {
    p_endpoint: sub.endpoint,
    p_p256dh: json.keys?.p256dh ?? bytesToBase64Url(sub.getKey('p256dh')),
    p_auth: json.keys?.auth ?? bytesToBase64Url(sub.getKey('auth')),
    p_app_base: appBase(),
    p_categories: loadPrefs().categories,
    p_platform: detectPlatform().os,
    p_user_agent: navigator.userAgent.slice(0, 512),
  })
  if (error) throw new Error(error.message)
}

/** Where push stands on this device. Never throws. */
export async function getPushState(): Promise<PushState> {
  const quick = quickState()
  if (quick) return quick
  const permission = Notification.permission
  if (permission === 'denied') return 'denied'
  if (permission !== 'granted') return 'off'
  return (await currentSubscription()) ? 'on' : 'off'
}

/**
 * Turns push on. Call it straight from a tap: iOS and Chrome only show the
 * permission prompt for a user gesture, so it is the first thing this does.
 * Resolves to the resulting state; rejects only when the server refused the
 * subscription (the message says why).
 */
export async function enablePush(): Promise<PushState> {
  const quick = quickState()
  if (quick) return quick
  const key = vapidKey()!

  // Before any await: anything later is outside the gesture.
  const asked = Notification.requestPermission()
  let permission: NotificationPermission
  try {
    permission = (await asked) ?? Notification.permission
  } catch {
    permission = Notification.permission
  }
  if (permission === 'denied') return 'denied'
  if (permission !== 'granted') return 'off'

  const reg = await getRegistration()
  if (!reg?.pushManager) return 'unsupported'
  let sub = await currentSubscription(reg)
  if (sub && !sameKey(sub, key)) {
    await sub.unsubscribe().catch(() => false)
    sub = null
  }
  if (!sub) sub = await subscribe(reg, key)

  try {
    await saveSubscription(sub)
  } catch (error) {
    // An endpoint the server doesn't know only wastes the push service's time.
    await sub.unsubscribe().catch(() => false)
    throw error
  }
  setDeviceWantsPush(true)
  return 'on'
}

/**
 * Turns push off for this device: deletes its row while the session can still
 * do that, then unsubscribes. Failures are tolerated — sign-out must proceed.
 *
 * `unsubscribe: false` (used by sign-out) keeps the browser subscription: iOS
 * can't subscribe again without a fresh tap, so the next sign-in on this
 * device re-binds the same subscription instead. With no row, nothing is sent
 * to it meanwhile. If the row couldn't be removed (offline), it unsubscribes
 * after all: a dead endpoint is the only way to stop pushes for an account
 * nobody is signed in to here, and send-push drops the row when it's gone.
 */
export async function disablePush(options: { unsubscribe?: boolean } = {}): Promise<void> {
  let unsubscribe = options.unsubscribe ?? true
  if (unsubscribe) setDeviceWantsPush(false)
  if (!supported()) return
  const sub = await currentSubscription()
  if (!sub) return
  if (isSupabaseConfigured) {
    let removed = false
    try {
      const { error } = await supabase.rpc('delete_push_subscription', { p_endpoint: sub.endpoint })
      if (error) console.warn('[push] could not remove this device:', error.message)
      else removed = true
    } catch (error) {
      console.warn('[push] could not remove this device:', error)
    }
    if (!removed) unsubscribe = true
  }
  if (unsubscribe) await sub.unsubscribe().catch(() => false)
}

/** Asks send-push for a test notification on the signed-in user's devices. True when one went out. */
export async function sendTestPush(): Promise<boolean> {
  if (!isSupabaseConfigured) return false
  try {
    const { data, error } = await supabase.functions.invoke('send-push', { body: { type: 'test' } })
    if (error) return false
    return Number((data as { sent?: unknown } | null)?.sent ?? 0) > 0
  } catch {
    return false
  }
}

/**
 * Brings this device's push row up to date without a gesture: re-binds an
 * existing subscription to whoever is signed in now (and the current
 * categories and app address), replaces one made with an old VAPID key, and
 * renews one iOS dropped when this device had push on. Exported for tests.
 */
export async function syncPushSubscription(): Promise<PushState> {
  const quick = quickState()
  if (quick) return quick
  const permission = Notification.permission
  if (permission === 'denied') return 'denied'
  if (permission !== 'granted') return 'off'

  const key = vapidKey()!
  const reg = await getRegistration()
  if (!reg?.pushManager) return 'off'
  let sub = await currentSubscription(reg)
  const had = Boolean(sub)
  if (sub && !sameKey(sub, key)) {
    await sub.unsubscribe().catch(() => false)
    sub = null
  }
  if (!sub) {
    if (!had && !deviceWantsPush()) return 'off'
    try {
      sub = await subscribe(reg, key)
    } catch {
      // Some browsers want a gesture after all; Settings can turn it back on.
      return 'off'
    }
  }
  try {
    await saveSubscription(sub)
  } catch (error) {
    // Offline or a lapsed session: the next launch tries again.
    console.warn('[push] could not save this device:', error instanceof Error ? error.message : error)
  }
  setDeviceWantsPush(true)
  return 'on'
}

/** Push state for Settings, plus the actions behind its buttons. */
export function usePushState(): {
  state: PushState
  busy: boolean
  enable: () => Promise<void>
  disable: () => Promise<void>
  sendTest: () => Promise<boolean>
} {
  const [state, setState] = useState<PushState>(() => quickState() ?? 'off')
  const [busy, setBusy] = useState(() => quickState() === null)

  useEffect(() => {
    let live = true
    const refresh = () => {
      void getPushState().then((next) => {
        if (!live) return
        setState(next)
        setBusy(false)
      })
    }
    refresh()
    // Permission is often changed in the OS settings app; pick it up on return.
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      live = false
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  // Not async: enablePush has to reach requestPermission inside the tap.
  const enable = () => {
    setBusy(true)
    return enablePush().then(
      (next) => {
        setState(next)
        setBusy(false)
        if (next === 'on') toast.success('Push notifications are on for this device')
        else if (next === 'denied') toast.error('Notifications are blocked for DeskDev on this device')
      },
      (error: unknown) => {
        setBusy(false)
        toast.error(`Could not turn on push: ${error instanceof Error ? error.message : 'unknown error'}`)
      },
    )
  }

  const disable = async () => {
    setBusy(true)
    await disablePush()
    setState(await getPushState())
    setBusy(false)
  }

  return { state, busy, enable, disable, sendTest: sendTestPush }
}

/**
 * Keeps this device's push row in step: on every launch and sign-in, and
 * (debounced) whenever the notification categories change. Mount once.
 */
export function usePushSync(): void {
  const me = useStore((s) => s.currentUserId)
  const [prefs] = useNotifyPrefs()
  const categories = JSON.stringify(prefs.categories)
  const synced = useRef<string | null>(null)

  useEffect(() => {
    if (!me || quickState()) {
      synced.current = null
      return
    }
    const key = `${me}|${categories}`
    if (synced.current === key) return
    const timer = setTimeout(
      () => {
        synced.current = key
        void syncPushSubscription().catch(() => undefined)
      },
      synced.current === null ? START_DELAY_MS : DEBOUNCE_MS,
    )
    return () => clearTimeout(timer)
  }, [me, categories])
}
