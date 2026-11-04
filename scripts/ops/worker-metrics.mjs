#!/usr/bin/env node
// The site Worker's own numbers from Cloudflare: requests by outcome and the
// processor time they used. Read-only.
//
//   node scripts/ops/worker-metrics.mjs                 the last 60 minutes of nixgen-site
//   node scripts/ops/worker-metrics.mjs --minutes 1440  the last day
//   node scripts/ops/worker-metrics.mjs --worker nixgen-site-preview
//
// What to look for (docs/runbooks/OPERATIONS.md):
// - an "exceededResources" line: Cloudflare stopped those requests for using
//   more processor time than the plan allows (10 ms a request on Workers
//   Free). Visitors get error 1102 or a page that stops half-way.
// - the processor time of the "success" line against that limit.
//
// Needs CLOUDFLARE_API_TOKEN in the env file (.env.local at the repo root),
// with read access to account analytics. The token is never printed.
//
// Exit codes: 0 read, 1 Cloudflare refused or could not be reached, 2 bad arguments.

import { loadEnv } from '../lib/env.mjs'
import { CLOUDFLARE_ACCOUNT_ID, SITE_WORKER, microsToMs, parseFlags } from './lib.mjs'

let minutes
let worker
try {
  const flags = parseFlags(process.argv.slice(2))
  minutes = Number(flags.minutes ?? 60)
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 43_200) throw new Error('--minutes must be a whole number from 1 to 43200')
  worker = flags.worker ?? SITE_WORKER
  if (!/^[a-z0-9-]{1,63}$/.test(worker)) throw new Error('--worker is a Worker name')
} catch (err) {
  console.error(`worker-metrics: ${err.message}`)
  process.exit(2)
}

loadEnv({ warn: () => {} })
const token = process.env.CLOUDFLARE_API_TOKEN
if (!token) {
  console.error('worker-metrics: CLOUDFLARE_API_TOKEN is not in the env file')
  process.exit(1)
}

const until = new Date()
const since = new Date(until.getTime() - minutes * 60_000)
const query = `query ($account: String!, $worker: String!, $since: Time!, $until: Time!) {
  viewer { accounts(filter: { accountTag: $account }) {
    workersInvocationsAdaptive(limit: 100, filter: { scriptName: $worker, datetime_geq: $since, datetime_leq: $until }) {
      sum { requests errors subrequests }
      quantiles { cpuTimeP50 cpuTimeP75 cpuTimeP99 }
      dimensions { status }
    }
  } }
}`

let rows
try {
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: { account: CLOUDFLARE_ACCOUNT_ID, worker, since: since.toISOString(), until: until.toISOString() } }),
    signal: AbortSignal.timeout(30_000),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || !body || body.errors) {
    const why = body?.errors ? body.errors.map((e) => e.message).join('; ') : `HTTP ${res.status}`
    console.error(`worker-metrics: Cloudflare said: ${String(why).slice(0, 300)}`)
    process.exit(1)
  }
  rows = body.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? []
} catch (err) {
  console.error(`worker-metrics: could not reach Cloudflare (${err?.name ?? 'error'})`)
  process.exit(1)
}

console.log(`worker-metrics: ${worker}, last ${minutes} min`)
if (!rows.length) console.log('  no requests in that time (the numbers can lag a few minutes)')
let total = 0
for (const row of rows.sort((a, b) => b.sum.requests - a.sum.requests)) {
  total += row.sum.requests
  const q = row.quantiles
  console.log(`  ${String(row.dimensions.status).padEnd(20)} ${String(row.sum.requests).padStart(7)} requests   processor time: median ${microsToMs(q.cpuTimeP50)} ms, 75% under ${microsToMs(q.cpuTimeP75)} ms, 99% under ${microsToMs(q.cpuTimeP99)} ms`)
}
if (rows.length) console.log(`  total ${total}`)
if (rows.some((r) => r.dimensions.status === 'exceededResources')) {
  console.log('  "exceededResources" means the plan\'s processor-time limit stopped those requests (docs/runbooks/OPERATIONS.md).')
}
