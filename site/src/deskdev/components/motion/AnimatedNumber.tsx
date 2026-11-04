import { useLayoutEffect, useRef } from 'react'
import { animate, useReducedMotion } from 'framer-motion'
import { classNames } from '../../lib/format'
import { useFirstVisit } from './firstVisit'
import { decimalsOf, formatNumber, shouldCount } from './numberMath'
import { DURATION, EASE } from './presets'

/**
 * A dashboard figure that counts — only when counting tells you something:
 *   - the first time this `countKey` shows this session, from 0 (the stat
 *     arriving); every later visit renders the figure still;
 *   - when the value really changes while on screen (a task closed, a
 *     payment landed): from the old figure to the new one.
 * 400ms strong ease-out; reduced motion renders the figure directly.
 *
 * The digits are written straight to the DOM (no React render per frame),
 * and screen readers get only the settled value. Pair with `tabular-nums`
 * / `text-metric` so the width doesn't jitter while it counts.
 */
export function AnimatedNumber({
  value, format, countKey, className,
}: {
  value: number
  /** Formats every frame and the final value (e.g. money). Default: locale grouping, the value's own decimals. */
  format?: (n: number) => string
  /** Enables the first-load count-up, once per key per session ('home-open-tasks'). */
  countKey?: string
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const shown = useRef<number | null>(null)
  const firstVisit = useFirstVisit(countKey)
  const reduce = useReducedMotion()
  const fmt = format ?? ((n: number) => formatNumber(n, decimalsOf(value)))
  const fmtRef = useRef(fmt)
  useLayoutEffect(() => {
    fmtRef.current = fmt
  })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // `shown` tracks what is on screen, so an interrupted count (a second
    // change mid-way, StrictMode's effect replay) restarts from there.
    const write = (n: number) => {
      shown.current = n
      el.textContent = fmtRef.current(n)
    }
    const from = shown.current === null ? (firstVisit && countKey ? 0 : null) : shown.current
    if (reduce || !shouldCount(from, value)) {
      write(value)
      return
    }
    const whole = Number.isInteger(value) && Number.isInteger(from)
    write(from as number)
    const controls = animate(from as number, value, {
      duration: DURATION.number,
      ease: EASE.out,
      onUpdate: (n) => write(whole ? Math.round(n) : n),
    })
    return () => controls.stop()
    // firstVisit / countKey are fixed for the instance; format changes are picked up via fmtRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduce])

  return (
    <span className={classNames('relative', className)}>
      <span ref={ref} aria-hidden />
      <span className="sr-only">{fmt(value)}</span>
    </span>
  )
}
