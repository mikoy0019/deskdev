import { beforeEach, describe, expect, it, vi } from 'vitest'

// Supabase faked: rpc() and the vault_meta / vault_settings queries answer
// whatever each test sets.
const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  metaRow: null as Record<string, unknown> | null,
  metaReads: 0,
  updateResult: { data: [] as unknown[] | null, error: null as { message: string } | null },
  updates: [] as { patch: unknown; filter: [string, unknown] }[],
  aal: 'aal1' as string,
}))

vi.mock('./supabase', () => {
  const metaQuery = {
    select: () => metaQuery,
    is: () => metaQuery,
    limit: () => metaQuery,
    maybeSingle: async () => {
      h.metaReads++
      return { data: h.metaRow, error: null }
    },
  }
  return {
    isSupabaseConfigured: true,
    supabase: {
      rpc: (...args: unknown[]) => h.rpc(...args),
      from: (table: string) => {
        if (table === 'vault_meta') return metaQuery
        if (table === 'vault_settings') {
          return {
            update: (patch: unknown) => ({
              eq: (col: string, val: unknown) => ({
                select: async () => {
                  h.updates.push({ patch, filter: [col, val] })
                  return h.updateResult
                },
              }),
            }),
          }
        }
        throw new Error('unexpected table ' + table)
      },
      auth: {
        mfa: {
          getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: h.aal }, error: null }),
        },
      },
    },
  }
})

import { isMissingFunction, sessionIsAal2, setVaultOwnerEmail, vaultHasActiveMeta } from './vault'

beforeEach(() => {
  h.rpc.mockReset()
  h.metaRow = null
  h.metaReads = 0
  h.updates.length = 0
  h.updateResult = { data: [], error: null }
  h.aal = 'aal1'
})

describe('vaultHasActiveMeta', () => {
  it('asks the RPC and never reads the salt', async () => {
    h.rpc.mockResolvedValue({ data: true, error: null })
    expect(await vaultHasActiveMeta()).toBe(true)
    h.rpc.mockResolvedValue({ data: false, error: null })
    expect(await vaultHasActiveMeta()).toBe(false)
    expect(h.rpc).toHaveBeenCalledWith('vault_has_active_meta')
    expect(h.metaReads).toBe(0)
  })

  it('falls back to the direct read until migration 030 is applied', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.vault_has_active_meta' } })
    h.metaRow = { id: 'm1', salt: 's', iterations: 1, wrapped_key: 'w', archived_at: null, created_at: '' }
    expect(await vaultHasActiveMeta()).toBe(true)
    expect(h.metaReads).toBe(1)
  })

  it('surfaces other errors', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } })
    await expect(vaultHasActiveMeta()).rejects.toThrow('permission denied')
  })
})

describe('isMissingFunction', () => {
  it('recognises PostgREST and Postgres "no such function"', () => {
    expect(isMissingFunction({ code: 'PGRST202' })).toBe(true)
    expect(isMissingFunction({ code: '42883' })).toBe(true)
    expect(isMissingFunction({ message: 'Could not find the function public.x without parameters' })).toBe(true)
    expect(isMissingFunction({ code: '42501', message: 'permission denied' })).toBe(false)
  })
})

describe('sessionIsAal2', () => {
  it('reports the current assurance level', async () => {
    expect(await sessionIsAal2()).toBe(false)
    h.aal = 'aal2'
    expect(await sessionIsAal2()).toBe(true)
  })
})

describe('setVaultOwnerEmail', () => {
  it('updates the one settings row', async () => {
    h.updateResult = { data: [{ id: 'vs' }], error: null }
    await setVaultOwnerEmail('owner@x.test')
    expect(h.updates).toEqual([{ patch: { owner_email: 'owner@x.test' }, filter: ['singleton', true] }])
  })

  it('throws when RLS matched no row (aal1, or not the current owner)', async () => {
    h.updateResult = { data: [], error: null }
    await expect(setVaultOwnerEmail('rogue@x.test')).rejects.toThrow(/Not saved/)
  })

  it('throws the database error', async () => {
    h.updateResult = { data: null, error: { message: 'boom' } }
    await expect(setVaultOwnerEmail('owner@x.test')).rejects.toThrow('boom')
  })
})
