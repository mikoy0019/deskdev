import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The Round 2 entry points of the db adapter against a fake Supabase client:
// the convert_lead RPC (036), the workspace_settings singleton (033), the
// audit log page (032), and how each reads "migration not applied yet".

const fake = vi.hoisted(() => ({
  session: true as boolean,
  rpc: vi.fn(),
  calls: [] as { table: string; op: string; args: unknown[] }[],
  result: {} as Record<string, { data: unknown; error: { code?: string; message: string } | null }>,
}))

vi.mock('./supabase', () => {
  /** A chainable query that records every call and resolves to fake.result[table]. */
  const query = (table: string) => {
    const done = () => Promise.resolve(fake.result[table] ?? { data: [], error: null })
    const q: Record<string, unknown> = {}
    for (const op of ['select', 'update', 'eq', 'lt', 'order', 'limit', 'range']) {
      q[op] = (...args: unknown[]) => {
        fake.calls.push({ table, op, args })
        return q
      }
    }
    q.maybeSingle = () => done()
    q.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => done().then(resolve, reject)
    return q
  }
  return {
    isSupabaseConfigured: true,
    supabase: {
      auth: { getSession: async () => ({ data: { session: fake.session ? { user: { id: 'u1' } } : null }, error: null }) },
      from: (table: string) => query(table),
      rpc: (...args: unknown[]) => fake.rpc(...args),
    },
  }
})

import * as db from './db'
import { emptyEngagementTerms } from './engagements'

beforeEach(() => {
  fake.session = true
  fake.rpc.mockReset()
  fake.calls = []
  fake.result = {}
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  db.setWriteErrorHandler(null)
  vi.restoreAllMocks()
})

describe('saveProjectEngagement', () => {
  it('accepts only a confirmed record for this project and next version', async () => {
    const terms = emptyEngagementTerms()
    fake.rpc.mockResolvedValue({ data: { id: 'e1', project_id: 'p1', version: 2, terms }, error: null })
    expect((await db.saveProjectEngagement('p1', 1, terms)).record).toMatchObject({ id: 'e1', projectId: 'p1', version: 2 })
    expect(fake.rpc).toHaveBeenCalledWith('save_project_engagement', { p_project_id: 'p1', p_version: 1, p_terms: terms })
    for (const data of [{}, { id: 'e1', project_id: 'another', version: 2, terms }, { id: 'e1', project_id: 'p1', version: 1, terms }]) {
      fake.rpc.mockResolvedValue({ data, error: null })
      expect((await db.saveProjectEngagement('p1', 1, terms)).error).toMatch(/did not confirm/)
    }
  })
  it('reports a missing migration, a refusal and a network failure without returning a record', async () => {
    fake.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Missing function' } })
    expect((await db.saveProjectEngagement('p1', 0, emptyEngagementTerms())).error).toMatch(/not enabled/)
    fake.rpc.mockResolvedValue({ data: null, error: { code: '40001', message: 'Changed. Reload.' } })
    expect(await db.saveProjectEngagement('p1', 0, emptyEngagementTerms())).toEqual({ error: 'Changed. Reload.' })
    fake.rpc.mockRejectedValue(new Error('Network down'))
    expect((await db.saveProjectEngagement('p1', 0, emptyEngagementTerms())).error).toMatch(/reach the server/)
  })
  it('does not write after the session ends', async () => {
    fake.session = false
    expect((await db.saveProjectEngagement('p1', 0, emptyEngagementTerms())).error).toMatch(/session has ended/)
    expect(fake.rpc).not.toHaveBeenCalled()
  })
})

describe('convertLead (convert_lead RPC)', () => {
  it('sends the lead and service and maps the ids back', async () => {
    fake.rpc.mockResolvedValue({ data: { client_id: 'c1', project_id: 'p1', already_converted: false }, error: null })
    expect(await db.convertLead('l1', 'website')).toEqual({ ok: true, clientId: 'c1', projectId: 'p1' })
    expect(fake.rpc).toHaveBeenCalledWith('convert_lead', { p_lead_id: 'l1', p_service: 'website' })
  })

  it('passes null for "use the lead’s first service"', async () => {
    fake.rpc.mockResolvedValue({ data: { client_id: 'c1', project_id: null }, error: null })
    expect(await db.convertLead('l1')).toEqual({ ok: true, clientId: 'c1', projectId: undefined })
    expect(fake.rpc).toHaveBeenCalledWith('convert_lead', { p_lead_id: 'l1', p_service: null })
  })

  it('says "missing" while 036 is not applied, so the store can fall back', async () => {
    fake.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.convert_lead' } })
    expect(await db.convertLead('l1')).toEqual({ ok: false, missing: true })
  })

  it('passes a refusal through', async () => {
    fake.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Converting a lead needs Growth and Clients edit access' } })
    expect(await db.convertLead('l1')).toEqual({ ok: false, error: 'Converting a lead needs Growth and Clients edit access' })
  })

  it('treats an answer without a client as a failure', async () => {
    fake.rpc.mockResolvedValue({ data: {}, error: null })
    expect((await db.convertLead('l1')).ok).toBe(false)
  })

  it('answers even when the request throws', async () => {
    fake.rpc.mockRejectedValue(new Error('boom'))
    expect(await db.convertLead('l1')).toEqual({ ok: false, error: 'Could not reach the server.' })
  })

  it('does not call the server when signed out', async () => {
    fake.session = false
    const res = await db.convertLead('l1')
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/session has ended/)
    expect(fake.rpc).not.toHaveBeenCalled()
  })
})

describe('workspace_settings', () => {
  it('reads the singleton and fills defaults', async () => {
    fake.result.workspace_settings = { data: { id: true, growth_sla_minutes: 30 }, error: null }
    const ws = await db.fetchWorkspaceSettings()
    expect(ws).toMatchObject({ growthSlaMinutes: 30, growthStaleDays: 14 })
    expect(db.isTableMissing('workspace_settings')).toBe(false)
  })

  it('reads "missing" before 033 is applied, and remembers it for realtime', async () => {
    fake.result.workspace_settings = { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.workspace_settings'" } }
    expect(await db.fetchWorkspaceSettings()).toBe('missing')
    expect(db.isTableMissing('workspace_settings')).toBe(true)
  })

  it('updates the one row by its true id, with only the patched columns', async () => {
    fake.result.workspace_settings = { data: [{ id: true }], error: null }
    await db.updateWorkspaceSettings({ growthAutoReply: true, growthBookingUrl: undefined, updatedBy: 'u1' })
    const update = fake.calls.find((c) => c.op === 'update')!
    expect(update.args[0]).toEqual({ growth_auto_reply: true, growth_booking_url: null, updated_by: 'u1' })
    expect(fake.calls.find((c) => c.op === 'eq')!.args).toEqual(['id', true])
  })

  it('reports a write RLS refused', async () => {
    const onError = vi.fn()
    db.setWriteErrorHandler(onError)
    fake.result.workspace_settings = { data: [], error: null }
    await db.updateWorkspaceSettings({ growthAutoReply: true })
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ table: 'workspace_settings', op: 'update' }))
  })
})

describe('fetchAuditLog', () => {
  it('pages newest first by id', async () => {
    fake.result.audit_log = {
      data: [
        { id: 9, at: 'a', action: 'profile.deactivated', entity: 'profile', entity_id: 'u', detail: {} },
        { id: 8, at: 'b', action: 'showcase.published', entity: 'showcase', entity_id: 's', detail: { slug: 'x' } },
      ],
      error: null,
    }
    const page = await db.fetchAuditLog({ limit: 2, before: 10 })
    expect(page.rows.map((r) => r.id)).toEqual([9, 8])
    expect(page.nextBefore).toBe(8)
    expect(fake.calls.find((c) => c.op === 'order')!.args).toEqual(['id', { ascending: false }])
    expect(fake.calls.find((c) => c.op === 'lt')!.args).toEqual(['id', 10])
  })

  it('has no next page when the page is short', async () => {
    fake.result.audit_log = { data: [{ id: 1, at: 'a', action: 'x.y', entity: 'e', detail: {} }], error: null }
    expect((await db.fetchAuditLog({ limit: 100 })).nextBefore).toBeUndefined()
  })

  it('reads "unavailable" before 032 is applied', async () => {
    fake.result.audit_log = { data: null, error: { code: '42P01', message: 'relation "public.audit_log" does not exist' } }
    expect(await db.fetchAuditLog()).toEqual({ rows: [], unavailable: true })
  })
})

describe('missing-relation detection', () => {
  it('recognizes PostgREST and Postgres codes and messages', () => {
    expect(db.isMissingRelation({ code: 'PGRST205' })).toBe(true)
    expect(db.isMissingRelation({ message: 'relation "public.x" does not exist' })).toBe(true)
    expect(db.isMissingRelation({ code: '42501', message: 'permission denied' })).toBe(false)
    expect(db.isMissingFunction({ code: '42883' })).toBe(true)
    expect(db.isMissingFunction(null)).toBe(false)
  })
})
