import { describe, expect, it } from 'vitest'
import {
  initVaultKeys, unlockDataKey, encryptString, decryptString, rewrapDataKey, decryptBytes,
} from './vaultCrypto'

describe('vault crypto (zero-knowledge)', () => {
  it('unlocks with the correct master password and round-trips content', () => {
    const { meta, dataKey } = initVaultKeys('correct horse battery staple')
    const unlocked = unlockDataKey('correct horse battery staple', meta)
    expect(bytesEqual(unlocked, dataKey)).toBe(true)

    const secret = JSON.stringify({ username: 'admin', password: 'p@ss🔐', apiKey: 'sk-123' })
    const blob = encryptString(dataKey, secret)
    expect(blob).not.toContain('admin') // ciphertext leaks nothing
    expect(decryptString(unlocked, blob)).toBe(secret)
  })

  it('rejects a wrong master password (GCM auth failure)', () => {
    const { meta } = initVaultKeys('hunter2')
    expect(() => unlockDataKey('hunter3', meta)).toThrow()
  })

  it('rejects tampered ciphertext', () => {
    const { dataKey } = initVaultKeys('pw')
    const blob = encryptString(dataKey, 'secret value')
    const tampered = blob.slice(0, -2) + (blob.slice(-2) === 'ff' ? '00' : 'ff')
    expect(() => decryptBytes(dataKey, tampered)).toThrow()
  })

  it('supports changing the master password without re-encrypting content', () => {
    const { dataKey } = initVaultKeys('old-password')
    const blob = encryptString(dataKey, 'stable secret')
    const meta2 = rewrapDataKey(dataKey, 'new-password')

    expect(() => unlockDataKey('old-password', meta2)).toThrow()
    const unlocked = unlockDataKey('new-password', meta2)
    expect(decryptString(unlocked, blob)).toBe('stable secret')
  })

  it('produces different ciphertext each time (random IV)', () => {
    const { dataKey } = initVaultKeys('pw')
    expect(encryptString(dataKey, 'same')).not.toBe(encryptString(dataKey, 'same'))
  })
})

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
