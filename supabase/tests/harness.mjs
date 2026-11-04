// A throwaway Postgres (PGlite, in memory) with every file of
// supabase/migrations applied in ledger order on top of stand-ins for what a
// Supabase project brings (shims.sql). Usage and limits: README.md.
//
//   const db = await freshDatabase()
//   const ana = await addUser(db, { email: 'ana@example.test', role: 'admin' })
//   await asUser(db, ana, () => db.query('SELECT * FROM public.clients'))
//   await db.close()
//
// PGlite is one session, so "acting as" someone is session state that the
// helpers set and put back. Do not share one database between tests that run
// at the same time.

import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const MIGRATIONS_DIR = path.resolve(HERE, '..', 'migrations')
const SHIMS_FILE = path.join(HERE, 'shims.sql')

/** The session every database starts in: PGlite's superuser, the operator. */
const OPERATOR = 'postgres'

/** Migration file names in the order they are applied (name order, as the ledger says). */
export function migrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f)).sort()
}

// pg_net and pg_cron are not PGlite extensions; shims.sql provides their
// schemas, so the CREATE EXTENSION lines have nothing to do.
const withoutShimmedExtensions = (sql) =>
  sql.replace(/CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+(pg_net|pg_cron)(\s+WITH\s+SCHEMA\s+\w+)?\s*;/gi, '-- $1: see shims.sql')

/** Runs one migration file (by name) against `db`, as the operator. Also the way to test "runs twice". */
export async function applyMigration(db, name) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8')
  try {
    await db.exec(withoutShimmedExtensions(sql))
  } catch (err) {
    throw new Error(`${name}: ${err.message}`, { cause: err })
  }
}

// Building takes a few seconds, loading a snapshot takes a fraction of one:
// each distinct `upTo` is built once per process and handed out as copies.
const snapshots = new Map()

async function buildSnapshot(upTo) {
  const db = new PGlite()
  try {
    await db.exec(fs.readFileSync(SHIMS_FILE, 'utf8'))
    for (const name of migrationFiles()) {
      if (upTo !== undefined && Number(name.slice(0, 3)) > upTo) break
      await applyMigration(db, name)
    }
    return await db.dumpDataDir('none')
  } finally {
    await db.close()
  }
}

/**
 * A new database with the shims and the migrations applied. Every call
 * returns its own copy; close it when the test is done.
 * @param {{ upTo?: number }} [options] stop after the files numbered `upTo`
 *   (to test a migration against the state before it). Default: all of them.
 * @returns {Promise<PGlite>}
 */
export async function freshDatabase({ upTo } = {}) {
  const key = upTo ?? 'all'
  if (!snapshots.has(key)) snapshots.set(key, buildSnapshot(upTo))
  const db = new PGlite({ loadDataDir: await snapshots.get(key) })
  await db.waitReady
  return db
}

/** Rows of a query. */
export async function rows(db, sql, params) {
  return (await db.query(sql, params)).rows
}

/** First row of a query, or undefined. */
export async function one(db, sql, params) {
  return (await rows(db, sql, params))[0]
}

// ---------------------------------------------------------------- acting as

const CLEAR_REQUEST = `SELECT set_config('request.jwt.claims', '', false), set_config('request.headers', '', false)`

// PGlite ignores RESET SESSION AUTHORIZATION, so the way back is by name.
async function backToOperator(db) {
  await db.exec(`SET SESSION AUTHORIZATION ${OPERATOR}`)
  await db.exec(CLEAR_REQUEST)
}

/**
 * What PostgREST does for one API request: it is logged in as
 * `authenticator`, switches to the token's role and publishes the verified
 * claims and the request headers as settings.
 */
async function asApiRole(db, role, claims, headers, fn) {
  await db.query(`SELECT set_config('request.jwt.claims', $1, false), set_config('request.headers', $2, false)`, [
    JSON.stringify(claims),
    JSON.stringify(headers ?? {}),
  ])
  await db.exec(`SET SESSION AUTHORIZATION authenticator; SET ROLE ${role}`)
  try {
    return await fn(db)
  } finally {
    await backToOperator(db)
  }
}

/** A request with the public (anon) key and no session. */
export function asAnon(db, fn) {
  return asApiRole(db, 'anon', { role: 'anon' }, {}, fn)
}

/** The claims GoTrue signs into a user's access token, as far as SQL reads them. */
async function userClaims(db, user) {
  const u = typeof user === 'string' ? { id: user } : user
  const email = u.email ?? (await one(db, 'SELECT email FROM auth.users WHERE id = $1', [u.id]))?.email ?? null
  return { sub: u.id, role: 'authenticated', email, aal: u.aal ?? 'aal1', ...u.claims }
}

/**
 * A request from a signed-in user.
 * @param {string | { id: string, email?: string, aal?: 'aal1' | 'aal2', claims?: object }} user
 *   the user's id, or what addUser() returned. `aal: 'aal2'` is a session
 *   upgraded with TOTP (the Vault needs it). `claims` adds or overrides JWT claims.
 */
export async function asUser(db, user, fn) {
  return asApiRole(db, 'authenticated', await userClaims(db, user), {}, fn)
}

/**
 * One API request and nothing after it: the statements PostgREST sends
 * (BEGIN, SET LOCAL ROLE, the claims and headers as transaction-local
 * settings), then `fn`, then ROLLBACK whatever happened. A test can attempt
 * any write as anyone and the database is as it was, so a denial test cannot
 * leave rows behind for the next one. What `fn` returns is still returned,
 * and what it throws is still thrown.
 * @param {'anon' | 'service_role' | string | { id: string, email?: string, aal?: 'aal1' | 'aal2', claims?: object }} who
 *   the public key, the service key, or a signed-in user as for asUser()
 */
export async function tryAs(db, who, fn) {
  const apiKey = who === 'anon' || who === 'service_role'
  const role = apiKey ? who : 'authenticated'
  const claims = apiKey ? { role } : await userClaims(db, who)
  await db.exec('BEGIN')
  try {
    await db.query(`SELECT set_config('request.jwt.claims', $1, true), set_config('request.headers', '{}', true)`, [
      JSON.stringify(claims),
    ])
    await db.exec(`SET LOCAL SESSION AUTHORIZATION authenticator; SET LOCAL ROLE ${role}`)
    return await fn(db)
  } finally {
    await db.exec('ROLLBACK')
  }
}

/**
 * A request with the service-role key (an Edge Function). `actor` is the
 * verified admin the function is working for: it travels as the
 * `x-deskdev-actor` header that 032's audit triggers read.
 * @param {{ actor?: string, headers?: Record<string, string> }} [options]
 */
export function asServiceRole(db, fn, { actor, headers } = {}) {
  const all = { ...headers, ...(actor ? { 'x-deskdev-actor': actor } : {}) }
  return asApiRole(db, 'service_role', { role: 'service_role' }, all, fn)
}

/**
 * GoTrue (Supabase Auth): its own login, supabase_auth_admin, which owns
 * auth.users and has no rights in public. Sign-up, the admin API and the
 * dashboard's "Add user" all write auth.users through this session.
 */
export async function asGoTrue(db, fn) {
  await db.exec('SET SESSION AUTHORIZATION supabase_auth_admin')
  try {
    return await fn(db)
  } finally {
    await backToOperator(db)
  }
}

/**
 * The owner in the SQL editor, the CLI or psql. This is the state a database
 * is in between the other helpers; the wrapper exists so a test reads the
 * same way for every actor. Note: PGlite's `postgres` is a superuser, the
 * hosted one is not.
 */
export async function asOperator(db, fn) {
  await backToOperator(db)
  return fn(db)
}

// ---------------------------------------------------------------- fixtures

/**
 * Creates an account the way an operator can: a row in auth.users (001's
 * trigger adds the profile), then role and permissions on the profile.
 * @param {{ email: string, fullName?: string, role?: 'admin' | 'member', permissions?: Record<string, string>, id?: string }} user
 * @returns {Promise<{ id: string, email: string }>}
 */
export async function addUser(db, { email, fullName, role = 'member', permissions = {}, id }) {
  await backToOperator(db)
  const meta = JSON.stringify({ full_name: fullName ?? email.split('@')[0] })
  const created = await one(
    db,
    `INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at)
     VALUES (coalesce($1::uuid, gen_random_uuid()), $2, $3::jsonb, now()) RETURNING id`,
    [id ?? null, email, meta],
  )
  await db.query('UPDATE public.profiles SET role = $2, permissions = $3::jsonb WHERE id = $1', [
    created.id,
    role,
    JSON.stringify(permissions),
  ])
  return { id: created.id, email }
}
