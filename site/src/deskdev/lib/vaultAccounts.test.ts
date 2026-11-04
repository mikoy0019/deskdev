import { describe, expect, it } from 'vitest'
import { newInviteCode, normalizeInviteCode } from './vault'
import { initVaultKeys, rewrapDataKey, unlockDataKey } from './vaultCrypto'

describe('vault accounts', () => {
  it('invite codes are 10 unambiguous characters, typed any way', () => {
    const code = newInviteCode()
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/)
    expect(normalizeInviteCode(` ${code.toLowerCase().replace('-', ' ')} `)).toBe(code.replace('-', ''))
    expect(new Set(Array.from({ length: 20 }, newInviteCode)).size).toBe(20)
  })

  it('one data key opens under the master password, an admin password and an invite code', () => {
    const { meta, dataKey } = initVaultKeys('master-password')
    const mine = rewrapDataKey(dataKey, 'my own password')
    const code = normalizeInviteCode(newInviteCode())
    const invite = rewrapDataKey(dataKey, code)
    expect(unlockDataKey('master-password', meta)).toEqual(dataKey)
    expect(unlockDataKey('my own password', mine)).toEqual(dataKey)
    expect(unlockDataKey(code, invite)).toEqual(dataKey)
    expect(() => unlockDataKey('master-password', mine)).toThrow()
    // Seven PBKDF2 derivations at 210,000 rounds: slow on purpose, slower on a busy machine.
  }, 60_000)
})
