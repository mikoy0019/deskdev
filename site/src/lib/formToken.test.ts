// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { issueFormToken, MAX_AGE_MS, MIN_FILL_MS, verifyFormToken } from './formToken';

const SECRET = 'form-secret';
const T0 = 1_780_000_000_000;

describe('formToken', () => {
  it('issues "<ms>.<43-char base64url sig>"', async () => {
    const token = await issueFormToken(SECRET, T0);
    expect(token).toMatch(/^1780000000000\.[A-Za-z0-9_-]{43}$/);
    expect(await issueFormToken(SECRET, T0)).toBe(token); // deterministic
  });

  it('accepts a token posted after the minimum fill time', async () => {
    const token = await issueFormToken(SECRET, T0);
    expect(await verifyFormToken(SECRET, token, { now: T0 + MIN_FILL_MS })).toEqual({ ok: true, ageMs: MIN_FILL_MS });
    expect(await verifyFormToken(SECRET, token, { now: T0 + 60_000 })).toEqual({ ok: true, ageMs: 60_000 });
  });

  it('flags a brief sent faster than a person can type', async () => {
    const token = await issueFormToken(SECRET, T0);
    expect(await verifyFormToken(SECRET, token, { now: T0 + 1_200 })).toEqual({ ok: false, reason: 'too_fast', ageMs: 1_200 });
    // Small clock skew between isolates counts as too fast, not forged.
    expect(await verifyFormToken(SECRET, token, { now: T0 - 30_000 })).toMatchObject({ ok: false, reason: 'too_fast', ageMs: 0 });
  });

  it('flags a token from the future beyond skew, and an expired one', async () => {
    const token = await issueFormToken(SECRET, T0);
    expect(await verifyFormToken(SECRET, token, { now: T0 - 120_000 })).toMatchObject({ ok: false, reason: 'future' });
    expect(await verifyFormToken(SECRET, token, { now: T0 + MAX_AGE_MS + 1 })).toMatchObject({ ok: false, reason: 'expired' });
  });

  it('expires after four hours', () => {
    expect(MAX_AGE_MS).toBe(4 * 60 * 60 * 1000);
  });

  it('binds a token to the visitor it was issued for', async () => {
    const token = await issueFormToken(SECRET, T0, 'hash-a');
    expect(token).not.toBe(await issueFormToken(SECRET, T0));
    expect(await verifyFormToken(SECRET, token, { now: T0 + 10_000, bind: 'hash-a' })).toEqual({ ok: true, ageMs: 10_000 });
    expect(await verifyFormToken(SECRET, token, { now: T0 + 10_000, bind: 'hash-b' })).toMatchObject({ ok: false, reason: 'bad_signature' });
    expect(await verifyFormToken(SECRET, token, { now: T0 + 10_000 })).toMatchObject({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a forged timestamp, a wrong secret and malformed input', async () => {
    const token = await issueFormToken(SECRET, T0);
    const [, sig] = token.split('.');
    expect(await verifyFormToken(SECRET, `${T0 - 60_000}.${sig}`, { now: T0 + 10_000 })).toMatchObject({ reason: 'bad_signature' });
    expect(await verifyFormToken('other', token, { now: T0 + 10_000 })).toMatchObject({ reason: 'bad_signature' });
    for (const bad of ['abc', `${T0}.`, `${T0}.short`, `${T0}.${sig}x`, `-1.${sig}`, `${T0}.${'!'.repeat(43)}`]) {
      expect(await verifyFormToken(SECRET, bad, { now: T0 + 10_000 })).toMatchObject({ ok: false, reason: 'malformed' });
    }
    for (const missing of [undefined, null, '', 42]) {
      expect(await verifyFormToken(SECRET, missing)).toEqual({ ok: false, reason: 'missing', ageMs: null });
    }
  });
});
