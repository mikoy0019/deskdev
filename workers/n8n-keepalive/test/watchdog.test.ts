// Run: npm test (node --experimental-strip-types --test "test/*.test.ts").
// No network: every fetch is a stub, KV is a Map.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildProbes, DEFAULT_REST_PROBE } from '../src/config.ts'
import { runProbe } from '../src/probes.ts'
import { evaluate, step, undeliver, statelessWindowOpen, STATE_KEY } from '../src/state.ts'
import { buildPayload } from '../src/alert.ts'
import worker, { runWatchdog } from '../src/index.ts'

const ANON = 'anon-key-SHOULD-NOT-LEAK'
const HOOK_SECRET = 'hook-secret-SHOULD-NOT-LEAK'
const RESEND_KEY = 're_SHOULD_NOT_LEAK'

const FULL_ENV = {
  SITE_URL: 'https://site.test/',
  WORKSPACE_URL: 'https://workspace.site.test/',
  SUPABASE_URL: 'https://ref.supabase.co',
  SUPABASE_REST_PROBE: '/rest/v1/showcase_items?select=slug&limit=1',
  N8N_HEALTH_URL: 'https://n8n.test/healthz',
  N8N_ALERT_URL: 'https://n8n.test/webhook/deskdev-ops-alert',
  ALERT_AFTER_FAILURES: '2',
  REALERT_MINUTES: '60',
  SUPABASE_ANON_KEY: ANON,
  N8N_WEBHOOK_SECRET: HOOK_SECRET,
}

// Silence the JSON log lines during tests.
for (const k of ['log', 'warn', 'error']) (console as any)[k] = () => {}

type Call = { url: string; init?: RequestInit }

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return handler(url, init)
  }
  return { fn, calls }
}

function kv() {
  const m = new Map<string, string>()
  let writes = 0
  return {
    map: m,
    get writes() { return writes },
    async get(k: string) { return m.has(k) ? m.get(k)! : null },
    async put(k: string, v: string) { writes++; m.set(k, v) },
  }
}

const ok = () => new Response('ok', { status: 200 })
const down = () => new Response('bad gateway', { status: 502 })

function headersOf(init?: RequestInit): Record<string, string> {
  return Object.fromEntries(new Headers(init?.headers as HeadersInit).entries())
}

// ---------- config ----------

test('buildProbes: all four probes from a full env', () => {
  const p = buildProbes(FULL_ENV)
  assert.deepEqual(p.map((x) => [x.name, x.skip ?? null, x.checks.length]), [
    ['site', null, 1], ['workspace', null, 1], ['supabase', null, 2], ['n8n', null, 1],
  ])
  const sb = p.find((x) => x.name === 'supabase')!
  assert.equal(sb.checks[0].url, 'https://ref.supabase.co/auth/v1/health')
  assert.equal(sb.checks[1].url, 'https://ref.supabase.co/rest/v1/showcase_items?select=slug&limit=1')
  // the key travels in headers, never in the URL
  for (const c of sb.checks) assert.ok(!c.url.includes(ANON))
  assert.equal(sb.checks[0].headers!.apikey, ANON)
  assert.equal(p.find((x) => x.name === 'n8n')!.timeoutMs, 55_000)
})

test('buildProbes: empty, http and keyless settings skip instead of failing', () => {
  const p = buildProbes({ SITE_URL: '', WORKSPACE_URL: 'http://plain.test/', SUPABASE_URL: 'https://ref.supabase.co', N8N_HEALTH_URL: 'nonsense' })
  const skip = Object.fromEntries(p.map((x) => [x.name, x.skip]))
  assert.match(skip.site!, /SITE_URL/)
  assert.match(skip.workspace!, /WORKSPACE_URL/)
  assert.match(skip.supabase!, /SUPABASE_ANON_KEY/)
  assert.match(skip.n8n!, /N8N_HEALTH_URL/)
})

test('buildProbes: a REST probe outside /rest/v1/ falls back to the default', () => {
  const p = buildProbes({ ...FULL_ENV, SUPABASE_REST_PROBE: 'https://evil.test/x' })
  assert.equal(p.find((x) => x.name === 'supabase')!.checks[1].url, `https://ref.supabase.co${DEFAULT_REST_PROBE}`)
})

// ---------- probes ----------

test('runProbe: a failure is retried once and a pass on retry is ok', async () => {
  let n = 0
  const f = stubFetch(() => (++n === 1 ? down() : ok()))
  const r = await runProbe({ name: 'site', checks: [{ url: 'https://site.test/' }], timeoutMs: 1000 }, f.fn)
  assert.equal(r.ok, true)
  assert.equal(r.attempts, 2)
  assert.equal(r.detail, 'ok on retry')
})

test('runProbe: two failures = failed, with status and detail', async () => {
  const f = stubFetch(down)
  const r = await runProbe({ name: 'site', checks: [{ url: 'https://site.test/' }], timeoutMs: 1000 }, f.fn)
  assert.equal(r.ok, false)
  assert.equal(r.status, 502)
  assert.equal(f.calls.length, 2)
})

test('runProbe: a network error and a timeout are failures, not throws', async () => {
  const boom = stubFetch(() => { throw new TypeError('connect ECONNREFUSED') })
  const r1 = await runProbe({ name: 'n8n', checks: [{ url: 'https://n8n.test/healthz' }], timeoutMs: 1000 }, boom.fn)
  assert.equal(r1.ok, false)
  assert.match(r1.detail, /ECONNREFUSED/)

  const slow = stubFetch(() => { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e })
  const r2 = await runProbe({ name: 'n8n', checks: [{ url: 'https://n8n.test/healthz' }], timeoutMs: 1234 }, slow.fn)
  assert.equal(r2.detail, 'timed out after 1234ms')
})

test('runProbe: supabase fails when the database read fails even if auth is healthy', async () => {
  const f = stubFetch((url) => (url.includes('/rest/v1/') ? new Response('', { status: 540 }) : ok()))
  const spec = buildProbes(FULL_ENV).find((x) => x.name === 'supabase')!
  const r = await runProbe(spec, f.fn)
  assert.equal(r.ok, false)
  assert.equal(r.status, 540)
  assert.ok(r.url!.includes('/rest/v1/'))
  assert.equal(headersOf(f.calls[0].init).apikey, ANON)
})

test('runProbe: a skipped probe makes no request', async () => {
  const f = stubFetch(ok)
  const r = await runProbe({ name: 'site', checks: [], timeoutMs: 1, skip: 'SITE_URL is not an https URL' }, f.fn)
  assert.equal(r.ok, null)
  assert.equal(f.calls.length, 0)
})

// ---------- state ----------

const RULES = { alertAfter: 2, realertMinutes: 60 }
const fail = (name: any = 'site') => ({ name, ok: false, status: 502, ms: 5, detail: 'unexpected status 502', url: 'https://site.test/', attempts: 2 })
const pass = (name: any = 'site') => ({ name, ok: true, status: 200, ms: 5, detail: 'ok', url: 'https://site.test/', attempts: 1 })
const t = (min: number) => new Date(Date.UTC(2026, 9, 3, 0, min)).toISOString()

test('state: down after 2 failing ticks, once; still_down after 60 min; recovered after', () => {
  let s = step(undefined, fail(), t(0), RULES)
  assert.equal(s.event, null)
  assert.equal(s.next.since, t(0))

  s = step(s.next, fail(), t(5), RULES)
  assert.equal(s.event?.event, 'down')
  assert.equal(s.event?.since, t(0))
  assert.equal(s.event?.failures, 2)

  s = step(s.next, fail(), t(10), RULES)
  assert.equal(s.event, null, 'no repeat inside the realert window')

  s = step(s.next, fail(), t(65), RULES)
  assert.equal(s.event?.event, 'still_down')

  s = step(s.next, pass(), t(70), RULES)
  assert.equal(s.event?.event, 'recovered')
  assert.equal(s.event?.reported, true)
  assert.deepEqual(s.next, { fails: 0, down: false, since: null, alertedAt: null })
})

test('state: a single blip below the threshold never alerts and resets', () => {
  let s = step(undefined, fail(), t(0), RULES)
  s = step(s.next, pass(), t(5), RULES)
  assert.equal(s.event, null)
  assert.equal(s.next.fails, 0)
})

test('state: an undelivered down is retried on the next tick', () => {
  const prev = { site: { fails: 1, down: false, since: t(0), alertedAt: null } }
  const e1 = evaluate(prev, [fail()], t(5), RULES)
  assert.equal(e1.events[0].event, 'down')
  const kept = undeliver(prev, e1.next, e1.events)
  assert.equal(kept.site!.alertedAt, null)
  assert.equal(kept.site!.down, true)
  const e2 = evaluate(kept, [fail()], t(10), RULES)
  assert.equal(e2.events[0]?.event, 'down', 'still the first alert, not a silent still-down')
})

test('state: an outage that was never reported still gets a recovery notice', () => {
  const prev = { n8n: { fails: 4, down: true, since: t(0), alertedAt: null } }
  const e = evaluate(prev, [pass('n8n')], t(20), RULES)
  assert.equal(e.events[0].event, 'recovered')
  assert.equal(e.events[0].reported, false)
  // and an undelivered recovery is re-sent next tick
  const kept = undeliver(prev, e.next, e.events)
  assert.deepEqual(kept.n8n, prev.n8n)
})

test('state: a skipped probe keeps its state', () => {
  const prev = { site: { fails: 3, down: true, since: t(0), alertedAt: t(5) } }
  const e = evaluate(prev, [{ name: 'site', ok: null, status: null, ms: 0, detail: 'skip', url: null, attempts: 0 }], t(10), RULES)
  assert.deepEqual(e.next.site, prev.site)
  assert.equal(e.events.length, 0)
})

test('stateless window: first tick of each half hour only', () => {
  assert.equal(statelessWindowOpen(Date.UTC(2026, 9, 3, 1, 0)), true)
  assert.equal(statelessWindowOpen(Date.UTC(2026, 9, 3, 1, 4)), true)
  assert.equal(statelessWindowOpen(Date.UTC(2026, 9, 3, 1, 5)), false)
  assert.equal(statelessWindowOpen(Date.UTC(2026, 9, 3, 1, 30)), true)
  assert.equal(statelessWindowOpen(Date.UTC(2026, 9, 3, 1, 55)), false)
})

// ---------- payload ----------

test('payload: subject names what is down and what recovered; no secrets', () => {
  const p = buildPayload(
    [
      { probe: 'site', event: 'down', since: t(0), failures: 2, status: 502, detail: 'unexpected status 502', url: 'https://site.test/' },
      { probe: 'n8n', event: 'recovered', since: t(0), failures: 3, status: 200, detail: 'ok', url: null, reported: false },
    ],
    [fail(), pass('n8n')],
    t(10),
    true,
  )
  assert.equal(p.subject, '[NixGen watchdog] DOWN: site; recovered: n8n')
  assert.match(p.text, /DOWN {2}Public site/)
  assert.match(p.text, /could not be delivered/)
  assert.deepEqual(p.events.map((e) => e.dedupe_key), ['site:down', 'n8n:recovered'])
})

// ---------- end to end (runWatchdog) ----------

const TICK = (min: number) => Date.UTC(2026, 9, 3, 2, min)

test('e2e: healthy ticks make no alert and no KV write', async () => {
  const store = kv()
  const f = stubFetch(ok)
  const r = await runWatchdog({ ...FULL_ENV, WATCHDOG_STATE: store }, TICK(0), f.fn)
  assert.equal(r.events.length, 0)
  assert.equal(r.delivered, null)
  assert.equal(store.writes, 0)
  // 1 site + 1 workspace + 2 supabase + 1 n8n, no webhook
  assert.equal(f.calls.length, 5)
  assert.ok(f.calls.every((c) => (c.init?.method ?? 'GET') === 'GET'))
})

test('e2e: site down two ticks -> one n8n alert with header auth and no leaked secrets', async () => {
  const store = kv()
  const handler = (url: string) => (url === 'https://site.test/' ? down() : ok())

  const t1 = stubFetch(handler)
  const r1 = await runWatchdog({ ...FULL_ENV, WATCHDOG_STATE: store }, TICK(0), t1.fn)
  assert.equal(r1.events.length, 0, 'first failing tick only records the streak')
  assert.equal(store.writes, 1)

  const t2 = stubFetch(handler)
  const r2 = await runWatchdog({ ...FULL_ENV, WATCHDOG_STATE: store }, TICK(5), t2.fn)
  assert.equal(r2.events[0].event, 'down')
  assert.equal(r2.delivered, true)
  assert.equal(r2.via, 'n8n')
  const hook = t2.calls.find((c) => c.init?.method === 'POST')!
  assert.equal(hook.url, FULL_ENV.N8N_ALERT_URL)
  assert.equal(headersOf(hook.init)['x-webhook-secret'], HOOK_SECRET)
  const body = String(hook.init!.body)
  assert.ok(!body.includes(HOOK_SECRET) && !body.includes(ANON), 'payload carries no secret')
  const payload = JSON.parse(body)
  assert.equal(payload.source, 'nixgen-watchdog')
  assert.equal(payload.stateful, true)
  assert.equal(JSON.parse(store.map.get(STATE_KEY)!).site.alertedAt, new Date(TICK(5)).toISOString())

  // next tick, still down, inside the hour: silent
  const t3 = stubFetch(handler)
  const r3 = await runWatchdog({ ...FULL_ENV, WATCHDOG_STATE: store }, TICK(10), t3.fn)
  assert.equal(r3.events.length, 0)
  assert.ok(!t3.calls.some((c) => c.init?.method === 'POST'))

  // recovers: one recovery notice
  const t4 = stubFetch(ok)
  const r4 = await runWatchdog({ ...FULL_ENV, WATCHDOG_STATE: store }, TICK(15), t4.fn)
  assert.equal(r4.events[0].event, 'recovered')
  assert.equal(r4.delivered, true)
})

test('e2e: n8n down -> webhook skipped, Resend fallback used', async () => {
  const store = kv()
  const env = { ...FULL_ENV, WATCHDOG_STATE: store, ALERT_AFTER_FAILURES: '1', RESEND_API_KEY: RESEND_KEY, ALERT_EMAIL_TO: 'ops@example.test, me@example.test', ALERT_EMAIL_FROM: 'watchdog@example.test' }
  const f = stubFetch((url) => (url.startsWith('https://n8n.test/') ? down() : ok()))
  const r = await runWatchdog(env, TICK(0), f.fn)
  assert.equal(r.events[0].probe, 'n8n')
  assert.equal(r.via, 'resend')
  assert.ok(!f.calls.some((c) => c.url === FULL_ENV.N8N_ALERT_URL), 'no 55 s webhook attempt at a dead n8n')
  const mail = f.calls.find((c) => c.url === 'https://api.resend.com/emails')!
  assert.equal(headersOf(mail.init).authorization, `Bearer ${RESEND_KEY}`)
  const body = JSON.parse(String(mail.init!.body))
  assert.deepEqual(body.to, ['ops@example.test', 'me@example.test'])
  assert.ok(!String(mail.init!.body).includes(RESEND_KEY))
})

test('e2e: no channel configured -> not delivered, retried next tick', async () => {
  const store = kv()
  const env = { ...FULL_ENV, WATCHDOG_STATE: store, ALERT_AFTER_FAILURES: '1', N8N_WEBHOOK_SECRET: '' }
  const handler = (url: string) => (url === 'https://site.test/' ? down() : ok())
  const r1 = await runWatchdog(env, TICK(0), stubFetch(handler).fn)
  assert.equal(r1.delivered, false)
  assert.equal(JSON.parse(store.map.get(STATE_KEY)!).site.alertedAt, null)
  const r2 = await runWatchdog(env, TICK(5), stubFetch(handler).fn)
  assert.equal(r2.events[0]?.event, 'down')
})

test('e2e: stateless (no KV) alerts on the first failing tick in the half-hour window only', async () => {
  const handler = (url: string) => (url === 'https://site.test/' ? down() : ok())
  const open = stubFetch(handler)
  const r1 = await runWatchdog(FULL_ENV, TICK(30), open.fn)
  assert.equal(r1.stateful, false)
  assert.equal(r1.events[0]?.event, 'down')
  assert.equal(JSON.parse(String(open.calls.find((c) => c.init?.method === 'POST')!.init!.body)).stateful, false)

  const closed = stubFetch(handler)
  const r2 = await runWatchdog(FULL_ENV, TICK(35), closed.fn)
  assert.equal(r2.events.length, 0)
  assert.ok(!closed.calls.some((c) => c.init?.method === 'POST'))
})

test('worker: cron handler only (no public fetch handler)', () => {
  assert.equal(typeof (worker as any).scheduled, 'function')
  assert.equal((worker as any).fetch, undefined)
})
