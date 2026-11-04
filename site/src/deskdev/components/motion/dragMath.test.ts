import { describe, expect, it } from 'vitest'
import {
  DISMISS_VELOCITY, classifyMove, dismissDistance, dragOffset, pushSample, releaseVelocity, rubberband,
  shouldDismiss, type DragSample,
} from './dragMath'

describe('rubberband', () => {
  it('is zero at the bound and never negative', () => {
    expect(rubberband(0, 600)).toBe(0)
    expect(rubberband(-20, 600)).toBe(0)
    expect(rubberband(20, 0)).toBe(0)
  })

  it('follows less the further past the bound (friction, not a wall)', () => {
    const a = rubberband(50, 600)
    const b = rubberband(100, 600)
    const c = rubberband(400, 600)
    expect(a).toBeLessThan(50)
    expect(b).toBeGreaterThan(a)
    expect(c).toBeGreaterThan(b)
    // Marginal gain shrinks.
    expect(c - b).toBeLessThan((b - a) * 6)
    expect(c / 400).toBeLessThan(b / 100)
    // Bounded by the dimension.
    expect(rubberband(1e6, 600)).toBeLessThan(600)
  })
})

describe('dragOffset', () => {
  it('tracks 1:1 toward the dismiss edge and rubber-bands the other way', () => {
    expect(dragOffset(120, 500)).toBe(120)
    expect(dragOffset(0, 500)).toBe(0)
    const up = dragOffset(-80, 500)
    expect(up).toBeLessThan(0)
    expect(Math.abs(up)).toBeLessThan(80)
  })
})

describe('dismissDistance', () => {
  it('is a quarter of the surface, clamped to 56–200px', () => {
    expect(dismissDistance(400)).toBe(100)
    expect(dismissDistance(100)).toBe(56)
    expect(dismissDistance(2000)).toBe(200)
  })
})

describe('releaseVelocity', () => {
  it('reads px/ms over the last 100ms only', () => {
    const samples: DragSample[] = [
      { d: 0, t: 0 },
      { d: 5, t: 300 }, // slow start, outside the window at release
      { d: 25, t: 360 },
      { d: 65, t: 400 },
    ]
    expect(releaseVelocity(samples)).toBeCloseTo((65 - 5) / 100)
  })

  it('is 0 with fewer than two samples and negative when moving back', () => {
    expect(releaseVelocity([])).toBe(0)
    expect(releaseVelocity([{ d: 10, t: 5 }])).toBe(0)
    expect(releaseVelocity([{ d: 100, t: 0 }, { d: 60, t: 50 }])).toBeCloseTo(-0.8)
  })

  it('pushSample keeps memory bounded', () => {
    const s: DragSample[] = []
    for (let t = 0; t <= 1000; t += 10) pushSample(s, { d: t, t })
    expect(s.length).toBeLessThan(30)
    expect(releaseVelocity(s)).toBeCloseTo(1)
  })
})

describe('shouldDismiss', () => {
  const size = 600 // dismiss distance 150

  it('dismisses on a flick regardless of distance (Emil: > 0.11 px/ms)', () => {
    // 40px in 200ms = 0.2 px/ms average
    expect(shouldDismiss({ distance: 40, elapsed: 200, velocity: 0.3, size })).toBe(true)
    expect(0.2).toBeGreaterThan(DISMISS_VELOCITY)
  })

  it('dismisses a held-then-flicked drag on its release velocity', () => {
    // Slow on average (40px over 2s) but moving fast at release.
    expect(shouldDismiss({ distance: 40, elapsed: 2000, velocity: 0.4, size })).toBe(true)
  })

  it('dismisses past the distance mark when the finger is still or slow', () => {
    expect(shouldDismiss({ distance: 160, elapsed: 3000, velocity: 0, size })).toBe(true)
    expect(shouldDismiss({ distance: 100, elapsed: 3000, velocity: 0.02, size })).toBe(false)
  })

  it('stays open when the finger is moving back, however far it went (Apple)', () => {
    expect(shouldDismiss({ distance: 300, elapsed: 400, velocity: -0.3, size })).toBe(false)
  })

  it('never dismisses an upward (against-the-edge) drag', () => {
    expect(shouldDismiss({ distance: -50, elapsed: 50, velocity: 1, size })).toBe(false)
    expect(shouldDismiss({ distance: 0, elapsed: 50, velocity: 1, size })).toBe(false)
  })
})

describe('classifyMove', () => {
  it('waits inside the 10px slop, then picks the dominant axis', () => {
    expect(classifyMove(4, 6)).toBeNull()
    expect(classifyMove(14, 3)).toBe('drag')
    expect(classifyMove(-14, 3)).toBe('drag')
    expect(classifyMove(4, 18)).toBe('cancel')
  })
})
