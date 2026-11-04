/**
 * Alert delivery. Primary: the n8n webhook `deskdev-ops-alert` (Header Auth,
 * x-webhook-secret, the same credential every [deskdev] webhook uses), which
 * emails the company inbox through n8n's Gmail node.
 *
 * WHY NOT Cloudflare's send_email binding: it needs Email Routing on the
 * zone, and Email Routing takes over the zone's MX records, which would cut
 * off company mail. Fallback: Resend's HTTP API, used only when its three
 * secrets are set, and tried when n8n is the thing that is down or the
 * webhook call fails.
 *
 * Nothing here ever puts a secret in a payload, a log line or an error.
 */
import type { Env } from './config.ts'
import type { FetchLike, ProbeResult } from './probes.ts'
import type { AlertEvent } from './state.ts'
import { N8N_TIMEOUT_MS, httpsUrl } from './config.ts'

export const ALERT_SOURCE = 'nixgen-watchdog'

export interface AlertPayload {
  source: typeof ALERT_SOURCE
  at: string
  /** false when the Worker has no KV and cannot dedupe (the n8n side may throttle on dedupe_key). */
  stateful: boolean
  subject: string
  text: string
  events: (AlertEvent & { dedupe_key: string })[]
  probes: Pick<ProbeResult, 'name' | 'ok' | 'status' | 'ms' | 'detail'>[]
}

const LABEL: Record<string, string> = {
  site: 'Public site',
  workspace: 'DeskDev workspace',
  supabase: 'Supabase (auth + database)',
  n8n: 'n8n automations',
}

function line(e: AlertEvent): string {
  const name = LABEL[e.probe] ?? e.probe
  if (e.event === 'recovered') {
    const tail = e.reported === false ? ' (the outage alert could not be delivered at the time)' : ''
    return `RECOVERED  ${name}: back up; down since ${e.since ?? 'unknown'}${tail}`
  }
  const what = e.event === 'down' ? 'DOWN' : 'STILL DOWN'
  const status = e.status === null ? '' : ` [HTTP ${e.status}]`
  return `${what}  ${name}: ${e.detail}${status}; failing since ${e.since ?? 'now'} (${e.failures} checks)${e.url ? `\n           ${e.url}` : ''}`
}

export function buildPayload(events: AlertEvent[], results: ProbeResult[], atIso: string, stateful: boolean): AlertPayload {
  const down = events.filter((e) => e.event !== 'recovered').map((e) => e.probe)
  const up = events.filter((e) => e.event === 'recovered').map((e) => e.probe)
  const parts: string[] = []
  if (down.length) parts.push(`DOWN: ${down.join(', ')}`)
  if (up.length) parts.push(`recovered: ${up.join(', ')}`)
  const subject = `[NixGen watchdog] ${parts.join('; ')}`

  const status = results
    .map((r) => `  ${r.name.padEnd(10)} ${r.ok === null ? 'skipped' : r.ok ? 'ok' : 'FAIL'}  ${r.ok === null ? r.detail : `${r.ms}ms`}`)
    .join('\n')

  const text = [
    ...events.map(line),
    '',
    `All probes at ${atIso}:`,
    status,
    '',
    stateful
      ? 'Repeats while a probe stays down; a recovery notice follows.'
      : 'Stateless mode (no WATCHDOG_STATE KV): repeats every half hour while down; no recovery notice.',
    'Runbook: docs/runbooks (DNS-CUTOVER, BACKUP-RESTORE) and Workers Observability → nixgen-watchdog.',
  ].join('\n')

  return {
    source: ALERT_SOURCE,
    at: atIso,
    stateful,
    subject,
    text,
    events: events.map((e) => ({ ...e, dedupe_key: `${e.probe}:${e.event}` })),
    probes: results.map((r) => ({ name: r.name, ok: r.ok, status: r.status, ms: r.ms, detail: r.detail })),
  }
}

export type Channel = 'n8n' | 'resend'

export interface Delivery {
  delivered: boolean
  via: Channel | null
  /** Channel → short reason; never includes a secret or a response body. */
  failures: Partial<Record<Channel, string>>
}

async function postJson(fetchFn: FetchLike, url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<string | null> {
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': ALERT_SOURCE, ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    try { await res.arrayBuffer() } catch { /* ignore */ }
    return res.ok ? null : `HTTP ${res.status}`
  } catch (err) {
    return err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 200) : 'request failed'
  }
}

function resendConfigured(env: Env): boolean {
  return Boolean(env.RESEND_API_KEY?.trim() && env.ALERT_EMAIL_TO?.trim() && env.ALERT_EMAIL_FROM?.trim())
}

/**
 * @param n8nUp false when this tick's n8n probe failed: the webhook would only
 *   burn the 55 s wake-up budget, so go straight to the fallback.
 */
export async function deliver(env: Env, payload: AlertPayload, fetchFn: FetchLike, n8nUp: boolean): Promise<Delivery> {
  const failures: Delivery['failures'] = {}

  const hook = httpsUrl(env.N8N_ALERT_URL)
  const secret = env.N8N_WEBHOOK_SECRET?.trim()
  if (!hook || !secret) {
    failures.n8n = !hook ? 'N8N_ALERT_URL is not an https URL' : 'N8N_WEBHOOK_SECRET is not set'
  } else if (!n8nUp) {
    failures.n8n = 'skipped: n8n probe is failing'
  } else {
    const err = await postJson(fetchFn, hook, { 'x-webhook-secret': secret }, payload, N8N_TIMEOUT_MS)
    if (err === null) return { delivered: true, via: 'n8n', failures }
    failures.n8n = err
  }

  if (!resendConfigured(env)) {
    failures.resend = 'not configured'
    return { delivered: false, via: null, failures }
  }
  const to = (env.ALERT_EMAIL_TO ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const err = await postJson(
    fetchFn,
    'https://api.resend.com/emails',
    { authorization: `Bearer ${(env.RESEND_API_KEY ?? '').trim()}` },
    { from: (env.ALERT_EMAIL_FROM ?? '').trim(), to, subject: payload.subject, text: payload.text },
    15_000,
  )
  if (err === null) return { delivered: true, via: 'resend', failures }
  failures.resend = err
  return { delivered: false, via: null, failures }
}
