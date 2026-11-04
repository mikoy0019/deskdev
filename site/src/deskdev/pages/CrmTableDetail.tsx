import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeftIcon, PencilSimpleIcon, PlusIcon, RowsIcon, TrashIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { toast } from 'sonner'
import Layout from '../components/Layout'
import { EmptyState, SkeletonLine } from '../components/ui-foundation'
import ConfirmDialog from '../components/ConfirmDialog'
import Popover, { MenuItem } from '../components/crm/Popover'
import ColumnHeaderCell from '../components/crm/ColumnHeaderCell'
import CrmCell from '../components/crm/CrmCell'
import FormulaEditorModal, { type FormulaEditorState } from '../components/crm/FormulaEditorModal'
import { COLUMN_TYPES, COLUMN_WIDTH } from '../components/crm/columnMeta'
import { useStagger } from '../components/motion'
import { useStore, useCurrentUser } from '../store/useStore'
import { can } from '../lib/permissions'
import { classNames } from '../lib/format'
import { evaluateFormulaColumn, type FormulaResult } from '../lib/crmFormula'
import type { CrmColumnType } from '../lib/types'

/** Grid-shaped placeholder while the store rehydrates: toolbar, header row, cells. */
function GridSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-busy="true" aria-label="Loading table">
      <div className="flex items-center gap-3">
        <SkeletonLine w={28} className="h-7" />
        <SkeletonLine w={180} className="h-5" />
        <SkeletonLine w={48} className="h-3" />
      </div>
      <div className="card overflow-hidden">
        <div className="flex items-center border-b border-ink-600">
          <span className="w-11 shrink-0 h-9 border-r border-ink-600" />
          {['14%', '11%', '9%', '12%'].map((w, i) => (
            <div key={i} className="w-40 shrink-0 px-3 py-3 border-r border-ink-600/50">
              <SkeletonLine w={w === '14%' ? '70%' : '55%'} className="h-3" />
            </div>
          ))}
        </div>
        {Array.from({ length: 6 }).map((_, r) => (
          <div key={r} className="flex items-center border-b border-ink-600/50 last:border-b-0">
            <span className="w-11 shrink-0 h-10 border-r border-ink-600" />
            {[0, 1, 2, 3].map((c) => (
              <div key={c} className="w-40 shrink-0 px-3 py-3 border-r border-ink-600/50">
                <SkeletonLine w={`${45 + ((r * 3 + c * 5) % 40)}%`} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// Sticky styles shared by the row-number gutter (kept opaque so grid content
// scrolls cleanly beneath it).
const GUTTER = 'sticky left-0 z-10 w-11 bg-ink-800 border-r border-ink-600'
const GUTTER_PX = 44

export default function CrmTableDetail() {
  const { tableId } = useParams()
  const user = useCurrentUser()
  const canEdit = can(user, 'crm', 'edit')

  const hydrated = useStore((s) => s.hydrated)
  const table = useStore((s) => s.crmTables.find((t) => t.id === tableId))
  const crmColumns = useStore((s) => s.crmColumns)
  const crmRows = useStore((s) => s.crmRows)
  const clients = useStore((s) => s.clients)
  const users = useStore((s) => s.users)
  const updateCrmTable = useStore((s) => s.updateCrmTable)
  const addCrmColumn = useStore((s) => s.addCrmColumn)
  const updateCrmColumn = useStore((s) => s.updateCrmColumn)
  const addCrmRow = useStore((s) => s.addCrmRow)
  const setCellValue = useStore((s) => s.setCellValue)
  const deleteCrmRow = useStore((s) => s.deleteCrmRow)

  // Toolbar state
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  // Enter / Escape in the rename field hands focus back to the name button,
  // so a keyboard user is not dropped to <body>.
  const nameButton = useRef<HTMLButtonElement>(null)
  const refocusName = useRef(false)
  useEffect(() => {
    if (editingName || !refocusName.current) return
    refocusName.current = false
    nameButton.current?.focus({ preventScroll: true })
  }, [editingName])

  // Add-column mini-form state
  const [addColAnchor, setAddColAnchor] = useState<HTMLElement | null>(null)
  const [colName, setColName] = useState('')
  const [colType, setColType] = useState<CrmColumnType>('text')
  const [colError, setColError] = useState<string | null>(null)
  // Where the new column goes: a sortOrder from a header's "+", or the end.
  const [insertAt, setInsertAt] = useState<number | undefined>(undefined)
  const [formulaEditor, setFormulaEditor] = useState<FormulaEditorState>(null)
  // A width being dragged, shown before it is saved.
  const [liveWidth, setLiveWidth] = useState<{ id: string; px: number } | null>(null)
  const uid = useId()

  // Row state
  const [deleteRowId, setDeleteRowId] = useState<string | null>(null)
  // Touch: the row number opens the row's actions (no column of bin icons).
  const [rowMenu, setRowMenu] = useState<{ rowId: string; n: number; anchor: HTMLElement } | null>(null)
  const [focusCell, setFocusCell] = useState<{ rowId: string; colId: string } | null>(null)

  const columns = useMemo(
    () =>
      crmColumns
        .filter((c) => c.tableId === tableId)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [crmColumns, tableId],
  )

  const rows = useMemo(
    () =>
      crmRows
        .filter((r) => r.tableId === tableId)
        .sort((a, b) => a.position - b.position),
    [crmRows, tableId],
  )

  // Formula columns, worked out for every row from its other cells.
  const results = useMemo(() => {
    const formulas = columns.filter((c) => c.type === 'formula')
    const out = new Map<string, FormulaResult>()
    if (formulas.length === 0) return out
    const userName = (id: string) => users.find((u) => u.id === id)?.fullName
    for (const row of rows) {
      for (const col of formulas) out.set(`${row.id}:${col.id}`, evaluateFormulaColumn(col, { columns, row, userName }))
    }
    return out
  }, [columns, rows, users])

  const widthOf = (col: { id: string; width?: number }) =>
    liveWidth?.id === col.id ? liveWidth.px : col.width ?? COLUMN_WIDTH.default

  // First load of a grid this session: rows arrive 40ms apart, once — never
  // on Add row, a cell edit or the next table opened.
  const { ref: attachStagger, className: staggerClass } = useStagger<HTMLTableSectionElement>('crm-grid')

  // Rehydration window — resolve the table lookup only once the store is ready
  // so a not-yet-loaded store never renders the "not found" state by mistake.
  if (!hydrated) {
    return (
      <Layout title="CRM" subtitle="Loading…">
        <GridSkeleton />
      </Layout>
    )
  }

  if (!table) {
    return (
      <Layout title="CRM table" subtitle="Not found">
        <EmptyState
          glyph="search-empty"
          title="Table not found"
          description="This table may have been deleted or the link is out of date."
          action={
            <Link to="/crm" className="btn-secondary">
              <ArrowLeftIcon size={14} aria-hidden />
              Back to CRM
            </Link>
          }
        />
      </Layout>
    )
  }

  const client = table.clientId ? clients.find((c) => c.id === table.clientId) : undefined

  const commitName = () => {
    setEditingName(false)
    const name = nameDraft.trim()
    if (!name || name === table.name) return
    updateCrmTable(table.id, { name })
    toast.success('Table renamed')
  }

  const submitColumn = () => {
    const name = colName.trim()
    if (!name) {
      // Under the field it belongs to, not in a toast across the screen.
      setColError('Column name is required')
      document.getElementById(`${uid}-col`)?.focus()
      return
    }
    // A formula is written in its own editor before the column exists.
    if (colType === 'formula') {
      setFormulaEditor({ mode: 'new', tableId: table.id, name, sortOrder: insertAt })
      setAddColAnchor(null)
      return
    }
    addCrmColumn({ tableId: table.id, name, type: colType, sortOrder: insertAt })
    toast.success('Column added')
    setColName('')
    setColType('text')
    setAddColAnchor(null)
  }

  const addRow = () => {
    const id = addCrmRow({ tableId: table.id })
    if (columns.length > 0) setFocusCell({ rowId: id, colId: columns[0].id })
    toast.success('Row added')
  }

  const openAddColumn = (anchor: HTMLElement, at?: number) => {
    setColName('')
    setColType('text')
    setColError(null)
    setInsertAt(at)
    setAddColAnchor(anchor)
  }

  const tableWidth = GUTTER_PX + columns.reduce((sum, c) => sum + widthOf(c), 0)

  return (
    <Layout title="CRM" subtitle={table.name}>
      <div className="space-y-4">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          {/* Phones get the top bar's chevron (to /crm) instead of a second one here. */}
          <Link to="/crm" className="max-md:hidden btn-ghost px-2 pointer-coarse:min-h-11 pointer-coarse:min-w-11" title="Back to CRM" aria-label="Back to CRM">
            <ArrowLeftIcon size={16} aria-hidden />
          </Link>
          <span
            className={classNames('w-1.5 h-6 rounded-full shrink-0', !table.color && 'bg-ink-500')}
            style={table.color ? { backgroundColor: table.color } : undefined}
            aria-hidden
          />
          {editingName ? (
            <input
              className="input py-1 text-lg font-semibold w-full max-w-[280px] min-w-0"
              aria-label="Table name"
              value={nameDraft}
              autoFocus
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  // The same key press must not then reopen the field from the button it lands on.
                  e.preventDefault()
                  refocusName.current = true
                  commitName()
                }
                if (e.key === 'Escape') {
                  refocusName.current = true
                  setEditingName(false)
                }
              }}
            />
          ) : (
            <h1 className="min-w-0 max-w-[50vw] max-sm:max-w-[calc(100%-6rem)] text-display text-lg font-semibold text-ink-50">
              {canEdit ? (
                // A real button: the rename is reachable by keyboard, not just a click on text.
                <button
                  ref={nameButton}
                  type="button"
                  className="group/name pressable flex items-center gap-2 max-w-full rounded-md text-left pointer-coarse:min-h-11 hover:text-brand-700 dark:hover:text-brand-400 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500"
                  title="Click to rename"
                  onClick={() => {
                    setNameDraft(table.name)
                    setEditingName(true)
                  }}
                >
                  <span className="truncate">{table.name}</span>
                  <PencilSimpleIcon
                    size={14}
                    className="shrink-0 text-ink-400 opacity-0 group-hover/name:opacity-100 group-focus-visible/name:opacity-100 pointer-coarse:hidden transition-opacity duration-150 ease-[ease]"
                    aria-hidden
                  />
                </button>
              ) : (
                <span className="block truncate">{table.name}</span>
              )}
            </h1>
          )}
          {client && (
            <span className="chip max-w-56 bg-ink-700 text-ink-100 border-ink-500">
              <span
                className={classNames('w-2 h-2 rounded-full shrink-0', !client.color && 'bg-ink-400')}
                style={client.color ? { backgroundColor: client.color } : undefined}
                aria-hidden
              />
              <span className="truncate">{client.name}</span>
            </span>
          )}
          <span className="text-xs text-ink-300 whitespace-nowrap">
            <span className="tabular-nums text-ink-200">{rows.length.toLocaleString('en-US')}</span> row
            {rows.length === 1 ? '' : 's'}
          </span>
          {canEdit && columns.length > 0 && (
            <button className="btn-primary ml-auto pointer-coarse:min-h-11" onClick={addRow}>
              <PlusIcon size={16} aria-hidden />
              Add row
            </button>
          )}
        </div>

        {/* Grid */}
        {columns.length === 0 ? (
          <EmptyState
            glyph="crm"
            title="This table has no columns yet"
            description="Add your first column to start filling in rows — pick from text, number, select, multi-select, date, checkbox, URL, a person, or a formula that fills itself in."
            action={
              canEdit ? (
                <button className="btn-primary" onClick={(e) => openAddColumn(e.currentTarget)}>
                  <PlusIcon size={16} aria-hidden />
                  Add column
                </button>
              ) : undefined
            }
          />
        ) : (
          // dvh, not vh: mobile Safari's 100vh runs under its toolbar. Phones also lose
          // the tab bar and safe areas, or the page scrolls around the grid's own scroller.
          <div className="card overflow-auto max-h-[calc(100dvh-14rem)] max-md:max-h-[calc(100dvh-14rem-var(--tabbar-h,0px)-var(--safe-top,0px)-var(--safe-bottom,0px))]">
            {/* Fixed layout: each column is as wide as its <col>, which its header's edge resizes. */}
            <table aria-label={table.name} className="table-fixed border-collapse text-sm tabular-nums" style={{ width: tableWidth }}>
              <colgroup>
                <col style={{ width: GUTTER_PX }} />
                {columns.map((col) => (
                  <col key={col.id} style={{ width: widthOf(col) }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" className={classNames(GUTTER, 'top-0 z-20 border-b border-ink-600 px-2 py-2')}>
                    <span className="sr-only">Row</span>
                  </th>
                  {columns.map((col, i) => (
                    <ColumnHeaderCell
                      key={col.id}
                      column={col}
                      canEdit={canEdit}
                      width={widthOf(col)}
                      onResize={(px) => setLiveWidth({ id: col.id, px })}
                      onResizeEnd={(px) => {
                        setLiveWidth(null)
                        if (px !== col.width) updateCrmColumn(col.id, { width: px })
                      }}
                      onInsert={(side, anchor) =>
                        openAddColumn(anchor, side === 'left' ? col.sortOrder : (columns[i + 1]?.sortOrder ?? col.sortOrder + 1))
                      }
                      onEditFormula={() => setFormulaEditor({ mode: 'edit', column: col })}
                    />
                  ))}
                </tr>
              </thead>
              <tbody ref={attachStagger} className={staggerClass}>
                {rows.map((row, i) => (
                  <tr key={row.id} className="group hover:bg-ink-700/40 transition-colors duration-150 ease-[ease]">
                    <td
                      className={classNames(
                        GUTTER,
                        'border-b border-ink-600/50 px-2 text-center align-middle group-hover:bg-ink-700',
                      )}
                    >
                      {canEdit ? (
                        <>
                          {/* Mouse + keyboard: the bin replaces the row number on hover, and
                              focus-within reveals it on Tab, so it is operable without a
                              pointer. Touch never hovers, and a bin on every row is loud
                              and easy to hit while scrolling — so under a finger the row
                              number itself opens the row's action sheet. */}
                          <span className="text-[11px] text-ink-400 tabular-nums group-hover:hidden group-focus-within:hidden pointer-coarse:hidden">
                            {i + 1}
                          </span>
                          <button
                            className="pressable hidden pointer-coarse:inline-flex items-center justify-center min-w-11 min-h-11 -mx-2 rounded-sm text-[11px] text-ink-400 tabular-nums"
                            aria-label={`Row ${i + 1} actions`}
                            aria-haspopup="menu"
                            aria-expanded={rowMenu?.rowId === row.id}
                            onClick={(e) => setRowMenu({ rowId: row.id, n: i + 1, anchor: e.currentTarget })}
                          >
                            {i + 1}
                          </button>
                          <button
                            className="pressable hidden group-hover:inline-flex group-focus-within:inline-flex focus-visible:inline-flex pointer-coarse:hidden! p-1 rounded-sm text-ink-300 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-ink-600 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500"
                            title="Delete row"
                            aria-label={`Delete row ${i + 1}`}
                            onClick={() => setDeleteRowId(row.id)}
                          >
                            <TrashIcon size={14} aria-hidden />
                          </button>
                        </>
                      ) : (
                        <span className="text-[11px] text-ink-400 tabular-nums">{i + 1}</span>
                      )}
                    </td>
                    {columns.map((col) => (
                      <td
                        key={col.id}
                        className="border-b border-r border-ink-600/50 p-0 align-middle overflow-hidden"
                      >
                        <CrmCell
                          column={col}
                          value={row.values[col.id]}
                          canEdit={canEdit}
                          onCommit={(v) => setCellValue(row.id, col.id, v)}
                          autoEdit={
                            focusCell?.rowId === row.id && focusCell?.colId === col.id
                          }
                          result={results.get(`${row.id}:${col.id}`)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}

                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length + 1} className="p-0">
                      {/* Pinned to the visible width, so a wide table never pushes it off-screen. */}
                      <div className="sticky left-0 w-[min(100%,calc(100vw-2rem))] md:w-full max-w-xl px-4 py-10 flex flex-col items-start sm:items-center sm:mx-auto text-sm text-ink-300">
                        <RowsIcon size={20} className="text-ink-400 mb-2" aria-hidden />
                        No rows yet.
                        {canEdit && (
                          <button
                            className="btn-secondary mt-3 pointer-coarse:min-h-11"
                            onClick={addRow}
                          >
                            <PlusIcon size={16} aria-hidden />
                            Add the first row
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  canEdit && (
                    <tr>
                      <td colSpan={columns.length + 1} className="p-0">
                        <button
                          className="pressable sticky left-0 flex items-center gap-1.5 px-3 py-2 pointer-coarse:min-h-11 text-xs text-ink-300 hover:text-ink-50 whitespace-nowrap"
                          onClick={addRow}
                          title="Add row"
                        >
                          <PlusIcon size={14} aria-hidden />
                          New row
                        </button>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add-column mini-form */}
      <Popover anchor={addColAnchor} onClose={() => setAddColAnchor(null)} align="right" label="New column">
        <div className="p-3 max-sm:px-4 space-y-3 w-60 max-sm:w-full">
          <div className="space-y-1.5">
            <label htmlFor={`${uid}-col`} className="block text-xs font-medium text-ink-200 max-sm:sr-only">New column</label>
            <input
              id={`${uid}-col`}
              className={classNames('input w-full py-1.5', colError && 'border-rose-500! focus:ring-rose-500/20!')}
              value={colName}
              autoFocus
              placeholder="Column name"
              aria-invalid={colError ? true : undefined}
              aria-describedby={colError ? `${uid}-col-error` : undefined}
              onChange={(e) => {
                setColName(e.target.value)
                if (colError) setColError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitColumn()
              }}
            />
            {colError && (
              <p id={`${uid}-col-error`} className="flex items-center gap-1.5 text-xs text-rose-700 dark:text-rose-400 animate-fade">
                <WarningCircleIcon size={14} className="shrink-0" aria-hidden />
                {colError}
              </p>
            )}
          </div>
          <label className="block space-y-1.5">
            <span className="block text-xs font-medium text-ink-200">Type</span>
            <select
              className="input w-full py-1.5"
              value={colType}
              onChange={(e) => setColType(e.target.value as CrmColumnType)}
            >
              {COLUMN_TYPES.map((t) => (
                <option key={t.type} value={t.type}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          {colType === 'formula' && (
            <p className="text-xs leading-relaxed text-ink-300">Next you write the formula, e.g. {'{Deal value}'} * 0.1.</p>
          )}
          <button className="btn-primary w-full justify-center pointer-coarse:min-h-11" onClick={submitColumn}>
            <PlusIcon size={16} aria-hidden />
            {colType === 'formula' ? 'Next' : 'Add column'}
          </button>
        </div>
      </Popover>

      <Popover
        anchor={rowMenu?.anchor ?? null}
        onClose={() => setRowMenu(null)}
        role="menu"
        label={rowMenu ? `Row ${rowMenu.n}` : 'Row'}
      >
        {rowMenu && (
          <MenuItem
            icon={TrashIcon}
            label="Delete row"
            danger
            onClick={() => {
              setDeleteRowId(rowMenu.rowId)
              setRowMenu(null)
            }}
          />
        )}
      </Popover>

      <FormulaEditorModal state={formulaEditor} onClose={() => setFormulaEditor(null)} />

      <ConfirmDialog
        open={deleteRowId !== null}
        title="Delete row"
        message="Delete this row? Its cell values will be removed permanently."
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (!deleteRowId) return
          deleteCrmRow(deleteRowId)
          toast.success('Row deleted')
        }}
        onClose={() => setDeleteRowId(null)}
      />
    </Layout>
  )
}
