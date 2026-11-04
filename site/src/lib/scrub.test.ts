import { describe, expect, it } from 'vitest';
import { isVaultPath, pathOnly, redact, scrubClientError } from './scrub';

describe('redact', () => {
  it('replaces secrets and personal data with placeholders', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl';
    expect(redact(`token ${jwt}`)).toBe('token [jwt]');
    expect(redact('Authorization: Bearer abc.def-123')).toBe('Authorization: Bearer [token]');
    expect(redact('failed with password=hunter2&x=1')).toBe('failed with password=[redacted]&x=1');
    expect(redact('{"apikey": "sk_live_1"}')).toBe('{"apikey": "[redacted]"}');
    expect(redact('mail ada.lovelace+x@example.co.uk now')).toBe('mail [email] now');
    expect(redact(`key ${'a1'.repeat(20)}`)).toBe('key [hex]');
    expect(redact(`blob ${'Ab9_'.repeat(12)}`)).toBe('blob [blob]');
    expect(redact('push https://fcm.googleapis.com/fcm/send/abc:def failed')).toBe('push [push-endpoint] failed');
  });

  it('leaves ordinary text and script paths alone', () => {
    expect(redact('Cannot read properties of undefined (reading "map")')).toBe('Cannot read properties of undefined (reading "map")');
    expect(redact('at f (https://nixgensolutions.com/_next/static/chunks/app/layout.js:1:2)')).toContain('/_next/static/chunks/app/layout.js');
  });
});

describe('paths', () => {
  it('pathOnly drops query and fragment, accepts relative paths', () => {
    expect(pathOnly('https://x.com/a/b?code=1#access_token=2')).toBe('/a/b');
    expect(pathOnly('/login?next=/x')).toBe('/login');
    expect(pathOnly(42)).toBe('');
  });

  it('isVaultPath matches the vault segment only', () => {
    expect(isVaultPath('/vault')).toBe(true);
    expect(isVaultPath('/workspace/vault/item')).toBe(true);
    expect(isVaultPath('/vaulted')).toBe(false);
  });
});

describe('scrubClientError', () => {
  it('keeps known fields only, with safe fallbacks', () => {
    expect(scrubClientError({ name: 'Bad Name!', kind: 'x', app: 'y', digest: 'no spaces allowed', release: 3 })).toEqual({
      kind: 'error',
      app: 'site',
      name: 'Error',
      message: null,
      stack: null,
      digest: null,
      path: '',
      release: null,
    });
  });

  it('caps message and stack', () => {
    const report = scrubClientError({ message: 'word '.repeat(1000), stack: Array(100).fill('at x (a.js:1:1)').join('\n') });
    expect(report.message!.length).toBe(500);
    expect(report.stack!.split('\n')).toHaveLength(30);
  });
});
