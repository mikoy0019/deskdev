import { beforeEach, describe, expect, it, vi } from 'vitest'

const select = vi.fn()
vi.mock('./supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { from: () => ({ select }) },
}))

const { cadenceLabel, fetchAutomationHealth, STATUS_LABEL } = await import('./automations')

const row = (job: string, status: string) => ({ job, status, kind: 'schedule', cadence_hours: 24 })

describe('cadenceLabel', () => {
  it.each([
    [{ kind: 'schedule', cadence_hours: 24 }, 'every day'],
    [{ kind: 'schedule', cadence_hours: 168 }, 'every week'],
    [{ kind: 'schedule', cadence_hours: 48 }, 'every 2 days'],
    [{ kind: 'schedule', cadence_hours: 6 }, 'every 6 hours'],
    [{ kind: 'event', cadence_hours: null }, 'on event'],
  ] as const)('%o → %s', (input, expected) => {
    expect(cadenceLabel(input)).toBe(expected)
  })
})

describe('fetchAutomationHealth', () => {
  beforeEach(() => {
    select.mockReset()
  })

  it('puts what needs attention first: failing, late, never, on time, paused', async () => {
    select.mockResolvedValue({
      data: [row('b-ok', 'ok'), row('paused', 'paused'), row('late', 'stale'), row('a-ok', 'ok'), row('broken', 'failing'), row('new', 'never')],
      error: null,
    })
    const res = await fetchAutomationHealth()
    expect(res.ok && res.rows.map((r) => r.job)).toEqual(['broken', 'late', 'new', 'a-ok', 'b-ok', 'paused'])
  })

  it('reports a missing view (migration 026 not applied) distinctly', async () => {
    select.mockResolvedValue({ data: null, error: { code: 'PGRST205', message: 'not in schema cache' } })
    expect(await fetchAutomationHealth()).toMatchObject({ ok: false, missing: true })
  })

  it('passes other errors through', async () => {
    select.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } })
    expect(await fetchAutomationHealth()).toEqual({ ok: false, error: 'permission denied', missing: false })
  })
})

describe('STATUS_LABEL', () => {
  it('covers every status the view can return', () => {
    expect(Object.keys(STATUS_LABEL).sort()).toEqual(['failing', 'never', 'ok', 'paused', 'stale'])
  })
})
