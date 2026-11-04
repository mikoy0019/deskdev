#!/usr/bin/env node
// DeskDev ⇄ n8n: the workflows in automation/n8n/*.json are the source of
// truth; this keeps the live instance honest against them. Dependency-free.
//
//   node scripts/n8n.mjs check                 offline lint (CI runs this)
//   node scripts/n8n.mjs status                live vs git, per node
//   node scripts/n8n.mjs push [--apply]        create missing / update existing (dry run by default)
//        [--only=overdue-tasks,lead-nudge]     limit to some workflows (the error handler always comes along)
//        [--supabase-cred-id=ID] [--webhook-cred-id=ID] [--adzuna-cred-id=ID]
//        [--gmail-cred-id=ID] [--sheets-cred-id=ID]   pin a credential instead of looking it up
//   node scripts/n8n.mjs pull [--write]        live → automation/n8n/.live/ (or over the git files)
//   node scripts/n8n.mjs audit                 whole instance: $env readers + node types in use
//
// Live commands read the repo's env file through scripts/lib/env.mjs: .env.local
// at the root, then the legacy web/.env.local and automation/.env.local for keys
// still missing (or just the file DESKDEV_ENV_FILE / N8N_ENV_FILE names). A value
// in a file beats an empty variable in the environment:
//   N8N_BASE_URL               default https://nixgen-n8n-8gp7.onrender.com
//   N8N_API_KEY                n8n → Settings → n8n API (a JWT, tied to the instance that issued it)
//   SUPABASE_SERVICE_ROLE_KEY  first push only: becomes the "Supabase — DeskDev" credential
//   N8N_WEBHOOK_SECRET         first push only: becomes the "DeskDev Webhook Secret" credential
//   ADZUNA_APP_KEY             first push only: becomes the "Adzuna API key" credential
//
// Design notes (the host itself: automation/RENDER.md):
// - Nothing is ever activated or deactivated here. That stays a human click.
// - The git JSON never carries an instance's credential ids, only the
//   placeholders in CREDS below. push resolves each one: a --flag, else the
//   instance's credential list (type + name), else, for the three this repo
//   owns, a new credential made from env. The two Google OAuth credentials
//   need a browser consent, so they are made in the n8n UI; until then a NEW
//   workflow is created with that reference left empty ("select credential"),
//   and an EXISTING one keeps whatever the UI already has.
// - Workflows never read $env: n8n 2.x blocks it by default and the failure is
//   silent at run time. `check` fails the build if one does.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from './lib/env.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = path.join(ROOT, 'automation', 'n8n')
const LIVE_DIR = path.join(DIR, '.live')
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations')

const PREFIX = '[deskdev] '
const TIMEZONE = 'Asia/Manila'
const SUPABASE_URL = 'https://rgasjotvqwkjbeivlhvn.supabase.co'
const APP_URL = 'https://workspace.nixgensolutions.com'
const ERROR_HANDLER = 'error-handler'
const ERROR_WORKFLOW_PH = '__DESKDEV_ERROR_WORKFLOW__'

/** Every credential a DeskDev workflow may reference, by the placeholder id it carries in git. */
const CREDS = {
  __SUPABASE_CRED__: {
    name: 'Supabase — DeskDev',
    type: 'supabaseApi',
    flag: 'supabase-cred-id',
    env: 'SUPABASE_SERVICE_ROLE_KEY',
    data: (v) => ({ host: SUPABASE_URL, serviceRole: v }),
  },
  __DESKDEV_WEBHOOK_CRED__: {
    name: 'DeskDev Webhook Secret',
    type: 'httpHeaderAuth',
    flag: 'webhook-cred-id',
    env: 'N8N_WEBHOOK_SECRET',
    data: (v) => ({ name: 'x-webhook-secret', value: v }),
  },
  __ADZUNA_CRED__: {
    name: 'Adzuna API key',
    type: 'httpQueryAuth',
    flag: 'adzuna-cred-id',
    env: 'ADZUNA_APP_KEY',
    data: (v) => ({ name: 'app_key', value: v }),
  },
  __GMAIL_CRED__: { name: 'Gmail account', type: 'gmailOAuth2', flag: 'gmail-cred-id', oauth: true },
  __GOOGLE_SHEETS_CRED__: { name: 'Google Sheets account', type: 'googleSheetsOAuth2Api', flag: 'sheets-cred-id', oauth: true },
}
const WEBHOOK_CRED = CREDS.__DESKDEV_WEBHOOK_CRED__

// Keys the public API accepts on a workflow body. Anything else (id, active,
// versionId, meta, tags, pinData…) is read-only and makes PUT/POST fail.
const SETTINGS_KEYS = ['executionOrder', 'timezone', 'errorWorkflow', 'saveDataErrorExecution', 'saveDataSuccessExecution', 'saveManualExecutions', 'saveExecutionProgress', 'executionTimeout', 'callerPolicy']
const NODE_KEYS = ['parameters', 'id', 'name', 'type', 'typeVersion', 'position', 'credentials', 'webhookId', 'disabled', 'executeOnce', 'alwaysOutputData', 'onError', 'retryOnFail', 'maxTries', 'waitBetweenTries', 'notes', 'notesInFlow']

// ---------------------------------------------------------------------------
// helpers

const args = process.argv.slice(2)
const cmd = args.find((a) => !a.startsWith('--')) ?? 'help'
const flag = (name) => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return undefined
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true
}

const canonical = (w) => JSON.stringify(w, null, 2) + '\n'
const slugOf = (name) => name.slice(PREFIX.length)
const clone = (x) => JSON.parse(JSON.stringify(x))

function loadGit() {
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => {
      const raw = fs.readFileSync(path.join(DIR, file), 'utf8').replace(/\r\n/g, '\n')
      return { file, slug: file.replace(/\.json$/, ''), raw, wf: JSON.parse(raw) }
    })
}

const isSticky = (n) => n.type === 'n8n-nodes-base.stickyNote'
const isWebhook = (n) => n.type === 'n8n-nodes-base.webhook'
const isSchedule = (n) => n.type === 'n8n-nodes-base.scheduleTrigger'

/**
 * The jobs the migrations register in automation_jobs (026 seeds the first
 * five; later migrations add their own, e.g. 049's email-inbound). Every
 * `INSERT INTO public.automation_jobs … ON CONFLICT (job)` statement counts;
 * the last migration to name a job wins.
 */
function seededJobs() {
  if (!fs.existsSync(MIGRATIONS)) return null
  const jobs = new Map()
  for (const file of fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8')
    for (const insert of sql.matchAll(/INSERT INTO public\.automation_jobs([\s\S]*?)ON CONFLICT \(job\)/g)) {
      for (const m of insert[1].matchAll(/\(\s*'([a-z0-9-]+)'\s*,\s*'([^']+)'/g)) {
        jobs.set(m[1], { job: m[1], workflow: m[2], file })
      }
    }
  }
  return [...jobs.values()]
}

// ---------------------------------------------------------------------------
// check: offline, deterministic, fails CI

function check() {
  const errors = []
  const err = (file, msg) => errors.push(`${file}: ${msg}`)
  const all = loadGit()
  const paths = new Map()
  const jobs = seededJobs()

  for (const { file, slug, raw, wf } of all) {
    if (raw !== canonical(wf)) err(file, 'not in canonical form (2-space JSON + newline); run `node scripts/n8n.mjs pull --write` or reformat')
    if (wf.name !== PREFIX + slug) err(file, `name must be "${PREFIX}${slug}" (file name and workflow name stay in step), got "${wf.name}"`)
    for (const k of ['id', 'active', 'versionId', 'meta', 'pinData', 'shared', 'createdAt', 'updatedAt']) {
      if (k in wf) err(file, `carries instance-specific "${k}"; strip it (pull does)`)
    }

    const nodes = wf.nodes ?? []
    const names = new Set()
    for (const n of nodes) {
      if (names.has(n.name)) err(file, `duplicate node name "${n.name}"`)
      names.add(n.name)
      if (isSticky(n)) continue
      const env = JSON.stringify(n.parameters ?? {}).match(/\$env\.[A-Za-z_]+/g)
      if (env) err(file, `node "${n.name}" reads ${[...new Set(env)].join(', ')}; n8n 2.x blocks $env (silently, at run time). Use a credential or a literal.`)
      for (const [type, ref] of Object.entries(n.credentials ?? {})) {
        const extra = Object.keys(ref ?? {}).filter((k) => k !== 'id' && k !== 'name')
        if (extra.length) err(file, `node "${n.name}" credential ${type} carries ${extra.join(', ')}; only id + name belong in git`)
        const def = CREDS[ref?.id]
        if (!def) err(file, `node "${n.name}" credential ${type} has id "${ref?.id}"; git holds placeholders only (${Object.keys(CREDS).join(', ')})`)
        else if (def.type !== type || def.name !== ref.name) err(file, `node "${n.name}" credential ${ref.id} must be ${def.type} "${def.name}", got ${type} "${ref.name}"`)
      }
      for (const m of JSON.stringify(n.parameters ?? {}).matchAll(/https:\/\/([a-z0-9]+)\.supabase\.co/g)) {
        if (`https://${m[1]}.supabase.co` !== SUPABASE_URL) err(file, `node "${n.name}" calls Supabase project ${m[1]}, not DeskDev's (${SUPABASE_URL})`)
      }
      // A *.pages.dev name nobody holds can be registered by anyone: a link to one in a
      // company email is a phishing lure. DeskDev lives at APP_URL.
      for (const m of JSON.stringify(n.parameters ?? {}).matchAll(/[a-z0-9-]+\.pages\.dev/gi)) {
        err(file, `node "${n.name}" links to ${m[0]}; link to ${APP_URL} instead`)
      }
      // A literal recipient goes stale when people change roles or leave, and it was a
      // personal inbox in five workflows. Recipients are read from profiles (or the record).
      if (n.type === 'n8n-nodes-base.gmail' && typeof n.parameters?.sendTo === 'string' && !n.parameters.sendTo.startsWith('=')) {
        err(file, `Gmail node "${n.name}" sends to a literal address; compute sendTo from profiles (see the Recipients nodes)`)
      }
      // Sheets appends default to USER_ENTERED (node 4.1+), which runs "=…" cells as formulas.
      if (n.type === 'n8n-nodes-base.googleSheets' && n.parameters?.operation === 'append' && n.parameters?.options?.cellFormat !== 'RAW') {
        err(file, `Sheets node "${n.name}" must set options.cellFormat "RAW" (user text starting with = would run as a formula)`)
      }
    }
    for (const [from, out] of Object.entries(wf.connections ?? {})) {
      if (!names.has(from)) err(file, `connection from missing node "${from}"`)
      for (const branch of out.main ?? []) for (const c of branch ?? []) if (!names.has(c.node)) err(file, `connection to missing node "${c.node}"`)
    }

    const s = wf.settings ?? {}
    if (s.timezone !== TIMEZONE) err(file, `settings.timezone must be ${TIMEZONE}`)
    if (s.executionOrder !== 'v1') err(file, 'settings.executionOrder must be v1 (the Log run branch relies on it)')
    if (slug === ERROR_HANDLER) {
      if (s.errorWorkflow) err(file, 'the error handler must not name an error workflow')
      if (!nodes.some((n) => n.type === 'n8n-nodes-base.errorTrigger')) err(file, 'needs an Error Trigger')
    } else if (s.errorWorkflow !== ERROR_WORKFLOW_PH) {
      err(file, `settings.errorWorkflow must be ${ERROR_WORKFLOW_PH} (push swaps in the live id)`)
    }

    for (const n of nodes.filter(isWebhook)) {
      const p = n.parameters ?? {}
      if (p.authentication !== 'headerAuth' || n.credentials?.httpHeaderAuth?.name !== WEBHOOK_CRED.name) {
        err(file, `webhook "${n.name}" must use Header Auth with the "${WEBHOOK_CRED.name}" credential`)
      }
      const key = `${p.httpMethod ?? 'GET'} ${p.path}`
      if (paths.has(key)) err(file, `webhook ${key} is also served by ${paths.get(key)}`)
      paths.set(key, file)
    }

    if (nodes.some(isSchedule)) {
      const log = nodes.find((n) => n.name === 'Log run')
      const body = log?.parameters?.jsonBody ?? ''
      if (!log || !String(log.parameters?.url).endsWith('/rest/v1/automation_runs')) {
        err(file, 'scheduled workflow without a "Log run" node writing to automation_runs; without it the health view reports it stale')
      } else {
        if (!body.includes(`job: '${slug}'`)) err(file, `"Log run" must log job '${slug}'`)
        if (!log.executeOnce) err(file, '"Log run" must have executeOnce (one row per execution, not per item)')
      }
      if (jobs && !jobs.some((j) => j.job === slug)) err(file, `scheduled job "${slug}" is not seeded in automation_jobs (no supabase/migrations/*.sql inserts it)`)
    }
  }

  if (jobs) {
    for (const j of jobs) {
      const hit = all.find((g) => g.slug === j.job)
      if (!hit) errors.push(`${j.file}: automation_jobs has "${j.job}" but automation/n8n/${j.job}.json does not exist`)
      else if (hit.wf.name !== j.workflow) errors.push(`${j.file}: "${j.job}" names workflow "${j.workflow}", the file says "${hit.wf.name}"`)
    }
  }
  if (!all.some((g) => g.slug === ERROR_HANDLER)) errors.push(`automation/n8n/${ERROR_HANDLER}.json is missing`)

  if (errors.length) {
    console.error(`n8n check: ${errors.length} problem(s)\n` + errors.map((e) => `  ✗ ${e}`).join('\n'))
    process.exit(1)
  }
  console.log(`n8n check: ${all.length} workflows OK (${paths.size} signed webhooks, ${jobs?.length ?? 0} logged schedules)`)
}

// ---------------------------------------------------------------------------
// live API

function env() {
  loadEnv()
  const base = (process.env.N8N_BASE_URL || 'https://nixgen-n8n-8gp7.onrender.com').replace(/\/+$/, '')
  const key = process.env.N8N_API_KEY
  if (!key) {
    console.error('N8N_API_KEY is not set. Put it in .env.local at the repo root, the single env file (n8n → Settings → n8n API).')
    process.exit(2)
  }
  return { base, key }
}

/** An n8n API key is a JWT; its iat says which instance build issued it. */
function describeKey(key) {
  try {
    const p = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'))
    return p.iat ? `issued ${new Date(p.iat * 1000).toISOString()}` : 'no iat claim'
  } catch {
    return 'not a JWT'
  }
}

function httpError(message, status) {
  const e = new Error(message)
  e.status = status
  return e
}

async function api(method, route, body) {
  const { base, key } = env()
  const url = `${base}/api/v1${route}`
  // Render's free tier can take ~50 s to wake; GETs get one retry.
  for (let attempt = 1; ; attempt++) {
    let res
    try {
      res = await fetch(url, {
        method,
        headers: { 'X-N8N-API-KEY': key, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(90_000),
      })
    } catch (e) {
      if (method === 'GET' && attempt < 2) continue
      throw new Error(`${method} ${route}: ${e.message}`)
    }
    const type = res.headers.get('content-type') ?? ''
    // While n8n boots, EVERY route answers 200 text/html "n8n is starting up".
    if (res.ok && !type.includes('json')) {
      if (method === 'GET' && attempt < 2) {
        await new Promise((r) => setTimeout(r, 15_000))
        continue
      }
      throw new Error(`${method} ${route}: got ${type || 'no content type'} instead of JSON; the instance is probably still starting`)
    }
    if (res.status === 401) throw httpError(`401 from ${base}. The API key (${describeKey(key)}) belongs to another instance or was revoked; n8n keys never expire on their own.`, 401)
    if ([502, 503, 504].includes(res.status) && method === 'GET' && attempt < 2) continue
    const text = await res.text()
    if (!res.ok) throw httpError(`${method} ${route}: ${res.status} ${text.slice(0, 300)}`, res.status)
    return text ? JSON.parse(text) : null
  }
}

async function paged(route) {
  const out = []
  let cursor
  do {
    const sep = route.includes('?') ? '&' : '?'
    const page = await api('GET', `${route}${sep}limit=250${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
    out.push(...(page.data ?? []))
    cursor = page.nextCursor
  } while (cursor)
  return out
}

async function liveWorkflows() {
  return (await paged('/workflows')).filter((w) => w.name.startsWith(PREFIX))
}

/** null when this n8n cannot list credentials (older public API, or a non-owner key). */
async function liveCredentials() {
  try {
    return await paged('/credentials')
  } catch (e) {
    if ([403, 404, 405].includes(e.status)) return null
    throw e
  }
}

// ---------------------------------------------------------------------------
// diffing (what changed, by node name, ignoring layout and instance ids)

function nodeShape(n) {
  const creds = Object.fromEntries(Object.entries(n.credentials ?? {}).map(([t, r]) => [t, r?.name]))
  return { type: n.type, typeVersion: n.typeVersion, parameters: n.parameters ?? {}, credentials: creds, disabled: !!n.disabled, executeOnce: !!n.executeOnce, alwaysOutputData: !!n.alwaysOutputData, onError: n.onError ?? null }
}

function diff(gitWf, liveWf) {
  const lines = []
  const gitNodes = new Map(gitWf.nodes.map((n) => [n.name, n]))
  const liveNodes = new Map(liveWf.nodes.map((n) => [n.name, n]))
  for (const [name, n] of gitNodes) {
    const l = liveNodes.get(name)
    if (!l) {
      lines.push(`+ ${name}`)
      continue
    }
    const a = nodeShape(n)
    const b = nodeShape(l)
    const changed = Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    if (changed.includes('parameters')) {
      const pk = [...new Set([...Object.keys(a.parameters), ...Object.keys(b.parameters)])].filter((k) => JSON.stringify(a.parameters[k]) !== JSON.stringify(b.parameters[k]))
      changed.splice(changed.indexOf('parameters'), 1, `parameters.{${pk.join(',')}}`)
    }
    if (changed.length) lines.push(`~ ${name}: ${changed.join(', ')}`)
  }
  for (const name of liveNodes.keys()) if (!gitNodes.has(name)) lines.push(`- ${name} (live only)`)
  const conn = (w) => JSON.stringify(Object.entries(w.connections ?? {}).sort(([x], [y]) => x.localeCompare(y)))
  if (conn(gitWf) !== conn(liveWf)) lines.push('~ connections')
  const s = (w) => JSON.stringify({ timezone: w.settings?.timezone ?? null, executionOrder: w.settings?.executionOrder ?? null, errorWorkflow: w.settings?.errorWorkflow ? 'set' : null })
  if (s(gitWf) !== s(liveWf)) lines.push(`~ settings: git ${s(gitWf)} live ${s(liveWf)}`)
  return lines
}

/** Live → git shape: strip instance metadata, put the placeholders back. */
function toGitShape(live, errorHandlerId) {
  const nodes = live.nodes.map((n) => {
    const out = {}
    for (const k of NODE_KEYS) if (k in n) out[k] = clone(n[k])
    for (const [type, ref] of Object.entries(out.credentials ?? {})) {
      const ph = Object.keys(CREDS).find((p) => CREDS[p].type === type && CREDS[p].name === ref?.name)
      // An unmanaged credential keeps its live id; `check` then names it.
      out.credentials[type] = { id: ph ?? ref.id, name: ref.name }
    }
    return out
  })
  const settings = {}
  for (const k of SETTINGS_KEYS) if (live.settings && k in live.settings) settings[k] = live.settings[k]
  if (settings.errorWorkflow && settings.errorWorkflow === errorHandlerId) settings.errorWorkflow = ERROR_WORKFLOW_PH
  return { name: live.name, nodes, connections: live.connections ?? {}, settings }
}

// ---------------------------------------------------------------------------
// credentials

/** Required fields the instance's schema expects but our data omits get the schema's defaults. */
async function credentialData(type, data) {
  let schema = null
  try {
    schema = await api('GET', `/credentials/schema/${type}`)
  } catch (e) {
    if (e.status !== 404) throw e
  }
  const out = { ...data }
  const missing = []
  for (const k of schema?.required ?? []) {
    if (k in out) continue
    const def = schema.properties?.[k]?.default
    if (def !== undefined) out[k] = def
    else missing.push(k)
  }
  if (missing.length) throw new Error(`credential type ${type} also requires ${missing.join(', ')}; create it in the n8n UI and pass its id`)
  return out
}

/**
 * placeholder → { id, how } for every placeholder the given workflows use.
 * Unresolved owned credentials make their workflows skip; unresolved OAuth
 * ones are handled per node in materialize().
 */
async function resolveCredentials(git, apply) {
  const used = new Set(git.flatMap((g) => Object.keys(CREDS).filter((ph) => g.raw.includes(ph))))
  const resolved = {}
  let listed
  for (const ph of used) {
    const c = CREDS[ph]
    const pinned = flag(c.flag)
    if (typeof pinned === 'string') {
      resolved[ph] = { id: pinned, how: `--${c.flag}` }
      continue
    }
    if (listed === undefined) listed = await liveCredentials()
    const matches = (listed ?? []).filter((x) => x.type === c.type && x.name === c.name)
    if (matches.length) {
      if (matches.length > 1) console.log(`! ${matches.length} credentials named "${c.name}" (${c.type}); using ${matches[0].id}. Pass --${c.flag} to choose.`)
      resolved[ph] = { id: matches[0].id, how: 'found by name' }
      continue
    }
    if (c.oauth) {
      resolved[ph] = { id: null, how: `not on the instance yet: create "${c.name}" (${c.type}) in the n8n UI, or pass --${c.flag}` }
      continue
    }
    const value = process.env[c.env]
    if (!value) {
      resolved[ph] = { id: null, how: `missing: set ${c.env} to create it${listed === null ? `, or pass --${c.flag} (this n8n cannot list credentials)` : ''}` }
      continue
    }
    if (!apply) {
      resolved[ph] = { id: '(created on --apply)', how: `would be created from ${c.env}` }
      continue
    }
    const made = await api('POST', '/credentials', { name: c.name, type: c.type, data: await credentialData(c.type, c.data(value)) })
    resolved[ph] = { id: made.id, how: `created from ${c.env}` }
  }
  // undefined = never needed (everything pinned by flag); null = not supported here.
  return { resolved, canList: listed !== null }
}

/**
 * Git workflow → API body. Owned placeholders must resolve or the workflow is
 * skipped. An unresolved OAuth reference keeps the live node's credential
 * when there is one (never undo a credential picked in the UI), else it is
 * left empty for the UI to fill.
 */
function materialize(wf, resolved, errorHandlerId, current) {
  const body = clone(wf)
  const notes = []
  const liveByName = new Map((current?.nodes ?? []).map((n) => [n.name, n]))
  for (const n of body.nodes) {
    for (const [type, ref] of Object.entries(n.credentials ?? {})) {
      const c = CREDS[ref.id]
      if (!c) return { skip: `node "${n.name}" references unmanaged credential id ${ref.id}` }
      const r = resolved[ref.id]
      if (r?.id) {
        n.credentials[type] = { id: r.id, name: ref.name }
        continue
      }
      if (!c.oauth) return { skip: `needs "${c.name}" (${r?.how ?? 'unresolved'})` }
      const kept = liveByName.get(n.name)?.credentials?.[type]
      if (kept) {
        n.credentials[type] = kept
        notes.push(`"${n.name}" keeps its live ${c.name}`)
      } else {
        delete n.credentials[type]
        notes.push(`"${n.name}" needs "${c.name}" selected in the UI`)
      }
    }
    if (n.credentials && !Object.keys(n.credentials).length) delete n.credentials
  }
  const settings = {}
  for (const k of SETTINGS_KEYS) if (k in (body.settings ?? {})) settings[k] = body.settings[k]
  if (settings.errorWorkflow === ERROR_WORKFLOW_PH) {
    if (!errorHandlerId) return { skip: 'the error handler does not exist yet' }
    settings.errorWorkflow = errorHandlerId
  }
  return { body: { name: body.name, nodes: body.nodes, connections: body.connections, settings }, notes }
}

// ---------------------------------------------------------------------------
// live commands

async function status() {
  const live = await liveWorkflows()
  const byName = new Map(live.map((w) => [w.name, w]))
  const errorHandler = byName.get(PREFIX + ERROR_HANDLER)
  for (const { slug, wf } of loadGit()) {
    const l = byName.get(wf.name)
    if (!l) {
      console.log(`○ ${slug.padEnd(24)} not on the instance (push --apply creates it, inactive)`)
      continue
    }
    const full = toGitShape(await api('GET', `/workflows/${l.id}`), errorHandler?.id)
    const d = diff(wf, full)
    console.log(`${l.active ? '●' : '○'} ${slug.padEnd(24)} ${l.id}  ${l.active ? 'ACTIVE  ' : 'inactive'}  updated ${l.updatedAt}  ${d.length ? `${d.length} difference(s)` : 'in sync'}`)
    for (const line of d) console.log(`      ${line}`)
  }
  const gitNames = new Set(loadGit().map((g) => g.wf.name))
  for (const l of live) if (!gitNames.has(l.name)) console.log(`? ${l.name} is live (${l.id}) but not in git; pull it`)
  console.log('\n● active  ○ inactive. "+" = in git only, "-" = live only, "~" = differs. Health of what RAN is in automation_health, not here.')
}

async function pull() {
  const write = flag('write') === true
  const live = await liveWorkflows()
  const errorHandler = live.find((w) => w.name === PREFIX + ERROR_HANDLER)
  const outDir = write ? DIR : LIVE_DIR
  fs.mkdirSync(outDir, { recursive: true })
  for (const l of live) {
    const shaped = toGitShape(await api('GET', `/workflows/${l.id}`), errorHandler?.id)
    const file = path.join(outDir, `${slugOf(l.name)}.json`)
    fs.writeFileSync(file, canonical(shaped))
    console.log(`${write ? 'wrote' : 'saved'} ${path.relative(ROOT, file)}`)
  }
  if (!write) console.log(`\nCompare: git diff --no-index automation/n8n/<name>.json automation/n8n/.live/<name>.json`)
}

/**
 * The whole shared instance, not just [deskdev]: any workflow reading $env
 * breaks while N8N_BLOCK_ENV_ACCESS_IN_NODE is true (the 2.x default), and any
 * node type missing from a NODES_INCLUDE list stops loading.
 */
async function audit() {
  const ids = (await paged('/workflows')).map((w) => w.id)
  const types = new Set()
  const envReaders = []
  let active = 0
  for (const id of ids) {
    const w = await api('GET', `/workflows/${id}`)
    if (w.active) active++
    for (const n of w.nodes ?? []) {
      types.add(n.type)
      if (isSticky(n)) continue
      const env = JSON.stringify(n.parameters ?? {}).match(/\$env\.[A-Za-z_]+/g)
      if (env) envReaders.push(`${w.active ? '●' : '○'} ${w.name} → "${n.name}" reads ${[...new Set(env)].join(', ')}`)
    }
  }
  console.log(`${ids.length} workflows on the instance, ${active} active.\n`)
  console.log(envReaders.length
    ? `Read $env (fail with "access to env vars denied" while N8N_BLOCK_ENV_ACCESS_IN_NODE=true):\n  ${envReaders.join('\n  ')}`
    : 'No workflow reads $env: N8N_BLOCK_ENV_ACCESS_IN_NODE=true is safe.')
  console.log(`\nNode types in use (a NODES_INCLUDE that omits any of these breaks that workflow):\n${JSON.stringify([...types].sort())}`)
}

async function push() {
  const apply = flag('apply') === true
  const only = typeof flag('only') === 'string' ? new Set(flag('only').split(',')) : null
  const git = loadGit().filter((g) => !only || only.has(g.slug) || g.slug === ERROR_HANDLER)
  // The error handler goes first: everyone else needs its id.
  git.sort((a, b) => (a.slug === ERROR_HANDLER ? -1 : b.slug === ERROR_HANDLER ? 1 : 0))

  const live = await liveWorkflows()
  const byName = new Map(live.map((w) => [w.name, w]))
  let errorHandlerId = byName.get(PREFIX + ERROR_HANDLER)?.id
  // A dry run on a fresh instance has no error handler id yet; --apply
  // creates it first and uses the real id for everything after.
  const plannedErrorHandler = errorHandlerId ?? (apply ? null : '(error handler id)')

  const { resolved, canList } = await resolveCredentials(git, apply)
  console.log(`credentials${canList ? '' : ' (this n8n cannot list credentials; use --*-cred-id flags)'}:`)
  for (const [ph, r] of Object.entries(resolved)) console.log(`  ${r.id ? '✓' : '·'} ${CREDS[ph].name.padEnd(24)} ${r.id ?? ''}  ${r.how}`)

  for (const { slug, wf } of git) {
    const l = byName.get(wf.name)
    const current = l ? await api('GET', `/workflows/${l.id}`) : null
    const m = materialize(wf, resolved, slug === ERROR_HANDLER ? null : errorHandlerId ?? plannedErrorHandler, current)
    if (m.skip) {
      console.log(`✗ ${slug}: skipped, ${m.skip}`)
      continue
    }

    if (l) {
      const d = diff(wf, toGitShape(current, errorHandlerId))
      if (!d.length && !m.notes.length) {
        console.log(`= ${slug}: in sync`)
        continue
      }
      console.log(`${apply ? '↻' : '~'} ${slug} (${l.id}${l.active ? ', ACTIVE: stays active' : ''})`)
      for (const line of [...d, ...m.notes.map((x) => `! ${x}`)]) console.log(`      ${line}`)
      if (!apply || !d.length) continue
      // Keep the instance's node ids and webhook ids, so production webhook
      // registrations and execution history keep pointing at the same nodes.
      const liveByName = new Map(current.nodes.map((n) => [n.name, n]))
      const nodes = m.body.nodes.map((n) => {
        const ln = liveByName.get(n.name)
        return ln ? { ...n, id: ln.id ?? n.id, ...(ln.webhookId ? { webhookId: ln.webhookId } : {}) } : n
      })
      await api('PUT', `/workflows/${l.id}`, { ...m.body, nodes })
    } else {
      console.log(`${apply ? '+' : '+ (dry run)'} ${slug}: create, inactive`)
      for (const note of m.notes) console.log(`      ! ${note}`)
      if (!apply) continue
      const made = await api('POST', '/workflows', m.body)
      byName.set(made.name, made)
      if (slug === ERROR_HANDLER) errorHandlerId = made.id
      console.log(`      id ${made.id}`)
    }
  }
  if (!apply) console.log('\nDry run. Re-run with --apply to write. Activation is never changed by this script.')
}

// ---------------------------------------------------------------------------

const commands = { check, status, pull, push, audit }
if (!commands[cmd]) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 21).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))
  process.exit(cmd === 'help' ? 0 : 2)
}
try {
  await commands[cmd]()
} catch (e) {
  console.error(`n8n ${cmd}: ${e.message}`)
  process.exit(1)
}
