# Database tests

Every migration, applied in ledger order to a throwaway Postgres
([PGlite](https://pglite.dev), Postgres compiled to WebAssembly, in memory),
with tests on top. Nothing here touches a Supabase project: no URL, no key, no
network. This is the "throwaway database" of `AGENTS.md`, database rule 6.

```bash
cd supabase/tests
npm ci          # once; PGlite is the only dependency
npm test        # node --test, about 10 seconds
node --test signup-guard.test.mjs   # one file
```

CI runs it in `.github/workflows/repo-ci.yml` (job `database-tests`). PGlite
lives in this folder's own `package.json` because repo scripts stay
dependency-free.

## Files

| File | What |
|---|---|
| `harness.mjs` | the database factory and the "act as" helpers (below) |
| `shims.sql` | stand-ins for what Supabase provides: roles, `auth`, `vault`, `pg_net`, `pg_cron`, `storage`, the realtime publication |
| `migrations.test.mjs` | the whole ledger applies; RLS is on for every public table; the newest file runs twice |
| `signup-guard.test.mjs` | 042: accounts only through the admin path |
| `admin-users-allowlist.test.mjs` | the `admin-users` create helper (`functions/admin-users/signup_allowlist.ts`) against 042 |
| `rls.test.mjs` | row level security, tried: who reads which rows of every table, and who can change them (below) |
| `booking-throttle.test.mjs` | 048: `booking_record`'s throttle writes no refusal, and calls without an `ip_hash` share one bucket |

## Writing a test

```js
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { addUser, asAnon, asUser, freshDatabase, rows } from './harness.mjs'

let db, admin, member
before(async () => {
  db = await freshDatabase()
  admin = await addUser(db, { email: 'admin@example.test', role: 'admin' })
  member = await addUser(db, { email: 'member@example.test', permissions: { clients: 'view' } })
})
after(async () => { await db?.close() })

test('a member with clients:view reads clients, anon does not', async () => {
  await db.exec(`INSERT INTO public.clients (name) VALUES ('Acme')`)
  assert.equal((await asUser(db, member, () => rows(db, 'SELECT name FROM public.clients'))).length, 1)
  assert.deepEqual(await asAnon(db, () => rows(db, 'SELECT name FROM public.clients')), [])
})
```

| Helper | Acts as |
|---|---|
| `freshDatabase({ upTo? })` | a new database with the shims and every migration (or the files numbered up to `upTo`). Built once per process, then copied: about 4 s for the first, under 1 s for each one after. Close it with `db.close()` |
| `asAnon(db, fn)` | a request with the public key: role `anon`, no claims |
| `asUser(db, user, fn)` | a signed-in user: role `authenticated`, JWT claims `sub`, `email`, `aal` (`{ ...user, aal: 'aal2' }` for a TOTP session), so `auth.uid()`, `auth.email()` and `auth.jwt()` answer as in production |
| `asServiceRole(db, fn, { actor? })` | an Edge Function: role `service_role` (bypasses RLS); `actor` becomes the `x-deskdev-actor` header 032's audit reads |
| `asGoTrue(db, fn)` | Supabase Auth: session `supabase_auth_admin`, owner of `auth.users`, no rights in `public` |
| `asOperator(db, fn)` | the owner in the SQL editor: `postgres`. Also the state between the other helpers |
| `tryAs(db, who, fn)` | one API request and nothing after it: `BEGIN`, `SET LOCAL ROLE`, the claims as transaction-local settings, `fn`, `ROLLBACK`. `who` is `'anon'`, `'service_role'` or a user as for `asUser`. For attempts that must leave nothing behind |
| `addUser(db, { email, role?, permissions?, fullName?, id? })` | an `auth.users` row (the trigger makes the profile) with role and permissions set; returns `{ id, email }` |
| `applyMigration(db, name)` | runs one file again (re-run tests) |
| `rows(db, sql, params)` / `one(...)` | query shortcuts; `db` is a plain `PGlite` (`db.query`, `db.exec`) |

The three API helpers do what PostgREST does: the session is `authenticator`,
the role is switched with `SET ROLE`, and the claims and headers are published
as `request.jwt.claims` and `request.headers`. So `session_user`,
`current_user`, grants and RLS all behave as they do behind the API. A read
that RLS filters out returns no rows, as it does through the API. A statement
that Postgres refuses rejects with the error (`err.code` is the SQLSTATE,
`42501` for a missing grant or a failed policy check).

## The RLS suite (`rls.test.mjs`)

Seven people (anon, a signed-in account without a profile, a deactivated
account, a member with no permissions, a member with every permission, an
admin, the same admin after the authenticator step) against one seeded
database.

- **`READS`** is one line per table and view in `public`: what each of the
  seven gets back. The list of tables comes from the catalog, so **a new table
  fails the suite until `seed()` puts a row in it and `READS` says who may
  read it.** `REFUSED` is "no grant" (42501), `none` is "RLS returned
  nothing", `ALL` is every row.
- The write sweep tries, for each person and each table, an `UPDATE` and a
  `DELETE` of everything: no row that person cannot read may change. Where
  they read nothing, an `INSERT` must be refused too.
- Spot checks name the statement: notifications, push subscriptions,
  conversations and messages, channels, the Vault, profiles (no one raises
  their own role), view versus edit.
- anon: the one policy that names it, the tables where it still holds
  Supabase's default grant, the functions it may call. All three are pinned
  lists that may only shrink.
- Tests named `GAP (...)` record behaviour that was reported as a gap and is
  not fixed yet. When a migration closes one, that test (and the cells its
  comment points at) changes in the same commit.

## What this does and does not prove

- It runs real Postgres (18 in PGlite 0.5; hosted projects run 15 or 17). SQL
  that parses here can still differ on an older server.
- It tests the database the migration files build, not the live one. A
  policy or grant changed by hand on the hosted project is not seen here.
- **`postgres` is a superuser here and is not on a hosted project.** A
  migration that only works for a superuser passes here and fails live. Where
  that matters a test creates a plain role in the hosted `postgres`'s position
  (see "emergency off" in `signup-guard.test.mjs`).
- The shims are shapes, not services: GoTrue, PostgREST, Realtime, Storage and
  the Vault's encryption are not running. `pg_net` records calls in
  `net._calls` and never sends; `pg_cron` stores the schedule and never runs.
  A test that needs an HTTP answer inserts into `net._http_response`.
- `auth.users` has the columns the migrations and tests use, not all of
  GoTrue's.
- One database is one session. The helpers switch identity for the duration
  of `fn` and switch back; do not run tests against the same `db` in parallel.
  PGlite ignores `RESET SESSION AUTHORIZATION`, so the helpers return to
  `postgres` by name: use them instead of switching by hand.
- A new Supabase-only object in a migration (another extension, a new `auth`
  or `storage` column) needs its stand-in in `shims.sql` first.
