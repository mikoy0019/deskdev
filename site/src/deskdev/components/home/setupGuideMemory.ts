import { guideStorageKey, parseGuideMemory, type GuideMemory } from './setupSteps'

/**
 * Where the setup guide's memory lives (per person, on this device), shared by
 * the card on Home and by what brings it back: the Undo on its "hidden" toast
 * and the palette's "Show setup guide".
 */

// Home remounts on every visit; when storage is blocked (private mode) this
// still keeps a Hide or a tick for the page's lifetime.
const fallback = new Map<string, GuideMemory>()
const listeners = new Set<() => void>()

export function readGuideMemory(userId: string): GuideMemory {
  const kept = fallback.get(userId)
  if (kept) return kept
  try {
    return parseGuideMemory(window.localStorage.getItem(guideStorageKey(userId)))
  } catch {
    return {}
  }
}

export function writeGuideMemory(userId: string, memory: GuideMemory): void {
  fallback.set(userId, memory)
  try {
    window.localStorage.setItem(guideStorageKey(userId), JSON.stringify(memory))
  } catch {
    // Not persisted; the fallback above covers this visit.
  }
}

/** The card on Home listens, so a guide brought back shows without a reload. */
export function onGuideMemoryChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Undo a Hide: the guide shows again wherever its rules still allow it. */
export function showSetupGuide(userId: string): void {
  const memory = { ...readGuideMemory(userId) }
  delete memory.hidden
  writeGuideMemory(userId, memory)
  listeners.forEach((listener) => listener())
}
