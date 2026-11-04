import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  CLOUDFLARE_ACCOUNT_ID,
  DEFAULT_BASE,
  DEFAULT_PATHS,
  MAX_REQUESTS,
  SITE_WORKER,
  baseUrl,
  isCompleteHtml,
  isLimitPage,
  judge,
  loadPlan,
  microsToMs,
  normalizePath,
  parseFlags,
  pathList,
  percentile,
  summarize,
} from './lib.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..', '..')

test('the Worker name and the account are the ones the site deploys to', () => {
  const config = fs.readFileSync(path.join(repo, 'site', 'wrangler.jsonc'), 'utf8')
  assert.ok(config.includes(`"account_id": "${CLOUDFLARE_ACCOUNT_ID}"`), 'account id differs from site/wrangler.jsonc')
  assert.ok(config.includes(`"name": "${SITE_WORKER}"`), 'Worker name differs from site/wrangler.jsonc')
  assert.equal(DEFAULT_BASE, `https://${SITE_WORKER}.nixgensolutions.workers.dev`)
})

test('parseFlags reads values, switches and the rest', () => {
  assert.deepEqual(parseFlags(['--rps', '5', 'home', '--keep', 'portfolio'], ['keep']), { _: ['home', 'portfolio'], rps: '5', keep: true })
  assert.throws(() => parseFlags(['--rps']), /--rps needs a value/)
  assert.throws(() => parseFlags(['--rps', '--seconds', '3']), /--rps needs a value/)
})

test('normalizePath takes words, slashes and what Git Bash makes of a slash', () => {
  assert.equal(normalizePath('home'), '/')
  assert.equal(normalizePath('/'), '/')
  assert.equal(normalizePath('portfolio'), '/portfolio')
  assert.equal(normalizePath('/workspace/login'), '/workspace/login')
  assert.equal(normalizePath('workspace/login'), '/workspace/login')
  // `/portfolio` typed in Git Bash on Windows arrives like this.
  assert.equal(normalizePath('C:/Program Files/Git/portfolio'), '/portfolio')
  assert.equal(normalizePath('C:/Program Files/Git/'), '/')
  assert.equal(normalizePath('C:\\Program Files\\Git\\workspace\\login'), '/workspace/login')
})

test('pathList splits, normalizes and drops repeats', () => {
  assert.deepEqual(pathList('home,portfolio,/portfolio, services ,'), ['/', '/portfolio', '/services'])
  assert.deepEqual(pathList(['home', 'about']), ['/', '/about'])
  assert.ok(DEFAULT_PATHS.includes('/workspace/login') && DEFAULT_PATHS[0] === '/')
})

test('baseUrl keeps the origin and refuses what is not one', () => {
  assert.equal(baseUrl('https://nixgensolutions.com/some/path?x=1'), 'https://nixgensolutions.com')
  assert.equal(baseUrl('http://localhost:4173/'), 'http://localhost:4173')
  assert.throws(() => baseUrl('nixgensolutions.com'), /not a URL/)
  assert.throws(() => baseUrl('ftp://example.com'), /not an http/)
})

test('a page counts only when it is 2xx and reaches its end', () => {
  const whole = '<!doctype html><html><body>hi</body></html>'
  const cut = '<!doctype html><html><body>hi <div class="nx-wrap'
  const limit = '<html><body><h1>Error 1102</h1> Worker exceeded resource limits <span>error code: 1102</span></body></html>'
  assert.equal(isCompleteHtml(whole), true)
  assert.equal(isCompleteHtml(`${whole}\n`), true)
  assert.equal(isCompleteHtml(cut), false)
  assert.equal(isLimitPage(limit), true)
  assert.equal(isLimitPage(whole), false)

  assert.equal(judge({ status: 200, contentType: 'text/html; charset=utf-8', text: whole }), 'ok')
  // The case a status check misses: 200, but the page stops half-way.
  assert.equal(judge({ status: 200, contentType: 'text/html; charset=utf-8', text: cut }), 'cut off')
  assert.equal(judge({ status: 503, contentType: 'text/html', text: limit }), 'limit')
  assert.equal(judge({ status: 404, contentType: 'text/html', text: whole }), 'http 404')
  assert.equal(judge({ status: 500, contentType: 'text/plain', text: '' }), 'http 500')
  // Not a page: nothing to close.
  assert.equal(judge({ status: 200, contentType: 'application/json', text: '{"ok":true}' }), 'ok')
  assert.equal(judge({ status: 204, text: '' }), 'ok')
})

test('percentile', () => {
  assert.equal(percentile([], 0.5), null)
  assert.equal(percentile([10], 0.99), 10)
  assert.equal(percentile([5, 1, 3, 2, 4], 0.5), 3)
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95), 10)
  assert.equal(percentile([1.4, 1.6], 0), 1)
})

test('loadPlan keeps a run small', () => {
  assert.equal(loadPlan({ rps: 10, seconds: 60 }), 600)
  assert.equal(loadPlan({ rps: 50, seconds: 100 }), MAX_REQUESTS)
  assert.throws(() => loadPlan({ rps: 50, seconds: 101 }), /at most 5000/)
  assert.throws(() => loadPlan({ rps: 51, seconds: 1 }), /--rps/)
  assert.throws(() => loadPlan({ rps: 0, seconds: 10 }), /--rps/)
  assert.throws(() => loadPlan({ rps: 1.5, seconds: 10 }), /--rps/)
  assert.throws(() => loadPlan({ rps: 1, seconds: 601 }), /--seconds/)
  assert.throws(() => loadPlan({ rps: NaN, seconds: 10 }), /--rps/)
})

test('summarize counts only whole answers and times only those', () => {
  const records = [
    { path: '/', verdict: 'ok', ms: 100 },
    { path: '/', verdict: 'ok', ms: 300 },
    { path: '/', verdict: 'cut off', ms: 20 },
    { path: '/portfolio', verdict: 'limit', ms: 40 },
    { path: '/portfolio', verdict: 'ok', ms: 200 },
  ]
  const s = summarize(records, ['/', '/portfolio'])
  assert.equal(s.requests, 5)
  assert.equal(s.ok, 3)
  assert.equal(s.failed, 2)
  assert.deepEqual(s.verdicts, { ok: 3, 'cut off': 1, limit: 1 })
  assert.equal(s.p50_ms, 200)
  assert.deepEqual(s.per_path['/'], { requests: 3, ok: 2, p50_ms: 300, p95_ms: 300 })
  assert.deepEqual(s.per_path['/portfolio'], { requests: 2, ok: 1, p50_ms: 200, p95_ms: 200 })
  assert.equal(summarize([], ['/']).p50_ms, null)
})

test('microsToMs', () => {
  assert.equal(microsToMs(34_812), 34.8)
  assert.equal(microsToMs(10_000), 10)
  assert.equal(microsToMs(null), null)
})

test('the commands refuse bad arguments before sending anything', () => {
  const run = (script, args) => spawnSync(process.execPath, [path.join(here, script), ...args], { encoding: 'utf8', timeout: 20_000 })
  let r = run('load-test.mjs', ['--rps', '100'])
  assert.equal(r.status, 2)
  assert.match(r.stderr, /--rps must be/)
  r = run('load-test.mjs', ['--paths', 'api/contact'])
  assert.equal(r.status, 2)
  assert.match(r.stderr, /pages only/)
  r = run('load-test.mjs', ['--base', 'not-a-url'])
  assert.equal(r.status, 2)
  r = run('page-check.mjs', ['--times', '0'])
  assert.equal(r.status, 2)
  r = run('worker-metrics.mjs', ['--minutes', 'soon'])
  assert.equal(r.status, 2)
  r = run('worker-metrics.mjs', ['--worker', 'Not A Name'])
  assert.equal(r.status, 2)
})
