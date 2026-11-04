/**
 * The watchdog's settings, read from the Worker's vars and secrets
 * (wrangler.jsonc + `wrangler secret put`). Pure: no fetch, no I/O, so the
 * tests can build any combination.
 */

/** KV is optional; without it the watchdog still probes and alerts, throttled (see state.ts). */
export interface KvLike {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
}

export interface Env {
  // ---- vars (wrangler.jsonc) ----
  /** Public site, e.g. https://nixgensolutions.com/ — empty skips the probe. */
  SITE_URL?: string
  /** DeskDev host, e.g. https://workspace.nixgensolutions.com/ — empty skips the probe. */
  WORKSPACE_URL?: string
  /** https://<ref>.supabase.co — empty skips the probe. */
  SUPABASE_URL?: string
  /** A PostgREST read the anon key may make (path + query, starting with /rest/v1/). */
  SUPABASE_REST_PROBE?: string
  /** n8n /healthz. Pinging it is also what keeps a free Render instance awake. */
  N8N_HEALTH_URL?: string
  /** n8n webhook that turns an alert into an email: <n8n>/webhook/deskdev-ops-alert */
  N8N_ALERT_URL?: string
  /** Consecutive failing ticks before the first alert (stateful mode only). */
  ALERT_AFTER_FAILURES?: string
  /** Minutes between repeat alerts while a probe stays down. */
  REALERT_MINUTES?: string

  // ---- secrets (wrangler secret put) ----
  /** Public anon key; a secret only so the repo does not pin one project's key. */
  SUPABASE_ANON_KEY?: string
  /** Same value as n8n's "DeskDev Webhook Secret" credential (header x-webhook-secret). */
  N8N_WEBHOOK_SECRET?: string
  /** Optional second channel for when n8n itself is the thing that is down. */
  RESEND_API_KEY?: string
  ALERT_EMAIL_TO?: string
  ALERT_EMAIL_FROM?: string

  // ---- bindings ----
  WATCHDOG_STATE?: KvLike
}

export type ProbeName = 'site' | 'workspace' | 'supabase' | 'n8n'

export interface HttpCheck {
  url: string
  headers?: Record<string, string>
}

export interface ProbeSpec {
  name: ProbeName
  /** Every check must pass for the probe to pass. */
  checks: HttpCheck[]
  timeoutMs: number
  /** Why the probe is not run, when it is not. */
  skip?: string
}

/**
 * A Render cold start takes 30-60 s, so the n8n timeout tolerates a wake-up
 * instead of calling it an outage. The others answer in well under a second
 * when healthy; 15 s is "something is wrong" without being flaky.
 */
export const N8N_TIMEOUT_MS = 55_000
export const HTTP_TIMEOUT_MS = 15_000

export const DEFAULT_REST_PROBE = '/rest/v1/showcase_items?select=slug&limit=1'

function clean(v: string | undefined): string {
  return (v ?? '').trim()
}

/** https only: a probe that silently follows http would hide a broken TLS setup. */
export function httpsUrl(raw: string | undefined): string | null {
  const v = clean(raw)
  if (!v) return null
  try {
    const u = new URL(v)
    return u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

export function intSetting(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(clean(raw), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export function buildProbes(env: Env): ProbeSpec[] {
  const probes: ProbeSpec[] = []

  const site = httpsUrl(env.SITE_URL)
  probes.push(site
    ? { name: 'site', checks: [{ url: site }], timeoutMs: HTTP_TIMEOUT_MS }
    : { name: 'site', checks: [], timeoutMs: HTTP_TIMEOUT_MS, skip: 'SITE_URL is not an https URL' })

  const ws = httpsUrl(env.WORKSPACE_URL)
  probes.push(ws
    ? { name: 'workspace', checks: [{ url: ws }], timeoutMs: HTTP_TIMEOUT_MS }
    : { name: 'workspace', checks: [], timeoutMs: HTTP_TIMEOUT_MS, skip: 'WORKSPACE_URL is not an https URL' })

  const sb = httpsUrl(env.SUPABASE_URL)
  const anon = clean(env.SUPABASE_ANON_KEY)
  if (!sb) {
    probes.push({ name: 'supabase', checks: [], timeoutMs: HTTP_TIMEOUT_MS, skip: 'SUPABASE_URL is not an https URL' })
  } else if (!anon) {
    // Without a key the gateway answers 401 for a healthy and a broken
    // project alike, so the probe would prove nothing.
    probes.push({ name: 'supabase', checks: [], timeoutMs: HTTP_TIMEOUT_MS, skip: 'SUPABASE_ANON_KEY secret is not set' })
  } else {
    const base = sb.replace(/\/+$/, '')
    const rest = clean(env.SUPABASE_REST_PROBE) || DEFAULT_REST_PROBE
    const restPath = rest.startsWith('/rest/v1/') ? rest : DEFAULT_REST_PROBE
    const headers = { apikey: anon, authorization: `Bearer ${anon}` }
    probes.push({
      name: 'supabase',
      // Auth health proves the gateway and GoTrue; the REST read proves
      // PostgREST and the database behind it (a paused project fails here).
      checks: [{ url: `${base}/auth/v1/health`, headers }, { url: `${base}${restPath}`, headers }],
      timeoutMs: HTTP_TIMEOUT_MS,
    })
  }

  const n8n = httpsUrl(env.N8N_HEALTH_URL)
  probes.push(n8n
    ? { name: 'n8n', checks: [{ url: n8n }], timeoutMs: N8N_TIMEOUT_MS }
    : { name: 'n8n', checks: [], timeoutMs: N8N_TIMEOUT_MS, skip: 'N8N_HEALTH_URL is not an https URL' })

  return probes
}
