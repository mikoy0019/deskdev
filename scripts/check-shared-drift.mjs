#!/usr/bin/env node
// Shared-lib drift check — site/src/deskdev/lib (DeskDev web) is the source of
// truth for the data layer; mobile/src/lib carries a byte-for-byte copy of the
// mirrored files below. Edit DeskDev first, copy to mobile in the same PR. This
// script fails CI when the two sides diverge.
//
// Platform shims: files listed in PLATFORM_SPECIFIC_OK may wrap genuinely
// platform-specific code in marker regions, which are stripped (on both
// sides) before hashing so they never count as drift:
//
//   // PLATFORM-SPECIFIC:START
//   ...web-only or mobile-only code...
//   // PLATFORM-SPECIFIC:END
//
// Usage: node scripts/check-shared-drift.mjs   (from anywhere; exits non-zero
// on drift, missing files, or malformed marker regions)

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WEB_LIB = path.join(ROOT, 'site', 'src', 'deskdev', 'lib')
const MOBILE_LIB = path.join(ROOT, 'mobile', 'src', 'lib')

// Mirrored files (must exist on both sides and hash identically). Paths are
// relative to the two lib folders, so '../store/useStore.ts' is the store:
// since the mobile app moved onto the web store, the store, its demo data and
// every pure rule it imports are shared too.
// Deliberately NOT mirrored: supabase.ts (env access + auth storage differ by
// platform), platform.ts (storage, crypto, the site origin, sign-out cleanup:
// the seam the shared files reach the platform through), showcaseImages.ts
// (the web resizes with a canvas), theme.ts (mobile-only), *.test.ts.
const MIRRORED = [
  'types.ts',
  'applications.ts',
  'permissions.ts',
  'presence.ts',
  'format.ts',
  'eod.ts',
  'engagements.ts',
  'mappers.ts',
  'adminUsers.ts',
  'db.ts',
  'realtime.ts',
  'leads.ts',
  'showcase.ts',
  'tasks.ts',
  'forms.ts',
  'projectPhase.ts',
  'quickForm.ts',
  'email.ts',
  'booking.ts',
  'chat.ts',
  'channels.ts',
  'notifications.ts',
  '../store/useStore.ts',
  '../store/entityValidation.ts',
  '../data/seed.ts',
]

// Files allowed to contain // PLATFORM-SPECIFIC:START/END regions.
const PLATFORM_SPECIFIC_OK = new Set(['realtime.ts'])

const MARKER_START = '// PLATFORM-SPECIFIC:START'
const MARKER_END = '// PLATFORM-SPECIFIC:END'

/**
 * Normalize a source file for comparison: unify line endings, and for
 * allowlisted files strip PLATFORM-SPECIFIC regions (markers included).
 * Throws on unbalanced markers or markers in non-allowlisted files.
 */
function normalize(name, source) {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const allowMarkers = PLATFORM_SPECIFIC_OK.has(name)
  const kept = []
  let depth = 0
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (trimmed.startsWith(MARKER_START)) {
      if (!allowMarkers) {
        throw new Error(`${name}:${i + 1} has a PLATFORM-SPECIFIC marker but is not in the allowlist — add it to PLATFORM_SPECIFIC_OK in scripts/check-shared-drift.mjs if intended`)
      }
      if (depth > 0) throw new Error(`${name}:${i + 1} nested ${MARKER_START}`)
      depth++
      continue
    }
    if (trimmed.startsWith(MARKER_END)) {
      if (depth === 0) throw new Error(`${name}:${i + 1} ${MARKER_END} without a matching START`)
      depth--
      continue
    }
    if (depth === 0) kept.push(lines[i])
  }
  if (depth !== 0) throw new Error(`${name} has an unclosed ${MARKER_START} region`)
  return kept.join('\n')
}

function hashOf(name, filePath) {
  const normalized = normalize(name, readFileSync(filePath, 'utf8'))
  return createHash('sha256').update(normalized).digest('hex')
}

const problems = []
let checked = 0

for (const name of MIRRORED) {
  const webPath = path.join(WEB_LIB, name)
  const mobilePath = path.join(MOBILE_LIB, name)
  const webExists = existsSync(webPath)
  const mobileExists = existsSync(mobilePath)

  if (!webExists || !mobileExists) {
    problems.push(`MISSING  ${name} — web: ${webExists ? 'ok' : 'absent'}, mobile: ${mobileExists ? 'ok' : 'absent'}`)
    continue
  }

  try {
    checked++
    if (hashOf(name, webPath) !== hashOf(name, mobilePath)) {
      problems.push(`DRIFT    ${name} — ${path.relative(ROOT, webPath)} != ${path.relative(ROOT, mobilePath)}`)
    }
  } catch (err) {
    problems.push(`MARKERS  ${err.message}`)
  }
}

if (problems.length > 0) {
  console.error('Shared-lib drift check FAILED:\n')
  for (const p of problems) console.error(`  ${p}`)
  console.error(
    '\nsite/src/deskdev/lib is the source of truth — make the change there first, then' +
    '\ncopy the file to mobile/src/lib in the same PR. Genuinely platform-' +
    '\nspecific code goes inside // PLATFORM-SPECIFIC:START ... :END regions' +
    '\n(allowlist the file in scripts/check-shared-drift.mjs).',
  )
  process.exit(1)
}

console.log(`Shared-lib drift check passed — ${checked}/${MIRRORED.length} mirrored files in sync.`)
