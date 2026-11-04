import { describe, expect, it, vi } from 'vitest';
import { handoffUrl, safeNext, safeState } from './deskdev';

const STATE = '3f2b8c1e-9a4d-4c6b-8e2f-1a2b3c4d5e6f';
const fragment = (url: string) => new URLSearchParams(url.slice(url.indexOf('#') + 1));

describe('safeNext (site copy)', () => {
  it.each(['//evil.com', '/\\evil.com', '/\t/evil.com', '/\n/evil.com', '/\r/evil.com', 'https://evil.com'])(
    'falls back to / for %j',
    (value) => {
      expect(safeNext(value)).toBe('/');
    },
  );

  it('keeps same-app paths', () => {
    expect(safeNext('/tasks?x=1')).toBe('/tasks?x=1');
  });
});

describe('handoffUrl', () => {
  it('echoes DeskDev state into the fragment', () => {
    const url = handoffUrl('AT', 'RT', '/tasks', STATE);
    expect(url).toMatch(/\/auth\/callback#/);
    const f = fragment(url);
    expect(f.get('dd_at')).toBe('AT');
    expect(f.get('dd_rt')).toBe('RT');
    expect(f.get('next')).toBe('/tasks');
    expect(f.get('dd_state')).toBe(STATE);
  });

  it('leaves state out when there is none, or it is malformed', () => {
    expect(fragment(handoffUrl('AT', 'RT', '/')).has('dd_state')).toBe(false);
    expect(fragment(handoffUrl('AT', 'RT', '/', 'x&dd_at=evil')).has('dd_state')).toBe(false);
    expect(fragment(handoffUrl('AT', 'RT', '/', 'x&dd_at=evil')).get('dd_at')).toBe('AT');
  });

  it('never forwards an unsafe next', () => {
    expect(fragment(handoffUrl('AT', 'RT', '/\t/evil.com', STATE)).get('next')).toBe('/');
  });

  it('hands the session to DeskDev on the host the login happened on', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://nixgen-site.nixgensolutions.workers.dev');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://nixgen-site.nixgensolutions.workers.dev/workspace');
    vi.resetModules();
    try {
      const { handoffUrl: sameHostHandoff } = await import('./deskdev');
      expect(sameHostHandoff('AT', 'RT', '/tasks', STATE)).toMatch(/^\/workspace\/auth\/callback#/);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

describe('safeState', () => {
  it('accepts only the shape DeskDev mints', () => {
    expect(safeState(STATE)).toBe(STATE);
    expect(safeState('short')).toBeNull();
    expect(safeState('<script>alert(1)</script>xxxxxx')).toBeNull();
    expect(safeState(null)).toBeNull();
  });
});
