// Signed render timestamp for the site's forms (PLAN Topic A, A1).
//
// The page (or GET /api/contact) hands the form a token "<ms>.<sig>" where
// sig = HMAC-SHA256(FORM_TOKEN_SECRET, "nixgen-form:<ms>:<bind>"), base64url,
// and bind identifies the visitor (the contact route uses an HttpOnly browser
// cookie; older tokens use ip_hash). The form posts it back with
// the brief. A brief sent less than MIN_FILL_MS after the form appeared is
// faster than a person types; a token older than MAX_AGE_MS, or one fetched
// from another browser, is a replay of a scraped one. Without the binding a
// script could fetch one token and reuse it for every brief until it expired.
// All of these are spam signals, which quarantine the lead rather than drop it.
//
// Server-only: the secret never reaches the browser. Web Crypto only, so this
// runs unchanged on Workers and in Node tests.

/** A person cannot read the form and type a brief in under 3 seconds. */
export const MIN_FILL_MS = 3_000;

/**
 * Four hours: long enough to write a careful brief, short enough that a
 * scraped token is soon useless. The form fetches a fresh token on mount, so
 * only a tab left open for an afternoon is quarantined (not lost).
 */
export const MAX_AGE_MS = 4 * 60 * 60 * 1000;

/** Clock skew tolerated between the Worker isolates that sign and check. */
const FUTURE_SKEW_MS = 60_000;

const PREFIX = 'nixgen-form:';

export type FormTokenCheck =
  | { ok: true; ageMs: number }
  | { ok: false; reason: 'missing' | 'malformed' | 'bad_signature' | 'too_fast' | 'expired' | 'future'; ageMs: number | null };

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function hmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    usage,
  ]);
}

function signed(ms: string, bind: string): Uint8Array {
  return new TextEncoder().encode(`${PREFIX}${ms}:${bind}`);
}

/** A fresh token for a form rendered at `now`, for the visitor `bind` names. */
export async function issueFormToken(secret: string, now = Date.now(), bind = ''): Promise<string> {
  const ms = String(Math.floor(now));
  const key = await hmacKey(secret, 'sign');
  const sig = await crypto.subtle.sign('HMAC', key, signed(ms, bind) as BufferSource);
  return `${ms}.${base64url(new Uint8Array(sig))}`;
}

/**
 * Checks a token posted back with a form, for the visitor `opts.bind` names
 * (the same value it was issued for). The signature is checked with
 * crypto.subtle.verify, which compares in constant time. A token issued for
 * another visitor reads as bad_signature. Never throws.
 */
export async function verifyFormToken(
  secret: string,
  token: unknown,
  opts: { now?: number; minFillMs?: number; maxAgeMs?: number; bind?: string } = {},
): Promise<FormTokenCheck> {
  const now = opts.now ?? Date.now();
  const minFillMs = opts.minFillMs ?? MIN_FILL_MS;
  const maxAgeMs = opts.maxAgeMs ?? MAX_AGE_MS;

  if (typeof token !== 'string' || token === '') return { ok: false, reason: 'missing', ageMs: null };
  const match = /^(\d{1,15})\.([A-Za-z0-9_-]{43})$/.exec(token);
  const sig = match && fromBase64url(match[2]);
  if (!match || !sig || sig.byteLength !== 32) return { ok: false, reason: 'malformed', ageMs: null };

  let valid = false;
  try {
    const key = await hmacKey(secret, 'verify');
    valid = await crypto.subtle.verify('HMAC', key, sig as BufferSource, signed(match[1], opts.bind ?? '') as BufferSource);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'bad_signature', ageMs: null };

  const ageMs = now - Number(match[1]);
  if (ageMs < -FUTURE_SKEW_MS) return { ok: false, reason: 'future', ageMs };
  if (ageMs < minFillMs) return { ok: false, reason: 'too_fast', ageMs: Math.max(0, ageMs) };
  if (ageMs > maxAgeMs) return { ok: false, reason: 'expired', ageMs };
  return { ok: true, ageMs };
}
