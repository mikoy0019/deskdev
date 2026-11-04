#!/usr/bin/env node
// Keys for DeskDev's Web Push (supabase/PUSH.md walks through the rest).
//
//   node scripts/generate-vapid-keys.mjs --subject mailto:<an inbox someone reads>
//   node scripts/generate-vapid-keys.mjs --subject https://nixgensolutions.com --project-ref <ref>
//
// Prints a fresh VAPID key pair (P-256, base64url: the 65-byte uncompressed
// public key browsers take as applicationServerKey, and the 32-byte private
// scalar) plus a random PUSH_WEBHOOK_SECRET, then the exact commands that put
// each value where it belongs. Nothing is written to disk: copy the values
// straight into the commands, and keep the private key out of the repo.
//
// Run it ONCE per project. A new key pair silently orphans every existing
// subscription (the browser bound it to the old public key); the app re-
// subscribes on next launch, but until then those devices get nothing.

import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto'

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return undefined
  const v = process.argv[i + 1]
  return v && !v.startsWith('--') ? v : ''
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: node scripts/generate-vapid-keys.mjs --subject mailto:<address> [--project-ref <ref>]')
  process.exit(0)
}

// Apple answers 403 BadJwtToken unless `sub` is a real mailto: or https: URL
// (mailto:…@localhost included), and the value is baked into every push.
const subject = arg('subject') ?? ''
const validSubject =
  (/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(subject) && !/@localhost$/i.test(subject)) ||
  (/^https:\/\/[^\s/]+\.[^\s/]+/i.test(subject) && !/^https:\/\/localhost/i.test(subject))
if (!validSubject) {
  console.error('Pass --subject mailto:<a real inbox> (or an https:// URL of the site).')
  console.error('Push services contact it about abuse; Apple rejects placeholders and localhost.')
  process.exit(1)
}

const ref = arg('project-ref') || 'rgasjotvqwkjbeivlhvn' // DeskDev's Supabase project
if (!/^[a-z0-9]{20}$/.test(ref)) {
  console.error(`--project-ref "${ref}" does not look like a Supabase project ref (20 lowercase letters/digits).`)
  process.exit(1)
}

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const jwk = privateKey.export({ format: 'jwk' })
const x = Buffer.from(jwk.x, 'base64url')
const y = Buffer.from(jwk.y, 'base64url')
const d = Buffer.from(jwk.d, 'base64url')
if (x.length !== 32 || y.length !== 32 || d.length !== 32) throw new Error('Unexpected P-256 key size')

const publicKey = Buffer.concat([Buffer.from([4]), x, y]).toString('base64url')
const privateKeyB64 = d.toString('base64url')
const webhookSecret = randomBytes(32).toString('base64url')

// Prove the printed strings round-trip into a working pair before anyone
// copies them anywhere.
{
  const priv = createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: privateKeyB64 }, format: 'jwk' })
  const pubBytes = Buffer.from(publicKey, 'base64url')
  const pub = createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: pubBytes.subarray(1, 33).toString('base64url'), y: pubBytes.subarray(33).toString('base64url') },
    format: 'jwk',
  })
  const msg = Buffer.from('deskdev-vapid-check')
  if (!verify('sha256', msg, pub, sign('sha256', msg, priv))) throw new Error('Generated key pair failed its self-check')
}

const fnUrl = `https://${ref}.supabase.co/functions/v1/send-push`
const sqlString = (s) => `'${s.replace(/'/g, "''")}'`
const rule = '─'.repeat(78)

console.log(`
${rule}
DeskDev Web Push keys — shown once. Nothing was saved. Do not commit these.
${rule}

VAPID_PUBLIC_KEY      ${publicKey}
VAPID_PRIVATE_KEY     ${privateKeyB64}
VAPID_SUBJECT         ${subject}
PUSH_WEBHOOK_SECRET   ${webhookSecret}

1) Edge Function secrets (from the repo root, logged in to the Supabase CLI):

npx supabase secrets set --project-ref ${ref} \\
  VAPID_PUBLIC_KEY=${publicKey} \\
  VAPID_PRIVATE_KEY=${privateKeyB64} \\
  VAPID_SUBJECT=${subject} \\
  PUSH_WEBHOOK_SECRET=${webhookSecret}

2) Deploy the function (trigger calls carry the shared secret, not a JWT):

npx supabase functions deploy send-push --no-verify-jwt --project-ref ${ref}

3) After applying migration 029 — Vault secrets for the triggers
   (Dashboard → SQL Editor, runs as postgres):

select vault.create_secret(${sqlString(fnUrl)}, 'deskdev_push_function_url', 'send-push Edge Function URL (migration 029)');
select vault.create_secret(${sqlString(webhookSecret)}, 'deskdev_push_secret', 'Bearer secret the push triggers send (= PUSH_WEBHOOK_SECRET)');

   Already created once? Update instead:

select vault.update_secret(id, ${sqlString(webhookSecret)}) from vault.secrets where name = 'deskdev_push_secret';

4) The browser half — the PUBLIC key only:

   site/.env.local and the Cloudflare build environment (NEXT_PUBLIC_* is
   inlined at build time, so redeploy after setting it):

NEXT_PUBLIC_VAPID_PUBLIC_KEY=${publicKey}
${rule}
`)
