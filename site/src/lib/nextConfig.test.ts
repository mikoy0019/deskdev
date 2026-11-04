import { PHASE_PRODUCTION_BUILD } from 'next/constants';
import { afterEach, describe, expect, it, vi } from 'vitest';

// next.config.ts reads the hosts once at import (through hosts.ts), so each
// case sets the env and re-imports, the way a build with those values would.
async function load(env: Record<string, string>) {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.resetModules();
  return (await import('../../next.config')).default(PHASE_PRODUCTION_BUILD);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

type HeaderRule = { source: string; headers: Array<{ key: string; value: string }> };

async function headersFor(env: Record<string, string>, source = '/(.*)') {
  const config = await load(env);
  const rules = (await config.headers!()) as HeaderRule[];
  const rule = rules.find((r) => r.source === source);
  return new Map((rule?.headers ?? []).map((h) => [h.key, h.value]));
}

describe('next.config.ts headers', () => {
  it('tells search engines to stay out on every host but the production domain', async () => {
    for (const siteUrl of ['https://nixgen-site.nixgensolutions.workers.dev', 'http://localhost:6969', '']) {
      const headers = await headersFor({ NEXT_PUBLIC_SITE_URL: siteUrl });
      expect(headers.get('X-Robots-Tag'), siteUrl || '(unset)').toBe('noindex, nofollow');
    }
  });

  it('sends no X-Robots-Tag on the production domain', async () => {
    const headers = await headersFor({ NEXT_PUBLIC_SITE_URL: 'https://nixgensolutions.com' });
    expect(headers.has('X-Robots-Tag')).toBe(false);
  });

  it('keeps the security headers either way', async () => {
    for (const siteUrl of ['https://nixgensolutions.com', 'https://nixgen-site.nixgensolutions.workers.dev']) {
      const headers = await headersFor({ NEXT_PUBLIC_SITE_URL: siteUrl });
      expect(headers.get('X-Content-Type-Options'), siteUrl).toBe('nosniff');
      expect(headers.get('X-Frame-Options'), siteUrl).toBe('DENY');
      expect(headers.get('Content-Security-Policy'), siteUrl).toContain("frame-ancestors 'none'");
      expect(headers.get('Referrer-Policy'), siteUrl).toBe('strict-origin-when-cross-origin');
    }
  });
});

describe('next.config.ts rewrites', () => {
  type Rewrites = { beforeFiles: Array<{ source: string; destination: string; has?: Array<{ value: string }> }> };

  it('rewrites the workspace host to /workspace when DeskDev has a host of its own', async () => {
    const config = await load({
      NEXT_PUBLIC_SITE_URL: 'https://nixgensolutions.com',
      NEXT_PUBLIC_APP_URL: 'https://workspace.nixgensolutions.com',
    });
    const { beforeFiles } = (await config.rewrites!()) as Rewrites;
    expect(beforeFiles).toHaveLength(1);
    expect(beforeFiles[0].destination).toBe('/workspace/:path(.*)');
    expect(beforeFiles[0].has?.[0].value).toBe('workspace\\.nixgensolutions\\.com');
  });

  it('rewrites the root and nested paths the way the Worker compiles them', async () => {
    // OpenNext matches the source and compiles the destination with this
    // package, validation on; a destination param that takes one segment only
    // threw on '/' and '/growth/leads' and the Worker answered 500.
    const { compile, match } = await import('path-to-regexp');
    const config = await load({
      NEXT_PUBLIC_SITE_URL: 'https://nixgensolutions.com',
      NEXT_PUBLIC_APP_URL: 'https://workspace.nixgensolutions.com',
    });
    const [rule] = ((await config.rewrites!()) as Rewrites).beforeFiles;
    const fromSource = match(rule.source);
    const toDestination = compile(rule.destination);
    for (const path of ['/', '/tasks', '/growth/leads', '/projects/123/files']) {
      const matched = fromSource(path);
      expect(matched, path).toBeTruthy();
      expect(toDestination((matched as { params: object }).params), path).toBe(`/workspace${path}`);
    }
  });

  it('rewrites nothing when the app URL is on the site host: the site must stay reachable', async () => {
    const config = await load({
      NEXT_PUBLIC_SITE_URL: 'https://nixgen-site.nixgensolutions.workers.dev',
      NEXT_PUBLIC_APP_URL: 'https://nixgen-site.nixgensolutions.workers.dev/workspace',
    });
    expect(((await config.rewrites!()) as Rewrites).beforeFiles).toEqual([]);
  });

  it('rewrites nothing without an app URL', async () => {
    const config = await load({ NEXT_PUBLIC_SITE_URL: 'https://nixgen-site.nixgensolutions.workers.dev', NEXT_PUBLIC_APP_URL: '' });
    expect(((await config.rewrites!()) as Rewrites).beforeFiles).toEqual([]);
  });
});
