import { afterEach, describe, expect, it } from 'vitest'
import { originFor, originStyle } from './origin'
import { decimalsOf, formatNumber, shouldCount } from './numberMath'
import { hasVisited, markVisited, resetVisits } from './firstVisit'
import { getInputModality, isKeyboardInitiated, setInputModality, trackInputModality } from './inputModality'

describe('originFor', () => {
  it('grows a panel from the edge nearest its trigger', () => {
    expect(originFor('bottom-start')).toBe('top left')
    expect(originFor('bottom-end')).toBe('top right')
    expect(originFor('bottom')).toBe('top center')
    expect(originFor('top-start')).toBe('bottom left')
    expect(originFor('top')).toBe('bottom center')
    expect(originFor('right-start')).toBe('left top')
    expect(originFor('left')).toBe('right center')
    expect(originFor('left-end')).toBe('right bottom')
  })

  it('lets --transform-origin override the placement', () => {
    expect(originStyle('bottom-end')).toBe('var(--transform-origin, top right)')
  })
})

describe('number helpers', () => {
  it('shows the target with its own precision', () => {
    expect(decimalsOf(12)).toBe(0)
    expect(decimalsOf(47.2)).toBe(1)
    expect(decimalsOf(3.14159)).toBe(4)
    expect(decimalsOf(Number.NaN)).toBe(0)
    expect(formatNumber(1250, 0)).toBe((1250).toLocaleString())
  })

  it('counts only on a real change of a finite number', () => {
    expect(shouldCount(null, 5)).toBe(false)
    expect(shouldCount(5, 5)).toBe(false)
    expect(shouldCount(4, 5)).toBe(true)
    expect(shouldCount(0, 12)).toBe(true)
    expect(shouldCount(4, Number.NaN)).toBe(false)
  })
})

describe('first visit', () => {
  afterEach(() => resetVisits())

  it('remembers a view key for the session', () => {
    expect(hasVisited('tasks')).toBe(false)
    markVisited('tasks')
    expect(hasVisited('tasks')).toBe(true)
    expect(hasVisited('projects')).toBe(false)
  })
})

describe('input modality', () => {
  afterEach(() => setInputModality('pointer'))

  it('flips on keydown / pointerdown and mirrors onto <html data-input>', () => {
    const stop = trackInputModality()
    try {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      expect(getInputModality()).toBe('keyboard')
      expect(isKeyboardInitiated()).toBe(true)
      expect(document.documentElement.dataset.input).toBe('keyboard')
      window.dispatchEvent(new Event('pointerdown'))
      expect(getInputModality()).toBe('pointer')
      expect(document.documentElement.dataset.input).toBe('pointer')
    } finally {
      stop()
    }
  })

  it('ignores bare modifier keys (Cmd-click stays a pointer action)', () => {
    const stop = trackInputModality()
    try {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta' }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }))
      expect(getInputModality()).toBe('pointer')
    } finally {
      stop()
    }
  })

  it('stops listening once uninstalled', () => {
    const stop = trackInputModality()
    stop()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    expect(getInputModality()).toBe('pointer')
  })
})
