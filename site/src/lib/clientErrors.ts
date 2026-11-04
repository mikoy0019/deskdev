// The browser half of /api/client-errors (PLAN Topic D5): one reporter for the
// marketing site and DeskDev. Four sources call it: DeskDev's AppErrorBoundary,
// the site's error pages (error.tsx, global-error.tsx) and the window 'error'
// and 'unhandledrejection' listeners each app installs.
//
// What it promises, because the thing it runs inside is already failing:
// - It never throws, never rejects and never reports itself.
// - It is quiet. At most MAX_REPORTS posts per page load, one per error, known
//   noise dropped, nothing sent while offline, and a refusal from the server
//   (429 from the limiter, 403, 5xx) ends reporting until the next page load.
//   No retries: DeskDev is an installed app that also runs offline.
// - Nothing personal leaves the browser. The report is built by the same
//   scrubber the server runs (scrub.ts), from the error and the path alone: no
//   user id, no query string or fragment, no cookies, no Referer header.
// - The Vault rule holds before the request is made, not only on arrival: for
//   an error from the Vault only its name and digest are sent, and that digest
//   is computed without the message.

import { isVaultPath, pathOnly, scrubClientError, type ClientErrorReport } from './scrub';

const ENDPOINT = '/api/client-errors';

/** A page that throws on every frame must not become a request per frame. */
export const MAX_REPORTS = 5;

/** The route refuses bodies over 16 KB; past this the stack is left out. */
const MAX_BODY_BYTES = 15_000;

export type ClientErrorContext = {
  app: ClientErrorReport['app'];
  kind: ClientErrorReport['kind'];
  /** The digest the framework gave an error thrown on the server, when there is one. */
  digest?: string | null;
  /** The script a window 'error' event names: all there is when the error has no stack. */
  filename?: string | null;
};

type Thrown = { name: string; message: string; stack: string };

/** `throw` and `reject` take any value: read the three fields an error has, and nothing else. */
function describeThrown(value: unknown): Thrown {
  if (typeof value === 'string') return { name: 'Error', message: value, stack: '' };
  if (value && typeof value === 'object') {
    const error = value as { name?: unknown; message?: unknown; stack?: unknown };
    return {
      name: typeof error.name === 'string' && error.name ? error.name : 'Error',
      // Only `message`. Serialising an unknown object could carry a whole record out.
      message: typeof error.message === 'string' ? error.message : 'A value that is not an error was thrown (object)',
      stack: typeof error.stack === 'string' ? error.stack : '',
    };
  }
  return { name: 'Error', message: `A value that is not an error was thrown (${value === null ? 'null' : typeof value})`, stack: '' };
}

const URL_IN_STACK = /[a-z][a-z0-9+.-]*:\/\/[^\s)]+/gi;
// Safari names an extension's script webkit-masked-url://hidden/.
const EXTENSION_URL = /^(?:(?:chrome|moz|safari|safari-web|ms-browser)-extension|webkit-masked-url):/i;

/** Errors nobody can act on: they are not ours, or they are not errors. */
function isNoise(thrown: Thrown, filename: string): boolean {
  // A cancelled fetch or navigation is the code working as written.
  if (thrown.name === 'AbortError') return true;
  // A browser notice that a resize callback ran late; nothing is broken.
  if (/ResizeObserver loop/i.test(thrown.message)) return true;
  // All a page is told about an error in a cross-origin script.
  if (!thrown.stack && /^Script error\.?$/i.test(thrown.message.trim())) return true;
  const scripts: string[] = thrown.stack.match(URL_IN_STACK) ?? [];
  if (filename) scripts.push(filename);
  return scripts.length > 0 && scripts.every((url) => EXTENSION_URL.test(url));
}

/**
 * True when the error belongs to the Vault: the screen is open, or the error
 * names Vault code. The second half covers a promise that settles after the
 * user has moved on, where the path alone would let the message through.
 */
function fromVault(thrown: Thrown, path: string): boolean {
  return isVaultPath(path) || /vault/i.test(`${thrown.name}\n${thrown.stack}`);
}

/** file:line:column of each frame, the message taken out first (V8 repeats it at the top of the stack). */
function frameLocations(thrown: Thrown): string {
  const frames = thrown.message ? thrown.stack.split(thrown.message).join('') : thrown.stack;
  return (frames.replace(/\?[^\s:)]*/g, '').match(/[\w.$-]+:\d+:\d+/g) ?? []).join(' ');
}

function djb2(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * A 32-bit hash is short enough to test guesses against, so the Vault's digest
 * is made from where the error was thrown, never from what it said.
 */
function digestOf(thrown: Thrown, vault: boolean): string {
  return djb2(vault ? `${thrown.name}:${frameLocations(thrown)}` : `${thrown.name}:${thrown.message}:${thrown.stack}`);
}

function currentPath(): string {
  return pathOnly(window.location.pathname);
}

/**
 * The short id of an error, the same one its report carries: an error screen
 * shows it so a person can quote it and the log line can be found. Never throws.
 */
export function clientErrorDigest(error: unknown): string {
  try {
    const thrown = describeThrown(error);
    return digestOf(thrown, fromVault(thrown, currentPath()));
  } catch {
    return 'unknown';
  }
}

function frameworkDigest(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null;
}

/** next.config.ts stamps its build id into every bundle; it tells one deploy's errors from the next. */
function release(): string | null {
  try {
    return process.env.APP_BUILD_ID || null;
  } catch {
    // No `process` in this bundle: the report goes without a release.
    return null;
  }
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export type ClientErrorReporter = (error: unknown, context: ClientErrorContext) => void;

/**
 * A reporter with its own count and memory. The app uses the shared one below
 * (reportClientError); tests make their own so one case cannot use up another's
 * allowance.
 */
export function createClientErrorReporter(): ClientErrorReporter {
  const seen = new Set<string>();
  let sent = 0;
  let closed = false;
  let busy = false;

  function send(body: string): void {
    sent += 1;
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      // The page may be on its way out (a crash, a reload): let the post outlive it.
      keepalive: true,
      credentials: 'omit',
      cache: 'no-store',
      // No Referer: it would carry the query string the report leaves out.
      referrer: '',
    }).then(
      (response) => {
        // The answer to the next report would be the same one.
        if (!response.ok) closed = true;
      },
      () => {
        // Offline, blocked or cut off. There is no one to tell.
      },
    );
  }

  return function report(error, context) {
    // `busy` stops a report that is being built from starting another one,
    // should reading the error or calling fetch raise an error event itself.
    // Once the allowance is spent nothing is even looked at, so a page that
    // throws without end costs no work and `seen` stays a handful of entries.
    if (busy || closed || sent >= MAX_REPORTS || typeof window === 'undefined') return;
    busy = true;
    try {
      const thrown = describeThrown(error);
      if (isNoise(thrown, typeof context.filename === 'string' ? context.filename : '')) return;
      // Before the count: an error met offline can still be reported once the network is back.
      if (navigator.onLine === false) return;

      const path = currentPath();
      const vault = fromVault(thrown, path);
      const computed = digestOf(thrown, vault);
      const given = frameworkDigest(context.digest);
      // A boundary and a window listener can both see one error, and only the
      // boundary knows the framework's digest: remember both names for it.
      const duplicate = seen.has(computed) || (given !== null && seen.has(given));
      seen.add(computed);
      if (given !== null) seen.add(given);
      if (duplicate) return;

      const fields = scrubClientError({
        kind: context.kind,
        app: context.app,
        name: thrown.name,
        message: vault ? undefined : thrown.message,
        stack: vault || !thrown.stack ? undefined : thrown.stack,
        digest: given ?? computed,
        path,
        release: release(),
      });
      let body = JSON.stringify(fields);
      if (byteLength(body) > MAX_BODY_BYTES) body = JSON.stringify({ ...fields, stack: null });
      send(body);
    } catch {
      // An error in here has nowhere to go: reporting it would be reporting the reporter.
    } finally {
      busy = false;
    }
  };
}

/** The page's one reporter: every source shares its count and its memory of what was sent. */
export const reportClientError: ClientErrorReporter = createClientErrorReporter();

let installed: { owners: number; remove: () => void } | null = null;

/**
 * Listens on window for uncaught errors and unhandled promise rejections and
 * reports them. Returns the function that stops listening; the listeners are
 * added once however many callers ask, and removed when the last one lets go.
 * `report` is a parameter for tests.
 */
export function installClientErrorListeners(
  app: ClientErrorReport['app'],
  report: ClientErrorReporter = reportClientError,
): () => void {
  if (typeof window === 'undefined') return () => {};

  if (!installed) {
    // A listener that threw would raise the very event it listens for.
    const onError = (event: ErrorEvent) => {
      try {
        report(event.error ?? event.message, { app, kind: 'error', filename: event.filename });
      } catch {}
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      try {
        report(event.reason, { app, kind: 'unhandledrejection' });
      } catch {}
    };
    // Bubble phase on purpose: a failed <img> or <script> load does not bubble, and is not an error of ours.
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    installed = {
      owners: 0,
      remove: () => {
        window.removeEventListener('error', onError);
        window.removeEventListener('unhandledrejection', onRejection);
      },
    };
  }

  const mine = installed;
  mine.owners += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    mine.owners -= 1;
    if (mine.owners > 0) return;
    mine.remove();
    if (installed === mine) installed = null;
  };
}
