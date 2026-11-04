import type { CrmCellValue, CrmColumn, CrmRow } from './types'

/**
 * Formula columns for the CRM sheet (revision 4): a value worked out per row
 * from the row's other cells, so a field fills itself in.
 *
 *   {Deal value} * 0.1
 *   IF({Stage} = "Won", "Invoice", "Follow up")
 *   DAYS(TODAY(), {Last contact})
 *   CONCAT({First name}, " ", {Last name})
 *
 * Columns are referenced by name in braces. Nothing here touches the store or
 * the network: it is a small parser and a pure evaluator, and a formula is
 * stored as text and worked out again wherever it is shown.
 */

export type FormulaValue = number | string | boolean | null

export type FormulaErrorCode = '#ERROR' | '#REF' | '#NAME' | '#VALUE' | '#DIV/0' | '#CYCLE'

export class FormulaError extends Error {
  constructor(readonly code: FormulaErrorCode, message: string) {
    super(message)
  }
}

export type FormulaResult = { ok: true; value: FormulaValue } | { ok: false; code: FormulaErrorCode; message: string }

/** Longest formula a column keeps (057). */
export const MAX_FORMULA_LENGTH = 2000

// ─── Tokens ──────────────────────────────────────────────────────────────────

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'ref'; v: string }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }

const OPS = ['<=', '>=', '<>', '!=', '+', '-', '*', '/', '%', '^', '&', '=', '<', '>', '(', ')', ',']

function tokenize(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (c === '{') {
      const end = src.indexOf('}', i + 1)
      if (end < 0) throw new FormulaError('#ERROR', 'A column name is missing its closing }')
      const name = src.slice(i + 1, end).trim()
      if (!name) throw new FormulaError('#ERROR', 'Empty column reference {}')
      out.push({ t: 'ref', v: name })
      i = end + 1
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      let s = ''
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) {
          s += src[j + 1]
          j += 2
        } else {
          s += src[j++]
        }
      }
      if (j >= src.length) throw new FormulaError('#ERROR', 'A text value is missing its closing quote')
      out.push({ t: 'str', v: s })
      i = j + 1
      continue
    }
    const num = /^(\d+(\.\d+)?|\.\d+)/.exec(src.slice(i))
    if (num) {
      out.push({ t: 'num', v: Number(num[0]) })
      i += num[0].length
      continue
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))
    if (id) {
      out.push({ t: 'id', v: id[0].toUpperCase() })
      i += id[0].length
      continue
    }
    const op = OPS.find((o) => src.startsWith(o, i))
    if (op) {
      out.push({ t: 'op', v: op })
      i += op.length
      continue
    }
    throw new FormulaError('#ERROR', `Unexpected character “${c}”`)
  }
  return out
}

// ─── Parser ──────────────────────────────────────────────────────────────────

type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'ref'; name: string }
  | { k: 'call'; name: string; args: Node[] }
  | { k: 'bin'; op: string; l: Node; r: Node }
  | { k: 'neg'; x: Node }

const COMPARE = new Set(['=', '<>', '!=', '<', '<=', '>', '>='])

/** Parse a formula into a tree. Throws a FormulaError ('#ERROR') on bad syntax. */
export function parseFormula(src: string): Node {
  if (!src.trim()) throw new FormulaError('#ERROR', 'The formula is empty')
  const toks = tokenize(src.replace(/^\s*=/, ''))
  let p = 0
  const peek = () => toks[p]
  const isOp = (v: string) => peek()?.t === 'op' && (peek() as { v: string }).v === v
  const expect = (v: string) => {
    if (!isOp(v)) throw new FormulaError('#ERROR', `Expected “${v}”`)
    p++
  }

  const compare = (): Node => {
    let l = concat()
    while (peek()?.t === 'op' && COMPARE.has((peek() as { v: string }).v)) {
      const op = (toks[p++] as { v: string }).v
      l = { k: 'bin', op: op === '!=' ? '<>' : op, l, r: concat() }
    }
    return l
  }
  const concat = (): Node => {
    let l = additive()
    while (isOp('&')) {
      p++
      l = { k: 'bin', op: '&', l, r: additive() }
    }
    return l
  }
  const additive = (): Node => {
    let l = multiplicative()
    while (isOp('+') || isOp('-')) {
      const op = (toks[p++] as { v: string }).v
      l = { k: 'bin', op, l, r: multiplicative() }
    }
    return l
  }
  const multiplicative = (): Node => {
    let l = power()
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = (toks[p++] as { v: string }).v
      l = { k: 'bin', op, l, r: power() }
    }
    return l
  }
  const power = (): Node => {
    const base = unary()
    if (isOp('^')) {
      p++
      return { k: 'bin', op: '^', l: base, r: power() }
    }
    return base
  }
  const unary = (): Node => {
    if (isOp('-')) {
      p++
      return { k: 'neg', x: unary() }
    }
    if (isOp('+')) {
      p++
      return unary()
    }
    return primary()
  }
  const primary = (): Node => {
    const tok = peek()
    if (!tok) throw new FormulaError('#ERROR', 'The formula ends too soon')
    p++
    if (tok.t === 'num') return { k: 'num', v: tok.v }
    if (tok.t === 'str') return { k: 'str', v: tok.v }
    if (tok.t === 'ref') return { k: 'ref', name: tok.v }
    if (tok.t === 'id') {
      if (isOp('(')) {
        p++
        const args: Node[] = []
        if (!isOp(')')) {
          args.push(compare())
          while (isOp(',')) {
            p++
            args.push(compare())
          }
        }
        expect(')')
        return { k: 'call', name: tok.v, args }
      }
      if (tok.v === 'TRUE' || tok.v === 'FALSE') return { k: 'bool', v: tok.v === 'TRUE' }
      throw new FormulaError('#ERROR', `“${tok.v}” is not a column or a function. Put column names in braces: {${tok.v}}`)
    }
    if (tok.v === '(') {
      const inner = compare()
      expect(')')
      return inner
    }
    throw new FormulaError('#ERROR', `Unexpected “${tok.v}”`)
  }

  const tree = compare()
  if (p < toks.length) throw new FormulaError('#ERROR', `Unexpected “${(toks[p] as { v: unknown }).v}”`)
  return tree
}

/** Column names a formula reads (as written, without braces). */
export function formulaRefs(src: string): string[] {
  const out: string[] = []
  const walk = (n: Node) => {
    if (n.k === 'ref') out.push(n.name)
    else if (n.k === 'call') n.args.forEach(walk)
    else if (n.k === 'bin') {
      walk(n.l)
      walk(n.r)
    } else if (n.k === 'neg') walk(n.x)
  }
  walk(parseFormula(src))
  return [...new Set(out)]
}

// ─── Values ──────────────────────────────────────────────────────────────────

const DATE = /^\d{4}-\d{2}-\d{2}/

const blank = (v: FormulaValue) => v === null || v === ''

function num(v: FormulaValue, what = 'a number'): number {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v === null || v === '') return 0
  const n = Number(v.trim())
  if (Number.isFinite(n)) return n
  throw new FormulaError('#VALUE', `“${v}” is not ${what}`)
}

function text(v: FormulaValue): string {
  if (v === null) return ''
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'number') return String(Number(v.toPrecision(12)))
  return v
}

function truthy(v: FormulaValue): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (v === null) return false
  const t = v.trim().toLowerCase()
  return t !== '' && t !== 'false' && t !== '0'
}

/** Midnight UTC of a YYYY-MM-DD, in days since the epoch. */
function dayNumber(v: FormulaValue): number {
  const s = text(v)
  if (!DATE.test(s)) throw new FormulaError('#VALUE', `“${s}” is not a date (YYYY-MM-DD)`)
  const t = Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)))
  if (!Number.isFinite(t)) throw new FormulaError('#VALUE', `“${s}” is not a date`)
  return Math.round(t / 86_400_000)
}

function isoFromDay(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10)
}

function compareValues(a: FormulaValue, b: FormulaValue): number {
  const na = typeof a === 'number' || (typeof a === 'string' && a.trim() !== '' && Number.isFinite(Number(a)))
  const nb = typeof b === 'number' || (typeof b === 'string' && b.trim() !== '' && Number.isFinite(Number(b)))
  if (na && nb) return num(a) - num(b)
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  return text(a).toLowerCase().localeCompare(text(b).toLowerCase())
}

// ─── Functions ───────────────────────────────────────────────────────────────

/** The functions a formula can call, for the help panel. */
export const FORMULA_FUNCTIONS: { name: string; use: string; does: string }[] = [
  { name: 'IF', use: 'IF(test, then, else)', does: 'One value or another' },
  { name: 'AND', use: 'AND(a, b, …)', does: 'True when all are true' },
  { name: 'OR', use: 'OR(a, b, …)', does: 'True when any is true' },
  { name: 'NOT', use: 'NOT(a)', does: 'The opposite' },
  { name: 'ISBLANK', use: 'ISBLANK({Column})', does: 'True when the cell is empty' },
  { name: 'SUM', use: 'SUM(a, b, …)', does: 'Adds numbers' },
  { name: 'AVERAGE', use: 'AVERAGE(a, b, …)', does: 'The mean of the non-empty values' },
  { name: 'MIN', use: 'MIN(a, b, …)', does: 'The smallest' },
  { name: 'MAX', use: 'MAX(a, b, …)', does: 'The largest' },
  { name: 'COUNT', use: 'COUNT(a, b, …)', does: 'How many are not empty' },
  { name: 'ROUND', use: 'ROUND(x, digits)', does: 'Rounds to that many decimals' },
  { name: 'ABS', use: 'ABS(x)', does: 'Without the sign' },
  { name: 'FLOOR', use: 'FLOOR(x)', does: 'Rounds down' },
  { name: 'CEIL', use: 'CEIL(x)', does: 'Rounds up' },
  { name: 'CONCAT', use: 'CONCAT(a, b, …)', does: 'Joins text (also a & b)' },
  { name: 'UPPER', use: 'UPPER(text)', does: 'Capital letters' },
  { name: 'LOWER', use: 'LOWER(text)', does: 'Small letters' },
  { name: 'TRIM', use: 'TRIM(text)', does: 'Drops spaces at the ends' },
  { name: 'LEN', use: 'LEN(text)', does: 'How many characters' },
  { name: 'LEFT', use: 'LEFT(text, n)', does: 'The first n characters' },
  { name: 'RIGHT', use: 'RIGHT(text, n)', does: 'The last n characters' },
  { name: 'CONTAINS', use: 'CONTAINS(text, part)', does: 'True when the text has the part' },
  { name: 'TODAY', use: 'TODAY()', does: 'Today’s date' },
  { name: 'DAYS', use: 'DAYS(end, start)', does: 'Days from start to end' },
  { name: 'ADDDAYS', use: 'ADDDAYS(date, n)', does: 'The date n days later' },
  { name: 'YEAR', use: 'YEAR(date)', does: 'The year of a date' },
  { name: 'MONTH', use: 'MONTH(date)', does: 'The month of a date (1–12)' },
]

const ALIASES: Record<string, string> = { AVG: 'AVERAGE', CEILING: 'CEIL', ISEMPTY: 'ISBLANK' }

const arity = (name: string, args: unknown[], min: number, max = min) => {
  if (args.length < min || args.length > max) {
    const want = min === max ? `${min}` : max === Infinity ? `at least ${min}` : `${min} to ${max}`
    throw new FormulaError('#VALUE', `${name} takes ${want} value${want === '1' ? '' : 's'}`)
  }
}

// ─── Evaluation ──────────────────────────────────────────────────────────────

export interface FormulaContext {
  /** Every column of the row's table. */
  columns: CrmColumn[]
  row: Pick<CrmRow, 'values'>
  /** A person column's name for a user id. */
  userName: (id: string) => string | undefined
  /** YYYY-MM-DD; defaults to the local date. */
  today?: string
}

function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** A column's value as a formula sees it (option labels, people's names, dates as text). */
function cellValue(column: CrmColumn, raw: CrmCellValue | undefined, ctx: FormulaContext): FormulaValue {
  if (raw === undefined || raw === null) return column.type === 'checkbox' ? false : null
  switch (column.type) {
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(raw)
      return Number.isFinite(n) ? n : null
    }
    case 'checkbox':
      return raw === true || raw === 'true' || raw === 1
    case 'select': {
      const id = Array.isArray(raw) ? raw[0] : raw
      return column.options.find((o) => o.id === id)?.label ?? (typeof id === 'string' ? id : null)
    }
    case 'multi_select': {
      const ids = Array.isArray(raw) ? raw : [raw]
      return ids.map((id) => column.options.find((o) => o.id === id)?.label ?? String(id)).join(', ')
    }
    case 'person':
      return typeof raw === 'string' ? ctx.userName(raw) ?? '' : null
    case 'date':
      return typeof raw === 'string' && DATE.test(raw) ? raw.slice(0, 10) : null
    default:
      if (Array.isArray(raw)) return raw.join(', ')
      return typeof raw === 'boolean' ? raw : typeof raw === 'number' ? raw : String(raw)
  }
}

function findColumn(columns: CrmColumn[], name: string): CrmColumn | undefined {
  const key = name.trim().toLowerCase()
  return [...columns].sort((a, b) => a.sortOrder - b.sortOrder).find((c) => c.name.trim().toLowerCase() === key)
}

function evaluate(node: Node, ctx: FormulaContext, visiting: Set<string>, cache: Map<string, FormulaValue>): FormulaValue {
  const ev = (n: Node) => evaluate(n, ctx, visiting, cache)
  switch (node.k) {
    case 'num':
      return node.v
    case 'str':
      return node.v
    case 'bool':
      return node.v
    case 'neg':
      return -num(ev(node.x))
    case 'ref': {
      const col = findColumn(ctx.columns, node.name)
      if (!col) throw new FormulaError('#REF', `There is no column called “${node.name}”`)
      if (col.type !== 'formula') return cellValue(col, ctx.row.values[col.id], ctx)
      if (cache.has(col.id)) return cache.get(col.id)!
      if (visiting.has(col.id)) throw new FormulaError('#CYCLE', `“${col.name}” ends up reading itself`)
      visiting.add(col.id)
      try {
        const v = evaluate(parseFormula(col.formula ?? ''), ctx, visiting, cache)
        cache.set(col.id, v)
        return v
      } finally {
        visiting.delete(col.id)
      }
    }
    case 'bin': {
      if (node.op === '&') return text(ev(node.l)) + text(ev(node.r))
      const l = ev(node.l)
      const r = ev(node.r)
      switch (node.op) {
        case '+': return num(l) + num(r)
        case '-': return num(l) - num(r)
        case '*': return num(l) * num(r)
        case '/': {
          const d = num(r)
          if (d === 0) throw new FormulaError('#DIV/0', 'Division by zero')
          return num(l) / d
        }
        case '%': {
          const d = num(r)
          if (d === 0) throw new FormulaError('#DIV/0', 'Division by zero')
          return num(l) % d
        }
        case '^': return num(l) ** num(r)
        case '=': return blank(l) && blank(r) ? true : compareValues(l, r) === 0
        case '<>': return !(blank(l) && blank(r)) && compareValues(l, r) !== 0
        case '<': return compareValues(l, r) < 0
        case '<=': return compareValues(l, r) <= 0
        case '>': return compareValues(l, r) > 0
        case '>=': return compareValues(l, r) >= 0
      }
      throw new FormulaError('#ERROR', `Unknown operator ${node.op}`)
    }
    case 'call':
      return call(node, ctx, ev)
  }
}

function call(node: Extract<Node, { k: 'call' }>, ctx: FormulaContext, ev: (n: Node) => FormulaValue): FormulaValue {
  const name = ALIASES[node.name] ?? node.name
  const args = node.args
  const all = () => args.map(ev)
  const nums = () => all().filter((v) => !blank(v)).map((v) => num(v))
  switch (name) {
    case 'IF':
      arity(name, args, 2, 3)
      return truthy(ev(args[0])) ? ev(args[1]) : args[2] ? ev(args[2]) : null
    case 'AND':
      arity(name, args, 1, Infinity)
      return args.every((a) => truthy(ev(a)))
    case 'OR':
      arity(name, args, 1, Infinity)
      return args.some((a) => truthy(ev(a)))
    case 'NOT':
      arity(name, args, 1)
      return !truthy(ev(args[0]))
    case 'ISBLANK':
      arity(name, args, 1)
      return blank(ev(args[0]))
    case 'SUM':
      return nums().reduce((a, b) => a + b, 0)
    case 'AVERAGE': {
      const n = nums()
      if (n.length === 0) throw new FormulaError('#DIV/0', 'AVERAGE of nothing')
      return n.reduce((a, b) => a + b, 0) / n.length
    }
    case 'MIN': {
      const n = nums()
      return n.length ? Math.min(...n) : null
    }
    case 'MAX': {
      const n = nums()
      return n.length ? Math.max(...n) : null
    }
    case 'COUNT':
      return all().filter((v) => !blank(v)).length
    case 'ROUND': {
      arity(name, args, 1, 2)
      const digits = args[1] ? Math.trunc(num(ev(args[1]))) : 0
      const f = 10 ** digits
      return Math.round(num(ev(args[0])) * f) / f
    }
    case 'ABS':
      arity(name, args, 1)
      return Math.abs(num(ev(args[0])))
    case 'FLOOR':
      arity(name, args, 1)
      return Math.floor(num(ev(args[0])))
    case 'CEIL':
      arity(name, args, 1)
      return Math.ceil(num(ev(args[0])))
    case 'CONCAT':
      return all().map(text).join('')
    case 'UPPER':
      arity(name, args, 1)
      return text(ev(args[0])).toUpperCase()
    case 'LOWER':
      arity(name, args, 1)
      return text(ev(args[0])).toLowerCase()
    case 'TRIM':
      arity(name, args, 1)
      return text(ev(args[0])).trim()
    case 'LEN':
      arity(name, args, 1)
      return text(ev(args[0])).length
    case 'LEFT':
      arity(name, args, 2)
      return text(ev(args[0])).slice(0, Math.max(0, Math.trunc(num(ev(args[1])))))
    case 'RIGHT': {
      arity(name, args, 2)
      const n = Math.max(0, Math.trunc(num(ev(args[1]))))
      return n === 0 ? '' : text(ev(args[0])).slice(-n)
    }
    case 'CONTAINS':
      arity(name, args, 2)
      return text(ev(args[0])).toLowerCase().includes(text(ev(args[1])).toLowerCase())
    case 'TODAY':
      arity(name, args, 0)
      return ctx.today ?? localToday()
    case 'DAYS': {
      arity(name, args, 2)
      const end = ev(args[0])
      const start = ev(args[1])
      if (blank(end) || blank(start)) return null
      return dayNumber(end) - dayNumber(start)
    }
    case 'ADDDAYS': {
      arity(name, args, 2)
      const d = ev(args[0])
      if (blank(d)) return null
      return isoFromDay(dayNumber(d) + Math.trunc(num(ev(args[1]))))
    }
    case 'YEAR': {
      arity(name, args, 1)
      const d = ev(args[0])
      return blank(d) ? null : Number(isoFromDay(dayNumber(d)).slice(0, 4))
    }
    case 'MONTH': {
      arity(name, args, 1)
      const d = ev(args[0])
      return blank(d) ? null : Number(isoFromDay(dayNumber(d)).slice(5, 7))
    }
  }
  throw new FormulaError('#NAME', `There is no function called ${node.name}`)
}

/** Work out a formula column for one row. Never throws. */
export function evaluateFormulaColumn(column: CrmColumn, ctx: FormulaContext): FormulaResult {
  try {
    const value = evaluate(parseFormula(column.formula ?? ''), ctx, new Set([column.id]), new Map())
    if (typeof value === 'number' && !Number.isFinite(value)) return { ok: false, code: '#VALUE', message: 'The result is not a finite number' }
    return { ok: true, value }
  } catch (e) {
    if (e instanceof FormulaError) return { ok: false, code: e.code, message: e.message }
    return { ok: false, code: '#ERROR', message: 'The formula could not be worked out' }
  }
}

/**
 * Why a formula can't be saved on this table, or null. Checks the syntax, the
 * column names it reads, that it never reads itself, and its length.
 */
export function formulaProblem(src: string, columns: CrmColumn[], selfId?: string, selfName?: string): string | null {
  if (src.length > MAX_FORMULA_LENGTH) return `Keep the formula under ${MAX_FORMULA_LENGTH.toLocaleString('en-US')} characters`
  let refs: string[]
  try {
    refs = formulaRefs(src)
  } catch (e) {
    return e instanceof FormulaError ? e.message : 'The formula could not be read'
  }
  for (const name of refs) {
    const col = findColumn(columns.filter((c) => c.id !== selfId), name)
    const self = selfName && name.trim().toLowerCase() === selfName.trim().toLowerCase()
    if (self || (col && col.id === selfId)) return 'A formula can’t read its own column'
    if (!col) return `There is no column called “${name}”`
  }
  return null
}

/** How a result reads in a cell. */
export function formatFormulaValue(v: FormulaValue): string {
  if (v === null) return ''
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'number') {
    const n = Number(v.toPrecision(12))
    return n.toLocaleString('en-US', { maximumFractionDigits: 4 })
  }
  return v
}
