import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DURATION, DURATION_MS, EASE, EASE_CSS, MODAL_SCALE, POP_SCALE, PRESS_SCALE, PRESS_SCALE_CARD, SPRING, STAGGER,
} from './presets'

// jsdom gives import.meta.url an http: scheme, so resolve from the project root
// vitest runs in (site/), or the repo root above it.
const CSS_PATH = ['src/deskdev/index.css', 'site/src/deskdev/index.css']
  .map((p) => resolve(process.cwd(), p))
  .find((p) => existsSync(p))
const css = readFileSync(CSS_PATH ?? 'src/deskdev/index.css', 'utf8')

/** The value of a custom property declared in index.css (first declaration). */
function cssVar(name: string): string {
  const m = css.match(new RegExp(`${name}:\\s*([^;]+);`))
  if (!m) throw new Error(`${name} is not declared in index.css`)
  return m[1].trim()
}

const ms = (v: string) => Number(v.replace('ms', ''))

describe('motion presets', () => {
  it('keep the CSS curves and the Motion curves identical', () => {
    for (const key of ['out', 'inOut', 'drawer'] as const) {
      expect(EASE_CSS[key]).toBe(`cubic-bezier(${EASE[key].join(', ')})`)
    }
    expect(cssVar('--ease-out')).toBe(EASE_CSS.out)
    expect(cssVar('--ease-in-out')).toBe(EASE_CSS.inOut)
    expect(cssVar('--ease-drawer')).toBe(EASE_CSS.drawer)
  })

  it('mirror every duration rung in index.css', () => {
    const pairs: [string, number][] = [
      ['--dur-press', DURATION_MS.press],
      ['--dur-tooltip', DURATION_MS.tooltip],
      ['--dur-popover', DURATION_MS.popover],
      ['--dur-popover-exit', DURATION_MS.popoverExit],
      ['--dur-modal', DURATION_MS.modal],
      ['--dur-modal-exit', DURATION_MS.modalExit],
      ['--dur-sheet', DURATION_MS.sheet],
      ['--dur-sheet-exit', DURATION_MS.sheetExit],
      ['--dur-fade', DURATION_MS.fade],
      ['--dur-route', DURATION_MS.route],
      ['--dur-list', DURATION_MS.listItem],
      ['--stagger-gap', Math.round(STAGGER.gap * 1000)],
    ]
    for (const [name, value] of pairs) expect(ms(cssVar(name)), name).toBe(value)
    expect(Number(cssVar('--press-scale'))).toBe(PRESS_SCALE)
    expect(Number(cssVar('--press-scale-card'))).toBe(PRESS_SCALE_CARD)
  })

  it('stay inside Emil’s duration bands', () => {
    expect(DURATION.press).toBeGreaterThanOrEqual(0.1)
    expect(DURATION.press).toBeLessThanOrEqual(0.16)
    expect(DURATION.tooltip).toBeGreaterThanOrEqual(0.125)
    expect(DURATION.tooltip).toBeLessThanOrEqual(0.2)
    expect(DURATION.popover).toBeGreaterThanOrEqual(0.15)
    expect(DURATION.popover).toBeLessThanOrEqual(0.25)
    expect(DURATION.sheet).toBeGreaterThanOrEqual(0.2)
    expect(DURATION.sheet).toBeLessThanOrEqual(0.5)
    // UI under 300ms; only the edge-travelling sheet may exceed it.
    for (const [k, v] of Object.entries(DURATION)) {
      if (k !== 'sheet' && k !== 'number') expect(v, k).toBeLessThan(0.3)
    }
    // Exits snap: each is shorter than its enter.
    expect(DURATION.popoverExit).toBeLessThan(DURATION.popover)
    expect(DURATION.modalExit).toBeLessThan(DURATION.modal)
    expect(DURATION.sheetExit).toBeLessThan(DURATION.sheet)
  })

  it('stagger in the 30–80ms band, scales never from zero', () => {
    expect(STAGGER.gap).toBeGreaterThanOrEqual(0.03)
    expect(STAGGER.gap).toBeLessThanOrEqual(0.08)
    for (const s of [PRESS_SCALE, PRESS_SCALE_CARD, POP_SCALE, MODAL_SCALE]) {
      expect(s).toBeGreaterThanOrEqual(0.9)
      expect(s).toBeLessThan(1)
    }
  })

  it('keep bounce in 0–0.3 and the UI springs on Emil’s default', () => {
    expect(SPRING.ui).toEqual({ type: 'spring', duration: 0.5, bounce: 0.2 })
    expect(SPRING.drag).toEqual({ type: 'spring', duration: 0.5, bounce: 0.2 })
    expect(SPRING.indicator.bounce).toBe(0)
    expect(SPRING.decorative).toEqual({ type: 'spring', stiffness: 100, damping: 20 })
  })

  it('never use transition: all or ease-in in the DeskDev stylesheet', () => {
    expect(css).not.toMatch(/transition:\s*all/)
    expect(css).not.toMatch(/(?<![-\w])ease-in(?![-\w])/)
  })
})
