/**
 * Spoken announcement for incoming chat — "Boss, message from Joshua".
 *
 * Uses the browser's built-in speech synthesis, so there is no audio file to
 * ship and no network call. Silent by design where the API is missing.
 */

/**
 * The voice is for getting your attention back, not for narrating a
 * conversation. It speaks only when the previous incoming message is at least
 * this old — during an active back-and-forth the on-screen notification is
 * enough on its own.
 */
export const ANNOUNCE_QUIET_MINUTES = 3

const QUIET_MS = ANNOUNCE_QUIET_MINUTES * 60_000

/**
 * Whether to speak, given when a message last arrived. `undefined` means
 * nothing has arrived this session — the first message always speaks.
 */
export function shouldAnnounce(lastIncomingAt: number | undefined, now: number = Date.now()): boolean {
  if (lastIncomingAt === undefined) return true
  return now - lastIncomingAt >= QUIET_MS
}

const LAST_INCOMING_KEY = 'deskdev.chat-last-incoming'

/** Survives reloads, so refreshing mid-conversation does not re-trigger the voice. */
export function lastIncomingAt(): number | undefined {
  try {
    const raw = localStorage.getItem(LAST_INCOMING_KEY)
    if (!raw) return undefined
    const n = Number(raw)
    return Number.isFinite(n) ? n : undefined
  } catch {
    return undefined
  }
}

export function setLastIncomingAt(at: number): void {
  try {
    localStorage.setItem(LAST_INCOMING_KEY, String(at))
  } catch {
    // Storage blocked: the voice falls back to speaking every time, which is
    // the louder failure but never the silent one.
  }
}

/** What the voice says for a message from `sender`. */
export function announcement(sender: string | undefined): string {
  const name = sender?.trim()
  return name ? `Boss, message from ${name}` : 'Boss, you have a new message'
}

function synth(): SpeechSynthesis | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null
  return window.speechSynthesis
}

export function speechSupported(): boolean {
  return synth() !== null
}

/**
 * Chrome keeps speech muted until the page has had a user gesture. Called from
 * the click that grants notification permission: a zero-volume utterance is
 * enough to unlock the queue for later, unprompted announcements.
 */
export function primeSpeech(): void {
  const s = synth()
  if (!s) return
  try {
    s.resume()
    // An EMPTY utterance is a no-op in Chrome, so the gesture never actually
    // unlocked the queue and every later announcement was silently dropped.
    // A real word at zero volume does unlock it, and stays inaudible.
    const u = new SpeechSynthesisUtterance('ready')
    u.volume = 0
    s.speak(u)
    // Voices load asynchronously; asking now means they exist by the time a
    // real message arrives.
    s.getVoices()
  } catch {
    // Speech is a nicety; never let it break the notification path.
  }
}

/**
 * Speech unlocked by a tap doesn't survive a relaunch (iOS, Chrome), and
 * nothing else in a cold start is a gesture. So arm a one-time listener: the
 * first tap or key press after launch primes the voice — when `wanted()` says
 * the voice is on. Returns the disarm function.
 */
export function armSpeechPriming(wanted: () => boolean): () => void {
  if (typeof window === 'undefined' || !synth()) return () => {}
  const events = ['pointerdown', 'keydown'] as const
  const disarm = () => events.forEach((type) => window.removeEventListener(type, onGesture, true))
  function onGesture() {
    disarm()
    if (wanted()) primeSpeech()
  }
  events.forEach((type) => window.addEventListener(type, onGesture, { capture: true, passive: true }))
  return disarm
}

export function speak(text: string): void {
  const s = synth()
  if (!s) return
  // A backgrounded app talking to the room is never wanted — and iOS would
  // queue it and say it on return, long after it meant anything.
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return

  let spoken = false
  const utter = (): void => {
    if (spoken) return
    spoken = true
    try {
      // Drop anything still queued: after a burst, the newest message is the
      // one worth hearing — nobody wants ten sentences read out in sequence.
      s.cancel()
      // Chrome parks the queue when the page has been idle, and a speak() in
      // the same tick as cancel() can be swallowed. resume() is a no-op when
      // nothing is paused; the frame's delay lets cancel() settle first.
      setTimeout(() => {
        try {
          const u = new SpeechSynthesisUtterance(text)
          u.rate = 1
          u.pitch = 1
          u.volume = 1
          s.resume()
          s.speak(u)
        } catch {
          /* see below */
        }
      }, 0)
    } catch {
      // A failed announcement must not swallow the on-screen notification.
    }
  }

  // Speaking before the voice list has loaded drops the utterance with no
  // error — the common case on a cold page. Wait for the voices, but never
  // longer than a moment, in case the event has already been and gone.
  if (s.getVoices().length > 0) utter()
  else {
    s.addEventListener('voiceschanged', utter, { once: true })
    setTimeout(utter, 300)
  }
}
