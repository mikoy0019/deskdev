import { useEffect, useState, type HTMLAttributes, type ReactNode } from 'react'
import { classNames } from '../../lib/format'
import { useFirstVisit } from './firstVisit'
import { DURATION_MS, STAGGER } from './presets'

// How long the stagger class stays on once items are in: the last delayed
// item's start plus its own fade-rise, with a frame of slack.
const SETTLE_MS = STAGGER.maxItems * STAGGER.gap * 1000 + DURATION_MS.listItem + 60
// A list that mounts empty (no data yet / genuinely empty) stops waiting
// after this, so an item created minutes later never plays a cascade.
const EMPTY_GIVE_UP_MS = 4000

/**
 * The first-load cascade for a view's list or grid, as a ref + class pair
 * for an element you already render:
 *
 *   const stagger = useStagger('tasks-list')
 *   <ul ref={stagger.ref} className={classNames('divide-y', stagger.className)}>…</ul>
 *
 * Runs once per `viewKey` per session (the first time that view's data
 * lands), never on revisits, filter keystrokes, sorting or new rows. Direct
 * children fade-rise 4px, 40ms apart; the 10th onward arrive together. Pure
 * CSS (off the main thread while the view is still mounting), fill-mode
 * backwards, so rows are clickable throughout and keep no transform after.
 * Reduced motion: no cascade (index.css).
 */
export function useStagger<T extends HTMLElement = HTMLElement>(
  viewKey: string,
): { ref: (el: T | null) => void; className: string | undefined } {
  const first = useFirstVisit(viewKey)
  // A callback ref (state, not a ref object): the effect re-arms if the
  // list element is swapped, and nothing reads a ref during render.
  const [el, setEl] = useState<T | null>(null)
  const [on, setOn] = useState(first)

  useEffect(() => {
    if (!on || !el) return
    let settle: ReturnType<typeof setTimeout> | undefined
    const arm = () => {
      clearTimeout(settle)
      settle = setTimeout(() => setOn(false), SETTLE_MS)
    }
    if (el.childElementCount > 0) {
      arm()
      return () => clearTimeout(settle)
    }
    // Mounted ahead of its data: start the clock when the first rows land.
    const giveUp = setTimeout(() => setOn(false), EMPTY_GIVE_UP_MS)
    const observer = new MutationObserver(() => {
      if (el.childElementCount === 0) return
      observer.disconnect()
      clearTimeout(giveUp)
      arm()
    })
    observer.observe(el, { childList: true })
    return () => {
      observer.disconnect()
      clearTimeout(giveUp)
      clearTimeout(settle)
    }
  }, [on, el])

  return { ref: setEl, className: on ? 'dd-stagger' : undefined }
}

type StaggerTag = 'div' | 'ul' | 'ol' | 'tbody' | 'section'

/**
 * useStagger as a wrapper element, when the list has no container of its
 * own. `as` picks the element (div, ul, ol, tbody, section).
 */
export function Stagger({
  viewKey, as = 'div', className, children, ...props
}: HTMLAttributes<HTMLElement> & { viewKey: string; as?: StaggerTag; children?: ReactNode }) {
  const { ref, className: staggerClass } = useStagger<HTMLDivElement>(viewKey)
  const Tag = as as 'div'
  return (
    <Tag {...props} ref={ref} className={classNames(className, staggerClass)}>
      {children}
    </Tag>
  )
}
