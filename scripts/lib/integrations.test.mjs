import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_PARTS,
  WORKERS_DEV_ORIGIN,
  answersItself,
  answersNotDeployed,
  appOrigins,
  appOriginsDecision,
  calendarAcceptsSecret,
  calendarAnswersConfigured,
  calendarAnswersUnconfigured,
  changedSecrets,
  functionState,
  keyringKids,
  oauthClientAction,
  proveEnvEdit,
  pushAcceptsSecret,
  pushAnswersConfigured,
  pushAnswersUnconfigured,
  vaultUrlAction,
  compareVersions,
  describeApiKey,
  generateVapidPair,
  isAnonKeyFor,
  isRedirectBase,
  isSafeEnvValue,
  isTokenKeyring,
  isVapidSubject,
  newTokenKeyring,
  parseArgs,
  sha256Hex,
  vapidPairMatches,
} from './integrations.mjs'

test('parseArgs: a bare run sets up push and google, never the env files', () => {
  const a = parseArgs([])
  assert.deepEqual(a.parts, DEFAULT_PARTS)
  assert.equal(a.parts.includes('env'), false)
  assert.equal(a.dryRun, false)
})

test('parseArgs: --only accepts both spellings and only known parts', () => {
  assert.deepEqual(parseArgs(['--only', 'push']).parts, ['push'])
  assert.deepEqual(parseArgs(['--only=google']).parts, ['google'])
  assert.throws(() => parseArgs(['--only', 'vapid']), /--only takes one of/)
  assert.throws(() => parseArgs(['--only']), /--only takes one of/)
  assert.throws(() => parseArgs(['--only', 'push', '--only', 'google']), /once/)
})

test('parseArgs: a typo stops the run instead of going live', () => {
  assert.throws(() => parseArgs(['--dryrun']), /unknown argument/)
  assert.throws(() => parseArgs(['--dry']), /unknown argument/)
  assert.throws(() => parseArgs(['push']), /unknown argument/)
})

test('parseArgs: the env part needs the owner flag, except in a dry run', () => {
  assert.throws(() => parseArgs(['--only', 'env']), /--yes-env/)
  assert.deepEqual(parseArgs(['--only', 'env', '--yes-env']).parts, ['env'])
  assert.deepEqual(parseArgs(['--only', 'env', '--dry-run']).parts, ['env'])
})

test('parseArgs: flags map to their fields', () => {
  const a = parseArgs(['--dry-run', '--rotate-vapid', '--resume-push', '--resume-calendar', '--dev-origin', '--force', '--redirect-base', 'https://nixgensolutions.com/api/google'])
  assert.equal(a.dryRun && a.rotateVapid && a.resumePush && a.resumeCalendar && a.devOrigin && a.force, true)
  assert.equal(parseArgs(['--prod-origins']).prodOrigins, true)
  assert.throws(() => parseArgs(['--dev-origin', '--prod-origins']), /cannot be combined/)
  assert.equal(a.redirectBase, 'https://nixgensolutions.com/api/google')
  assert.throws(() => parseArgs(['--redirect-base', 'http://evil.example/api/google']), /--redirect-base/)
})

test('isRedirectBase: https anywhere, http only on localhost, no trailing slash', () => {
  assert.equal(isRedirectBase('https://nixgensolutions.com/api/google'), true)
  assert.equal(isRedirectBase('http://localhost:6969/api/google'), true)
  assert.equal(isRedirectBase('https://nixgensolutions.com/api/google/'), false)
  assert.equal(isRedirectBase('http://nixgensolutions.com/api/google'), false)
  assert.equal(isRedirectBase('not a url'), false)
})

test('isSafeEnvValue: only values that read back unchanged as a bare line', () => {
  for (const ok of ['abc123', 'k1:AbC+/=', 'mailto:team@example.com', 'https://a.example,https://b.example', 'a-b_c.d']) assert.equal(isSafeEnvValue(ok), true, ok)
  for (const bad of ['', 'has space', 'has#hash', "quote'd", 'two\nlines', 'semi;colon', '$var']) assert.equal(isSafeEnvValue(bad), false, JSON.stringify(bad))
  assert.equal(isSafeEnvValue(undefined), false)
})

test('compareVersions orders by major, minor, patch', () => {
  assert.ok(compareVersions('2.119.0', '2.110.0') > 0)
  assert.ok(compareVersions('2.9.0', '2.10.0') < 0)
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0)
})

test('generateVapidPair: Web Push format, and the pair check tells pairs apart', () => {
  const a = generateVapidPair()
  const b = generateVapidPair()
  assert.equal(Buffer.from(a.publicKey, 'base64url').length, 65)
  assert.equal(Buffer.from(a.publicKey, 'base64url')[0], 4)
  assert.equal(Buffer.from(a.privateKey, 'base64url').length, 32)
  assert.equal(a.publicKey.length, 87)
  assert.equal(vapidPairMatches(a.publicKey, a.privateKey), true)
  assert.equal(vapidPairMatches(a.publicKey, b.privateKey), false)
  assert.equal(vapidPairMatches('nonsense', a.privateKey), false)
  assert.equal(isSafeEnvValue(a.publicKey) && isSafeEnvValue(a.privateKey), true)
})

test('isVapidSubject: a real mailto or https URL, never localhost', () => {
  assert.equal(isVapidSubject('mailto:team@example.com'), true)
  assert.equal(isVapidSubject('https://nixgensolutions.com'), true)
  assert.equal(isVapidSubject('mailto:dev@localhost'), false)
  assert.equal(isVapidSubject('team@example.com'), false)
})

test('token keyring: the generated one passes, short or malformed ones do not', () => {
  const ring = newTokenKeyring()
  assert.match(ring, /^k1:/)
  assert.equal(isTokenKeyring(ring), true)
  assert.equal(isSafeEnvValue(ring), true)
  assert.equal(isTokenKeyring(`${ring},k2:${Buffer.alloc(32, 7).toString('base64')}`), true)
  assert.equal(isTokenKeyring(`k1:${Buffer.alloc(16).toString('base64')}`), false)
  assert.equal(isTokenKeyring('k1'), false)
  assert.equal(isTokenKeyring(''), false)
})

test('appOrigins: production always, the dev origin only on request', () => {
  assert.equal(appOrigins().includes('localhost'), false)
  assert.equal(appOrigins().split(',').length, 3)
  assert.equal(appOrigins({ dev: true }).endsWith('http://localhost:6969'), true)
  assert.equal(isSafeEnvValue(appOrigins({ dev: true })), true)
})

test('describeApiKey / isAnonKeyFor: only an anon key of this project may be inlined', () => {
  const jwt = (payload) => ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'c2ln'].join('.')
  const anon = jwt({ role: 'anon', ref: 'abcdefghijklmnopqrst' })
  const service = jwt({ role: 'service_role', ref: 'abcdefghijklmnopqrst' })
  assert.deepEqual(describeApiKey(anon), { kind: 'jwt', role: 'anon', ref: 'abcdefghijklmnopqrst' })
  assert.equal(isAnonKeyFor(anon, 'abcdefghijklmnopqrst'), true)
  assert.equal(isAnonKeyFor(anon, 'zzzzzzzzzzzzzzzzzzzz'), false)
  assert.equal(isAnonKeyFor(service, 'abcdefghijklmnopqrst'), false)
  assert.equal(isAnonKeyFor('sb_publishable_abc', 'abcdefghijklmnopqrst'), true)
  assert.equal(isAnonKeyFor('random-string', 'abcdefghijklmnopqrst'), false)
})

test('sha256Hex matches the digest format the Supabase CLI lists', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

test('token keyring: ids come back in order; duplicates and impossible base64 are refused', () => {
  const key = (byte) => Buffer.alloc(32, byte).toString('base64')
  assert.deepEqual(keyringKids('k1:' + key(1) + ',k2:' + key(2)), ['k1', 'k2'])
  assert.deepEqual(keyringKids('k1:' + key(1) + ',k1:' + key(2)), [])
  assert.equal(isTokenKeyring('k1:' + key(1) + ',k1:' + key(2)), false)
  // 4n+1 characters can never be base64, although Buffer would decode it leniently
  assert.equal(isTokenKeyring('k1:' + 'A'.repeat(45)), false)
  assert.equal(isTokenKeyring('bad id:' + key(1)), false)
})

test('changedSecrets: only what differs from the listed digest is sent', () => {
  const digests = new Map([['SAME', sha256Hex('value-a')], ['OLD', sha256Hex('before')]])
  assert.deepEqual(changedSecrets(digests, { SAME: 'value-a', OLD: 'after', NEW: 'x' }), [['OLD', 'after'], ['NEW', 'x']])
  assert.deepEqual(changedSecrets(digests, { SAME: 'value-a' }), [])
})

test('vaultUrlAction: the switch row is kept, fixed, set, or left off until asked', () => {
  assert.equal(vaultUrlAction({ hadUrl: true, currentMatches: true, restWasInPlace: true, resume: false }), 'keep')
  assert.equal(vaultUrlAction({ hadUrl: true, currentMatches: false, restWasInPlace: true, resume: false }), 'fix')
  // a first run: nothing was there, so the row is written at the end
  assert.equal(vaultUrlAction({ hadUrl: false, currentMatches: false, restWasInPlace: false, resume: false }), 'set')
  // everything but the row exists: paused, or an unfinished run. Never guessed.
  assert.equal(vaultUrlAction({ hadUrl: false, currentMatches: false, restWasInPlace: true, resume: false }), 'off')
  assert.equal(vaultUrlAction({ hadUrl: false, currentMatches: false, restWasInPlace: true, resume: true }), 'set')
})

test('probe predicates: the function own answers, never a gateway 401 or a 404', () => {
  assert.equal(pushAnswersConfigured({ status: 401, json: { error: 'Missing Authorization header' } }), true)
  assert.equal(pushAnswersConfigured({ status: 401, json: { message: 'Invalid JWT' } }), false)
  assert.equal(pushAnswersConfigured({ status: 500, json: { error: 'Push is not configured.' } }), false)
  assert.equal(pushAnswersConfigured({ status: 401, json: null }), false)
  assert.equal(calendarAnswersConfigured({ status: 401, json: { error: 'unauthorized' } }), true)
  assert.equal(calendarAnswersConfigured({ status: 401, json: { message: 'Missing authorization header' } }), false)
  assert.equal(calendarAnswersConfigured({ status: 503, json: { error: 'not configured' } }), false)
  assert.equal(answersNotDeployed({ status: 404, json: null }), true)
  assert.equal(answersNotDeployed({ status: 401, json: null }), false)
  assert.equal(pushAnswersUnconfigured({ status: 500, json: { error: 'Push is not configured.' } }), true)
  assert.equal(pushAnswersUnconfigured({ status: 500, json: { error: 'Unexpected error' } }), false)
  assert.equal(calendarAnswersUnconfigured({ status: 503, json: { error: 'not configured' } }), true)
})

test('accepts-secret probes: only the answer that comes after the secret check', () => {
  assert.equal(pushAcceptsSecret({ status: 400, json: { error: "Expected {type:'notification'|'message', record:{id}}" } }), true)
  // a wrong secret falls through to the user path
  assert.equal(pushAcceptsSecret({ status: 401, json: { error: 'Invalid token' } }), false)
  assert.equal(pushAcceptsSecret({ status: 400, json: { error: 'Body must be JSON' } }), false)
  assert.equal(calendarAcceptsSecret({ status: 400, json: { error: 'unknown action' } }), true)
  assert.equal(calendarAcceptsSecret({ status: 401, json: { error: 'unauthorized' } }), false)
  assert.equal(calendarAcceptsSecret({ status: 500, json: { error: 'drain failed' } }), false)
})

test('functionState: tells a missing function and a JWT gateway from the function itself', () => {
  const push = { configured: pushAnswersConfigured, unconfigured: pushAnswersUnconfigured }
  assert.equal(functionState({ status: 401, json: { error: 'Missing Authorization header' } }, push), 'configured')
  assert.equal(functionState({ status: 500, json: { error: 'Push is not configured.' } }, push), 'unconfigured')
  assert.equal(functionState({ status: 404, json: { code: 'NOT_FOUND', message: 'Requested function was not found' } }, push), 'not-deployed')
  assert.equal(functionState({ status: 401, json: { code: 401, message: 'Missing authorization header' } }, push), 'jwt-gateway')
  assert.equal(functionState({ status: 401, json: null }, push), 'jwt-gateway')
  assert.equal(functionState({ status: 0, json: null }, push), 'unreachable')
  assert.equal(functionState(null, push), 'unreachable')
  assert.equal(functionState({ status: 502, json: null }, push), 'unknown')
  // the function's own 401 with another sentence is not the gateway
  assert.equal(functionState({ status: 401, json: { error: 'Sign in again to continue.' } }, push), 'unknown')
  assert.equal(answersItself({ status: 401, json: { error: 'Sign in again to continue.' } }), true)
  assert.equal(answersItself({ status: 401, json: { message: 'Invalid JWT' } }), false)
})

test('appOriginsDecision: set once, dev origin on request, never over a hand-edited list', () => {
  const prod = sha256Hex(appOrigins())
  const dev = sha256Hex(appOrigins({ dev: true }))
  const off = { allowsDev: false, allowsWorkersDev: false }
  assert.deepEqual(appOriginsDecision({ currentDigest: undefined, devOrigin: false, prodOrigins: false }), { value: appOrigins(), refused: false, ...off })
  assert.deepEqual(appOriginsDecision({ currentDigest: prod, devOrigin: false, prodOrigins: false }), { value: null, refused: false, ...off })
  assert.deepEqual(appOriginsDecision({ currentDigest: prod, devOrigin: true, prodOrigins: false }), { value: appOrigins({ dev: true }), refused: false, allowsDev: true, allowsWorkersDev: false })
  assert.deepEqual(appOriginsDecision({ currentDigest: sha256Hex('https://something.else'), devOrigin: true, prodOrigins: false }), { value: null, refused: true, ...off })
  assert.deepEqual(appOriginsDecision({ currentDigest: dev, devOrigin: false, prodOrigins: true }), { value: appOrigins(), refused: false, ...off })
  // a later run without a flag still knows the dev origin is in the list
  assert.deepEqual(appOriginsDecision({ currentDigest: dev, devOrigin: false, prodOrigins: false }), { value: null, refused: false, allowsDev: true, allowsWorkersDev: false })
  // asking for what is already there sends nothing
  assert.deepEqual(appOriginsDecision({ currentDigest: dev, devOrigin: true, prodOrigins: false }), { value: null, refused: false, allowsDev: true, allowsWorkersDev: false })
  assert.deepEqual(appOriginsDecision({ currentDigest: prod, prodOrigins: true }), { value: null, refused: false, ...off })
})

test('appOriginsDecision: the workers.dev address is a second extra, kept alongside the dev origin', () => {
  const prod = sha256Hex(appOrigins())
  const temp = sha256Hex(appOrigins({ workersDev: true }))
  const dev = sha256Hex(appOrigins({ dev: true }))
  const both = sha256Hex(appOrigins({ dev: true, workersDev: true }))
  assert.equal(appOrigins({ workersDev: true }), `${appOrigins()},${WORKERS_DEV_ORIGIN}`)
  assert.equal(appOrigins({ dev: true, workersDev: true }).split(',').length, 5)
  assert.equal(isSafeEnvValue(appOrigins({ dev: true, workersDev: true })), true)
  // added on request, to whatever known list is there
  assert.deepEqual(appOriginsDecision({ currentDigest: prod, workersDevOrigin: true }), { value: appOrigins({ workersDev: true }), refused: false, allowsDev: false, allowsWorkersDev: true })
  assert.deepEqual(appOriginsDecision({ currentDigest: dev, workersDevOrigin: true }), { value: appOrigins({ dev: true, workersDev: true }), refused: false, allowsDev: true, allowsWorkersDev: true })
  assert.deepEqual(appOriginsDecision({ currentDigest: undefined, workersDevOrigin: true }), { value: appOrigins({ workersDev: true }), refused: false, allowsDev: false, allowsWorkersDev: true })
  // a later --dev-origin keeps it, and a run without flags reports both
  assert.deepEqual(appOriginsDecision({ currentDigest: temp, devOrigin: true }), { value: appOrigins({ dev: true, workersDev: true }), refused: false, allowsDev: true, allowsWorkersDev: true })
  assert.deepEqual(appOriginsDecision({ currentDigest: both }), { value: null, refused: false, allowsDev: true, allowsWorkersDev: true })
  // never over a list someone edited, and --prod-origins takes both out
  assert.deepEqual(appOriginsDecision({ currentDigest: sha256Hex('https://something.else'), workersDevOrigin: true }), { value: null, refused: true, allowsDev: false, allowsWorkersDev: false })
  assert.deepEqual(appOriginsDecision({ currentDigest: both, prodOrigins: true }), { value: appOrigins(), refused: false, allowsDev: false, allowsWorkersDev: false })
  assert.throws(() => parseArgs(['--workers-dev-origin', '--prod-origins']), /cannot be combined/)
  assert.throws(() => parseArgs(['--only', 'push', '--workers-dev-origin']), /belongs to the google part/)
  assert.equal(parseArgs(['--only', 'google', '--workers-dev-origin']).workersDevOrigin, true)
})

test('oauthClientAction: an older env file never silently replaces the client on the function', () => {
  const id = '123-abc.apps.googleusercontent.com'
  const base = { clientId: id, clientSecret: 'GOCSPX-new', replace: false }
  assert.equal(oauthClientAction({ ...base, clientSecret: '', idDigest: undefined, secretDigest: undefined }), 'none')
  assert.equal(oauthClientAction({ ...base, idDigest: undefined, secretDigest: undefined }), 'send')
  assert.equal(oauthClientAction({ ...base, idDigest: sha256Hex(id), secretDigest: sha256Hex('GOCSPX-new') }), 'same')
  // the function has the id only: the missing half is added
  assert.equal(oauthClientAction({ ...base, idDigest: sha256Hex(id), secretDigest: undefined }), 'send')
  // a secret rotated on the function, an older one in the file
  assert.equal(oauthClientAction({ ...base, idDigest: sha256Hex(id), secretDigest: sha256Hex('GOCSPX-rotated') }), 'differs')
  assert.equal(oauthClientAction({ ...base, replace: true, idDigest: sha256Hex(id), secretDigest: sha256Hex('GOCSPX-rotated') }), 'send')
  assert.equal(oauthClientAction({ ...base, idDigest: sha256Hex('999-zzz.apps.googleusercontent.com'), secretDigest: undefined }), 'differs')
})

test('parseArgs: a flag for a part that is not selected stops the run', () => {
  assert.throws(() => parseArgs(['--yes-env']), /--yes-env belongs to the env part/)
  assert.throws(() => parseArgs(['--only', 'push', '--dev-origin']), /--dev-origin belongs to the google part/)
  assert.throws(() => parseArgs(['--only', 'push', '--redirect-base', 'https://nixgensolutions.com/api/google']), /--redirect-base belongs to the google part/)
  assert.throws(() => parseArgs(['--only', 'google', '--resume-push']), /--resume-push belongs to the push part/)
  assert.throws(() => parseArgs(['--only', 'google', '--force']), /--force belongs to the push or env part/)
  assert.throws(() => parseArgs(['--redirect-base', 'https://a.example/x', '--redirect-base', 'https://b.example/x']), /once/)
  assert.throws(() => parseArgs(['--redirect-base', 'https://nixgensolutions.com/api/google?x=1']), /--redirect-base takes/)
  assert.equal(parseArgs(['--only', 'google', '--replace-client']).replaceClient, true)
  assert.equal(parseArgs(['--only', 'push', '--force', '--dry-run']).force, true)
})

test('proveEnvEdit: an append to a plain secrets file is proven, and only adds lines', () => {
  const before = '# secrets\nSUPABASE_SERVICE_ROLE_KEY=abc.def-ghi\nGOOGLE_OAUTH_CLIENT_ID=\n\n# n8n\nN8N_API_KEY=xyz\n'
  const proof = proveEnvEdit(Buffer.from(before), { VAPID_PUBLIC_KEY: 'pub_-1', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:team@example.com' })
  assert.equal(proof.ok, true)
  assert.equal(proof.after, `${before}VAPID_PUBLIC_KEY=pub_-1\nVAPID_PRIVATE_KEY=priv\nVAPID_SUBJECT=mailto:team@example.com\n`)
  assert.deepEqual(Object.keys(proof.was).sort(), ['GOOGLE_OAUTH_CLIENT_ID', 'N8N_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY'])
  // an empty placeholder is filled where it stands
  const filled = proveEnvEdit(Buffer.from(before), { GOOGLE_OAUTH_CLIENT_ID: '1-a.apps.googleusercontent.com' })
  assert.equal(filled.ok && filled.after.includes('\nGOOGLE_OAUTH_CLIENT_ID=1-a.apps.googleusercontent.com\n\n# n8n'), true)
  // CRLF files keep their line endings
  const crlf = proveEnvEdit(Buffer.from('A=1\r\nB=2\r\n'), { C: 'three' })
  assert.equal(crlf.ok && crlf.after, 'A=1\r\nB=2\r\nC=three\r\n')
})

test('proveEnvEdit: refuses whatever would damage the file, before it is written', () => {
  // a Latin-1 byte in a comment would come back as U+FFFD
  const latin1 = Buffer.concat([Buffer.from('# caf'), Buffer.from([0xe9]), Buffer.from('\nA=1\n')])
  assert.match(proveEnvEdit(latin1, { B: '2' }).reason, /not valid UTF-8/)
  // a KEY= line inside another key's quoted multi-line value
  const nested = 'NOTE="first line\nTOKEN=inside the note\nlast line"\nA=1\n'
  const hit = proveEnvEdit(Buffer.from(nested), { TOKEN: 'real' })
  assert.equal(hit.ok, false)
  assert.match(hit.reason, /other key\(s\) changed by the edit \(NOTE\)/)
  // a value outside the alphabet this script writes
  assert.match(proveEnvEdit(Buffer.from('A=1\n'), { B: 'has space' }).reason, /characters this script does not write \(B\)/)
  assert.match(proveEnvEdit(Buffer.from('A=1\n'), { B: 'two\nlines' }).reason, /characters this script does not write/)
})

test('proveEnvEdit: duplicates and export prefixes are rewritten together, other keys untouched', () => {
  const proof = proveEnvEdit(Buffer.from('export K=a\nX=1\nK=b\n'), { K: 'c' })
  assert.equal(proof.ok && proof.after, 'export K=c\nX=1\nK=c\n')
  // a key that is a prefix of its neighbours touches neither
  const ring = proveEnvEdit(Buffer.from('GOOGLE_TOKEN_KEYS=k1:AAAA\nGOOGLE_TOKEN_KEY_ID=k1\n'), { GOOGLE_TOKEN_KEY: 'legacy' })
  assert.equal(ring.ok && ring.after, 'GOOGLE_TOKEN_KEYS=k1:AAAA\nGOOGLE_TOKEN_KEY_ID=k1\nGOOGLE_TOKEN_KEY=legacy\n')
})

test('isVapidSubject follows the function: a real host, never a bare word or localhost', () => {
  assert.equal(isVapidSubject('https://nixgensolutions.com/contact'), true)
  assert.equal(isVapidSubject('https://host.tld:99999'), false)
  assert.equal(isVapidSubject('https://localhost'), false)
  assert.equal(isVapidSubject('https://intranet'), false)
  assert.equal(isVapidSubject('http://nixgensolutions.com'), false)
  assert.equal(isVapidSubject(undefined), false)
})
