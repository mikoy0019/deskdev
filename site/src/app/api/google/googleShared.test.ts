// @vitest-environment node
// (jsdom's `crypto` has no `subtle`; the sealed-token code needs WebCrypto.)
//
// The google Edge Function's pure modules (supabase/functions/_shared/google_*.ts):
// keyring, sealed tokens v1/v2, signed state, sealed blobs, PKCE, purposes,
// consent URL, returnTo allow-list and the browser-flow cookie.
import { describe, expect, it } from 'vitest';
import {
  b64url,
  fromB64url,
  GoogleCrypto,
  KeyConfigError,
  keySecretsPresent,
  LEGACY_KID,
  parseKeyring,
  pkceChallenge,
  pkceVerifier,
  TokenUnreadable,
  type GetEnv,
} from '../../../../../supabase/functions/_shared/google_crypto';
import {
  allowedReturn,
  consentUrl,
  ERROR_REASONS,
  FLOW_COOKIE,
  flowCookie,
  flowMismatch,
  grantedScopes,
  isBrowserFlow,
  isOAuthState,
  isPendingGrant,
  mayRevokeAtGoogle,
  missingScopes,
  parseOrigins,
  parsePurpose,
  PUBLIC_ERRORS,
  PURPOSES,
  readCookie,
  SCOPE,
  sameGoogleAccount,
  withParams,
  type OAuthState,
} from '../../../../../supabase/functions/_shared/google_policy';

const keyB64 = (fill: number) => Buffer.alloc(32, fill).toString('base64');
const K_LEGACY = keyB64(1);
const K_NEW = keyB64(2);

const envOf =
  (vars: Record<string, string | undefined>): GetEnv =>
  (name) =>
    vars[name];

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

/** The ORIGINAL v1 sealing from the google function before key ids (027 era), reimplemented. */
async function originalSealV1(token: string, userId: string, keyBase64: string): Promise<string> {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', fromB64url(keyBase64), 'HKDF', false, ['deriveKey']);
  const aes = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('deskdev/google/refresh-token/v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(userId) }, aes, enc.encode(token));
  return `v1.${b64url(iv)}.${b64url(new Uint8Array(ct))}`;
}

/** The ORIGINAL v1 opening, so tokens written as v1 stay readable by an older deployment. */
async function originalOpenV1(sealed: string, userId: string, keyBase64: string): Promise<string> {
  const enc = new TextEncoder();
  const [v, iv, ct] = sealed.split('.');
  expect(v).toBe('v1');
  const base = await crypto.subtle.importKey('raw', fromB64url(keyBase64), 'HKDF', false, ['deriveKey']);
  const aes = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('deskdev/google/refresh-token/v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(iv), additionalData: enc.encode(userId) }, aes, fromB64url(ct));
  return new TextDecoder().decode(pt);
}

function flip(sealed: string): string {
  const parts = sealed.split('.');
  const last = parts[parts.length - 1];
  parts[parts.length - 1] = (last[0] === 'A' ? 'B' : 'A') + last.slice(1);
  return parts.join('.');
}

describe('parseKeyring', () => {
  it('keeps the original GOOGLE_TOKEN_KEY usable as k0 and current', () => {
    const ring = parseKeyring(envOf({ GOOGLE_TOKEN_KEY: K_LEGACY }));
    expect(ring.current).toBe(LEGACY_KID);
    expect([...ring.keys.keys()]).toEqual(['k0']);
    expect(ring.legacy).not.toBeNull();
  });

  it('makes the first GOOGLE_TOKEN_KEYS entry current, keeping k0 readable', () => {
    const ring = parseKeyring(envOf({ GOOGLE_TOKEN_KEY: K_LEGACY, GOOGLE_TOKEN_KEYS: `k1:${K_NEW}` }));
    expect(ring.current).toBe('k1');
    expect([...ring.keys.keys()].sort()).toEqual(['k0', 'k1']);
  });

  it('honours GOOGLE_TOKEN_KEY_ID', () => {
    const ring = parseKeyring(envOf({ GOOGLE_TOKEN_KEYS: `k1:${K_LEGACY}, k2:${K_NEW}`, GOOGLE_TOKEN_KEY_ID: 'k2' }));
    expect(ring.current).toBe('k2');
  });

  it('refuses unusable configurations with KeyConfigError', () => {
    expect(() => parseKeyring(envOf({}))).toThrow(KeyConfigError);
    expect(() => parseKeyring(envOf({ GOOGLE_TOKEN_KEY: 'not base64!!' }))).toThrow(KeyConfigError);
    expect(() => parseKeyring(envOf({ GOOGLE_TOKEN_KEY: Buffer.alloc(16).toString('base64') }))).toThrow(/32/);
    expect(() => parseKeyring(envOf({ GOOGLE_TOKEN_KEYS: `bad kid:${K_NEW}` }))).toThrow(KeyConfigError);
    expect(() => parseKeyring(envOf({ GOOGLE_TOKEN_KEYS: `k1:${K_NEW},k1:${K_LEGACY}` }))).toThrow(/twice/);
    expect(() => parseKeyring(envOf({ GOOGLE_TOKEN_KEYS: `k1:${K_NEW}`, GOOGLE_TOKEN_KEY_ID: 'k9' }))).toThrow(/k9/);
  });

  it('reports whether any key secret is present', () => {
    expect(keySecretsPresent(envOf({}))).toBe(false);
    expect(keySecretsPresent(envOf({ GOOGLE_TOKEN_KEYS: `k1:${K_NEW}` }))).toBe(true);
  });
});

describe('sealed refresh tokens', () => {
  const legacyOnly = () => GoogleCrypto.fromEnv(envOf({ GOOGLE_TOKEN_KEY: K_LEGACY }));
  const rotated = () => GoogleCrypto.fromEnv(envOf({ GOOGLE_TOKEN_KEY: K_LEGACY, GOOGLE_TOKEN_KEYS: `k1:${K_NEW}` }));
  const me = { kind: 'user', userId: USER } as const;

  it('round-trips v2 with the key id in the token', async () => {
    const c = legacyOnly();
    const sealed = await c.sealToken('1//refresh', me);
    expect(sealed).toMatch(/^v2\.k0\.[\w-]+\.[\w-]+$/);
    expect(await c.openToken(sealed, me)).toEqual({ token: '1//refresh', stale: false });
  });

  it('binds the token to its owner', async () => {
    const c = legacyOnly();
    const sealed = await c.sealToken('1//refresh', me);
    await expect(c.openToken(sealed, { kind: 'user', userId: OTHER })).rejects.toBeInstanceOf(TokenUnreadable);
    await expect(c.openToken(sealed, { kind: 'workspace' })).rejects.toBeInstanceOf(TokenUnreadable);
    const ws = await c.sealToken('1//company', { kind: 'workspace' });
    expect((await c.openToken(ws, { kind: 'workspace' })).token).toBe('1//company');
    await expect(c.openToken(ws, me)).rejects.toBeInstanceOf(TokenUnreadable);
  });

  it('keeps tokens sealed with the previous key readable after rotation, flagged stale', async () => {
    const before = await legacyOnly().sealToken('1//old', me);
    const c = rotated();
    expect(await c.openToken(before, me)).toEqual({ token: '1//old', stale: true });
    const after = await c.sealToken('1//new', me);
    expect(after.startsWith('v2.k1.')).toBe(true);
    expect(await c.openToken(after, me)).toEqual({ token: '1//new', stale: false });
  });

  it('treats a token whose key was removed as a configuration problem, not an unreadable row', async () => {
    const sealed = await rotated().sealToken('1//new', me); // kid k1
    const withoutK1 = legacyOnly();
    await expect(withoutK1.openToken(sealed, me)).rejects.toBeInstanceOf(KeyConfigError);
  });

  it('reads v1 tokens written by the original function', async () => {
    const v1 = await originalSealV1('1//legacy', USER, K_LEGACY);
    expect(await legacyOnly().openToken(v1, me)).toEqual({ token: '1//legacy', stale: true });
    // Also when the owner moved that key into the keyring and unset GOOGLE_TOKEN_KEY.
    const moved = GoogleCrypto.fromEnv(envOf({ GOOGLE_TOKEN_KEYS: `k2:${K_NEW},k1:${K_LEGACY}` }));
    expect((await moved.openToken(v1, me)).token).toBe('1//legacy');
    await expect(legacyOnly().openToken(v1, { kind: 'user', userId: OTHER })).rejects.toBeInstanceOf(TokenUnreadable);
    await expect(legacyOnly().openToken(v1, { kind: 'workspace' })).rejects.toBeInstanceOf(TokenUnreadable);
  });

  it('writes v1 (the pre-040 fallback) that the original function can still read', async () => {
    const v1 = await rotated().sealTokenV1('1//fallback', USER);
    expect(v1.startsWith('v1.')).toBe(true);
    expect(await originalOpenV1(v1, USER, K_LEGACY)).toBe('1//fallback');
  });

  it('rejects tampered and unknown formats', async () => {
    const c = legacyOnly();
    const sealed = await c.sealToken('1//refresh', me);
    await expect(c.openToken(flip(sealed), me)).rejects.toBeInstanceOf(TokenUnreadable);
    await expect(c.openToken('v3.k0.a.b', me)).rejects.toBeInstanceOf(TokenUnreadable);
    await expect(c.openToken('v2.bad kid.a.b', me)).rejects.toBeInstanceOf(TokenUnreadable);
    await expect(c.openToken('', me)).rejects.toBeInstanceOf(TokenUnreadable);
  });

  it("fits migration 040's token CHECK and 027's v1 CHECK", async () => {
    // google_workspace_link.refresh_token_enc: CHECK (IS NULL OR ~ '^v[0-9]+\.')
    // google_connections.refresh_token_enc:    CHECK (LIKE 'v1.%') until widened
    const check040 = /^v[0-9]+\./;
    const c = rotated();
    expect(await c.sealToken('1//company', { kind: 'workspace' })).toMatch(check040);
    expect(await c.sealToken('1//person', me)).toMatch(check040);
    expect(await c.sealTokenV1('1//person', USER)).toMatch(/^v1\./);
  });
});

describe('signed state and sealed blobs', () => {
  const c = GoogleCrypto.fromEnv(envOf({ GOOGLE_TOKEN_KEY: K_LEGACY }));
  const state: OAuthState = { u: USER, r: 'https://workspace.nixgensolutions.com/settings', n: 'n'.repeat(22), e: 1, p: 'personal' };

  it('verifies its own state and rejects tampering or a foreign key', async () => {
    const signed = await c.signState(state);
    expect(signed.split('.')).toHaveLength(3);
    expect(await c.verifyState(signed)).toEqual(state);
    const [kid, body, sig] = signed.split('.');
    const forged = b64url(new TextEncoder().encode(JSON.stringify({ ...state, u: OTHER })));
    expect(await c.verifyState(`${kid}.${forged}.${sig}`)).toBeNull();
    expect(await c.verifyState(`k9.${body}.${sig}`)).toBeNull();
    const other = GoogleCrypto.fromEnv(envOf({ GOOGLE_TOKEN_KEY: K_NEW }));
    expect(await other.verifyState(signed)).toBeNull();
    expect(await c.verifyState(null)).toBeNull();
    expect(await c.verifyState('x'.repeat(5000))).toBeNull();
  });

  it('accepts a state signed with a previous key that is still in the keyring', async () => {
    const signed = await c.signState(state);
    const rotated = GoogleCrypto.fromEnv(envOf({ GOOGLE_TOKEN_KEY: K_LEGACY, GOOGLE_TOKEN_KEYS: `k1:${K_NEW}` }));
    expect(await rotated.verifyState(signed)).toEqual(state);
  });

  it('keeps blob kinds apart', async () => {
    const grant = await c.sealBlob('grant', { u: USER });
    const flow = await c.sealBlob('flow', { n: 'x' });
    expect(grant.startsWith('g2.k0.')).toBe(true);
    expect(flow.startsWith('f1.k0.')).toBe(true);
    expect(await c.openBlob('grant', grant)).toEqual({ u: USER });
    expect(await c.openBlob('flow', grant)).toBeNull();
    expect(await c.openBlob('grant', flow.replace(/^f1/, 'g2'))).toBeNull();
    expect(await c.openBlob('grant', flip(grant))).toBeNull();
    expect(await c.openBlob('grant', 'g1.iv.ct')).toBeNull(); // pre-v2 grants in flight are dropped
    expect(await c.openBlob('grant', 42)).toBeNull();
  });
});

describe('PKCE', () => {
  it('matches the RFC 7636 appendix B example', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('makes 43-character url-safe verifiers that differ every time', () => {
    const a = pkceVerifier();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pkceVerifier()).not.toBe(a);
  });
});

describe('purposes and scopes', () => {
  it('defaults to personal and refuses unknown purposes', () => {
    expect(parsePurpose(undefined)).toBe('personal');
    expect(parsePurpose('workspace')).toBe('workspace');
    expect(parsePurpose('gmail')).toBeNull();
  });

  it('asks only non-sensitive scopes, workspace for admins only', () => {
    expect(PURPOSES.personal.scopes).toEqual(['openid', 'email', SCOPE.driveFile]);
    expect(PURPOSES.workspace.scopes).toContain(SCOPE.calendarAppCreated);
    expect(PURPOSES.workspace.adminOnly).toBe(true);
    expect(PURPOSES.personal.adminOnly).toBe(false);
    const all = Object.values(PURPOSES).flatMap((p) => p.scopes).join(' ');
    expect(all).not.toMatch(/gmail|mail\.google|auth\/drive(\s|$|\.readonly)|auth\/calendar(\s|$|\.readonly|\.events)/);
  });

  it('reports the required scopes Google did not grant', () => {
    expect(missingScopes('personal', grantedScopes(`openid ${SCOPE.driveFile}`))).toEqual([]);
    expect(missingScopes('personal', grantedScopes('openid email'))).toEqual([SCOPE.driveFile]);
    expect(missingScopes('workspace', grantedScopes(SCOPE.driveFile))).toEqual([SCOPE.calendarAppCreated]);
    expect(grantedScopes(undefined)).toEqual([]);
  });

  it('builds a PKCE consent URL with the purpose scopes', () => {
    const u = new URL(
      consentUrl({ clientId: 'cid', redirectUri: 'https://nixgensolutions.com/api/google/callback', purpose: 'workspace', state: 's', codeChallenge: 'ch' }),
    );
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('code_challenge')).toBe('ch');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('redirect_uri')).toBe('https://nixgensolutions.com/api/google/callback');
    expect(u.searchParams.get('scope')).toBe(PURPOSES.workspace.scopes.join(' '));
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('state')).toBe('s');
  });
});

describe('returnTo allow-list', () => {
  const origins = parseOrigins(' https://workspace.nixgensolutions.com/ ,http://localhost:6969, junk, ftp://x.y');

  it('normalizes APP_ORIGINS', () => {
    expect(origins).toEqual(['https://workspace.nixgensolutions.com', 'http://localhost:6969']);
    expect(parseOrigins(undefined)).toEqual([]);
  });

  it('accepts only URLs on an allowed origin', () => {
    expect(allowedReturn('https://workspace.nixgensolutions.com/settings?section=integrations', origins)).toBe(
      'https://workspace.nixgensolutions.com/settings?section=integrations',
    );
    expect(allowedReturn('https://evil.example/settings', origins)).toBeNull();
    expect(allowedReturn('https://workspace.nixgensolutions.com.evil.example/', origins)).toBeNull();
    expect(allowedReturn('https://user:pw@workspace.nixgensolutions.com/', origins)).toBeNull();
    expect(allowedReturn('javascript:alert(1)', origins)).toBeNull();
    expect(allowedReturn(`https://workspace.nixgensolutions.com/${'a'.repeat(600)}`, origins)).toBeNull();
    expect(allowedReturn(42, origins)).toBeNull();
  });

  it('replaces stale ?google= params', () => {
    const u = new URL(withParams('https://w.test/settings?section=x&google=error&reason=denied', { google: 'pending', grant: 'g' }));
    expect(u.searchParams.get('section')).toBe('x');
    expect(u.searchParams.get('google')).toBe('pending');
    expect(u.searchParams.get('grant')).toBe('g');
    expect(u.searchParams.has('reason')).toBe(false);
  });

  it('names every reason the UI must explain, including the proxy ones', () => {
    expect(ERROR_REASONS).toEqual(expect.arrayContaining(['denied', 'scope', 'browser', 'expired', 'config', 'session', 'forbidden']));
  });
});

describe('browser-flow binding', () => {
  const state: OAuthState = { u: USER, r: 'https://w.test/', n: 'n'.repeat(22), e: 2_000, p: 'personal' };

  it('requires the cookie of the browser that started the flow', () => {
    expect(flowMismatch(state, null, 1_000)).toBe('browser');
    expect(flowMismatch(state, { n: 'm'.repeat(22), v: 'v', e: 2_000 }, 1_000)).toBe('browser');
    expect(flowMismatch(state, { n: 'short', v: 'v', e: 2_000 }, 1_000)).toBe('browser');
    expect(flowMismatch(state, { n: state.n, v: 'v', e: 2_000 }, 3_000)).toBe('expired');
    expect(flowMismatch(state, { n: state.n, v: 'v', e: 2_000 }, 1_000)).toBeNull();
  });

  it('formats and reads the HttpOnly cookie', () => {
    expect(flowCookie('abc', 600, '/api/google')).toBe('dd_google_flow=abc; Path=/api/google; Max-Age=600; HttpOnly; Secure; SameSite=Lax');
    expect(flowCookie('', -5, '/x', false)).toBe('dd_google_flow=; Path=/x; Max-Age=0; HttpOnly; SameSite=Lax');
    expect(readCookie(`a=1; ${FLOW_COOKIE}=f1.k0.x.y; b=2`, FLOW_COOKIE)).toBe('f1.k0.x.y');
    expect(readCookie(null, FLOW_COOKIE)).toBeNull();
  });

  it('validates the shapes it opens', () => {
    expect(isOAuthState(state)).toBe(true);
    expect(isOAuthState({ ...state, p: 'gmail' })).toBe(false);
    expect(isBrowserFlow({ n: 'a', v: 'b', e: 1 })).toBe(true);
    expect(isBrowserFlow({ n: 'a', e: 1 })).toBe(false);
    expect(isPendingGrant({ u: USER, p: 'workspace', m: 'a@b.c', s: ['x'], t: 't', e: 1 })).toBe(true);
    expect(isPendingGrant({ u: USER, m: 'a@b.c', s: ['x'], t: 't', e: 1 })).toBe(false);
    expect(isPendingGrant({ u: USER, p: 'personal', m: 'a@b.c', s: [1], t: 't', e: 1 })).toBe(false);
  });
});

describe('grant hygiene', () => {
  it('never revokes at Google a grant another DeskDev holder shares', () => {
    expect(sameGoogleAccount('Ops@NixGen.com ', 'ops@nixgen.com')).toBe(true);
    expect(sameGoogleAccount(null, null)).toBe(false);
    expect(mayRevokeAtGoogle('ops@nixgen.com', ['OPS@nixgen.com'])).toBe(false);
    expect(mayRevokeAtGoogle('me@gmail.com', ['ops@nixgen.com', null])).toBe(true);
    expect(mayRevokeAtGoogle('me@gmail.com', [])).toBe(true);
  });

  it('keeps public error sentences free of internals', () => {
    for (const message of Object.values(PUBLIC_ERRORS)) {
      expect(message).not.toMatch(/GOOGLE_|SUPABASE_|APP_ORIGINS|google_connections|audit_log|invalid_grant/);
    }
  });
});
