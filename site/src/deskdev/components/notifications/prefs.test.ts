import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ mobile: false, iPad: false, standalone: false, phoneWidth: false }))

vi.mock('../../pwa/platform', () => ({
  detectPlatform: () => ({ os: 'other', browser: 'other', inApp: null, isIPad: h.iPad, isMobile: h.mobile, osVersion: null }),
  isStandalone: () => h.standalone,
}))

import { defaultVoice, loadPrefs, savePrefs } from './prefs'
import { DEFAULT_NOTIFY_PREFS } from '../../lib/notifications'

beforeEach(() => {
  Object.assign(h, { mobile: false, iPad: false, standalone: false, phoneWidth: false })
  localStorage.clear()
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width') && h.phoneWidth }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('defaultVoice', () => {
  it('is on for a desk machine', () => {
    expect(defaultVoice()).toBe(true)
  })

  it('is off on a phone, a narrow window or the installed app', () => {
    h.mobile = true
    expect(defaultVoice()).toBe(false)
    h.mobile = false
    h.phoneWidth = true
    expect(defaultVoice()).toBe(false)
    h.phoneWidth = false
    h.standalone = true
    expect(defaultVoice()).toBe(false)
  })

  it('is on for an iPad in the browser (a desk device)', () => {
    h.mobile = true
    h.iPad = true
    expect(defaultVoice()).toBe(true)
  })
})

describe('loadPrefs', () => {
  it('uses the device default only when nothing was saved', () => {
    h.mobile = true
    expect(loadPrefs().voice).toBe(false)
    savePrefs({ ...DEFAULT_NOTIFY_PREFS, voice: true })
    expect(loadPrefs().voice).toBe(true)
  })

  it('keeps the legacy chat switch, with the device voice default', () => {
    h.standalone = true
    localStorage.setItem('deskdev.chat-notifications', 'off')
    expect(loadPrefs()).toMatchObject({ desktop: false, voice: false })
  })
})
