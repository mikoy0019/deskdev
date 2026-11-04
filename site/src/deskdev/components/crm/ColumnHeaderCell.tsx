import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLineLeftIcon, ArrowLineRightIcon, CheckIcon, DotsThreeIcon, FunctionIcon, ListChecksIcon,
  PencilSimpleIcon, PlusIcon, SwapIcon, TrashIcon,
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import ConfirmDialog from '../ConfirmDialog'
import Popover, { MenuItem, POPOVER_ROW } from './Popover'
import OptionsEditorModal from './OptionsEditorModal'
import { clampWidth, COLUMN_TYPES, COLUMN_WIDTH, columnTypeMeta } from './columnMeta'
import { useStore } from '../../store/useStore'
import { classNames } from '../../lib/format'
import type { CrmColumn } from '../../lib/types'

/**
 * Sticky grid header cell — type icon + name, plus (edit perm) a kebab menu:
 * rename inline, change type, edit select options or the formula, insert a
 * column beside it, move left/right, delete.
 *
 * Revision 4: the right edge drags to resize (arrow keys on the focused
 * edge; double-click resets), and hovering the header shows a small "+" on
 * each edge that inserts a column there — the menu offers the same for
 * touch and keyboard.
 */
export default function ColumnHeaderCell({
  column, canEdit, width, onResize, onResizeEnd, onInsert, onEditFormula,
}: {
  column: CrmColumn
  canEdit: boolean
  /** The width shown now (a drag in progress, the saved one, or the default). */
  width: number
  /** Live, while dragging. */
  onResize: (px: number) => void
  /** Settled: save it. `undefined` = back to the default. */
  onResizeEnd: (px: number | undefined) => void
  onInsert: (side: 'left' | 'right', anchor: HTMLElement) => void
  /** Open the formula editor for this column (also to turn it into one). */
  onEditFormula: () => void
}) {
  const crmColumns = useStore((s) => s.crmColumns)
  const updateCrmColumn = useStore((s) => s.updateCrmColumn)
  const deleteCrmColumn = useStore((s) => s.deleteCrmColumn)
  const reorderColumns = useStore((s) => s.reorderColumns)

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [showTypes, setShowTypes] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState('')
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Enter / Escape in the rename field hands focus back to the column's menu
  // button, so a keyboard user stays on the header instead of falling to <body>.
  const menuButton = useRef<HTMLButtonElement>(null)
  const refocus = useRef(false)
  useEffect(() => {
    if (renaming || !refocus.current) return
    refocus.current = false
    menuButton.current?.focus({ preventScroll: true })
  }, [renaming])

  const siblings = useMemo(
    () =>
      crmColumns
        .filter((c) => c.tableId === column.tableId)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [crmColumns, column.tableId],
  )
  const index = siblings.findIndex((c) => c.id === column.id)
  const meta = columnTypeMeta(column.type)
  const TypeIcon = meta.icon

  const closeMenu = () => {
    setMenuAnchor(null)
    setShowTypes(false)
  }

  const commitRename = () => {
    setRenaming(false)
    const name = draft.trim()
    if (!name || name === column.name) return
    updateCrmColumn(column.id, { name })
    toast.success('Column renamed')
  }

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const el = e.currentTarget
    const startX = e.clientX
    const startW = width
    let last = startW
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      last = clampWidth(startW + ev.clientX - startX)
      onResize(last)
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      onResizeEnd(last)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  const resizeKeys = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      onResizeEnd(clampWidth(width + (e.key === 'ArrowRight' ? step : -step)))
    } else if (e.key === 'Home' || e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      onResizeEnd(undefined)
    }
  }

  const moveBy = (delta: number) => {
    const ids = siblings.map((c) => c.id)
    const target = index + delta
    if (target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    reorderColumns(column.tableId, ids)
    closeMenu()
  }

  return (
    <th
      scope="col"
      // Raised while hovered or focused, so its edge "+" sits over the next header.
      className="group/th sticky top-0 z-10 hover:z-20 focus-within:z-20 overflow-visible bg-ink-800 border-b border-ink-600 px-1.5 py-1.5 text-left font-medium"
    >
      {renaming ? (
        <input
          className="w-full bg-ink-700 border border-brand-500 rounded-md px-2 py-1 text-xs text-ink-50 focus:outline-hidden focus:ring-1 focus:ring-brand-500"
          value={draft}
          autoFocus
          aria-label={`Rename column ${column.name}`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              // The same key press must not then open the menu it lands on.
              e.preventDefault()
              refocus.current = true
              commitRename()
            }
            if (e.key === 'Escape') {
              e.stopPropagation()
              refocus.current = true
              setRenaming(false)
            }
          }}
        />
      ) : (
        <div className="group/col flex items-center gap-1.5 px-1.5 py-0.5">
          <TypeIcon size={14} className="text-ink-400 shrink-0" aria-hidden />
          <span className="min-w-0 truncate text-xs font-medium text-ink-200" title={column.name}>{column.name}</span>
          {canEdit && (
            <button
              ref={menuButton}
              className={classNames(
                'pressable tap-target ml-auto shrink-0 p-1 pointer-coarse:p-2 rounded-sm text-ink-300 hover:text-ink-50 hover:bg-ink-700',
                // Hover-revealed for mice; touch never hovers, so it stays visible there.
                'opacity-0 group-hover/col:opacity-100 focus:opacity-100 pointer-coarse:opacity-100',
                menuAnchor && 'opacity-100',
              )}
              title="Column menu"
              aria-label={`Column menu: ${column.name}`}
              onClick={(e) => setMenuAnchor(e.currentTarget)}
            >
              <DotsThreeIcon size={16} aria-hidden />
            </button>
          )}
        </div>
      )}

      {canEdit && (
        <>
          {/* Mouse shortcuts for "Insert column left/right" (in the menu for touch and keyboard). */}
          {(['left', 'right'] as const).map((side) => (
            <button
              key={side}
              type="button"
              tabIndex={-1}
              aria-label={`Insert a column ${side === 'left' ? 'before' : 'after'} ${column.name}`}
              title={`Add a column ${side === 'left' ? 'to the left' : 'to the right'}`}
              onClick={(e) => onInsert(side, e.currentTarget)}
              className={classNames(
                'pressable absolute top-1/2 z-30 hidden size-5 -translate-y-1/2 items-center justify-center rounded-full bg-brand-600 text-white shadow-(--shadow-2) pointer-fine:flex',
                'opacity-0 transition-opacity duration-150 ease-out group-hover/th:opacity-100',
                side === 'left' ? '-left-2.5' : '-right-2.5',
              )}
            >
              <PlusIcon size={11} weight="bold" aria-hidden />
            </button>
          ))}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={`Resize column ${column.name}`}
            aria-valuenow={width}
            aria-valuemin={COLUMN_WIDTH.min}
            aria-valuemax={COLUMN_WIDTH.max}
            tabIndex={0}
            title="Drag to resize · double-click to reset"
            onPointerDown={startResize}
            onDoubleClick={() => onResizeEnd(undefined)}
            onKeyDown={resizeKeys}
            className="group/edge absolute -right-1 top-0 z-20 flex h-full w-2 cursor-col-resize touch-none justify-center focus:outline-hidden"
          >
            <span className="h-full w-0.5 rounded-full bg-transparent transition-colors duration-150 group-hover/edge:bg-brand-500 group-focus-visible/edge:bg-brand-500 group-active/edge:bg-brand-500" aria-hidden />
          </div>
        </>
      )}

      <Popover
        anchor={menuAnchor}
        onClose={closeMenu}
        align="right"
        role="menu"
        label={showTypes ? `Change type: ${column.name}` : `Column menu: ${column.name}`}
      >
        {showTypes ? (
          <>
            <p className="section-title px-3 pt-1.5 pb-1 pointer-coarse:px-4" aria-hidden>Change type</p>
            {COLUMN_TYPES.map((t) => (
              <button
                key={t.type}
                type="button"
                role="menuitemradio"
                aria-checked={t.type === column.type}
                className={classNames(POPOVER_ROW, 'text-ink-100 hover:bg-ink-700 hover:text-ink-50')}
                onClick={() => {
                  closeMenu()
                  if (t.type === column.type) return
                  // A formula needs writing first: the editor saves the type with it.
                  if (t.type === 'formula') {
                    onEditFormula()
                    return
                  }
                  updateCrmColumn(column.id, { type: t.type, formula: undefined })
                  toast.success(`Column type changed to ${t.label}`)
                }}
              >
                <t.icon size={16} className="shrink-0 text-ink-300" aria-hidden />
                {t.label}
                {t.type === column.type && (
                  <CheckIcon size={14} className="ml-auto text-brand-600 dark:text-brand-400" aria-hidden />
                )}
              </button>
            ))}
          </>
        ) : (
          <>
            <MenuItem
              icon={PencilSimpleIcon}
              label="Rename"
              onClick={() => {
                closeMenu()
                setDraft(column.name)
                setRenaming(true)
              }}
            />
            <MenuItem
              icon={SwapIcon}
              label="Change type…"
              onClick={() => setShowTypes(true)}
            />
            {column.type === 'formula' && (
              <MenuItem
                icon={FunctionIcon}
                label="Edit formula…"
                onClick={() => {
                  closeMenu()
                  onEditFormula()
                }}
              />
            )}
            {(column.type === 'select' || column.type === 'multi_select') && (
              <MenuItem
                icon={ListChecksIcon}
                label="Edit options"
                onClick={() => {
                  closeMenu()
                  setOptionsOpen(true)
                }}
              />
            )}
            <MenuItem
              icon={PlusIcon}
              label="Insert column left"
              onClick={() => {
                const anchor = menuButton.current
                closeMenu()
                if (anchor) onInsert('left', anchor)
              }}
            />
            <MenuItem
              icon={PlusIcon}
              label="Insert column right"
              onClick={() => {
                const anchor = menuButton.current
                closeMenu()
                if (anchor) onInsert('right', anchor)
              }}
            />
            <MenuItem
              icon={ArrowLineLeftIcon}
              label="Move left"
              disabled={index <= 0}
              onClick={() => moveBy(-1)}
            />
            <MenuItem
              icon={ArrowLineRightIcon}
              label="Move right"
              disabled={index === siblings.length - 1}
              onClick={() => moveBy(1)}
            />
            <MenuItem
              icon={TrashIcon}
              label="Delete column"
              danger
              onClick={() => {
                closeMenu()
                setConfirmDelete(true)
              }}
            />
          </>
        )}
      </Popover>

      <OptionsEditorModal
        open={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        column={column}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete column"
        message={`Delete column "${column.name}"? All cell values in this column will be lost.`}
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          deleteCrmColumn(column.id)
          toast.success('Column deleted')
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </th>
  )
}
