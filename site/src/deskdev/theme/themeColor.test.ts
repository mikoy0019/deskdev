import { afterEach, describe, expect, it } from 'vitest'
import { CHROME_FALLBACK, syncThemeColor, tripletToHex } from './themeColor'

describe('tripletToHex', () => {
  it('converts index.css triplets', () => {
    expect(tripletToHex('14 17 25')).toBe('#0e1119')
    expect(tripletToHex(' 238 240 244 ')).toBe('#eef0f4')
    expect(tripletToHex('238, 240, 244')).toBe('#eef0f4')
  })

  it('rejects anything else', () => {
    expect(tripletToHex('')).toBeNull()
    expect(tripletToHex('1 2')).toBeNull()
    expect(tripletToHex('300 0 0')).toBeNull()
    expect(tripletToHex('#0e1119')).toBeNull()
  })
})

describe('syncThemeColor', () => {
  afterEach(() => {
    document.head.innerHTML = ''
    document.documentElement.style.removeProperty('--ink-850')
  })

  it('rewrites every meta and drops its media query', () => {
    document.head.innerHTML =
      '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#eef0f4">' +
      '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0e1119">'
    document.documentElement.style.setProperty('--ink-850', '14 17 25')
    syncThemeColor(true)
    const metas = Array.from(document.querySelectorAll('meta[name="theme-color"]'))
    expect(metas).toHaveLength(2)
    for (const m of metas) {
      expect(m.getAttribute('media')).toBeNull()
      expect(m.getAttribute('content')).toBe('#0e1119')
    }
  })

  it('falls back to the known colours and creates a meta when none exists', () => {
    syncThemeColor(false)
    const metas = document.querySelectorAll('meta[name="theme-color"]')
    expect(metas).toHaveLength(1)
    expect(metas[0].getAttribute('content')).toBe(CHROME_FALLBACK.light)
  })
})
