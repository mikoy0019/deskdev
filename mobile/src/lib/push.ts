// Mobile-only (not mirrored). Push notifications for the phone app: ask for
// permission, get this install's Expo push token, and tell Supabase where to
// send (push_devices, through the security-definer RPCs in migration 050).
// The sender is supabase/functions/send-push, which hands each push to Expo
// and on to FCM (Android) or APNs (iOS). supabase/PUSH.md has the runbook.
//
// Same shape as the web app's pwa/push.ts: a per-device "wants push" flag,
// per-device category switches, a sync on every launch and sign-in, and
// sign-out removing the row while the session can still do that.
import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants, { ExecutionEnvironment } from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

import { DEFAULT_NOTIFY_PREFS, type NotifyCategory } from '@/lib/notifications'
import { isSupabaseConfigured, supabase } from '@/lib/supabase'

export type PushState = 'unavailable' | 'denied' | 'off' | 'on'
export type PushCategories = Record<NotifyCategory, boolean>

/** This device asked for push; a sign-in re-registers it without asking again. */
const ENABLED_KEY = 'deskdev.push-enabled'
/** The token last registered, so sign-out can remove exactly that row. */
const TOKEN_KEY = 'deskdev.push-token'
const CATEGORIES_KEY = 'deskdev.push-categories'

/** Named in app.json's expo-notifications plugin and in send-push (ANDROID_CHANNEL). */
export const ANDROID_CHANNEL = 'default'

function projectId(): string | null {
  const fromConfig = (Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined)?.eas?.projectId
  const id = typeof fromConfig === 'string' ? fromConfig : Constants.easConfig?.projectId
  return id?.trim() || null
}

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient

/**
 * Why push can't work in this build, or null when it can. Checked before any
 * push API is touched: Expo Go on Android has no remote push at all.
 */
export function pushUnavailableReason(): string | null {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return 'Push notifications are for the Android and iOS app.'
  if (!isSupabaseConfigured) return 'Push needs the live workspace — this copy runs on demo data.'
  if (isExpoGo && Platform.OS === 'android') {
    return 'Expo Go can’t receive push on Android. Install the DeskDev app build (EAS) to get notifications.'
  }
  if (Platform.OS === 'ios' && !Device.isDevice) return 'The iOS Simulator can’t receive push. Use a real iPhone.'
  if (!projectId()) return 'This build isn’t linked to an Expo project yet (run eas init in mobile/).'
  return null
}

// ─── Stored per device ──────────────────────────────────────────────────────

async function read(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key)
  } catch {
    return null
  }
}

async function write(key: string, value: string | null): Promise<void> {
  try {
    if (value === null) await AsyncStorage.removeItem(key)
    else await AsyncStorage.setItem(key, value)
  } catch {
    // Storage full or unavailable: the switch in settings still works this session.
  }
}

export async function loadPushCategories(): Promise<PushCategories> {
  const raw = await read(CATEGORIES_KEY)
  const stored = (() => {
    try {
      return raw ? (JSON.parse(raw) as Partial<PushCategories>) : {}
    } catch {
      return {}
    }
  })()
  const out = { ...DEFAULT_NOTIFY_PREFS.categories }
  for (const key of Object.keys(out) as NotifyCategory[]) {
    if (typeof stored[key] === 'boolean') out[key] = stored[key] as boolean
  }
  return out
}

async function wantsPush(): Promise<boolean> {
  return (await read(ENABLED_KEY)) === '1'
}

// ─── Permission and token ───────────────────────────────────────────────────

function isGranted(p: Notifications.NotificationPermissionsStatus): boolean {
  return p.granted || p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
}

/** Android 13+ shows the permission prompt only once a channel exists. */
async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
    name: 'DeskDev',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 200, 250],
  })
}

async function pushToken(): Promise<string> {
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId: projectId() ?? undefined })
  return data
}

/** Binds this phone's token to whoever is signed in, with this phone's switches. */
async function saveDevice(token: string): Promise<void> {
  const { error } = await supabase.rpc('upsert_push_device', {
    p_token: token,
    p_platform: Platform.OS,
    p_categories: await loadPushCategories(),
    p_device_name: Device.deviceName ?? Device.modelName ?? null,
    p_app_version: Constants.expoConfig?.version ?? null,
  })
  if (error) throw new Error(error.message)
  await write(TOKEN_KEY, token)
}

/** Readable text for what went wrong getting a token (missing FCM / APNs setup reads cryptic). */
function tokenError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (/FirebaseApp|google-services|fcm/i.test(message)) {
    return new Error('This Android build has no Firebase setup (google-services.json), so it can’t get a push token. See mobile/README.md → Push notifications.')
  }
  if (/aps-environment|entitlement/i.test(message)) {
    return new Error('This iOS build has no push entitlement. Build it with EAS so it gets one.')
  }
  return new Error(message)
}

// ─── What the settings screen calls ─────────────────────────────────────────

/** Where push stands on this phone. Never throws. */
export async function getPushState(): Promise<PushState> {
  if (pushUnavailableReason()) return 'unavailable'
  try {
    const permission = await Notifications.getPermissionsAsync()
    if (!isGranted(permission)) return permission.canAskAgain === false ? 'denied' : 'off'
    return (await wantsPush()) && (await read(TOKEN_KEY)) ? 'on' : 'off'
  } catch {
    return 'off'
  }
}

/**
 * Turns push on for this phone: asks for permission (the system prompt shows
 * once; after a refusal only the phone's Settings can allow it), registers
 * the token. Rejects with a readable message when the server or the build
 * setup refused.
 */
export async function enablePush(): Promise<PushState> {
  if (pushUnavailableReason()) return 'unavailable'
  await ensureChannel()
  let permission = await Notifications.getPermissionsAsync()
  if (!isGranted(permission) && permission.canAskAgain !== false) {
    permission = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    })
  }
  if (!isGranted(permission)) return permission.canAskAgain === false ? 'denied' : 'off'

  let token: string
  try {
    token = await pushToken()
  } catch (error) {
    throw tokenError(error)
  }
  await saveDevice(token)
  await write(ENABLED_KEY, '1')
  return 'on'
}

/**
 * Stops pushes to this phone: deletes its row while the session can still do
 * that. `forget: false` (sign-out) keeps the "wants push" flag, so the next
 * person to sign in here is registered again without a prompt — the same as
 * the web app. Never throws: sign-out must go ahead.
 */
export async function disablePush(options: { forget?: boolean } = {}): Promise<void> {
  if (options.forget ?? true) await write(ENABLED_KEY, null)
  const token = await read(TOKEN_KEY)
  if (!token || !isSupabaseConfigured) return
  try {
    const { error } = await supabase.rpc('delete_push_device', { p_token: token })
    if (error) console.warn('[push] could not remove this phone:', error.message)
    else await write(TOKEN_KEY, null)
  } catch (error) {
    console.warn('[push] could not remove this phone:', error)
  }
}

/** Saves the category switches and, when push is on, sends them to the server. */
export async function savePushCategories(categories: PushCategories): Promise<void> {
  await write(CATEGORIES_KEY, JSON.stringify(categories))
  await syncPushDevice()
}

/**
 * Brings this phone's row up to date without asking: re-binds the token to
 * whoever is signed in now, picks up a rolled token and the current switches.
 * Does nothing unless this phone turned push on and permission still stands.
 */
export async function syncPushDevice(): Promise<void> {
  if (pushUnavailableReason() || !(await wantsPush())) return
  try {
    const permission = await Notifications.getPermissionsAsync()
    if (!isGranted(permission)) return
    await ensureChannel()
    await saveDevice(await pushToken())
  } catch (error) {
    // Offline or a lapsed session: the next launch tries again.
    console.warn('[push] could not save this phone:', error instanceof Error ? error.message : error)
  }
}

/** Asks send-push for a test notification on all of the signed-in user's devices. */
export async function sendTestPush(): Promise<{ sent: number; error?: string }> {
  if (!isSupabaseConfigured) return { sent: 0, error: 'Push needs the live workspace.' }
  try {
    const { data, error } = await supabase.functions.invoke('send-push', { body: { type: 'test' } })
    if (error) return { sent: 0, error: error.message }
    const summary = (data ?? {}) as { sent?: unknown; skipped?: unknown; errors?: { reason?: string }[] }
    const sent = Number(summary.sent ?? 0)
    if (sent > 0) return { sent }
    return { sent: 0, error: summary.errors?.[0]?.reason ?? (typeof summary.skipped === 'string' ? summary.skipped : 'Nothing was sent') }
  } catch (error) {
    return { sent: 0, error: error instanceof Error ? error.message : 'Could not reach send-push' }
  }
}

/** Calls `listener` when FCM / APNs rolls this install's token. Not in Expo Go on Android. */
export function onPushTokenChange(listener: () => void): () => void {
  if (pushUnavailableReason()) return () => {}
  const sub = Notifications.addPushTokenListener(() => listener())
  return () => sub.remove()
}
