import type { HttpCheck, ProbeName, ProbeSpec } from './config.ts'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface ProbeResult {
  name: ProbeName
  /** true = healthy; false = failed both attempts; null = skipped (not configured). */
  ok: boolean | null
  status: number | null
  ms: number
  detail: string
  /** The URL that decided the result (never carries a key: keys travel in headers). */
  url: string | null
  attempts: number
}

interface CheckOutcome {
  ok: boolean
  status: number | null
  detail: string
  url: string
}

async function check(fetchFn: FetchLike, c: HttpCheck, timeoutMs: number): Promise<CheckOutcome> {
  try {
    const res = await fetchFn(c.url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      // no-store so the request reaches the origin; reaching it is the point.
      headers: { 'cache-control': 'no-store', 'user-agent': 'nixgen-watchdog', ...(c.headers ?? {}) },
    })
    // Drain the body so the connection is released; its content is not needed.
    try { await res.arrayBuffer() } catch { /* ignore */ }
    return {
      ok: res.ok,
      status: res.status,
      detail: res.ok ? 'ok' : `unexpected status ${res.status}`,
      url: c.url,
    }
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    const msg = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      status: null,
      detail: name === 'TimeoutError' || name === 'AbortError' ? `timed out after ${timeoutMs}ms` : msg.slice(0, 200),
      url: c.url,
    }
  }
}

async function attempt(fetchFn: FetchLike, spec: ProbeSpec): Promise<CheckOutcome> {
  let last: CheckOutcome | null = null
  for (const c of spec.checks) {
    last = await check(fetchFn, c, spec.timeoutMs)
    if (!last.ok) return last
  }
  return last ?? { ok: false, status: null, detail: 'no checks', url: '' }
}

/**
 * One probe = every check passes. A failure is retried once straight away:
 * the first request after a Render sleep does the waking and can time out,
 * and a single dropped connection should not page anyone.
 */
export async function runProbe(spec: ProbeSpec, fetchFn: FetchLike, now: () => number = Date.now): Promise<ProbeResult> {
  if (spec.skip || spec.checks.length === 0) {
    return { name: spec.name, ok: null, status: null, ms: 0, detail: spec.skip ?? 'not configured', url: null, attempts: 0 }
  }
  const started = now()
  let out = await attempt(fetchFn, spec)
  let attempts = 1
  if (!out.ok) {
    out = await attempt(fetchFn, spec)
    attempts = 2
  }
  return {
    name: spec.name,
    ok: out.ok,
    status: out.status,
    ms: now() - started,
    detail: out.ok && attempts === 2 ? 'ok on retry' : out.detail,
    url: out.url,
    attempts,
  }
}

export function runProbes(specs: ProbeSpec[], fetchFn: FetchLike, now?: () => number): Promise<ProbeResult[]> {
  return Promise.all(specs.map((s) => runProbe(s, fetchFn, now)))
}
