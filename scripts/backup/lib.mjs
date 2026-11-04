// Shared, side-effect-free helpers for backup.mjs and restore.mjs.
// Everything here is pure (or takes its I/O as an argument) so lib.test.mjs
// can cover it without a database, age, R2 or the network.
import { createHash, createHmac } from 'node:crypto'

// ---------- constants ----------

/** DeskDev's live project. Restores into it are refused unless explicitly confirmed. */
export const PROD_PROJECT_REF = 'rgasjotvqwkjbeivlhvn'
export const DEFAULT_BUCKET = 'nixgen-db-backups'
/** Lifecycle rule scope: everything under this prefix expires after RETENTION_DAYS (set on the bucket). */
export const NIGHTLY_PREFIX = 'nightly/'
export const RETENTION_DAYS = 35

/** The three files `supabase db dump` produces, in restore order. */
export const SUPABASE_PARTS = ['roles.sql', 'schema.sql', 'data.sql']
/** pg_dump fallback: one custom-format archive (pg_restore can pick from it). */
export const PG_DUMP_PARTS = ['full.dump']

// ---------- env ----------

/**
 * Names (never values) of what each mode needs. A value is "present" when it
 * is a non-empty string after trimming.
 */
export const REQUIRED_ENV = {
  dump: ['BACKUP_DATABASE_URL'],
  encrypt: ['BACKUP_AGE_RECIPIENTS'],
  upload: ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'],
  restoreDownload: ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'],
  restoreDecrypt: ['BACKUP_AGE_IDENTITY_FILE'],
  restoreApply: ['RESTORE_DATABASE_URL'],
}

export function missingEnv(env, names) {
  return names.filter((n) => typeof env[n] !== 'string' || env[n].trim() === '')
}

// ---------- age ----------

// X25519 recipient: "age1" + 58 bech32 characters.
const AGE_RECIPIENT = /^age1[02-9ac-hj-np-z]{58}$/

export function parseRecipients(raw) {
  const list = String(raw ?? '')
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, '')) // age's recipients-file comment syntax
    .join(' ')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const bad = list.filter((r) => !AGE_RECIPIENT.test(r))
  if (list.length === 0) throw new Error('BACKUP_AGE_RECIPIENTS has no age1… public key')
  if (bad.length) throw new Error(`BACKUP_AGE_RECIPIENTS has ${bad.length} value(s) that are not age1… public keys`)
  return [...new Set(list)]
}

export function ageEncryptArgs(recipients, input, output) {
  return [...recipients.flatMap((r) => ['-r', r]), '-o', output, input]
}

export function ageDecryptArgs(identityFile, input, output) {
  return ['-d', '-i', identityFile, '-o', output, input]
}

// ---------- naming ----------

/** 2026-10-03T19:00:07.123Z -> 20261003T190007Z */
export function stamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

/** nightly/2026/10/03/20261003T190007Z/ — sortable, and one lifecycle rule covers it. */
export function runPrefix(date, prefix = NIGHTLY_PREFIX) {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${prefix}${y}/${m}/${d}/${stamp(date)}/`
}

export function objectName(part) {
  return `${part}.gz.age`
}

/** Pick the newest run prefix from a list of object keys (manifest.json marks a finished run). */
export function latestRun(keys) {
  const runs = keys
    .filter((k) => k.endsWith('/manifest.json'))
    .map((k) => k.slice(0, -'manifest.json'.length))
    .sort()
  return runs.length ? runs[runs.length - 1] : null
}

/** Days between a run prefix's stamp and `now` (for "is this inside the 35-day window"). */
export function runAgeDays(prefix, now) {
  const m = /(\d{8}T\d{6}Z)\/?$/.exec(prefix)
  if (!m) return null
  const s = m[1]
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`
  return (now.getTime() - Date.parse(iso)) / 86_400_000
}

// ---------- safety ----------

/** Supabase project ref out of a Postgres URL (direct, pooler user "postgres.<ref>", or host). */
export function projectRefOf(dbUrl) {
  let u
  try {
    u = new URL(dbUrl)
  } catch {
    return null
  }
  const user = decodeURIComponent(u.username || '')
  const fromUser = /^[a-z_]+\.([a-z0-9]{20})$/.exec(user)
  if (fromUser) return fromUser[1]
  const fromHost = /(?:^|\.)(?:db\.)?([a-z0-9]{20})\.supabase\.(?:co|com|in)$/.exec(u.hostname)
  if (fromHost) return fromHost[1]
  return null
}

/**
 * Restoring over the live project is the one irreversible thing these scripts
 * can do. It needs --allow-production AND RESTORE_CONFIRM set to the ref.
 */
export function assertRestoreTarget(dbUrl, { allowProduction = false, confirm = '', prodRef = PROD_PROJECT_REF } = {}) {
  const ref = projectRefOf(dbUrl)
  const raw = String(dbUrl)
  const isProd = ref === prodRef || raw.includes(prodRef)
  if (!isProd) return { ref, production: false }
  if (allowProduction && confirm === prodRef) return { ref, production: true }
  throw new Error(
    `Refusing to restore into the production project (${prodRef}). ` +
    'Restore into staging or a local Postgres for drills. For a real disaster recovery pass ' +
    `--allow-production and set RESTORE_CONFIRM=${prodRef}.`,
  )
}

/** For logs: never print a connection string, only where it points. */
export function describeDbUrl(dbUrl) {
  try {
    const u = new URL(dbUrl)
    return `${u.protocol}//${u.hostname}:${u.port || '5432'}${u.pathname} (ref ${projectRefOf(dbUrl) ?? 'unknown'})`
  } catch {
    return '(unparseable database URL)'
  }
}

// ---------- AWS Signature V4 (R2's S3 API) ----------

export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex')
}

function hmac(key, data) {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

export const EMPTY_SHA256 = sha256Hex('')

export function encodeRfc3986(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

/** S3 canonical URI: each path segment encoded once, slashes kept. */
export function canonicalUri(path) {
  return path.split('/').map(encodeRfc3986).join('/')
}

export function canonicalQuery(query = {}) {
  return Object.entries(query)
    .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v ?? '')])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
}

/**
 * Sign one request. Returns the full header set to send (including host,
 * x-amz-date, x-amz-content-sha256 and authorization) and the URL.
 */
export function signV4({
  method, host, path, query = {}, headers = {}, payloadHash = EMPTY_SHA256,
  accessKeyId, secretAccessKey, region = 'auto', service = 's3', date = new Date(),
}) {
  const amzDate = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const day = amzDate.slice(0, 8)
  const all = { ...headers, host, 'x-amz-date': amzDate, 'x-amz-content-sha256': payloadHash }
  const lower = Object.fromEntries(Object.entries(all).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')]))
  const names = Object.keys(lower).sort()
  const canonicalHeaders = names.map((n) => `${n}:${lower[n]}\n`).join('')
  const signedHeaders = names.join(';')
  const cUri = canonicalUri(path)
  const cQuery = canonicalQuery(query)
  const canonicalRequest = [method, cUri, cQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const scope = `${day}/${region}/${service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')
  const kDate = hmac(`AWS4${secretAccessKey}`, day)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, service)
  const kSigning = hmac(kService, 'aws4_request')
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex')
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  const headersOut = { ...lower, authorization }
  delete headersOut.host // fetch sets Host itself and refuses an explicit one
  return {
    url: `https://${host}${cUri}${cQuery ? `?${cQuery}` : ''}`,
    headers: headersOut,
    signature,
    canonicalRequest,
    stringToSign,
  }
}

export function r2Host(accountId) {
  if (!/^[0-9a-f]{32}$/.test(accountId)) throw new Error('R2_ACCOUNT_ID must be the 32-character Cloudflare account id')
  return `${accountId}.r2.cloudflarestorage.com`
}

/** Minimal ListObjectsV2 reader: keys + continuation token. */
export function parseListObjects(xml) {
  const keys = [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) => m[1]
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'))
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml)
  const token = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1] ?? null
  return { keys, next: truncated ? token : null }
}

/** Does a GetBucketLifecycleConfiguration body expire the nightly prefix within the window? */
export function lifecycleCovers(xml, prefix = NIGHTLY_PREFIX, maxDays = RETENTION_DAYS) {
  const rules = [...xml.matchAll(/<Rule>([\s\S]*?)<\/Rule>/g)].map((m) => m[1])
  return rules.some((r) => {
    if (/<Status>\s*Disabled\s*<\/Status>/.test(r)) return false
    const p = /<Prefix>([^<]*)<\/Prefix>/.exec(r)?.[1] ?? ''
    const days = Number(/<Expiration>[\s\S]*?<Days>(\d+)<\/Days>/.exec(r)?.[1])
    return prefix.startsWith(p) && Number.isFinite(days) && days > 0 && days <= maxDays
  })
}

// ---------- manifest ----------

/**
 * Stored unencrypted next to the run so a restore can verify before it
 * decrypts. Holds no data and no secret: names, sizes, hashes, public keys.
 */
export function buildManifest({ date, projectRef, tool, recipients, files, dryRun = false }) {
  return {
    format: 'nixgen-db-backup/1',
    created_at: date.toISOString(),
    project_ref: projectRef,
    tool,
    encryption: { scheme: 'age', recipients },
    compression: 'gzip',
    retention_days: RETENTION_DAYS,
    dry_run: dryRun,
    files: files.map((f) => ({ part: f.part, object: f.object, bytes: f.bytes, sha256: f.sha256, plain_bytes: f.plainBytes })),
  }
}

/** `--flag value`, `--flag=value`; names in `booleans` never take a value. */
export function parseArgs(argv, booleans = []) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) { out._.push(a); continue }
    const eq = a.indexOf('=')
    if (eq > 0) { out[a.slice(2, eq)] = a.slice(eq + 1); continue }
    const name = a.slice(2)
    const next = argv[i + 1]
    if (!booleans.includes(name) && next !== undefined && !next.startsWith('--')) { out[name] = next; i++ } else out[name] = true
  }
  return out
}
