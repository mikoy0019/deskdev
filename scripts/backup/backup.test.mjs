// node --test scripts/backup/*.test.mjs   (no database, no R2, no network)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  EMPTY_SHA256, PROD_PROJECT_REF, assertRestoreTarget, buildManifest, canonicalQuery, describeDbUrl,
  latestRun, lifecycleCovers, missingEnv, parseArgs, parseListObjects, parseRecipients, projectRefOf,
  r2Host, runAgeDays, runPrefix, sha256Hex, signV4, stamp,
} from './lib.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))

// ---------- SigV4: AWS's published S3 examples ----------
// https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
const AWS = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  date: new Date('2013-05-24T00:00:00Z'),
  host: 'examplebucket.s3.amazonaws.com',
}

test('sigv4: GET object with Range (AWS example)', () => {
  const s = signV4({ ...AWS, method: 'GET', path: '/test.txt', headers: { range: 'bytes=0-9' } })
  assert.equal(s.signature, 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41')
  assert.match(s.headers.authorization, /SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,/)
  assert.equal(s.headers.host, undefined, 'fetch sets Host itself')
})

test('sigv4: PUT object with an encoded key and payload hash (AWS example)', () => {
  const body = 'Welcome to Amazon S3.'
  const s = signV4({
    ...AWS, method: 'PUT', path: '/test$file.text', payloadHash: sha256Hex(body),
    headers: { date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' },
  })
  assert.equal(sha256Hex(body), '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072')
  assert.equal(s.signature, '98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd')
  assert.equal(s.url, 'https://examplebucket.s3.amazonaws.com/test%24file.text')
})

test('sigv4: GET ?lifecycle and list with query (AWS examples)', () => {
  const lc = signV4({ ...AWS, method: 'GET', path: '/', query: { lifecycle: '' } })
  assert.equal(lc.signature, 'fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543')
  const list = signV4({ ...AWS, method: 'GET', path: '/', query: { prefix: 'J', 'max-keys': '2' } })
  assert.equal(list.signature, '34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7')
  assert.equal(list.url, 'https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J')
})

test('sigv4 helpers: empty hash, query encoding, R2 host', () => {
  assert.equal(EMPTY_SHA256, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  assert.equal(canonicalQuery({ prefix: 'nightly/2026 x', 'list-type': '2' }), 'list-type=2&prefix=nightly%2F2026%20x')
  assert.equal(r2Host('5c6cabb0e7c2e306c3dd792599736a46'), '5c6cabb0e7c2e306c3dd792599736a46.r2.cloudflarestorage.com')
  assert.throws(() => r2Host('not-an-id'), /32-character/)
})

// ---------- naming / listing / lifecycle ----------

test('naming: run prefixes sort by time and sit under nightly/', () => {
  const d = new Date('2026-10-03T19:00:07.123Z')
  assert.equal(stamp(d), '20261003T190007Z')
  assert.equal(runPrefix(d), 'nightly/2026/10/03/20261003T190007Z/')
  const keys = [
    'nightly/2026/10/02/20261002T190001Z/manifest.json',
    'nightly/2026/10/03/20261003T190007Z/data.sql.gz.age',     // unfinished run: no manifest
    'nightly/2026/10/01/20261001T190003Z/manifest.json',
  ]
  assert.equal(latestRun(keys), 'nightly/2026/10/02/20261002T190001Z/')
  assert.equal(latestRun([]), null)
  assert.equal(Math.round(runAgeDays('nightly/2026/10/01/20261001T190003Z/', new Date('2026-11-05T19:00:03Z'))), 35)
})

test('listing + lifecycle XML', () => {
  const xml = '<ListBucketResult><IsTruncated>true</IsTruncated><Contents><Key>nightly/a&amp;b/manifest.json</Key></Contents><NextContinuationToken>tok==</NextContinuationToken></ListBucketResult>'
  assert.deepEqual(parseListObjects(xml), { keys: ['nightly/a&b/manifest.json'], next: 'tok==' })
  const rule = (prefix, days, status = 'Enabled') => `<Rule><ID>x</ID><Status>${status}</Status><Filter><Prefix>${prefix}</Prefix></Filter><Expiration><Days>${days}</Days></Expiration></Rule>`
  assert.equal(lifecycleCovers(`<LifecycleConfiguration>${rule('nightly/', 35)}</LifecycleConfiguration>`), true)
  assert.equal(lifecycleCovers(`<LifecycleConfiguration>${rule('', 30)}</LifecycleConfiguration>`), true, 'bucket-wide rule counts')
  assert.equal(lifecycleCovers(`<LifecycleConfiguration>${rule('nightly/', 90)}</LifecycleConfiguration>`), false, 'too long')
  assert.equal(lifecycleCovers(`<LifecycleConfiguration>${rule('nightly/', 35, 'Disabled')}</LifecycleConfiguration>`), false)
  assert.equal(lifecycleCovers(`<LifecycleConfiguration>${rule('other/', 1)}</LifecycleConfiguration>`), false)
})

// ---------- age / env / args ----------

test('recipients: only age1 public keys, deduped; never an identity', () => {
  const k = `age1${'q'.repeat(58)}`
  assert.deepEqual(parseRecipients(`${k}, ${k}\n# comment`), [k])
  assert.throws(() => parseRecipients(''), /no age1/)
  assert.throws(() => parseRecipients(`AGE-SECRET-KEY-1${'Q'.repeat(58)}`), /not age1/)
})

test('env + args', () => {
  assert.deepEqual(missingEnv({ A: 'x', B: '  ' }, ['A', 'B', 'C']), ['B', 'C'])
  assert.deepEqual(parseArgs(['fetch', '--latest', '--out', 'dir', '--run=nightly/x/'], ['latest']), { _: ['fetch'], latest: true, out: 'dir', run: 'nightly/x/' })
  assert.deepEqual(parseArgs(['--dry-run', 'pos'], ['dry-run']), { _: ['pos'], 'dry-run': true })
})

// ---------- restore safety ----------

const POOLER = `postgresql://postgres.${PROD_PROJECT_REF}:s3cr3t-pw@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`
const DIRECT = `postgresql://postgres:s3cr3t-pw@db.${PROD_PROJECT_REF}.supabase.co:5432/postgres`
const STAGING = 'postgresql://postgres.abcdefghijklmnopqrst:pw@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres'
const LOCAL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

test('project ref from pooler and direct URLs', () => {
  assert.equal(projectRefOf(POOLER), PROD_PROJECT_REF)
  assert.equal(projectRefOf(DIRECT), PROD_PROJECT_REF)
  assert.equal(projectRefOf(STAGING), 'abcdefghijklmnopqrst')
  assert.equal(projectRefOf(LOCAL), null)
})

test('restore guard: production refused unless flag AND typed confirmation', () => {
  assert.throws(() => assertRestoreTarget(POOLER), /Refusing to restore into the production project/)
  assert.throws(() => assertRestoreTarget(DIRECT, { allowProduction: true }), /RESTORE_CONFIRM/)
  assert.throws(() => assertRestoreTarget(DIRECT, { confirm: PROD_PROJECT_REF }), /Refusing/)
  assert.equal(assertRestoreTarget(DIRECT, { allowProduction: true, confirm: PROD_PROJECT_REF }).production, true)
  assert.equal(assertRestoreTarget(STAGING).production, false)
  assert.equal(assertRestoreTarget(LOCAL).production, false)
})

test('describeDbUrl never prints the password', () => {
  const d = describeDbUrl(POOLER)
  assert.ok(!d.includes('s3cr3t'))
  assert.match(d, /pooler\.supabase\.com:5432\/postgres \(ref rgasjotvqwkjbeivlhvn\)/)
})

test('manifest holds no secret material', () => {
  const m = buildManifest({
    date: new Date('2026-10-03T19:00:00Z'), projectRef: PROD_PROJECT_REF, tool: 'supabase',
    recipients: [`age1${'q'.repeat(58)}`],
    files: [{ part: 'data.sql', object: 'data.sql.gz.age', bytes: 10, sha256: 'ab', plainBytes: 20, path: '/tmp/x' }],
  })
  assert.equal(m.format, 'nixgen-db-backup/1')
  assert.equal(m.retention_days, 35)
  assert.equal(m.files[0].path, undefined, 'local paths stay local')
  assert.ok(!JSON.stringify(m).includes('pw'))
})

// ---------- CLI round trip (dry run, no age, no DB, no network) ----------

function node(script, argv, env = {}) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(BACKUP_|R2_|RESTORE_|AGE_BIN)/.test(k)))
  return spawnSync(process.execPath, [join(here, script), ...argv], { encoding: 'utf8', env: { ...clean, AGE_BIN: 'age-binary-that-does-not-exist', ...env } })
}

test('CLI: backup --dry-run -> restore fetch --from-dir -> apply guard', () => {
  const root = mkdtempSync(join(tmpdir(), 'nixgen-backup-test-'))
  try {
    const work = join(root, 'work')
    const b = node('backup.mjs', ['--dry-run', '--work-dir', work], {
      R2_ACCOUNT_ID: '5c6cabb0e7c2e306c3dd792599736a46', R2_ACCESS_KEY_ID: 'AKIDTESTONLY', R2_SECRET_ACCESS_KEY: 'TOPSECRETVALUE',
    })
    assert.equal(b.status, 0, b.stderr + b.stdout)
    const all = b.stdout + b.stderr
    assert.ok(!all.includes('TOPSECRETVALUE'), 'secret never printed')
    assert.ok(!all.includes('5c6cabb0e7c2e306c3dd792599736a46'), 'account id masked in the plan')
    assert.match(all, /would PUT https:\/\/<account>\.r2\.cloudflarestorage\.com\/nixgen-db-backups\/nightly\/\d{4}\/\d{2}\/\d{2}\/\d{8}T\d{6}Z\/roles\.sql\.gz/)
    assert.match(all, /manifest\.json/)
    assert.deepEqual(readdirSync(work).sort(), ['data.sql.gz', 'manifest.json', 'roles.sql.gz', 'schema.sql.gz'], 'plaintext dumps removed, gz + manifest kept')

    const out = join(root, 'restored')
    const f = node('restore.mjs', ['fetch', '--from-dir', work, '--out', out])
    assert.equal(f.status, 0, f.stderr + f.stdout)
    assert.match(readFileSync(join(out, 'data.sql'), 'utf8'), /COPY public\.example/)

    // tamper -> refused before decrypting
    const tampered = join(root, 'tampered')
    spawnSync(process.execPath, ['-e', `require('fs').cpSync(${JSON.stringify(work)}, ${JSON.stringify(tampered)}, {recursive:true})`])
    writeFileSync(join(tampered, 'data.sql.gz'), 'not the same bytes')
    const t = node('restore.mjs', ['fetch', '--from-dir', tampered, '--out', join(root, 'x')])
    assert.notEqual(t.status, 0)
    assert.match(t.stderr, /does not match the manifest/)

    const prod = node('restore.mjs', ['apply', '--dir', out, '--dry-run'], { RESTORE_DATABASE_URL: POOLER })
    assert.notEqual(prod.status, 0)
    assert.match(prod.stderr, /Refusing to restore into the production project/)

    const ok = node('restore.mjs', ['apply', '--dir', out, '--dry-run'], { RESTORE_DATABASE_URL: LOCAL })
    assert.equal(ok.status, 0, ok.stderr)
    assert.match(ok.stdout, /--single-transaction/)
    assert.match(ok.stdout, /SET session_replication_role = replica/)
    assert.ok(!ok.stdout.includes('postgres:postgres@'), 'target URL not echoed')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('CLI: a run that fails mid-dump leaves no temp files behind', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'nixgen-backup-fail-'))
  try {
    // `node --version` passes the binary checks; `node db dump …` then fails
    // like a broken supabase CLI would, after the work dir exists.
    const r = node('backup.mjs', [], {
      AGE_BIN: process.execPath, SUPABASE_BIN: process.execPath,
      BACKUP_DATABASE_URL: 'postgresql://postgres:pw@127.0.0.1:1/postgres',
      BACKUP_AGE_RECIPIENTS: `age1${'q'.repeat(58)}`,
      R2_ACCOUNT_ID: '5c6cabb0e7c2e306c3dd792599736a46', R2_ACCESS_KEY_ID: 'AKIDTESTONLY', R2_SECRET_ACCESS_KEY: 'TOPSECRETVALUE',
      TMPDIR: tmp, TEMP: tmp, TMP: tmp,
    })
    assert.equal(r.status, 1)
    assert.match(r.stderr, /FAIL roles: .* exited with/)
    assert.ok(!(r.stdout + r.stderr).includes('pw@'), 'connection string never printed')
    assert.deepEqual(readdirSync(tmp), [], 'temp work dir removed on failure')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('CLI: a real run refuses to start without its environment', () => {
  const r = node('backup.mjs', [])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /missing environment: BACKUP_DATABASE_URL, BACKUP_AGE_RECIPIENTS, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY/)
})
