/**
 * nixgen-watchdog: every 5 minutes, probe the public site, the DeskDev
 * workspace host, Supabase (auth + a database read) and n8n, and email an
 * alert through n8n when something stays down.
 *
 * This Worker started as the n8n keep-alive and still is one: the n8n probe
 * GETs /healthz, and Render spins a free web service down after ~15 minutes
 * without inbound traffic (a sleeping container runs no cron, so every n8n
 * schedule silently stops). The folder keeps its old name
 * (workers/n8n-keepalive) so CI paths and docs stay valid; the deployed
 * Worker is `nixgen-watchdog`.
 *
 * WHY THIS LIVES ON CLOUDFLARE AND NOT INSIDE n8n OR SUPABASE
 * A watchdog has to run outside what it watches. An n8n schedule cannot wake
 * a sleeping n8n, and pg_cron cannot report a paused Supabase project. A
 * separate Worker (not a cron on the site Worker) also survives a broken site
 * deploy. It cannot see a Cloudflare-wide outage; an external uptime checker
 * is the answer to that, if it is ever wanted.
 *
 * No fetch handler and no public URL (workers_dev / preview_urls are off in
 * wrangler.jsonc): an open endpoint would let anyone fire probes and alerts on
 * this account's quota. Locally: `npx wrangler dev --test-scheduled`, then
 * open /__scheduled. Deployed: Workers Observability → nixgen-watchdog.
 *
 * A 200 from n8n's /healthz means the process is up and nothing more. Whether
 * the automations RAN is answered by automation_runs (automation_health view,
 * Settings → Integrations), never by this Worker.
 */
import type { Env } from './config.ts'
import type { FetchLike, ProbeResult } from './probes.ts'
import type { AlertEvent, Rules, WatchState } from './state.ts'
import { buildProbes, intSetting } from './config.ts'
import { runProbes } from './probes.ts'
import { STATE_KEY, compact, evaluate, parseState, statelessWindowOpen, undeliver } from './state.ts'
import { buildPayload, deliver } from './alert.ts'

export type { Env } from './config.ts'

export interface TickReport {
  results: ProbeResult[]
  events: AlertEvent[]
  delivered: boolean | null
  via: string | null
  stateful: boolean
}

/** Workers Observability indexes JSON log lines field by field. */
function log(level: 'log' | 'warn' | 'error', msg: string, fields: Record<string, unknown> = {}): void {
  console[level](JSON.stringify({ worker: 'nixgen-watchdog', msg, ...fields }))
}

export async function runWatchdog(env: Env, scheduledMs: number, fetchFn: FetchLike = fetch): Promise<TickReport> {
  const nowIso = new Date(scheduledMs).toISOString()
  const kv = env.WATCHDOG_STATE
  const stateful = Boolean(kv)

  const rules: Rules = {
    // Stateless, every tick looks like the first, so the in-probe retry is the
    // only confirmation available.
    alertAfter: stateful ? intSetting(env.ALERT_AFTER_FAILURES, 2, 1, 12) : 1,
    realertMinutes: intSetting(env.REALERT_MINUTES, 60, 10, 24 * 60),
  }

  const results = await runProbes(buildProbes(env), fetchFn)
  for (const r of results) {
    if (r.ok === null) log('warn', 'probe skipped', { probe: r.name, detail: r.detail })
    else if (r.ok) log('log', 'probe ok', { probe: r.name, status: r.status, ms: r.ms, attempts: r.attempts })
    else log('error', 'probe failed', { probe: r.name, status: r.status, ms: r.ms, detail: r.detail, attempts: r.attempts })
  }

  let prev: WatchState = {}
  if (kv) {
    try {
      prev = compact(parseState(await kv.get(STATE_KEY)))
    } catch (err) {
      log('warn', 'state read failed; treating as fresh', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  const { next, events: all } = evaluate(prev, results, nowIso, rules)
  const events = stateful || statelessWindowOpen(scheduledMs) ? all : []

  let finalState = next
  let delivered: boolean | null = null
  let via: string | null = null
  if (events.length > 0) {
    const n8n = results.find((r) => r.name === 'n8n')
    const payload = buildPayload(events, results, nowIso, stateful)
    const d = await deliver(env, payload, fetchFn, n8n?.ok !== false)
    delivered = d.delivered
    via = d.via
    if (d.delivered) {
      log('warn', 'alert sent', { via: d.via, subject: payload.subject })
    } else {
      finalState = undeliver(prev, next, events)
      log('error', 'alert NOT delivered; will retry next tick', { failures: d.failures, subject: payload.subject })
    }
  }

  if (kv && JSON.stringify(finalState) !== JSON.stringify(prev)) {
    // Written only on change: a healthy week is zero writes, and an outage is
    // one write per tick, far inside KV's free daily write allowance.
    try {
      await kv.put(STATE_KEY, JSON.stringify(finalState))
    } catch (err) {
      log('error', 'state write failed', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  return { results, events, delivered, via, stateful }
}

export default {
  async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    await runWatchdog(env, controller.scheduledTime)
  },
} satisfies ExportedHandler<Env>
