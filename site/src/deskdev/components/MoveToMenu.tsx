import { useState } from 'react'
import { ArrowsLeftRightIcon, CaretDownIcon } from '@phosphor-icons/react'
import { classNames } from '../lib/format'
import Popover, { POPOVER_ROW } from './crm/Popover'

export interface MoveTarget {
  key: string
  title: string
  /** Tailwind bg class of the column's accent dot. */
  accent?: string
}

/**
 * "Move to…" on a kanban card: a trigger plus the shared anchored Popover
 * listing the other columns (a bottom sheet on phones). It replaced a native
 * <select>, whose option list the OS draws: a white list on the dark app.
 * The Popover is portalled, which also keeps it clear of the column's scroll.
 */
export default function MoveToMenu({
  targets,
  onPick,
  variant,
  label = 'Move to',
}: {
  targets: MoveTarget[]
  onPick: (key: string) => void
  variant: 'corner' | 'footer'
  label?: string
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const open = anchor !== null

  return (
    // React bubbles events from the portalled panel through here to the card,
    // whose click opens it: stop them at the menu.
    <span className={variant === 'footer' ? 'block' : 'contents'} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label="Move to column"
        title="Move to…"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => setAnchor(open ? null : e.currentTarget)}
        className={
          variant === 'corner'
            ? classNames(
                'flex h-7 w-7 items-center justify-center rounded-md border bg-ink-800 shadow-(--shadow-1)',
                'transition-[color,border-color,scale] duration-150 ease-out active:scale-[0.97]',
                'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500',
                open ? 'border-brand-500 text-ink-50' : 'border-ink-600 text-ink-300 hover:border-ink-500 hover:text-ink-50',
              )
            : classNames(
                'mt-2 flex w-full items-center justify-between gap-2 rounded-md border bg-ink-800 px-2.5 py-1 pointer-coarse:py-2',
                'text-[11px] text-ink-200 transition-[opacity,border-color] duration-150 ease-out',
                'focus:outline-hidden focus-visible:border-brand-500 focus-visible:ring-1 focus-visible:ring-brand-500',
                open ? 'border-brand-500' : 'border-ink-600 hover:border-ink-500',
                // Fades in on hover with a fine pointer; always there on touch.
                !open && 'pointer-fine:opacity-0 pointer-fine:group-hover/card:opacity-100 pointer-fine:focus:opacity-100',
              )
        }
      >
        {variant === 'corner' ? (
          <ArrowsLeftRightIcon size={14} aria-hidden />
        ) : (
          <>
            <span>Move to…</span>
            <CaretDownIcon size={12} aria-hidden className={classNames('transition-transform duration-150', open && 'rotate-180')} />
          </>
        )}
      </button>
      <Popover anchor={anchor} onClose={() => setAnchor(null)} role="menu" align={variant === 'corner' ? 'right' : 'left'} label={label}>
        <p className="px-3 pb-1 pt-1.5 text-[11px] font-medium text-ink-300 max-sm:hidden">{label}</p>
        {targets.map((t) => (
          <button
            key={t.key}
            type="button"
            role="menuitem"
            className={classNames(POPOVER_ROW, 'gap-2.5 text-ink-100 hover:bg-ink-700 hover:text-ink-50')}
            onClick={() => {
              setAnchor(null)
              onPick(t.key)
            }}
          >
            <span className={classNames('size-2 shrink-0 rounded-full', t.accent ?? 'bg-ink-400')} aria-hidden />
            <span className="min-w-0 truncate">{t.title}</span>
          </button>
        ))}
      </Popover>
    </span>
  )
}
