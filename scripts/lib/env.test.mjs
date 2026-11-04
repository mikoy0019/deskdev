// node --test 'scripts/**/*.test.mjs'   (CI: .github/workflows/repo-ci.yml)
// Every case builds a throwaway repo root in the OS temp dir; no real env file is read.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { envChain, loadEnv, primaryEnvFile, readEnvChain, setEnvKeyText, writeEnvKey, writeEnvKeys } from './env.mjs'

let root
const put = (rel, text) => {
  const file = path.join(root, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
  return file
}
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const quiet = () => {
  const lines = []
  return { warn: (m) => { lines.push(m) }, lines }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'deskdev-env-'))
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

test('chain order: root, then legacy web/, then legacy automation/', () => {
  const chain = envChain({ root, env: {} })
  assert.deepEqual(chain.map((c) => path.relative(root, c.file)), ['.env.local', path.join('web', '.env.local'), path.join('automation', '.env.local')])
  assert.deepEqual(chain.map((c) => c.legacy), [false, true, true])
})

test('first file wins per key; later files only fill gaps; empty values do not count', () => {
  put('.env.local', 'A=root\nB=\n')
  put('web/.env.local', 'A=web\nB=web-b\nC=web-c\n')
  put('automation/.env.local', 'C=auto\nD=auto-d\n')
  const { values, sources } = readEnvChain({ root, env: {} })
  assert.deepEqual(values, { A: 'root', B: 'web-b', C: 'web-c', D: 'auto-d' })
  assert.equal(sources.A, path.join(root, '.env.local'))
  assert.equal(sources.D, path.join(root, 'automation', '.env.local'))
})

test('a non-empty environment variable beats the files; an empty one does not', () => {
  put('.env.local', 'A=file\nB=file\n')
  const into = { A: 'from-env', B: '' }
  const { warn } = quiet()
  loadEnv({ root, env: {}, into, warn })
  assert.equal(into.A, 'from-env')
  assert.equal(into.B, 'file')
})

test('warns once per legacy file actually used, naming no values', () => {
  put('web/.env.local', 'SECRET_ONE=s3cr3t\nSECRET_TWO=hunter2\n')
  const into = {}
  const { warn, lines } = quiet()
  const { legacyUsed } = loadEnv({ root, env: {}, into, warn })
  assert.equal(into.SECRET_ONE, 's3cr3t')
  assert.deepEqual(legacyUsed, [path.join(root, 'web', '.env.local')])
  assert.equal(lines.length, 1)
  assert.match(lines[0], /2 keys came from legacy web[\\/]\.env\.local/)
  assert.doesNotMatch(lines[0], /s3cr3t|hunter2/)
})

test('no warning when the root file serves everything', () => {
  put('.env.local', 'A=1\n')
  put('web/.env.local', 'A=2\n')
  const { warn, lines } = quiet()
  loadEnv({ root, env: {}, into: {}, warn })
  assert.deepEqual(lines, [])
})

test('DESKDEV_ENV_FILE replaces the chain, and beats N8N_ENV_FILE', () => {
  put('.env.local', 'A=root\n')
  const outside = put('elsewhere/secrets.env', 'A=outside\n')
  put('n8n.env', 'A=n8n\n')
  assert.equal(readEnvChain({ root, env: { DESKDEV_ENV_FILE: outside, N8N_ENV_FILE: 'n8n.env' } }).values.A, 'outside')
  assert.equal(readEnvChain({ root, env: { N8N_ENV_FILE: 'n8n.env' } }).values.A, 'n8n')
  assert.equal(envChain({ root, env: { N8N_ENV_FILE: 'n8n.env' } }).length, 1)
})

test('an override pointing at a missing file warns and reads nothing', () => {
  put('.env.local', 'A=root\n')
  const into = {}
  const { warn, lines } = quiet()
  loadEnv({ root, env: { DESKDEV_ENV_FILE: 'nope.env' }, into, warn })
  assert.equal(into.A, undefined)
  assert.match(lines[0], /DESKDEV_ENV_FILE points at .*nope\.env/)
})

test('quotes and comments are parsed like dotenv', () => {
  put('.env.local', '# comment\nA="quoted value"\nB=\'single\'\nC=plain # trailing\n')
  const { values } = readEnvChain({ root, env: {} })
  assert.equal(values.A, 'quoted value')
  assert.equal(values.B, 'single')
  assert.equal(values.C, 'plain')
})

test('writeEnvKey replaces in place in the first existing file, keeping CRLF', () => {
  put('web/.env.local', 'A=1\r\nN8N_BASE_URL=https://old.example\r\nZ=9\r\n')
  const written = writeEnvKey('N8N_BASE_URL', 'https://new.example', { root, env: {} })
  assert.equal(written, path.join(root, 'web', '.env.local'))
  assert.equal(read('web/.env.local'), 'A=1\r\nN8N_BASE_URL=https://new.example\r\nZ=9\r\n')
})

test('writeEnvKey appends a missing key, adding the newline the file lacked', () => {
  put('.env.local', 'A=1')
  writeEnvKey('B', 'two', { root, env: {} })
  assert.equal(read('.env.local'), 'A=1\nB=two\n')
})

test('writeEnvKey prefers the root file over legacy ones once it exists', () => {
  put('.env.local', 'A=1\n')
  put('web/.env.local', 'B=2\n')
  assert.equal(primaryEnvFile({ root, env: {} }), path.join(root, '.env.local'))
  writeEnvKey('B', 'three', { root, env: {} })
  assert.equal(read('.env.local'), 'A=1\nB=three\n')
  assert.equal(read('web/.env.local'), 'B=2\n')
})

test('writeEnvKey rewrites every duplicate line and keeps an export prefix', () => {
  put('.env.local', 'export K=a\nX=1\nK=b\n')
  writeEnvKey('K', 'c$&d', { root, env: {} })
  assert.equal(read('.env.local'), 'export K=c$&d\nX=1\nK=c$&d\n')
})

test('writeEnvKey fills an empty placeholder line in place, and the chain then serves it', () => {
  put('web/.env.local', 'A=1\nGOOGLE_TOKEN_KEYS=\nZ=9\n')
  assert.equal('GOOGLE_TOKEN_KEYS' in readEnvChain({ root, env: {} }).values, false)
  writeEnvKey('GOOGLE_TOKEN_KEYS', 'k1:AbC+/=', { root, env: {} })
  assert.equal(read('web/.env.local'), 'A=1\nGOOGLE_TOKEN_KEYS=k1:AbC+/=\nZ=9\n')
  const { values, sources } = readEnvChain({ root, env: {} })
  assert.equal(values.GOOGLE_TOKEN_KEYS, 'k1:AbC+/=')
  assert.equal(sources.GOOGLE_TOKEN_KEYS, path.join(root, 'web', '.env.local'))
  assert.deepEqual(Object.keys(values).sort(), ['A', 'GOOGLE_TOKEN_KEYS', 'Z'])
})

test('setEnvKeyText is the same edit without the disk', () => {
  assert.equal(setEnvKeyText('A=1\nB=2\n', 'B', 'two'), 'A=1\nB=two\n')
  assert.equal(setEnvKeyText('A=1', 'B', 'two'), 'A=1\nB=two\n')
  assert.equal(setEnvKeyText('', 'A', '1'), 'A=1\n')
  assert.equal(setEnvKeyText('A=1\r\n', 'B', '2'), 'A=1\r\nB=2\r\n')
  // a key that is the prefix of another one touches only its own line
  assert.equal(setEnvKeyText('GOOGLE_TOKEN_KEYS=x\nGOOGLE_TOKEN_KEY_ID=k1\n', 'GOOGLE_TOKEN_KEY', 'y'), 'GOOGLE_TOKEN_KEYS=x\nGOOGLE_TOKEN_KEY_ID=k1\nGOOGLE_TOKEN_KEY=y\n')
  assert.throws(() => setEnvKeyText('', 'A', 'x\ny'), /spans lines/)
})

test('writeEnvKeys sets several keys in one write and leaves no temp file behind', () => {
  put('web/.env.local', '# secrets\nA=1\nVAPID_PUBLIC_KEY=\nZ=9\n')
  const written = writeEnvKeys({ VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:team@example.com' }, { root, env: {} })
  assert.equal(written, path.join(root, 'web', '.env.local'))
  assert.equal(read('web/.env.local'), '# secrets\nA=1\nVAPID_PUBLIC_KEY=pub\nZ=9\nVAPID_PRIVATE_KEY=priv\nVAPID_SUBJECT=mailto:team@example.com\n')
  assert.deepEqual(fs.readdirSync(path.join(root, 'web')), ['.env.local'])
})

test('writeEnvKeys writes nothing when one pair is invalid', () => {
  put('.env.local', 'A=1\n')
  assert.throws(() => writeEnvKeys({ B: 'ok', C: 'two\nlines' }, { root, env: {} }), /spans lines/)
  assert.equal(read('.env.local'), 'A=1\n')
  assert.deepEqual(fs.readdirSync(root), ['.env.local'])
})

test('writeEnvKey keeps a hard-linked copy in step instead of splitting the two names', () => {
  const file = put('.env.local', 'A=1\n')
  const twin = path.join(root, 'twin.env')
  fs.linkSync(file, twin)
  writeEnvKey('B', '2', { root, env: {} })
  assert.equal(fs.readFileSync(twin, 'utf8'), 'A=1\nB=2\n')
  assert.equal(read('.env.local'), 'A=1\nB=2\n')
})

test('a write that cannot land leaves the file byte-identical and no temp file behind', { skip: process.platform !== 'win32' && 'the read-only attribute blocks a replace only on Windows' }, () => {
  const file = put('.env.local', 'A=1\nB=2\n')
  fs.chmodSync(file, 0o444)
  try {
    assert.throws(() => writeEnvKey('C', '3', { root, env: {} }))
    assert.equal(read('.env.local'), 'A=1\nB=2\n')
    assert.deepEqual(fs.readdirSync(root), ['.env.local'])
  } finally {
    fs.chmodSync(file, 0o666)
  }
})

test('writeEnvKey still lands while another program has the file open (Windows blocks the rename, not the write)', () => {
  const file = put('.env.local', 'A=1\nLONGER=a value that the edit shortens\n')
  const handle = fs.openSync(file, 'r')
  try {
    writeEnvKey('B', '2', { root, env: {} })
    assert.equal(read('.env.local'), 'A=1\nLONGER=a value that the edit shortens\nB=2\n')
    // an edit that makes the file shorter leaves no tail of the old text behind
    writeEnvKey('LONGER', 'x', { root, env: {} })
    assert.equal(read('.env.local'), 'A=1\nLONGER=x\nB=2\n')
  } finally {
    fs.closeSync(handle)
  }
  assert.deepEqual(fs.readdirSync(root), ['.env.local'])
})

test('writeEnvKey never creates a file', () => {
  assert.throws(() => writeEnvKey('A', '1', { root, env: {} }), /never creates one/)
  assert.equal(fs.existsSync(path.join(root, '.env.local')), false)
  assert.throws(() => writeEnvKey('A', '1', { root, env: { DESKDEV_ENV_FILE: 'x.env' } }), /does not exist/)
  assert.equal(fs.existsSync(path.join(root, 'x.env')), false)
})

test('writeEnvKey rejects bad keys and multi-line values', () => {
  put('.env.local', '')
  assert.throws(() => writeEnvKey('1BAD', 'x', { root, env: {} }), /not a valid env key/)
  assert.throws(() => writeEnvKey('A', 'x\ny', { root, env: {} }), /spans lines/)
})
