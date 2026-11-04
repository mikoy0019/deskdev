import { supabase, isSupabaseConfigured } from './supabase'

// Reads the automation_health view (migration 026). It answers "did the n8n
// automations actually run?" from the rows each workflow writes, which is the
// only trustworthy signal: n8n's /healthz says the process is up, nothing more.
// Admin-only by RLS; a member gets an empty list.

export type AutomationStatus = 'ok' | 'stale' | 'failing' | 'never' | 'paused'

export interface AutomationHealth {
  job: string
  workflow: string | null
  description: string
  kind: 'schedule' | 'event'
  cadence_hours: number | null
  enabled: boolean
  last_ok_at: string | null
  last_error_at: string | null
  last_error: string | null
  last_error_node: string | null
  runs_7d: number
  errors_7d: number
  status: AutomationStatus
}

export type AutomationHealthResult =
  | { ok: true; rows: AutomationHealth[] }
  | { ok: false; error: string; /** Migration 026 is not applied yet. */ missing?: boolean }

const ORDER: Record<AutomationStatus, number> = { failing: 0, stale: 1, never: 2, ok: 3, paused: 4 }

export async function fetchAutomationHealth(): Promise<AutomationHealthResult> {
  if (!isSupabaseConfigured) return { ok: false, error: 'Automation health needs the Supabase backend' }
  const { data, error } = await supabase.from('automation_health').select('*')
  if (error) {
    // PGRST205: not in the schema cache; 42P01: relation does not exist.
    const missing = error.code === 'PGRST205' || error.code === '42P01'
    return { ok: false, error: error.message, missing }
  }
  const rows = (data ?? []) as AutomationHealth[]
  rows.sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.job.localeCompare(b.job))
  return { ok: true, rows }
}

export const STATUS_LABEL: Record<AutomationStatus, { label: string; badge: string; hint: string }> = {
  ok: { label: 'On time', badge: 'badge-success', hint: 'Ran within its schedule.' },
  stale: {
    label: 'Late',
    badge: 'badge-warn',
    hint: 'No successful run inside its schedule. n8n may be asleep, or the workflow is switched off in n8n.',
  },
  failing: { label: 'Failing', badge: 'badge-danger', hint: 'The latest run failed. The error handler emailed the details.' },
  never: { label: 'No runs yet', badge: 'badge-neutral', hint: 'Nothing logged yet. Expected right after setup.' },
  paused: { label: 'Paused', badge: 'badge-neutral', hint: 'Marked as switched off (automation_jobs.enabled).' },
}

/** "every day", "every week", "every 6 hours", or "on event" for webhook workflows. */
export function cadenceLabel(row: Pick<AutomationHealth, 'kind' | 'cadence_hours'>): string {
  if (row.kind === 'event' || !row.cadence_hours) return 'on event'
  if (row.cadence_hours === 24) return 'every day'
  if (row.cadence_hours === 168) return 'every week'
  if (row.cadence_hours % 24 === 0) return `every ${row.cadence_hours / 24} days`
  return `every ${row.cadence_hours} hours`
}
