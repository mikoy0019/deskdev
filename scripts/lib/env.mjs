// The one place repo tooling finds secrets. Dependency-free (node:util parseEnv).
//
// Chain, first file wins per key:
//   1. <repo>/.env.local             THE env file (gitignored by `.env.*`)
//   2. <repo>/web/.env.local         legacy: where the file lived before the move
//   3. <repo>/automation/.env.local  legacy: the old n8n-only file
// DESKDEV_ENV_FILE (or N8N_ENV_FILE, kept for the n8n scripts) replaces the
// whole chain with one file: an outside-the-repo path, a second instance, tests.
//
// A non-empty variable already in the environment beats every file; an empty
// one does not (an exported `KEY=` placeholder would otherwise hide the value).
// When a key is served from a legacy file, one line on stderr says so; the
// legacy entries go once the owner has moved web/.env.local to the root.
//
// writeEnvKey only ever edits a file that already exists. It never creates one:
// a stray new root .env.local holding one key would sit first in the chain and
// make the real file look half-empty. The edit goes through a sibling temp file
// and a rename, so the file that holds every secret is never left half-written.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * The files to read, in order. `env` is only consulted for the override
 * variables, so tests can pass a plain object.
 * @returns {{ file: string, legacy: boolean, override: boolean }[]}
 */
export function envChain({ root = REPO_ROOT, env = process.env } = {}) {
  const override = env.DESKDEV_ENV_FILE || env.N8N_ENV_FILE
  if (override) return [{ file: path.resolve(root, override), legacy: false, override: true }]
  return [
    { file: path.join(root, '.env.local'), legacy: false, override: false },
    { file: path.join(root, 'web', '.env.local'), legacy: true, override: false },
    { file: path.join(root, 'automation', '.env.local'), legacy: true, override: false },
  ]
}

/**
 * Every key the chain defines, first file winning, without touching the
 * environment. Empty values are skipped so a later file can still fill them.
 * @returns {{ values: Record<string, string>, sources: Record<string, string>, chain: ReturnType<typeof envChain> }}
 */
export function readEnvChain(opts = {}) {
  const chain = envChain(opts)
  const values = {}
  const sources = {}
  for (const { file } of chain) {
    if (!fs.existsSync(file)) continue
    for (const [k, v] of Object.entries(parseEnv(fs.readFileSync(file, 'utf8')))) {
      if (v && !(k in values)) {
        values[k] = v
        sources[k] = file
      }
    }
  }
  return { values, sources, chain }
}

/**
 * Fills `into` (process.env by default) from the chain. Returns which file
 * served each key it set, and the legacy files that were actually used.
 */
export function loadEnv({ root = REPO_ROOT, env = process.env, into = env, warn = (m) => console.warn(m) } = {}) {
  const { values, sources, chain } = readEnvChain({ root, env })
  const loaded = {}
  for (const [k, v] of Object.entries(values)) {
    if (into[k]) continue
    into[k] = v
    loaded[k] = sources[k]
  }

  const rel = (f) => path.relative(root, f) || f
  const [first] = chain
  if (first.override && !fs.existsSync(first.file)) {
    warn(`env: ${env.DESKDEV_ENV_FILE ? 'DESKDEV_ENV_FILE' : 'N8N_ENV_FILE'} points at ${first.file}, which does not exist; no env file was read.`)
  }
  const legacyUsed = chain.filter((c) => c.legacy && Object.values(loaded).includes(c.file)).map((c) => c.file)
  for (const file of legacyUsed) {
    const n = Object.values(loaded).filter((f) => f === file).length
    warn(`env: ${n} key${n === 1 ? '' : 's'} came from legacy ${rel(file)}. Move it to .env.local at the repo root (AGENTS.md → "The env file").`)
  }
  return { loaded, legacyUsed, chain }
}

/** The file writeEnvKey would edit: the first one in the chain that exists, else null. */
export function primaryEnvFile(opts = {}) {
  return envChain(opts).find((c) => fs.existsSync(c.file))?.file ?? null
}

function assertEnvPair(key, value) {
  if (!KEY_RE.test(key)) throw new Error(`writeEnvKey: "${key}" is not a valid env key`)
  if (/[\r\n]/.test(String(value))) throw new Error(`writeEnvKey: the value for ${key} spans lines`)
}

/**
 * The text of an env file with KEY=value set, without touching the disk.
 * Replaces the key's line(s) in place, keeps the file's line endings, otherwise
 * appends.
 */
export function setEnvKeyText(before, key, value) {
  assertEnvPair(key, value)
  const text = String(value)
  const eol = before.includes('\r\n') ? '\r\n' : '\n'
  // Every line defining the key, so a duplicate further down cannot keep the old value.
  const line = () => new RegExp(`^(export\\s+)?${key}\\s*=.*$`, 'gm')
  return line().test(before)
    ? before.replace(line(), (_m, exp) => `${exp ?? ''}${key}=${text}`)
    : `${before}${before && !before.endsWith('\n') ? eol : ''}${key}=${text}${eol}`
}

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/**
 * Replaces a file's content so that a crash or a full disk can never leave it
 * half-written: the new text goes to a sibling temp file, which is renamed over
 * the target. The file behind a symlink is the one replaced. A file with more
 * than one hard link is written in place instead, or the other names would
 * keep the old content.
 *
 * Windows refuses to rename over a file that any program has open, although it
 * allows writing to it. After a few tries the target is then written in place,
 * while the temp file still holds the complete new text: if that write is cut
 * short, nothing is lost, and the temp file is only removed once the target
 * reads back.
 */
function replaceFile(target, text) {
  const real = fs.realpathSync(target)
  const stat = fs.statSync(real)
  const bytes = Buffer.from(text, 'utf8')
  const tmp = `${real}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
  const held = (error) => ['EPERM', 'EBUSY', 'EACCES'].includes(error?.code)

  // 1. The complete new text, next to the target. If it cannot be written,
  //    nothing else is tried and no partial copy is left behind.
  try {
    fs.writeFileSync(tmp, bytes, { mode: stat.mode & 0o777, flag: 'wx' })
  } catch (error) {
    // EEXIST: a file of that name is someone else's, so it is left alone.
    if (error?.code !== 'EEXIST') fs.rmSync(tmp, { force: true })
    throw error
  }

  // 2. Swap it in. A file with other hard links is never swapped, or its other
  //    names would keep the old content; it goes straight to step 3.
  let fd = null
  try {
    if (stat.nlink === 1) {
      for (let attempt = 0; attempt < 4; attempt++) {
        if (attempt) pause(100)
        try {
          fs.renameSync(tmp, real)
          return
        } catch (error) {
          if (!held(error)) throw error
        }
      }
    }
    // Opening for update does not truncate, and fails when the target is
    // read-only or locked: up to here the target is untouched.
    fd = fs.openSync(real, 'r+')
  } catch (error) {
    fs.rmSync(tmp, { force: true })
    throw error
  }

  // 3. In place. The temp file stays until the target reads back, and the
  //    error names it. The new text is written from the start, so an edit that
  //    only appends leaves every old byte where it was. It is padded with blank
  //    lines up to the old length before the cut: when the cut is refused (a
  //    program that maps the file), what remains below the new text is blank
  //    lines, never the tail of the old file, which could define a key again.
  const padded = stat.size > bytes.length ? Buffer.concat([bytes, Buffer.alloc(stat.size - bytes.length, 0x0a)]) : bytes
  let cut = false
  let failure = null
  try {
    for (let written = 0; written < padded.length;) written += fs.writeSync(fd, padded, written, padded.length - written, written)
    try {
      fs.ftruncateSync(fd, bytes.length)
      cut = true
    } catch {
      // the padding is already in place
    }
    fs.fsyncSync(fd)
  } catch (error) {
    failure = error
  }
  try {
    fs.closeSync(fd)
  } catch (error) {
    failure ??= error
  }
  let landed = false
  if (!failure) {
    try {
      landed = fs.readFileSync(real).equals(cut ? bytes : padded)
    } catch {
      landed = false
    }
  }
  if (!landed) {
    throw Object.assign(new Error(`the env file may be half-written after an in-place write; its complete new content is in ${tmp}`), { code: failure?.code })
  }
  fs.rmSync(tmp, { force: true })
}

/**
 * Temp files an interrupted write left next to an env file (see replaceFile).
 * Each one holds a copy of that file, so a tool that is about to write should
 * tell the owner about them. Never deleted here.
 * @returns {string[]}
 */
export function staleEnvTemps(file) {
  try {
    const real = fs.realpathSync(file)
    const prefix = `${path.basename(real)}.tmp-`
    return fs.readdirSync(path.dirname(real)).filter((name) => name.startsWith(prefix)).map((name) => path.join(path.dirname(real), name))
  } catch {
    return []
  }
}

/**
 * Sets several KEY=value pairs in an existing env file in ONE write (by default
 * the first existing file in the chain, so the values land where they will
 * also be read first). Either every pair is in the file afterwards or the file
 * is unchanged. Throws instead of creating a file.
 * @param {Record<string, string>} pairs
 * @returns {string} the file written
 */
export function writeEnvKeys(pairs, { file, ...opts } = {}) {
  const entries = Object.entries(pairs)
  for (const [key, value] of entries) assertEnvPair(key, value)
  const target = file ? path.resolve(opts.root ?? REPO_ROOT, file) : (primaryEnvFile(opts) ?? envChain(opts)[0].file)
  if (!fs.existsSync(target)) {
    throw new Error(`writeEnvKey: no env file to write ${entries.map(([key]) => key).join(', ')} to (${target} does not exist). Create it first; this never creates one.`)
  }
  const before = fs.readFileSync(target, 'utf8')
  let after = before
  for (const [key, value] of entries) after = setEnvKeyText(after, key, value)
  if (after !== before) replaceFile(target, after)
  return target
}

/**
 * Sets KEY=value in an existing env file: writeEnvKeys for one pair.
 * @returns {string} the file written
 */
export function writeEnvKey(key, value, options = {}) {
  return writeEnvKeys({ [key]: value }, options)
}
