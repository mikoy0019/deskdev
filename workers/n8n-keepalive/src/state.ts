/**
 * Turns probe results into alert events. Pure functions over a small state
 * record, so the alerting rules are tested without a clock, KV or network.
 *
 * Rules
 *  - A probe is "down" after `alertAfter` consecutive failing ticks (each tick
 *    already retried once inside runProbe).
 *  - "down" is sent once; "still_down" repeats every `realertMinutes` while it
 *    stays down; "recovered" is sent when it passes again, including after an
 *    outage whose alert could not be delivered (n8n down with no fallback), so
 *    an outage is never completely silent.
 *  - An event that could not be delivered is retried on the next tick
 *    (alertedAt only moves when delivery succeeded).
 *  - A skipped probe (not configured) changes nothing.
 */
import type { ProbeName } from './config.ts'
import type { ProbeResult } from './probes.ts'

export interface ProbeState {
  /** Consecutive failing ticks. */
  fails: number
  /** fails reached the threshold. */
  down: boolean
  /** ISO time of the first failing tick of the current streak. */
  since: string | null
  /** ISO time of the last delivered down/still_down alert for this streak. */
  alertedAt: string | null
}

export type WatchState = Partial<Record<ProbeName, ProbeState>>

export type AlertKind = 'down' | 'still_down' | 'recovered'

export interface AlertEvent {
  probe: ProbeName
  event: AlertKind
  since: string | null
  failures: number
  status: number | null
  detail: string
  url: string | null
  /** recovered only: whether the outage was ever reported. */
  reported?: boolean
}

export interface Rules {
  alertAfter: number
  realertMinutes: number
}

export const STATE_KEY = 'watchdog:v1'

const EMPTY: ProbeState = { fails: 0, down: false, since: null, alertedAt: null }

export function parseState(raw: string | null): WatchState {
  if (!raw) return {}
  try {
    const v = JSON.parse(raw) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as WatchState) : {}
  } catch {
    return {}
  }
}

/** Step one probe. Returns the next state (assuming the event, if any, is delivered) and the event. */
export function step(prev: ProbeState | undefined, r: ProbeResult, nowIso: string, rules: Rules): { next: ProbeState; event: AlertEvent | null } {
  const p = prev ?? EMPTY
  if (r.ok === null) return { next: p, event: null }

  const base = { probe: r.name, status: r.status, detail: r.detail, url: r.url }

  if (r.ok) {
    if (p.down) {
      return {
        next: { ...EMPTY },
        event: { ...base, event: 'recovered', since: p.since, failures: p.fails, reported: p.alertedAt !== null },
      }
    }
    return { next: { ...EMPTY }, event: null }
  }

  const fails = p.fails + 1
  const since = p.since ?? nowIso
  const down = fails >= rules.alertAfter

  if (!down) return { next: { fails, down: false, since, alertedAt: null }, event: null }

  if (p.alertedAt === null) {
    return {
      next: { fails, down: true, since, alertedAt: nowIso },
      event: { ...base, event: 'down', since, failures: fails },
    }
  }

  const sinceAlert = (Date.parse(nowIso) - Date.parse(p.alertedAt)) / 60_000
  if (sinceAlert >= rules.realertMinutes) {
    return {
      next: { fails, down: true, since, alertedAt: nowIso },
      event: { ...base, event: 'still_down', since, failures: fails },
    }
  }
  return { next: { fails, down: true, since, alertedAt: p.alertedAt }, event: null }
}

/** Healthy probes are not stored, so a healthy tick leaves the state (and KV) untouched. */
export function compact(state: WatchState): WatchState {
  const out: WatchState = {}
  for (const [k, v] of Object.entries(state) as [ProbeName, ProbeState | undefined][]) {
    if (v && (v.fails > 0 || v.down || v.alertedAt !== null)) out[k] = v
  }
  return out
}

export function evaluate(prev: WatchState, results: ProbeResult[], nowIso: string, rules: Rules): { next: WatchState; events: AlertEvent[] } {
  const next: WatchState = { ...prev }
  const events: AlertEvent[] = []
  for (const r of results) {
    const s = step(prev[r.name], r, nowIso, rules)
    next[r.name] = s.next
    if (s.event) events.push(s.event)
  }
  return { next: compact(next), events }
}

/**
 * Undo what an undelivered event would have recorded, so the next tick
 * tries again: a down/still_down keeps its previous alertedAt; a recovered
 * keeps the probe "down" (with its streak) so recovery is re-sent.
 */
export function undeliver(prev: WatchState, next: WatchState, events: AlertEvent[]): WatchState {
  const out: WatchState = { ...next }
  for (const e of events) {
    const before = prev[e.probe] ?? EMPTY
    const after = next[e.probe] ?? EMPTY
    if (e.event === 'recovered') out[e.probe] = { ...before }
    else out[e.probe] = { ...after, alertedAt: before.alertedAt }
  }
  return compact(out)
}

/**
 * Without KV there is no memory between ticks, so every failing tick looks
 * like the first. To avoid an email every five minutes, a stateless worker
 * reports a failure only on the first tick of each half hour.
 */
export function statelessWindowOpen(scheduledMs: number): boolean {
  return new Date(scheduledMs).getUTCMinutes() % 30 < 5
}
