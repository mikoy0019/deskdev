// The whole ledger on an empty database: every file applies on top of the
// ones before it, and what check-migrations.mjs reads from the SQL text is
// true of the database that results.

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { applyMigration, freshDatabase, migrationFiles, rows } from './harness.mjs'

let db
before(async () => { db = await freshDatabase() })
after(async () => { await db?.close() })

test('every migration applies in ledger order', async () => {
  // freshDatabase() throws with the file name when one fails; reaching this
  // line is the test. The two 008 files apply in name order.
  const files = migrationFiles()
  assert.ok(files.length >= 43, `expected the full ledger, found ${files.length} files`)
  assert.equal(files[0], '001_profiles_roles.sql')
  assert.ok(files.indexOf('008_n8n_webhooks.sql') < files.indexOf('008_vault.sql'))
  const profiles = await rows(db, `SELECT to_regclass('public.profiles') AS t`)
  assert.equal(profiles[0].t, 'profiles')
})

test('every table in public has row level security on', async () => {
  const open = await rows(db, `
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
     ORDER BY 1`)
  assert.deepEqual(open.map((r) => r.relname), [])
})

test('the newest migration runs twice', async () => {
  // "Idempotent SQL" (AGENTS.md, database rule 1) for the file most likely to
  // be applied by hand next.
  const newest = migrationFiles().at(-1)
  await applyMigration(db, newest)
  await applyMigration(db, newest)
})
