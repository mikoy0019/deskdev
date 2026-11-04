import { useCallback, useRef, useState, type ReactNode } from 'react'
import { classNames } from '../lib/format'
import { useMediaQuery } from '../pwa/useMediaQuery'
import { useStagger } from './motion'
import MoveToMenu from './MoveToMenu'

export interface KanbanColumn {
  key: string
  title: string
  /** Tailwind bg class for the header accent dot, e.g. 'bg-sky-400' */
  accent?: string
}

interface KanbanBoardProps<T extends { id: string }> {
  columns: KanbanColumn[]
  items: T[]
  getColumn: (item: T) => string
  renderCard: (item: T) => ReactNode
  onMove: (item: T, toKey: string) => void
  onCardClick?: (item: T) => void
  columnFooter?: (key: string) => ReactNode
  /** When false, hides drag + "Move to…" affordances (view-only users). Default true. */
  canMove?: boolean
  /** What a card *is*, for the empty column slot. Projects and Meetings are not "tasks". */
  itemNoun?: string
  /** Accessible label for a card, e.g. `(t) => t.title`. Falls back to "Open item". */
  getCardLabel?: (item: T) => string
  /** Extra classes on a card's shell — state that belongs to the whole card (e.g. blocked). */
  getCardClassName?: (item: T) => string | false | undefined
  /**
   * Where the "Move to…" control sits. 'footer' (default): a full-width button
   * under the card. 'corner': a small icon button in the card's top-right
   * corner — the card then needs no reserved band; renderCard must keep ~2rem
   * of its first line clear (pr-8).
   */
  moveControl?: 'footer' | 'corner'
  /** First-load cascade of the columns, once per session per key (motion/useStagger). */
  staggerKey?: string
  /**
   * Narrowest a column may get from md up, in px. Boards with many columns
   * (a 7-day week) then scroll sideways instead of crushing their cards.
   * Unset: the columns share the width equally, however narrow.
   */
  minColumnWidth?: number
}

/**
 * A card moved from its "Move to…" menu remounts in the other column, and
 * focus falls to <body> with it. Put it back on the card where it landed, so a
 * keyboard user carries on from there instead of from the top of the page.
 * Left alone when something still holds focus.
 */
function refocusMoved(board: Element | null, id: string): void {
  if (!board) return
  requestAnimationFrame(() => {
    const held = document.activeElement
    if (held && held !== document.body) return
    const card = [...board.querySelectorAll<HTMLElement>('[data-card-id]')].find(
      (c) => c.dataset.cardId === id,
    )
    card?.querySelector<HTMLElement>('button')?.focus()
  })
}

/**
 * Generic reusable kanban. Desktop: one grid column per status; mobile:
 * horizontally scrollable snap columns. Cards support HTML5 drag-and-drop
 * plus a "Move to…" menu for touch and keyboard — no external DnD dep.
 *
 * Card anatomy: the shell here provides the lift/dim while dragging, a
 * brand-tinted drop-slot indicator in the target column, and count badges in
 * the column headers. Card *contents* come from `renderCard`.
 */
export default function KanbanBoard<T extends { id: string }>({
  columns,
  items,
  getColumn,
  renderCard,
  onMove,
  onCardClick,
  columnFooter,
  canMove = true,
  itemNoun = 'items',
  getCardLabel,
  getCardClassName,
  moveControl = 'footer',
  staggerKey,
  minColumnWidth,
}: KanbanBoardProps<T>) {
  const { ref: attachStagger, className: staggerClass } = useStagger<HTMLDivElement>(
    `kanban-${staggerKey ?? 'off'}`,
  )
  const dragItem = useRef<T | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  // Drag only with a fine pointer: on touch, a long press on a draggable card
  // starts a native drag (iOS) that fights the board's sideways scroll. Touch
  // moves cards with "Move to…".
  const finePointer = useMediaQuery('(pointer: fine)')
  const canDrag = canMove && finePointer

  const draggingItem = draggingId ? items.find((i) => i.id === draggingId) ?? null : null
  const draggingCol = draggingItem ? getColumn(draggingItem) : null

  const boardRef = useRef<HTMLDivElement | null>(null)
  const setBoard = useCallback((el: HTMLDivElement | null) => {
    boardRef.current = el
    if (staggerKey) attachStagger(el)
  }, [staggerKey, attachStagger])
  const moveFromMenu = (item: T, toKey: string) => {
    onMove(item, toKey)
    refocusMoved(boardRef.current, item.id)
  }

  const endDrag = () => {
    dragItem.current = null
    setDraggingId(null)
    setDragOverKey(null)
  }

  return (
    // Below md the snap scroller bleeds through main's 16px padding to the screen
    // edges (scroll-padding keeps each snapped column aligned with the page).
    // overscroll-x-contain: a sideways swipe at the last column never turns
    // into the browser's back gesture or scrolls the page.
    <div
      ref={setBoard}
      data-kanban
      className={classNames(
        'flex md:grid gap-4 overflow-x-auto overscroll-x-contain snap-x snap-mandatory pb-2 max-md:-mx-4 max-md:px-4 max-md:scroll-px-4',
        // With a floor the board may scroll from md up too (proximity snap:
        // a wheel or trackpad is not dragged column by column).
        minColumnWidth ? 'md:snap-proximity' : 'md:overflow-x-visible',
        staggerKey && staggerClass,
      )}
      style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(${minColumnWidth ?? 0}px, 1fr))` }}
    >
      {columns.map((col) => {
        const colItems = items.filter((item) => getColumn(item) === col.key)
        // A live drop target only when a card from a *different* column is over it.
        const isTarget =
          dragOverKey === col.key && draggingCol !== null && draggingCol !== col.key
        return (
          <section
            key={col.key}
            className={classNames(
              'min-w-[280px] md:min-w-0 snap-start rounded-xl border flex flex-col transition-colors duration-150 ease-[ease]',
              isTarget
                ? 'border-brand-500/60 bg-brand-500/4'
                : 'border-ink-600 bg-ink-850/60',
            )}
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              if (dragOverKey !== col.key) setDragOverKey(col.key)
            }}
            onDragLeave={(e) => {
              // Ignore leaves that just cross into a child element of this column.
              if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
              setDragOverKey((k) => (k === col.key ? null : k))
            }}
            onDrop={(e) => {
              e.preventDefault()
              const item = dragItem.current
              endDrag()
              if (item && getColumn(item) !== col.key) onMove(item, col.key)
            }}
          >
            <header className="px-3 py-2.5 flex items-center gap-2 border-b border-ink-600">
              {col.accent && (
                <span className={classNames('w-2 h-2 rounded-full shrink-0', col.accent)} aria-hidden />
              )}
              <span className="section-title truncate">{col.title}</span>
              <span className="ml-auto text-xs tabular-nums text-ink-300">
                {colItems.length}
              </span>
            </header>

            <div className="flex-1 p-2 space-y-2 overflow-y-auto min-h-[120px]">
              {colItems.map((item) => {
                const isDragging = draggingId === item.id
                return (
                  <div
                    key={item.id}
                    data-card-id={item.id}
                    draggable={canDrag}
                    onDragStart={(e) => {
                      if (!canDrag) return
                      dragItem.current = item
                      setDraggingId(item.id)
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', item.id)
                    }}
                    onDragEnd={endDrag}
                    // The pointer opens the card from anywhere on it. Keyboard and
                    // screen readers get the overlay <button> below instead: a role=button
                    // card would nest the "Move to…" trigger inside a button
                    // (nested-interactive), which assistive tech can't operate reliably.
                    onClick={() => onCardClick?.(item)}
                    className={classNames(
                      'card card-hover pressable-card relative p-3 group/card',
                      getCardClassName?.(item),
                      isDragging
                        ? 'opacity-60 scale-[0.98] ring-1 ring-brand-500/50 shadow-none cursor-grabbing'
                        : onCardClick
                          ? 'cursor-pointer'
                          : canDrag
                            ? 'cursor-grab active:cursor-grabbing'
                            : '',
                    )}
                  >
                    {onCardClick && (
                      // Reachable by Tab, Enter/Space opens, and its ring outlines the
                      // whole card. pointer-events-none: mouse clicks land on the card
                      // (and its text stays hoverable for the truncation tooltips).
                      <button
                        type="button"
                        aria-label={getCardLabel?.(item) ?? 'Open item'}
                        className="pointer-events-none absolute inset-0 rounded-[inherit] focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 focus-visible:ring-offset-ink-900"
                        onClick={(e) => {
                          e.stopPropagation()
                          onCardClick(item)
                        }}
                      />
                    )}
                    {renderCard(item)}
                    {canMove && moveControl === 'corner' && (
                      // A small icon chip in the corner: no band reserved under every
                      // card. Hidden until hover / focus with a fine pointer; always
                      // there on touch, with a 44px hit area.
                      <div
                        className={classNames(
                          'absolute right-2 top-2 tap-target flex items-center justify-center pointer-coarse:right-0 pointer-coarse:top-0',
                          'transition-opacity duration-150 ease-out',
                          'pointer-fine:opacity-0 pointer-fine:group-hover/card:opacity-100 pointer-fine:group-focus-within/card:opacity-100 pointer-fine:has-[[aria-expanded=true]]:opacity-100',
                        )}
                      >
                        <MoveToMenu
                          variant="corner"
                          targets={columns.filter((c) => c.key !== col.key)}
                          onPick={(key) => moveFromMenu(item, key)}
                        />
                      </div>
                    )}
                    {canMove && moveControl === 'footer' && (
                      // The touch and keyboard fallback for drag-and-drop. With a fine
                      // pointer drag already works, so it fades in on hover and stays in
                      // the tab order. Opacity, not display: the space stays reserved so
                      // cards don't resize under the cursor. Keyed to the pointer, not
                      // the width, so it also shows on tablets, where hover never fires.
                      <MoveToMenu
                        variant="footer"
                        targets={columns.filter((c) => c.key !== col.key)}
                        onPick={(key) => moveFromMenu(item, key)}
                      />
                    )}
                  </div>
                )
              })}

              {/* Drop-slot indicator — reserves the landing space at the tail. */}
              {isTarget && (
                <div className="flex h-14 items-center justify-center rounded-lg border border-dashed border-brand-500/60 bg-brand-500/10 text-[11px] font-medium text-brand-600 dark:text-brand-400 animate-fade">
                  Move to {col.title}
                </div>
              )}

              {colItems.length === 0 && !isTarget && (
                <div className="text-center text-[11px] text-ink-300 py-6 border border-dashed border-ink-600 rounded-lg">
                  {canDrag ? `Drop ${itemNoun} here` : 'Nothing here'}
                </div>
              )}
            </div>

            {columnFooter && (
              <div className="p-2 border-t border-ink-600">{columnFooter(col.key)}</div>
            )}
          </section>
        )
      })}
    </div>
  )
}
