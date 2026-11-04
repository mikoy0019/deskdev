#!/usr/bin/env node
// Restore side of scripts/backup/backup.mjs. Runbook: docs/runbooks/BACKUP-RESTORE.md.
//
//   node scripts/backup/restore.mjs list                         # runs in R2, newest last
//   node scripts/backup/restore.mjs fetch --latest --out ./restore
//   node scripts/backup/restore.mjs fetch --run nightly/2026/10/03/20261003T190007Z/ --out ./restore
//   node scripts/backup/restore.mjs fetch --from-dir ./backup-out --out ./restore   # local files, no R2
//   node scripts/backup/restore.mjs apply --dir ./restore [--dry-run]
//
// fetch: download (or read) a run, check every file against manifest.json
//        BEFORE decrypting, decrypt with your age identity, gunzip. Writes
//        plaintext SQL to --out: keep that folder on an encrypted disk and
//        delete it when done.
// apply: load the SQL into RESTORE_DATABASE_URL with psql, in one
//        transaction (Supabase's documented restore order). Refuses the live
//        project unless --allow-production AND RESTORE_CONFIRM=<ref>.
//
// Environment (names only):
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET   (list / fetch from R2)
//   BACKUP_AGE_IDENTITY_FILE   path to the age private key file (kept offline, never in CI)
//   RESTORE_DATABASE_URL       target: staging, a scratch project or local Postgres
//   RESTORE_CONFIRM            only for a real production recovery
//   AGE_BIN, PSQL_BIN          override the binaries
import { spawnSync } from 'node:child_process'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import {
  DEFAULT_BUCKET, NIGHTLY_PREFIX, REQUIRED_ENV, RETENTION_DAYS,
  ageDecryptArgs, assertRestoreTarget, describeDbUrl, latestRun, missingEnv,
  parseArgs, parseListObjects, r2Host, runAgeDays, sha256Hex, signV4,
} from './lib.mjs'

const args = parseArgs(process.argv.slice(2), ['latest', 'dry-run', 'allow-production', 'help'])
const cmd = args._[0]
const env = process.env
const AGE_BIN = env.AGE_BIN || 'age'
const PSQL_BIN = env.PSQL_BIN || 'psql'
const bucket = env.R2_BUCKET || DEFAULT_BUCKET

function log(msg) { console.log(`[restore] ${msg}`) }
function fail(msg) { console.error(`[restore] FAIL ${msg}`); process.exit(1) }

if (!cmd || args.help) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'))
  process.exit(cmd ? 0 : 1)
}

function r2() {
  const missing = missingEnv(env, REQUIRED_ENV.restoreDownload)
  if (missing.length) fail(`missing environment: ${missing.join(', ')}`)
  let host
  try { host = r2Host(env.R2_ACCOUNT_ID) } catch (e) { fail(e.message) }
  const creds = { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY }
  return {
    async get(path, query = {}) {
      const s = signV4({ method: 'GET', host, path, query, ...creds, date: new Date() })
      const res = await fetch(s.url, { headers: s.headers })
      if (!res.ok) fail(`GET ${path}: HTTP ${res.status}`)
      return Buffer.from(await res.arrayBuffer())
    },
    async list(prefix) {
      const keys = []
      let token = null
      do {
        const q = { 'list-type': '2', prefix, 'max-keys': '1000', ...(token ? { 'continuation-token': token } : {}) }
        const page = parseListObjects((await this.get(`/${bucket}`, q)).toString('utf8'))
        keys.push(...page.keys)
        token = page.next
      } while (token)
      return keys
    },
  }
}

async function cmdList() {
  const keys = await r2().list(NIGHTLY_PREFIX)
  const runs = keys.filter((k) => k.endsWith('/manifest.json')).map((k) => k.slice(0, -'manifest.json'.length)).sort()
  if (!runs.length) { log('no complete runs (a run is complete once its manifest.json exists)'); return }
  for (const r of runs) {
    const age = runAgeDays(r, new Date())
    console.log(`${r}  ${age === null ? '' : `${age.toFixed(1)} days old`}${age !== null && age > RETENTION_DAYS ? '  (past the lifecycle window: expiring)' : ''}`)
  }
  log(`${runs.length} run(s); newest: ${runs[runs.length - 1]}`)
}

async function cmdFetch() {
  const out = resolve(String(args.out ?? ''))
  if (!args.out) fail('--out <dir> is required')
  mkdirSync(out, { recursive: true })

  // 1. Collect the run's files (manifest first).
  let manifest
  const blobs = new Map()
  if (args['from-dir']) {
    const dir = resolve(String(args['from-dir']))
    manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
    // backup.mjs --work-dir names its local files exactly like the objects.
    for (const f of manifest.files) blobs.set(f.object, readFileSync(join(dir, f.object)))
    log(`source: local ${dir}`)
  } else {
    const client = r2()
    let run = args.run ? String(args.run) : null
    if (args.latest) run = latestRun(await client.list(NIGHTLY_PREFIX))
    if (!run) fail('pass --latest or --run <prefix> (see `list`)')
    if (!run.endsWith('/')) run += '/'
    manifest = JSON.parse((await client.get(`/${bucket}/${run}manifest.json`)).toString('utf8'))
    for (const f of manifest.files) blobs.set(f.object, await client.get(`/${bucket}/${run}${f.object}`))
    log(`source: r2://${bucket}/${run}`)
  }
  if (manifest.format !== 'nixgen-db-backup/1') fail(`unknown manifest format ${manifest.format}`)
  log(`run from ${manifest.created_at}, project ${manifest.project_ref}, tool ${manifest.tool}${manifest.dry_run ? ' (DRY RUN fixture)' : ''}`)

  // 2. Verify every file before anything is decrypted.
  for (const f of manifest.files) {
    const b = blobs.get(f.object)
    if (!b) fail(`${f.object} missing`)
    if (b.length !== f.bytes || sha256Hex(b) !== f.sha256) fail(`${f.object} does not match the manifest (size/sha256): corrupt or tampered`)
  }
  log(`verified ${manifest.files.length} file(s) against the manifest`)

  // 3. Decrypt (age) + gunzip.
  const encrypted = manifest.files.some((f) => f.object.endsWith('.age'))
  if (encrypted) {
    const missing = missingEnv(env, REQUIRED_ENV.restoreDecrypt)
    if (missing.length) fail(`missing environment: ${missing.join(', ')}`)
    if (!existsSync(env.BACKUP_AGE_IDENTITY_FILE)) fail('BACKUP_AGE_IDENTITY_FILE does not exist')
  }
  for (const f of manifest.files) {
    const gz = join(out, `${f.part}.gz`)
    if (f.object.endsWith('.age')) {
      const enc = join(out, f.object)
      writeFileSync(enc, blobs.get(f.object))
      const r = spawnSync(AGE_BIN, ageDecryptArgs(env.BACKUP_AGE_IDENTITY_FILE, enc, gz), { stdio: ['ignore', 'inherit', 'inherit'], shell: false })
      rmSync(enc)
      if (r.error || r.status !== 0) fail(`decrypt ${f.object} failed (wrong identity, or ${AGE_BIN} missing)`)
    } else {
      writeFileSync(gz, blobs.get(f.object))
    }
    await pipeline(createReadStream(gz), createGunzip(), createWriteStream(join(out, f.part)))
    rmSync(gz)
    const plain = readFileSync(join(out, f.part))
    if (f.plain_bytes !== undefined && plain.length !== f.plain_bytes) fail(`${f.part}: ${plain.length} bytes after decrypt, manifest says ${f.plain_bytes}`)
  }
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  log(`wrote ${manifest.files.map((f) => f.part).join(', ')} to ${out}. This is PLAINTEXT client data: delete it after the restore.`)
}

function cmdApply() {
  const dir = resolve(String(args.dir ?? ''))
  if (!args.dir) fail('--dir <fetched dir> is required')
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
  const target = env.RESTORE_DATABASE_URL ?? ''
  if (missingEnv(env, REQUIRED_ENV.restoreApply).length) fail('RESTORE_DATABASE_URL is not set')
  try {
    const t = assertRestoreTarget(target, { allowProduction: Boolean(args['allow-production']), confirm: env.RESTORE_CONFIRM ?? '' })
    log(`target: ${describeDbUrl(target)}${t.production ? '  ** PRODUCTION (confirmed) **' : ''}`)
  } catch (e) {
    fail(e.message)
  }

  let psqlArgs
  if (manifest.tool === 'supabase') {
    for (const p of ['roles.sql', 'schema.sql', 'data.sql']) if (!existsSync(join(dir, p))) fail(`${p} missing in ${dir}`)
    // Supabase's documented order; replica mode skips triggers and FK checks
    // while the data loads, so trigger side effects (notifications, n8n
    // posts) do not fire for restored rows.
    psqlArgs = [
      '--single-transaction', '--variable', 'ON_ERROR_STOP=1',
      '--file', join(dir, 'roles.sql'),
      '--file', join(dir, 'schema.sql'),
      '--command', 'SET session_replication_role = replica',
      '--file', join(dir, 'data.sql'),
      '--dbname', target,
    ]
  } else {
    fail('pg_dump archives restore with pg_restore; see docs/runbooks/BACKUP-RESTORE.md ("pg_dump fallback")')
  }

  if (args['dry-run']) {
    log(`dry run: would run ${PSQL_BIN} ${psqlArgs.slice(0, -1).map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')} --dbname <RESTORE_DATABASE_URL>`)
    return
  }
  const r = spawnSync(PSQL_BIN, psqlArgs, { stdio: 'inherit', shell: false })
  if (r.error) fail(`could not start ${PSQL_BIN} (${r.error.code ?? r.error.message})`)
  if (r.status !== 0) fail(`psql exited with ${r.status}; the single transaction was rolled back`)
  log('restore applied. Next: the verification queries in docs/runbooks/BACKUP-RESTORE.md, then re-create Vault secrets on a new project.')
}

if (cmd === 'list') await cmdList()
else if (cmd === 'fetch') await cmdFetch()
else if (cmd === 'apply') cmdApply()
else fail(`unknown command ${cmd} (list | fetch | apply)`)
