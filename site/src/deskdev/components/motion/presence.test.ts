import { describe, expect, it } from 'vitest'
import { scaleVariants, type ExitCustom } from './Presence'
import { TWEEN } from './presets'

type Resolved = { opacity?: number; transform?: string; transition?: unknown }
const resolve = (v: unknown, custom: ExitCustom) => (typeof v === 'function' ? v(custom) : v) as Resolved

describe('overlay variants', () => {
  const variants = scaleVariants(0.95, TWEEN.popover, TWEEN.popoverExit)

  it('scale from 0.95 (never 0) with a shorter exit', () => {
    const open = resolve(variants.open, { instant: false, reduce: false })
    const closed = resolve(variants.closed, { instant: false, reduce: false })
    expect(open).toMatchObject({ opacity: 1, transform: 'scale(1)', transition: TWEEN.popover })
    expect(closed).toMatchObject({ opacity: 0, transform: 'scale(0.95)', transition: TWEEN.popoverExit })
  })

  it('drop the transform under reduced motion and keep the fade', () => {
    const open = resolve(variants.open, { instant: false, reduce: true })
    const closed = resolve(variants.closed, { instant: false, reduce: true })
    expect(open.transform).toBeUndefined()
    expect(closed.transform).toBeUndefined()
    expect(open.opacity).toBe(1)
    expect(closed.opacity).toBe(0)
  })

  it('close instantly when the close came from the keyboard', () => {
    const closed = resolve(variants.closed, { instant: true, reduce: false })
    expect(closed).toEqual({ opacity: 0, transition: TWEEN.instant })
  })
})
