// 048's booking_record throttle, the rule 034's intake_site_lead follows
// since its security review: a refused (throttled) call writes nothing, and
// calls without an ip_hash share one bucket instead of having no limit.

import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { asServiceRole, freshDatabase, one } from './harness.mjs'

let db

/** booking_record as the google-calendar function calls it (service role). */
const book = (payload) =>
  asServiceRole(db, () => one(db, 'SELECT public.booking_record($1::jsonb) AS r', [JSON.stringify(payload)])).then((x) => x.r)
const ledger = () => one(db, `
  SELECT count(*)::int AS rows,
         count(*) FILTER (WHERE status = 'throttled')::int AS throttled
    FROM public.booking_attempts`)

before(async () => {
  db = await freshDatabase()
  await db.exec('UPDATE public.workspace_settings SET booking_enabled = true')
})
beforeEach(async () => { await db.exec('DELETE FROM public.booking_attempts') })
after(async () => { await db?.close() })

test('probing: 30 calls an hour per visitor, and calls without an ip_hash share one bucket', async () => {
  // Invalid on purpose: each gets past the probing guard and is recorded.
  for (let i = 0; i < 30; i++) assert.deepEqual(await book({ name: 'Probe' }), { ok: false, reason: 'invalid' })
  assert.deepEqual(await ledger(), { rows: 30, throttled: 0 })

  // The 31st without an ip_hash is refused, and the refusal is not written.
  assert.deepEqual(await book({ name: 'Probe' }), { ok: false, reason: 'throttled' })
  assert.deepEqual(await book({ name: 'Probe' }), { ok: false, reason: 'throttled' })
  assert.deepEqual(await ledger(), { rows: 30, throttled: 0 })

  // A visitor the site identified has its own bucket.
  assert.deepEqual(await book({ name: 'Probe', ip_hash: 'visitor-1' }), { ok: false, reason: 'invalid' })
  assert.deepEqual(await ledger(), { rows: 31, throttled: 0 })
})

test('a visitor\'s refusals do not keep its window full', async () => {
  await db.exec(`
    INSERT INTO public.booking_attempts (ip_hash, status, at)
    SELECT 'visitor-2', 'invalid', now() - interval '50 minutes' FROM generate_series(1, 30)`)
  assert.deepEqual(await book({ name: 'Probe', ip_hash: 'visitor-2' }), { ok: false, reason: 'throttled' })
  assert.deepEqual(await ledger(), { rows: 30, throttled: 0 })
  // Rows from before this rule that say 'throttled' do not count either.
  await db.exec(`UPDATE public.booking_attempts SET status = 'throttled' WHERE ip_hash = 'visitor-2'`)
  assert.deepEqual(await book({ name: 'Probe', ip_hash: 'visitor-2' }), { ok: false, reason: 'invalid' })
})

test('bookings a day: calls without an ip_hash share one visitor bucket of 10', async () => {
  const start = await one(db, `SELECT date_trunc('hour', now() + interval '2 days') AS t`)
  const s = new Date(start.t)
  const valid = (email) => ({
    start: s.toISOString(),
    end: new Date(s.getTime() + 30 * 60_000).toISOString(),
    name: 'Vera Visitor',
    email,
  })
  await db.exec(`
    INSERT INTO public.booking_attempts (ip_hash, email_norm, status)
    SELECT NULL, 'someone' || g || '@example.test', 'booked' FROM generate_series(1, 10) AS g`)
  assert.deepEqual(await book(valid('vera@example.test')), { ok: false, reason: 'throttled' })
  assert.deepEqual(await ledger(), { rows: 10, throttled: 0 })
})
