#!/usr/bin/env node
// DeskDev's n8n on Render: one web service running the stock n8n image. All of
// n8n's state (workflows, credentials, executions) lives in Postgres, in a
// Supabase project of its own, so a restart or a wiped disk loses nothing.
// Dependency-free.
//
//   node scripts/render-n8n.mjs status                 the service, its URL, the latest deploy
//   node scripts/render-n8n.mjs migrate [--n8n=PATH]   run n8n's DB migrations from this machine
//   node scripts/render-n8n.mjs apply [--no-deploy]    create it, or bring env vars, image and
//                                                      health check in line (and redeploy)
//
// Reads .env.local at the repo root through scripts/lib/env.mjs (then the legacy
// web/.env.local and automation/.env.local, or just the file DESKDEV_ENV_FILE /
// N8N_ENV_FILE names). See automation/RENDER.md.
//   RENDER_API_KEY        Render → Account settings → API keys (RENDER_API_TOKEN also works)
//   N8N_ENCRYPTION_KEY    encrypts n8n's stored credentials; changing it orphans every credential
//   N8N_SUPABASE_REF      the n8n project (not DeskDev's app project)
//   N8N_DB_PASSWORD       that project's database password
// apply writes the service URL back to N8N_BASE_URL in the first file that exists.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv as loadEnvChain, writeEnvKey } from './lib/env.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const SERVICE = 'nixgen-n8n'
// Pinned: n8n ships breaking changes in minors, and refuses to start on a
// database migrated by a newer version. Bump on purpose: migrate, then apply.
const IMAGE = 'docker.io/n8nio/n8n:2.41.5'
const REGION = 'singapore' // next to Supabase (ap-southeast-1) and the team (Asia/Manila)
const PLAN = 'free'
// Session-mode pooler: Render has no IPv6 egress, and db.<ref>.supabase.co is
// IPv6-only. aws-0 and aws-1 both resolve; only aws-0 serves this project.
const DB_HOST = 'aws-0-ap-southeast-1.pooler.supabase.com'
// n8n's tables live in schema `n8n` of its own project, as `postgres`:
// - Not in DeskDev's app database. For any schema but public, n8n's TypeORM
//   runs CREATE SCHEMA IF NOT EXISTS on every boot; Postgres checks
//   database-level CREATE before existence, and on "permission denied"
//   TypeORM leaks the pooled client, so n8n hangs forever (no port, no log
//   line, 0% CPU). Granting a restricted role CREATE on the app database
//   would let it squat other roles' "$user" schemas.
// - Not in `public`: Supabase publishes public through the project's Data
//   API and grants anon/authenticated on new tables there by default.
const DB_USER = 'postgres'
const DB_SCHEMA = 'n8n'
// The pooler's certificate chains to Supabase's own root, which Node does not
// trust by default. Pin it rather than turning verification off. Source:
// Supabase → Database → SSL Configuration (prod-ca-2021.crt), valid to 2031-04-26.
const DB_CA = path.join(ROOT, 'automation', 'supabase-root-ca-2021.crt')

const API = 'https://api.render.com/v1'

const args = process.argv.slice(2)
const cmd = args.find((a) => !a.startsWith('--')) ?? 'help'

function loadEnv() {
  // A value in a file wins over an empty variable already in the environment
  // (an exported `KEY=` placeholder would otherwise hide the real value).
  loadEnvChain()
  process.env.RENDER_API_KEY ||= process.env.RENDER_API_TOKEN
  const need = ['N8N_ENCRYPTION_KEY', 'N8N_SUPABASE_REF', 'N8N_DB_PASSWORD', ...(cmd === 'migrate' ? [] : ['RENDER_API_KEY'])]
  const missing = need.filter((k) => !process.env[k])
  if (missing.length) {
    console.error(`Missing ${missing.join(', ')}. Put them in .env.local at the repo root, the single env file.`)
    process.exit(2)
  }
}

async function render(method, route, body) {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: {
      authorization: `Bearer ${process.env.RENDER_API_KEY}`,
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${route}: ${res.status} ${text.slice(0, 400)}`)
  return text ? JSON.parse(text) : null
}

/** Everything n8n needs. Host-derived values come from the URL Render assigned. */
function envVars(host) {
  const url = `https://${host}/`
  return {
    // Render routes to $PORT; n8n listens on N8N_PORT and ignores PORT.
    PORT: '5678',
    N8N_PORT: '5678',
    N8N_HOST: host,
    N8N_PROTOCOL: 'https',
    N8N_PROXY_HOPS: '1',
    WEBHOOK_URL: url,
    N8N_EDITOR_BASE_URL: url,
    GENERIC_TIMEZONE: 'Asia/Manila',
    TZ: 'Asia/Manila',
    N8N_ENCRYPTION_KEY: process.env.N8N_ENCRYPTION_KEY,

    DB_TYPE: 'postgresdb',
    DB_POSTGRESDB_HOST: DB_HOST,
    DB_POSTGRESDB_PORT: '5432',
    DB_POSTGRESDB_DATABASE: 'postgres',
    DB_POSTGRESDB_USER: `${DB_USER}.${process.env.N8N_SUPABASE_REF}`,
    DB_POSTGRESDB_PASSWORD: process.env.N8N_DB_PASSWORD,
    DB_POSTGRESDB_SCHEMA: DB_SCHEMA,
    DB_POSTGRESDB_POOL_SIZE: '3',
    DB_POSTGRESDB_SSL_ENABLED: 'true',
    DB_POSTGRESDB_SSL_CA: fs.readFileSync(DB_CA, 'utf8').replace(/\r\n/g, '\n').trim(),
    DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED: 'true',

    // Supabase's free tier has 500 MB. Successful runs are already recorded
    // in DeskDev's automation_runs; n8n keeps only failures, for a week.
    EXECUTIONS_DATA_SAVE_ON_SUCCESS: 'none',
    EXECUTIONS_DATA_SAVE_ON_ERROR: 'all',
    EXECUTIONS_DATA_PRUNE: 'true',
    EXECUTIONS_DATA_MAX_AGE: '168',
    EXECUTIONS_DATA_PRUNE_MAX_COUNT: '5000',

    // 512 MB holds three Node processes on 2.x (app, task broker, JS runner).
    // Above ~400 the kernel OOM-kills the container instead of V8 aborting.
    NODE_OPTIONS: '--max-old-space-size=350',
    // $env stays blocked (the 2.x default, written down so nobody "fixes" it):
    // a blocked {{ $env.X }} resolves to an error string instead of failing.
    N8N_BLOCK_ENV_ACCESS_IN_NODE: 'true',
    // scripts/n8n.mjs drives the public API.
    N8N_PUBLIC_API_DISABLED: 'false',
    // Boot-time calls to n8n.io this instance has no use for.
    N8N_TEMPLATES_ENABLED: 'false',
    N8N_VERSION_NOTIFICATIONS_ENABLED: 'false',
    N8N_PERSONALIZATION_ENABLED: 'false',
    N8N_HIRING_BANNER_ENABLED: 'false',
    N8N_DIAGNOSTICS_ENABLED: 'false',
    N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS: 'true',
    N8N_LOG_LEVEL: 'info',
  }
}

async function findService() {
  const list = await render('GET', `/services?name=${encodeURIComponent(SERVICE)}&limit=20`)
  return list.map((x) => x.service).find((s) => s.name === SERVICE) ?? null
}

function hostOf(service) {
  const url = service.serviceDetails?.url
  return url ? new URL(url).host : `${SERVICE}.onrender.com`
}

// Only into an env file that already exists: creating one here used to leave a
// one-key file first in the chain, ahead of the real one.
function saveBaseUrl(url) {
  try {
    return `saved to ${path.relative(ROOT, writeEnvKey('N8N_BASE_URL', url))}`
  } catch (e) {
    return `not saved: ${e.message}`
  }
}

async function latestDeploy(id) {
  const deploys = await render('GET', `/services/${id}/deploys?limit=1`)
  return deploys[0]?.deploy ?? null
}

async function status() {
  const s = await findService()
  if (!s) {
    console.log(`${SERVICE}: not on Render yet (apply creates it)`)
    return
  }
  const d = await latestDeploy(s.id)
  console.log(`${SERVICE}  ${s.id}  ${s.serviceDetails?.url}`)
  console.log(`  image   ${s.imagePath ?? '?'}  plan ${s.serviceDetails?.plan}  region ${s.serviceDetails?.region}  health check ${s.serviceDetails?.healthCheckPath || 'none'}${s.suspended === 'suspended' ? '  SUSPENDED' : ''}`)
  if (d) console.log(`  deploy  ${d.id}  ${d.status}  ${d.finishedAt ?? d.createdAt}`)
}

/**
 * A first boot, and any version bump, runs n8n's migrations; on 512 MB the
 * free instance can die partway through them. Run them here instead, with the
 * same version against the same database, then deploy a migrated instance.
 * Needs a local n8n of exactly IMAGE's version (--n8n=path/to/bin/n8n), or
 * fetches it with npx.
 */
async function migrate() {
  const version = IMAGE.split(':').pop()
  const bin = args.find((a) => a.startsWith('--n8n='))?.slice('--n8n='.length)
  const run = (extra, opts) =>
    bin
      ? spawnSync(process.execPath, [bin, ...extra], opts)
      : spawnSync('npx', ['--yes', `n8n@${version}`, ...extra], { ...opts, shell: process.platform === 'win32' })

  const v = run(['--version'], { encoding: 'utf8' })
  const local = (v.stdout ?? '').trim().split(/\s+/).pop()
  if (local !== version) throw new Error(`local n8n is ${local || 'missing'}, the service pins ${version}; they must match`)

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-migrate-'))
  try {
    const env = { ...process.env, ...envVars(`${SERVICE}.onrender.com`), N8N_USER_FOLDER: home }
    for (const k of ['NODE_OPTIONS', 'PORT', 'N8N_PORT']) delete env[k]
    console.log(`migrating schema ${DB_SCHEMA} on ${process.env.N8N_SUPABASE_REF} with n8n ${version} (a first run takes a few minutes)…`)
    // Every n8n command migrates before it runs. list:workflow is the cheapest
    // one that exits 0 on an empty instance (export:workflow exits 1 there).
    const r = run(['list:workflow'], { env, stdio: 'inherit' })
    if (r.status !== 0) throw new Error(`n8n exited with ${r.status ?? r.signal}`)
    console.log('migrated')
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
}

async function apply() {
  const deploy = !args.includes('--no-deploy')
  let s = await findService()
  if (!s) {
    const owners = await render('GET', '/owners?limit=20')
    if (owners.length !== 1) throw new Error(`expected one Render workspace, found ${owners.length}; pick one and hardcode its id`)
    const ownerId = owners[0].owner.id
    const env = envVars(`${SERVICE}.onrender.com`)
    // No health check: Render allows a few seconds, and a first boot spends
    // minutes loading nodes and migrating, so Render would kill it mid-boot in
    // a loop that looks like an n8n crash. Liveness is the keep-alive's job.
    const made = await render('POST', '/services', {
      type: 'web_service',
      name: SERVICE,
      ownerId,
      autoDeploy: 'no',
      image: { ownerId, imagePath: IMAGE },
      envVars: Object.entries(env).map(([key, value]) => ({ key, value })),
      serviceDetails: { runtime: 'image', plan: PLAN, region: REGION, numInstances: 1 },
    })
    s = made.service
    console.log(`+ created ${SERVICE} (${s.id}) at ${s.serviceDetails?.url}`)
  }

  const host = hostOf(s)
  const want = envVars(host)
  const have = Object.fromEntries((await render('GET', `/services/${s.id}/env-vars?limit=100`)).map((x) => [x.envVar.key, x.envVar.value]))
  const changed = Object.keys({ ...want, ...have }).filter((k) => want[k] !== have[k])
  const patch = {}
  if (s.imagePath && s.imagePath !== IMAGE) patch.image = { ownerId: s.ownerId, imagePath: IMAGE }
  if (s.serviceDetails?.healthCheckPath) patch.serviceDetails = { healthCheckPath: '' }

  if (changed.length) {
    await render('PUT', `/services/${s.id}/env-vars`, Object.entries(want).map(([key, value]) => ({ key, value })))
    console.log(`~ env vars: ${changed.join(', ')}`)
  }
  if (Object.keys(patch).length) {
    await render('PATCH', `/services/${s.id}`, patch)
    if (patch.image) console.log(`~ image: ${s.imagePath} → ${IMAGE}`)
    if (patch.serviceDetails) console.log(`~ health check: ${s.serviceDetails.healthCheckPath} → none`)
  }
  if (!changed.length && !Object.keys(patch).length) {
    console.log('= env vars, image and health check in sync; nothing to deploy')
  } else if (!deploy) {
    console.log('  (--no-deploy: takes effect on the next deploy)')
  } else {
    // 202 with an empty body when a deploy is already running: Render queues this one behind it.
    const d = await render('POST', `/services/${s.id}/deploys`, { clearCache: 'do_not_clear' })
    console.log(`↻ deploy ${d?.id ?? 'queued'}`)
  }

  const saved = saveBaseUrl(`https://${host}`)
  console.log(`N8N_BASE_URL=https://${host} (${saved})`)
}

const commands = { status, migrate, apply }
if (!commands[cmd]) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 19).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))
  process.exit(cmd === 'help' ? 0 : 2)
}
loadEnv()
try {
  await commands[cmd]()
} catch (e) {
  console.error(`render-n8n ${cmd}: ${e.message}`)
  process.exit(1)
}
