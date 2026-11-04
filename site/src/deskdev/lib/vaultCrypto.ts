// Zero-knowledge vault crypto (web). AES-256-GCM + PBKDF2-SHA256 via audited
// @noble libs. The vault master password never leaves the device: it derives a
// master key that only *wraps* a random data key; all vault content is
// encrypted with the data key. Supabase only ever stores ciphertext.
import { gcm } from '@noble/ciphers/aes.js'
import { pbkdf2 } from '@noble/hashes/pbkdf2.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

export const KDF_ITERATIONS = 210_000
const IV_LEN = 12
const SALT_LEN = 16
const KEY_LEN = 32

/** Cryptographically-secure random bytes (browser). */
function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return b
}

/** UTF-8 decode without depending on TextDecoder (Hermes-safe on mobile). */
function bytesToUtf8(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  while (i < bytes.length) {
    const b1 = bytes[i++]
    if (b1 < 0x80) out += String.fromCharCode(b1)
    else if (b1 < 0xe0) {
      const b2 = bytes[i++]
      out += String.fromCharCode(((b1 & 0x1f) << 6) | (b2 & 0x3f))
    } else if (b1 < 0xf0) {
      const b2 = bytes[i++], b3 = bytes[i++]
      out += String.fromCharCode(((b1 & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f))
    } else {
      const b2 = bytes[i++], b3 = bytes[i++], b4 = bytes[i++]
      let cp = ((b1 & 0x07) << 18) | ((b2 & 0x3f) << 12) | ((b3 & 0x3f) << 6) | (b4 & 0x3f)
      cp -= 0x10000
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
    }
  }
  return out
}

export function newSalt(): string {
  return bytesToHex(randomBytes(SALT_LEN))
}

/** PBKDF2 → 256-bit master key. */
export function deriveKey(password: string, saltHex: string, iterations = KDF_ITERATIONS): Uint8Array {
  return pbkdf2(sha256, utf8ToBytes(password.normalize('NFKC')), hexToBytes(saltHex), {
    c: iterations,
    dkLen: KEY_LEN,
  })
}

/** Encrypt raw bytes → hex(iv ‖ ciphertext ‖ tag). */
export function encryptBytes(key: Uint8Array, data: Uint8Array): string {
  const iv = randomBytes(IV_LEN)
  const ct = gcm(key, iv).encrypt(data)
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv)
  out.set(ct, iv.length)
  return bytesToHex(out)
}

/** Decrypt hex(iv ‖ ciphertext ‖ tag). Throws if the key is wrong or data was tampered. */
export function decryptBytes(key: Uint8Array, blobHex: string): Uint8Array {
  const bytes = hexToBytes(blobHex)
  return gcm(key, bytes.slice(0, IV_LEN)).decrypt(bytes.slice(IV_LEN))
}

export function encryptString(key: Uint8Array, text: string): string {
  return encryptBytes(key, utf8ToBytes(text))
}

export function decryptString(key: Uint8Array, blobHex: string): string {
  return bytesToUtf8(decryptBytes(key, blobHex))
}

export interface VaultMeta {
  salt: string
  iterations: number
  wrappedKey: string
}

/** Set up a brand-new vault from a chosen master password. */
export function initVaultKeys(masterPassword: string): { meta: VaultMeta; dataKey: Uint8Array } {
  const salt = newSalt()
  const dataKey = randomBytes(KEY_LEN)
  const masterKey = deriveKey(masterPassword, salt, KDF_ITERATIONS)
  const wrappedKey = encryptBytes(masterKey, dataKey)
  return { meta: { salt, iterations: KDF_ITERATIONS, wrappedKey }, dataKey }
}

/** Unlock: derive the master key and unwrap the data key. Throws on wrong password. */
export function unlockDataKey(masterPassword: string, meta: VaultMeta): Uint8Array {
  const masterKey = deriveKey(masterPassword, meta.salt, meta.iterations)
  return decryptBytes(masterKey, meta.wrappedKey)
}

/** Re-wrap the data key under a new master password (password change). */
export function rewrapDataKey(dataKey: Uint8Array, newPassword: string): VaultMeta {
  const salt = newSalt()
  const masterKey = deriveKey(newPassword, salt, KDF_ITERATIONS)
  return { salt, iterations: KDF_ITERATIONS, wrappedKey: encryptBytes(masterKey, dataKey) }
}
