// 042: an account can only come into being through the admin path.
//
// "GoTrue" here is a session whose session_user is supabase_auth_admin (SET
// SESSION AUTHORIZATION), a non-superuser that owns auth.users and has no
// rights in public, inserting into auth.users. That is the statement every
// GoTrue flow ends in (sign-up, OAuth, magic link, invite, the admin API, the
// dashboard's "Add user"). What is not simulated: GoTrue itself, its HTTP
// answers, and the hosted `postgres` role, which is not a superuser there.

import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import {
  addUser, applyMigration, asAnon, asGoTrue, asOperator, asServiceRole, asUser, freshDatabase, one, rows,
} from './harness.mjs'

let db
let admin
before(async () => {
  db = await freshDatabase()
  admin = await addUser(db, { email: 'admin@example.test', role: 'admin' })
})
after(async () => { await db?.close() })
beforeEach(async () => {
  await db.exec('DELETE FROM public.signup_allowlist')
})

const REFUSED = { code: '42501', message: /signup_guard/ }

const allow = (email, extra = '') =>
  db.query(`INSERT INTO public.signup_allowlist (email${extra ? ', created_at, expires_at' : ''}) VALUES ($1${extra})`, [email])
const allowlist = () => rows(db, 'SELECT email, invited_by FROM public.signup_allowlist ORDER BY email')
const signUp = (email, meta = {}) =>
  asGoTrue(db, () => one(db,
    'INSERT INTO auth.users (email, raw_user_meta_data) VALUES ($1, $2::jsonb) RETURNING id',
    [email, JSON.stringify(meta)]))
const userCount = async (email) =>
  (await one(db, 'SELECT count(*)::int AS n FROM auth.users WHERE lower(email) = lower($1)', [email])).n

test('GoTrue: an address that is not on the allow-list is refused', async () => {
  await assert.rejects(signUp('stranger@example.test', { full_name: 'Totally Staff' }), REFUSED)
  assert.equal(await userCount('stranger@example.test'), 0)
  assert.equal((await one(db, `SELECT count(*)::int AS n FROM public.profiles WHERE email = 'stranger@example.test'`)).n, 0)
})

test('GoTrue: the refusal does not repeat the address (it lands in logs)', async () => {
  await assert.rejects(signUp('stranger@example.test'), (err) => {
    assert.doesNotMatch(err.message, /stranger/)
    return true
  })
})

test('GoTrue: an allow-listed address passes, the entry is used up, and the profile is a member', async () => {
  await allow('new.person@example.test')
  // 024: whatever the metadata claims, the profile starts as a member.
  const created = await signUp('new.person@example.test', { full_name: 'New Person', role: 'admin', permissions: { crm: 'edit' } })

  assert.deepEqual(await allowlist(), [])
  const profile = await one(db, 'SELECT email, full_name, role, permissions FROM public.profiles WHERE id = $1', [created.id])
  assert.deepEqual(profile, { email: 'new.person@example.test', full_name: 'New Person', role: 'member', permissions: {} })
})

test('GoTrue: an entry admits one account, and only for its own address', async () => {
  await allow('one@example.test')
  await assert.rejects(signUp('two@example.test'), REFUSED)
  assert.equal((await allowlist()).length, 1, 'a refused insert leaves other entries alone')

  await signUp('one@example.test')
  await assert.rejects(signUp('one+again@example.test'), REFUSED)
})

test('GoTrue: an expired entry is refused', async () => {
  await allow('late@example.test', `, now() - interval '11 minutes', now() - interval '1 minute'`)
  await assert.rejects(signUp('late@example.test'), REFUSED)
  assert.equal(await userCount('late@example.test'), 0)
})

test('GoTrue: letter case and outer spaces do not matter, in either direction', async () => {
  await allow('  Mixed.Case@Example.TEST ')
  await signUp('mixed.case@example.test')
  assert.deepEqual(await allowlist(), [])

  await allow('lower@example.test')
  await signUp('LOWER@Example.Test')
  assert.deepEqual(await allowlist(), [])
})

test('GoTrue: an account without an email is refused (phone-only, anonymous)', async () => {
  await allow('someone@example.test')
  await assert.rejects(
    asGoTrue(db, () => db.query(`INSERT INTO auth.users (phone) VALUES ('+15550100')`)), REFUSED)
  await assert.rejects(
    asGoTrue(db, () => db.query('INSERT INTO auth.users (is_anonymous) VALUES (true)')), REFUSED)
  await assert.rejects(
    asGoTrue(db, () => db.query(`INSERT INTO auth.users (email) VALUES ('   ')`)), REFUSED)
  assert.equal((await allowlist()).length, 1)
})

test('GoTrue: when the insert fails after the guard, the entry comes back with the rollback', async () => {
  // Why admin-users removes its entry itself: "already registered" must not
  // leave the address allow-listed.
  await allow('admin@example.test')
  await assert.rejects(signUp('admin@example.test'), { code: '23505' })
  assert.equal((await allowlist()).length, 1)
})

test('GoTrue: a successful insert sweeps expired leftovers', async () => {
  await allow('stale@example.test', `, now() - interval '30 minutes', now() - interval '20 minutes'`)
  await allow('fresh@example.test')
  await signUp('fresh@example.test')
  assert.deepEqual(await allowlist(), [])
})

test('operator: an insert passes without an entry, and the profile trigger still runs', async () => {
  await allow('bystander@example.test')
  const created = await asOperator(db, () => one(db,
    `INSERT INTO auth.users (email, raw_user_meta_data) VALUES ('first.admin@example.test', '{"full_name":"First Admin"}') RETURNING id`))
  const profile = await one(db, 'SELECT full_name, role FROM public.profiles WHERE id = $1', [created.id])
  assert.deepEqual(profile, { full_name: 'First Admin', role: 'member' })
  assert.equal((await allowlist()).length, 1, 'an operator insert does not consume entries')
})

test('the guard reads the session, so a SECURITY DEFINER function owned by postgres does not get past it', async () => {
  // Inside a definer function current_user is its owner (postgres). If the
  // guard looked at current_user, any such function would be a way in.
  await db.exec(`
    CREATE FUNCTION public.test_definer_signup(p_email text) RETURNS uuid
    LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS
      $$ INSERT INTO auth.users (email) VALUES (p_email) RETURNING id $$;
    GRANT EXECUTE ON FUNCTION public.test_definer_signup(text) TO anon, authenticated, service_role, supabase_auth_admin;
  `)
  try {
    const call = () => db.query(`SELECT public.test_definer_signup('definer@example.test')`)
    await assert.rejects(asAnon(db, call), REFUSED)
    await assert.rejects(asUser(db, admin, call), REFUSED)
    await assert.rejects(asServiceRole(db, call), REFUSED)
    await assert.rejects(asGoTrue(db, call), REFUSED)
    assert.equal(await userCount('definer@example.test'), 0)
  } finally {
    await db.exec('DROP FUNCTION public.test_definer_signup(text)')
  }
})

test('allow-list: nothing for anon or a signed-in user, even an admin', async () => {
  await allow('secret@example.test')
  const denied = { code: '42501', message: /permission denied/ }
  for (const actor of [(fn) => asAnon(db, fn), (fn) => asUser(db, admin, fn)]) {
    await assert.rejects(actor(() => db.query('SELECT * FROM public.signup_allowlist')), denied)
    await assert.rejects(actor(() => db.query(`INSERT INTO public.signup_allowlist (email) VALUES ('me@example.test')`)), denied)
    await assert.rejects(actor(() => db.query('DELETE FROM public.signup_allowlist')), denied)
  }
  assert.equal((await allowlist()).length, 1)
  const table = await one(db, `SELECT relrowsecurity, (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'signup_allowlist') AS policies
                                 FROM pg_class WHERE oid = 'public.signup_allowlist'::regclass`)
  assert.deepEqual(table, { relrowsecurity: true, policies: 0 })
})

test('allow-list: the service role adds and removes entries and cannot edit them', async () => {
  const entry = await asServiceRole(db, () => one(db,
    'INSERT INTO public.signup_allowlist (email, invited_by) VALUES ($1, $2) RETURNING id, extract(epoch FROM expires_at - created_at)::int AS ttl',
    ['hire@example.test', admin.id]))
  assert.equal(entry.ttl, 600, 'ten minutes by default')
  await assert.rejects(
    asServiceRole(db, () => db.query(`UPDATE public.signup_allowlist SET expires_at = now() + interval '50 minutes'`)),
    { code: '42501' })
  await asServiceRole(db, () => db.query('DELETE FROM public.signup_allowlist WHERE id = $1', [entry.id]))
  assert.deepEqual(await allowlist(), [])
})

test('allow-list: no standing invitations, and no blank address', async () => {
  await assert.rejects(
    db.query(`INSERT INTO public.signup_allowlist (email, expires_at) VALUES ('forever@example.test', 'infinity')`),
    { code: '23514' })
  await assert.rejects(
    db.query(`INSERT INTO public.signup_allowlist (email, expires_at) VALUES ('day@example.test', now() + interval '1 day')`),
    { code: '23514' })
  await assert.rejects(db.query(`INSERT INTO public.signup_allowlist (email) VALUES ('  ')`), { code: '23514' })
})

test('allow-list: deleting the admin who invited keeps the entry (ON DELETE SET NULL)', async () => {
  const leaver = await addUser(db, { email: 'leaver@example.test', role: 'admin' })
  await db.query('INSERT INTO public.signup_allowlist (email, invited_by) VALUES ($1, $2)', ['pending@example.test', leaver.id])
  await db.query('DELETE FROM auth.users WHERE id = $1', [leaver.id])
  assert.deepEqual(await allowlist(), [{ email: 'pending@example.test', invited_by: null }])
})

test('emergency off and back on, as a role that does not own auth.users', async () => {
  // On a hosted project postgres owns the function and the allow-list but not
  // auth.users (supabase_auth_admin does); it holds the TRIGGER privilege
  // there, which is how 001's trigger was created. PGlite's postgres is a
  // superuser and would prove nothing, so a plain role in that exact position
  // stands in for it.
  await db.exec(`
    CREATE ROLE hosted_postgres NOLOGIN;
    GRANT CREATE ON SCHEMA public TO hosted_postgres;
    GRANT USAGE ON SCHEMA auth TO hosted_postgres;
    GRANT TRIGGER ON auth.users TO hosted_postgres;
    ALTER FUNCTION public.signup_guard() OWNER TO hosted_postgres;
    ALTER TABLE public.signup_allowlist OWNER TO hosted_postgres;
  `)
  const asHostedPostgres = async (fn) => {
    await db.exec('SET SESSION AUTHORIZATION hosted_postgres')
    try { return await fn() } finally { await db.exec('SET SESSION AUTHORIZATION postgres') }
  }
  const triggers = async () =>
    (await rows(db, `SELECT tgname FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal ORDER BY 1`)).map((r) => r.tgname)

  // Why the off switch is not ALTER TABLE ... DISABLE TRIGGER (or DROP TRIGGER).
  await asHostedPostgres(async () => {
    await assert.rejects(db.query('ALTER TABLE auth.users DISABLE TRIGGER signup_guard'), /must be owner of table users/)
    await assert.rejects(db.query('DROP TRIGGER signup_guard ON auth.users'), /must be owner of relation users/)
    await db.exec('DROP FUNCTION public.signup_guard() CASCADE')
  })
  assert.deepEqual(await triggers(), ['on_auth_user_created'])

  // Off: this is the hole the guard closes; the profile trigger is untouched.
  const open = await signUp('while.off@example.test')
  assert.equal((await one(db, 'SELECT role FROM public.profiles WHERE id = $1', [open.id])).role, 'member')

  // On: apply the file again, still without owning auth.users.
  await asHostedPostgres(() => applyMigration(db, '042_signup_guard.sql'))
  assert.deepEqual(await triggers(), ['on_auth_user_created', 'signup_guard'])
  await assert.rejects(signUp('after.on@example.test'), REFUSED)
  await allow('after.on@example.test')
  await signUp('after.on@example.test')
  assert.deepEqual(await allowlist(), [])
})
