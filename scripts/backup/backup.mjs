#!/usr/bin/env node
// Nightly database backup: dump -> gzip -> age-encrypt -> Cloudflare R2.
// Runbook: docs/runbooks/BACKUP-RESTORE.md. Scheduled by
// .github/workflows/db-backup.yml (inert until the owner switches it on).
//
//   node scripts/backup/backup.mjs --dry-run            # offline rehearsal, no DB, no upload
//   node scripts/backup/backup.mjs                      # the real thing (CI)
//   node scripts/backup/backup.mjs --no-upload --work-dir ./out   # encrypted files to disk only
//
// Options
//   --dry-run        Use a synthetic dump instead of the database, never touch
//                    R2 (requests are signed and printed, not sent), encrypt
//                    only if `age` is installed and recipients are set.
//   --tool <t>       supabase (default; roles/schema/data like Supabase's own
//                    backup guide) or pg_dump (one custom-format archive).
//   --work-dir <d>   Keep the working files here instead of a temp dir.
//   --no-upload      Stop after encryption (files stay in --work-dir).
//
// Environment (names only; values come from CI secrets/vars or your shell):
//   BACKUP_DATABASE_URL     Supabase *session pooler* URI (port 5432). GitHub
//                           runners have no IPv6, so not the direct db.<ref> host.
//   BACKUP_AGE_RECIPIENTS   age1… public key(s), comma or space separated.
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (default nixgen-db-backups)
//   BACKUP_PROJECT_REF      label in the manifest (default: parsed from the URL)
//   AGE_BIN, SUPABASE_BIN, PG_DUMP_BIN   override the binaries (tests use AGE_BIN)
//
// The plaintext dump never leaves the machine and is deleted as soon as it is
// encrypted. Nothing here prints a secret or a connection string.
import { spawnSync } from 'node:child_process'
import { createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import {
  DEFAULT_BUCKET, PG_DUMP_PARTS, SUPABASE_PARTS, REQUIRED_ENV,
  ageEncryptArgs, buildManifest, describeDbUrl, lifecycleCovers, missingEnv, objectName,
  parseArgs, parseRecipients, projectRefOf, r2Host, runPrefix, sha256Hex, signV4,
} from './lib.mjs'

const args = parseArgs(process.argv.slice(2), ['dry-run', 'no-upload', 'help'])
if (args.help) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'))
  process.exit(0)
}

const dryRun = Boolean(args['dry-run'])
const upload = !args['no-upload']
const tool = String(args.tool ?? 'supabase')
if (!['supabase', 'pg_dump'].includes(tool)) fail(`--tool must be supabase or pg_dump, not ${tool}`)

const env = process.env
const AGE_BIN = env.AGE_BIN || 'age'
const SUPABASE_BIN = env.SUPABASE_BIN || 'supabase'
const PG_DUMP_BIN = env.PG_DUMP_BIN || 'pg_dump'
const now = new Date()

function log(msg) { console.log(`[backup] ${msg}`) }
function warn(msg) { console.warn(`[backup] WARN ${msg}`) }
function fail(msg) { console.error(`[backup] FAIL ${msg}`); process.exit(1) }

function summary(md) {
  if (env.GITHUB_STEP_SUMMARY) {
    try { appendFileSync(env.GITHUB_STEP_SUMMARY, `${md}\n`) } catch { /* not fatal */ }
  }
}

function hasBinary(bin) {
  const r = spawnSync(bin, ['--version'], { stdio: 'ignore', shell: false })
  return r.status === 0
}

function run(bin, argv, label) {
  // stdio: dumps write to files (-f); inherit stderr so CI shows progress.
  // The DB URL is in argv; GitHub masks secret values in logs, and nothing
  // here echoes the command line.
  const r = spawnSync(bin, argv, { stdio: ['ignore', 'inherit', 'inherit'], shell: false })
  if (r.error) fail(`${label}: could not start ${bin} (${r.error.code ?? r.error.message})`)
  if (r.status !== 0) fail(`${label}: ${bin} exited with ${r.status}`)
}

// ---------- 0. preflight ----------
const needs = [
  ...(dryRun ? [] : REQUIRED_ENV.dump),
  ...REQUIRED_ENV.encrypt,
  ...(upload ? REQUIRED_ENV.upload : []),
]
const missing = missingEnv(env, needs)
if (missing.length && !dryRun) fail(`missing environment: ${missing.join(', ')}`)
if (missing.length && dryRun) warn(`would be missing in a real run: ${missing.join(', ')}`)

let recipients = []
try {
  recipients = parseRecipients(env.BACKUP_AGE_RECIPIENTS)
} catch (e) {
  if (!dryRun) fail(e.message)
  warn(`${e.message}; dry run continues without encryption`)
}
const ageAvailable = hasBinary(AGE_BIN)
if (!ageAvailable && !dryRun) fail(`${AGE_BIN} is not on PATH (apt-get install age)`)
const encrypt = recipients.length > 0 && ageAvailable
if (dryRun && !encrypt) warn(`encryption skipped in this dry run (${!ageAvailable ? `${AGE_BIN} not on PATH` : 'no recipients'})`)

const dbUrl = env.BACKUP_DATABASE_URL ?? ''
const projectRef = env.BACKUP_PROJECT_REF || projectRefOf(dbUrl) || 'unknown'
if (!dryRun) log(`source: ${describeDbUrl(dbUrl)}`)

const bucket = env.R2_BUCKET || DEFAULT_BUCKET
let host = null
if (upload) {
  try {
    host = r2Host(env.R2_ACCOUNT_ID ?? '')
  } catch (e) {
    if (!dryRun) fail(e.message)
    host = `${'0'.repeat(32)}.r2.cloudflarestorage.com`
    warn(`${e.message}; dry run signs against a placeholder host`)
  }
}

const keepWork = Boolean(args['work-dir'])
const work = keepWork ? resolve(String(args['work-dir'])) : mkdtempSync(join(tmpdir(), 'nixgen-backup-'))
mkdirSync(work, { recursive: true })
// fail() exits mid-run; a temp dir must not keep a plaintext dump on a laptop.
// (--work-dir is the caller's folder and theirs to clean.)
if (!keepWork) process.on('exit', () => { try { rmSync(work, { recursive: true, force: true }) } catch { /* best effort */ } })
const prefix = runPrefix(now)
log(`${dryRun ? 'DRY RUN ' : ''}run ${prefix} tool=${tool} work=${keepWork ? work : '(temp)'}`)

// ---------- 1. dump ----------
const parts = tool === 'supabase' ? SUPABASE_PARTS : PG_DUMP_PARTS
if (dryRun) {
  for (const p of parts) {
    writeFileSync(join(work, p), [
      '--',
      '-- PostgreSQL database dump (DRY RUN fixture, not real data)',
      `-- part: ${p}  generated: ${now.toISOString()}`,
      '--',
      p === 'data.sql' ? "COPY public.example (id, name) FROM stdin;\n1\tfixture\n\\.\n" : 'SELECT 1;',
      '',
    ].join('\n'))
  }
  log(`dump: wrote ${parts.length} fixture file(s)`)
} else if (tool === 'supabase') {
  if (!hasBinary(SUPABASE_BIN)) fail(`${SUPABASE_BIN} CLI is not on PATH (uses Docker for pg_dump)`)
  run(SUPABASE_BIN, ['db', 'dump', '--db-url', dbUrl, '-f', join(work, 'roles.sql'), '--role-only'], 'roles')
  run(SUPABASE_BIN, ['db', 'dump', '--db-url', dbUrl, '-f', join(work, 'schema.sql')], 'schema')
  run(SUPABASE_BIN, ['db', 'dump', '--db-url', dbUrl, '-f', join(work, 'data.sql'), '--use-copy', '--data-only'], 'data')
} else {
  if (!hasBinary(PG_DUMP_BIN)) fail(`${PG_DUMP_BIN} is not on PATH`)
  run(PG_DUMP_BIN, ['--dbname', dbUrl, '--format=custom', '--no-owner', '--no-privileges', '--file', join(work, 'full.dump')], 'pg_dump')
}

for (const p of parts) {
  const f = join(work, p)
  if (!existsSync(f) || statSync(f).size === 0) fail(`dump produced no ${p}`)
}

// ---------- 2. gzip + 3. encrypt ----------
const files = []
for (const p of parts) {
  const raw = join(work, p)
  const gz = `${raw}.gz`
  await pipeline(createReadStream(raw), createGzip({ level: 9 }), createWriteStream(gz))
  const plainBytes = statSync(raw).size
  rmSync(raw)

  let out = gz
  if (encrypt) {
    out = `${gz}.age`
    run(AGE_BIN, ageEncryptArgs(recipients, gz, out), `encrypt ${p}`)
    rmSync(gz) // the plaintext never outlives its ciphertext
  }
  const body = readFileSync(out)
  files.push({
    part: p,
    object: encrypt ? objectName(p) : `${p}.gz`,
    path: out,
    bytes: body.length,
    sha256: sha256Hex(body),
    plainBytes,
  })
}
log(`encrypted: ${encrypt ? 'yes' : 'NO (dry run)'}; ${files.map((f) => `${f.object} ${f.bytes}B`).join(', ')}`)

const manifest = buildManifest({ date: now, projectRef, tool, recipients, files, dryRun: dryRun || !encrypt })
const manifestBody = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
writeFileSync(join(work, 'manifest.json'), manifestBody)

// ---------- 4. upload ----------
const creds = {
  accessKeyId: env.R2_ACCESS_KEY_ID || 'DRYRUNACCESSKEY',
  secretAccessKey: env.R2_SECRET_ACCESS_KEY || 'dry-run-secret',
}

async function put(key, body, contentType) {
  const signed = signV4({
    method: 'PUT', host, path: `/${bucket}/${key}`,
    headers: { 'content-type': contentType },
    payloadHash: sha256Hex(body), ...creds, date: new Date(),
  })
  if (dryRun) {
    log(`would PUT https://${host.replace(/^[0-9a-f]{32}/, '<account>')}/${bucket}/${key} (${body.length} B, signed headers: ${Object.keys(signed.headers).filter((h) => h !== 'authorization').join(', ')})`)
    return
  }
  const res = await fetch(signed.url, { method: 'PUT', headers: signed.headers, body })
  if (!res.ok) fail(`upload ${key}: HTTP ${res.status} ${(await res.text()).slice(0, 200).replace(/\s+/g, ' ')}`)
}

if (upload) {
  for (const f of files) await put(`${prefix}${f.object}`, readFileSync(f.path), 'application/octet-stream')
  // Last: a manifest marks a complete run (restore.mjs --latest only picks runs that have one).
  await put(`${prefix}manifest.json`, manifestBody, 'application/json')
  log(dryRun ? 'upload: dry run, nothing sent' : `uploaded to r2://${bucket}/${prefix}`)

  if (!dryRun) {
    // Belt and braces: the 35-day expiry lives on the bucket, not in this
    // script (the backup key cannot delete). Warn if it is missing.
    const signed = signV4({ method: 'GET', host, path: `/${bucket}`, query: { lifecycle: '' }, ...creds, date: new Date() })
    try {
      const res = await fetch(signed.url, { headers: signed.headers })
      const xml = res.ok ? await res.text() : ''
      if (!res.ok) warn(`could not read the bucket lifecycle (HTTP ${res.status}); confirm the 35-day rule in the dashboard`)
      else if (!lifecycleCovers(xml)) warn('bucket has no enabled lifecycle rule expiring nightly/ within 35 days (runbook step 2)')
      else log('lifecycle: nightly/ expires within 35 days')
    } catch (e) {
      warn(`lifecycle check failed: ${e.message}`)
    }
  }
}

summary([
  `### Database backup ${dryRun ? '(dry run)' : ''}`,
  '',
  `- run: \`${prefix}\``,
  `- project: \`${projectRef}\`, tool: \`${tool}\`, encrypted: ${encrypt ? 'yes (age)' : 'no'}`,
  ...files.map((f) => `- \`${f.object}\`: ${f.bytes} bytes, sha256 \`${f.sha256.slice(0, 16)}…\``),
].join('\n'))

if (!keepWork) rmSync(work, { recursive: true, force: true })
log(`done${keepWork ? `; files in ${work}` : ''}`)
