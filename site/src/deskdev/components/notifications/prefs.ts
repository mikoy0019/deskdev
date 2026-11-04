import { useEffect, useState } from 'react'
import { DEFAULT_NOTIFY_PREFS, normalizePrefs, type NotifyPrefs } from '../../lib/notifications'
import { detectPlatform, isStandalone } from '../../pwa/platform'
import { PHONE_QUERY } from '../../pwa/useMediaQuery'

// Per-device notification preferences. Which popups and voice a person wants
// is a property of the machine in front of them (a wall display, a laptop on
// a call), so this lives in localStorage rather than the profile row.

const KEY = 'deskdev.notify-prefs'
/** The chat-only switch this replaces; honoured once, then superseded. */
const LEGACY_KEY = 'deskdev.chat-notifications'
const EVENT = 'deskdev:notify-prefs'

/**
 * The voice starts off on a phone or in the installed app: a phone that
 * suddenly talks is a surprise, and it can't speak in the background anyway.
 * A desk machine keeps the voice on — that's what it's for.
 */
export function defaultVoice(): boolean {
  try {
    if (isStandalone()) return false
    if (typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches) return false
    const p = detectPlatform()
    return !(p.isMobile && !p.isIPad)
  } catch {
    return DEFAULT_NOTIFY_PREFS.voice
  }
}

export function loadPrefs(): NotifyPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return normalizePrefs(JSON.parse(raw))
    const legacy = localStorage.getItem(LEGACY_KEY)
    return normalizePrefs({ desktop: legacy !== 'off', voice: defaultVoice() })
  } catch {
    return { ...DEFAULT_NOTIFY_PREFS, voice: defaultVoice() }
  }
}

export function savePrefs(prefs: NotifyPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // Private windows and blocked site data both throw; the in-memory copy
    // still applies for this page load.
  }
  window.dispatchEvent(new CustomEvent(EVENT))
}

/** Live preferences: every mounted user of this hook sees a save at once. */
export function useNotifyPrefs(): [NotifyPrefs, (patch: Partial<NotifyPrefs>) => void] {
  const [prefs, setPrefs] = useState<NotifyPrefs>(loadPrefs)

  useEffect(() => {
    const refresh = () => setPrefs(loadPrefs())
    window.addEventListener(EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  const update = (patch: Partial<NotifyPrefs>) => {
    const next = normalizePrefs({ ...loadPrefs(), ...patch })
    savePrefs(next)
    setPrefs(next)
  }

  return [prefs, update]
}
