import { describe, expect, it } from 'vitest'
import { evaluateFormulaColumn, formatFormulaValue, formulaProblem, formulaRefs, parseFormula, type FormulaContext } from './crmFormula'
import type { CrmColumn } from './types'

const col = (id: string, name: string, type: CrmColumn['type'], extra: Partial<CrmColumn> = {}): CrmColumn =>
  ({ id, tableId: 't', name, type, options: [], sortOrder: 0, ...extra })

const columns: CrmColumn[] = [
  col('c-value', 'Deal value', 'number', { sortOrder: 0 }),
  col('c-stage', 'Stage', 'select', { sortOrder: 1, options: [{ id: 'o-won', label: 'Won' }, { id: 'o-open', label: 'Open' }] }),
  col('c-first', 'First name', 'text', { sortOrder: 2 }),
  col('c-last', 'Last name', 'text', { sortOrder: 3 }),
  col('c-owner', 'Owner', 'person', { sortOrder: 4 }),
  col('c-contact', 'Last contact', 'date', { sortOrder: 5 }),
  col('c-paid', 'Paid', 'checkbox', { sortOrder: 6 }),
  col('c-tags', 'Tags', 'multi_select', { sortOrder: 7, options: [{ id: 'a', label: 'Hot' }, { id: 'b', label: 'B2B' }] }),
]
const row = { values: { 'c-value': 2500, 'c-stage': 'o-won', 'c-first': 'Ana', 'c-last': 'Reyes', 'c-owner': 'u-1', 'c-contact': '2026-10-01', 'c-paid': true, 'c-tags': ['a', 'b'] } }
const ctx = (extra: Partial<FormulaContext> = {}): FormulaContext => ({
  columns, row, userName: (id) => (id === 'u-1' ? 'Maykie' : undefined), today: '2026-10-08', ...extra,
})
const run = (formula: string, extraCols: CrmColumn[] = []) => {
  const f = col('c-f', 'Result', 'formula', { formula, sortOrder: 99 })
  return evaluateFormulaColumn(f, ctx({ columns: [...columns, ...extraCols, f] }))
}
const value = (formula: string) => {
  const r = run(formula)
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`)
  return r.value
}

describe('crm formulas', () => {
  it('does arithmetic with precedence, powers and unary minus', () => {
    expect(value('{Deal value} * 0.1')).toBe(250)
    expect(value('1 + 2 * 3')).toBe(7)
    expect(value('(1 + 2) * 3')).toBe(9)
    expect(value('2 ^ 3 ^ 2')).toBe(512)
    expect(value('-{Deal value} + 500')).toBe(-2000)
    expect(value('=10 % 4')).toBe(2)
  })

  it('reads every column type the way a person would', () => {
    expect(value('{Stage}')).toBe('Won')
    expect(value('{owner}')).toBe('Maykie')
    expect(value('{Tags}')).toBe('Hot, B2B')
    expect(value('{Paid}')).toBe(true)
    expect(value('{Last contact}')).toBe('2026-10-01')
  })

  it('joins text, compares and branches', () => {
    expect(value('CONCAT({First name}, " ", {Last name})')).toBe('Ana Reyes')
    expect(value('{First name} & " " & UPPER({Last name})')).toBe('Ana REYES')
    expect(value('IF({Stage} = "won", "Invoice", "Follow up")')).toBe('Invoice')
    expect(value('IF(AND({Paid}, {Deal value} >= 2500), "Done", "Chase")')).toBe('Done')
    expect(value('{Deal value} <> 2500')).toBe(false)
    expect(value('NOT(ISBLANK({First name}))')).toBe(true)
  })

  it('works with dates', () => {
    expect(value('DAYS(TODAY(), {Last contact})')).toBe(7)
    expect(value('ADDDAYS({Last contact}, 30)')).toBe('2026-10-31')
    expect(value('YEAR({Last contact}) * 100 + MONTH({Last contact})')).toBe(202610)
  })

  it('aggregates and rounds', () => {
    expect(value('SUM(1, 2, {Deal value})')).toBe(2503)
    expect(value('AVERAGE(2, 4)')).toBe(3)
    expect(value('MAX(1, 9, 3)')).toBe(9)
    expect(value('ROUND(2 / 3, 2)')).toBe(0.67)
    expect(value('COUNT({First name}, "", {Paid})')).toBe(2)
  })

  it('names what went wrong', () => {
    expect(run('{Nope} + 1')).toMatchObject({ ok: false, code: '#REF' })
    expect(run('1 / 0')).toMatchObject({ ok: false, code: '#DIV/0' })
    expect(run('FOO(1)')).toMatchObject({ ok: false, code: '#NAME' })
    expect(run('{First name} * 2')).toMatchObject({ ok: false, code: '#VALUE' })
    expect(run('1 +')).toMatchObject({ ok: false, code: '#ERROR' })
    expect(run('Deal + 1')).toMatchObject({ ok: false, code: '#ERROR' })
  })

  it('catches formulas that read each other in a circle', () => {
    const a = col('c-a', 'A', 'formula', { formula: '{B} + 1', sortOrder: 50 })
    const b = col('c-b', 'B', 'formula', { formula: '{A} + 1', sortOrder: 51 })
    expect(evaluateFormulaColumn(a, ctx({ columns: [...columns, a, b] }))).toMatchObject({ ok: false, code: '#CYCLE' })
    const c = col('c-c', 'C', 'formula', { formula: '{Deal value} * 2', sortOrder: 52 })
    const d = col('c-d', 'D', 'formula', { formula: '{C} + 1', sortOrder: 53 })
    expect(evaluateFormulaColumn(d, ctx({ columns: [...columns, c, d] }))).toEqual({ ok: true, value: 5001 })
  })

  it('checks a formula before it is saved', () => {
    expect(formulaProblem('{Deal value} * 2', columns)).toBeNull()
    expect(formulaProblem('{Missing}', columns)).toMatch(/no column called/)
    expect(formulaProblem('{Result} + 1', columns, undefined, 'Result')).toMatch(/its own column/)
    expect(formulaProblem('IF(', columns)).toBeTruthy()
    expect(formulaRefs('{A} + {b} + {A}')).toEqual(['A', 'b'])
    expect(() => parseFormula('')).toThrow()
  })

  it('formats results for a cell', () => {
    expect(formatFormulaValue(1234.5)).toBe('1,234.5')
    expect(formatFormulaValue(0.1 + 0.2)).toBe('0.3')
    expect(formatFormulaValue(true)).toBe('Yes')
    expect(formatFormulaValue(null)).toBe('')
  })
})
