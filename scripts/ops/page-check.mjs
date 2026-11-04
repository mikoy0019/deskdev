#!/usr/bin/env node
// Is every page answering, and answering in full?
//
//   node scripts/ops/page-check.mjs                         the site's pages on the workers.dev address, 3 times each
//   node scripts/ops/page-check.mjs --base https://nixgensolutions.com
//   node scripts/ops/page-check.mjs --times 6 home portfolio workspace/login
//
// A page counts only when it has status 2xx AND reaches its closing </html>.
// A Worker that is stopped part-way (Cloudflare error 1102, the plan's
// processor-time limit) has already sent "200", so a status check alone calls
// a half page healthy; this does not. docs/runbooks/OPERATIONS.md, section 1.
//
// GET only. Paths are given without the leading slash (Git Bash rewrites
// arguments that start with one); `home` is the root.
//
// Exit codes: 0 every answer was whole, 1 at least one was not, 2 bad arguments.

import { DEFAULT_BASE, DEFAULT_PATHS, baseUrl, judge, parseFlags, pathList } from './lib.mjs'

let base
let times
let paths
try {
  const flags = parseFlags(process.argv.slice(2))
  base = baseUrl(flags.base ?? DEFAULT_BASE)
  times = Number(flags.times ?? 3)
  if (!Number.isInteger(times) || times < 1 || times > 20) throw new Error('--times must be a whole number from 1 to 20')
  paths = flags._.length ? pathList(flags._) : DEFAULT_PATHS
} catch (err) {
  console.error(`page-check: ${err.message}`)
  process.exit(2)
}

console.log(`page-check: ${base}, ${paths.length} page(s), ${times} time(s) each`)
let bad = 0
for (const path of paths) {
  const seen = []
  for (let i = 0; i < times; i++) {
    const started = performance.now()
    let verdict
    let cache = ''
    try {
      const res = await fetch(base + path, { headers: { accept: 'text/html' }, redirect: 'manual', signal: AbortSignal.timeout(30_000) })
      const text = await res.text()
      verdict = judge({ status: res.status, contentType: res.headers.get('content-type') ?? '', text })
      cache = res.headers.get('x-opennext-cache') ?? res.headers.get('x-nextjs-cache') ?? ''
    } catch (err) {
      verdict = err?.name === 'TimeoutError' ? 'timed out' : 'no answer'
    }
    seen.push({ verdict, cache, ms: Math.round(performance.now() - started) })
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  const failed = seen.filter((s) => s.verdict !== 'ok')
  bad += failed.length
  const counts = {}
  for (const s of seen) counts[s.verdict] = (counts[s.verdict] ?? 0) + 1
  const summary = Object.entries(counts).map(([verdict, n]) => `${verdict} x${n}`).join(', ')
  const hits = seen.filter((s) => s.cache === 'HIT').length
  console.log(`  ${failed.length ? 'FAIL' : 'ok  '} ${path.padEnd(20)} ${summary.padEnd(28)} ${String(Math.min(...seen.map((s) => s.ms))).padStart(5)} to ${String(Math.max(...seen.map((s) => s.ms))).padStart(5)} ms${hits ? `, ${hits} from the page cache` : ''}`)
}
console.log(bad ? `page-check: ${bad} answer(s) were not whole` : 'page-check: every answer was whole')
process.exitCode = bad ? 1 : 0
