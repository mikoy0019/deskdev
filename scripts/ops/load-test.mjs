#!/usr/bin/env node
// A short, rate-capped load test of the read path.
//
//   node scripts/ops/load-test.mjs                                    600 requests: 10 a second for 60 s on / and /portfolio
//   node scripts/ops/load-test.mjs --rps 5 --seconds 30 --paths home,services
//   node scripts/ops/load-test.mjs --base https://nixgensolutions.com --out result.json
//
// Rules it enforces (docs/runbooks/OPERATIONS.md, section 5):
// - GET only, and only the pages you name. It never touches /api/contact or
//   /api/subscribe: they write to the database and are throttled on purpose.
// - At most 5,000 requests a run and 50 a second. The Workers Free plan
//   allows 100,000 requests a day; do not spend them on a test.
// - An answer counts only when it is 2xx and, for a page, reaches its closing
//   </html>. A Worker stopped part-way has already sent "200".
//
// Paths are given without the leading slash (Git Bash rewrites arguments that
// start with one); `home` is the root.
//
// Exit codes: 0 every answer counted, 1 at least one did not, 2 bad arguments.

import fs from 'node:fs'
import { DEFAULT_BASE, baseUrl, judge, loadPlan, parseFlags, pathList, summarize } from './lib.mjs'

let base
let rps
let seconds
let paths
let total
let out
try {
  const flags = parseFlags(process.argv.slice(2))
  base = baseUrl(flags.base ?? DEFAULT_BASE)
  rps = Number(flags.rps ?? 10)
  seconds = Number(flags.seconds ?? 60)
  paths = pathList(flags.paths ?? 'home,portfolio')
  if (paths.some((p) => p.startsWith('/api/'))) throw new Error('this test reads pages only; /api paths are not allowed')
  total = loadPlan({ rps, seconds })
  out = flags.out
} catch (err) {
  console.error(`load-test: ${err.message}`)
  process.exit(2)
}

console.log(`load-test: ${total} GET requests, ${rps} a second for ${seconds} s, ${base} (${paths.join(', ')})`)
const records = []
const running = new Set()
async function one(index) {
  const path = paths[index % paths.length]
  const started = performance.now()
  let verdict
  try {
    const res = await fetch(base + path, { headers: { accept: 'text/html', 'user-agent': 'nixgen-load-test/1 (owner-run, read-only)' }, redirect: 'manual', signal: AbortSignal.timeout(20_000) })
    const text = await res.text()
    verdict = judge({ status: res.status, contentType: res.headers.get('content-type') ?? '', text })
  } catch (err) {
    verdict = err?.name === 'TimeoutError' ? 'timed out' : 'no answer'
  }
  records.push({ path, verdict, ms: performance.now() - started })
}

const begun = Date.now()
const gap = 1000 / rps
for (let i = 0; i < total; i++) {
  const wait = begun + i * gap - Date.now()
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  const job = one(i).finally(() => running.delete(job))
  running.add(job)
}
await Promise.all(running)

const summary = { base, at: new Date().toISOString(), rps, seconds, ...summarize(records, paths) }
console.log(JSON.stringify(summary, null, 2))
if (out) fs.writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`)
console.log(summary.failed ? `load-test: ${summary.failed} of ${summary.requests} answers did not count` : `load-test: all ${summary.requests} answers counted`)
process.exitCode = summary.failed ? 1 : 0
