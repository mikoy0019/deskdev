// admin-users' create path against 042's guard: the real helper from the
// Edge Function (Node strips the types), a database with the migrations
// applied, and two stand-ins:
//
//   serviceClient()  the two PostgREST calls the helper makes, run as the
//                    service role (so the table's grants are part of the test)
//   goTrueCreate()   what auth.admin.createUser ends in: GoTrue's session
//                    inserting into auth.users, answering { data, error }
//                    like supabase-js instead of throwing
//
// Not covered: the Deno runtime, supabase-js itself and GoTrue's HTTP layer.

import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { withSignupAllowed } from '../functions/admin-users/signup_allowlist.ts'
import { addUser, asGoTrue, asServiceRole, freshDatabase, one, rows } from './harness.mjs'

function serviceClient(db) {
  const answer = async (run) => {
    try {
      return { data: await asServiceRole(db, run), error: null }
    } catch (err) {
      return { data: null, error: { message: err.message, code: err.code } }
    }
  }
  return {
    from(table) {
      return {
        insert: (values) => ({
          select: (columns) => ({
            single: () => answer(() => one(db,
              `INSERT INTO public.${table} (email, invited_by) VALUES ($1, $2) RETURNING ${columns}`,
              [values.email, values.invited_by])),
          }),
        }),
        delete: () => ({
          eq: (column, value) => answer(async () => {
            await db.query(`DELETE FROM public.${table} WHERE ${column} = $1`, [value])
            return null
          }),
        }),
      }
    },
  }
}

const goTrueCreate = (db, email) => async () => {
  try {
    const user = await asGoTrue(db, () => one(db,
      `INSERT INTO auth.users (email, email_confirmed_at) VALUES (lower($1), now()) RETURNING id`, [email]))
    return { data: { user }, error: null }
  } catch (err) {
    return { data: { user: null }, error: { message: 'Database error creating new user', status: 500, cause: err.message } }
  }
}

const allowlist = (db) => rows(db, 'SELECT email, invited_by FROM public.signup_allowlist')
const NOT_A_PROFILE = '00000000-0000-4000-8000-000000000000'

let db
let admin
before(async () => {
  db = await freshDatabase()
  admin = await addUser(db, { email: 'admin@example.test', role: 'admin' })
})
after(async () => { await db?.close() })
beforeEach(async () => { await db.exec('DELETE FROM public.signup_allowlist') })

test('an admin-created account passes the guard and leaves nothing on the allow-list', async () => {
  const { data, error } = await withSignupAllowed(
    serviceClient(db), 'New.Hire@Example.test', admin.id, goTrueCreate(db, 'New.Hire@Example.test'))
  assert.equal(error, null)
  const profile = await one(db, 'SELECT email, role FROM public.profiles WHERE id = $1', [data.user.id])
  assert.deepEqual(profile, { email: 'new.hire@example.test', role: 'member' })
  assert.deepEqual(await allowlist(db), [])
})

test('the entry names the admin and exists only while GoTrue is being called', async () => {
  let during
  await withSignupAllowed(serviceClient(db), 'seen@example.test', admin.id, async () => {
    during = await allowlist(db)
    return { data: { user: null }, error: { message: 'Password should be at least 6 characters', status: 422 } }
  })
  assert.deepEqual(during, [{ email: 'seen@example.test', invited_by: admin.id }])
  // GoTrue refused before touching the database: the address must not stay
  // open for a stranger to sign up with.
  assert.deepEqual(await allowlist(db), [])
})

test('"already registered" (the insert fails after the guard) leaves nothing behind', async () => {
  const { error } = await withSignupAllowed(
    serviceClient(db), 'admin@example.test', admin.id, goTrueCreate(db, 'admin@example.test'))
  assert.match(error.cause, /duplicate key/)
  assert.deepEqual(await allowlist(db), [])
})

test('a create that throws is rethrown, after the cleanup', async () => {
  await assert.rejects(
    withSignupAllowed(serviceClient(db), 'boom@example.test', admin.id, async () => { throw new Error('network down') }),
    /network down/)
  assert.deepEqual(await allowlist(db), [])
})

test('without the helper the same call is refused: an older admin-users cannot create users once 042 is applied', async () => {
  const { error } = await goTrueCreate(db, 'old.function@example.test')()
  assert.match(error.cause, /signup_guard: sign-ups are closed/)
  assert.equal((await one(db, `SELECT count(*)::int AS n FROM auth.users WHERE email = 'old.function@example.test'`)).n, 0)
})

test('when the allow-list write fails, the guard still decides: nothing is created', async (t) => {
  const logged = t.mock.method(console, 'error', () => {})
  // invited_by is not a profile, so the insert is rejected by the foreign key.
  const { error } = await withSignupAllowed(
    serviceClient(db), 'unlisted@example.test', NOT_A_PROFILE, goTrueCreate(db, 'unlisted@example.test'))
  assert.match(error.cause, /signup_guard/)
  assert.match(String(logged.mock.calls[0].arguments[0]), /allow-list write failed/)
  assert.equal((await one(db, `SELECT count(*)::int AS n FROM auth.users WHERE email = 'unlisted@example.test'`)).n, 0)
})

test('a failing cleanup does not replace the result', async (t) => {
  const logged = t.mock.method(console, 'error', () => {})
  const client = serviceClient(db)
  const broken = {
    from: (table) => ({ ...client.from(table), delete: () => ({ eq: async () => { throw new Error('fetch failed') } }) }),
  }
  const result = await withSignupAllowed(broken, 'kept@example.test', admin.id, async () => ({ data: 'made', error: null }))
  assert.deepEqual(result, { data: 'made', error: null })
  assert.equal(logged.mock.callCount(), 1)
})

test('deployed before 042: there is no table yet and creating works as before', async (t) => {
  const logged = t.mock.method(console, 'error', () => {})
  const before042 = await freshDatabase({ upTo: 41 })
  try {
    const { data, error } = await withSignupAllowed(
      serviceClient(before042), 'early@example.test', NOT_A_PROFILE, goTrueCreate(before042, 'early@example.test'))
    assert.equal(error, null)
    assert.equal((await one(before042, 'SELECT role FROM public.profiles WHERE id = $1', [data.user.id])).role, 'member')
    assert.match(String(logged.mock.calls[0].arguments[1].message), /signup_allowlist/)
  } finally {
    await before042.close()
  }
})
