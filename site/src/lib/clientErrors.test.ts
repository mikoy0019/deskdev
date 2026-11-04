import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_REPORTS,
  clientErrorDigest,
  createClientErrorReporter,
  installClientErrorListeners,
  type ClientErrorContext,
} from './clientErrors';

const SITE: ClientErrorContext = { app: 'site', kind: 'error' };
const OWN_FRAME = '    at render (https://nixgensolutions.com/assets/app-1a2b.js:10:20)';

type FetchInit = RequestInit & { headers: Record<string, string> };

let fetchMock: ReturnType<typeof vi.fn>;

/** An error with a stack the test controls (the real one names this file and changes with every edit). */
function thrown(message: string, { name = 'Error', frames = OWN_FRAME }: { name?: string; frames?: string } = {}): Error {
  const error = new Error(message);
  error.name = name;
  error.stack = frames ? `${name}: ${message}\n${frames}` : '';
  return error;
}

function posts(): Array<{ url: string; init: FetchInit; body: Record<string, unknown> }> {
  return fetchMock.mock.calls.map(([url, init]) => ({
    url: String(url),
    init: init as FetchInit,
    body: JSON.parse(String((init as FetchInit).body)),
  }));
}

function goTo(url: string): void {
  window.history.replaceState(null, '', url);
}

beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  goTo('/');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('what a report carries', () => {
  it('posts the known fields, same-origin, as JSON that outlives the page', () => {
    goTo('/pricing?utm_source=ads&email=ada@example.com#access_token=abc');
    const report = createClientErrorReporter();
    const error = thrown('Cannot read properties of undefined', { name: 'TypeError' });

    expect(report(error, { app: 'site', kind: 'boundary' })).toBeUndefined();

    const [{ url, init, body }] = posts();
    expect(url).toBe('/api/client-errors');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      credentials: 'omit',
      referrer: '',
    });
    expect(body).toEqual({
      kind: 'boundary',
      app: 'site',
      name: 'TypeError',
      message: 'Cannot read properties of undefined',
      stack: `TypeError: Cannot read properties of undefined\n${OWN_FRAME}`,
      digest: expect.stringMatching(/^[0-9a-f]{8}$/),
      path: '/pricing',
      release: null,
    });
    // The path only: nothing from the query string or the fragment, anywhere.
    expect(String(init.body)).not.toMatch(/utm_source|ada@example|access_token/);
  });

  it('runs the scrubber before the request is made', () => {
    const report = createClientErrorReporter();
    report(
      thrown('No row for ada@example.com with token=abc123', {
        frames: '    at load (https://nixgensolutions.com/assets/app.js?access_token=secret:1:2)',
      }),
      SITE,
    );
    const [{ body }] = posts();
    expect(body.message).toBe('No row for [email] with token=[redacted]');
    expect(String(body.stack)).not.toContain('secret');
    expect(String(body.stack)).toContain('/assets/app.js:1:2');
  });

  it('prefers the digest the framework gave a server error', () => {
    const report = createClientErrorReporter();
    report(thrown('An error occurred in the Server Components render.'), { app: 'site', kind: 'boundary', digest: '2874910532' });
    report(thrown('other'), { app: 'site', kind: 'boundary', digest: 'not a digest!' });
    const [first, second] = posts();
    expect(first.body.digest).toBe('2874910532');
    expect(second.body.digest).toMatch(/^[0-9a-f]{8}$/);
  });

  it('shows the same digest on the error screen as in the report', () => {
    const report = createClientErrorReporter();
    const error = thrown('boom');
    report(error, { app: 'workspace', kind: 'boundary' });
    expect(posts()[0].body.digest).toBe(clientErrorDigest(error));
  });

  it('reads name, message and stack only, whatever was thrown', () => {
    const report = createClientErrorReporter();
    report('plain string', SITE);
    report({ message: 'duplicate key', code: '23505', details: 'Key (email)=(ada@example.com) already exists.' }, SITE);
    report(undefined, { app: 'site', kind: 'unhandledrejection' });
    const bodies = posts().map((p) => p.body);
    expect(bodies[0]).toMatchObject({ name: 'Error', message: 'plain string', stack: null });
    expect(bodies[1]).toMatchObject({ name: 'Error', message: 'duplicate key', stack: null });
    expect(JSON.stringify(bodies[1])).not.toMatch(/23505|ada@example|already exists/);
    expect(bodies[2]).toMatchObject({ kind: 'unhandledrejection', message: 'A value that is not an error was thrown (undefined)' });
  });

  it('leaves the stack out rather than exceed the size the route accepts', () => {
    const report = createClientErrorReporter();
    // A control character is six bytes of JSON (\u0001), so a full stack passes 16 KB.
    report(thrown('big', { frames: '\u0001'.repeat(5000) }), SITE);
    const [{ init, body }] = posts();
    expect(body).toMatchObject({ message: 'big', stack: null });
    expect(new TextEncoder().encode(String(init.body)).length).toBeLessThan(16 * 1024);
  });
});

describe('limits', () => {
  it('reports the same error once', () => {
    const report = createClientErrorReporter();
    const error = thrown('boom');
    report(error, { app: 'site', kind: 'boundary' });
    report(error, SITE);
    report(thrown('boom'), { app: 'site', kind: 'unhandledrejection' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('knows an error by the framework digest too', () => {
    const report = createClientErrorReporter();
    report(thrown('first render'), { app: 'site', kind: 'boundary', digest: 'abc123' });
    // A second boundary shows the same server error with a fresh Error object.
    report(thrown('second render'), { app: 'site', kind: 'boundary', digest: 'abc123' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it(`stops at ${MAX_REPORTS} reports per page load`, () => {
    const report = createClientErrorReporter();
    for (let i = 0; i < MAX_REPORTS + 20; i++) report(thrown(`failure ${i}`), SITE);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_REPORTS);
    expect(posts().map((p) => p.body.message)).toEqual(['failure 0', 'failure 1', 'failure 2', 'failure 3', 'failure 4']);
  });

  it('takes a refusal as final: no retry, and nothing more this page load', async () => {
    fetchMock.mockImplementation(() => Promise.resolve({ ok: false, status: 429 }));
    const report = createClientErrorReporter();
    const error = thrown('first');
    report(error, SITE);
    await Promise.resolve();
    await Promise.resolve();
    report(error, SITE);
    report(thrown('second'), SITE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends nothing offline, and does not spend the allowance on it', () => {
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    const report = createClientErrorReporter();
    const error = thrown('lost connection');
    for (let i = 0; i < MAX_REPORTS + 1; i++) report(thrown(`offline ${i}`), SITE);
    report(error, SITE);
    expect(fetchMock).not.toHaveBeenCalled();

    online.mockReturnValue(true);
    report(error, SITE);
    expect(posts().map((p) => p.body.message)).toEqual(['lost connection']);
  });
});

describe('noise', () => {
  it.each([
    ['a ResizeObserver loop notice', 'ResizeObserver loop completed with undelivered notifications.', {}],
    ['the older ResizeObserver wording', 'ResizeObserver loop limit exceeded', {}],
    ['a cross-origin script error', 'Script error.', {}],
    ['an aborted request', thrown('The user aborted a request.', { name: 'AbortError' }), {}],
    [
      'an error from a Chrome extension',
      thrown('x is not a function', { frames: '    at inject (chrome-extension://abcdefgh/content.js:1:2)\n    at chrome-extension://abcdefgh/content.js:9:1' }),
      {},
    ],
    ['an error from a Firefox extension', thrown('x', { frames: 'inject@moz-extension://1f2e/content.js:1:2' }), {}],
    ['an error from a Safari extension', thrown('x', { frames: 'inject@webkit-masked-url://hidden/:1:2' }), {}],
    ['a stackless error an extension script raised', 'Uncaught x', { filename: 'chrome-extension://abcdefgh/content.js' }],
  ] as Array<[string, unknown, Partial<ClientErrorContext>]>)('drops %s', (_label, error, extra) => {
    const report = createClientErrorReporter();
    report(error, { ...SITE, ...extra });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps an error that passes through an extension but touches our code', () => {
    const report = createClientErrorReporter();
    report(thrown('x is not a function', { frames: `    at patched (chrome-extension://abcdefgh/content.js:1:2)\n${OWN_FRAME}` }), SITE);
    report(thrown('Script error.'), SITE);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('the Vault rule', () => {
  it('sends only the name and digest from the Vault screens', () => {
    goTo('/workspace/vault?item=9');
    const report = createClientErrorReporter();
    report(thrown('Unexpected token h, "hunter2" is not valid JSON', { name: 'SyntaxError' }), { app: 'workspace', kind: 'boundary' });
    const [{ init, body }] = posts();
    expect(body).toEqual({
      kind: 'boundary',
      app: 'workspace',
      name: 'SyntaxError',
      message: null,
      stack: null,
      digest: expect.stringMatching(/^[0-9a-f]{8}$/),
      path: '/vault',
      release: null,
    });
    expect(String(init.body)).not.toContain('hunter2');
  });

  it('makes the Vault digest from where the error was thrown, not from what it said', () => {
    goTo('/vault');
    const one = thrown('decrypt failed for hunter2');
    const other = thrown('decrypt failed for correct horse battery staple');
    expect(clientErrorDigest(one)).toBe(clientErrorDigest(other));
    expect(clientErrorDigest(one)).not.toBe(clientErrorDigest(thrown('decrypt failed', { frames: '    at open (https://x.test/assets/app.js:99:1)' })));

    // Off the Vault the message is part of the digest, as it always was.
    goTo('/projects');
    expect(clientErrorDigest(one)).not.toBe(clientErrorDigest(other));
  });

  it('holds for Vault code that fails after the user has left the screen', () => {
    goTo('/workspace/projects');
    const report = createClientErrorReporter();
    report(
      thrown('bad plaintext hunter2', { frames: '    at decryptItem (https://workspace.nixgensolutions.com/assets/Vault-9f8e.js:3:400)' }),
      { app: 'workspace', kind: 'unhandledrejection' },
    );
    expect(posts()[0].body).toMatchObject({ name: 'Error', message: null, stack: null, path: '/workspace/projects' });
  });
});

describe('never throws, never rejects', () => {
  it('swallows a fetch that throws, rejects or is missing', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      fetchMock.mockImplementation(() => {
        throw new Error('fetch blew up');
      });
      expect(() => createClientErrorReporter()(thrown('a'), SITE)).not.toThrow();

      fetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
      const report = createClientErrorReporter();
      expect(() => report(thrown('b'), SITE)).not.toThrow();
      // A failed post is not retried and does not end reporting: the next error still goes.
      report(thrown('c'), SITE);
      expect(fetchMock).toHaveBeenCalledTimes(3);

      vi.stubGlobal('fetch', undefined);
      expect(() => createClientErrorReporter()(thrown('d'), SITE)).not.toThrow();

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('survives values that fight back', () => {
    const report = createClientErrorReporter();
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('no reading');
        },
      },
    );
    const values: unknown[] = [hostile, null, undefined, 42, Symbol('s'), BigInt(10), () => {}, { name: 7, message: {}, stack: [] }];
    for (const value of values) {
      expect(() => report(value, SITE)).not.toThrow();
      expect(() => clientErrorDigest(value)).not.toThrow();
    }
    expect(clientErrorDigest(hostile)).toBe('unknown');
  });

  it('does not start a second report from inside the first', () => {
    const report = createClientErrorReporter();
    fetchMock.mockImplementation(() => {
      // A patched fetch that raises an error event while the report is being sent.
      report(thrown('from inside'), SITE);
      return Promise.resolve({ ok: true, status: 204 });
    });
    report(thrown('outer'), SITE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('window listeners', () => {
  function rejectionEvent(reason: unknown): Event {
    return Object.assign(new Event('unhandledrejection'), { reason });
  }

  // Vitest fails the run for an 'error' event nobody listens to. These tests
  // dispatch some after the reporter's own listeners are gone, on purpose.
  const bystander = () => {};
  beforeEach(() => {
    window.addEventListener('error', bystander);
  });
  afterEach(() => {
    window.removeEventListener('error', bystander);
  });

  it('reports uncaught errors and unhandled rejections, then stops when removed', () => {
    const report = vi.fn();
    const remove = installClientErrorListeners('workspace', report);
    const error = thrown('uncaught');
    const reason = thrown('rejected');

    window.dispatchEvent(new ErrorEvent('error', { error, message: 'Uncaught Error: uncaught', filename: 'https://x.test/a.js' }));
    window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.' }));
    window.dispatchEvent(rejectionEvent(reason));

    expect(report.mock.calls).toEqual([
      [error, { app: 'workspace', kind: 'error', filename: 'https://x.test/a.js' }],
      ['Script error.', { app: 'workspace', kind: 'error', filename: '' }],
      [reason, { app: 'workspace', kind: 'unhandledrejection' }],
    ]);

    remove();
    window.dispatchEvent(new ErrorEvent('error', { error }));
    window.dispatchEvent(rejectionEvent(reason));
    expect(report).toHaveBeenCalledTimes(3);
  });

  it('listens once however many callers install, until the last one lets go', () => {
    const report = vi.fn();
    const add = vi.spyOn(window, 'addEventListener');
    const first = installClientErrorListeners('site', report);
    const second = installClientErrorListeners('site', report);
    expect(add.mock.calls.map(([type]) => type)).toEqual(['error', 'unhandledrejection']);

    window.dispatchEvent(new ErrorEvent('error', { error: thrown('once') }));
    expect(report).toHaveBeenCalledTimes(1);

    first();
    first();
    window.dispatchEvent(new ErrorEvent('error', { error: thrown('still listening') }));
    expect(report).toHaveBeenCalledTimes(2);

    second();
    window.dispatchEvent(new ErrorEvent('error', { error: thrown('gone') }));
    expect(report).toHaveBeenCalledTimes(2);
  });

  it('does not let a reporter that throws raise another error event', () => {
    const remove = installClientErrorListeners('site', () => {
      throw new Error('reporter broke');
    });
    const onError = vi.fn();
    window.addEventListener('error', onError);
    expect(() => window.dispatchEvent(rejectionEvent(thrown('x')))).not.toThrow();
    expect(onError).not.toHaveBeenCalled();
    window.removeEventListener('error', onError);
    remove();
  });

  it('end to end: a window error becomes one scrubbed post', () => {
    goTo('/contact?email=ada@example.com');
    const remove = installClientErrorListeners('site', createClientErrorReporter());
    const error = thrown('handler failed', { name: 'RangeError' });
    window.dispatchEvent(new ErrorEvent('error', { error, message: 'Uncaught RangeError: handler failed' }));
    window.dispatchEvent(new ErrorEvent('error', { error, message: 'Uncaught RangeError: handler failed' }));
    remove();

    expect(posts().map((p) => p.body)).toEqual([
      expect.objectContaining({ kind: 'error', app: 'site', name: 'RangeError', message: 'handler failed', path: '/contact' }),
    ]);
  });
});
