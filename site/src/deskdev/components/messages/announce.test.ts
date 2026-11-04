import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { armSpeechPriming, speak } from './announce'

// jsdom has no speech synthesis; a fake records what would have been said.
const spoken: { text: string; volume: number }[] = []
let visibility: DocumentVisibilityState = 'visible'

beforeEach(() => {
  spoken.length = 0
  visibility = 'visible'
  vi.useFakeTimers()
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      volume = 1
      rate = 1
      pitch = 1
      constructor(public text: string) {}
    },
  )
  vi.stubGlobal('speechSynthesis', {
    speak: (u: { text: string; volume: number }) => spoken.push({ text: u.text, volume: u.volume }),
    cancel: () => {},
    resume: () => {},
    getVoices: () => [{}],
    addEventListener: () => {},
  })
  Object.defineProperty(document, 'visibilityState', { get: () => visibility, configurable: true })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('speak', () => {
  it('speaks while DeskDev is on screen', () => {
    speak('Boss, message from Alex')
    vi.runAllTimers()
    expect(spoken).toEqual([{ text: 'Boss, message from Alex', volume: 1 }])
  })

  it('never speaks while the page is hidden', () => {
    visibility = 'hidden'
    speak('Boss, message from Alex')
    vi.runAllTimers()
    expect(spoken).toEqual([])
  })
})

describe('armSpeechPriming', () => {
  it('primes once, on the first gesture, when the voice is wanted', () => {
    const disarm = armSpeechPriming(() => true)
    window.dispatchEvent(new Event('pointerdown'))
    window.dispatchEvent(new Event('keydown'))
    expect(spoken).toEqual([{ text: 'ready', volume: 0 }])
    disarm()
  })

  it('stays silent when the voice is off, and after disarming', () => {
    armSpeechPriming(() => false)
    window.dispatchEvent(new Event('pointerdown'))
    const disarm = armSpeechPriming(() => true)
    disarm()
    window.dispatchEvent(new Event('keydown'))
    expect(spoken).toEqual([])
  })
})
