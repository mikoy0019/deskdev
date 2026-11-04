import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { freshDatabase, addUser, asUser, one, applyMigration } from './harness.mjs'

let db, editor, inactive, id
before(async () => {
  db = await freshDatabase()
  editor = await addUser(db, { email: 'live-editor@example.test' })
  inactive = await addUser(db, { email: 'inactive-editor@example.test' })
  await db.query('UPDATE public.profiles SET deactivated_at=now() WHERE id=$1', [inactive.id])
  id = (await asUser(db, editor, () => one(db, "INSERT INTO public.whiteboards(title,created_by) VALUES('Shared drawing',$1) RETURNING id", [editor.id]))).id
})
after(async () => { await db?.close() })

test('062: publishes whiteboards once when Realtime exists', async () => {
  await db.exec('ALTER PUBLICATION supabase_realtime DROP TABLE public.whiteboards')
  await applyMigration(db, '062_whiteboard_realtime.sql')
  await applyMigration(db, '062_whiteboard_realtime.sql')
  assert.equal((await one(db, "SELECT count(*)::integer AS count FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='whiteboards'")).count, 1)
})
test('062: concurrent scene saves still require the current version', async () => {
  const first = await asUser(db, editor, () => db.query('UPDATE public.whiteboards SET scene=$1::jsonb WHERE id=$2 AND version=1 RETURNING version', [JSON.stringify({ elements: [{ id: 'a', version: 1, versionNonce: 1 }] }), id]))
  assert.equal(first.rows[0].version, 2)
  const stale = await asUser(db, editor, () => db.query('UPDATE public.whiteboards SET scene=$1::jsonb WHERE id=$2 AND version=1 RETURNING version', [JSON.stringify({ elements: [] }), id]))
  assert.equal(stale.rows.length, 0)
})
test('062: keeps inactive accounts outside the board read/write boundary', async () => {
  assert.equal((await asUser(db, inactive, () => db.query('SELECT id FROM public.whiteboards WHERE id=$1', [id]))).rows.length, 0)
  assert.equal((await asUser(db, inactive, () => db.query("UPDATE public.whiteboards SET scene='{\"elements\":[]}' WHERE id=$1 RETURNING id", [id]))).rows.length, 0)
})
