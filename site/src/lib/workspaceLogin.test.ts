import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOGIN_HOP_KEY, claimLoginHop, workspaceLoginUrl } from './workspaceLogin';

// APP_URL is read from the env once at import, so each case re-imports.
async function load(env: Record<string, string>) {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.resetModules();
  return import('./workspaceLogin');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const STATE = '3f2b8c1e-9a4d-4c6b-8e2f-1a2b3c4d5e6f';
const NOW = 1_700_000_000_000;

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe('workspaceLoginUrl', () => {
  it("points at DeskDev's /login (same-origin /workspace without NEXT_PUBLIC_APP_URL)", () => {
    expect(workspaceLoginUrl()).toBe('/workspace/login');
  });

  it('carries a deep link as ?next=', () => {
    expect(workspaceLoginUrl('/growth/leads?lead=1')).toBe('/workspace/login?next=%2Fgrowth%2Fleads%3Flead%3D1');
  });

  it.each(['//evil.com', '/\t/evil.com', 'https://evil.com'])('drops an unsafe next %j', (next) => {
    expect(workspaceLoginUrl(next)).toBe('/workspace/login');
  });
});

describe('APP_URL', () => {
  it("stays on the visitor's host when DeskDev shares the site's host", async () => {
    // The workers.dev build also answers on the custom domain: a login there
    // must not be sent to the workers.dev address the build was made for.
    const sameHost = await load({
      NEXT_PUBLIC_SITE_URL: 'https://nixgen-site.nixgensolutions.workers.dev',
      NEXT_PUBLIC_APP_URL: 'https://nixgen-site.nixgensolutions.workers.dev/workspace',
    });
    expect(sameHost.APP_URL).toBe('/workspace');
    expect(sameHost.workspaceLoginUrl()).toBe('/workspace/login');

    const domainOnly = await load({ NEXT_PUBLIC_SITE_URL: 'https://nixgensolutions.com', NEXT_PUBLIC_APP_URL: '' });
    expect(domainOnly.APP_URL).toBe('/workspace');
  });

  it("is DeskDev's own origin once it is split onto its subdomain", async () => {
    const split = await load({
      NEXT_PUBLIC_SITE_URL: 'https://nixgensolutions.com',
      NEXT_PUBLIC_APP_URL: 'https://workspace.nixgensolutions.com/',
    });
    expect(split.APP_URL).toBe('https://workspace.nixgensolutions.com');
    expect(split.workspaceLoginUrl('/tasks')).toBe('https://workspace.nixgensolutions.com/login?next=%2Ftasks');
  });
});

describe('claimLoginHop', () => {
  it('hops a stateless visit once, and records it', () => {
    const storage = memoryStorage();
    expect(claimLoginHop({ state: null, error: null }, storage, NOW)).toBe(true);
    expect(storage.data.get(LOGIN_HOP_KEY)).toBe(String(NOW));
  });

  it('shows the form when DeskDev sends the visitor back without state (no loop)', () => {
    const storage = memoryStorage();
    claimLoginHop({ state: null, error: null }, storage, NOW);
    expect(claimLoginHop({ state: null, error: null }, storage, NOW + 2_000)).toBe(false);
  });

  it('hops again once the window has passed', () => {
    const storage = memoryStorage({ [LOGIN_HOP_KEY]: String(NOW) });
    expect(claimLoginHop({ state: null, error: null }, storage, NOW + 61_000)).toBe(true);
  });

  it('never hops when DeskDev sent state, and forgets the hop', () => {
    const storage = memoryStorage({ [LOGIN_HOP_KEY]: String(NOW) });
    expect(claimLoginHop({ state: STATE, error: null }, storage, NOW + 1_000)).toBe(false);
    expect(storage.data.has(LOGIN_HOP_KEY)).toBe(false);
  });

  it('never hops when DeskDev sent an error back', () => {
    expect(claimLoginHop({ state: null, error: 'session' }, memoryStorage(), NOW)).toBe(false);
  });

  it('never hops without storage, or when storage throws', () => {
    expect(claimLoginHop({ state: null, error: null }, null, NOW)).toBe(false);
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {},
      removeItem: () => {},
    };
    expect(claimLoginHop({ state: null, error: null }, throwing, NOW)).toBe(false);
  });
});
