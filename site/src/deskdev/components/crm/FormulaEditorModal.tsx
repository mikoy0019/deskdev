import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import Modal from '../Modal'
import { Field, FieldError } from '../tasks/formBits'
import { columnTypeMeta } from './columnMeta'
import { useStore } from '../../store/useStore'
import { useResetOnChange } from '../../lib/useResetOnChange'
import {
  evaluateFormulaColumn, formatFormulaValue, formulaProblem, FORMULA_FUNCTIONS, MAX_FORMULA_LENGTH,
} from '../../lib/crmFormula'
import { classNames } from '../../lib/format'
import type { CrmColumn } from '../../lib/types'

export type FormulaEditorState =
  /** A new formula column, at `sortOrder` when inserted beside another. */
  | { mode: 'new'; tableId: string; name: string; sortOrder?: number }
  /** Edit a formula column, or make another column one. */
  | { mode: 'edit'; column: CrmColumn }
  | null

/**
 * Writes a formula column (revision 4: "a CRM that fills a field itself").
 * The column chips and the function list insert at the cursor; the preview
 * works the draft out on the table's first rows as you type, and the save
 * refuses a formula that can't be read or names a column that isn't there.
 */
export default function FormulaEditorModal({ state, onClose }: { state: FormulaEditorState; onClose: () => void }) {
  const crmColumns = useStore((s) => s.crmColumns)
  const crmRows = useStore((s) => s.crmRows)
  const users = useStore((s) => s.users)
  const addCrmColumn = useStore((s) => s.addCrmColumn)
  const updateCrmColumn = useStore((s) => s.updateCrmColumn)

  const tableId = state?.mode === 'new' ? state.tableId : state?.column.tableId
  const self = state?.mode === 'edit' ? state.column : undefined
  const [name, setName] = useState('')
  const [formula, setFormula] = useState('')
  const [error, setError] = useState<string | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)

  useResetOnChange([state], () => {
    if (!state) return
    setName(state.mode === 'new' ? state.name : state.column.name)
    setFormula(state.mode === 'edit' ? state.column.formula ?? '' : '')
    setError(null)
  })

  const columns = useMemo(
    () => crmColumns.filter((c) => c.tableId === tableId).sort((a, b) => a.sortOrder - b.sortOrder),
    [crmColumns, tableId],
  )
  const others = columns.filter((c) => c.id !== self?.id)
  const rows = useMemo(
    () => crmRows.filter((r) => r.tableId === tableId).sort((a, b) => a.position - b.position).slice(0, 3),
    [crmRows, tableId],
  )

  // Ready-made formulas from this table's own columns.
  const examples = useMemo(() => {
    const out: { label: string; formula: string }[] = []
    const of = (t: CrmColumn['type']) => others.find((c) => c.type === t)
    const n = of('number')
    const d = of('date')
    const s = of('select')
    const texts = others.filter((c) => c.type === 'text')
    if (n) out.push({ label: `10% of ${n.name}`, formula: `{${n.name}} * 0.1` })
    if (d) out.push({ label: `Days since ${d.name}`, formula: `DAYS(TODAY(), {${d.name}})` })
    if (d) out.push({ label: `${d.name} + 30 days`, formula: `ADDDAYS({${d.name}}, 30)` })
    if (s && s.options[0]) out.push({ label: `Action from ${s.name}`, formula: `IF({${s.name}} = "${s.options[0].label}", "Next step", "Follow up")` })
    if (texts.length >= 2) out.push({ label: `${texts[0].name} + ${texts[1].name}`, formula: `CONCAT({${texts[0].name}}, " ", {${texts[1].name}})` })
    return out
  }, [others])

  const insert = (snippet: string, caretBack = 0) => {
    const el = area.current
    const start = el?.selectionStart ?? formula.length
    const end = el?.selectionEnd ?? formula.length
    const next = formula.slice(0, start) + snippet + formula.slice(end)
    setFormula(next)
    if (error) setError(null)
    requestAnimationFrame(() => {
      el?.focus()
      const at = start + snippet.length - caretBack
      el?.setSelectionRange(at, at)
    })
  }

  const draftColumn: CrmColumn | null = tableId
    ? { id: self?.id ?? 'draft-formula', tableId, name: name || 'Formula', type: 'formula', options: [], sortOrder: self?.sortOrder ?? 9999, formula }
    : null
  const problem = formula.trim() ? formulaProblem(formula, columns, self?.id, name) : null
  const preview = draftColumn && formula.trim() && !problem
    ? rows.map((row) =>
        evaluateFormulaColumn(draftColumn, {
          columns: [...others, draftColumn],
          row,
          userName: (id) => users.find((u) => u.id === id)?.fullName,
        }),
      )
    : []

  const save = () => {
    if (!state || !tableId) return
    const label = name.trim()
    if (state.mode === 'new' && !label) {
      setError('Give the column a name')
      return
    }
    if (!formula.trim()) {
      setError('Write the formula')
      area.current?.focus()
      return
    }
    const why = formulaProblem(formula, columns, self?.id, label || name)
    if (why) {
      setError(why)
      area.current?.focus()
      return
    }
    if (state.mode === 'new') {
      addCrmColumn({ tableId, name: label, type: 'formula', formula: formula.trim(), sortOrder: state.sortOrder })
      toast.success('Formula column added')
    } else {
      updateCrmColumn(state.column.id, { type: 'formula', formula: formula.trim() })
      toast.success(state.column.type === 'formula' ? 'Formula updated' : `“${state.column.name}” is now a formula`)
    }
    onClose()
  }

  const title = state?.mode === 'new' ? 'New formula column' : self?.type === 'formula' ? `Formula: ${self.name}` : `Make “${self?.name ?? ''}” a formula`

  return (
    <Modal
      open={state !== null}
      onClose={onClose}
      wide
      title={title}
      onSubmit={save}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary">{state?.mode === 'new' ? 'Add column' : 'Save formula'}</button>
        </>
      }
    >
      <div className="space-y-4">
        {state?.mode === 'new' && (
          <Field label="Column name">
            <input className="input w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Commission" />
          </Field>
        )}
        {self && self.type !== 'formula' && (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-ink-100">
            A formula column works its value out from the row; what was typed into “{self.name}” stops showing.
          </p>
        )}

        <div className="flex flex-col gap-2">
          <label htmlFor="crm-formula" className="text-xs font-medium text-ink-200">Formula</label>
          <textarea
            id="crm-formula"
            ref={area}
            dir="ltr"
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            maxLength={MAX_FORMULA_LENGTH}
            className={classNames('input min-h-[96px] w-full font-mono text-[13px] leading-relaxed', (error || problem) && 'border-rose-500!')}
            value={formula}
            onChange={(e) => {
              setFormula(e.target.value)
              if (error) setError(null)
            }}
            placeholder="{Deal value} * 0.1"
            aria-describedby="crm-formula-help"
            aria-invalid={error || problem ? true : undefined}
            autoFocus={state?.mode !== 'new'}
          />
          <div id="crm-formula-help" aria-live="polite">
            {error ? (
              <FieldError>{error}</FieldError>
            ) : problem ? (
              <FieldError className="font-normal">{problem}</FieldError>
            ) : preview.length > 0 ? (
              <p className="text-xs text-ink-300">
                First {preview.length === 1 ? 'row' : `${preview.length} rows`}:{' '}
                {preview.map((r, i) => (
                  <span key={i} className={classNames('font-medium', r.ok ? 'text-ink-100' : 'text-rose-700 dark:text-rose-400')}>
                    {i > 0 && <span className="text-ink-400"> · </span>}
                    {r.ok ? formatFormulaValue(r.value) || '(empty)' : r.code}
                  </span>
                ))}
              </p>
            ) : (
              <p className="text-xs text-ink-300">Columns go in braces. Text goes in quotes. Starts with = or not, either works.</p>
            )}
          </div>
        </div>

        {others.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-200">Columns</p>
            <div className="flex flex-wrap gap-1.5">
              {others.map((c) => {
                const Icon = columnTypeMeta(c.type).icon
                return (
                  <button key={c.id} type="button" className="chip pressable border-ink-600 bg-ink-700/60 text-ink-100 hover:border-brand-500" onClick={() => insert(`{${c.name}}`)}>
                    <Icon size={12} className="text-ink-400" aria-hidden />
                    <span className="max-w-40 truncate">{c.name}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {examples.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-200">Ready-made</p>
            <div className="flex flex-wrap gap-1.5">
              {examples.map((ex) => (
                <button
                  key={ex.formula}
                  type="button"
                  className="chip pressable border-ink-600 text-ink-200 hover:border-brand-500 hover:text-ink-50"
                  title={ex.formula}
                  onClick={() => {
                    setFormula(ex.formula)
                    setError(null)
                    area.current?.focus()
                  }}
                >
                  {ex.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <details className="rounded-md border border-ink-600">
          <summary className="pressable cursor-pointer px-3 py-2 text-xs font-medium text-ink-200">
            {FORMULA_FUNCTIONS.length} functions
          </summary>
          <ul className="grid max-h-56 gap-x-4 overflow-y-auto overscroll-contain border-t border-ink-600 p-2 sm:grid-cols-2">
            {FORMULA_FUNCTIONS.map((f) => (
              <li key={f.name}>
                <button
                  type="button"
                  className="pressable flex w-full items-baseline gap-2 rounded-sm px-1.5 py-1 text-left hover:bg-ink-700/60"
                  onClick={() => insert(`${f.name}()`, 1)}
                >
                  <code className="shrink-0 font-mono text-[12px] text-brand-700 dark:text-brand-400">{f.use}</code>
                  <span className="min-w-0 truncate text-[11px] text-ink-300">{f.does}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </Modal>
  )
}
