// node --test 'scripts/**/*.test.mjs'   (CI: .github/workflows/repo-ci.yml)
// Pure: every case feeds SQL text to checkMigrations; no folder is read.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyzeSql, checkMigrations, splitSql } from './check-migrations.mjs'

const rules = (files, opts) => checkMigrations(files, { newRulesFrom: 2, ...opts }).errors.map((e) => `${e.rule} ${e.file}`)
const f = (name, sql) => ({ name, sql })
const OK_TABLE = 'CREATE TABLE public.t (id int);\nALTER TABLE public.t ENABLE ROW LEVEL SECURITY;'

test('splitSql keeps ; inside strings, comments and dollar bodies, and tracks lines', () => {
  const sql = [
    "-- a; comment",
    "SELECT 'x;y', 'it''s';",
    '/* block; /* nested; */ still; */',
    'CREATE FUNCTION f() RETURNS int AS $body$ SELECT 1; $body$ LANGUAGE sql;',
    "DO $$ BEGIN PERFORM 1; END $$;",
  ].join('\n')
  const { statements, comments } = splitSql(sql)
  assert.equal(statements.length, 3)
  assert.match(statements[0].outer, /^SELECT 'x;y', 'it''s';$/)
  assert.equal(statements[0].line, 2)
  assert.equal(statements[1].line, 4)
  assert.deepEqual(statements[1].bodies, [' SELECT 1; '])
  assert.doesNotMatch(statements[1].outer, /SELECT 1/)
  assert.equal(comments.length, 2)
})

test('the numbering rules: names, duplicate prefixes (008 allowed), gaps', () => {
  assert.deepEqual(rules([f('001_a.sql', ''), f('002_b.sql', ''), f('002_c.sql', '')]), ['prefix 002_c.sql'])
  assert.deepEqual(rules([f('001_a.sql', ''), f('008_x.sql', ''), f('008_y.sql', ''), f('002_b.sql', '')]).filter((r) => !r.startsWith('gap')), [])
  assert.deepEqual(rules([f('001_a.sql', ''), f('003_c.sql', '')]), ['gap 002'])
  assert.deepEqual(rules([f('001_a.sql', ''), f('2_Bad.sql', '')]), ['name 2_Bad.sql'])
})

test('ledger: README must name every file', () => {
  const files = [f('001_a.sql', ''), f('002_b.sql', '')]
  assert.deepEqual(rules(files, { ledger: '| 001 | `001_a.sql` |' }), ['ledger 002_b.sql'])
  assert.deepEqual(rules(files, { ledger: '001_a 002_b' }), [])
  assert.deepEqual(rules(files), [])
})

test('rls: every public table, in any file; dynamic SQL and later files count', () => {
  assert.deepEqual(rules([f('001_a.sql', 'CREATE TABLE IF NOT EXISTS public.t (id int);')]), ['rls 001_a.sql'])
  assert.deepEqual(rules([f('001_a.sql', OK_TABLE)]), [])
  assert.deepEqual(rules([f('001_a.sql', 'CREATE TABLE t (id int);'), f('002_b.sql', 'ALTER TABLE IF EXISTS ONLY public."t" ENABLE ROW LEVEL SECURITY;')]), [])
  assert.deepEqual(rules([f('001_a.sql', "CREATE TABLE public.t (id int);\nDO $$ BEGIN EXECUTE 'ALTER TABLE public.t ENABLE ROW LEVEL SECURITY'; END $$;")]), [])
  // Other schemas and temp tables are not exposed through the API.
  assert.deepEqual(rules([f('001_a.sql', 'CREATE TABLE n8n.x (id int); CREATE TEMP TABLE y (id int);')]), [])
  assert.deepEqual(rules([f('001_a.sql', '-- check-migrations: allow rls t seeded scratch table, dropped below\nCREATE TABLE t (id int);')]), [])
  // A directive without a reason does not count.
  assert.deepEqual(rules([f('001_a.sql', '-- check-migrations: allow rls t\nCREATE TABLE t (id int);')]), ['rls 001_a.sql'])
})

const fn = (name, extra = '') => `CREATE OR REPLACE FUNCTION public.${name}(p_a text, p_b int)\nRETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN END; $$;\n${extra}`

test('revoke: new functions are revoked from PUBLIC and anon, in any later file', () => {
  assert.deepEqual(rules([f('001_a.sql', ''), f('002_b.sql', fn('g'))]), ['revoke 002_b.sql'])
  assert.deepEqual(rules([f('001_a.sql', ''), f('002_b.sql', fn('g', 'REVOKE ALL ON FUNCTION public.g(text, int) FROM PUBLIC;'))]), ['revoke 002_b.sql'])
  assert.deepEqual(rules([f('001_a.sql', ''), f('002_b.sql', fn('g', 'REVOKE ALL ON FUNCTION public.g(text, int), public.h() FROM PUBLIC, anon;'))]), [])
  assert.deepEqual(rules([f('001_a.sql', ''), f('002_b.sql', fn('g', 'REVOKE ALL ON FUNCTION g FROM PUBLIC;')), f('003_c.sql', 'REVOKE EXECUTE ON FUNCTION public.g(text,int) FROM anon;')]), [])
  const msg = checkMigrations([f('001_a.sql', ''), f('002_b.sql', fn('g', 'REVOKE ALL ON FUNCTION g FROM PUBLIC;'))], { newRulesFrom: 2 }).errors[0].message
  assert.match(msg, /never revoked from anon/)
})

test('revoke: an explicit GRANT to anon is a deliberate entry point, and is listed', () => {
  const sql = fn('intake', 'REVOKE ALL ON FUNCTION public.intake(text, int) FROM PUBLIC;\nGRANT EXECUTE ON FUNCTION public.intake(text, int) TO anon, authenticated;')
  const out = checkMigrations([f('001_a.sql', ''), f('002_b.sql', sql)], { newRulesFrom: 2 })
  assert.deepEqual(out.errors, [])
  assert.deepEqual(out.anonSurface, [{ name: 'intake', file: '002_b.sql' }])
})

test('revoke: exempt for trigger functions, frozen files and replacements of old functions', () => {
  const trig = 'CREATE FUNCTION public.tg() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN RETURN NEW; END $$;'
  assert.deepEqual(rules([f('001_a.sql', ''), f('002_b.sql', trig)]), [])
  assert.deepEqual(rules([f('001_a.sql', fn('old'))]), [])
  assert.deepEqual(rules([f('001_a.sql', fn('old')), f('002_b.sql', fn('old'))]), [])
  assert.deepEqual(rules([f('001_a.sql', ''), f('002_b.sql', `-- check-migrations: allow revoke g internal helper, schema not exposed\n${fn('g')}`)]), [])
})

test('search-path: SECURITY DEFINER must pin it; the clause may follow the body', () => {
  const bad = 'CREATE FUNCTION public.s() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;\nREVOKE ALL ON FUNCTION public.s() FROM PUBLIC, anon;'
  assert.deepEqual(rules([f('001_a.sql', ''), f('002_b.sql', bad)]), ['search-path 002_b.sql'])
  const after = "CREATE FUNCTION public.s() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql SECURITY DEFINER SET search_path = '';\nREVOKE ALL ON FUNCTION public.s() FROM PUBLIC, anon;"
  assert.deepEqual(rules([f('001_a.sql', ''), f('002_b.sql', after)]), [])
  const invoker = 'CREATE FUNCTION public.s() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;\nREVOKE ALL ON FUNCTION public.s() FROM PUBLIC, anon;'
  assert.deepEqual(rules([f('001_a.sql', ''), f('002_b.sql', invoker)]), [])
})

test('fk-on-delete: a new reference to profiles states its delete rule', () => {
  const t = (cols) => `CREATE TABLE public.x (\n  id int,\n  ${cols}\n);\nALTER TABLE public.x ENABLE ROW LEVEL SECURITY;`
  assert.deepEqual(rules([f('001_a.sql', ''), f('002_b.sql', t('owner uuid REFERENCES public.profiles(id),\n  n int'))]), ['fk-on-delete 002_b.sql'])
  assert.deepEqual(rules([f('001_a.sql', ''), f('002_b.sql', t('owner uuid REFERENCES public.profiles(id) ON DELETE SET NULL,\n  by uuid REFERENCES profiles ON DELETE SET NULL'))]), [])
  assert.deepEqual(rules([f('001_a.sql', ''), f('002_b.sql', 'ALTER TABLE public.x ADD COLUMN by uuid REFERENCES public.profiles (id);')]), ['fk-on-delete 002_b.sql'])
  // Frozen files are not re-judged; other tables are not this rule's business.
  assert.deepEqual(rules([f('001_a.sql', t('owner uuid REFERENCES public.profiles(id)'))]), [])
  assert.deepEqual(rules([f('001_a.sql', ''), f('002_b.sql', t('c uuid REFERENCES public.clients(id)'))]), [])
  const line = checkMigrations([f('001_a.sql', ''), f('002_b.sql', t('n int,\n  owner uuid REFERENCES public.profiles(id)'))], { newRulesFrom: 2 }).errors[0].line
  assert.equal(line, 4)
})

test('analyzeSql ignores CREATE TABLE inside comments and strings', () => {
  const a = analyzeSql("-- CREATE TABLE public.nope (id int);\nSELECT 'CREATE TABLE public.nope2 (id int)';")
  assert.deepEqual(a.tables, [])
})
