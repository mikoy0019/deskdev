// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestId } from './lib/guard';

// The proxy runs in front of two kinds of path. Under /api it puts the request
// id on the response and, when it made the id itself, hands it to the route
// handler. Under /workspace it is the redirect to DeskDev's own host, which
// the /api branch must not have changed.

const RAY = '8f1e2d3c4b5a6978-AMS';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// hosts.ts reads the env once at import, so each case re-imports the proxy.
async function load(env: Record<string, string> = {}) {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.resetModules();
  return import('./proxy');
}

const SPLIT = {
  NEXT_PUBLIC_SITE_URL: 'https://nixgensolutions.com',
  NEXT_PUBLIC_APP_URL: 'https://workspace.nixgensolutions.com',
};

function request(path: string, headers: Record<string, string> = {}, method = 'GET'): NextRequest {
  return new NextRequest(`https://nixgensolutions.com${path}`, {
    method,
    headers: { host: 'nixgensolutions.com', ...headers },
  });
}

/**
 * The request headers the route handler will see. NextResponse.next({ request })
 * lists them in x-middleware-override-headers and carries each value as
 * x-middleware-request-<name>; without that list the request is passed on as
 * it came.
 */
function forwarded(sent: Request, response: Response): Headers {
  const names = response.headers.get('x-middleware-override-headers');
  if (!names) return new Headers(sent.headers);
  const headers = new Headers();
  for (const name of names.split(',').filter(Boolean)) {
    const value = response.headers.get(`x-middleware-request-${name}`);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('proxy: the request id under /api', () => {
  it('runs for every /api path', async () => {
    const { config } = await load();
    expect(config.matcher).toContain('/api/:path*');
  });

  it("on Cloudflare stamps the Ray ID and leaves the request as it came", async () => {
    const { proxy } = await load();
    const sent = request('/api/health', { 'cf-ray': RAY }, 'PATCH');
    const response = proxy(sent);

    // Continue to the route: not a redirect, not a rewrite.
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-request-id')).toBe(RAY);
    // The handler reads the same Ray ID from the request; nothing is rebuilt.
    expect(response.headers.get('x-middleware-override-headers')).toBeNull();
    expect(requestId(new Request(sent.url, { headers: forwarded(sent, response) }))).toBe(RAY);
  });

  it('off Cloudflare makes an id and hands the same one to the handler', async () => {
    const { proxy } = await load();
    const sent = request('/api/contact', { 'content-type': 'application/json', cookie: 'a=1' }, 'POST');
    const response = proxy(sent);

    const id = response.headers.get('x-request-id');
    expect(id).toMatch(UUID);
    expect(response.headers.get('x-middleware-next')).toBe('1');

    const seen = forwarded(sent, response);
    expect(seen.get('x-request-id')).toBe(id);
    // What withRequestLog will log under and stamp on its own response.
    expect(requestId(new Request(sent.url, { headers: seen }))).toBe(id);
    // The rest of the request reaches the handler unchanged.
    expect(seen.get('content-type')).toBe('application/json');
    expect(seen.get('cookie')).toBe('a=1');
    expect(seen.get('host')).toBe('nixgensolutions.com');
  });

  it("does not take over an id the caller sent", async () => {
    const { proxy } = await load();
    const SENT = '0b6f6f4e-9d2c-4c35-8f0e-2a1d6a3b7c11';
    const sent = request('/api/subscribe', { 'x-request-id': SENT });
    const response = proxy(sent);

    const id = response.headers.get('x-request-id');
    expect(id).toMatch(UUID);
    expect(id).not.toBe(SENT);
    expect(forwarded(sent, response).get('x-request-id')).toBe(id);
  });

  it('gives each request its own id', async () => {
    const { proxy } = await load();
    const a = proxy(request('/api/health')).headers.get('x-request-id');
    const b = proxy(request('/api/health')).headers.get('x-request-id');
    expect(a).not.toBe(b);
  });

  it('stamps /api on both hostnames, split or not', async () => {
    const { proxy } = await load(SPLIT);
    for (const host of ['nixgensolutions.com', 'workspace.nixgensolutions.com']) {
      const response = proxy(request('/api/client-errors', { host, 'cf-ray': RAY }, 'POST'));
      expect(response.headers.get('x-request-id'), host).toBe(RAY);
      expect(response.headers.get('location'), host).toBeNull();
    }
  });
});

describe('proxy: /workspace on the site host', () => {
  it('redirects to DeskDev on its own host, query included, and adds no request id', async () => {
    const { proxy } = await load(SPLIT);
    const response = proxy(request('/workspace/login?direct=1'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://workspace.nixgensolutions.com/login?direct=1');
    expect(response.headers.get('x-request-id')).toBeNull();

    expect(proxy(request('/workspace')).headers.get('location')).toBe('https://workspace.nixgensolutions.com/');
  });

  it('passes through on the workspace host and when the hosts are not split', async () => {
    const split = await load(SPLIT);
    const onWorkspace = split.proxy(request('/workspace/tasks', { host: 'workspace.nixgensolutions.com' }));
    expect(onWorkspace.headers.get('location')).toBeNull();
    expect(onWorkspace.headers.get('x-middleware-next')).toBe('1');

    const single = await load({ NEXT_PUBLIC_SITE_URL: '', NEXT_PUBLIC_APP_URL: '' });
    const response = single.proxy(request('/workspace/tasks'));
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('x-request-id')).toBeNull();
  });

  it('a path that only starts with the letters "api" is not an /api path', async () => {
    const { proxy } = await load(SPLIT);
    // The matcher never sends such a path here; this is the function's own check.
    expect(proxy(request('/apiary')).headers.get('x-request-id')).toBeNull();
  });
});
