import { afterEach, describe, expect, it, vi } from 'vitest';

// hosts.ts reads the env once at import, so each case re-imports.
async function load(env: Record<string, string>) {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.resetModules();
  return import('./hosts');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('hosts', () => {
  it('has no workspace host when the app URL is unset or relative', async () => {
    for (const appUrl of ['', '/workspace']) {
      const hosts = await load({ NEXT_PUBLIC_APP_URL: appUrl });
      expect(hosts.WORKSPACE_ORIGIN).toBeNull();
      expect(hosts.WORKSPACE_HOSTNAME).toBeNull();
      expect(hosts.isWorkspaceHost('localhost:6969')).toBe(false);
      expect(hosts.isWorkspaceHost('')).toBe(false);
    }
  });

  it('reads origins and hostnames from absolute URLs', async () => {
    const hosts = await load({
      NEXT_PUBLIC_SITE_URL: 'https://NixGenSolutions.com/',
      NEXT_PUBLIC_APP_URL: 'https://workspace.nixgensolutions.com/some/path',
    });
    expect(hosts.SITE_ORIGIN).toBe('https://nixgensolutions.com');
    expect(hosts.SITE_HOSTNAME).toBe('nixgensolutions.com');
    expect(hosts.WORKSPACE_ORIGIN).toBe('https://workspace.nixgensolutions.com');
    expect(hosts.WORKSPACE_HOSTNAME).toBe('workspace.nixgensolutions.com');
  });

  it('matches the workspace host the way Next.js does — any case, any port', async () => {
    const hosts = await load({ NEXT_PUBLIC_APP_URL: 'http://workspace.localhost:6969' });
    expect(hosts.isWorkspaceHost('workspace.localhost:6969')).toBe(true);
    expect(hosts.isWorkspaceHost('Workspace.LocalHost')).toBe(true);
    expect(hosts.isWorkspaceHost('localhost:6969')).toBe(false);
    expect(hosts.isWorkspaceHost('evil-workspace.localhost')).toBe(false);
    expect(hosts.isWorkspaceHost(null)).toBe(false);
  });

  it('rewrites pages on the workspace host but leaves /api, /_next and /workspace alone', async () => {
    const { WORKSPACE_REWRITE_SOURCE } = await load({ NEXT_PUBLIC_APP_URL: 'https://workspace.nixgensolutions.com' });
    // "/:path(<regex>)": the one named segment is the whole path after the slash.
    const inner = /^\/:path\((.+)\)$/.exec(WORKSPACE_REWRITE_SOURCE)?.[1];
    expect(inner).toBeTruthy();
    const rewritten = (path: string) => new RegExp(`^/(?:${inner})$`).test(path);

    for (const page of ['/', '/tasks', '/settings', '/login', '/apiary', '/workspaces', '/_nextish']) {
      expect(rewritten(page), page).toBe(true);
    }
    // DeskDev's own-origin reports and the Google relay must reach the route handlers.
    for (const real of [
      '/api/client-errors',
      '/api/contact',
      '/api/google/start',
      '/_next/static/chunk.js',
      '/workspace',
      '/workspace/sw.js',
      '/workspace/manifest.webmanifest',
    ]) {
      expect(rewritten(real), real).toBe(false);
    }
  });

  it('never splits DeskDev onto the hostname the site is on', async () => {
    // The workers.dev deploy before the domain exists: one host for both.
    const sameHost = await load({
      NEXT_PUBLIC_SITE_URL: 'https://nixgen-site.nixgensolutions.workers.dev',
      NEXT_PUBLIC_APP_URL: 'https://nixgen-site.nixgensolutions.workers.dev/workspace',
    });
    expect(sameHost.WORKSPACE_ORIGIN).toBeNull();
    expect(sameHost.WORKSPACE_HOSTNAME).toBeNull();
    expect(sameHost.isWorkspaceHost('nixgen-site.nixgensolutions.workers.dev')).toBe(false);

    // Same hostname on another port is still one host to the rewrite.
    const otherPort = await load({
      NEXT_PUBLIC_SITE_URL: 'http://localhost:6969',
      NEXT_PUBLIC_APP_URL: 'http://localhost:7000',
    });
    expect(otherPort.WORKSPACE_ORIGIN).toBeNull();
  });

  it('treats a bare loopback app URL as no split when no site URL is set', async () => {
    for (const appUrl of ['http://localhost:6969', 'http://127.0.0.1:6969/workspace', 'http://[::1]:6969']) {
      const hosts = await load({ NEXT_PUBLIC_SITE_URL: '', NEXT_PUBLIC_APP_URL: appUrl });
      expect(hosts.WORKSPACE_ORIGIN, appUrl).toBeNull();
      expect(hosts.isWorkspaceHost('localhost:6969'), appUrl).toBe(false);
    }
    // A named local host is a real split, with or without a site URL.
    const named = await load({ NEXT_PUBLIC_SITE_URL: '', NEXT_PUBLIC_APP_URL: 'http://workspace.localhost:6969' });
    expect(named.WORKSPACE_ORIGIN).toBe('http://workspace.localhost:6969');
    // And a site URL on loopback leaves a different loopback-free app host alone.
    const both = await load({
      NEXT_PUBLIC_SITE_URL: 'http://localhost:6969',
      NEXT_PUBLIC_APP_URL: 'http://workspace.localhost:6969',
    });
    expect(both.WORKSPACE_HOSTNAME).toBe('workspace.localhost');
  });

  it('is indexable on the production domain only', async () => {
    const cases: Array<[string, boolean]> = [
      ['https://nixgensolutions.com', true],
      ['https://NixGenSolutions.com/', true],
      ['https://nixgen-site.nixgensolutions.workers.dev', false],
      ['https://www.nixgensolutions.com', false],
      ['https://workspace.nixgensolutions.com', false],
      ['https://nixgensolutions.com.example.org', false],
      ['http://localhost:6969', false],
      ['', false],
      ['/relative', false],
    ];
    for (const [siteUrl, expected] of cases) {
      const hosts = await load({ NEXT_PUBLIC_SITE_URL: siteUrl });
      expect(hosts.INDEXABLE, siteUrl || '(unset)').toBe(expected);
    }
  });
});
