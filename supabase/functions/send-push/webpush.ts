// DeskDev Studio — send-push: the Web Push adapter.
//
// Message encryption (RFC 8291, aes128gcm per RFC 8188) and VAPID (RFC 8292)
// on WebCrypto alone — no imports, so it runs unchanged on Supabase's Edge
// Runtime, Deno and Node, and the site's Vitest suite checks it byte for byte
// against RFC 8291's worked example.
//
// Why not a library: npm:web-push reaches for node:crypto's createECDH, which
// has been reported missing on the Edge Runtime as recently as Sept 2026, and
// its sendNotification goes through node:https. jsr:@negrel/webpush is
// WebCrypto too, but ships no tests, wants JWK-format keys, and reuses one
// ECDH key pair for every message an ApplicationServer sends. This file is
// ~150 lines with a test vector; index.ts only sees sendWebPush().

export type Urgency = 'very-low' | 'low' | 'normal' | 'high'

export interface PushTarget {
  endpoint: string
  /** Browser's P-256 public key, base64url (65 bytes uncompressed). */
  p256dh: string
  /** Browser's auth secret, base64url (16 bytes). */
  auth: string
}

export interface SendOptions {
  /** Seconds the push service may hold the message for an offline device. */
  ttl: number
  urgency: Urgency
  /** ≤ 32 URL-safe base64 characters; replaces an undelivered message with the same topic. */
  topic?: string
  /** Per-request timeout, ms. */
  timeoutMs?: number
}

export interface SendResult {
  status: number
  /** Push service's error text (Apple sends {"reason": …}), trimmed. */
  reason?: string
}

export interface Vapid {
  /** 65-byte uncompressed public key, base64url — the browser's applicationServerKey. */
  publicKey: string
  /** ECDSA P-256 signing key. */
  privateKey: CryptoKey
  /** mailto: or https: contact. */
  subject: string
}

const enc = new TextEncoder()

// ─── base64url ──────────────────────────────────────────────────────────────

export function b64urlEncode(bytes: Uint8Array | ArrayBuffer): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Accepts base64url or standard base64, padded or not. */
export function b64urlDecode(text: string): Uint8Array {
  const clean = text.trim().replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(clean + '==='.slice((clean.length + 3) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * A copy backed by a plain ArrayBuffer — what WebCrypto's BufferSource type
 * wants regardless of the TypeScript version the runtime ships.
 */
function buf(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', buf(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, buf(data)))
}

/** HKDF-SHA-256 with a single expand block (every length used here is ≤ 32). */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const prk = await hmac(salt, ikm)
  const okm = await hmac(prk, concat(info, new Uint8Array([1])))
  return okm.slice(0, length)
}

// ─── VAPID ──────────────────────────────────────────────────────────────────

/**
 * Import the VAPID pair from the base64url strings generate-vapid-keys.mjs
 * prints, and prove they belong together — a mismatched pair otherwise shows
 * up only as 403s from every push service.
 */
export async function importVapid(publicKey: string, privateKey: string, subject: string): Promise<Vapid> {
  const pub = b64urlDecode(publicKey)
  const d = b64urlDecode(privateKey)
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID_PUBLIC_KEY must be a 65-byte uncompressed P-256 key (base64url)')
  if (d.length !== 32) throw new Error('VAPID_PRIVATE_KEY must be a 32-byte P-256 scalar (base64url)')
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: b64urlEncode(pub.slice(1, 33)),
    y: b64urlEncode(pub.slice(33, 65)),
    d: b64urlEncode(d),
    ext: false,
  }
  const mismatch = 'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are not a pair'
  let signer: CryptoKey
  let verifier: CryptoKey
  try {
    // Some runtimes (Node) already reject an inconsistent JWK here; others
    // import it and would sign garbage, hence the probe below.
    signer = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
    verifier = await crypto.subtle.importKey('raw', buf(pub), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  } catch (err) {
    throw new Error(`${mismatch} (${err instanceof Error ? err.message : 'import failed'})`)
  }
  const probe = enc.encode('deskdev-vapid-check')
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signer, buf(probe))
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifier, sig, buf(probe))
  if (!ok) throw new Error(mismatch)
  return { publicKey: b64urlEncode(pub), privateKey: signer, subject }
}

const JWT_LIFETIME_S = 12 * 3600
const JWT_REUSE_S = 11 * 3600
const jwtCache = new Map<string, { token: string; until: number }>()

/**
 * The ES256 JWT for one push service origin. Apple asks for no more than one
 * new token an hour and rejects an `exp` over a day out, so a token lives 12h
 * and is reused for 11h per audience (per warm isolate).
 */
export async function vapidJwt(vapid: Vapid, audience: string, nowMs: number = Date.now()): Promise<string> {
  const now = Math.floor(nowMs / 1000)
  const key = `${vapid.publicKey}|${vapid.subject}|${audience}`
  const hit = jwtCache.get(key)
  if (hit && hit.until > now) return hit.token
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64urlEncode(enc.encode(JSON.stringify({ aud: audience, exp: now + JWT_LIFETIME_S, sub: vapid.subject })))
  const unsigned = `${header}.${claims}`
  // WebCrypto's ECDSA output is already r||s (IEEE P1363), which is JWS's format.
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, vapid.privateKey, buf(enc.encode(unsigned)))
  const token = `${unsigned}.${b64urlEncode(sig)}`
  jwtCache.set(key, { token, until: now + JWT_REUSE_S })
  return token
}

// ─── Message encryption (RFC 8291) ──────────────────────────────────────────

const RECORD_SIZE = 4096

export interface EncryptOverrides {
  /** 16 random bytes by default. */
  salt?: Uint8Array
  /** A fresh ECDH P-256 pair per message by default (tests pin RFC 8291's). */
  localKeys?: CryptoKeyPair
}

/**
 * The stored subscription itself is unusable (bad keys or endpoint), so it can
 * never succeed. Only this maps to "gone"; any other failure is ours.
 */
export class InvalidSubscriptionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidSubscriptionError'
  }
}

function decodeKey(text: string, what: string): Uint8Array {
  try {
    return b64urlDecode(text)
  } catch {
    throw new InvalidSubscriptionError(`Subscription ${what} is not base64url`)
  }
}

/** aes128gcm body: header (salt, rs, keyid = our public key) + one record. */
export async function encryptPayload(
  plaintext: Uint8Array,
  p256dh: string,
  auth: string,
  overrides: EncryptOverrides = {},
): Promise<Uint8Array> {
  const uaPublic = decodeKey(p256dh, 'p256dh')
  const authSecret = decodeKey(auth, 'auth secret')
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new InvalidSubscriptionError('Subscription p256dh is not a P-256 public key')
  if (authSecret.length !== 16) throw new InvalidSubscriptionError('Subscription auth secret is not 16 bytes')
  if (plaintext.length + 1 + 16 > RECORD_SIZE) throw new Error('Payload too large for one record')
  // A point that isn't on the curve: also the subscription's fault.
  let uaKey: CryptoKey
  try {
    uaKey = await crypto.subtle.importKey('raw', buf(uaPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  } catch {
    throw new InvalidSubscriptionError('Subscription p256dh is not a valid P-256 point')
  }

  const salt = overrides.salt ?? crypto.getRandomValues(new Uint8Array(16))
  const local =
    overrides.localKeys ??
    ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair)
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey))
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as EcdhKeyDeriveParams, local.privateKey, 256),
  )

  // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic)
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32)
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)

  // Single (last) record: plaintext followed by the 0x02 delimiter, no padding.
  const record = concat(plaintext, new Uint8Array([2]))
  const aesKey = await crypto.subtle.importKey('raw', buf(cek), { name: 'AES-GCM' }, false, ['encrypt'])
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(nonce) }, aesKey, buf(record)))

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, RECORD_SIZE)
  header[20] = asPublic.length
  header.set(asPublic, 21)
  return concat(header, cipher)
}

// ─── Sending ────────────────────────────────────────────────────────────────

/**
 * POST one encrypted message. Never throws: the caller maps the status (2xx
 * sent, 404/410 gone, anything else failed). Network errors, timeouts and our
 * own failures (WebCrypto, an oversized payload) come back as status 0; only a
 * malformed stored subscription comes back as 410.
 */
export async function sendWebPush(
  target: PushTarget,
  payload: string,
  vapid: Vapid,
  opts: SendOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  let audience: string
  try {
    audience = new URL(target.endpoint).origin
  } catch {
    return { status: 410, reason: 'Subscription endpoint is not a URL' }
  }
  let body: Uint8Array
  let jwt: string
  try {
    body = await encryptPayload(enc.encode(payload), target.p256dh, target.auth)
    jwt = await vapidJwt(vapid, audience)
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'encryption failed'
    // A malformed stored subscription can never succeed: gone. Anything else
    // is a fault on our side and must not cost anyone their subscription.
    return err instanceof InvalidSubscriptionError ? { status: 410, reason } : { status: 0, reason }
  }

  const headers: Record<string, string> = {
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(Math.max(0, Math.floor(opts.ttl))),
    Urgency: opts.urgency,
    Authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
  }
  if (opts.topic) headers.Topic = opts.topic

  try {
    const res = await fetchImpl(target.endpoint, {
      method: 'POST',
      headers,
      body: buf(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    })
    // Always drain the body so the connection is released.
    const text = (await res.text().catch(() => '')).trim()
    return res.ok ? { status: res.status } : { status: res.status, reason: text.slice(0, 300) || res.statusText }
  } catch (err) {
    return { status: 0, reason: err instanceof Error ? `${err.name}: ${err.message}` : 'network error' }
  }
}
