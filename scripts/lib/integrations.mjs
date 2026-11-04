// Pure helpers for scripts/setup-integrations.mjs: argument parsing, key
// generation, the run's decisions and the checks on values before they are
// written anywhere. No I/O here, so node:test can cover it (integrations.test.mjs).

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto'
import { parseEnv } from 'node:util'
import { setEnvKeyText } from './env.mjs'

export const PARTS = ['push', 'google', 'env']
/** What a run does when --only is absent. The env part is never implied. */
export const DEFAULT_PARTS = ['push', 'google']

/** Each flag and the part(s) it acts on; --dry-run applies to every part. */
const FLAG_PARTS = {
  '--dry-run': PARTS,
  '--rotate-vapid': ['push'],
  '--resume-push': ['push'],
  '--resume-calendar': ['google'],
  '--dev-origin': ['google'],
  '--workers-dev-origin': ['google'],
  '--prod-origins': ['google'],
  '--replace-client': ['google'],
  '--redirect-base': ['google'],
  '--yes-env': ['env'],
  '--force': ['push', 'env'],
}

/**
 * Strict on purpose: a typo must stop the run, not fall through to a live one,
 * and a flag for a part that is not selected is a mistake, not a no-op.
 * @returns {{ dryRun: boolean, parts: string[], rotateVapid: boolean, resumePush: boolean, resumeCalendar: boolean, devOrigin: boolean, workersDevOrigin: boolean, prodOrigins: boolean, replaceClient: boolean, yesEnv: boolean, force: boolean, redirectBase: string | null }}
 */
export function parseArgs(argv) {
  const out = { dryRun: false, parts: [...DEFAULT_PARTS], rotateVapid: false, resumePush: false, resumeCalendar: false, devOrigin: false, workersDevOrigin: false, prodOrigins: false, replaceClient: false, yesEnv: false, force: false, redirectBase: null }
  const given = []
  let only = null
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--only' || arg.startsWith('--only=')) {
      const value = arg === '--only' ? argv[++i] : arg.slice('--only='.length)
      if (!PARTS.includes(value)) throw new Error(`--only takes one of: ${PARTS.join(', ')}`)
      if (only) throw new Error('--only may be given once')
      only = value
    } else if (arg === '--redirect-base' || arg.startsWith('--redirect-base=')) {
      const value = arg === '--redirect-base' ? argv[++i] : arg.slice('--redirect-base='.length)
      if (!isRedirectBase(value)) throw new Error('--redirect-base takes an https URL (or http://localhost:<port>/…) without a trailing slash, query or fragment')
      if (out.redirectBase) throw new Error('--redirect-base may be given once')
      out.redirectBase = value
      given.push('--redirect-base')
    } else if (Object.hasOwn(FLAG_PARTS, arg) && arg !== '--redirect-base') {
      const key = arg.slice(2).replace(/-([a-z])/g, (_m, c) => c.toUpperCase())
      out[key] = true
      given.push(arg)
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  if (only) out.parts = [only]
  for (const flag of given) {
    if (!FLAG_PARTS[flag].some((part) => out.parts.includes(part))) {
      throw new Error(`${flag} belongs to the ${FLAG_PARTS[flag].join(' or ')} part, which this run does not include (parts: ${out.parts.join(', ')})`)
    }
  }
  if ((out.devOrigin || out.workersDevOrigin) && out.prodOrigins) throw new Error('--prod-origins takes the extra origins out again, so it cannot be combined with --dev-origin or --workers-dev-origin')
  if (out.parts.includes('env') && !out.yesEnv && !out.dryRun) {
    throw new Error('the env part rewrites env files, which AGENTS.md reserves for the owner: pass --yes-env to confirm')
  }
  return out
}

export function isRedirectBase(value) {
  if (typeof value !== 'string' || value.endsWith('/') || !isSafeEnvValue(value)) return false
  try {
    const u = new URL(value)
    if (u.search || u.hash || u.username || u.password) return false
    return u.protocol === 'https:' || (u.protocol === 'http:' && u.hostname === 'localhost')
  } catch {
    return false
  }
}

/**
 * Values this script writes are bare KEY=value lines and bare CLI arguments.
 * Anything outside this set (spaces, quotes, #, newlines) would be read back
 * differently by dotenv or parseEnv, so it is refused, never escaped.
 */
export function isSafeEnvValue(value) {
  return typeof value === 'string' && value.length > 0 && /^[A-Za-z0-9_\-+/=.:@,]+$/.test(value)
}

/**
 * Proves an edit of an env file before a byte is written. `raw` is the file as
 * bytes. The edit is refused when the file is not valid UTF-8 (rewriting it
 * would re-encode bytes it never meant to touch), when it would change the
 * value of any other key (a `KEY=` line inside another key's quoted, multi-line
 * value), or when a new key would not read back as written.
 * @param {Buffer} raw
 * @param {Record<string, string>} pairs
 * @returns {{ ok: true, after: string, was: Record<string, string> } | { ok: false, reason: string }}
 */
export function proveEnvEdit(raw, pairs) {
  const before = raw.toString('utf8')
  if (!Buffer.from(before, 'utf8').equals(raw)) return { ok: false, reason: 'is not valid UTF-8, so this script does not edit it' }
  const entries = Object.entries(pairs)
  const unsafe = entries.filter(([, value]) => !isSafeEnvValue(value)).map(([key]) => key)
  if (unsafe.length) return { ok: false, reason: `would get a value with characters this script does not write (${unsafe.join(', ')})` }
  let after = before
  try {
    for (const [key, value] of entries) after = setEnvKeyText(after, key, value)
  } catch {
    return { ok: false, reason: 'could not take the new keys' }
  }
  const was = parseEnv(before)
  const will = parseEnv(after)
  const touched = Object.keys(was).filter((key) => !Object.hasOwn(pairs, key) && will[key] !== was[key])
  if (touched.length) return { ok: false, reason: `would have ${touched.length} other key(s) changed by the edit (${touched.join(', ')})` }
  const unread = entries.filter(([key, value]) => will[key] !== value).map(([key]) => key)
  if (unread.length) return { ok: false, reason: `would not read ${unread.join(', ')} back as written` }
  return { ok: true, after, was }
}

export const sha256Hex = (value) => createHash('sha256').update(value).digest('hex')

/** [major, minor, patch]; missing parts count as 0. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  }
  return 0
}

// ---------------------------------------------------------------- VAPID

/** True when the two base64url strings are one P-256 pair in the Web Push format. */
export function vapidPairMatches(publicKey, privateKey) {
  try {
    const pub = Buffer.from(publicKey, 'base64url')
    const d = Buffer.from(privateKey, 'base64url')
    if (pub.length !== 65 || pub[0] !== 4 || d.length !== 32) return false
    const x = pub.subarray(1, 33).toString('base64url')
    const y = pub.subarray(33).toString('base64url')
    const priv = createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x, y, d: d.toString('base64url') }, format: 'jwk' })
    const pubKey = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x, y }, format: 'jwk' })
    const msg = Buffer.from('deskdev-vapid-check')
    return verify('sha256', msg, pubKey, sign('sha256', msg, priv))
  } catch {
    return false
  }
}

/**
 * The same format site/scripts/generate-vapid-keys.mjs prints: the 65-byte
 * uncompressed public point and the 32-byte private scalar, both base64url.
 */
export function generateVapidPair() {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = privateKey.export({ format: 'jwk' })
  const x = Buffer.from(jwk.x, 'base64url')
  const y = Buffer.from(jwk.y, 'base64url')
  const d = Buffer.from(jwk.d, 'base64url')
  const pair = { publicKey: Buffer.concat([Buffer.from([4]), x, y]).toString('base64url'), privateKey: d.toString('base64url') }
  if (!vapidPairMatches(pair.publicKey, pair.privateKey)) throw new Error('the generated VAPID pair failed its self-check')
  return pair
}

/**
 * Apple rejects anything but a real mailto: address or an https URL. The same
 * rule, line for line, as isValidVapidSubject in send-push/logic.ts: a subject
 * this accepts and the function refuses would leave push "not configured".
 */
export function isVapidSubject(subject) {
  const s = String(subject ?? '').trim()
  if (/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(s)) return !/@localhost$/i.test(s)
  if (/^https:\/\//i.test(s)) {
    try {
      const host = new URL(s).hostname
      return host !== 'localhost' && host.includes('.')
    } catch {
      return false
    }
  }
  return false
}

// ---------------------------------------------------------------- Google

/** "k1:<base64 of 32 random bytes>", the shape google_crypto.ts parses. */
export function newTokenKeyring() {
  return `k1:${randomBytes(32).toString('base64')}`
}

/** The key ids of a "<kid>:<base64>,..." ring, in order (empty when it is malformed). */
export function keyringKids(value) {
  if (typeof value !== 'string' || !value.trim()) return []
  const kids = []
  for (const entry of value.split(',')) {
    const at = entry.indexOf(':')
    const kid = at > 0 ? entry.slice(0, at).trim() : ''
    const b64 = entry.slice(at + 1).trim()
    // The rules google_crypto.ts parseKeyring applies: a short id, real base64
    // (4n+1 characters is never valid), 32 bytes or more, no id twice.
    if (!/^[A-Za-z0-9_-]{1,16}$/.test(kid) || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(b64)) return []
    if (b64.replace(/=+$/, '').length % 4 === 1) return []
    if (Buffer.from(b64, 'base64').length < 32 || kids.includes(kid)) return []
    kids.push(kid)
  }
  return kids
}

/** Every entry is <kid>:<base64>, each key decodes to at least 32 bytes, and no id repeats. */
export function isTokenKeyring(value) {
  return keyringKids(value).length > 0
}

const PRODUCTION_ORIGINS = ['https://workspace.nixgensolutions.com', 'https://nixgensolutions.com', 'https://www.nixgensolutions.com']
export const DEV_ORIGIN = 'http://localhost:6969'
/** The production Worker's own address while the domain is not attached yet (docs/runbooks/DNS-CUTOVER.md, phase 0). */
export const WORKERS_DEV_ORIGIN = 'https://nixgen-site.nixgensolutions.workers.dev'

/**
 * The APP_ORIGINS value: production, plus the workers.dev address and the
 * local dev origin only on request. The order is fixed, so the same choice
 * always gives the same text (and the same digest).
 */
export function appOrigins({ dev = false, workersDev = false } = {}) {
  return [...PRODUCTION_ORIGINS, ...(workersDev ? [WORKERS_DEV_ORIGIN] : []), ...(dev ? [DEV_ORIGIN] : [])].join(',')
}

// ---------------------------------------------------------------- Supabase keys

/**
 * What a key that is about to be inlined into the browser bundle really is.
 * Only an anon (or publishable) key of the expected project may go there.
 * @returns {{ kind: 'jwt' | 'publishable' | 'unknown', role: string | null, ref: string | null }}
 */
export function describeApiKey(key) {
  if (typeof key !== 'string') return { kind: 'unknown', role: null, ref: null }
  if (key.startsWith('sb_publishable_')) return { kind: 'publishable', role: 'anon', ref: null }
  const parts = key.split('.')
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
      return { kind: 'jwt', role: typeof payload.role === 'string' ? payload.role : null, ref: typeof payload.ref === 'string' ? payload.ref : null }
    } catch {
      /* not a JWT */
    }
  }
  return { kind: 'unknown', role: null, ref: null }
}

export function isAnonKeyFor(key, ref) {
  const info = describeApiKey(key)
  if (info.kind === 'publishable') return true
  return info.kind === 'jwt' && info.role === 'anon' && info.ref === ref
}

// ---------------------------------------------------------------- run decisions

/**
 * The secrets whose value differs from what the function holds. `digests` maps
 * a name to the SHA-256 hex the CLI lists; a name it does not list is new.
 * @returns {[string, string][]}
 */
export function changedSecrets(digests, pairs) {
  return Object.entries(pairs).filter(([name, value]) => digests.get(name) !== sha256Hex(value))
}

/**
 * What to do about the Vault row that switches a part on (the function URL the
 * database calls). It is written last, so a missing row with everything else
 * in place means one of two things the script cannot tell apart: the owner
 * paused delivery by deleting it (PUSH.md "Disable"), or an earlier run stopped
 * before the end. Either way it is only written again on request.
 * @returns {'keep' | 'fix' | 'set' | 'off'}
 */
export function vaultUrlAction({ hadUrl, currentMatches, restWasInPlace, resume }) {
  if (hadUrl) return currentMatches ? 'keep' : 'fix'
  if (restWasInPlace && !resume) return 'off'
  return 'set'
}

// What the functions answer, word for word (supabase/functions/*/index.ts). A
// probe counts only when it is the function's own sentence: the gateway's 401
// (JWT verification left on) and its 404 (not deployed) carry `message`, never
// `error`, so they can not be mistaken for it.
const answers = (r, status, error) => Boolean(r) && r.status === status && Boolean(r.json) && r.json.error === error

/** send-push with every secret set, called without a token. */
export const pushAnswersConfigured = (r) => answers(r, 401, 'Missing Authorization header')
export const pushAnswersUnconfigured = (r) => answers(r, 500, 'Push is not configured.')
/** send-push took the bearer as its webhook secret and went on to reject the (deliberately empty) body. */
export const pushAcceptsSecret = (r) => Boolean(r) && r.status === 400 && Boolean(r.json) && typeof r.json.error === 'string' && r.json.error.startsWith('Expected {type:')
/** google-calendar with its secret set, drained without a token. */
export const calendarAnswersConfigured = (r) => answers(r, 401, 'unauthorized')
export const calendarAnswersUnconfigured = (r) => answers(r, 503, 'not configured')
/** google-calendar took the bearer as its secret and refused the (deliberately unknown) action before doing any work. */
export const calendarAcceptsSecret = (r) => answers(r, 400, 'unknown action')
export const answersNotDeployed = (r) => Boolean(r) && r.status === 404
/** Any answer the function wrote itself, whatever it says. */
export const answersItself = (r) => Boolean(r) && Boolean(r.json) && typeof r.json.error === 'string'

/**
 * What a token-less POST says about a function.
 * @returns {'configured' | 'unconfigured' | 'not-deployed' | 'jwt-gateway' | 'unreachable' | 'unknown'}
 */
export function functionState(r, { configured, unconfigured }) {
  if (!r || r.status === 0) return 'unreachable'
  if (answersNotDeployed(r)) return 'not-deployed'
  if (configured(r)) return 'configured'
  if (unconfigured(r)) return 'unconfigured'
  // A 401 that is not the function's own sentence comes from the gateway.
  if (r.status === 401 && !answersItself(r)) return 'jwt-gateway'
  return 'unknown'
}

/**
 * The APP_ORIGINS value to send, or null to leave the function's value alone.
 * The production list can carry two extras, each added on request and kept by
 * later runs: the local dev origin and the workers.dev address. A list someone
 * edited by hand matches none of the four lists this script writes, and is
 * never overwritten in passing: only --prod-origins resets it.
 * `allowsDev` / `allowsWorkersDev` say which extras the list holds once the run
 * is over, so every run can say so until they are taken out again.
 * @returns {{ value: string | null, refused: boolean, allowsDev: boolean, allowsWorkersDev: boolean }}
 */
export function appOriginsDecision({ currentDigest, devOrigin = false, workersDevOrigin = false, prodOrigins = false }) {
  const combos = [false, true].flatMap((dev) => [false, true].map((workersDev) => ({ dev, workersDev })))
  const current = currentDigest ? (combos.find((c) => sha256Hex(appOrigins(c)) === currentDigest) ?? null) : { dev: false, workersDev: false }
  const none = { dev: false, workersDev: false }
  let after = current
  let value = null
  let refused = false
  if (prodOrigins) {
    after = none
    value = appOrigins(none)
  } else if (devOrigin || workersDevOrigin) {
    if (!current) refused = true
    else {
      after = { dev: current.dev || devOrigin, workersDev: current.workersDev || workersDevOrigin }
      value = appOrigins(after)
    }
  } else if (!currentDigest) value = appOrigins(none)
  // Nothing to send when the list already is what was asked for.
  if (value !== null && currentDigest === sha256Hex(value)) value = null
  return { value, refused, allowsDev: Boolean(after && after.dev), allowsWorkersDev: Boolean(after && after.workersDev) }
}

/**
 * What to do with the Google OAuth client the env file holds.
 *   'none'     the env file has no complete client
 *   'same'     the function already holds exactly this client
 *   'send'     nothing on the function conflicts with it (or a replacement was asked for)
 *   'differs'  the function holds another id or secret; it is only replaced on request,
 *              so a secret rotated on the function is never undone by an older env file
 * @returns {'none' | 'same' | 'send' | 'differs'}
 */
export function oauthClientAction({ idDigest, secretDigest, clientId, clientSecret, replace }) {
  if (!clientId || !clientSecret) return 'none'
  const sameId = idDigest === sha256Hex(clientId)
  const sameSecret = secretDigest === sha256Hex(clientSecret)
  if (sameId && sameSecret) return 'same'
  const conflict = (Boolean(idDigest) && !sameId) || (Boolean(secretDigest) && !sameSecret)
  return !conflict || replace ? 'send' : 'differs'
}
