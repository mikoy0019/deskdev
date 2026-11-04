import { afterEach, describe, expect, it, vi } from 'vitest';

// robots.ts reads the site URL through hosts.ts, which reads the env once at
// import, so each case re-imports.
async function load(siteUrl: string) {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', siteUrl);
  vi.resetModules();
  return (await import('./robots')).default();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('robots.txt', () => {
  it('lets crawlers into the marketing site on the production domain', async () => {
    const robots = await load('https://nixgensolutions.com');
    expect(robots.rules).toEqual({ userAgent: '*', allow: '/', disallow: ['/workspace', '/api', '/f/'] });
    expect(robots.sitemap).toBe('https://nixgensolutions.com/sitemap.xml');
  });

  it('turns every crawler away anywhere else', async () => {
    for (const siteUrl of ['https://nixgen-site.nixgensolutions.workers.dev', 'http://localhost:6969', '']) {
      const robots = await load(siteUrl);
      expect(robots.rules, siteUrl || '(unset)').toEqual({ userAgent: '*', disallow: '/' });
      // No sitemap line: nothing on a temporary host is offered for indexing.
      expect(robots.sitemap, siteUrl || '(unset)').toBeUndefined();
    }
  });
});
