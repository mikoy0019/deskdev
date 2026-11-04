#!/usr/bin/env node
// Vault recovery — decrypt rows restored from a Supabase backup.
//
// Mirrors site/src/deskdev/lib/vaultCrypto.ts exactly: PBKDF2-SHA256 → master key,
// which unwraps the random AES-256-GCM data key that every folder name, item
// title and field blob is encrypted with.
//
//   node scripts/vault-recover.mjs <export.json> [--out plain.json]
//
// <export.json> is what the SQL in RECOVERY.md produces:
//   { "meta": {salt, iterations, wrapped_key}, "folders": [...], "items": [...] }
//
// The master password is read from a prompt, never from argv — arguments leak
// into shell history and process listings. Output contains live credentials in
// plaintext: write it somewhere temporary, move the secrets into a password
// manager, then delete it.
import { readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { createRequire } from 'node:module'

// The crypto libraries live in site/ — no separate install for this script.
const require = createRequire(new URL('../site/package.json', import.meta.url))
const { gcm } = require('@noble/ciphers/aes.js')
const { pbkdf2 } = require('@noble/hashes/pbkdf2.js')
const { sha256 } = require('@noble/hashes/sha2.js')
const { hexToBytes, utf8ToBytes } = require('@noble/hashes/utils.js')

const IV_LEN = 12
const KEY_LEN = 32

const deriveKey = (password, saltHex, iterations) =>
  pbkdf2(sha256, utf8ToBytes(password.normalize('NFKC')), hexToBytes(saltHex), {
    c: iterations,
    dkLen: KEY_LEN,
  })

const decryptBytes = (key, blobHex) => {
  const bytes = hexToBytes(blobHex)
  return gcm(key, bytes.slice(0, IV_LEN)).decrypt(bytes.slice(IV_LEN))
}

const decryptString = (key, blobHex) => new TextDecoder().decode(decryptBytes(key, blobHex))

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    const stdout = process.stdout
    const onData = () => stdout.write('\x1b[2K\r' + question) // keep the prompt, hide typing
    process.stdin.on('data', onData)
    rl.question(question, (answer) => {
      process.stdin.off('data', onData)
      rl.close()
      stdout.write('\n')
      resolve(answer)
    })
  })
}

const [file, ...rest] = process.argv.slice(2)
if (!file) {
  console.error('usage: node scripts/vault-recover.mjs <export.json> [--out plain.json]')
  process.exit(1)
}
const outIdx = rest.indexOf('--out')
const outFile = outIdx === -1 ? null : rest[outIdx + 1]

const dump = JSON.parse(readFileSync(file, 'utf8'))
const meta = dump.meta ?? dump.vault_meta
if (!meta?.salt || !meta?.wrapped_key) {
  console.error('export is missing vault_meta (salt + wrapped_key) — without it nothing can be decrypted')
  process.exit(1)
}

const password = await askHidden('Old vault master password: ')

let dataKey
try {
  dataKey = decryptBytes(deriveKey(password, meta.salt, meta.iterations), meta.wrapped_key)
} catch {
  console.error('\nWrong master password for this vault_meta row — nothing was decrypted.')
  console.error('If the backup predates a reset, make sure vault_meta came from the SAME backup as the items.')
  process.exit(1)
}

const folders = (dump.folders ?? []).map((f) => ({
  id: f.id,
  clientId: f.client_id ?? null,
  name: decryptString(dataKey, f.name_enc),
}))

const items = (dump.items ?? []).map((i) => {
  const fields = JSON.parse(decryptString(dataKey, i.data_enc))
  return {
    folder: folders.find((f) => f.id === i.folder_id)?.name ?? i.folder_id,
    type: i.item_type,
    title: decryptString(dataKey, i.title_enc),
    fields,
  }
})

const result = { folders, items }
if (outFile) {
  writeFileSync(outFile, JSON.stringify(result, null, 2))
  console.log(`Decrypted ${items.length} items in ${folders.length} folders → ${outFile}`)
  console.log('This file holds live credentials in plaintext. Move them into a password manager, then delete it.')
} else {
  console.log(JSON.stringify(result, null, 2))
}
