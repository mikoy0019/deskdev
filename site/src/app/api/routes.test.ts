// @vitest-environment node
import { readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { hasRequestLog } from '../../lib/guard';
import { config as proxyConfig, proxy } from '../../proxy';

// A new route cannot forget the request id: every HTTP method a route.ts
// under src/app/api exports must be made by withRequestLog (src/lib/guard.ts),
// which is what puts X-Request-Id on the response and request_id on the log
// lines. The files are found on disk, so a route added later is checked
// without touching this test.
//
// The answers no handler writes (405 for a method the route does not export,
// the automatic OPTIONS, 404 for an unknown path, the 500 after a handler
// threw) get the header from src/proxy.ts, which is checked here for the same
// routes. That the framework adds the proxy's headers to those answers is its
// own behaviour: tests/e2e/site-routes.spec.ts asks a running build.

// The Worker's bindings (src/lib/platform.ts) exist only in a Worker; this test has none.
vi.mock('../../lib/platform', () => ({ bindings: () => ({}) }));

const HERE = dirname(fileURLToPath(import.meta.url));
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
const RAY = '8f1e2d3c4b5a6978-AMS';

const routeFiles = readdirSync(HERE, { recursive: true, encoding: 'utf8' })
  .filter((file) => /(^|[\\/])route\.tsx?$/.test(file))
  .map((file) => join(HERE, file))
  .sort();

const routes = routeFiles.map((file) => [relative(HERE, file).replace(/\\/g, '/'), file] as const);

/** The URL path a route file answers, a dynamic segment filled in: google/[leg]/route.ts → /api/google/x. */
function urlPath(file: string): string {
  const dir = relative(HERE, dirname(file)).replace(/\\/g, '/');
  return `/api/${dir.replace(/\[[^\]]+\]/g, 'x')}`;
}

describe('every /api route handler carries the request id', () => {
  it('finds the routes', () => {
    const names = routeFiles.map((file) => relative(HERE, dirname(file)).replace(/\\/g, '/'));
    expect(names).toEqual(expect.arrayContaining(['client-errors', 'contact', 'google/[leg]', 'health', 'subscribe']));
  });

  it.each(routes)('%s', async (_name, file) => {
    const route = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>;
    const exported = METHODS.filter((method) => route[method] !== undefined);
    expect(exported.length).toBeGreaterThan(0);
    for (const method of exported) {
      expect(hasRequestLog(route[method]), `${method} is not wrapped in withRequestLog`).toBe(true);
    }
  });
});

describe('the answers no handler writes carry the request id', () => {
  const stamped = (path: string, method: string) =>
    proxy(new NextRequest(`https://nixgensolutions.com${path}`, { method, headers: { 'cf-ray': RAY } }));

  it('the proxy runs in front of every /api path', () => {
    expect(proxyConfig.matcher).toContain('/api/:path*');
  });

  it.each(routes)('%s: a method it does not export, and OPTIONS', async (_name, file) => {
    const route = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>;
    const notExported = METHODS.filter((method) => route[method] === undefined);
    // OPTIONS is in the list unless a route writes its own, and then it is wrapped (above).
    expect(notExported.length).toBeGreaterThan(0);
    for (const method of notExported) {
      const response = stamped(urlPath(file), method);
      expect(response.headers.get('x-request-id'), `${method} ${urlPath(file)}`).toBe(RAY);
      // Passed on to the framework, which then answers 405 or 204 itself.
      expect(response.headers.get('x-middleware-next'), `${method} ${urlPath(file)}`).toBe('1');
    }
  });

  it('a path no route answers (404)', () => {
    for (const path of ['/api', '/api/does-not-exist', '/api/contact/deeper']) {
      expect(stamped(path, 'GET').headers.get('x-request-id'), path).toBe(RAY);
    }
  });
});
