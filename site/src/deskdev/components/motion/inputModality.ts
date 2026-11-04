import { useSyncExternalStore } from 'react'

/**
 * Which input drove the last interaction — Emil's hardest rule is that
 * keyboard-initiated actions never animate (Raycast opens instantly). The
 * tracker mirrors the answer onto <html data-input="keyboard|pointer">, so
 * CSS can drop an animation for keyboard users (index.css: animate-route,
 * animate-pop-in) and the Motion helpers here skip enter/exit for them.
 *
 * Listeners run in the capture phase, ahead of React's handlers: by the time
 * an Escape handler closes a menu, the modality already reads 'keyboard'.
 */

export type InputModality = 'pointer' | 'keyboard'

let current: InputModality = 'pointer'
const listeners = new Set<() => void>()

// Pure modifier presses (Cmd held for a click, Shift for a range select)
// don't make the next action keyboard-initiated.
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn', 'AltGraph'])

export function getInputModality(): InputModality {
  return current
}

export function setInputModality(next: InputModality): void {
  if (next === current) return
  current = next
  if (typeof document !== 'undefined') document.documentElement.dataset.input = next
  listeners.forEach((fn) => fn())
}

/** True when the action happening right now came from the keyboard. */
export function isKeyboardInitiated(): boolean {
  return current === 'keyboard'
}

/** Install the window listeners; returns the uninstaller. Idempotent per call pair. */
export function trackInputModality(): () => void {
  if (typeof window === 'undefined') return () => {}
  document.documentElement.dataset.input = current
  const onKey = (e: KeyboardEvent) => {
    if (!MODIFIERS.has(e.key)) setInputModality('keyboard')
  }
  const onPointer = () => setInputModality('pointer')
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('pointerdown', onPointer, true)
  return () => {
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('pointerdown', onPointer, true)
  }
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** The live modality; re-renders when it flips. */
export function useInputModality(): InputModality {
  return useSyncExternalStore(subscribe, getInputModality, () => 'pointer')
}
