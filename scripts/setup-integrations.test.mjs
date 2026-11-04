// node --test 'scripts/**/*.test.mjs'   (CI: .github/workflows/repo-ci.yml)
//
// Runs the setup for real (LIVE, not --dry-run): the same core the command
// uses (lib/setup-core.mjs), started through lib/setup-test-entry.mjs against a
// stand-in CLI (lib/fake-supabase-cli.mjs), a stand-in functions host and a
// throwaway root. So the paths a dry run never enters are exercised: saving
// keys, setting secrets, the probes, the Vault rows, stopping and resuming,
// the env part. No network, no Supabase project and no real env file is
// involved, and the project ref is a made-up one.

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { appOrigins, generateVapidPair, isTokenKeyring, vapidPairMatches } from './lib/integrations.mjs'
import { gitIgnored } from './lib/setup-core.mjs'
import { TEST_REF, refuseWorld } from './lib/setup-test-entry.mjs'

const REF = TEST_REF
const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, 'lib', 'setup-test-entry.mjs')
const REAL_COMMAND = path.join(HERE, 'setup-integrations.mjs')
const CORE = path.join(HERE, 'lib', 'setup-core.mjs')
const ENV_BEFORE = '# secrets (test)\nSUPABASE_SERVICE_ROLE_KEY=service.role-key-value\nGOOGLE_OAUTH_CLIENT_ID=\nGOOGLE_OAUTH_CLIENT_SECRET=\n\n# n8n\nN8N_API_KEY=n8n-api-key-value\n'
const SITE_BEFORE = 'NEXT_PUBLIC_SITE_URL=http://localhost:6969\n'
const WRITES = /^(secrets set|vault random|vault set)/

/** A throwaway root, a state file the fake CLI and the fake functions share, and a way to run the script in it. */
async function makeWorld(t, { envPath = 'secrets.env', envText = ENV_BEFORE, siteText = SITE_BEFORE } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deskdev-setup-'))
  const envFile = path.join(root, envPath)
  const siteFile = path.join(root, 'site', '.env.local')
  const stateFile = path.join(root, 'state.json')
  fs.mkdirSync(path.join(root, 'site'))
  fs.mkdirSync(path.dirname(envFile), { recursive: true })
  fs.writeFileSync(envFile, envText)
  fs.writeFileSync(siteFile, siteText)
  fs.writeFileSync(stateFile, JSON.stringify({
    secrets: { N8N_WEBHOOK_SECRET: 'n8n-webhook-secret-value' },
    vault: { lead_intake_secret: 'lead-intake-secret-value' },
    subscriptions: 0,
    sealed: 0,
    calls: [],
    failSet: false,
    staleSet: false,
    flakyQueries: 0,
    blind: false,
    gateway: {},
    deployed: { 'send-push': true, google: true, 'google-calendar': true },
  }))
  const state = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  const patch = (change) => { const s = state(); change(s); fs.writeFileSync(stateFile, JSON.stringify(s)) }

  // The answers of the three Edge Functions, word for word (supabase/functions/*/index.ts).
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      const s = state()
      const send = (status, json) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)) }
      const name = req.url.replace(/^\//, '')
      const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim()
      let body = {}
      try { body = JSON.parse(raw || '{}') } catch { /* not JSON */ }
      if (!s.deployed[name]) return send(404, { code: 'NOT_FOUND', message: 'Requested function was not found' })
      if (s.gateway[name]) return send(401, { code: 401, message: 'Missing authorization header' })
      if (name === 'send-push') {
        const needed = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'PUSH_WEBHOOK_SECRET']
        if (s.blind || needed.some((key) => !s.secrets[key])) return send(500, { error: 'Push is not configured.' })
        if (!bearer) return send(401, { error: 'Missing Authorization header' })
        if (bearer !== s.secrets.PUSH_WEBHOOK_SECRET) return send(401, { error: 'Invalid token' })
        if ((body.type === 'notification' || body.type === 'message') && body.record?.id) return send(200, { sent: 0 })
        return send(400, { error: "Expected {type:'notification'|'message', record:{id}}" })
      }
      if (name === 'google') return send(401, { error: 'Sign in again to continue.' })
      if (name === 'google-calendar') {
        const secret = s.secrets.GOOGLE_CALENDAR_WEBHOOK_SECRET
        if (s.blind || !secret || secret.length < 32) return send(503, { error: 'not configured' })
        if (bearer !== secret) return send(401, { error: 'unauthorized' })
        if (body.action !== undefined && body.action !== 'drain') return send(400, { error: 'unknown action' })
        return send(200, { status: 'ok', processed: 0 })
      }
      return send(404, { code: 'NOT_FOUND', message: 'Requested function was not found' })
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const fn = `http://127.0.0.1:${server.address().port}`
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(root, { recursive: true, force: true })
  })

  const run = (args, { seam = {}, env = {} } = {}) =>
    new Promise((resolve) => {
      const before = state().calls.length
      const child = spawn(process.execPath, [SCRIPT, ...args], {
        env: { ...process.env, DESKDEV_SETUP_TEST_WORLD: JSON.stringify({ root, envFile, fn, tick: 2, ...seam }), FAKE_SUPABASE_STATE: stateFile, FAKE_SUPABASE_REF: TEST_REF, ...env },
      })
      let out = ''
      child.stdout.on('data', (chunk) => { out += chunk })
      child.stderr.on('data', (chunk) => { out += chunk })
      child.on('close', (code) => resolve({ code, out, calls: state().calls.slice(before) }))
    })

  return {
    root, fn, envFile, siteFile, state, patch, run,
    envText: () => fs.readFileSync(envFile, 'utf8'),
    env: () => parseEnv(fs.readFileSync(envFile, 'utf8')),
    site: () => parseEnv(fs.readFileSync(siteFile, 'utf8')),
  }
}

/** No secret value may ever reach the output; only names do. */
function assertNoSecretPrinted(w, out) {
  const env = w.env()
  const s = w.state()
  const secrets = [env.SUPABASE_SERVICE_ROLE_KEY, env.N8N_API_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_PUBLIC_KEY, env.GOOGLE_TOKEN_KEYS, env.GOOGLE_OAUTH_CLIENT_SECRET, ...Object.values(s.vault).filter((v) => !v.startsWith('http')), ...Object.entries(s.secrets).filter(([name]) => name !== 'VAPID_SUBJECT' && name !== 'APP_ORIGINS' && name !== 'GOOGLE_TOKEN_KEY_ID' && name !== 'GOOGLE_REDIRECT_BASE').map(([, value]) => value)]
  for (const value of secrets.filter(Boolean)) assert.equal(out.includes(value), false, 'a secret value was printed')
}

describe('setup-integrations, live paths against stand-ins', { concurrency: 4 }, () => {
  test('passes the access token from the env file to the isolated CLI without printing or rewriting it', async (t) => {
    const token = 'test-supabase-access-token'
    const envText = ENV_BEFORE + `SUPABASE_ACCESS_TOKEN=${token}\n`
    const w = await makeWorld(t, { envText })
    w.patch((s) => { s.requiredAccessToken = token })
    const r = await w.run(['--only', 'google', '--dry-run'])
    assert.equal(r.code, 0, r.out)
    assert.ok(r.calls.includes('secrets list'))
    assert.equal(r.calls.includes('missing CLI access token'), false)
    assert.equal(r.out.includes(token), false)
    assert.equal(w.envText(), envText)
    assert.equal(r.calls.some((c) => WRITES.test(c)), false)
  })

  test('push: a first run saves the pair, sets the secrets, proves the function, then switches delivery on', async (t) => {
    const w = await makeWorld(t)
    const r = await w.run(['--only', 'push'])
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /TEST MODE/)
    const env = w.env()
    const s = w.state()
    assert.equal(vapidPairMatches(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY), true)
    assert.equal(env.VAPID_SUBJECT, 'mailto:nixgensolutions@gmail.com')
    assert.equal(s.secrets.VAPID_PUBLIC_KEY, env.VAPID_PUBLIC_KEY)
    assert.equal(s.secrets.VAPID_PRIVATE_KEY, env.VAPID_PRIVATE_KEY)
    assert.equal(s.secrets.VAPID_SUBJECT, env.VAPID_SUBJECT)
    assert.match(s.vault.deskdev_push_secret, /^[0-9a-f]{64}$/)
    assert.equal(s.secrets.PUSH_WEBHOOK_SECRET, s.vault.deskdev_push_secret)
    assert.equal(s.vault.deskdev_push_function_url, `${w.fn}/send-push`)
    // every earlier byte of the secrets file is intact: lines were only added
    assert.equal(w.envText().startsWith(ENV_BEFORE), true)
    assert.equal(w.envText().split('\n').length, ENV_BEFORE.split('\n').length + 3)
    // the site file got the public key, and nothing else
    assert.deepEqual(w.site(), { NEXT_PUBLIC_SITE_URL: 'http://localhost:6969', NEXT_PUBLIC_VAPID_PUBLIC_KEY: env.VAPID_PUBLIC_KEY })
    // one `secrets set` with exactly the four names, and the URL row only after it
    const sets = r.calls.filter((c) => c.startsWith('secrets set'))
    assert.deepEqual(sets, ['secrets set VAPID_PUBLIC_KEY,VAPID_PRIVATE_KEY,VAPID_SUBJECT,PUSH_WEBHOOK_SECRET'])
    assert.ok(r.calls.indexOf('vault set deskdev_push_function_url') > r.calls.indexOf(sets[0]))
    assert.equal(r.calls.some((c) => c.startsWith('UNKNOWN')), false)
    assert.match(r.out, /Done\./)
    assert.match(r.out, /NEXT_PUBLIC_VAPID_PUBLIC_KEY \(environment "production"\)/)
    assertNoSecretPrinted(w, r.out)
    // no temp, backup or lock file is left in the root
    assert.deepEqual(fs.readdirSync(w.root).sort(), ['secrets.env', 'site', 'state.json'])
  })

  test('push: a second run writes nothing anywhere', async (t) => {
    const w = await makeWorld(t)
    assert.equal((await w.run(['--only', 'push'])).code, 0)
    const envText = w.envText()
    const siteText = fs.readFileSync(w.siteFile, 'utf8')
    const before = w.state()
    const r = await w.run(['--only', 'push'])
    assert.equal(r.code, 0, r.out)
    assert.equal(r.calls.some((c) => WRITES.test(c)), false, r.calls.join(' | '))
    assert.equal(w.envText(), envText)
    assert.equal(fs.readFileSync(w.siteFile, 'utf8'), siteText)
    assert.deepEqual(w.state().secrets, before.secrets)
    assert.deepEqual(w.state().vault, before.vault)
    assert.match(r.out, /exists {5}VAPID key pair on the function {2}\(kept; both halves match the env file\)/)
    assert.match(r.out, /unchanged {2}function secrets/)
    assertNoSecretPrinted(w, r.out)
  })

  test('push: a listening dev server leaves the site file alone and ends 2; --force writes it', async (t) => {
    const w = await makeWorld(t)
    const r = await w.run(['--only', 'push'], { seam: { ports: [6990] } })
    assert.equal(r.code, 2, r.out)
    assert.equal(fs.readFileSync(w.siteFile, 'utf8'), SITE_BEFORE)
    assert.equal(w.state().vault.deskdev_push_function_url, `${w.fn}/send-push`)
    assert.match(r.out, /NOT FINISHED/)
    const forced = await w.run(['--only', 'push', '--force'], { seam: { ports: [6990] } })
    assert.equal(forced.code, 0, forced.out)
    assert.equal(w.site().NEXT_PUBLIC_VAPID_PUBLIC_KEY, w.env().VAPID_PUBLIC_KEY)
    assert.equal(forced.calls.some((c) => WRITES.test(c)), false)
  })

  test('push: a function that never sees its secrets stops the run before the URL row; resuming never rotates the pair', async (t) => {
    const w = await makeWorld(t)
    w.patch((s) => { s.blind = true })
    const r = await w.run(['--only', 'push'])
    assert.equal(r.code, 1, r.out)
    assert.match(r.out, /does not answer as configured yet \(unconfigured\)/)
    assert.match(r.out, /--only push --resume-push/)
    assert.equal('deskdev_push_function_url' in w.state().vault, false)
    const pub = w.env().VAPID_PUBLIC_KEY
    assert.equal(w.state().secrets.VAPID_PUBLIC_KEY, pub)

    w.patch((s) => { s.blind = false })
    const plain = await w.run(['--only', 'push'])
    assert.equal(plain.code, 2, plain.out)
    assert.match(plain.out, /OFF {8}Vault deskdev_push_function_url/)
    assert.match(plain.out, /push delivery is OFF\. Switch it on with: node scripts\/setup-integrations\.mjs --only push --resume-push/)
    assert.equal('deskdev_push_function_url' in w.state().vault, false)

    const resumed = await w.run(['--only', 'push', '--resume-push'])
    assert.equal(resumed.code, 0, resumed.out)
    assert.equal(w.state().vault.deskdev_push_function_url, `${w.fn}/send-push`)
    assert.equal(w.env().VAPID_PUBLIC_KEY, pub)
    assert.equal(w.state().secrets.VAPID_PUBLIC_KEY, pub)
    assert.equal(resumed.calls.some((c) => c.startsWith('secrets set')), false)
  })

  test('push: when setting the secrets fails, the pair is already on disk and the next run sends that same pair', async (t) => {
    const w = await makeWorld(t)
    w.patch((s) => { s.failSet = true })
    const r = await w.run(['--only', 'push'])
    assert.equal(r.code, 1, r.out)
    assert.match(r.out, /setting function secrets failed \(VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PUSH_WEBHOOK_SECRET\)/)
    const env = w.env()
    assert.equal(vapidPairMatches(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY), true)
    assert.equal('VAPID_PUBLIC_KEY' in w.state().secrets, false)
    w.patch((s) => { s.failSet = false })
    const again = await w.run(['--only', 'push'])
    assert.equal(again.code, 0, again.out)
    assert.match(again.out, /reusing {4}VAPID key pair from the env file/)
    assert.equal(w.state().secrets.VAPID_PUBLIC_KEY, env.VAPID_PUBLIC_KEY)
    assert.equal(w.state().secrets.VAPID_PRIVATE_KEY, env.VAPID_PRIVATE_KEY)
    assert.equal(w.envText().match(/^VAPID_PUBLIC_KEY=/gm).length, 1)
  })

  test('push: a secret that does not read back from the listing stops the run before the URL row', async (t) => {
    const w = await makeWorld(t)
    w.patch((s) => { s.staleSet = true })
    const r = await w.run(['--only', 'push'])
    assert.equal(r.code, 1, r.out)
    assert.match(r.out, /did not read back from Supabase as sent/)
    assert.equal('deskdev_push_function_url' in w.state().vault, false)
  })

  test('a database query that fails now and then is retried; one that keeps failing stops the run cleanly', async (t) => {
    const w = await makeWorld(t)
    // the CLI's database login fails three times in a row, then works
    w.patch((s) => { s.flakyQueries = 3 })
    const r = await w.run(['--only', 'push'])
    assert.equal(r.code, 0, r.out)
    assert.equal(r.calls.filter((c) => c === 'query failed').length, 3)
    assert.equal(w.state().vault.deskdev_push_function_url, `${w.fn}/send-push`)
    // exactly one random secret and one pair, although calls were repeated
    assert.equal(r.calls.filter((c) => c === 'vault random deskdev_push_secret').length, 1)
    assert.equal(w.envText().match(/^VAPID_PUBLIC_KEY=/gm).length, 1)

    const down = await makeWorld(t)
    down.patch((s) => { s.flakyQueries = 99 })
    const stopped = await down.run(['--only', 'push'])
    assert.equal(stopped.code, 1, stopped.out)
    assert.match(stopped.out, /a database query failed four times in a row/)
    assert.equal(down.envText(), ENV_BEFORE)
    assert.equal(down.state().calls.some((c) => WRITES.test(c)), false)
  })

  test('nothing is written for a function that is missing or behind the JWT gateway', async (t) => {
    const w = await makeWorld(t)
    w.patch((s) => { s.deployed['send-push'] = false })
    const missing = await w.run(['--only', 'push'])
    assert.equal(missing.code, 1, missing.out)
    assert.match(missing.out, /the send-push function is not deployed on this project\. Nothing was changed for Web Push\./)
    w.patch((s) => { s.deployed['send-push'] = true; s.gateway['send-push'] = true })
    const gated = await w.run(['--only', 'push'])
    assert.equal(gated.code, 1, gated.out)
    assert.match(gated.out, /deployed with JWT verification on/)
    w.patch((s) => { s.gateway = { 'google-calendar': true } })
    const calendar = await w.run(['--only', 'google'])
    assert.equal(calendar.code, 1, calendar.out)
    assert.match(calendar.out, /the google-calendar function is deployed with JWT verification on.*Nothing was changed for Google connect\./)
    assert.equal(w.envText(), ENV_BEFORE)
    assert.equal(w.state().calls.some((c) => WRITES.test(c)), false)
  })

  test('push: what the env file holds is checked before anything is made or sent', async (t) => {
    const w = await makeWorld(t)
    // half a pair
    fs.writeFileSync(w.envFile, `${ENV_BEFORE}VAPID_PUBLIC_KEY=BPublicHalfOnly\n`)
    const half = await w.run(['--only', 'push'])
    assert.equal(half.code, 1, half.out)
    assert.match(half.out, /only one half of the VAPID key pair is in the env file/)
    // a file that is not valid UTF-8 is not edited, and nothing remote happens
    fs.writeFileSync(w.envFile, Buffer.concat([Buffer.from('# caf'), Buffer.from([0xe9]), Buffer.from('\nA=1\n')]))
    const latin = await w.run(['--only', 'push'])
    assert.equal(latin.code, 1, latin.out)
    assert.match(latin.out, /is not valid UTF-8, so this script does not edit it\. The file was not changed\./)
    assert.equal(w.state().calls.some((c) => WRITES.test(c)), false)
    // devices subscribed with a pair nobody holds: no new pair without the flag
    fs.writeFileSync(w.envFile, ENV_BEFORE)
    w.patch((s) => { s.subscriptions = 3 })
    const subscribed = await w.run(['--only', 'push'])
    assert.equal(subscribed.code, 1, subscribed.out)
    assert.match(subscribed.out, /3 device\(s\) are subscribed with another key pair/)
    assert.equal(w.envText(), ENV_BEFORE)
    const rotated = await w.run(['--only', 'push', '--rotate-vapid'])
    assert.equal(rotated.code, 0, rotated.out)
  })

  test('google: the sealing key, the origins, the calendar secret and its switch; then nothing on a second run', async (t) => {
    const w = await makeWorld(t)
    const r = await w.run(['--only', 'google'])
    assert.equal(r.code, 0, r.out)
    const env = w.env()
    const s = w.state()
    assert.equal(isTokenKeyring(env.GOOGLE_TOKEN_KEYS), true)
    assert.equal(env.GOOGLE_TOKEN_KEY_ID, 'k1')
    assert.equal(s.secrets.GOOGLE_TOKEN_KEYS, env.GOOGLE_TOKEN_KEYS)
    assert.equal(s.secrets.GOOGLE_TOKEN_KEY_ID, 'k1')
    assert.equal(s.secrets.APP_ORIGINS, appOrigins())
    assert.match(s.vault.deskdev_google_calendar_secret, /^[0-9a-f]{64}$/)
    assert.equal(s.secrets.GOOGLE_CALENDAR_WEBHOOK_SECRET, s.vault.deskdev_google_calendar_secret)
    assert.equal(s.vault.deskdev_google_calendar_url, `${w.fn}/google-calendar`)
    assert.equal('GOOGLE_OAUTH_CLIENT_ID' in s.secrets, false)
    assert.equal(w.envText().startsWith(ENV_BEFORE), true)
    assert.match(r.out, /waiting {4}Google OAuth client/)
    assert.match(r.out, /"Runbook" steps 1 to 4/)
    assert.equal(r.calls.some((c) => c.startsWith('UNKNOWN')), false)
    assertNoSecretPrinted(w, r.out)

    const again = await w.run(['--only', 'google'])
    assert.equal(again.code, 0, again.out)
    assert.equal(again.calls.some((c) => WRITES.test(c)), false, again.calls.join(' | '))
    assert.equal(w.envText(), fs.readFileSync(w.envFile, 'utf8'))
  })

  test('google: the OAuth client is sent once it is in the env file, and never silently replaced afterwards', async (t) => {
    const w = await makeWorld(t)
    assert.equal((await w.run(['--only', 'google'])).code, 0)
    const withClient = (secret) => fs.writeFileSync(w.envFile, w.envText().replace(/^GOOGLE_OAUTH_CLIENT_ID=.*$/m, 'GOOGLE_OAUTH_CLIENT_ID=123456-abcdef.apps.googleusercontent.com').replace(/^GOOGLE_OAUTH_CLIENT_SECRET=.*$/m, `GOOGLE_OAUTH_CLIENT_SECRET=${secret}`))
    withClient('GOCSPX-first_secret-value')
    const sent = await w.run(['--only', 'google'])
    assert.equal(sent.code, 0, sent.out)
    assert.deepEqual(sent.calls.filter((c) => c.startsWith('secrets set')), ['secrets set GOOGLE_OAUTH_CLIENT_ID,GOOGLE_OAUTH_CLIENT_SECRET'])
    assert.equal(w.state().secrets.GOOGLE_OAUTH_CLIENT_SECRET, 'GOCSPX-first_secret-value')
    assert.match(sent.out, /set {8}Google OAuth client/)
    assertNoSecretPrinted(w, sent.out)

    // the secret is rotated on the function; the env file still holds the old one
    w.patch((s) => { s.secrets.GOOGLE_OAUTH_CLIENT_SECRET = 'GOCSPX-rotated-on-the-function' })
    const kept = await w.run(['--only', 'google'])
    assert.equal(kept.code, 2, kept.out)
    assert.match(kept.out, /kept {7}Google OAuth client/)
    assert.equal(w.state().secrets.GOOGLE_OAUTH_CLIENT_SECRET, 'GOCSPX-rotated-on-the-function')
    assert.equal(kept.calls.some((c) => c.startsWith('secrets set')), false)

    const replaced = await w.run(['--only', 'google', '--replace-client'])
    assert.equal(replaced.code, 0, replaced.out)
    assert.equal(w.state().secrets.GOOGLE_OAUTH_CLIENT_SECRET, 'GOCSPX-first_secret-value')
    assert.deepEqual(replaced.calls.filter((c) => c.startsWith('secrets set')), ['secrets set GOOGLE_OAUTH_CLIENT_SECRET'])
  })

  test('google: the dev origin is added on request, remembered on later runs, and never forced over an edited list', async (t) => {
    const w = await makeWorld(t)
    const dev = await w.run(['--only', 'google', '--dev-origin'])
    assert.equal(dev.code, 0, dev.out)
    assert.equal(w.state().secrets.APP_ORIGINS, appOrigins({ dev: true }))
    const later = await w.run(['--only', 'google'])
    assert.equal(later.code, 0, later.out)
    assert.equal(w.state().secrets.APP_ORIGINS, appOrigins({ dev: true }))
    assert.match(later.out, /APP_ORIGINS on the live function allows http:\/\/localhost:6969/)
    const prod = await w.run(['--only', 'google', '--prod-origins'])
    assert.equal(prod.code, 0, prod.out)
    assert.equal(w.state().secrets.APP_ORIGINS, appOrigins())

    w.patch((s) => { s.secrets.APP_ORIGINS = 'https://edited.example' })
    const refused = await w.run(['--only', 'google', '--dev-origin'])
    assert.equal(refused.code, 2, refused.out)
    assert.equal(w.state().secrets.APP_ORIGINS, 'https://edited.example')
    assert.match(refused.out, /http:\/\/localhost:6969 was not added: APP_ORIGINS on the function is a list someone edited/)
  })

  test('google: the workers.dev address is added on request, kept by later runs, and taken out by --prod-origins', async (t) => {
    const w = await makeWorld(t)
    assert.equal((await w.run(['--only', 'google'])).code, 0)
    const added = await w.run(['--only', 'google', '--workers-dev-origin'])
    assert.equal(added.code, 0, added.out)
    assert.equal(w.state().secrets.APP_ORIGINS, appOrigins({ workersDev: true }))
    assert.deepEqual(added.calls.filter((c) => c.startsWith('secrets set')), ['secrets set APP_ORIGINS'])
    assert.match(added.out, /APP_ORIGINS includes https:\/\/nixgen-site\.nixgensolutions\.workers\.dev/)
    // asking again sends nothing; a later --dev-origin keeps the workers.dev address
    const again = await w.run(['--only', 'google', '--workers-dev-origin'])
    assert.equal(again.calls.some((c) => c.startsWith('secrets set')), false)
    const dev = await w.run(['--only', 'google', '--dev-origin'])
    assert.equal(dev.code, 0, dev.out)
    assert.equal(w.state().secrets.APP_ORIGINS, appOrigins({ dev: true, workersDev: true }))
    const plain = await w.run(['--only', 'google'])
    assert.match(plain.out, /after the DNS cutover: APP_ORIGINS on the live function still allows https:\/\/nixgen-site\.nixgensolutions\.workers\.dev/)
    const reset = await w.run(['--only', 'google', '--prod-origins'])
    assert.equal(reset.code, 0, reset.out)
    assert.equal(w.state().secrets.APP_ORIGINS, appOrigins())
  })

  test('google: stored connections sealed with a key nobody holds stop a new key from being made', async (t) => {
    const w = await makeWorld(t)
    w.patch((s) => { s.sealed = 2 })
    const r = await w.run(['--only', 'google'])
    assert.equal(r.code, 1, r.out)
    assert.match(r.out, /2 stored Google connection\(s\) are sealed with a key that is neither on the function nor in the env file/)
    assert.equal(w.envText(), ENV_BEFORE)
    assert.equal(w.state().calls.some((c) => WRITES.test(c)), false)
  })

  test('google: a calendar function that never sees its secret leaves sync off and says how to resume', async (t) => {
    const w = await makeWorld(t)
    w.patch((s) => { s.blind = true })
    const r = await w.run(['--only', 'google'])
    assert.equal(r.code, 2, r.out)
    assert.match(r.out, /--only google --resume-calendar/)
    assert.equal('deskdev_google_calendar_url' in w.state().vault, false)
    w.patch((s) => { s.blind = false })
    const off = await w.run(['--only', 'google'])
    assert.equal(off.code, 2, off.out)
    assert.match(off.out, /calendar sync is OFF/)
    const on = await w.run(['--only', 'google', '--resume-calendar'])
    assert.equal(on.code, 0, on.out)
    assert.equal(w.state().vault.deskdev_google_calendar_url, `${w.fn}/google-calendar`)
  })

  test('a dry run reads and changes nothing; the full run after it does both parts', async (t) => {
    const w = await makeWorld(t)
    const before = w.state()
    const dry = await w.run(['--dry-run'])
    assert.equal(dry.code, 0, dry.out)
    assert.equal(dry.calls.some((c) => WRITES.test(c)), false, dry.calls.join(' | '))
    assert.equal(w.envText(), ENV_BEFORE)
    assert.equal(fs.readFileSync(w.siteFile, 'utf8'), SITE_BEFORE)
    assert.deepEqual(w.state().secrets, before.secrets)
    assert.deepEqual(w.state().vault, before.vault)
    assert.match(dry.out, /Dry run finished: nothing was changed\./)

    const live = await w.run([])
    assert.equal(live.code, 0, live.out)
    const s = w.state()
    assert.equal(s.vault.deskdev_push_function_url, `${w.fn}/send-push`)
    assert.equal(s.vault.deskdev_google_calendar_url, `${w.fn}/google-calendar`)
    assert.equal(w.envText().startsWith(ENV_BEFORE), true)
    assert.deepEqual(Object.keys(w.env()).filter((k) => !ENV_BEFORE.includes(`${k}=`)).sort(), ['GOOGLE_TOKEN_KEYS', 'GOOGLE_TOKEN_KEY_ID', 'VAPID_PRIVATE_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_SUBJECT'])
    assertNoSecretPrinted(w, dry.out + live.out)
  })

  test('two runs at once: one works, the other stops without writing', async (t) => {
    const w = await makeWorld(t)
    const [a, b] = await Promise.all([w.run(['--only', 'push']), w.run(['--only', 'push'])])
    const codes = [a.code, b.code].sort()
    assert.deepEqual(codes, [0, 1], `${a.out}\n-----\n${b.out}`)
    const stopped = a.code === 1 ? a : b
    assert.match(stopped.out, /another run of this script is in progress/)
    assert.equal(w.envText().match(/^VAPID_PUBLIC_KEY=/gm).length, 1)
    assert.equal(w.state().secrets.VAPID_PUBLIC_KEY, w.env().VAPID_PUBLIC_KEY)
  })

  test('a lock left by a run that is gone is cleared; one held by a live process stops the run', async (t) => {
    const w = await makeWorld(t)
    const lock = path.join(w.root, '.setup.lock')
    // this test's own process is alive, so its pid stands in for "another run"
    fs.writeFileSync(lock, String(process.pid))
    const held = await w.run(['--only', 'push'])
    assert.equal(held.code, 1, held.out)
    assert.match(held.out, /another run of this script is in progress/)
    assert.equal(w.envText(), ENV_BEFORE)
    assert.equal(fs.readFileSync(lock, 'utf8'), String(process.pid))
    // a pid no process has (and unreadable content) is a leftover
    for (const leftover of ['2147483646', 'not a pid', '']) {
      fs.writeFileSync(lock, leftover)
      const r = await w.run(['--only', 'push', '--dry-run'])
      assert.equal(r.code, 0, r.out)
    }
    fs.writeFileSync(lock, '2147483646')
    const cleared = await w.run(['--only', 'push'])
    assert.equal(cleared.code, 0, cleared.out)
    assert.equal(fs.existsSync(lock), false)
  })

  test('push: keys the function already holds are kept, checked against the env file, and never replaced by a new pair', async (t) => {
    const pair = generateVapidPair()
    const other = generateVapidPair()
    const held = (s) => { Object.assign(s.secrets, { VAPID_PUBLIC_KEY: pair.publicKey, VAPID_PRIVATE_KEY: pair.privateKey, VAPID_SUBJECT: 'mailto:nixgensolutions@gmail.com' }) }

    // the public key is in no env file: nothing is made, nothing is sent
    const none = await makeWorld(t)
    none.patch(held)
    const r1 = await none.run(['--only', 'push'])
    assert.equal(r1.code, 1, r1.out)
    assert.match(r1.out, /the function already has VAPID keys, but the public key is in no env file/)
    assert.equal(none.envText(), ENV_BEFORE)
    assert.equal(r1.calls.some((c) => WRITES.test(c)), false)

    // another public key in the env file
    const differs = await makeWorld(t, { envText: `${ENV_BEFORE}VAPID_PUBLIC_KEY=${other.publicKey}\nVAPID_PRIVATE_KEY=${other.privateKey}\n` })
    differs.patch(held)
    const r2 = await differs.run(['--only', 'push'])
    assert.equal(r2.code, 1, r2.out)
    assert.match(r2.out, /the VAPID public key in the env file is not the one the function holds/)
    assert.equal(differs.state().secrets.VAPID_PUBLIC_KEY, pair.publicKey)

    // the private half is not in the env file: the pair is kept as it is and the rest is set up
    const publicOnly = await makeWorld(t, { envText: `${ENV_BEFORE}VAPID_PUBLIC_KEY=${pair.publicKey}\n` })
    publicOnly.patch(held)
    const r3 = await publicOnly.run(['--only', 'push'])
    assert.equal(r3.code, 0, r3.out)
    assert.match(r3.out, /kept\. Its private half is in no env file/)
    assert.equal(publicOnly.state().secrets.VAPID_PRIVATE_KEY, pair.privateKey)
    assert.deepEqual(r3.calls.filter((c) => c.startsWith('secrets set')), ['secrets set PUSH_WEBHOOK_SECRET'])

    // a private half that belongs to another pair: stop, the function is left alone
    const wrongHalf = await makeWorld(t, { envText: `${ENV_BEFORE}VAPID_PUBLIC_KEY=${pair.publicKey}\nVAPID_PRIVATE_KEY=${other.privateKey}\n` })
    wrongHalf.patch(held)
    const r4 = await wrongHalf.run(['--only', 'push'])
    assert.equal(r4.code, 1, r4.out)
    assert.match(r4.out, /VAPID_PRIVATE_KEY in the env file does not belong to the public key the function holds/)
    assert.equal(r4.calls.some((c) => WRITES.test(c)), false)

    // the env file holds the right pair and the function's private half is not it: only that half is repaired
    const broken = await makeWorld(t, { envText: `${ENV_BEFORE}VAPID_PUBLIC_KEY=${pair.publicKey}\nVAPID_PRIVATE_KEY=${pair.privateKey}\n` })
    broken.patch((s) => { held(s); s.secrets.VAPID_PRIVATE_KEY = other.privateKey })
    const r5 = await broken.run(['--only', 'push'])
    assert.equal(r5.code, 0, r5.out)
    assert.match(r5.out, /fixing\s+VAPID private key on the function/)
    assert.equal(broken.state().secrets.VAPID_PRIVATE_KEY, pair.privateKey)
    assert.equal(broken.state().secrets.VAPID_PUBLIC_KEY, pair.publicKey)
    assert.deepEqual(r5.calls.filter((c) => c.startsWith('secrets set')), ['secrets set VAPID_PRIVATE_KEY,PUSH_WEBHOOK_SECRET'])
    for (const r of [r1, r2, r3, r4, r5]) for (const secret of [pair.privateKey, other.privateKey]) assert.equal(r.out.includes(secret), false)
  })

  test('a switch row that points somewhere else is corrected; --redirect-base is sent', async (t) => {
    const w = await makeWorld(t)
    assert.equal((await w.run([])).code, 0)
    w.patch((s) => { s.vault.deskdev_push_function_url = 'https://old.example/functions/v1/send-push'; s.vault.deskdev_google_calendar_url = 'https://old.example/functions/v1/google-calendar' })
    const r = await w.run(['--redirect-base', 'https://nixgensolutions.com/api/google'])
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /fixed\s+Vault deskdev_push_function_url {2}\(it pointed somewhere else\)/)
    assert.match(r.out, /fixed\s+Vault deskdev_google_calendar_url/)
    assert.equal(w.state().vault.deskdev_push_function_url, `${w.fn}/send-push`)
    assert.equal(w.state().vault.deskdev_google_calendar_url, `${w.fn}/google-calendar`)
    assert.equal(w.state().secrets.GOOGLE_REDIRECT_BASE, 'https://nixgensolutions.com/api/google')
    assert.deepEqual(r.calls.filter((c) => c.startsWith('secrets set')), ['secrets set GOOGLE_REDIRECT_BASE'])
  })

  test('every CLI call names the project: a stand-in for another project answers nothing', async (t) => {
    const w = await makeWorld(t)
    const r = await w.run(['--only', 'push'], { env: { FAKE_SUPABASE_REF: 'anotherprojectref000' } })
    assert.equal(r.code, 1, r.out)
    assert.match(r.out, /could not list the function secrets/)
    assert.equal(w.state().calls.every((c) => c === 'WRONG PROJECT REF'), true)
    assert.equal(w.envText(), ENV_BEFORE)
  })
})

// ---------------------------------------------------------------- the boundary between test and real

describe('the real command has no test mode, and the test entry cannot reach the repository', () => {
  test('nothing in the real command or the core reads a test switch', () => {
    const command = fs.readFileSync(REAL_COMMAND, 'utf8')
    const core = fs.readFileSync(CORE, 'utf8')
    for (const word of ['DESKDEV_SETUP_TEST', 'fake-supabase-cli', 'setup-test-entry', 'TEST MODE']) assert.equal(command.includes(word), false, word)
    for (const word of ['DESKDEV_SETUP_TEST', 'fake-supabase-cli', 'TEST MODE']) assert.equal(core.includes(word), false, word)
    // Only CLI discovery and the owner's CLI credential may read named env keys.
    assert.deepEqual([...core.matchAll(/process\.env\.([A-Z_]+)/g)].map((m) => m[1]).sort(), ['LOCALAPPDATA', 'LOCALAPPDATA', 'SUPABASE_ACCESS_TOKEN'])
  })

  test('a world is refused unless it is a throwaway folder of its own', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deskdev-world-'))
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'deskdev-outside-'))
    t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }) })
    fs.mkdirSync(path.join(root, 'site'))
    const envFile = path.join(root, 'secrets.env')
    fs.writeFileSync(envFile, 'A=1\n')
    const fn = 'http://127.0.0.1:1'
    const world = (changes) => JSON.stringify({ root, envFile, fn, ...changes })
    assert.equal(refuseWorld(world({})), null)
    assert.equal(refuseWorld(world({ ports: [6969], tick: 2 })), null)

    // shape
    for (const raw of [undefined, '', '{', '[]', 'true', '{}', world({ fn: 'https://example.com' }), world({ fn: `${fn}@evil.example` }), world({ fn: `${fn}/x` }), world({ root: 'relative' }), world({ envFile: 'secrets.env' }), world({ ports: ['6969'] }), world({ tick: -1 })]) {
      assert.notEqual(refuseWorld(raw), null, String(raw))
    }
    // the repository, however its path is written, and anything around it
    const repo = path.resolve(HERE, '..')
    const spellings = [repo, HERE, path.dirname(repo), path.join(repo, 'site')]
    if (process.platform === 'win32') spellings.push(repo.toLowerCase(), repo.toUpperCase(), repo[0].toLowerCase() + repo.slice(1))
    for (const spelled of spellings) {
      assert.match(String(refuseWorld(JSON.stringify({ root: spelled, envFile: path.join(spelled, 'web', '.env.local'), fn }))), /this repository|could not be checked|does not exist/, spelled)
    }
    // an env file that is somewhere else
    const elsewhere = path.join(outside, 'real.env')
    fs.writeFileSync(elsewhere, 'SECRET=1\n')
    assert.match(refuseWorld(world({ envFile: elsewhere })), /leads outside the root/)
    // …or that is a second name of a file somewhere else
    const twin = path.join(root, 'twin.env')
    fs.linkSync(elsewhere, twin)
    assert.match(refuseWorld(world({ envFile: twin })), /hard link/)
    fs.rmSync(twin)
    // a folder below the root that is really a link to somewhere else
    fs.rmSync(path.join(root, 'site'), { recursive: true })
    fs.mkdirSync(path.join(outside, 'site'))
    fs.symlinkSync(path.join(outside, 'site'), path.join(root, 'site'), 'junction')
    assert.match(refuseWorld(world({})), /site leads outside the root|is a link/)
    assert.equal(fs.readFileSync(elsewhere, 'utf8'), 'SECRET=1\n')
  })

  test('a refused world stops the entry before anything runs', async (t) => {
    const w = await makeWorld(t)
    const repo = path.resolve(HERE, '..')
    // --dry-run as well, so that even a broken guard could not write
    const r = await w.run(['--only', 'push', '--dry-run'], { env: { DESKDEV_SETUP_TEST_WORLD: JSON.stringify({ root: process.platform === 'win32' ? repo.toLowerCase() : repo, envFile: path.join(repo, 'web', '.env.local'), fn: w.fn }) } })
    assert.equal(r.code, 1, r.out)
    assert.match(r.out, /STOP: the test world is refused: .*Nothing was read or changed\./)
    assert.equal(/TEST MODE|function secrets now/.test(r.out), false)
    assert.equal(w.state().calls.length, 0)
    const none = await w.run(['--only', 'push', '--dry-run'], { env: { DESKDEV_SETUP_TEST_WORLD: '' } })
    assert.equal(none.code, 1, none.out)
    assert.equal(w.state().calls.length, 0)
  })

  test('gitIgnored: ignored inside the repo, anything outside it, and never a tracked or plain file', (t) => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'deskdev-git-'))
    t.after(() => fs.rmSync(repo, { recursive: true, force: true }))
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: repo }).status, 0)
    fs.writeFileSync(path.join(repo, '.gitignore'), '.env.*\n!.env.example\n')
    fs.writeFileSync(path.join(repo, '.env.local'), 'A=1\n')
    fs.writeFileSync(path.join(repo, 'notes.txt'), 'plain\n')
    assert.equal(gitIgnored(repo, path.join(repo, '.env.local')), true)
    assert.equal(gitIgnored(repo, path.join(repo, '.env.local.before-setup')), true)
    assert.equal(gitIgnored(repo, path.join(repo, '.env.local.tmp-123-abc')), true)
    assert.equal(gitIgnored(repo, path.join(repo, 'notes.txt')), false)
    assert.equal(gitIgnored(repo, path.join(repo, '.env.example')), false)
    assert.equal(gitIgnored(repo, path.join(os.tmpdir(), 'somewhere-else.env')), true)
  })
})

// ---------------------------------------------------------------- the env part

const jwt =(payload) => ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'c2lnbmF0dXJl'].join('.')
const ANON = jwt({ role: 'anon', ref: REF })
const SERVICE = jwt({ role: 'service_role', ref: REF })
const LEGACY = `VITE_SUPABASE_URL=https://${REF}.supabase.co\nVITE_SUPABASE_ANON_KEY=${ANON}\nSUPABASE_SERVICE_ROLE_KEY=${SERVICE}\nNEXT_PUBLIC_SITE_URL=http://localhost:6969\nN8N_API_KEY=n8n-api-key-value\nGOOGLE_OAUTH_CLIENT_ID=\nVAPID_PUBLIC_KEY=BPublicKeyForTheTest_-123\nVAPID_PRIVATE_KEY=private-key-for-the-test\n`
const envWorld = (t, changes = {}) => makeWorld(t, { envPath: 'web/.env.local', envText: LEGACY, siteText: `${LEGACY}NEXT_PUBLIC_VAPID_PUBLIC_KEY=BPublicKeyForTheTest_-123\n`, ...changes })

describe('setup-integrations, the env part against stand-ins', { concurrency: 4 }, () => {
  test('env: copies the secrets file to the root, strips the site file to public keys with a backup, writes .dev.vars', async (t) => {
    const w = await envWorld(t)
    const siteBefore = fs.readFileSync(w.siteFile)
    const r = await w.run(['--only', 'env', '--yes-env'])
    assert.equal(r.code, 0, r.out)
    // 1. the root file is a byte copy; the legacy file is untouched
    assert.equal(fs.readFileSync(path.join(w.root, '.env.local'), 'utf8'), LEGACY)
    assert.equal(w.envText(), LEGACY)
    // 2. the site file holds exactly the public build values, and no secret
    assert.deepEqual(w.site(), { NEXT_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co`, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'BPublicKeyForTheTest_-123' })
    const siteText = fs.readFileSync(w.siteFile, 'utf8')
    for (const secret of [SERVICE, 'n8n-api-key-value', 'private-key-for-the-test']) assert.equal(siteText.includes(secret), false)
    // the file as it was is kept next to it, byte for byte
    assert.equal(fs.readFileSync(`${w.siteFile}.before-setup`).equals(siteBefore), true)
    // 3. the Worker's local secrets: the intake secret is the Vault's, the other two are new and long
    const dev = parseEnv(fs.readFileSync(path.join(w.root, 'site', '.dev.vars'), 'utf8'))
    assert.equal(dev.LEAD_INTAKE_SECRET, 'lead-intake-secret-value')
    assert.match(dev.LEAD_IP_SALT, /^[0-9a-f]{48}$/)
    assert.match(dev.FORM_TOKEN_SECRET, /^[0-9a-f]{64}$/)
    assert.deepEqual(Object.keys(dev).sort(), ['FORM_TOKEN_SECRET', 'LEAD_INTAKE_SECRET', 'LEAD_IP_SALT'])
    // nothing remote is written by this part, and no secret is printed
    assert.equal(r.calls.some((c) => WRITES.test(c)), false)
    for (const secret of [SERVICE, ANON, 'n8n-api-key-value', 'private-key-for-the-test', 'lead-intake-secret-value', dev.LEAD_IP_SALT, dev.FORM_TOKEN_SECRET]) assert.equal(r.out.includes(secret), false)
    // the switch from the demo workspace to the live database is its own line, and stays on the owner's list
    assert.match(r.out, /CHANGED {4}local dev: demo workspace -> the LIVE database/)
    assert.match(r.out, /Still needs the owner:[\s\S]*local dev now uses the LIVE database/)
    // the CLI was asked once, from the root, whether it accepts the new file
    assert.equal(r.calls.filter((c) => c === 'probe query').length, 1)

    // a second run finds everything in place and touches nothing
    const snapshot = ['.env.local', 'web/.env.local', 'site/.env.local', 'site/.dev.vars', 'site/.env.local.before-setup'].map((f) => fs.readFileSync(path.join(w.root, f), 'utf8'))
    const again = await w.run(['--only', 'env', '--yes-env'])
    assert.equal(again.code, 0, again.out)
    assert.deepEqual(['.env.local', 'web/.env.local', 'site/.env.local', 'site/.dev.vars', 'site/.env.local.before-setup'].map((f) => fs.readFileSync(path.join(w.root, f), 'utf8')), snapshot)
    assert.equal((again.out.match(/^ {2}exists /gm) ?? []).length, 3, again.out)
    assert.equal(fs.existsSync(`${w.siteFile}.before-setup-2`), false)
  })

  test('env: never runs without the owner flag, and a dry run writes nothing', async (t) => {
    const w = await envWorld(t)
    const refused = await w.run(['--only', 'env'])
    assert.equal(refused.code, 1, refused.out)
    assert.match(refused.out, /STOP: the env part rewrites env files/)
    const implied = await w.run(['--yes-env'])
    assert.equal(implied.code, 1, implied.out)
    assert.match(implied.out, /--yes-env belongs to the env part/)
    const dry = await w.run(['--only', 'env', '--dry-run'])
    assert.equal(dry.code, 0, dry.out)
    assert.match(dry.out, /would add {2}\.env\.local \(repo root\)/)
    assert.match(dry.out, /would write site\/\.env\.local/)
    assert.match(dry.out, /would write site\/\.dev\.vars/)
    assert.deepEqual(fs.readdirSync(w.root).sort(), ['site', 'state.json', 'web'])
    assert.deepEqual(fs.readdirSync(path.join(w.root, 'site')), ['.env.local'])
    // it reads (the listing, the Vault names, the intake secret it would copy) and writes nothing
    assert.equal(w.state().calls.some((c) => WRITES.test(c)), false)
    assert.equal(dry.out.includes('lead-intake-secret-value'), false)
  })

  test('env: a listening dev server stops it before any file is made; --force goes on', async (t) => {
    const w = await envWorld(t)
    const r = await w.run(['--only', 'env', '--yes-env'], { seam: { ports: [6969] } })
    assert.equal(r.code, 1, r.out)
    assert.match(r.out, /a dev server is listening on 6969\. It would restart against the LIVE database/)
    assert.deepEqual(fs.readdirSync(w.root).sort(), ['site', 'state.json', 'web'])
    const dry = await w.run(['--only', 'env', '--dry-run'], { seam: { ports: [6969] } })
    assert.equal(dry.code, 0, dry.out)
    assert.match(dry.out, /a real run stops here/)
    const forced = await w.run(['--only', 'env', '--yes-env', '--force'], { seam: { ports: [6969] } })
    assert.equal(forced.code, 0, forced.out)
    assert.equal(fs.existsSync(path.join(w.root, '.env.local')), true)
  })

  test('env: the site file is not rewritten when it holds a secret the root file lacks, or when the browser key is not an anon key', async (t) => {
    const extra = await envWorld(t, { siteText: `${LEGACY}ONLY_IN_SITE=a-secret-kept-nowhere-else\n` })
    const siteBefore = fs.readFileSync(extra.siteFile, 'utf8')
    const r = await extra.run(['--only', 'env', '--yes-env'])
    assert.equal(r.code, 1, r.out)
    assert.match(r.out, /site\/\.env\.local holds 1 non-public value\(s\) that are not in the root file \(ONLY_IN_SITE\)/)
    assert.equal(fs.readFileSync(extra.siteFile, 'utf8'), siteBefore)
    assert.equal(r.out.includes('a-secret-kept-nowhere-else'), false)
    assert.equal(fs.existsSync(path.join(extra.root, 'site', '.dev.vars')), false)

    const swapped = LEGACY.replace(`VITE_SUPABASE_ANON_KEY=${ANON}`, `VITE_SUPABASE_ANON_KEY=${SERVICE}`)
    const wrong = await envWorld(t, { envText: swapped, siteText: swapped })
    const refused = await wrong.run(['--only', 'env', '--yes-env'])
    assert.equal(refused.code, 1, refused.out)
    assert.match(refused.out, /is not an anon key of this project\. site\/\.env\.local was not rewritten/)
    assert.equal(fs.readFileSync(wrong.siteFile, 'utf8'), swapped)
    assert.equal(refused.out.includes(SERVICE), false)

    const elsewhere = LEGACY.replace(`https://${REF}.supabase.co`, 'https://zzzzzzzzzzzzzzzzzzzz.supabase.co')
    const other = await envWorld(t, { envText: elsewhere, siteText: elsewhere })
    const stopped = await other.run(['--only', 'env', '--yes-env'])
    assert.equal(stopped.code, 1, stopped.out)
    assert.match(stopped.out, /the Supabase URL in the env file is not this project/)
    assert.equal(fs.readFileSync(other.siteFile, 'utf8'), elsewhere)
  })

  test('env: a root file the CLI refuses is taken back at once, and nothing else is touched', async (t) => {
    const w = await envWorld(t)
    w.patch((s) => { s.refuseRootEnv = true })
    const siteBefore = fs.readFileSync(w.siteFile, 'utf8')
    const r = await w.run(['--only', 'env', '--yes-env'])
    assert.equal(r.code, 1, r.out)
    assert.match(r.out, /the Supabase CLI refuses the new \.env\.local at the repo root/)
    assert.match(r.out, /The copy was removed again, so nothing changed/)
    assert.equal(fs.existsSync(path.join(w.root, '.env.local')), false)
    assert.equal(fs.readFileSync(w.siteFile, 'utf8'), siteBefore)
    assert.equal(fs.existsSync(path.join(w.root, 'site', '.dev.vars')), false)
    assert.equal(fs.existsSync(`${w.siteFile}.before-setup`), false)
    assert.equal(w.envText(), LEGACY)
  })

  test('env: without a usable intake secret in the Vault the run ends 2 and says why', async (t) => {
    const w = await envWorld(t)
    w.patch((s) => { delete s.vault.lead_intake_secret })
    const r = await w.run(['--only', 'env', '--yes-env'])
    assert.equal(r.code, 2, r.out)
    assert.match(r.out, /waiting {4}site\/\.dev\.vars LEAD_INTAKE_SECRET/)
    assert.match(r.out, /NOT FINISHED:[\s\S]*the local contact form cannot record leads/)
    const dev = parseEnv(fs.readFileSync(path.join(w.root, 'site', '.dev.vars'), 'utf8'))
    assert.deepEqual(Object.keys(dev).sort(), ['FORM_TOKEN_SECRET', 'LEAD_IP_SALT'])
    // once the row exists, the next run adds the missing key and ends clean
    w.patch((s) => { s.vault.lead_intake_secret = 'lead-intake-secret-value' })
    const again = await w.run(['--only', 'env', '--yes-env'])
    assert.equal(again.code, 0, again.out)
    assert.equal(parseEnv(fs.readFileSync(path.join(w.root, 'site', '.dev.vars'), 'utf8')).LEAD_INTAKE_SECRET, 'lead-intake-secret-value')
  })

  test('env: a second backup is made only when the site file changed again, and an existing .dev.vars keeps its values', async (t) => {
    const w = await envWorld(t)
    fs.writeFileSync(path.join(w.root, 'site', '.dev.vars'), 'LEAD_IP_SALT=kept-salt-value\n# a note\n')
    assert.equal((await w.run(['--only', 'env', '--yes-env'])).code, 0)
    const dev = parseEnv(fs.readFileSync(path.join(w.root, 'site', '.dev.vars'), 'utf8'))
    assert.equal(dev.LEAD_IP_SALT, 'kept-salt-value')
    assert.equal(dev.LEAD_INTAKE_SECRET, 'lead-intake-secret-value')
    assert.equal(fs.readFileSync(path.join(w.root, 'site', '.dev.vars'), 'utf8').startsWith('LEAD_IP_SALT=kept-salt-value\n# a note\n'), true)
    // the owner puts a secret back into the site file by mistake: it is in the root file, so the file is cleaned again
    fs.appendFileSync(w.siteFile, 'N8N_API_KEY=n8n-api-key-value\n')
    const dirty = fs.readFileSync(w.siteFile)
    const again = await w.run(['--only', 'env', '--yes-env'])
    assert.equal(again.code, 0, again.out)
    assert.equal(fs.readFileSync(`${w.siteFile}.before-setup-2`).equals(dirty), true)
    assert.equal('N8N_API_KEY' in w.site(), false)
  })
})
