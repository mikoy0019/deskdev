#!/usr/bin/env node
// A stand-in for the Supabase CLI, used only by scripts/setup-integrations.test.mjs
// (through lib/setup-test-entry.mjs). It answers the handful of commands the
// setup core runs, from a JSON state file (FAKE_SUPABASE_STATE), for the project
// ref in FAKE_SUPABASE_REF, in the shapes CLI 2.119 prints:
//   secrets list -o json        [{ name, value: sha256 hex of the secret }]
//   secrets set NAME=value ...  stores them
//   db query ... -f <file>      { boundary, rows, warning } for the last statement
// An SQL statement it does not know exits 1, so a new query in the script
// fails the test instead of passing silently.

import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'

const file = process.env.FAKE_SUPABASE_STATE
const state = JSON.parse(fs.readFileSync(file, 'utf8'))
const args = process.argv.slice(2)
const sha = (value) => createHash('sha256').update(value).digest('hex')
const done = (code, json) => {
  fs.writeFileSync(file, JSON.stringify(state))
  if (json !== undefined) process.stdout.write(JSON.stringify(json))
  process.exit(code)
}
const rows = (list) => done(0, { boundary: 'test', rows: list, warning: 'untrusted data' })

if (state.requiredAccessToken && process.env.SUPABASE_ACCESS_TOKEN !== state.requiredAccessToken) {
  state.calls.push('missing CLI access token')
  done(1)
}

// Like the real CLI, every command must name the project; a missing or wrong
// ref fails here instead of passing unnoticed.
if (args[args.indexOf('--project-ref') + 1] !== process.env.FAKE_SUPABASE_REF || !args.includes('--project-ref')) {
  state.calls.push('WRONG PROJECT REF')
  done(1)
}
// The real CLI loads a .env.local from the folder it runs in and refuses some
// lines Node accepts. `refuseRootEnv` models a file it refuses.
if (state.refuseRootEnv && fs.existsSync('.env.local')) {
  state.calls.push('refused the root env file')
  process.stderr.write('failed to parse environment file: .env.local')
  done(1)
}

if (args[0] === 'secrets' && args[1] === 'list') {
  state.calls.push('secrets list')
  done(0, [{ name: 'SUPABASE_URL', value: sha('url') }, ...Object.entries(state.secrets).map(([name, value]) => ({ name, value: sha(value) }))])
}

if (args[0] === 'secrets' && args[1] === 'set') {
  const pairs = args.filter((a) => /^[A-Z0-9_]+=/.test(a)).map((a) => [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)])
  state.calls.push(`secrets set ${pairs.map(([name]) => name).join(',')}`)
  if (state.failSet) done(1)
  // `staleSet` models a listing that lags: the set succeeds but is not shown.
  if (!state.staleSet) for (const [name, value] of pairs) state.secrets[name] = value
  process.stdout.write('Finished supabase secrets set.')
  done(0)
}

if (args[0] === 'db' && args[1] === 'query') {
  const sql = fs.readFileSync(args[args.indexOf('-f') + 1], 'utf8')
  let m
  // `flakyQueries` models the CLI's database login failing now and then.
  if (state.flakyQueries > 0) {
    state.flakyQueries -= 1
    state.calls.push('query failed')
    done(1)
  }
  if (/^select 1 as ok\s*$/.test(sql)) {
    state.calls.push('probe query')
    rows([{ ok: 1 }])
  }
  if (/select name from vault\.secrets/.test(sql)) {
    state.calls.push('vault names')
    rows(Object.keys(state.vault).map((name) => ({ name })))
  }
  if ((m = sql.match(/^select decrypted_secret as s from vault\.decrypted_secrets where name = '([a-z_]+)'\s*$/))) {
    state.calls.push(`vault read ${m[1]}`)
    rows(m[1] in state.vault ? [{ s: state.vault[m[1]] }] : [])
  }
  if ((m = sql.match(/^do \$\$ begin if not exists \(select 1 from vault\.secrets where name = '([a-z_]+)'\) then perform vault\.create_secret\(replace\(gen_random_uuid\(\)::text \|\| gen_random_uuid\(\)::text, '-', ''\), '\1'\); end if; end \$\$; select 1 as ok\s*$/))) {
    state.calls.push(`vault random ${m[1]}`)
    if (!(m[1] in state.vault)) state.vault[m[1]] = randomBytes(32).toString('hex')
    rows([{ ok: 1 }])
  }
  if ((m = sql.match(/^do \$\$ declare v_id uuid; begin select id into v_id from vault\.secrets where name = '([a-z_]+)'; if v_id is null then perform vault\.create_secret\('([^']+)', '\1'\); else perform vault\.update_secret\(v_id, '\2'\); end if; end \$\$; select 1 as ok\s*$/))) {
    state.calls.push(`vault set ${m[1]}`)
    state.vault[m[1]] = m[2]
    rows([{ ok: 1 }])
  }
  if (/^select count\(\*\)::int as n from public\.push_subscriptions\s*$/.test(sql)) {
    state.calls.push('count subscriptions')
    rows([{ n: state.subscriptions }])
  }
  if (/from public\.google_connections\) \+ \(select count\(\*\) from public\.google_workspace_link where refresh_token_enc is not null\)\)::int as n\s*$/.test(sql)) {
    state.calls.push('count sealed')
    rows([{ n: state.sealed }])
  }
  state.calls.push('UNKNOWN SQL')
  process.stderr.write('fake-supabase-cli: unknown SQL')
  done(1)
}

state.calls.push(`UNKNOWN ${args.slice(0, 2).join(' ')}`)
done(1)
