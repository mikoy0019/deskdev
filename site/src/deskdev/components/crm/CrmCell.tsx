import { useEffect, useId, useRef, useState } from 'react'
import { ArrowSquareOutIcon, CheckIcon, LinkSimpleIcon, WarningCircleIcon } from '@phosphor-icons/react'
import Avatar from '../Avatar'
import { toast } from 'sonner'
import { DateField } from '../pickers'
import Popover, { POPOVER_ROW } from './Popover'
import { draftError } from './cellDraft'
import {
  asBool, asDateString, asNumber, asOptionId, asOptionIds, asText, OptionChip,
} from './columnMeta'
import { classNames, fmtDate } from '../../lib/format'
import { formatFormulaValue, type FormulaResult } from '../../lib/crmFormula'
import { activeUsers, isDeactivated } from '../../lib/permissions'
import { useStore } from '../../store/useStore'
import type { CrmCellValue, CrmColumn } from '../../lib/types'

// Rows grow to a 44px tap target on touch; mouse density is unchanged.
const DISPLAY_CLASS =
  'min-h-[36px] pointer-coarse:min-h-11 w-full flex items-center gap-1.5 px-3 py-1.5 text-sm text-ink-100'
/** An editable cell is a real button (keyboard + screen reader reach it); the
    hover tint and the inset focus ring mark it as the active cell. */
const EDITABLE =
  'text-left cursor-pointer hover:bg-ink-700/60 transition-colors duration-150 ease-[ease] focus:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 [-webkit-touch-callout:none]'
/** Chips a multi-select cell shows before it rolls the rest into "+N". */
const MULTI_SHOWN = 3
const INPUT_CLASS =
  'w-full bg-ink-700 border border-brand-500 rounded-md px-2.5 py-1.5 text-sm text-ink-50 focus:outline-hidden focus:ring-1 focus:ring-brand-500'

/**
 * The app's checkbox, not the browser's: a 16px box (20px under a finger) that
 * fills with the brand colour and a white tick, as the member picker draws it.
 */
function Checkbox({ className, ...rest }: Omit<React.ComponentProps<'input'>, 'type'>) {
  return (
    <span className="relative inline-flex shrink-0">
      <input
        type="checkbox"
        className={classNames(
          'peer size-4 pointer-coarse:size-5 appearance-none rounded-[4px] border border-ink-500 not-checked:bg-ink-800 dark:not-checked:bg-ink-850',
          'transition-colors duration-150 ease-[ease] checked:border-brand-600 checked:bg-brand-600',
          'enabled:cursor-pointer disabled:opacity-50',
          className,
        )}
        {...rest}
      />
      <CheckIcon
        size={12}
        weight="bold"
        className="pointer-events-none absolute inset-0 m-auto text-white opacity-0 peer-checked:opacity-100 peer-disabled:peer-checked:opacity-50"
        aria-hidden
      />
    </span>
  )
}

/** The editable text form of a cell value (numbers as plain digits). */
function draftText(column: CrmColumn, value: CrmCellValue | undefined): string {
  if (column.type === 'number') {
    const n = asNumber(value)
    return n === null ? '' : String(n)
  }
  return asText(value)
}

/**
 * One grid cell — renders + inline-edits a value according to the column type.
 * Values are parsed defensively so leftovers from a column type change never
 * crash the grid. Commit on blur/Enter, cancel on Escape.
 */
export default function CrmCell({
  column, value, canEdit, onCommit, autoEdit, result,
}: {
  column: CrmColumn
  value: CrmCellValue | undefined
  canEdit: boolean
  onCommit: (v: CrmCellValue) => void
  /** Start in edit mode on mount (used to focus the first cell of a new row) */
  autoEdit?: boolean
  /** A formula column's worked-out value for this row. */
  result?: FormulaResult
}) {
  // A formula cell is read-only: its value comes from the row's other cells.
  if (column.type === 'formula') return <FormulaCell column={column} result={result} />
  if (column.type === 'person') return <PersonCell column={column} value={value} canEdit={canEdit} onCommit={onCommit} />
  return <EditableCell column={column} value={value} canEdit={canEdit} onCommit={onCommit} autoEdit={autoEdit} />
}

const DATE_RESULT = /^\d{4}-\d{2}-\d{2}$/

/** A formula's result, or the reason it has none (#REF, #DIV/0…) with the cause on hover. */
function FormulaCell({ column, result }: { column: CrmColumn; result?: FormulaResult }) {
  if (!result) return <div className={DISPLAY_CLASS} />
  if (!result.ok) {
    return (
      <div className={classNames(DISPLAY_CLASS, 'font-mono text-xs text-rose-700 dark:text-rose-400')} title={result.message}>
        <span aria-hidden>{result.code}</span>
        <span className="sr-only">{`${column.name}: ${result.message}`}</span>
      </div>
    )
  }
  const v = result.value
  const shown = typeof v === 'string' && DATE_RESULT.test(v) ? fmtDate(v) : formatFormulaValue(v)
  return (
    <div
      className={classNames(DISPLAY_CLASS, 'text-ink-200', typeof v === 'number' && 'justify-end tabular-nums')}
      aria-label={`${column.name}: ${shown || 'empty'}`}
    >
      <span className="truncate" title={shown || undefined}>{shown}</span>
    </div>
  )
}

/** A teammate: their face and name; the picker lists active accounts. */
function PersonCell({
  column, value, canEdit, onCommit,
}: {
  column: CrmColumn
  value: CrmCellValue | undefined
  canEdit: boolean
  onCommit: (v: CrmCellValue) => void
}) {
  const users = useStore((s) => s.users)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const id = typeof value === 'string' ? value : null
  const person = id ? users.find((u) => u.id === id) : undefined
  const name = person?.fullName ?? (id ? 'Former teammate' : '')
  const face = id && (
    <>
      <Avatar name={name} size="sm" />
      <span className={classNames('truncate', person && isDeactivated(person) && 'text-ink-300')} title={name}>{name}</span>
    </>
  )
  if (!canEdit) return <div className={DISPLAY_CLASS}>{face}</div>
  return (
    <>
      <button
        type="button"
        className={classNames(DISPLAY_CLASS, EDITABLE)}
        aria-label={`${column.name}: ${name || 'empty'}`}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={(e) => setAnchor(e.currentTarget)}
      >
        {face}
      </button>
      <Popover anchor={anchor} onClose={() => setAnchor(null)} label={column.name} role="menu">
        {[...activeUsers(users)].sort((a, b) => a.fullName.localeCompare(b.fullName)).map((u) => (
          <button
            key={u.id}
            type="button"
            role="menuitemradio"
            aria-checked={u.id === id}
            className={classNames(POPOVER_ROW, 'gap-2.5 text-ink-100 hover:bg-ink-700')}
            onClick={() => {
              onCommit(u.id)
              setAnchor(null)
            }}
          >
            <Avatar name={u.fullName} size="sm" />
            <span className="min-w-0 truncate">{u.fullName}</span>
            {u.id === id && <CheckIcon size={14} className="ml-auto text-brand-600 dark:text-brand-400" aria-hidden />}
          </button>
        ))}
        {id && (
          <button
            type="button"
            role="menuitem"
            className={classNames(POPOVER_ROW, 'mt-1 border-t border-ink-600 text-xs text-ink-300 hover:bg-ink-700 hover:text-ink-100')}
            onClick={() => {
              onCommit(null)
              setAnchor(null)
            }}
          >
            Clear value
          </button>
        )}
      </Popover>
    </>
  )
}

function EditableCell({
  column, value, canEdit, onCommit, autoEdit,
}: {
  column: CrmColumn
  value: CrmCellValue | undefined
  canEdit: boolean
  onCommit: (v: CrmCellValue) => void
  autoEdit?: boolean
}) {
  const [editing, setEditing] = useState(Boolean(autoEdit && canEdit))
  // Seeded up front when auto-editing a freshly added row's first cell;
  // startEdit re-seeds it on every later edit.
  const [draft, setDraft] = useState(() => (autoEdit && canEdit ? draftText(column, value) : ''))
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const displayRef = useRef<HTMLButtonElement>(null)
  // Enter / Escape in an editor hands focus back to the cell, so a keyboard
  // user stays on the grid instead of falling to <body>.
  const refocus = useRef(false)
  // A number that won't parse or a link that isn't one, caught on Enter: said
  // under the field, which stays open to fix it. (Blurring away instead
  // discards it with a toast — by then the field is gone.)
  const [error, setError] = useState<string | null>(null)
  const invalid = error !== null
  const errorId = useId()

  // Focus the native input for editors that don't autoFocus (DateField).
  useEffect(() => {
    if (editing) wrapRef.current?.querySelector('input')?.focus()
    else if (refocus.current) {
      refocus.current = false
      displayRef.current?.focus({ preventScroll: true })
    }
  }, [editing])

  const textValue = () => draftText(column, value)

  const startEdit = () => {
    if (!canEdit) return
    setDraft(textValue())
    setError(null)
    setEditing(true)
  }

  const commitText = (fromEnter = false) => {
    const trimmed = draft.trim()
    const problem = draftError(column.type, trimmed)
    if (problem) {
      if (fromEnter) {
        refocus.current = false
        setError(problem)
        return
      }
      setEditing(false)
      setError(null)
      toast.error(problem)
      return
    }
    setEditing(false)
    setError(null)
    if (column.type === 'number') {
      onCommit(trimmed === '' ? null : Number(trimmed))
      return
    }
    onCommit(trimmed === '' ? null : trimmed)
  }

  const inputKeys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      // Focus goes back to the cell's button while this key is still down:
      // without this the same press would activate it and reopen the editor.
      e.preventDefault()
      refocus.current = true
      commitText(true)
    }
    if (e.key === 'Escape') {
      e.stopPropagation()
      refocus.current = true
      setError(null)
      setEditing(false)
    }
  }

  /** The reason a draft was refused, under its field. */
  const errorLine = error && (
    <p id={errorId} role="alert" className="mt-1 flex items-center gap-1 text-xs text-rose-700 dark:text-rose-400 animate-fade">
      <WarningCircleIcon size={14} className="shrink-0" aria-hidden />
      {error}
    </p>
  )

  // ─── checkbox ──────────────────────────────────────────────────────────────
  if (column.type === 'checkbox') {
    // A label, so the whole cell toggles — the 16px box alone is a hard tap.
    return (
      <label
        className={classNames(
          'min-h-[36px] pointer-coarse:min-h-11 flex items-center justify-center px-3',
          canEdit && 'cursor-pointer',
        )}
      >
        <Checkbox
          checked={asBool(value)}
          disabled={!canEdit}
          aria-label={column.name}
          onChange={(e) => onCommit(e.target.checked)}
        />
      </label>
    )
  }

  // ─── select ────────────────────────────────────────────────────────────────
  if (column.type === 'select') {
    const id = asOptionId(value)
    const option = column.options.find((o) => o.id === id)
    return (
      <>
        <button
          type="button"
          className={classNames(DISPLAY_CLASS, canEdit && EDITABLE)}
          disabled={!canEdit}
          aria-label={`${column.name}: ${option?.label ?? id ?? 'empty'}`}
          aria-haspopup={canEdit ? 'menu' : undefined}
          aria-expanded={canEdit ? anchor !== null : undefined}
          onClick={(e) => setAnchor(e.currentTarget)}
        >
          {id ? <OptionChip option={option} fallbackLabel={id} /> : null}
        </button>
        <Popover anchor={anchor} onClose={() => setAnchor(null)} label={column.name} role="menu">
          {column.options.length === 0 && (
            <p className="px-3 py-2 pointer-coarse:px-4 text-xs text-ink-300">
              No options yet — add some via the column menu.
            </p>
          )}
          {column.options.map((o) => (
            <button
              key={o.id}
              type="button"
              role="menuitemradio"
              aria-checked={o.id === id}
              className={classNames(POPOVER_ROW, 'hover:bg-ink-700')}
              onClick={() => {
                onCommit(o.id)
                setAnchor(null)
              }}
            >
              <OptionChip option={o} />
              {o.id === id && <CheckIcon size={14} className="ml-auto text-brand-600 dark:text-brand-400" aria-hidden />}
            </button>
          ))}
          {id && (
            <button
              type="button"
              role="menuitem"
              className={classNames(POPOVER_ROW, 'mt-1 border-t border-ink-600 text-xs text-ink-300 hover:bg-ink-700 hover:text-ink-100')}
              onClick={() => {
                onCommit(null)
                setAnchor(null)
              }}
            >
              Clear value
            </button>
          )}
        </Popover>
      </>
    )
  }

  // ─── multi_select ──────────────────────────────────────────────────────────
  if (column.type === 'multi_select') {
    const ids = asOptionIds(value)
    const labels = ids.map((id) => column.options.find((o) => o.id === id)?.label ?? id)
    // One line per row, whatever the count: the first few chips, then "+N"
    // (the full list is in the label, the tooltip and the picker).
    const shown = ids.slice(0, MULTI_SHOWN)
    const hidden = ids.length - shown.length
    return (
      <>
        <button
          type="button"
          className={classNames(DISPLAY_CLASS, 'overflow-hidden', canEdit && EDITABLE)}
          disabled={!canEdit}
          title={labels.join(', ') || undefined}
          aria-label={`${column.name}: ${labels.join(', ') || 'empty'}`}
          aria-haspopup={canEdit ? 'dialog' : undefined}
          aria-expanded={canEdit ? anchor !== null : undefined}
          onClick={(e) => setAnchor(e.currentTarget)}
        >
          {shown.map((id) => {
            const option = column.options.find((o) => o.id === id)
            return (
              <span key={id} className="min-w-0 max-w-[9rem] flex shrink">
                <OptionChip option={option} fallbackLabel={id} />
              </span>
            )
          })}
          {hidden > 0 && (
            <span className="chip shrink-0 bg-ink-700 text-ink-200 border-ink-500 tabular-nums" aria-hidden>
              +{hidden}
            </span>
          )}
        </button>
        <Popover anchor={anchor} onClose={() => setAnchor(null)} label={column.name}>
          {column.options.length === 0 && (
            <p className="px-3 py-2 pointer-coarse:px-4 text-xs text-ink-300">
              No options yet — add some via the column menu.
            </p>
          )}
          {column.options.map((o) => (
            <label
              key={o.id}
              className={classNames(POPOVER_ROW, 'cursor-pointer hover:bg-ink-700 has-focus-visible:bg-ink-700')}
            >
              <Checkbox
                className="focus:outline-hidden"
                checked={ids.includes(o.id)}
                onChange={() => {
                  const next = ids.includes(o.id)
                    ? ids.filter((x) => x !== o.id)
                    : [...ids, o.id]
                  onCommit(next)
                }}
              />
              <OptionChip option={o} />
            </label>
          ))}
        </Popover>
      </>
    )
  }

  // ─── date ──────────────────────────────────────────────────────────────────
  if (column.type === 'date') {
    const dateStr = asDateString(value)
    if (editing) {
      return (
        <div
          ref={wrapRef}
          className="px-1.5 py-1"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              refocus.current = true
              setEditing(false)
            }
          }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setEditing(false)
          }}
        >
          <DateField
            value={dateStr ?? undefined}
            onChange={(v) => {
              onCommit(v ?? null)
              setEditing(false)
            }}
          />
        </div>
      )
    }
    const shown = dateStr ? fmtDate(dateStr) : ''
    return (
      <CellDisplay buttonRef={displayRef} column={column} canEdit={canEdit} onEdit={startEdit} text={shown} className="tabular-nums">
        {shown}
      </CellDisplay>
    )
  }

  // ─── url ───────────────────────────────────────────────────────────────────
  if (column.type === 'url') {
    const text = asText(value)
    if (editing) {
      return (
        <div className="px-1.5 py-1">
          <input
            className={classNames(INPUT_CLASS, invalid && 'border-rose-500! focus:ring-rose-500!')}
            value={draft}
            autoFocus
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-label={column.name}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
            placeholder="https://…"
            onChange={(e) => {
              setDraft(e.target.value)
              if (invalid) setError(null)
            }}
            onBlur={() => commitText()}
            onKeyDown={inputKeys}
          />
          {errorLine}
        </div>
      )
    }
    const href = /^https?:\/\//i.test(text) ? text : `https://${text}`
    // The edit target and the open-link button sit side by side — never one
    // control inside the other.
    return (
      <div className="flex items-center min-w-0">
        <CellDisplay buttonRef={displayRef} column={column} canEdit={canEdit} onEdit={startEdit} text={text} className="flex-1 min-w-0">
          {text && (
            <>
              <LinkSimpleIcon size={14} className="text-ink-400 shrink-0" aria-hidden />
              <span className="truncate text-brand-700 dark:text-brand-400" title={text}>{text}</span>
            </>
          )}
        </CellDisplay>
        {text && (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="pressable tap-target mr-1.5 shrink-0 p-1 pointer-coarse:p-2 rounded-sm text-ink-300 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-ink-600"
            title="Open link"
            aria-label="Open link"
          >
            <ArrowSquareOutIcon size={14} aria-hidden />
          </a>
        )}
      </div>
    )
  }

  // ─── text / number ─────────────────────────────────────────────────────────
  if (editing) {
    return (
      <div className="px-1.5 py-1">
        <input
          className={classNames(
            INPUT_CLASS,
            column.type === 'number' && 'text-right tabular-nums',
            invalid && 'border-rose-500! focus:ring-rose-500!',
          )}
          value={draft}
          autoFocus
          aria-label={column.name}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          inputMode={column.type === 'number' ? 'decimal' : undefined}
          onChange={(e) => {
            setDraft(e.target.value)
            if (invalid) setError(null)
          }}
          onBlur={() => commitText()}
          onKeyDown={inputKeys}
        />
        {errorLine}
      </div>
    )
  }
  if (column.type === 'number') {
    const n = asNumber(value)
    const shown = n === null ? '' : n.toLocaleString('en-US')
    return (
      <CellDisplay buttonRef={displayRef} column={column} canEdit={canEdit} onEdit={startEdit} text={shown} className="justify-end tabular-nums">
        <span className="truncate" title={shown || undefined}>{shown}</span>
      </CellDisplay>
    )
  }
  const text = asText(value)
  return (
    <CellDisplay buttonRef={displayRef} column={column} canEdit={canEdit} onEdit={startEdit} text={text} className="min-w-0">
      <span className="truncate" title={text || undefined}>{text}</span>
    </CellDisplay>
  )
}

/** A cell's resting face: a button when it can be edited, plain text when not. */
function CellDisplay({
  buttonRef, column, canEdit, onEdit, text, className, children,
}: {
  buttonRef: React.RefObject<HTMLButtonElement | null>
  column: CrmColumn
  canEdit: boolean
  onEdit: () => void
  text: string
  className?: string
  children: React.ReactNode
}) {
  if (!canEdit) return <div className={classNames(DISPLAY_CLASS, className)}>{children}</div>
  return (
    <button
      ref={buttonRef}
      type="button"
      className={classNames(DISPLAY_CLASS, EDITABLE, className)}
      aria-label={`${column.name}: ${text || 'empty'}`}
      onClick={onEdit}
    >
      {children}
    </button>
  )
}
