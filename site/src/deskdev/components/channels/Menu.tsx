import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import type { Icon } from '@phosphor-icons/react'
import { classNames } from '../../lib/format'
import { PopoverPanel, Presence } from '../motion'

const MENU_ITEM = '[role="menuitem"]:not(:disabled)'

/**
 * Small anchored dropdown: a trigger button plus a card of actions that closes
 * on outside click, Escape, or picking an item. Same look as the chat thread menu.
 * It grows from the trigger's corner (origin-aware, 180ms in / 120ms out) and
 * appears / vanishes instantly when driven from the keyboard.
 */
export function Menu({
  label,
  trigger,
  triggerClassName,
  align = 'right',
  width = 'w-48',
  children,
}: {
  label: string
  trigger: ReactNode
  triggerClassName?: string
  align?: 'left' | 'right'
  width?: string
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  // The trigger element, held in state (not a ref): `close`, handed to the
  // items while rendering, focuses it.
  const [triggerEl, setTriggerEl] = useState<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // A menu takes focus when it opens, so the arrow keys work straight away.
  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>(MENU_ITEM)?.focus({ preventScroll: true })
  }, [open])

  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>(MENU_ITEM) ?? [])]
    if (items.length === 0) return
    const i = items.indexOf(document.activeElement as HTMLElement)
    let next = -1
    if (e.key === 'ArrowDown') next = (i + 1) % items.length
    else if (e.key === 'ArrowUp') next = i <= 0 ? items.length - 1 : i - 1
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    else if (e.key === 'Tab') {
      // Tab leaves a menu: close it and carry on from the trigger, rather
      // than leave it open behind the focus.
      triggerEl?.focus({ preventScroll: true })
      setOpen(false)
      return
    }
    if (next < 0) return
    e.preventDefault()
    items[next].focus()
  }

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      triggerEl?.focus()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, triggerEl])

  return (
    <div className="relative" ref={ref}>
      <button
        ref={setTriggerEl}
        type="button"
        className={triggerClassName}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {trigger}
      </button>
      <Presence>
        {open && (
          <PopoverPanel
            key="menu"
            placement={align === 'right' ? 'bottom-end' : 'bottom-start'}
            className={classNames(
              'absolute top-full mt-1 card z-30 p-1',
              align === 'right' ? 'right-0' : 'left-0',
              width,
            )}
            style={{ boxShadow: 'var(--shadow-3)' }}
            ref={menuRef}
            role="menu"
            aria-label={label}
            onKeyDown={onMenuKeyDown}
          >
            {children(() => {
              // Back to the trigger, so a dialog opened by the item returns focus there.
              triggerEl?.focus({ preventScroll: true })
              setOpen(false)
            })}
          </PopoverPanel>
        )}
      </Presence>
    </div>
  )
}

/** One action row in a Menu (ChannelList's link row matches it). */
const menuItemClass =
  'pressable w-full flex items-center gap-2.5 px-2.5 py-2 pointer-coarse:py-3 rounded-md text-left text-sm'

export function MenuItem({
  icon: Icon,
  children,
  onClick,
  danger,
}: {
  icon: Icon
  children: ReactNode
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={classNames(
        menuItemClass,
        danger ? 'text-rose-600 dark:text-rose-400 hover:bg-rose-500/10' : 'text-ink-100 hover:bg-ink-700/60',
      )}
      onClick={onClick}
    >
      <Icon size={15} className="shrink-0" aria-hidden /> <span className="min-w-0 truncate">{children}</span>
    </button>
  )
}
