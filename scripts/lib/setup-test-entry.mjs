#!/usr/bin/env node
// The entry scripts/setup-integrations.test.mjs runs instead of the real
// command. It drives the same core (setup-core.mjs) against a throwaway root,
// the stand-in CLI next to this file and a stand-in functions host on
// 127.0.0.1, under a project ref that does not exist.
//
// It refuses any world that is, contains, or links into this repository. Paths
// are compared by file identity, not by spelling, so another letter case, an
// 8.3 short name, a UNC alias or a junction does not get through. The real
// command never loads this file, and nothing here can reach the real CLI.
//
//   DESKDEV_SETUP_TEST_WORLD='{"root":"…","envFile":"…","fn":"http://127.0.0.1:PORT"}' \
//     node scripts/lib/setup-test-entry.mjs [the real command's arguments]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { REPO_ROOT } from './env.mjs'
import { runSetup } from './setup-core.mjs'

/** A made-up project ref of the real length: nothing in a test run carries the real one. */
export const TEST_REF = 'testprojectref0000xx'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const FAKE_CLI = path.join(HERE, 'fake-supabase-cli.mjs')

const identity = (p) => {
  const s = fs.statSync(p, { bigint: true })
  return `${s.dev}:${s.ino}`
}
/** True when `candidate` is `dir` itself or lies below it, however either path is spelled or linked. */
function within(dir, candidate) {
  const target = identity(dir)
  let cur = fs.realpathSync.native(candidate)
  for (;;) {
    if (identity(cur) === target) return true
    const parent = path.dirname(cur)
    if (parent === cur) return false
    cur = parent
  }
}
/** The path itself, or its nearest ancestor that exists. */
function nearest(p) {
  let cur = p
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return cur
}

/**
 * Why a world must not be run, or null when it is sound.
 * @returns {string | null}
 */
export function refuseWorld(raw) {
  let world = null
  try {
    world = JSON.parse(raw ?? '')
  } catch {
    return 'it is not JSON'
  }
  if (!world || typeof world !== 'object' || Array.isArray(world)) return 'it is not an object'
  const { root, envFile, fn, ports, tick } = world
  if (typeof root !== 'string' || !path.isAbsolute(root)) return 'root is not an absolute path'
  if (typeof envFile !== 'string' || !path.isAbsolute(envFile)) return 'envFile is not an absolute path'
  if (typeof fn !== 'string' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(fn)) return 'fn is not a plain http://127.0.0.1:<port>'
  if (ports !== undefined && !(Array.isArray(ports) && ports.every((p) => Number.isInteger(p)))) return 'ports is not a list of numbers'
  if (tick !== undefined && !(Number.isFinite(tick) && tick >= 0 && tick <= 1000)) return 'tick is not a small number'
  try {
    if (!fs.statSync(root).isDirectory()) return 'root is not a folder'
    if (within(REPO_ROOT, root)) return 'root is this repository or inside it'
    if (within(root, REPO_ROOT)) return 'root contains this repository'
    if (!fs.existsSync(envFile)) return 'envFile does not exist'
    // Every place the run can write: below the root for real, and no link to a file elsewhere.
    const places = [envFile, 'site', 'web', '.env.local', 'site/.env.local', 'site/.dev.vars', 'web/.env.local'].map((p) => (path.isAbsolute(p) ? p : path.join(root, p)))
    for (const place of places) {
      const anchor = nearest(place)
      if (!within(root, anchor)) return `${path.relative(root, place) || place} leads outside the root`
      if (within(REPO_ROOT, anchor)) return `${path.relative(root, place) || place} leads into this repository`
      if (fs.existsSync(place)) {
        const info = fs.lstatSync(place)
        if (info.isSymbolicLink()) return `${path.relative(root, place) || place} is a link`
        if (info.isFile() && info.nlink !== 1) return `${path.relative(root, place) || place} has another name elsewhere (a hard link)`
      }
    }
  } catch {
    return 'its paths could not be checked'
  }
  return null
}

async function main() {
  const raw = process.env.DESKDEV_SETUP_TEST_WORLD
  const reason = refuseWorld(raw)
  if (reason) {
    console.error(`\nSTOP: the test world is refused: ${reason}. Nothing was read or changed.`)
    return 1
  }
  const world = JSON.parse(raw)
  const wait = world.tick ?? 5
  return runSetup(process.argv.slice(2), {
    ref: TEST_REF,
    fn: world.fn,
    root: world.root,
    repoRoot: REPO_ROOT,
    chain: { root: world.root, env: { DESKDEV_ENV_FILE: world.envFile } },
    cli: () => ({ bin: process.execPath, pre: [FAKE_CLI], version: 'test double' }),
    ports: async () => world.ports ?? [],
    lockFile: path.join(world.root, '.setup.lock'),
    tick: wait,
    retryWait: wait,
    setWait: wait,
    banner: 'TEST MODE: a stand-in CLI, stand-in functions and a throwaway root. Nothing real is read or changed.',
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code
  })
}
