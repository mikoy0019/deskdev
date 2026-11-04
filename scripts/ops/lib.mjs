// Pure helpers for the ops scripts in this folder (page-check, load-test,
// worker-metrics). No I/O here, so ops.test.mjs can test all of it.

import { WORKERS_DEV_ORIGIN } from '../lib/integrations.mjs'

/** The address the scripts check when none is given: the site Worker before the domain is attached. */
export const DEFAULT_BASE = WORKERS_DEV_ORIGIN

/** The Worker and the account site/wrangler.jsonc deploys to (ops.test.mjs compares). */
export const SITE_WORKER = 'nixgen-site'
export const CLOUDFLARE_ACCOUNT_ID = '5c6cabb0e7c2e306c3dd792599736a46'

/** The site's pages and DeskDev's entry: what "is everything up?" means. */
export const DEFAULT_PATHS = ['/', '/services', '/about', '/portfolio', '/process', '/contact', '/templates', '/privacy', '/terms', '/login', '/workspace/login']

/** One run may not send more than this: the Workers Free plan allows 100,000 requests a day. */
export const MAX_REQUESTS = 5000

/**
 * `--name value` and `--flag` into an object, the rest into `_`.
 * `booleans` names the flags that take no value.
 */
export function parseFlags(argv, booleans = []) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) { out._.push(arg); continue }
    const name = arg.slice(2)
    if (booleans.includes(name)) { out[name] = true; continue }
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value`)
    out[name] = value
    i++
  }
  return out
}

/**
 * A path as the site knows it. `home` is the root. Git Bash on Windows turns
 * an argument like `/portfolio` into `C:/Program Files/Git/portfolio` before
 * Node sees it, so that form is taken back to the path it was.
 */
export function normalizePath(arg) {
  let value = String(arg).trim()
  const mangled = /^[A-Za-z]:[\\/].*?[\\/]Git[\\/]?(.*)$/.exec(value)
  if (mangled) value = mangled[1].replace(/\\/g, '/')
  if (value === '' || value === 'home' || value === '/') return '/'
  return value.startsWith('/') ? value : `/${value}`
}

/** A comma list (or an array) of paths, normalized, without duplicates. */
export function pathList(input) {
  const parts = Array.isArray(input) ? input : String(input).split(',')
  return [...new Set(parts.filter((p) => String(p).trim() !== '').map(normalizePath))]
}

/** An absolute http(s) origin without a trailing slash, or an error that says what was wrong. */
export function baseUrl(value) {
  let url
  try { url = new URL(String(value)) } catch { throw new Error(`not a URL: ${value}`) }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`not an http(s) URL: ${value}`)
  return url.origin
}

/**
 * True when an HTML document reached its end. A Worker that is stopped
 * mid-stream has already sent status 200, so the status says nothing: only
 * the closing tag does.
 */
export function isCompleteHtml(text) {
  return /<\/html>\s*$/i.test(text) || text.includes('</html>')
}

/** Cloudflare's own page for a Worker that ran past its limits (error 1102). */
export function isLimitPage(text) {
  return /error code: 1102|Worker exceeded resource limits/i.test(String(text).slice(0, 6000))
}

/** What one answer was: `ok`, or the reason it does not count. */
export function judge({ status, contentType = '', text = '' }) {
  if (isLimitPage(text)) return 'limit'
  if (status < 200 || status >= 300) return `http ${status}`
  if (contentType.includes('text/html') && !isCompleteHtml(text)) return 'cut off'
  return 'ok'
}

/** The value at quantile q (0..1) of a list of numbers, rounded; null for an empty list. */
export function percentile(values, q) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))])
}

/** Checks a load plan against the caps and returns the number of requests it sends. */
export function loadPlan({ rps, seconds }, max = MAX_REQUESTS) {
  if (!Number.isInteger(rps) || rps < 1 || rps > 50) throw new Error('--rps must be a whole number from 1 to 50')
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 600) throw new Error('--seconds must be a whole number from 1 to 600')
  const total = rps * seconds
  if (total > max) throw new Error(`that is ${total} requests; one run sends at most ${max}`)
  return total
}

/** The numbers a load test reports, from its per-request records `{ path, verdict, ms }`. */
export function summarize(records, paths) {
  const verdicts = {}
  for (const r of records) verdicts[r.verdict] = (verdicts[r.verdict] ?? 0) + 1
  const ok = records.filter((r) => r.verdict === 'ok')
  const perPath = {}
  for (const p of paths) {
    const rows = records.filter((r) => r.path === p)
    const good = rows.filter((r) => r.verdict === 'ok')
    perPath[p] = { requests: rows.length, ok: good.length, p50_ms: percentile(good.map((r) => r.ms), 0.5), p95_ms: percentile(good.map((r) => r.ms), 0.95) }
  }
  return {
    requests: records.length,
    ok: ok.length,
    failed: records.length - ok.length,
    verdicts,
    p50_ms: percentile(ok.map((r) => r.ms), 0.5),
    p95_ms: percentile(ok.map((r) => r.ms), 0.95),
    p99_ms: percentile(ok.map((r) => r.ms), 0.99),
    per_path: perPath,
  }
}

/** Microseconds (what Cloudflare's analytics return for CPU time) as milliseconds with one decimal. */
export function microsToMs(value) {
  return value === null || value === undefined ? null : Math.round(value / 100) / 10
}
