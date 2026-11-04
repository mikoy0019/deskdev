// DeskDev Studio — Google OAuth policy (shared by the `google` and
// `admin-users` Edge Functions, and tested by the site's Vitest suite in
// site/src/app/api/google/googleShared.test.ts).
//
// Import-free and side-effect-free: purposes and scopes, the consent URL,
// the returnTo allow-list, the browser-flow cookie and the shapes of the
// signed state and sealed grant. Everything that needs keys or the network
// lives in google_crypto.ts / google_grants.ts / google/index.ts.

// ---------------------------------------------------------------- scopes and purposes

export const SCOPE = {
  openid: "openid",
  email: "email",
  driveFile: "https://www.googleapis.com/auth/drive.file",
  calendarAppCreated: "https://www.googleapis.com/auth/calendar.app.created",
  /** Busy/free times only, never event details: the booking page's availability (048). */
  calendarFreebusy: "https://www.googleapis.com/auth/calendar.freebusy",
} as const;

/**
 * What a connection is FOR, instead of one hardcoded scope list:
 * - personal:  each person's own Google account, drive.file only (the app
 *              sees only files it created). Non-sensitive, no verification.
 * - workspace: the company Google account that owns the shared "NixGen Team"
 *              calendar. calendar.app.created (only calendars this app made)
 *              plus drive.file, both non-sensitive. Admins only, and stored
 *              in the google_workspace_link singleton, not on a person.
 *              It also asks for calendar.freebusy (busy/free times only, no
 *              event details) so the booking page can avoid the account's own
 *              appointments. That one is requested but NOT required: a grant
 *              without it keeps working, and the google-calendar function's
 *              `slots` then reads only the team calendar ('team_only').
 * No restricted Gmail or Drive scope is ever requested by this app; Gmail is
 * n8n's job (PLAN Topic C), which keeps the app out of the CASA assessment.
 */
export type Purpose = "personal" | "workspace";

export interface PurposeSpec {
  scopes: string[];
  /** Consent fails (?reason=scope) unless Google granted every one of these. */
  required: string[];
  adminOnly: boolean;
}

export const PURPOSES: Record<Purpose, PurposeSpec> = {
  personal: {
    scopes: [SCOPE.openid, SCOPE.email, SCOPE.driveFile],
    required: [SCOPE.driveFile],
    adminOnly: false,
  },
  workspace: {
    scopes: [SCOPE.openid, SCOPE.email, SCOPE.calendarAppCreated, SCOPE.calendarFreebusy, SCOPE.driveFile],
    required: [SCOPE.calendarAppCreated, SCOPE.driveFile],
    adminOnly: true,
  },
};

/** undefined/null → personal (what every client before purposes sent); anything unknown → null. */
export function parsePurpose(raw: unknown): Purpose | null {
  if (raw === undefined || raw === null || raw === "") return "personal";
  return raw === "personal" || raw === "workspace" ? raw : null;
}

export function grantedScopes(scope: string | undefined | null): string[] {
  return (scope ?? "").split(/\s+/).filter(Boolean);
}

/** The required scopes Google did NOT grant (granular consent lets people untick boxes). */
export function missingScopes(purpose: Purpose, granted: string[]): string[] {
  return PURPOSES[purpose].required.filter((s) => !granted.includes(s));
}

// ---------------------------------------------------------------- consent URL

export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export interface ConsentParams {
  clientId: string;
  redirectUri: string;
  purpose: Purpose;
  state: string;
  /** PKCE S256 challenge of the verifier held in the browser-flow cookie. */
  codeChallenge: string;
}

export function consentUrl(p: ConsentParams): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: "code",
    scope: PURPOSES[p.purpose].scopes.join(" "),
    // offline + a forced consent prompt: the only combination that returns a
    // refresh token on a RE-connect (Google sends one only on first consent otherwise).
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    code_challenge: p.codeChallenge,
    code_challenge_method: "S256",
    state: p.state,
  });
  return `${AUTH_URL}?${q}`;
}

// ---------------------------------------------------------------- returnTo allow-list

/** APP_ORIGINS → normalized origins (scheme://host[:port]); junk entries are dropped. */
export function parseOrigins(raw: string | undefined | null): string[] {
  const out: string[] = [];
  for (const item of (raw ?? "").split(",")) {
    const v = item.trim();
    if (!v) continue;
    try {
      const u = new URL(v);
      if ((u.protocol === "https:" || u.protocol === "http:") && !out.includes(u.origin)) out.push(u.origin);
    } catch {
      // not a URL
    }
  }
  return out;
}

/** returnTo when it is an http(s) URL on an allowed origin (so the callback is never an open redirect), else null. */
export function allowedReturn(raw: unknown, origins: string[]): string | null {
  if (typeof raw !== "string" || raw.length > 500) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  return origins.includes(u.origin) ? u.toString() : null;
}

/** returnTo with ?google=… set (and stale ones replaced). */
export function withParams(returnTo: string, params: Record<string, string>): string {
  const u = new URL(returnTo);
  for (const k of ["google", "reason", "grant", "purpose"]) u.searchParams.delete(k);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

/**
 * ?google=error&reason=… values. The UI turns each into a sentence
 * (connectErrorMessage in site/src/deskdev/lib/google.ts).
 */
export const ERROR_REASONS = [
  "denied", // Cancel on Google's screen
  "scope", // a required permission was unticked
  "browser", // the callback reached a browser without this flow's cookie
  "expired", // more than 10 minutes between Connect and the callback
  "exchange", // Google refused the code (server side)
  "no_refresh", // Google returned no refresh token
  "email", // no Google email could be read
  "config", // the server's secrets are missing or malformed
  "google", // anything else
  "session", // connect: the DeskDev session was missing or expired
  "forbidden", // connect: this purpose is admin-only
] as const;
export type ErrorReason = (typeof ERROR_REASONS)[number];

// ---------------------------------------------------------------- signed state and sealed blobs

export const FLOW_TTL_MS = 10 * 60_000;

/** OAuth state (HMAC-signed, visible to Google and the browser). */
export interface OAuthState {
  u: string; // DeskDev user id
  r: string; // returnTo (validated against APP_ORIGINS)
  n: string; // nonce, also inside the browser-flow cookie
  e: number; // expiry, ms since epoch
  p: Purpose;
}

export function isOAuthState(v: unknown): v is OAuthState {
  const s = v as OAuthState;
  return !!s && typeof s === "object" && typeof s.u === "string" && typeof s.r === "string" &&
    typeof s.n === "string" && typeof s.e === "number" && (s.p === "personal" || s.p === "workspace");
}

/** The browser-flow cookie (sealed): binds the callback to the browser that started it, and holds the PKCE verifier. */
export interface BrowserFlow {
  n: string; // nonce, must equal state.n
  v: string; // PKCE code_verifier
  e: number;
}

export function isBrowserFlow(v: unknown): v is BrowserFlow {
  const f = v as BrowserFlow;
  return !!f && typeof f === "object" && typeof f.n === "string" && typeof f.v === "string" && typeof f.e === "number";
}

/** The grant in flight between Google's callback and `finish` (sealed). */
export interface PendingGrant {
  u: string; // DeskDev user id the state was signed for
  p: Purpose;
  m: string; // Google email
  s: string[]; // granted scopes
  t: string; // refresh token
  e: number;
}

export function isPendingGrant(v: unknown): v is PendingGrant {
  const g = v as PendingGrant;
  return !!g && typeof g === "object" && typeof g.u === "string" && typeof g.m === "string" &&
    Array.isArray(g.s) && g.s.every((x) => typeof x === "string") && typeof g.t === "string" &&
    typeof g.e === "number" && (g.p === "personal" || g.p === "workspace");
}

/**
 * Why a callback's browser-flow cookie does not belong to this state, or null
 * when it does. Checked before the code is exchanged.
 */
export function flowMismatch(state: OAuthState, flow: BrowserFlow | null, now = Date.now()): "browser" | "expired" | null {
  if (!flow) return "browser";
  if (flow.n.length < 16 || flow.n !== state.n) return "browser";
  if (now > flow.e) return "expired";
  return null;
}

// ---------------------------------------------------------------- browser-flow cookie

export const FLOW_COOKIE = "dd_google_flow";
/** Request header the site's /api/google proxy uses to hand the cookie's value to the function. */
export const FLOW_HEADER = "x-deskdev-google-flow";

export function flowCookie(value: string, maxAgeSeconds: number, path: string, secure = true): string {
  return `${FLOW_COOKIE}=${value}; Path=${path}; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}; HttpOnly;${secure ? " Secure;" : ""} SameSite=Lax`;
}

export function readCookie(header: string | null | undefined, name: string): string | null {
  for (const part of (header ?? "").split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return null;
}

// ---------------------------------------------------------------- grant hygiene

export function sameGoogleAccount(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Google revokes a whole grant (client × Google account) at once, so revoking
 * one refresh token also kills every other token DeskDev holds for the same
 * Google account. A personal grant for the company account must therefore
 * never be revoked at Google while the workspace link uses that account (and
 * the other way round): the row is deleted, the grant at Google stays.
 */
export function mayRevokeAtGoogle(email: string | null | undefined, otherHolders: (string | null | undefined)[]): boolean {
  return !otherHolders.some((other) => sameGoogleAccount(email, other));
}

// ---------------------------------------------------------------- generic error bodies

/**
 * What a caller is told. Details (Google's messages, PostgREST errors, secret
 * names) go to the function log only: they can echo input, name internal
 * tables, or tell an attacker which secret is missing.
 */
export const PUBLIC_ERRORS = {
  unauthorized: "Sign in again to continue.",
  forbidden: "You don't have access to that.",
  adminOnly: "Only an admin can do that.",
  badRequest: "That request could not be processed.",
  notConfigured: "Google is not set up on this workspace yet.",
  google: "Google did not complete the request. Try again.",
  reauth: "Google access has ended. Connect Google again.",
  unexpected: "Something went wrong. Try again.",
  grantInvalid: "This Google sign-in could not be verified. Press Connect Google again.",
  grantOtherUser:
    "This Google sign-in was started from a different DeskDev account, so nothing was saved. To connect your own Google account, press Connect Google here.",
  grantExpired: "The Google sign-in expired after 10 minutes. Press Connect Google again.",
  workspaceUnavailable: "The workspace Google connection is not available yet.",
  workspaceNeedsProxy: "Connect the company Google account from Settings → Integrations in DeskDev.",
  exportFailed: "The export could not be started. Try again.",
} as const;
