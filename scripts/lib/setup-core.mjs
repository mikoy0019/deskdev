// Everything scripts/setup-integrations.mjs does, except where it gets its
// surroundings from. runSetup() takes those as `deps` (project ref, functions
// host, folders, the CLI, timings), so the real command and the test entry
// (setup-test-entry.mjs) run the same code. The real command has no test mode:
// nothing in the environment can make it talk to a stand-in, and the test
// entry cannot be pointed at the real project (it has its own ref and CLI).

import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { parseEnv } from 'node:util'
import { loadEnv, primaryEnvFile, readEnvChain, staleEnvTemps, writeEnvKeys } from './env.mjs'
import {
  DEV_ORIGIN,
  WORKERS_DEV_ORIGIN,
  answersItself,
  appOriginsDecision,
  calendarAcceptsSecret,
  calendarAnswersConfigured,
  calendarAnswersUnconfigured,
  changedSecrets,
  compareVersions,
  functionState,
  generateVapidPair,
  isAnonKeyFor,
  isSafeEnvValue,
  isTokenKeyring,
  isVapidSubject,
  keyringKids,
  newTokenKeyring,
  oauthClientAction,
  parseArgs,
  proveEnvEdit,
  pushAcceptsSecret,
  pushAnswersConfigured,
  pushAnswersUnconfigured,
  sha256Hex,
  vapidPairMatches,
  vaultUrlAction,
} from './integrations.mjs'

/** DeskDev's Supabase project. */
export const PROJECT_REF = 'rgasjotvqwkjbeivlhvn'
const VAPID_SUBJECT = 'mailto:nixgensolutions@gmail.com'
const SELF = 'node scripts/setup-integrations.mjs'

class Stop extends Error {}
const stop = (message) => { throw new Stop(message) }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const pauseSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const inside = (dir, file) => { const r = path.relative(dir, file); return Boolean(r) && !r.startsWith('..') && !path.isAbsolute(r) }
const readEnvFile = (file) => (fs.existsSync(file) ? parseEnv(fs.readFileSync(file, 'utf8')) : {})
const nonEmpty = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => String(v).trim() !== ''))
const isAlive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return Boolean(error) && error.code === 'EPERM'
  }
}

const BEFORE_WRITES = { tries: 3, wait: ['unreachable', 'unknown'] }
const AFTER_SECRETS = { tries: 30, wait: ['unconfigured', 'unreachable', 'unknown'] }

/** The platform binary from the npx cache, newest version first. Run through no shell and no node shim. */
export function findCli() {
  const caches = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'npm-cache', '_npx'),
    path.join(os.homedir(), '.npm', '_npx'),
  ].filter(Boolean)
  let best = null
  for (const cache of caches) {
    if (!fs.existsSync(cache)) continue
    for (const dir of fs.readdirSync(cache)) {
      const modules = path.join(cache, dir, 'node_modules')
      const pkgFile = path.join(modules, 'supabase', 'package.json')
      const scope = path.join(modules, '@supabase')
      if (!fs.existsSync(pkgFile) || !fs.existsSync(scope)) continue
      const { version } = JSON.parse(fs.readFileSync(pkgFile, 'utf8'))
      for (const name of fs.readdirSync(scope).filter((n) => n.startsWith('cli-'))) {
        const bin = path.join(scope, name, 'bin', process.platform === 'win32' ? 'supabase.exe' : 'supabase')
        if (fs.existsSync(bin) && (!best || compareVersions(version, best.version) > 0)) best = { bin, version }
      }
    }
  }
  return best
}

/** Ports in the range the site's dev servers use that answer right now. */
export async function listeningPorts(from = 6969, to = 6999) {
  const probe = (port) =>
    new Promise((resolve) => {
      const socket = net.connect({ host: 'localhost', port })
      const done = (open) => { socket.destroy(); resolve(open ? port : null) }
      socket.setTimeout(250, () => done(false))
      socket.once('connect', () => done(true))
      socket.once('error', () => done(false))
    })
  const ports = []
  for (let p = from; p <= to; p++) ports.push(probe(p))
  return (await Promise.all(ports)).filter(Boolean)
}

/** True when git can never pick the file up: it is ignored, or it lies outside the repo (DESKDEV_ENV_FILE). */
export function gitIgnored(repoRoot, file) {
  if (!inside(repoRoot, path.resolve(file))) return true
  return spawnSync('git', ['check-ignore', '-q', file], { cwd: repoRoot, shell: false }).status === 0
}

/**
 * @typedef {object} SetupDeps
 * @property {string} ref        the Supabase project ref
 * @property {string} fn         the functions base URL
 * @property {string} root       where site/, web/ and .env.local live
 * @property {string} repoRoot   the git repository (for the ignore check)
 * @property {object} [chain]    options for env.mjs ({} = the real chain)
 * @property {() => ({ bin: string, pre?: string[], version: string } | null)} cli
 * @property {() => Promise<number[]>} ports   dev servers listening right now
 * @property {string} lockFile
 * @property {number} [tick]       ms between probes of a function
 * @property {number} [retryWait]  ms before a CLI call is repeated
 * @property {number} [setWait]    ms between re-reads of the secret digests
 * @property {string} [banner]     printed first (the test entry says what it is)
 * @property {(line?: string) => void} [say]
 * @property {(line: string) => void} [fail]
 */

/**
 * Runs the setup. Never calls process.exit (on Windows that can abort inside
 * libuv while a probe's socket is still closing): the caller sets the code.
 * @param {string[]} argv
 * @param {SetupDeps} deps
 * @returns {Promise<0 | 1 | 2>} 0 done, 1 stopped, 2 ran to the end with something still open
 */
export async function runSetup(argv, deps) {
  const { ref: REF, fn: FN, root: ROOT, repoRoot: REPO } = deps
  const TICK = deps.tick ?? 2000
  const chainOpts = deps.chain ?? {}
  const say = deps.say ?? ((line = '') => console.log(line))
  const fail = deps.fail ?? ((line) => console.error(line))
  const step = (state, label, note = '') => say(`  ${state.padEnd(10)} ${label}${note ? `  (${note})` : ''}`)
  const rel = (file) => (inside(ROOT, file) ? path.relative(ROOT, file).replace(/\\/g, '/') : file)
  const ignored = (file) => gitIgnored(REPO, file)

  const SITE_ENV = path.join(ROOT, 'site', '.env.local')
  const DEV_VARS = path.join(ROOT, 'site', '.dev.vars')
  const ROOT_ENV = path.join(ROOT, '.env.local')
  const LEGACY_ENV = path.join(ROOT, 'web', '.env.local')

  let DRY = false
  let CLI = null
  let cliDir = null
  let lockHeld = false
  /** What the run leaves open. Printed at the end, and also when it stops early. */
  const OPEN = { unfinished: [], owner: [] }
  const report = () => {
    if (OPEN.owner.length) {
      say('\nStill needs the owner:')
      for (const line of OPEN.owner) say(`  - ${line}`)
    }
    if (OPEN.unfinished.length) {
      say(`\n${DRY ? 'Would still be open after a real run' : 'NOT FINISHED'}:`)
      for (const line of OPEN.unfinished) say(`  - ${line}`)
    }
  }

  // ---------------------------------------------------------------- one run at a time

  /** Two live runs at once would each write the secrets file from their own stale copy. */
  function takeLock() {
    const mine = String(process.pid)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        fs.writeFileSync(deps.lockFile, mine, { flag: 'wx' })
        lockHeld = true
        return
      } catch (error) {
        if (!error || error.code !== 'EEXIST') stop('could not create the run lock. Nothing was changed.')
        let other = NaN
        try { other = Number(fs.readFileSync(deps.lockFile, 'utf8')) } catch { /* unreadable: left by a run that is gone */ }
        if (Number.isInteger(other) && other > 0 && other !== process.pid && isAlive(other)) stop(`another run of this script is in progress (process ${other}); two at once would overwrite each other's keys in the env file. Nothing was changed. If no other run exists, delete ${deps.lockFile}`)
        fs.rmSync(deps.lockFile, { force: true })
      }
    }
    stop('could not take the run lock. Nothing was changed.')
  }
  function releaseLock() {
    if (!lockHeld) return
    try { if (fs.readFileSync(deps.lockFile, 'utf8') === String(process.pid)) fs.rmSync(deps.lockFile, { force: true }) } catch { /* already gone */ }
  }

  // ---------------------------------------------------------------- Supabase CLI

  /**
   * The CLI runs in an empty folder of its own, never in the repo: there it
   * would load a root .env.local (and refuse lines Node accepts) and merge
   * [edge_runtime.secrets] from supabase/config.toml into every `secrets set`.
   * It needs neither, because every call names the project.
   *
   * `tries` > 1 only for calls that are safe to repeat: reads, and the Vault
   * statements below, which end in the same state however often they run. The
   * CLI opens a fresh database login per call, and that now and then fails.
   */
  function supabase(args, { tries = 1, cwd } = {}) {
    cliDir ??= fs.mkdtempSync(path.join(os.tmpdir(), 'deskdev-setup-cli-'))
    // The CLI runs outside the repo, so it cannot discover the owner's token
    // in .env.local. Pass only that credential from the shared loader.
    const credentials = { SUPABASE_ACCESS_TOKEN: process.env.SUPABASE_ACCESS_TOKEN }
    loadEnv({ ...chainOpts, into: credentials, warn: () => {} })
    let r = null
    for (let attempt = 0; attempt < tries; attempt++) {
      if (attempt) pauseSync(deps.retryWait ?? 2500)
      r = spawnSync(CLI.bin, [...(CLI.pre ?? []), ...args], {
        cwd: cwd ?? cliDir,
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
        env: {
          ...process.env,
          ...(credentials.SUPABASE_ACCESS_TOKEN ? { SUPABASE_ACCESS_TOKEN: credentials.SUPABASE_ACCESS_TOKEN } : {}),
          SUPABASE_TELEMETRY_DISABLED: '1',
          DO_NOT_TRACK: '1',
        },
      })
      if (r.status === 0) break
    }
    return { ok: r.status === 0, out: r.stdout || '' }
  }

  /** Parses CLI JSON without ever echoing it: the text may hold a decrypted secret. */
  function parseCliJson(out, what) {
    const at = out.search(/[[{]/)
    if (at < 0) stop(`${what}: the Supabase CLI printed no JSON`)
    try {
      return JSON.parse(out.slice(at))
    } catch {
      return stop(`${what}: the Supabase CLI output could not be read`)
    }
  }

  const queryArgs = (file) => ['db', 'query', '--linked', '--project-ref', REF, '-o', 'json', '-f', file]
  function withSqlFile(text, fn) {
    const file = path.join(os.tmpdir(), `deskdev-setup-${process.pid}-${randomBytes(4).toString('hex')}.sql`)
    fs.writeFileSync(file, text)
    try {
      return fn(file)
    } finally {
      fs.rmSync(file, { force: true })
    }
  }

  /** Runs SQL that contains no secret, against this project only. Returns the last statement's rows. */
  function sql(text) {
    return withSqlFile(text, (file) => {
      const r = supabase(queryArgs(file), { tries: 4 })
      if (!r.ok) stop('a database query failed four times in a row (is the Supabase CLI logged in?). Run this again: every step first looks at what is already there.')
      const parsed = parseCliJson(r.out, 'database query')
      if (!Array.isArray(parsed) && parsed._tag === 'Error') stop('a database query was refused')
      return Array.isArray(parsed) ? parsed : parsed.rows || []
    })
  }

  /** One integer from a count query, or a stop: a guard must never pass on a result it cannot read. */
  function count(text, what, part) {
    const n = sql(text)[0]?.n
    if (!Number.isInteger(n)) stop(`could not count ${what}. Nothing was changed for ${part}.`)
    return n
  }

  /** name -> SHA-256 hex of the value, as `supabase secrets list` reports it. */
  function secretDigests() {
    const r = supabase(['secrets', 'list', '--project-ref', REF, '-o', 'json'], { tries: 3 })
    if (!r.ok) stop('could not list the function secrets (is the Supabase CLI logged in?)')
    const parsed = parseCliJson(r.out, 'secrets list')
    const list = Array.isArray(parsed) ? parsed : parsed.secrets
    if (!Array.isArray(list) || !list.every((s) => s && typeof s.name === 'string' && s.name)) stop('secrets list: unexpected shape')
    const map = new Map(list.map((s) => [s.name, typeof s.value === 'string' ? s.value : '']))
    // Every project has this one; its absence means the listing is not what it seems.
    if (!map.has('SUPABASE_URL')) stop('secrets list: SUPABASE_URL is missing, refusing to go on')
    return map
  }

  /**
   * pairs: { NAME: value }. Sends only what differs from the function's current
   * digest, then waits until Supabase lists the new digests. Returns the names.
   */
  async function setSecrets(digests, pairs) {
    const changed = changedSecrets(digests, pairs)
    for (const [name, value] of changed) {
      if (!isSafeEnvValue(value)) stop(`refusing to set ${name}: the value has characters this script does not write`)
    }
    const names = changed.map(([name]) => name)
    if (!changed.length || DRY) return names
    const r = supabase(['secrets', 'set', '--project-ref', REF, ...changed.map(([name, value]) => `${name}=${value}`)])
    if (!r.ok) stop(`setting function secrets failed (${names.join(', ')}). Run this again; what is already set is not sent twice.`)
    let stale = names
    for (let i = 0; i < 6 && stale.length; i++) {
      if (i) await sleep(deps.setWait ?? 1500)
      const now = secretDigests()
      stale = changed.filter(([name, value]) => now.get(name) !== sha256Hex(value)).map(([name]) => name)
    }
    if (stale.length) stop(`${stale.join(', ')} did not read back from Supabase as sent. Run this again.`)
    for (const [name, value] of changed) digests.set(name, sha256Hex(value))
    return names
  }

  const vaultNames = () => new Set(sql('select name from vault.secrets where name is not null').map((r) => r.name))
  const vaultValue = (name) => {
    const rows = sql(`select decrypted_secret as s from vault.decrypted_secrets where name = '${name}'`)
    return rows.length ? rows[0].s : null
  }
  /** A 64-hex random secret born inside the database, unless the row exists. */
  const vaultEnsureRandom = (name) =>
    sql(`do $$ begin if not exists (select 1 from vault.secrets where name = '${name}') then perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), '${name}'); end if; end $$; select 1 as ok`)
  /** Creates or updates a NON-secret Vault row (a function URL). */
  const vaultSetPlain = (name, value) =>
    sql(`do $$ declare v_id uuid; begin select id into v_id from vault.secrets where name = '${name}'; if v_id is null then perform vault.create_secret('${value}', '${name}'); else perform vault.update_secret(v_id, '${value}'); end if; end $$; select 1 as ok`)

  async function post(url, { bearer, body } = {}) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(10000),
      })
      let json = null
      try { json = await r.json() } catch { /* not JSON */ }
      return { status: r.status, json }
    } catch {
      return { status: 0, json: null }
    }
  }

  /** A token-less POST, repeated while the state is one of `wait`. */
  async function probeState(url, body, predicates, { tries, wait }) {
    let state = 'unknown'
    for (let i = 0; i < tries; i++) {
      if (i) await sleep(TICK)
      state = functionState(await post(url, { body }), predicates)
      if (!wait.includes(state)) break
    }
    return state
  }

  /** A bearer POST the function refuses on its body, after it took the secret: no work is done in it. */
  async function acceptsSecret(url, bearer, body, accepted) {
    for (let i = 0; i < 10; i++) {
      if (i) await sleep(TICK)
      if (accepted(await post(url, { bearer, body }))) return true
    }
    return false
  }

  /** Called before anything is written: a part is never set up for a function that is not there. */
  function requireDeployed(name, state, part) {
    const none = `Nothing was changed for ${part}.`
    if (state === 'not-deployed') stop(`the ${name} function is not deployed on this project. ${none} Deploy it first: npx supabase functions deploy ${name} --no-verify-jwt --use-api --project-ref ${REF}`)
    if (state === 'jwt-gateway') stop(`the ${name} function is deployed with JWT verification on, so the database could never call it. ${none} Deploy it again with --no-verify-jwt.`)
    if (state === 'unreachable') stop(`the ${name} function could not be reached. ${none}`)
    if (state === 'unknown') stop(`the ${name} function gave an answer this script does not know. ${none}`)
  }

  /**
   * The Vault row that switches a part on (the URL the database calls). Returns
   * false when it is, and stays, off.
   */
  function vaultSwitch(vault, { name, url, restWasInPlace, resume, onNote, offNote }) {
    const hadUrl = vault.has(name)
    const currentMatches = hadUrl && vaultValue(name) === url
    const action = vaultUrlAction({ hadUrl, currentMatches, restWasInPlace, resume })
    if (action === 'keep') { step('exists', `Vault ${name}`); return true }
    if (action === 'off') { step('OFF', `Vault ${name}`, offNote); return false }
    if (!DRY) {
      vaultSetPlain(name, url)
      if (vaultValue(name) !== url) stop(`Vault ${name} did not read back as written`)
      vault.add(name)
    }
    if (action === 'fix') step(DRY ? 'would fix' : 'fixed', `Vault ${name}`, 'it pointed somewhere else')
    else step(DRY ? 'would set' : 'set', `Vault ${name}`, onNote)
    return true
  }

  // ---------------------------------------------------------------- env files

  /**
   * Adds KEY=value lines to an env file that exists, in one atomic write. The
   * new text is proven BEFORE it is written (the file is valid UTF-8, so nothing
   * is re-encoded; every other key keeps its exact value; each new key reads
   * back), and the file is read back after.
   */
  function saveEnvKeys(file, pairs) {
    const names = Object.keys(pairs).join(', ')
    if (!ignored(file)) stop(`${rel(file)} is not git-ignored. It was not changed.`)
    // A copy an interrupted earlier write left behind holds every secret of the file.
    for (const left of staleEnvTemps(file)) step('WARNING', `${rel(left)} is a leftover copy of ${rel(file)}`, 'from a write that was interrupted; compare it with the file, then delete it')
    let raw = null
    try { raw = fs.readFileSync(file) } catch { stop(`could not read ${rel(file)}`) }
    const proof = proveEnvEdit(raw, pairs)
    if (!proof.ok) stop(`${rel(file)} ${proof.reason}. The file was not changed.`)
    try {
      writeEnvKeys(pairs, { file })
    } catch (error) {
      // env.mjs names the temp file that still holds the complete new text, when there is one (a path, not a value).
      const kept = /its complete new content is in (.+)$/.exec(error instanceof Error ? error.message : '')
      const code = error && error.code ? error.code : 'error'
      if (kept) stop(`writing ${names} to ${rel(file)} was cut short (${code}), so the file may be half-written. Its complete new content is in ${kept[1]}: copy that file over ${rel(file)}.`)
      stop(`could not write ${names} to ${rel(file)} (${code}); is a program holding the file open? The file is as it was.`)
    }
    const now = readEnvFile(file)
    for (const [key, value] of Object.entries(pairs)) {
      if (now[key] !== value) stop(`${key} did not read back from ${rel(file)} as written`)
    }
    const moved = Object.keys(proof.was).filter((k) => !Object.hasOwn(pairs, k) && now[k] !== proof.was[k])
    if (moved.length) stop(`${moved.length} other key(s) in ${rel(file)} changed during the write (${moved.join(', ')}): another program edited the file at the same moment. Look at it before running this again.`)
  }

  /** Saves generated values in the secrets file (the first existing file of the env chain), in one write. */
  function persist(pairs) {
    for (const [key, value] of Object.entries(pairs)) {
      if (!isSafeEnvValue(value)) stop(`refusing to save ${key}: unexpected characters`)
    }
    const file = primaryEnvFile(chainOpts)
    if (!file) stop('there is no env file to save generated keys in (.env.local at the repo root, or the legacy web/.env.local)')
    if (!ignored(file)) stop(`${rel(file)} is not git-ignored`)
    if (!DRY) saveEnvKeys(file, pairs)
    return rel(file)
  }

  function writeNewFile(file, text) {
    if (!ignored(file)) stop(`refusing to write ${rel(file)}: git does not ignore it`)
    const tmp = `${file}.tmp-${process.pid}`
    try {
      fs.writeFileSync(tmp, text, { mode: 0o600 })
      fs.renameSync(tmp, file)
    } catch (error) {
      fs.rmSync(tmp, { force: true })
      stop(`could not write ${rel(file)} (${error && error.code ? error.code : 'error'}); is a program holding it open?`)
    }
  }

  /**
   * Where a copy of `file` goes before it is rewritten: the first
   * <file>.before-setup[-N] that is free, or an earlier one that is already
   * byte-identical. With `write` the copy is made.
   */
  function backupFor(file, { write }) {
    const current = fs.readFileSync(file)
    for (let n = 1; n <= 20; n++) {
      const candidate = `${file}.before-setup${n === 1 ? '' : `-${n}`}`
      if (fs.existsSync(candidate)) {
        if (fs.readFileSync(candidate).equals(current)) return candidate
        continue
      }
      if (!ignored(candidate)) stop(`the backup path ${rel(candidate)} is not git-ignored`)
      if (write) fs.copyFileSync(file, candidate, fs.constants.COPYFILE_EXCL)
      return candidate
    }
    return stop(`there are already 20 backups of ${rel(file)}; remove the old .before-setup files first`)
  }

  // ================================================================ parts

  async function setupPush(ctx) {
    const { opts, digests, vault, chain } = ctx
    const PART = 'Web Push'
    say(`\n${PART}`)
    const fnUrl = `${FN}/send-push`
    const predicates = { configured: pushAnswersConfigured, unconfigured: pushAnswersUnconfigured }
    const hadKeys = digests.has('VAPID_PUBLIC_KEY') && digests.has('VAPID_PRIVATE_KEY')
    const hadSecret = vault.has('deskdev_push_secret')
    // Everything but the URL row was there when this run began (see vaultUrlAction).
    const restWasInPlace = hadKeys && hadSecret && digests.has('VAPID_SUBJECT') && digests.has('PUSH_WEBHOOK_SECRET')
    const envName = rel(primaryEnvFile(chainOpts) || ROOT_ENV)

    // 0. nothing is written for a function that is not there
    requireDeployed('send-push', await probeState(fnUrl, {}, predicates, BEFORE_WRITES), PART)

    // 1. the key pair: keep what the function has, else reuse what the env file holds, else make one.
    //    Everything the env file says is checked before anything is generated or sent.
    const filePub = chain.VAPID_PUBLIC_KEY || null
    const filePriv = chain.VAPID_PRIVATE_KEY || null
    const sitePub = nonEmpty(readEnvFile(SITE_ENV)).NEXT_PUBLIC_VAPID_PUBLIC_KEY || null
    const fileSubject = chain.VAPID_SUBJECT || null
    if (fileSubject && !isVapidSubject(fileSubject)) stop(`VAPID_SUBJECT in the env file must be a real mailto: address or an https URL. Nothing was changed for ${PART}.`)
    if (!isVapidSubject(VAPID_SUBJECT)) stop('the VAPID subject must be a real mailto: address or an https URL')
    const pairs = {}
    const save = {}
    let pub = null
    if (hadKeys) {
      pub = filePub || sitePub
      if (!pub) stop(`the function already has VAPID keys, but the public key is in no env file. A new pair would cut off every subscribed device, so nothing was changed for ${PART}. Put the public key in the secrets file as VAPID_PUBLIC_KEY.`)
      if (digests.get('VAPID_PUBLIC_KEY') !== sha256Hex(pub)) stop(`the VAPID public key in the env file is not the one the function holds. Nothing was changed for ${PART}.`)
      if (!filePriv) {
        step('exists', 'VAPID key pair on the function', 'kept. Its private half is in no env file, and Supabase never shows a secret again')
      } else if (!vapidPairMatches(pub, filePriv)) {
        stop(`VAPID_PRIVATE_KEY in the env file does not belong to the public key the function holds. Nothing was changed for ${PART}. Correct the line, or remove it if that key is lost.`)
      } else if (digests.get('VAPID_PRIVATE_KEY') !== sha256Hex(filePriv)) {
        // The public halves agree and the env file's pair checks out, so the
        // function's private half is the odd one: every push it signs is refused.
        pairs.VAPID_PRIVATE_KEY = filePriv
        step(DRY ? 'would fix' : 'fixing', 'VAPID private key on the function', 'it is not the half that belongs to the public key; the env file holds the right one')
      } else {
        step('exists', 'VAPID key pair on the function', 'kept; both halves match the env file')
      }
    } else if (filePub || filePriv) {
      if (!filePub || !filePriv) stop(`only one half of the VAPID key pair is in the env file. Nothing was changed for ${PART}. Put VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY both there, or remove the one line to have a new pair made.`)
      if (!vapidPairMatches(filePub, filePriv)) stop(`VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in the env file are not one key pair. Nothing was changed for ${PART}. Remove both lines to have a new pair made.`)
      pub = filePub
      Object.assign(pairs, { VAPID_PUBLIC_KEY: filePub, VAPID_PRIVATE_KEY: filePriv })
      step('reusing', 'VAPID key pair from the env file')
    } else {
      const subscribed = count('select count(*)::int as n from public.push_subscriptions', 'the subscribed devices', PART)
      if (subscribed > 0 && !opts.rotateVapid) stop(`${subscribed} device(s) are subscribed with another key pair. A new pair cuts them off until they open DeskDev again. Nothing was changed for ${PART}. Run with --rotate-vapid to accept that.`)
      const pair = generateVapidPair()
      pub = pair.publicKey
      Object.assign(pairs, { VAPID_PUBLIC_KEY: pair.publicKey, VAPID_PRIVATE_KEY: pair.privateKey })
      Object.assign(save, { VAPID_PUBLIC_KEY: pair.publicKey, VAPID_PRIVATE_KEY: pair.privateKey })
    }
    if (fileSubject) pairs.VAPID_SUBJECT = fileSubject
    else if (!digests.has('VAPID_SUBJECT')) {
      pairs.VAPID_SUBJECT = VAPID_SUBJECT
      save.VAPID_SUBJECT = VAPID_SUBJECT
    }
    if (Object.keys(save).length) {
      // Saved, and read back, BEFORE anything is sent: Supabase never shows a
      // secret again. One write, so the file never holds half a pair.
      const file = persist(save)
      step(DRY ? 'would add' : 'saved', save.VAPID_PUBLIC_KEY ? 'new VAPID key pair' : 'VAPID subject', `${Object.keys(save).join(', ')} in ${file}`)
    }

    // 2. the shared webhook secret: born in the Vault, read back into memory
    if (!hadSecret && !DRY) { vaultEnsureRandom('deskdev_push_secret'); vault.add('deskdev_push_secret') }
    step(hadSecret ? 'exists' : DRY ? 'would add' : 'created', 'Vault deskdev_push_secret', hadSecret ? '' : 'random, generated in the database')
    const webhook = !hadSecret && DRY ? null : vaultValue('deskdev_push_secret')
    if ((hadSecret || !DRY) && (!webhook || webhook.length < 32 || !isSafeEnvValue(webhook))) stop('Vault deskdev_push_secret is missing, shorter than 32 characters or has unexpected characters. No function secret was sent.')
    if (webhook) pairs.PUSH_WEBHOOK_SECRET = webhook

    // 3. function secrets (only the ones whose digest differs)
    const sent = await setSecrets(digests, pairs)
    if (DRY && !webhook) sent.push('PUSH_WEBHOOK_SECRET')
    step(sent.length ? (DRY ? 'would set' : 'set') : 'unchanged', `function secrets${sent.length ? ' ' + sent.join(', ') : ''}`)

    // 4. the function must answer as configured and take the Vault secret before anything points at it
    if (!DRY) {
      const again = vault.has('deskdev_push_function_url')
        ? 'The Vault URL row exists, so the database is still calling a function that does not answer as it should. The function log names what is unset; to pause delivery meanwhile, remove the row (PUSH.md "Disable").'
        : `The Vault URL row was NOT written, so nothing calls the function. Run "${SELF} --only push --resume-push" again in a few minutes.`
      const state = await probeState(fnUrl, {}, predicates, AFTER_SECRETS)
      if (state !== 'configured') stop(`send-push does not answer as configured yet (${state}). ${again}`)
      step('ok', 'send-push answers as configured')
      if (!(await acceptsSecret(fnUrl, webhook, { type: 'probe' }, pushAcceptsSecret))) stop(`send-push does not accept the Vault secret. ${again}`)
      step('ok', 'send-push accepts the Vault secret')
    }

    // 5. last: point the database triggers at the function
    const on = vaultSwitch(vault, {
      name: 'deskdev_push_function_url',
      url: fnUrl,
      restWasInPlace,
      resume: opts.resumePush,
      onNote: 'from now on new notifications and chat lines are pushed',
      offNote: 'the keys and the secret were in place before this run, and this row is missing: push was paused (PUSH.md "Disable"), or an earlier run stopped early. Nothing calls the function',
    })
    if (!on) OPEN.unfinished.push(`push delivery is OFF. Switch it on with: ${SELF} --only push --resume-push`)

    // 6. the public key where the site build reads it (PUBLIC by design)
    const label = 'site/.env.local NEXT_PUBLIC_VAPID_PUBLIC_KEY'
    if (sitePub === pub) step('exists', label)
    else if (!fs.existsSync(SITE_ENV)) {
      step('skipped', label, 'the file does not exist')
      OPEN.owner.push('site/.env.local does not exist, so a local build cannot offer push: run "--only env --yes-env", or add NEXT_PUBLIC_VAPID_PUBLIC_KEY by hand from VAPID_PUBLIC_KEY')
    } else {
      const busy = opts.force ? [] : await deps.ports()
      if (busy.length) {
        step('waiting', label, `a dev server is listening on ${busy.join(', ')} and would restart`)
        OPEN.unfinished.push(`the local site build does not have the push public key yet. Stop the dev server (port ${busy.join(', ')}) and run "${SELF} --only push" again, or pass --force`)
      } else {
        if (!DRY) saveEnvKeys(SITE_ENV, { NEXT_PUBLIC_VAPID_PUBLIC_KEY: pub })
        step(DRY ? 'would set' : 'set', label, 'the public key; restart the dev server or rebuild to pick it up')
      }
    }
    OPEN.owner.push(`go-live: the deployed site gets the push public key at build time. Set the GitHub Actions variable NEXT_PUBLIC_VAPID_PUBLIC_KEY (environment "production") to the value of VAPID_PUBLIC_KEY in ${envName}, then redeploy (.github/workflows/site-deploy.yml). Until then the live app reports push as not set up`)
    ctx.vapidPublic = pub
  }

  async function setupGoogle(ctx) {
    const { opts, digests, vault, chain } = ctx
    const PART = 'Google connect'
    say(`\n${PART}`)
    const calUrl = `${FN}/google-calendar`
    const calendarPredicates = { configured: calendarAnswersConfigured, unconfigured: calendarAnswersUnconfigured }
    const hadCal = vault.has('deskdev_google_calendar_secret')
    // Everything but the URL row was there when this run began (see vaultUrlAction).
    const restWasInPlace = hadCal && digests.has('GOOGLE_CALENDAR_WEBHOOK_SECRET')
    const envName = rel(primaryEnvFile(chainOpts) || ROOT_ENV)
    const pairs = {}

    // 0. nothing is written for functions that are not there
    requireDeployed('google', await probeState(`${FN}/google`, {}, { configured: answersItself, unconfigured: () => false }, BEFORE_WRITES), PART)
    requireDeployed('google-calendar', await probeState(calUrl, { action: 'drain' }, calendarPredicates, BEFORE_WRITES), PART)

    // 1. what the env file says must be usable before anything is generated or sent
    const fileRing = chain.GOOGLE_TOKEN_KEYS || null
    const fileKid = chain.GOOGLE_TOKEN_KEY_ID || null
    if (fileRing && !isTokenKeyring(fileRing)) stop(`GOOGLE_TOKEN_KEYS in the env file is not <kid>:<base64 of 32+ bytes>, comma-separated, each id once. Nothing was changed for ${PART}.`)
    if (fileRing && fileKid && !keyringKids(fileRing).includes(fileKid)) stop(`GOOGLE_TOKEN_KEY_ID in the env file names a key that is not in GOOGLE_TOKEN_KEYS. Nothing was changed for ${PART}.`)
    const clientId = chain.GOOGLE_OAUTH_CLIENT_ID || null
    const clientSecret = chain.GOOGLE_OAUTH_CLIENT_SECRET || null
    if (clientId && !/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)) stop(`GOOGLE_OAUTH_CLIENT_ID in the env file does not look like a Google OAuth client id (it ends in .apps.googleusercontent.com). Nothing was changed for ${PART}.`)
    if (clientSecret && !isSafeEnvValue(clientSecret)) stop(`GOOGLE_OAUTH_CLIENT_SECRET in the env file has characters this script does not write. Nothing was changed for ${PART}.`)

    // 2. the token sealing key: unrecoverable from Supabase, so it is saved first
    if (digests.has('GOOGLE_TOKEN_KEYS') || digests.has('GOOGLE_TOKEN_KEY')) {
      const same = Boolean(fileRing) && digests.get('GOOGLE_TOKEN_KEYS') === sha256Hex(fileRing)
      const note = !digests.has('GOOGLE_TOKEN_KEYS')
        ? 'the legacy GOOGLE_TOKEN_KEY; kept'
        : !fileRing
          ? 'kept. It is NOT in the env file, so a later rotation could not keep the connections of today readable'
          : same
            ? 'kept; it matches the env file'
            : 'kept. It DIFFERS from GOOGLE_TOKEN_KEYS in the env file'
      step('exists', 'token sealing key on the function', note)
      if (same && digests.has('GOOGLE_TOKEN_KEY_ID') && !keyringKids(fileRing).some((kid) => sha256Hex(kid) === digests.get('GOOGLE_TOKEN_KEY_ID'))) {
        step('WARNING', 'GOOGLE_TOKEN_KEY_ID on the function', 'it names a key that is not in the ring, so the function refuses every Google call')
        OPEN.unfinished.push(`GOOGLE_TOKEN_KEY_ID on the function names no key of the ring. Set it to one of the ids in GOOGLE_TOKEN_KEYS: npx supabase secrets set GOOGLE_TOKEN_KEY_ID=<id> --project-ref ${REF}`)
      }
    } else {
      let ring = fileRing
      let kid = null
      if (ring) {
        kid = fileKid || keyringKids(ring)[0]
        step('reusing', 'token sealing key from the env file')
      } else {
        // A new key cannot read what an older one sealed, and the function then
        // drops those connections as unreadable instead of reporting a config error.
        const sealed = count('select ((select count(*) from public.google_connections) + (select count(*) from public.google_workspace_link where refresh_token_enc is not null))::int as n', 'the stored Google connections', PART)
        if (sealed > 0) stop(`${sealed} stored Google connection(s) are sealed with a key that is neither on the function nor in the env file, and a new key could not read them. Nothing was changed for ${PART}. Put that key in the env file as GOOGLE_TOKEN_KEYS; if it is lost, remove those connections first (each person connects again).`)
        ring = newTokenKeyring()
        kid = keyringKids(ring)[0]
        // One write, read back, before anything is sent.
        const file = persist({ GOOGLE_TOKEN_KEYS: ring, GOOGLE_TOKEN_KEY_ID: kid })
        step(DRY ? 'would add' : 'saved', 'new token sealing key', `GOOGLE_TOKEN_KEYS, GOOGLE_TOKEN_KEY_ID in ${file}`)
      }
      pairs.GOOGLE_TOKEN_KEYS = ring
      pairs.GOOGLE_TOKEN_KEY_ID = kid
    }

    // 3. allowed origins: set once; a list someone edited is never overwritten in passing
    const origins = appOriginsDecision({ currentDigest: digests.get('APP_ORIGINS'), devOrigin: opts.devOrigin, workersDevOrigin: opts.workersDevOrigin, prodOrigins: opts.prodOrigins })
    if (origins.value) pairs.APP_ORIGINS = origins.value

    // 4. the OAuth client, once the owner has created it in Google Cloud. A
    //    client the function already holds is only replaced on request.
    const client = oauthClientAction({ idDigest: digests.get('GOOGLE_OAUTH_CLIENT_ID'), secretDigest: digests.get('GOOGLE_OAUTH_CLIENT_SECRET'), clientId, clientSecret, replace: opts.replaceClient })
    const functionHasClient = digests.has('GOOGLE_OAUTH_CLIENT_ID') && digests.has('GOOGLE_OAUTH_CLIENT_SECRET')
    if (client === 'send') Object.assign(pairs, { GOOGLE_OAUTH_CLIENT_ID: clientId, GOOGLE_OAUTH_CLIENT_SECRET: clientSecret })
    if (opts.redirectBase) pairs.GOOGLE_REDIRECT_BASE = opts.redirectBase

    // 5. the calendar webhook secret: born in the Vault, like the push one
    if (!hadCal && !DRY) { vaultEnsureRandom('deskdev_google_calendar_secret'); vault.add('deskdev_google_calendar_secret') }
    step(hadCal ? 'exists' : DRY ? 'would add' : 'created', 'Vault deskdev_google_calendar_secret', hadCal ? '' : 'random, generated in the database')
    const calendar = !hadCal && DRY ? null : vaultValue('deskdev_google_calendar_secret')
    if ((hadCal || !DRY) && (!calendar || calendar.length < 32 || !isSafeEnvValue(calendar))) stop('Vault deskdev_google_calendar_secret is missing, shorter than 32 characters or has unexpected characters. No function secret was sent.')
    if (calendar) pairs.GOOGLE_CALENDAR_WEBHOOK_SECRET = calendar

    // 6. function secrets (only the ones whose digest differs)
    const sent = await setSecrets(digests, pairs)
    if (DRY && !calendar) sent.push('GOOGLE_CALENDAR_WEBHOOK_SECRET')
    step(sent.length ? (DRY ? 'would set' : 'set') : 'unchanged', `function secrets${sent.length ? ' ' + sent.join(', ') : ''}`)
    if (origins.refused) {
      const asked = [opts.devOrigin && DEV_ORIGIN, opts.workersDevOrigin && WORKERS_DEV_ORIGIN].filter(Boolean).join(' and ')
      step('kept', 'APP_ORIGINS', 'it is not a list this script wrote, so it was left alone')
      OPEN.unfinished.push(`${asked} was not added: APP_ORIGINS on the function is a list someone edited. Add it by hand, or reset the list with --prod-origins and run this again`)
    } else if (!origins.value) step('exists', 'APP_ORIGINS', 'left as it is')
    if (origins.allowsWorkersDev) {
      step('note', `APP_ORIGINS includes ${WORKERS_DEV_ORIGIN}`, 'so DeskDev works from the workers.dev address while the domain is not attached')
      OPEN.owner.push(`after the DNS cutover: APP_ORIGINS on the live function still allows ${WORKERS_DEV_ORIGIN}. Take it out with "${SELF} --only google --prod-origins" once the real domain serves the site (DNS-CUTOVER.md, step 7)`)
    }
    if (origins.allowsDev) {
      step('note', `APP_ORIGINS includes ${DEV_ORIGIN}`, 'so Google connect can return to a local dev server')
      OPEN.owner.push(`go-live: APP_ORIGINS on the live function allows ${DEV_ORIGIN}, which is for local testing only. Run "${SELF} --only google --prod-origins" when the site goes live`)
    }

    // 7. the calendar kick. It only fires while a company account is connected
    //    (040: google_calendar_kick returns unless the workspace link is active),
    //    so the URL row costs nothing before that and sync starts by itself after.
    let ready = DRY
    if (!DRY) {
      const again = vault.has('deskdev_google_calendar_url')
        ? 'the Vault URL row exists, so the database may still call a function that does not answer as it should; its log names what is unset'
        : `the Vault URL row was not written. Run "${SELF} --only google --resume-calendar" again in a few minutes`
      const state = await probeState(calUrl, { action: 'drain' }, calendarPredicates, AFTER_SECRETS)
      if (state !== 'configured') {
        step('waiting', 'google-calendar function', `it does not answer as configured yet (${state})`)
        OPEN.unfinished.push(`calendar sync: the google-calendar function does not see its secret yet (${state}); ${again}`)
      } else if (!(await acceptsSecret(calUrl, calendar, { action: 'probe' }, calendarAcceptsSecret))) {
        step('waiting', 'google-calendar function', 'it does not accept the Vault secret yet')
        OPEN.unfinished.push(`calendar sync: the google-calendar function does not accept the Vault secret; ${again}`)
      } else {
        step('ok', 'google-calendar answers as configured and accepts the Vault secret')
        ready = true
      }
    }
    if (ready) {
      const on = vaultSwitch(vault, {
        name: 'deskdev_google_calendar_url',
        url: calUrl,
        restWasInPlace,
        resume: opts.resumeCalendar,
        onNote: 'sync starts by itself when a company Google account is connected',
        offNote: 'the secret was in place before this run, and this row is missing: calendar sync was paused, or an earlier run stopped early. Nothing calls the function',
      })
      if (!on) OPEN.unfinished.push(`calendar sync is OFF. Switch it on with: ${SELF} --only google --resume-calendar`)
    }

    // 8. what only the owner can do
    if (client === 'send') step(DRY ? 'would set' : 'set', 'Google OAuth client', 'the id and the secret from the env file')
    else if (client === 'same') step('exists', 'Google OAuth client', 'the function holds the one in the env file')
    else if (client === 'differs') {
      step('kept', 'Google OAuth client', 'the function holds another id or secret than the env file')
      OPEN.unfinished.push(`the Google OAuth client on the function is not the one in ${envName}. If the env file is right, send it with "${SELF} --only google --replace-client"; if the function is right, correct the two lines in the env file`)
    } else if (functionHasClient) {
      step('exists', 'Google OAuth client', `on the function; ${envName} has no copy of it`)
    } else {
      const half = Boolean(clientId) !== Boolean(clientSecret)
      step('waiting', 'Google OAuth client', half ? `only one of the two values is in ${envName}` : `not in ${envName} yet`)
      OPEN.owner.push(`Google connect stays "not set up" until a Google OAuth client exists: create it in Google Cloud (supabase/functions/google/README.md, "Runbook" steps 1 to 4; step 5 is what this script does), put GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in ${envName}, then run "${SELF} --only google" again`)
    }
    if (!digests.has('GOOGLE_REDIRECT_BASE') && !opts.redirectBase) {
      step('note', 'GOOGLE_REDIRECT_BASE is not set', 'personal connect works without it')
      OPEN.owner.push('go-live: Team Calendar connect needs GOOGLE_REDIRECT_BASE. Run with --redirect-base https://nixgensolutions.com/api/google once the site is live (http://localhost:6969/api/google for local dev)')
    }
  }

  async function setupEnvFiles(ctx) {
    const { opts, chain } = ctx
    say('\nEnv files (owner-approved: --yes-env)')
    const busy = opts.force ? [] : await deps.ports()
    if (busy.length) {
      const sentence = `a dev server is listening on ${busy.join(', ')}. It would restart against the LIVE database. Stop it first, or pass --force.`
      if (!DRY) stop(`${sentence} Nothing was changed.`)
      step('STOP', 'a real run stops here', sentence)
      OPEN.unfinished.push(`the env part does nothing while a dev server is listening on ${busy.join(', ')}`)
    }

    // 0. the one value this part takes from the database, read before any file exists
    const devBefore = nonEmpty(readEnvFile(DEV_VARS))
    const intake = devBefore.LEAD_INTAKE_SECRET ? null : vaultValue('lead_intake_secret')

    // 1. the repo-root secrets file
    if (fs.existsSync(ROOT_ENV)) step('exists', '.env.local (repo root)')
    else if (!fs.existsSync(LEGACY_ENV)) stop('neither .env.local nor web/.env.local exists')
    else {
      if (!ignored(ROOT_ENV)) stop('.env.local at the repo root is not git-ignored')
      if (!DRY) {
        fs.copyFileSync(LEGACY_ENV, ROOT_ENV, fs.constants.COPYFILE_EXCL)
        if (!fs.readFileSync(ROOT_ENV).equals(fs.readFileSync(LEGACY_ENV))) stop('.env.local at the repo root is not an exact copy of web/.env.local. Compare the two files before going on.')
        // Every other tool runs the Supabase CLI from the repo root, where it
        // loads this new file, and it is stricter than Node about what a line
        // may be. A file it refuses would break migrations and deploys, so the
        // copy (identical to web/.env.local) is taken back at once.
        const accepted = withSqlFile('select 1 as ok', (file) => supabase(queryArgs(file), { tries: 2, cwd: ROOT }).ok)
        if (!accepted) {
          const neutral = withSqlFile('select 1 as ok', (file) => supabase(queryArgs(file), { tries: 2 }).ok)
          fs.rmSync(ROOT_ENV, { force: true })
          stop(neutral
            ? 'the Supabase CLI refuses the new .env.local at the repo root (it does not accept a line that Node does: a line without "=", an open quote, or a key with a dash). The copy was removed again, so nothing changed. Fix that line in web/.env.local, then run this again.'
            : 'the Supabase CLI did not answer, so the new .env.local at the repo root could not be checked. The copy was removed again, so nothing changed. Run this again.')
        }
      }
      step(DRY ? 'would add' : 'created', '.env.local (repo root)', 'an exact copy of web/.env.local. From now on THIS is the secrets file: tooling reads it first, so edit secrets here, not in web/')
    }
    const root = DRY && !fs.existsSync(ROOT_ENV) ? nonEmpty(readEnvFile(LEGACY_ENV)) : nonEmpty(readEnvFile(ROOT_ENV))

    // 2. site/.env.local: public build values only
    const site = nonEmpty(readEnvFile(SITE_ENV))
    const otherKeys = Object.keys(site).filter((k) => !k.startsWith('NEXT_PUBLIC_'))
    const unique = otherKeys.filter((k) => root[k] !== site[k])
    const url = site.NEXT_PUBLIC_SUPABASE_URL || root.NEXT_PUBLIC_SUPABASE_URL || root.VITE_SUPABASE_URL
    const anon = site.NEXT_PUBLIC_SUPABASE_ANON_KEY || root.NEXT_PUBLIC_SUPABASE_ANON_KEY || root.VITE_SUPABASE_ANON_KEY
    if (!url || !anon) stop('the Supabase URL or anon key is in no env file')
    if (url.replace(/\/+$/, '') !== `https://${REF}.supabase.co`) stop('the Supabase URL in the env file is not this project')
    if (!isAnonKeyFor(anon, REF)) stop('the key that would be inlined into the browser bundle is not an anon key of this project. site/.env.local was not rewritten.')
    const vapidPublic = ctx.vapidPublic || chain.VAPID_PUBLIC_KEY || site.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null
    if (unique.length) stop(`site/.env.local holds ${unique.length} non-public value(s) that are not in the root file (${unique.join(', ')}). Move them to .env.local first; site/.env.local was not rewritten.`)
    const wasConnected = Boolean(site.NEXT_PUBLIC_SUPABASE_URL && site.NEXT_PUBLIC_SUPABASE_ANON_KEY)

    const keep = Object.fromEntries(Object.entries(site).filter(([k]) => k.startsWith('NEXT_PUBLIC_')))
    // Local dev leaves the site URL unset so shared links and canonicals use the live domain (src/lib/seo.ts).
    if (keep.NEXT_PUBLIC_SITE_URL && /^https?:\/\/(localhost|127\.0\.0\.1)/.test(keep.NEXT_PUBLIC_SITE_URL)) delete keep.NEXT_PUBLIC_SITE_URL
    keep.NEXT_PUBLIC_SUPABASE_URL = url
    keep.NEXT_PUBLIC_SUPABASE_ANON_KEY = anon
    if (vapidPublic) keep.NEXT_PUBLIC_VAPID_PUBLIC_KEY = vapidPublic
    for (const [k, v] of Object.entries(keep)) if (!isSafeEnvValue(v)) stop(`site/.env.local: ${k} has characters this script does not write. site/.env.local was not rewritten.`)
    const first = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_VAPID_PUBLIC_KEY']
    const keys = [...first.filter((k) => k in keep), ...Object.keys(keep).filter((k) => !first.includes(k)).sort()]
    const text = [
      '# site/.env.local: PUBLIC build values only (NEXT_PUBLIC_*). They are inlined',
      '# into the browser bundle, so nothing secret belongs here.',
      '# Secrets live in ../.env.local (repo root); the local Worker runtime',
      '# secrets live in ./.dev.vars. See AGENTS.md and site/.env.example.',
      '# NEXT_PUBLIC_SITE_URL and NEXT_PUBLIC_APP_URL stay unset for local dev.',
      '# The two NEXT_PUBLIC_SUPABASE_* lines connect local dev to the LIVE database;',
      '# remove them to go back to the demo workspace.',
      '',
      ...keys.map((k) => `${k}=${keep[k]}`),
      '',
    ].join('\n')
    const alreadyClean = otherKeys.length === 0 && keys.every((k) => site[k] === keep[k]) && Object.keys(site).every((k) => k in keep)
    if (alreadyClean) step('exists', 'site/.env.local', `${keys.length} public keys, nothing secret`)
    else {
      const backup = fs.existsSync(SITE_ENV) ? backupFor(SITE_ENV, { write: !DRY }) : null
      if (!DRY) {
        writeNewFile(SITE_ENV, text)
        const written = readEnvFile(SITE_ENV)
        if (!keys.every((k) => written[k] === keep[k]) || Object.keys(written).length !== keys.length) stop(`site/.env.local did not read back as written${backup ? `; the file as it was is in ${rel(backup)}` : ''}`)
      }
      step(DRY ? 'would write' : 'rewritten', 'site/.env.local', `${keys.length} public keys (${keys.join(', ')}); ${otherKeys.length} non-public key(s) removed, all still in the root file${backup ? `; the file as it was is kept in ${rel(backup)} (it holds secrets: delete it once the root file is confirmed)` : ''}`)
    }
    if (!wasConnected) {
      step(DRY ? 'would be' : 'CHANGED', 'local dev: demo workspace -> the LIVE database', DRY ? 'site/.env.local would then name the live project, so "npm run dev" would sign in for real and show real data' : 'site/.env.local now names the live project, so "npm run dev" signs in for real and shows real data')
      OPEN.owner.push(`local dev ${DRY ? 'would then use' : 'now uses'} the LIVE database (real sign-in, real data). To go back to the demo workspace, remove the two NEXT_PUBLIC_SUPABASE_* lines from site/.env.local`)
    }

    // 3. site/.dev.vars: the local Worker's intake secrets
    const add = {}
    let intakeMissing = false
    if (!devBefore.LEAD_INTAKE_SECRET) {
      if (intake && isSafeEnvValue(intake)) add.LEAD_INTAKE_SECRET = intake
      else intakeMissing = true
    }
    if (!devBefore.LEAD_IP_SALT) add.LEAD_IP_SALT = root.LEAD_IP_SALT && isSafeEnvValue(root.LEAD_IP_SALT) ? root.LEAD_IP_SALT : randomBytes(24).toString('hex')
    if (!devBefore.FORM_TOKEN_SECRET) add.FORM_TOKEN_SECRET = root.FORM_TOKEN_SECRET && isSafeEnvValue(root.FORM_TOKEN_SECRET) ? root.FORM_TOKEN_SECRET : randomBytes(32).toString('hex')
    if (!Object.keys(add).length && !intakeMissing) step('exists', 'site/.dev.vars', 'already has the intake keys')
    else if (Object.keys(add).length) {
      if (!DRY) {
        if (fs.existsSync(DEV_VARS)) saveEnvKeys(DEV_VARS, add)
        else {
          writeNewFile(DEV_VARS, ['# site/.dev.vars: the local Worker runtime secrets (git-ignored).', '# Production sets the same names on the Worker (site/README.md, Deploy).', '', ...Object.entries(add).map(([k, v]) => `${k}=${v}`), ''].join('\n'))
          const written = readEnvFile(DEV_VARS)
          if (!Object.entries(add).every(([k, v]) => written[k] === v)) stop('site/.dev.vars did not read back as written')
        }
      }
      step(DRY ? 'would write' : 'written', 'site/.dev.vars', `${Object.keys(add).join(', ')}; a brief sent from the local contact form ${DRY ? 'would then be' : 'is then'} stored in the LIVE database`)
    }
    if (intakeMissing) {
      step('waiting', 'site/.dev.vars LEAD_INTAKE_SECRET', 'the Vault has no usable lead_intake_secret (034), so the local contact and subscribe forms answer 503')
      OPEN.unfinished.push(`the local contact form cannot record leads: Vault row lead_intake_secret is missing or unusable. Create it (supabase/README.md, "Vault secrets"), then run "${SELF} --only env --yes-env" again`)
    }
  }

  // ================================================================ run

  async function main() {
    const opts = parseArgs(argv)
    DRY = opts.dryRun
    if (deps.banner) say(deps.banner)
    CLI = deps.cli()
    if (!CLI) stop('the Supabase CLI was not found in the npx cache; run "npx supabase --version" once and try again')
    if (!DRY) takeLock()

    say(`DeskDev integration setup — parts: ${opts.parts.join(', ')} — ${DRY ? 'DRY RUN, nothing is changed' : 'LIVE'} — project ${REF}, CLI ${CLI.version}`)
    const digests = secretDigests()
    const vault = vaultNames()
    say(`function secrets now: ${[...digests.keys()].filter((n) => !n.startsWith('SUPABASE_')).sort().join(', ') || 'none'}`)
    say(`vault rows now: ${[...vault].sort().join(', ') || 'none'}`)

    const ctx = { opts, digests, vault, chain: readEnvChain(chainOpts).values, vapidPublic: null }
    if (opts.parts.includes('push')) await setupPush(ctx)
    if (opts.parts.includes('google')) await setupGoogle(ctx)
    if (opts.parts.includes('env')) await setupEnvFiles(ctx)

    report()
    say(`\n${DRY ? 'Dry run finished: nothing was changed.' : OPEN.unfinished.length ? 'Finished, with the open points above.' : 'Done.'}`)
    return OPEN.unfinished.length && !DRY ? 2 : 0
  }

  try {
    return await main()
  } catch (error) {
    // What earlier parts left open still matters when a later one stops.
    report()
    // Only this script's own sentences are printed; anything else could carry CLI output.
    const own = error instanceof Stop || (error instanceof Error && /^(--|unknown argument|the env part)/.test(error.message))
    fail(own ? `\nSTOP: ${error.message}` : `\nSTOP: unexpected ${error && error.name ? error.name : 'error'}${error && error.code ? ` (${error.code})` : ''}`)
    return 1
  } finally {
    releaseLock()
    if (cliDir) {
      try { fs.rmSync(cliDir, { recursive: true, force: true }) } catch { /* the CLI may still hold a file for a moment; the folder is empty of anything that matters */ }
    }
  }
}
