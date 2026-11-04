#!/usr/bin/env node
// The migration ledger's guard. Dependency-free; runs in CI (repo-ci.yml) and
// locally:
//
//   node scripts/check-migrations.mjs            check supabase/migrations
//   node scripts/check-migrations.mjs --dir X    check another folder (tests)
//
// Why it exists: the remote project has no schema_migrations table. Every file
// is applied by hand, in filename order, with `supabase db query --linked -f`
// (never `supabase db push`, which would re-run 001 onwards). So the folder
// itself is the ledger, and these rules keep it honest:
//
//   name         every file is NNN_snake_case.sql
//   prefix       no two files share a number (the 008 pair predates the rule
//                and is applied in name order: 008_n8n_webhooks, then 008_vault)
//   gap          numbers run 001..N with no holes, so "applied up to N" means something
//   ledger       supabase/README.md names every file
//   rls          every table created in public has RLS enabled somewhere
//
// And, for files from NEW_RULES_FROM on (older files are applied and frozen),
// the build plan's rules 2 and 3:
//
//   revoke       every new function gets REVOKE ... FROM PUBLIC, anon. Supabase
//                grants EXECUTE to PUBLIC (and, through default privileges, to
//                anon) so without it anon can call the function through
//                /rest/v1/rpc. An explicit GRANT ... TO anon counts as a
//                deliberate anon entry point (intake_site_lead, calendar_feed);
//                the CLI lists every one so a reviewer sees the anon surface.
//                Exempt: trigger functions (Postgres refuses to call them outside
//                a trigger) and CREATE OR REPLACE of a function an older file
//                created (replacing keeps the existing ACL).
//   search-path  every SECURITY DEFINER function pins search_path
//   fk-on-delete every new foreign key to profiles says what happens on delete
//                (SET NULL by convention); a bare REFERENCES blocks deleting a user
//
// A deliberate exception is written next to the code, with its reason:
//   -- check-migrations: allow <rule> <name> <why>
// <name> is the table, the function (schema-qualified unless public) or, for
// fk-on-delete, the table holding the column.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations')
export const LEDGER_FILE = path.join(ROOT, 'supabase', 'README.md')
export const ALLOWED_DUPLICATE_PREFIXES = new Set(['008'])
export const NEW_RULES_FROM = 32

const NAME_RE = /^(\d{3})_[a-z0-9_]+\.sql$/
const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)`
const QNAME = String.raw`(?:${IDENT}\s*\.\s*)?${IDENT}`

/** Lower-cased, unquoted, schema-qualified unless public. */
export function normName(raw) {
  const parts = raw.split('.').map((p) => p.trim().replace(/^"|"$/g, '').toLowerCase())
  if (parts.length === 2 && parts[0] === 'public') return parts[1]
  return parts.join('.')
}

/**
 * Splits SQL into top-level statements, aware of comments, quoted strings,
 * quoted identifiers and dollar-quoted bodies. Each statement carries `outer`
 * (comments dropped, every dollar-quoted body replaced by `$$`), `bodies` (the
 * dollar-quoted texts, for dynamic SQL) and the 1-based `line` it starts on.
 * Comments are returned separately, for the allow directives.
 */
export function splitSql(sql) {
  const statements = []
  const comments = []
  let outer = ''
  let bodies = []
  let line = 1
  let startLine = 1
  let i = 0
  const n = sql.length
  const flush = () => {
    if (outer.trim()) statements.push({ outer: outer.trim(), bodies, line: startLine })
    outer = ''
    bodies = []
  }
  const count = (s) => { for (const c of s) if (c === '\n') line++ }
  while (i < n) {
    const c = sql[i]
    const two = sql.slice(i, i + 2)
    if (!outer.trim() && /\S/.test(c) && two !== '--' && two !== '/*') startLine = line
    if (two === '--') {
      const end = sql.indexOf('\n', i)
      const text = sql.slice(i + 2, end === -1 ? n : end)
      comments.push({ text, line })
      i = end === -1 ? n : end
      continue
    }
    if (two === '/*') {
      // Postgres block comments nest.
      let depth = 1
      let j = i + 2
      while (j < n && depth) {
        if (sql.startsWith('/*', j)) { depth++; j += 2 } else if (sql.startsWith('*/', j)) { depth--; j += 2 } else j++
      }
      const text = sql.slice(i + 2, j - 2)
      comments.push({ text, line })
      count(sql.slice(i, j))
      outer += ' '
      i = j
      continue
    }
    if (c === "'") {
      const escapes = /[eE]$/.test(sql.slice(Math.max(0, i - 1), i)) && !/[A-Za-z0-9_]/.test(sql[i - 2] ?? '')
      let j = i + 1
      while (j < n) {
        if (escapes && sql[j] === '\\') { j += 2; continue }
        if (sql[j] === "'") { if (sql[j + 1] === "'") { j += 2; continue } break }
        j++
      }
      const lit = sql.slice(i, j + 1)
      count(lit)
      outer += lit
      i = j + 1
      continue
    }
    if (c === '"') {
      const j = sql.indexOf('"', i + 1)
      const lit = sql.slice(i, j === -1 ? n : j + 1)
      count(lit)
      outer += lit
      i = j === -1 ? n : j + 1
      continue
    }
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))
      if (m && !/[A-Za-z0-9_]/.test(sql[i - 1] ?? '')) {
        const tag = m[0]
        const close = sql.indexOf(tag, i + tag.length)
        const end = close === -1 ? n : close
        const body = sql.slice(i + tag.length, end)
        bodies.push(body)
        count(sql.slice(i, Math.min(n, end + tag.length)))
        outer += ' $$ '
        i = close === -1 ? n : end + tag.length
        continue
      }
    }
    if (c === ';') {
      outer += ';'
      flush()
      i++
      continue
    }
    if (c === '\n') line++
    outer += c
    i++
  }
  flush()
  return { statements, comments }
}

/** `-- check-migrations: allow <rule> <name> <why>` → Set of "rule name". */
export function allowDirectives(comments) {
  const allowed = new Set()
  for (const { text } of comments) {
    const m = /check-migrations:\s*allow\s+([a-z-]+)\s+(\S+)(\s+\S.*)?/i.exec(text)
    if (m && m[3]) allowed.add(`${m[1].toLowerCase()} ${normName(m[2])}`)
  }
  return allowed
}

/** What one file creates, enables, revokes and references. Pure: text in, facts out. */
export function analyzeSql(sql) {
  const { statements, comments } = splitSql(sql)
  const tables = []
  const rlsEnabled = new Set()
  const functions = []
  const revokes = []
  const grants = []
  const profileFks = []
  const rlsRe = new RegExp(String.raw`alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(${QNAME})\s+enable\s+row\s+level\s+security`, 'gi')
  for (const st of statements) {
    const text = st.outer
    const lower = text.toLowerCase()
    let m
    if ((m = new RegExp(String.raw`^create\s+(?:(?:global\s+|local\s+)?(temp|temporary|unlogged)\s+)?table\s+(?:if\s+not\s+exists\s+)?(${QNAME})`, 'i').exec(text))) {
      const name = normName(m[2])
      const temp = /^temp/i.test(m[1] ?? '')
      if (!temp && !name.includes('.')) tables.push({ name, line: st.line })
    }
    for (const src of [text, ...st.bodies]) {
      for (const r of src.matchAll(rlsRe)) rlsEnabled.add(normName(r[1]))
    }
    if ((m = new RegExp(String.raw`^create\s+(?:or\s+replace\s+)?function\s+(${QNAME})\s*\(`, 'i').exec(text))) {
      const returnsTrigger = /\breturns\s+(?:event_)?trigger\b/i.test(text)
      functions.push({
        name: normName(m[1]),
        line: st.line,
        returnsTrigger,
        securityDefiner: /\bsecurity\s+definer\b/i.test(text),
        searchPath: /\bset\s+search_path\b/i.test(text),
      })
    }
    if ((m = /^(revoke|grant)\s+[\s\S]*?\bon\s+functions?\s+([\s\S]+?)\s+(?:from|to)\s+([\s\S]+?)(?:\s+(?:cascade|restrict|with\s+grant\s+option))?\s*;?$/i.exec(text))) {
      const targets = []
      // Each target is name or name(args); args may hold commas, so walk parens.
      let depth = 0
      let cur = ''
      for (const ch of m[2]) {
        if (ch === '(') depth++
        if (ch === ')') depth--
        if (ch === ',' && depth === 0) { targets.push(cur); cur = '' } else cur += ch
      }
      targets.push(cur)
      const grantees = m[3].split(',').map((g) => g.trim().toLowerCase().replace(/^"|"$/g, ''))
      const into = m[1].toLowerCase() === 'revoke' ? revokes : grants
      for (const t of targets) {
        const nm = new RegExp(String.raw`^\s*(${QNAME})`).exec(t)
        if (nm) into.push({ name: normName(nm[1]), grantees })
      }
    }
    if (/^(create|alter)\s+table\b/i.test(text) && /\breferences\b/i.test(lower)) {
      const owner = new RegExp(String.raw`^(?:create|alter)\s+table\s+(?:if\s+(?:not\s+)?exists\s+)?(?:only\s+)?(${QNAME})`, 'i').exec(text)
      const fkRe = new RegExp(String.raw`\breferences\s+(${QNAME})\s*(?:\([^)]*\))?([^,;]*)`, 'gi')
      for (const fk of text.matchAll(fkRe)) {
        if (normName(fk[1]) !== 'profiles') continue
        const before = text.slice(0, fk.index)
        const lineInStmt = (before.match(/\n/g) ?? []).length
        profileFks.push({
          table: owner ? normName(owner[1]) : '?',
          line: st.line + lineInStmt,
          onDelete: /\bon\s+delete\b/i.test(fk[2]),
        })
      }
    }
  }
  return { tables, rlsEnabled, functions, revokes, grants, profileFks, allowed: allowDirectives(comments) }
}

/**
 * Runs every rule over a set of files.
 * @param {{ name: string, sql: string }[]} files  migration files, any order
 * @param {{ ledger?: string | null, newRulesFrom?: number, allowedDuplicates?: Set<string> }} opts
 * @returns {{ errors: { file: string, line?: number, rule: string, message: string }[], files: string[] }}
 */
export function checkMigrations(files, { ledger = null, newRulesFrom = NEW_RULES_FROM, allowedDuplicates = ALLOWED_DUPLICATE_PREFIXES } = {}) {
  const errors = []
  const err = (file, rule, message, line) => errors.push({ file, line, rule, message })
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name))

  const byPrefix = new Map()
  for (const f of sorted) {
    const m = NAME_RE.exec(f.name)
    if (!m) { err(f.name, 'name', 'file names are NNN_snake_case.sql'); continue }
    const list = byPrefix.get(m[1]) ?? []
    list.push(f.name)
    byPrefix.set(m[1], list)
  }
  for (const [prefix, names] of byPrefix) {
    if (names.length > 1 && !allowedDuplicates.has(prefix)) {
      err(names[1], 'prefix', `shares the number ${prefix} with ${names.filter((x) => x !== names[1]).join(', ')}; take the next free number`)
    }
  }
  const nums = [...byPrefix.keys()].map(Number).sort((a, b) => a - b)
  if (nums.length) {
    for (let k = 1; k <= nums[nums.length - 1]; k++) {
      if (!byPrefix.has(String(k).padStart(3, '0'))) err(String(k).padStart(3, '0'), 'gap', `no migration numbered ${String(k).padStart(3, '0')}; numbers run without holes`)
    }
  }
  if (ledger !== null) {
    for (const f of sorted) {
      const stem = f.name.replace(/\.sql$/, '')
      if (!ledger.includes(stem)) err(f.name, 'ledger', `supabase/README.md does not list ${stem}; add it to the ledger`)
    }
  }

  const analyzed = sorted.map((f) => ({ file: f.name, num: Number(NAME_RE.exec(f.name)?.[1] ?? NaN), ...analyzeSql(f.sql) }))
  const allowed = new Set(analyzed.flatMap((a) => [...a.allowed]))
  const rls = new Set(analyzed.flatMap((a) => [...a.rlsEnabled]))
  const collect = (key) => {
    const map = new Map()
    for (const a of analyzed) {
      for (const r of a[key]) {
        const set = map.get(r.name) ?? new Set()
        for (const g of r.grantees) set.add(g)
        map.set(r.name, set)
      }
    }
    return map
  }
  const revoked = collect('revokes')
  const granted = collect('grants')
  // Functions an applied (frozen) file already created: a later CREATE OR
  // REPLACE keeps their ACL, so the revoke rule does not apply to it.
  const preexisting = new Set(analyzed.filter((a) => !(a.num >= newRulesFrom)).flatMap((a) => a.functions.map((f) => f.name)))
  const anonSurface = []

  for (const a of analyzed) {
    for (const t of a.tables) {
      if (!rls.has(t.name) && !allowed.has(`rls ${t.name}`)) {
        err(a.file, 'rls', `table ${t.name} never gets ENABLE ROW LEVEL SECURITY`, t.line)
      }
    }
    if (!(a.num >= newRulesFrom)) continue
    for (const fn of a.functions) {
      const anonGranted = granted.get(fn.name)?.has('anon') ?? false
      if (anonGranted && !anonSurface.some((s) => s.name === fn.name)) anonSurface.push({ name: fn.name, file: a.file })
      if (!fn.returnsTrigger && !preexisting.has(fn.name) && !allowed.has(`revoke ${fn.name}`)) {
        const got = revoked.get(fn.name) ?? new Set()
        const missing = ['public', 'anon'].filter((g) => !got.has(g) && !(g === 'anon' && anonGranted))
        if (missing.length) err(a.file, 'revoke', `function ${fn.name} is never revoked from ${missing.join(' and ')} (REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, then GRANT what is meant)`, fn.line)
      }
      if (fn.securityDefiner && !fn.searchPath && !allowed.has(`search-path ${fn.name}`)) {
        err(a.file, 'search-path', `SECURITY DEFINER function ${fn.name} does not SET search_path`, fn.line)
      }
    }
    for (const fk of a.profileFks) {
      if (!fk.onDelete && !allowed.has(`fk-on-delete ${fk.table}`)) {
        err(a.file, 'fk-on-delete', `${fk.table}: a foreign key to profiles has no ON DELETE rule (use ON DELETE SET NULL)`, fk.line)
      }
    }
  }
  return { errors, files: sorted.map((f) => f.name), anonSurface }
}

function main(argv) {
  const dirArg = argv.indexOf('--dir')
  const dir = dirArg >= 0 ? path.resolve(argv[dirArg + 1]) : MIGRATIONS_DIR
  const ledgerArg = argv.indexOf('--ledger')
  const ledgerFile = ledgerArg >= 0 ? path.resolve(argv[ledgerArg + 1]) : dirArg >= 0 ? null : LEDGER_FILE
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).map((name) => ({ name, sql: fs.readFileSync(path.join(dir, name), 'utf8') }))
  const ledger = ledgerFile && fs.existsSync(ledgerFile) ? fs.readFileSync(ledgerFile, 'utf8') : ledgerFile ? '' : null
  const { errors, files: names, anonSurface } = checkMigrations(files, { ledger })
  if (anonSurface.length) {
    console.log(`anon can execute (from ${NEW_RULES_FROM} on, by explicit GRANT): ${anonSurface.map((s) => `${s.name} (${s.file.slice(0, 3)})`).join(', ')}`)
  }
  if (!errors.length) {
    console.log(`check-migrations: ${names.length} files, ${names[0]} .. ${names[names.length - 1]}: ok`)
    return 0
  }
  for (const e of errors) console.error(`${e.file}${e.line ? `:${e.line}` : ''}  [${e.rule}] ${e.message}`)
  console.error(`check-migrations: ${errors.length} problem${errors.length === 1 ? '' : 's'} in ${names.length} files`)
  return 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
