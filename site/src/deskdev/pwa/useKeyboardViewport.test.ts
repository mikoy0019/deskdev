import { describe, expect, it } from 'vitest'
import { keyboardShellHeight } from './useKeyboardViewport'

describe('keyboardShellHeight', () => {
  it('is null while the keyboard is closed', () => {
    expect(keyboardShellHeight(844, 844)).toBeNull()
    // Safari's toolbars collapsing or expanding is not a keyboard.
    expect(keyboardShellHeight(745, 844)).toBeNull()
    expect(keyboardShellHeight(844, 770)).toBeNull()
  })

  it('returns the visible height while the keyboard is up', () => {
    expect(keyboardShellHeight(844, 508)).toBe(508)
    expect(keyboardShellHeight(844, 507.6)).toBe(508)
  })

  it('leaves a pinch-zoomed page alone', () => {
    expect(keyboardShellHeight(844, 422, 2)).toBeNull()
    expect(keyboardShellHeight(844, 300, 1.5)).toBeNull()
  })

  it('ignores nonsense sizes', () => {
    expect(keyboardShellHeight(0, 500)).toBeNull()
    expect(keyboardShellHeight(844, 0)).toBeNull()
    expect(keyboardShellHeight(Number.NaN, 500)).toBeNull()
  })
})
