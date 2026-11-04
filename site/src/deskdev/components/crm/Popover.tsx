import {
  useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import type { Icon } from '@phosphor-icons/react'
import { classNames } from '../../lib/format'
import { useMediaQuery } from '../../pwa/useMediaQuery'
import {
  OverlayRoot, PopoverPanel, Presence, Scrim, SheetHandle, SheetPanel,
} from '../motion'

/** Where a popover becomes a bottom sheet (Tailwind's `sm`, as Modal). */
const SHEET_QUERY = '(max-width: 639.98px)'

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea, [tabindex]:not([tabindex="-1"])'

interface PopoverProps {
  /** The trigger. `null` = closed (the panel plays its exit). */
  anchor: HTMLElement | null
  onClose: () => void
  align?: 'left' | 'right'
  /** Names the surface: the dialog's accessible name, and the sheet's title on phones. */
  label: string
  /** 'menu' for a list of actions (MenuItem rows), 'dialog' for a small form or picker. */
  role?: 'menu' | 'dialog'
  point?: { x: number; y: number }
  children: ReactNode
}

/**
 * An anchored dropdown for the CRM grid.
 *
 * Desktop: a fixed panel (so it escapes the grid's overflow container) that
 * grows from the corner nearest its trigger and flips above it when the
 * viewport runs out — 180ms in, 120ms out, instant from the keyboard.
 * Below 640px: a bottom sheet (grabber + title, drag or flick to dismiss),
 * the way a phone presents an action list.
 *
 * Closes on an outside press or Escape. Focus moves into the panel on open,
 * Tab and the arrow keys stay inside it, and focus returns to the trigger.
 */
export default function Popover({ anchor, ...rest }: PopoverProps) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <Presence>{anchor && <PopoverLayer key="popover" anchor={anchor} {...rest} />}</Presence>,
    document.body,
  )
}

function PopoverLayer({
  anchor, onClose, align = 'left', label, role = 'dialog', point, children,
}: PopoverProps & { anchor: HTMLElement }) {
  const sheet = useMediaQuery(SHEET_QUERY)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; origin: string } | null>(null)

  useLayoutEffect(() => {
    if (sheet) return
    const rect = anchor.getBoundingClientRect()
    const panel = panelRef.current
    // offsetWidth/Height ignore the entering scale, so the measure is the settled size.
    const w = panel?.offsetWidth ?? 200
    const h = panel?.offsetHeight ?? 200
    let left = point?.x ?? (align === 'right' ? rect.right - w : rect.left)
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8))
    let top = point?.y ?? rect.bottom + 4
    let above = false
    if (top + h > window.innerHeight - 8) {
      top = Math.max(8, (point?.y ?? rect.top) - h - 4)
      above = true
    }
    setPos({ top, left, origin: `${above ? 'bottom' : 'top'} ${align === 'right' ? 'right' : 'left'}` })
  }, [anchor, align, sheet, point])

  // Escape closes the innermost surface only (capture, before a Modal underneath hears it).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // Focus in on open (unless a field inside already took it), back to the trigger on close.
  // The desktop panel is visibility:hidden until it is positioned, and a hidden
  // element ignores focus(): wait for the position before moving focus in.
  const shown = sheet || pos !== null
  useEffect(() => {
    if (!shown) return
    const panel = panelRef.current
    if (panel && !panel.contains(document.activeElement)) {
      const first = panel.querySelector<HTMLElement>(FOCUSABLE)
      ;(first ?? panel).focus({ preventScroll: true })
    }
    return () => {
      const active = document.activeElement
      const lost = !active || active === document.body || (panel?.contains(active) ?? false)
      if (lost && document.contains(anchor)) anchor.focus({ preventScroll: true })
    }
  }, [anchor, shown])

  // The content can swap under focus (a menu stepping into a sub-list): keep
  // focus inside rather than dropping it on <body>.
  useEffect(() => {
    const panel = panelRef.current
    const active = document.activeElement
    if (panel && (!active || active === document.body)) {
      panel.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true })
    }
  })

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const panel = panelRef.current
    if (!panel) return
    const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (items.length === 0) return
    const i = items.indexOf(document.activeElement as HTMLElement)
    const inField = (e.target as HTMLElement).matches('input:not([type=checkbox]), select, textarea')
    if (e.key === 'Tab') {
      e.preventDefault()
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i + 1) % items.length
      items[next].focus()
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !inField) {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      items[(i + step + items.length) % items.length].focus()
    } else if ((e.key === 'Home' || e.key === 'End') && !inField) {
      // The same keys as the channel menus: first and last row.
      e.preventDefault()
      items[e.key === 'Home' ? 0 : items.length - 1].focus()
    }
  }

  if (sheet) {
    return (
      <OverlayRoot className="fixed inset-0 z-50 flex items-end bottom-auto h-(--app-h)">
        <Scrim onClick={onClose} />
        <SheetPanel
          ref={panelRef}
          onDismiss={onClose}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          onKeyDown={onKeyDown}
          className="relative card w-full flex flex-col rounded-t-2xl rounded-b-none border-x-0 border-b-0 pb-(--safe-bottom) shadow-(--shadow-3) outline-hidden max-h-[calc(var(--app-h)_-_var(--safe-top)_-_0.5rem)]"
        >
          <SheetHandle className="shrink-0 border-b border-ink-600 select-none">
            <span aria-hidden className="mx-auto mt-2 block h-1 w-9 rounded-full bg-ink-500" />
            <p className="px-4 pt-2.5 pb-3 text-sm font-semibold text-ink-50 truncate">{label}</p>
          </SheetHandle>
          <div
            role={role === 'menu' ? 'menu' : undefined}
            aria-label={role === 'menu' ? label : undefined}
            className="flex-1 min-h-0 overflow-y-auto overscroll-contain py-1.5"
          >
            {children}
          </div>
        </SheetPanel>
      </OverlayRoot>
    )
  }

  // Opened from inside a modal (z-50), the popover takes the modal's rung: its
  // portal comes later, so it lands on top rather than under the modal.
  const inModal = anchor.closest('[aria-modal="true"]') !== null
  return (
    <OverlayRoot className={classNames('fixed inset-0', inModal ? 'z-50' : 'z-40')}>
      <div className="absolute inset-0" onMouseDown={onClose} aria-hidden />
      {/* A dialog surface on both layouts (the sheet too): a portaled layer
          outside the page landmarks; a menu is the list inside it. */}
      <PopoverPanel
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-label={label}
        aria-modal={role === 'dialog' ? true : undefined}
        onKeyDown={onKeyDown}
        placement={align === 'right' ? 'bottom-end' : 'bottom-start'}
        className="fixed card py-1 min-w-[180px] max-h-[60vh] overflow-y-auto overscroll-contain shadow-(--shadow-3) outline-hidden"
        style={{
          top: pos?.top ?? 0,
          left: pos?.left ?? 0,
          visibility: pos ? 'visible' : 'hidden',
          ...(pos ? { transformOrigin: pos.origin } : null),
        }}
      >
        {role === 'menu' ? <div role="menu" aria-label={label}>{children}</div> : children}
      </PopoverPanel>
    </OverlayRoot>
  )
}

/** Shared row geometry for every list inside a Popover: roomier under a finger. */
// The focus ring is drawn inside the row: the panel scrolls, so an outer ring
// was clipped at both sides and read as two stray lines.
export const POPOVER_ROW =
  'pressable w-full flex items-center gap-2 px-3 py-2 pointer-coarse:min-h-11 pointer-coarse:px-4 text-sm text-left focus:outline-hidden focus-visible:bg-ink-700 focus-visible:ring-inset focus-visible:ring-offset-0'

/** Standard row inside a Popover menu. */
export function MenuItem({
  icon: Icon, label, danger, disabled, onClick,
}: {
  icon: Icon
  label: string
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={classNames(
        POPOVER_ROW,
        disabled
          ? 'text-ink-400 cursor-not-allowed'
          : danger
            ? 'text-rose-700 dark:text-rose-400 hover:bg-rose-500/10 focus-visible:bg-rose-500/10'
            : 'text-ink-100 hover:bg-ink-700 hover:text-ink-50',
      )}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={16} className="shrink-0" aria-hidden />
      {label}
    </button>
  )
}
