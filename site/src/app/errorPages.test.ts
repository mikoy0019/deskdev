import { Component, act, createElement, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The site's two error pages, (site)/error.tsx and global-error.tsx, each
// report the error they are shown. A render error that a boundary catches
// raises no window 'error' event, so that one call is the only report of a
// crashed page: take it out and crash reporting ends without any other test
// failing. These cases crash a page under a boundary, the way the framework
// does, and look at what leaves the browser.

// The reporter is the real one (src/lib/clientErrors.ts); only fetch is
// replaced. The chrome around the message is stubbed: it is not what is
// tested, and the real header and footer need the framework's router.
vi.mock('@/components/layout/Navbar', () => ({ Navbar: () => null }));
vi.mock('@/components/layout/Footer', () => ({ Footer: () => null }));
vi.mock('@/components/site/PageHero', () => ({ HeroBackdrop: () => null }));
vi.mock('@/components/site/Typography', () => ({
  Accent: ({ children }: { children?: ReactNode }) => createElement('span', null, children),
  Eyebrow: ({ children }: { children?: ReactNode }) => createElement('p', null, children),
}));
vi.mock('@/components/site/Button', () => ({
  Button: ({ children, href, onClick }: { children?: ReactNode; href?: string; onClick?: () => void }) =>
    href ? createElement('a', { href }, children) : createElement('button', { type: 'button', onClick }, children),
}));

// Each case loads its page afresh (the reporter keeps per-page-load state, so
// the modules are reset), and that import is inside the test. On a busy
// machine or a small CI runner it alone can pass the default five seconds.
vi.setConfig({ testTimeout: 30_000 });

type PageError = Error & { digest?: string };
type ErrorPage = ComponentType<{ error: PageError; reset: () => void }>;
type Post = { url: string; init: RequestInit; body: Record<string, unknown> };

/** Stands in for the framework's boundary: it hands the page the error it caught and a reset. */
class Caught extends Component<{ page: ErrorPage; children?: ReactNode }, { error: PageError | null }> {
  state: { error: PageError | null } = { error: null };

  static getDerivedStateFromError(error: PageError) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return createElement(this.props.page, { error, reset: () => this.setState({ error: null }) });
  }
}

function Broken({ error }: { error: PageError }): ReactNode {
  throw error;
}

function thrown(message: string, digest?: string): PageError {
  const error: PageError = new TypeError(message);
  if (digest) error.digest = digest;
  return error;
}

let fetchMock: ReturnType<typeof vi.fn>;
let root: Root | null = null;
let windowErrors: number;

const countWindowError = () => {
  windowErrors += 1;
};

function posts(): Post[] {
  return fetchMock.mock.calls.map(([url, init]) => ({
    url: String(url),
    init: init as RequestInit,
    body: JSON.parse(String((init as RequestInit).body)),
  }));
}

/** Renders a page that throws under the boundary, into `container`. */
async function crash(page: ErrorPage, error: PageError, container: Element | Document): Promise<void> {
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(Caught, { page }, createElement(Broken, { error })));
  });
}

beforeEach(() => {
  // The reporter counts and remembers per page load: each case gets its own.
  vi.resetModules();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  // React and both pages print the error they were given.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  windowErrors = 0;
  window.addEventListener('error', countWindowError);
  window.addEventListener('unhandledrejection', countWindowError);
});

afterEach(async () => {
  window.removeEventListener('error', countWindowError);
  window.removeEventListener('unhandledrejection', countWindowError);
  if (root) await act(async () => root!.unmount());
  root = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('(site)/error.tsx', () => {
  let container: HTMLElement;

  beforeEach(() => {
    window.history.replaceState(null, '', '/services?utm_source=ad&email=someone@example.com#pricing');
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('reports a page crash: one post, from the site, as a boundary error, under the digest the page shows', async () => {
    const { default: SiteError } = await import('./(site)/error');

    await crash(SiteError, thrown('An error occurred in the Server Components render.', '2874910532'), container);

    // The designed page is on screen, and nothing reached the window listeners.
    expect(container.textContent).toContain('Something went wrong');
    expect(container.textContent).toContain('Reference: 2874910532');
    expect(windowErrors).toBe(0);

    const sent = posts();
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('/api/client-errors');
    expect(sent[0].init.method).toBe('POST');
    expect(sent[0].body).toMatchObject({
      app: 'site',
      kind: 'boundary',
      name: 'TypeError',
      // The framework's digest, which is all that ties a server error to the Worker's log line.
      digest: '2874910532',
      path: '/services',
    });
    // Path only: the query string and the fragment stay in the browser.
    const raw = String(sent[0].init.body);
    expect(raw).not.toContain('utm_source');
    expect(raw).not.toContain('someone@example.com');
    expect(raw).not.toContain('pricing');
  });

  it('reports an error thrown in the browser too, which has no framework digest', async () => {
    const { default: SiteError } = await import('./(site)/error');

    await crash(SiteError, thrown('Cannot read properties of undefined'), container);

    expect(container.textContent).not.toContain('Reference:');
    const sent = posts();
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toMatchObject({ app: 'site', kind: 'boundary', message: 'Cannot read properties of undefined' });
    // The reporter's own digest stands in, so the line can still be found.
    expect(sent[0].body.digest).toMatch(/^[0-9a-f]{8}$/);
  });

  it('"Try again" asks the framework to render the page again', async () => {
    const { default: SiteError } = await import('./(site)/error');
    const reset = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root!.render(createElement(SiteError, { error: thrown('once', 'abc123'), reset }));
    });

    await act(async () => {
      container.querySelector('button')!.click();
    });

    expect(reset).toHaveBeenCalledTimes(1);
    // Still the one report the page sent when it appeared.
    expect(posts()).toHaveLength(1);
  });
});

describe('global-error.tsx', () => {
  // The page is the whole document (it renders <html>), so it is mounted on
  // `document`, as the framework mounts it when a root layout fails.

  it('reports a crashed root layout on the site as coming from the site', async () => {
    window.history.replaceState(null, '', '/pricing?ref=newsletter');
    const { default: GlobalError } = await import('./global-error');

    await crash(GlobalError, thrown('The root layout failed', 'f00dfeed'), document);

    expect(document.body.textContent).toContain('Something went wrong');
    expect(document.body.textContent).toContain('Reference: f00dfeed');
    expect(windowErrors).toBe(0);

    const sent = posts();
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('/api/client-errors');
    expect(sent[0].body).toMatchObject({
      app: 'site',
      kind: 'boundary',
      name: 'TypeError',
      digest: 'f00dfeed',
      path: '/pricing',
    });
    expect(String(sent[0].init.body)).not.toContain('newsletter');
  });

  it("reports a crash under /workspace as DeskDev's: this page stands in for both root layouts", async () => {
    window.history.replaceState(null, '', '/workspace/tasks');
    const { default: GlobalError } = await import('./global-error');

    await crash(GlobalError, thrown('The workspace layout failed'), document);

    const sent = posts();
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toMatchObject({ app: 'workspace', kind: 'boundary', path: '/workspace/tasks' });
  });

  it('a path that only starts with the letters "workspace" is still the site', async () => {
    window.history.replaceState(null, '', '/workspaces');
    const { default: GlobalError } = await import('./global-error');

    await crash(GlobalError, thrown('Not the workspace'), document);

    expect(posts()[0].body).toMatchObject({ app: 'site', kind: 'boundary' });
  });
});
