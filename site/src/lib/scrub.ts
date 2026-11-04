// Scrubbing for client error reports (/api/client-errors, PLAN Topic D5).
// Pure and import-free so it is unit-tested on its own.
//
// An error message or stack can carry whatever the code had in hand: a vault
// item, an access token from an auth redirect, a push endpoint, a form value.
// The rules, strictest first:
// - Anything from the Vault screens keeps only the error name and digest.
// - URLs lose their query string and fragment (auth redirects put tokens there).
// - Emails, JWTs, bearer tokens, key=value secrets, long hex/base64 runs and
//   push-service endpoints are replaced with placeholders.
// - Everything is length-capped.

const MAX_MESSAGE = 500;
const MAX_STACK = 4000;
const MAX_STACK_LINES = 30;

const REDACTIONS: Array<[RegExp, string]> = [
  // Push subscription endpoints are capabilities: anyone holding one can push.
  [/https?:\/\/[^\s"')]*(?:fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.apple\.com)[^\s"')]*/gi, '[push-endpoint]'],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, '[jwt]'],
  [/\bbearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [token]'],
  [
    /\b(access_token|refresh_token|id_token|token|secret|password|passphrase|apikey|api_key|key|code|otp|totp|auth)(["']?\s*[:=]\s*["']?)[^\s"'&,;}]+/gi,
    '$1$2[redacted]',
  ],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]'],
  // Keys, hashes, ciphertext: long unbroken runs of hex or base64. Plain
  // base64 only when padded, so a long script path in a stack survives.
  [/\b[A-Fa-f0-9]{32,}\b/g, '[hex]'],
  [/[A-Za-z0-9_-]{40,}/g, '[blob]'],
  [/[A-Za-z0-9+/]{40,}={1,2}/g, '[blob]'],
];

/** Placeholders for anything that looks secret or personal. */
export function redact(text: string): string {
  let out = text;
  for (const [pattern, replacement] of REDACTIONS) out = out.replace(pattern, replacement);
  return out;
}

/** Path only, from a URL or path; '' when unusable. Query and fragment are always dropped. */
export function pathOnly(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  try {
    return redact(new URL(value, 'https://x.invalid').pathname).slice(0, 200);
  } catch {
    return '';
  }
}

/** True for DeskDev's Vault screens, wherever DeskDev is mounted. */
export function isVaultPath(path: string): boolean {
  return /(^|\/)vault(\/|$)/i.test(path);
}

function clipLines(text: string, maxLines: number, maxChars: number): string {
  return text.split('\n').slice(0, maxLines).join('\n').slice(0, maxChars);
}

/** Stack lines carry script URLs; their query strings can hold tokens too. */
function scrubStack(stack: string): string {
  return redact(clipLines(stack, MAX_STACK_LINES, MAX_STACK * 2).replace(/\?[^\s:)]*/g, '')).slice(0, MAX_STACK);
}

export type ClientErrorReport = {
  kind: 'boundary' | 'error' | 'unhandledrejection';
  app: 'site' | 'workspace';
  name: string;
  message: string | null;
  stack: string | null;
  digest: string | null;
  path: string;
  release: string | null;
};

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function short(value: unknown, max: number, pattern: RegExp): string | null {
  return typeof value === 'string' && pattern.test(value) ? value.slice(0, max) : null;
}

/** A report built only from known fields, every one scrubbed. Never throws. */
export function scrubClientError(input: Record<string, unknown>): ClientErrorReport {
  const path = pathOnly(input.url ?? input.path);
  const vault = isVaultPath(path);
  const name = short(input.name, 80, /^[A-Za-z0-9_$.]+$/) ?? 'Error';
  const message = typeof input.message === 'string' ? redact(input.message.slice(0, MAX_MESSAGE * 2)).slice(0, MAX_MESSAGE) : null;
  const stack = typeof input.stack === 'string' ? scrubStack(input.stack) : null;
  return {
    kind: oneOf(input.kind, ['boundary', 'error', 'unhandledrejection'] as const, 'error'),
    app: oneOf(input.app, ['site', 'workspace'] as const, 'site'),
    name,
    // The Vault decrypts secrets in the browser: nothing it threw may leave it.
    message: vault ? null : message,
    stack: vault ? null : stack,
    digest: short(input.digest, 64, /^[A-Za-z0-9_-]+$/),
    path: vault ? '/vault' : path,
    release: short(input.release, 64, /^[A-Za-z0-9._+-]+$/),
  };
}
