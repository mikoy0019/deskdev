// DeskDev Studio — google Edge Function
//
// Google services for DeskDev. The server, never the browser, holds every
// grant and talks to Google. A connection has a PURPOSE (../_shared/google_policy.ts):
//   personal  — each person's own Google account, drive.file only
//   workspace — the company account behind the Team Calendar,
//               calendar.app.created + drive.file, admins only
//
// Browser legs (Google's redirect carries no Supabase JWT):
//   GET  /google/start?state=…        sets the browser-flow cookie (nonce + PKCE verifier), 302 → Google
//   GET  /google/callback?code&state  checks state + cookie, exchanges the code WITH the PKCE verifier,
//                                     seals the grant (stores nothing), 302 → returnTo?google=pending&grant=…
//                                     (or ?google=error&reason=…)
// The same legs as JSON, for the site's apex proxy (site/src/app/api/google/[leg]/route.ts), which
// keeps the redirect URI and the cookie on nixgensolutions.com:
//   POST { action: 'proxy_start', state }               → LegResult
//   POST { action: 'proxy_callback', query }  + x-deskdev-google-flow header → LegResult
//
// Signed-in actions (Authorization: Bearer <DeskDev access token>):
//   'status'                         → { configured, connected, email, connectedAt, driveGranted,
//                                        purpose, isAdmin, exportAllowed, proxied, workspace }
//   'connect' { returnTo, purpose?, via? }
//                                    → { url }  (via 'proxy': { url, flow, maxAge }, consent URL + cookie value)
//   'finish' { grant }               → { ok, email, purpose }  stores the grant, only for the user who pressed Connect
//   'disconnect' { purpose? }        → { ok }   removes the grant, then revokes it at Google
//   'export' { tabs? }               → { url, title, tabs, skipped }  ADMINS ONLY, one audit_log row per export
//   'revoke_user' { userId }         → { ok, removed, revokedAtGoogle }  ADMINS ONLY (offboarding)
//   'rotate_tokens'                  → { ok, resealed, current, failed, workspace }  ADMINS ONLY
//
// Deploy with --no-verify-jwt: Google's redirect carries no Supabase JWT, so
// the gateway check is off and every signed-in action verifies the caller here.
//
// Security model (README.md has the long version):
// - drive.file / calendar.app.created: the app sees only files and calendars
//   it created. No restricted scope is ever requested.
// - Refresh tokens are sealed (../_shared/google_crypto.ts): v2 carries a key
//   id, so a new key does not log anyone out; v1 rows from before stay readable.
// - `state` is HMAC-signed (user, return URL, nonce, purpose, expiry). The
//   browser-flow cookie holds the nonce and the PKCE verifier, so a callback
//   only completes in the browser that started the flow, and an intercepted
//   code is useless without that browser's verifier.
// - The callback never stores anything. It seals the grant and hands it back
//   to DeskDev, and `finish` stores it only when the caller's JWT is the user
//   the state was signed for, so a forwarded Connect link cannot attach
//   someone else's Google account to the sender's DeskDev account.
// - Errors: callers get a fixed sentence (PUBLIC_ERRORS); Google's and the
//   database's messages go to the function log only.
// - The export reads DeskDev data with the CALLER's JWT, so RLS decides what
//   lands in the sheet; only admins may export, and every export is audited.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, isForeignOrigin } from "./cors.ts";
import {
  fromB64url,
  type GoogleCrypto,
  KeyConfigError,
  keySecretsPresent,
  pkceChallenge,
  pkceVerifier,
  randomToken,
} from "../_shared/google_crypto.ts";
import {
  allowedReturn,
  consentUrl,
  FLOW_COOKIE,
  FLOW_HEADER,
  FLOW_TTL_MS,
  flowCookie,
  flowMismatch,
  grantedScopes,
  isBrowserFlow,
  isOAuthState,
  isPendingGrant,
  mayRevokeAtGoogle,
  missingScopes,
  type OAuthState,
  parseOrigins,
  parsePurpose,
  type PendingGrant,
  PUBLIC_ERRORS,
  PURPOSES,
  readCookie,
  SCOPE,
  sameGoogleAccount,
  withParams,
} from "../_shared/google_policy.ts";
import {
  accessTokenForUser,
  audit,
  clearWorkspaceGrant,
  ConfigError,
  cryptoFromEnv,
  denoEnv,
  fetchWithTimeout,
  GoogleError,
  isActiveAdmin,
  ReauthRequired,
  readWorkspaceLink,
  requireEnv,
  resealAll,
  revokeAtGoogle,
  revokeGoogleForUser,
  storeUserGrant,
  storeWorkspaceGrant,
  tokenCall,
} from "../_shared/google_grants.ts";

// The path the BROWSER sees for direct (non-proxied) legs; the function itself sees /google/...
const DIRECT_COOKIE_PATH = "/functions/v1/google";
const MAX_BODY_CHARS = 64_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PAGE = 1000; // Supabase's default PostgREST max-rows
const MAX_ROWS = 5000; // per tab
const CELL_MAX = 50_000; // Google Sheets' per-cell limit

const TABS = {
  clients: { title: "Clients", order: "created_at" },
  projects: { title: "Projects", order: "created_at" },
  tasks: { title: "Tasks", order: "created_at" },
  time_entries: { title: "Time entries", order: "entry_date" },
  leads: { title: "Leads", order: "created_at" },
  eod_reports: { title: "EOD reports", order: "report_date" },
} as const;
type TabKey = keyof typeof TABS;

class Forbidden extends Error {}

const env = (name: string) => requireEnv(denoEnv, name);

function isConfigured(): boolean {
  return ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "APP_ORIGINS"].every((k) => Boolean(denoEnv(k))) &&
    keySecretsPresent(denoEnv);
}

/** The function's own public URL (GOOGLE_FUNCTION_URL only for `supabase functions serve`). */
function functionBase(): string {
  const base = denoEnv("GOOGLE_FUNCTION_URL") || `${env("SUPABASE_URL")}/functions/v1/google`;
  return base.replace(/\/+$/, "");
}

/**
 * Where Google sends the browser back. GOOGLE_REDIRECT_BASE (e.g.
 * https://nixgensolutions.com/api/google) puts both legs behind the site's
 * apex proxy: a redirect URI on a domain the OAuth consent screen verifies,
 * and a first-party cookie. Unset, the function serves the legs itself.
 */
function redirectBase(): string {
  return (denoEnv("GOOGLE_REDIRECT_BASE") || functionBase()).replace(/\/+$/, "");
}
const redirectUri = () => `${redirectBase()}/callback`;
const proxied = () => Boolean(denoEnv("GOOGLE_REDIRECT_BASE"));

let cryptoCache: GoogleCrypto | null = null;
/** Throws ConfigError (503) for a missing or malformed keyring; never cached in that case. */
function keys(): GoogleCrypto {
  cryptoCache ??= cryptoFromEnv(denoEnv);
  return cryptoCache;
}

function serviceClient(): SupabaseClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function emailFromIdToken(idToken: string | undefined): string | null {
  // Received straight from Google's token endpoint over TLS, so OIDC allows
  // reading it without verifying the signature.
  try {
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(idToken!.split(".")[1])));
    return typeof claims.email === "string" && claims.email_verified !== false ? claims.email : null;
  } catch {
    return null;
  }
}

// deno-lint-ignore no-explicit-any
async function gapi<T = any>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetchWithTimeout(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  }, 30_000);
  const body = await res.text();
  // deno-lint-ignore no-explicit-any
  let data: any = null;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    // not JSON; logged below
  }
  if (res.status === 401) throw new ReauthRequired("Google answered 401");
  if (!res.ok) throw new GoogleError(`Google API ${res.status}: ${data?.error?.message ?? body.slice(0, 300)}`);
  return data as T;
}

// ---------------------------------------------------------------- browser legs

/** What a browser leg wants the browser to see. Rendered as a 302 here, or as JSON for the apex proxy. */
type LegResult =
  | { kind: "redirect"; location: string; /** set (value), clear (null) or leave (undefined) the flow cookie */ flow?: { value: string; maxAge: number } | null }
  | { kind: "text"; status: number; message: string };

const back = (state: OAuthState, params: Record<string, string>): LegResult => ({
  kind: "redirect",
  location: withParams(state.r, params),
  flow: null,
});

const invalidLink = (message: string): LegResult => ({ kind: "text", status: 400, message });

async function startLeg(rawState: unknown): Promise<LegResult> {
  const c = keys();
  const state = await c.verifyState(rawState);
  if (!isOAuthState(state)) return invalidLink("This Google sign-in link is not valid. Go back to DeskDev and press Connect again.");
  if (Date.now() > state.e) return back(state, { google: "error", reason: "expired" });
  // The verifier is born in the response that sets the cookie, so it only
  // ever exists in this browser and on the server.
  const verifier = pkceVerifier();
  const flow = await c.sealBlob("flow", { n: state.n, v: verifier, e: state.e });
  return {
    kind: "redirect",
    location: consentUrl({
      clientId: env("GOOGLE_OAUTH_CLIENT_ID"),
      redirectUri: redirectUri(),
      purpose: state.p,
      state: rawState as string,
      codeChallenge: await pkceChallenge(verifier),
    }),
    flow: { value: flow, maxAge: Math.ceil((state.e - Date.now()) / 1000) },
  };
}

interface CallbackQuery {
  state?: unknown;
  code?: unknown;
  error?: unknown;
}

async function callbackLeg(query: CallbackQuery, rawFlow: string | null): Promise<LegResult> {
  const c = keys();
  const state = await c.verifyState(query.state);
  if (!isOAuthState(state)) return invalidLink("This Google sign-in could not be verified. Go back to DeskDev and press Connect again.");
  if (Date.now() > state.e) return back(state, { google: "error", reason: "expired" });

  const opened = await c.openBlob("flow", rawFlow);
  const mismatch = flowMismatch(state, isBrowserFlow(opened) ? opened : null);
  if (mismatch || !isBrowserFlow(opened)) return back(state, { google: "error", reason: mismatch ?? "browser" });

  if (typeof query.error === "string" && query.error) {
    return back(state, { google: "error", reason: query.error === "access_denied" ? "denied" : "google" });
  }
  const code = typeof query.code === "string" && query.code.length <= 2048 ? query.code : null;
  if (!code) return back(state, { google: "error", reason: "google" });

  // From here on the browser is navigating, not fetching: every failure goes
  // back into DeskDev as ?google=error, never as a JSON body on a blank page.
  try {
    // Single-use code: never retried, a retry could only yield invalid_grant.
    const { ok, data } = await tokenCall(denoEnv, {
      code,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
      code_verifier: opened.v,
    });
    if (!ok || !data.access_token) {
      console.error("google callback: token exchange failed", data.error, data.error_description);
      return back(state, { google: "error", reason: "exchange" });
    }

    // Granular consent lets a person untick a box. Without the purpose's
    // required scopes nothing works. (No revoke here: Google revokes a whole
    // grant at once, which would also kill an earlier, complete connection
    // to the same account.)
    const granted = grantedScopes(data.scope);
    if (missingScopes(state.p, granted).length) return back(state, { google: "error", reason: "scope" });
    if (!data.refresh_token) return back(state, { google: "error", reason: "no_refresh" });

    let email = emailFromIdToken(data.id_token);
    if (!email) {
      const me = await gapi<{ email?: string }>(data.access_token, "https://openidconnect.googleapis.com/v1/userinfo").catch(() => null);
      email = me?.email ?? null;
    }
    if (!email) return back(state, { google: "error", reason: "email" });

    const pending: PendingGrant = { u: state.u, p: state.p, m: email, s: granted, t: data.refresh_token, e: Date.now() + FLOW_TTL_MS };
    return back(state, { google: "pending", grant: await c.sealBlob("grant", pending) });
  } catch (err) {
    console.error("google callback:", err);
    return back(state, { google: "error", reason: err instanceof ConfigError ? "config" : "google" });
  }
}

/** A leg served by the function itself (no proxy): 302 or text, with the cookie on the function's path. */
function renderDirect(leg: LegResult): Response {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (leg.kind === "text") {
    headers["Content-Type"] = "text/plain; charset=utf-8";
    headers["Set-Cookie"] = flowCookie("", 0, DIRECT_COOKIE_PATH);
    return new Response(leg.message, { status: leg.status, headers });
  }
  headers.Location = leg.location;
  if (leg.flow === null) headers["Set-Cookie"] = flowCookie("", 0, DIRECT_COOKIE_PATH);
  else if (leg.flow) headers["Set-Cookie"] = flowCookie(leg.flow.value, leg.flow.maxAge, DIRECT_COOKIE_PATH);
  return new Response(null, { status: 302, headers });
}

// ---------------------------------------------------------------- export

type Cell = string | number | boolean;

function cell(v: unknown): Cell {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" || typeof v === "boolean") return v;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > CELL_MAX ? `${s.slice(0, CELL_MAX - 1)}…` : s;
}

async function readTab(db: SupabaseClient, tab: TabKey): Promise<{ values: Cell[][]; rows: number; truncated: boolean }> {
  const { order } = TABS[tab];
  const rows: Record<string, unknown>[] = [];
  let total: number | null = null;
  while (rows.length < MAX_ROWS) {
    const from = rows.length;
    const to = Math.min(from + PAGE, MAX_ROWS) - 1;
    const { data, error, count } = await db
      .from(tab)
      .select("*", from === 0 ? { count: "exact" } : undefined)
      .order(order, { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
    if (error) throw new Error(`${tab}: ${error.message}`);
    if (from === 0) total = count ?? null;
    rows.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data?.length || (total !== null && rows.length >= total)) break;
  }
  if (!rows.length) return { values: [["No rows you can see."]], rows: 0, truncated: false };
  const header = Object.keys(rows[0]);
  return {
    values: [header, ...rows.map((r) => header.map((k) => cell(r[k])))],
    rows: rows.length,
    truncated: total !== null && total > rows.length,
  };
}

/** Found by appProperties, never by name: drive.file cannot see folders it did not create. */
async function exportsFolder(token: string): Promise<string> {
  const q = "mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='deskdev' and value='exports' } and trashed = false";
  const found = await gapi<{ files?: { id: string }[] }>(
    token,
    `https://www.googleapis.com/drive/v3/files?${new URLSearchParams({ q, fields: "files(id)", pageSize: "1", spaces: "drive" })}`,
  );
  if (found.files?.[0]?.id) return found.files[0].id;
  const made = await gapi<{ id: string }>(token, "https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    body: JSON.stringify({ name: "DeskDev Exports", mimeType: "application/vnd.google-apps.folder", appProperties: { deskdev: "exports" } }),
  });
  return made.id;
}

function manilaStamp(): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date()).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

type Json = (body: unknown, status?: number) => Response;

async function exportToSheets(json: Json, admin: SupabaseClient, userDb: SupabaseClient, userId: string, requested: unknown) {
  const wanted = (Array.isArray(requested) && requested.length ? requested : Object.keys(TABS))
    .filter((t, i, all): t is TabKey => typeof t === "string" && t in TABS && all.indexOf(t) === i);
  if (!wanted.length) return json({ error: "Pick at least one thing to export." }, 400);

  // Read DeskDev first: no Google file is created for an export that cannot be filled.
  const tabs: { key: TabKey; title: string; values: Cell[][]; rows: number; truncated: boolean }[] = [];
  const skipped: { tab: TabKey; reason: string }[] = [];
  for (const key of wanted) {
    try {
      tabs.push({ key, title: TABS[key].title, ...(await readTab(userDb, key)) });
    } catch (err) {
      console.error("google export: tab unreadable", err);
      skipped.push({ tab: key, reason: "Could not be read." });
    }
  }
  if (!tabs.length) return json({ error: "Nothing could be read for export.", skipped }, 400);

  const { data: conn } = await admin.from("google_connections").select("google_email").eq("user_id", userId).maybeSingle();
  if (!conn) throw new ReauthRequired("not connected");

  // Audited BEFORE any data leaves: no audit row, no export.
  const logged = await audit(admin, {
    actorId: userId,
    action: "google.export",
    entity: "google_export",
    detail: {
      google_email: conn.google_email,
      tabs: tabs.map(({ key, rows, truncated }) => ({ tab: key, rows, truncated })),
      skipped: skipped.map((s) => s.tab),
    },
  });
  if (!logged.ok) return json({ error: PUBLIC_ERRORS.exportFailed }, 503);

  const token = await accessTokenForUser(admin, keys(), denoEnv, userId);
  const folderId = await exportsFolder(token);
  const title = `DeskDev export ${manilaStamp()} (Manila)`;
  const file = await gapi<{ id: string }>(token, "https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    body: JSON.stringify({ name: title, mimeType: "application/vnd.google-apps.spreadsheet", parents: [folderId], appProperties: { deskdev: "export" } }),
  });

  const meta = await gapi<{ sheets: { properties: { sheetId: number } }[] }>(
    token,
    `https://sheets.googleapis.com/v4/spreadsheets/${file.id}?fields=sheets.properties.sheetId`,
  );
  const firstId = meta.sheets[0].properties.sheetId;
  const ids = tabs.map((_, i) => (i === 0 ? firstId : firstId + 1000 + i));

  // Grid sized to fit (a new sheet is 1000 × 26), header frozen and bold.
  // rowCount stays above frozenRowCount: Sheets refuses to freeze every row.
  const requests: unknown[] = [];
  tabs.forEach((t, i) => {
    const properties = {
      sheetId: ids[i],
      title: t.title,
      gridProperties: { rowCount: Math.max(t.values.length, 2), columnCount: Math.max(t.values[0].length, 1), frozenRowCount: 1 },
    };
    requests.push(i === 0
      ? { updateSheetProperties: { properties, fields: "title,gridProperties.rowCount,gridProperties.columnCount,gridProperties.frozenRowCount" } }
      : { addSheet: { properties } });
    requests.push({
      repeatCell: {
        range: { sheetId: ids[i], startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: "userEnteredFormat.textFormat.bold",
      },
    });
  });
  await gapi(token, `https://sheets.googleapis.com/v4/spreadsheets/${file.id}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests }),
  });

  // RAW: a value like "=IMPORTXML(…)" stays text and never runs as a formula.
  // Written in slices of ~4MB of JSON, well under Google's request size limit
  // (long EOD reports add up quickly at 5,000 rows).
  for (const t of tabs) {
    const sheet = `'${t.title.replace(/'/g, "''")}'`;
    let start = 0;
    while (start < t.values.length) {
      let end = start;
      let size = 0;
      while (end < t.values.length && (end === start || size < 4_000_000)) {
        size += JSON.stringify(t.values[end]).length;
        end++;
      }
      await gapi(token, `https://sheets.googleapis.com/v4/spreadsheets/${file.id}/values:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({ valueInputOption: "RAW", data: [{ range: `${sheet}!A${start + 1}`, values: t.values.slice(start, end) }] }),
      });
      start = end;
    }
  }

  return json({
    url: `https://docs.google.com/spreadsheets/d/${file.id}/edit`,
    title,
    tabs: tabs.map(({ key, rows, truncated }) => ({ tab: key, rows, truncated })),
    skipped,
  });
}

// ---------------------------------------------------------------- signed-in actions

interface Caller {
  id: string;
  isAdmin: () => Promise<boolean>;
}

async function finishPersonal(json: Json, admin: SupabaseClient, caller: Caller, grant: PendingGrant): Promise<Response> {
  const c = keys();
  const { data: previous, error: readError } = await admin
    .from("google_connections").select("refresh_token_enc, google_email").eq("user_id", caller.id).maybeSingle();
  if (readError) throw new Error(`google_connections read failed: ${readError.message}`);

  const stored = await storeUserGrant(admin, c, { userId: caller.id, email: grant.m, scopes: grant.s, refreshToken: grant.t });
  if (stored.error) {
    console.error("google finish: could not store the connection", stored.error);
    return json({ error: "The Google connection could not be saved. Try again." }, 500);
  }
  if (stored.format === "v1") console.warn("google finish: stored as v1; 027's CHECK still refuses v2 tokens");

  // Switched to a DIFFERENT Google account: retire the old account's grant,
  // unless the company workspace link uses it (one Google grant per account).
  if (previous && !sameGoogleAccount(previous.google_email, grant.m)) {
    const { row: link } = await readWorkspaceLink(admin);
    if (mayRevokeAtGoogle(previous.google_email, [link?.status === "active" ? link.google_email : null])) {
      const old = await c.openToken(previous.refresh_token_enc, { kind: "user", userId: caller.id }).catch(() => null);
      if (old) await revokeAtGoogle(old.token);
    }
  }
  return json({ ok: true, email: grant.m, purpose: "personal" });
}

async function personalEmails(admin: SupabaseClient): Promise<string[]> {
  const { data } = await admin.from("google_connections").select("google_email");
  return ((data ?? []) as { google_email: string }[]).map((r) => r.google_email);
}

async function finishWorkspace(json: Json, admin: SupabaseClient, caller: Caller, grant: PendingGrant): Promise<Response> {
  if (!(await caller.isAdmin())) throw new Forbidden("workspace finish by a non-admin");
  const c = keys();
  const { row: previous, available } = await readWorkspaceLink(admin);
  if (!available) return json({ error: PUBLIC_ERRORS.workspaceUnavailable }, 503);

  // 040's triggers on the row re-queue the calendar on an account switch and
  // kick the sync worker; the audit row is written here.
  const { error } = await storeWorkspaceGrant(admin, c, {
    email: grant.m,
    scopes: grant.s,
    refreshToken: grant.t,
    connectedBy: caller.id,
  });
  if (error) {
    console.error("google finish: could not store the workspace link", error);
    return json({ error: "The Google connection could not be saved. Try again." }, 500);
  }
  await audit(admin, {
    actorId: caller.id,
    action: "google.workspace_connected",
    entity: "google_workspace_link",
    entityId: "workspace",
    detail: {
      google_email: grant.m,
      scopes: grant.s,
      replaced: previous && !sameGoogleAccount(previous.google_email, grant.m) ? previous.google_email : null,
    },
  });

  // Retire the previous account's grant, unless a person's own connection
  // uses that Google account (Google revokes per account, not per token).
  if (previous?.refresh_token_enc && previous.status === "active" && !sameGoogleAccount(previous.google_email, grant.m)) {
    if (mayRevokeAtGoogle(previous.google_email, await personalEmails(admin))) {
      const old = await c.openToken(previous.refresh_token_enc, { kind: "workspace" }).catch(() => null);
      if (old) await revokeAtGoogle(old.token);
    }
  }
  return json({ ok: true, email: grant.m, purpose: "workspace" });
}

async function disconnectPersonal(json: Json, admin: SupabaseClient, caller: Caller): Promise<Response> {
  const { data: row } = await admin
    .from("google_connections").select("refresh_token_enc, google_email").eq("user_id", caller.id).maybeSingle();
  // A misconfigured key answers 503 before the row goes, instead of deleting
  // it and silently skipping the revoke (an orphaned grant).
  const c = row ? keys() : null;
  const { error } = await admin.from("google_connections").delete().eq("user_id", caller.id);
  if (error) {
    console.error("google disconnect:", error.code, error.message);
    return json({ error: PUBLIC_ERRORS.unexpected }, 500);
  }
  if (row && c) {
    const { row: link } = await readWorkspaceLink(admin);
    if (mayRevokeAtGoogle(row.google_email, [link?.status === "active" ? link.google_email : null])) {
      const opened = await c.openToken(row.refresh_token_enc, { kind: "user", userId: caller.id }).catch(() => null);
      if (opened) await revokeAtGoogle(opened.token);
    }
  }
  return json({ ok: true });
}

async function disconnectWorkspace(json: Json, admin: SupabaseClient, caller: Caller): Promise<Response> {
  if (!(await caller.isAdmin())) throw new Forbidden("workspace disconnect by a non-admin");
  const { row, available } = await readWorkspaceLink(admin);
  if (!available) return json({ error: PUBLIC_ERRORS.workspaceUnavailable }, 503);
  if (!row) return json({ ok: true });
  // A token is still stored after Google itself revoked the grant (status
  // 'revoked', token kept); clearing it is still worth doing.
  const live = Boolean(row.refresh_token_enc);
  // A misconfigured key answers 503 before the token is cleared, instead of
  // clearing it and silently skipping the revoke (an orphaned grant).
  const c = live ? keys() : null;
  const opened = live && c
    ? await c.openToken(row.refresh_token_enc!, { kind: "workspace" }).catch((err) => {
      // A key that was removed from the keyring is a configuration problem (503), not a dead token.
      if (err instanceof KeyConfigError) throw new ConfigError(err.message);
      return null;
    })
    : null;
  // Kept, not deleted: the calendar id and sync history outlive a grant.
  const { error } = await clearWorkspaceGrant(admin);
  if (error) {
    console.error("google disconnect workspace:", error);
    return json({ error: PUBLIC_ERRORS.unexpected }, 500);
  }
  await audit(admin, {
    actorId: caller.id,
    action: "google.workspace_disconnected",
    entity: "google_workspace_link",
    entityId: "workspace",
    detail: { google_email: row.google_email },
  });
  if (opened && mayRevokeAtGoogle(row.google_email, await personalEmails(admin))) {
    await revokeAtGoogle(opened.token);
  }
  return json({ ok: true });
}

// ---------------------------------------------------------------- entry

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req);
  const json: Json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);

  try {
    if (req.method === "GET" && url.pathname.endsWith("/start")) {
      return renderDirect(await startLeg(url.searchParams.get("state")));
    }
    if (req.method === "GET" && url.pathname.endsWith("/callback")) {
      const q = url.searchParams;
      return renderDirect(await callbackLeg(
        { state: q.get("state"), code: q.get("code"), error: q.get("error") },
        readCookie(req.headers.get("cookie"), FLOW_COOKIE),
      ));
    }
    if (req.method !== "POST") return json({ error: PUBLIC_ERRORS.badRequest }, 405);
    // A browser on a page that is not DeskDev gets nothing (the JWT check
    // below is the real boundary; the apex proxy sends no Origin at all).
    if (isForeignOrigin(req)) return json({ error: PUBLIC_ERRORS.forbidden }, 403);

    const raw = await req.text();
    if (raw.length > MAX_BODY_CHARS) return json({ error: PUBLIC_ERRORS.badRequest }, 413);
    let body: Record<string, unknown> = {};
    try {
      const parsed = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed;
    } catch {
      return json({ error: PUBLIC_ERRORS.badRequest }, 400);
    }

    // The apex proxy's legs: exactly as public as GET /start and /callback.
    if (body.action === "proxy_start") return json(await startLeg(body.state));
    if (body.action === "proxy_callback") {
      const q = (body.query && typeof body.query === "object" ? body.query : {}) as CallbackQuery;
      return json(await callbackLeg(q, req.headers.get(FLOW_HEADER)));
    }

    // Every other action: a signed-in DeskDev user, checked here because the
    // gateway's JWT check is off for this function.
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: PUBLIC_ERRORS.unauthorized }, 401);
    const { data: { user }, error: authError } = await createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      auth: { autoRefreshToken: false, persistSession: false },
    }).auth.getUser(jwt);
    if (authError || !user) return json({ error: PUBLIC_ERRORS.unauthorized }, 401);

    const admin = serviceClient();
    let adminFlag: Promise<boolean> | null = null;
    const caller: Caller = {
      id: user.id,
      isAdmin: () => (adminFlag ??= isActiveAdmin(admin, user.id)),
    };

    switch (body.action) {
      case "status": {
        const { data: row } = await admin
          .from("google_connections").select("google_email, scopes, connected_at").eq("user_id", user.id).maybeSingle();
        const isAdmin = await caller.isAdmin();
        let workspace: Record<string, unknown> | null = null;
        if (isAdmin) {
          const { row: link, available } = await readWorkspaceLink(admin);
          workspace = {
            available,
            connected: link?.status === "active" && Boolean(link.refresh_token_enc),
            status: link?.status ?? null,
            email: link?.google_email ?? null,
            connectedAt: link?.connected_at ?? null,
            calendarGranted: Boolean(link?.scopes?.includes(SCOPE.calendarAppCreated)),
            // Optional (booking availability): false until an admin reconnects once.
            freebusyGranted: Boolean(link?.scopes?.includes(SCOPE.calendarFreebusy)),
          };
        }
        return json({
          configured: isConfigured(),
          connected: Boolean(row),
          email: row?.google_email ?? null,
          connectedAt: row?.connected_at ?? null,
          driveGranted: Boolean(row?.scopes?.includes(SCOPE.driveFile)),
          purpose: "personal",
          isAdmin,
          exportAllowed: isAdmin,
          proxied: proxied(),
          workspace,
        });
      }

      case "connect": {
        if (!isConfigured()) return json({ error: PUBLIC_ERRORS.notConfigured }, 503);
        const purpose = parsePurpose(body.purpose);
        if (!purpose) return json({ error: PUBLIC_ERRORS.badRequest }, 400);
        if (PURPOSES[purpose].adminOnly && !(await caller.isAdmin())) return json({ error: PUBLIC_ERRORS.adminOnly }, 403);
        if (purpose === "workspace" && !(await readWorkspaceLink(admin)).available) {
          return json({ error: PUBLIC_ERRORS.workspaceUnavailable }, 503);
        }
        // The company grant (calendar scope) only ever starts through the apex
        // proxy, where the flow cookie is set in this very response. A /start
        // link is a bearer link: anyone it is forwarded to can open it, and
        // only `finish` would stop the result.
        if (purpose === "workspace" && body.via !== "proxy") {
          return json({ error: PUBLIC_ERRORS.workspaceNeedsProxy }, 400);
        }
        const returnTo = allowedReturn(body.returnTo, parseOrigins(env("APP_ORIGINS")));
        if (!returnTo) {
          console.error("google connect: returnTo not on APP_ORIGINS");
          return json({ error: "Google can't be connected from this address." }, 400);
        }
        const c = keys();
        const st: OAuthState = { u: user.id, r: returnTo, n: randomToken(16), e: Date.now() + FLOW_TTL_MS, p: purpose };
        const state = await c.signState(st);

        if (body.via === "proxy") {
          // The apex proxy sets the cookie in THIS response, the one that
          // checked the session, so no bearer /start link exists at all.
          if (!proxied()) {
            console.error("google connect: via=proxy but GOOGLE_REDIRECT_BASE is unset");
            return json({ error: PUBLIC_ERRORS.notConfigured }, 503);
          }
          const verifier = pkceVerifier();
          return json({
            url: consentUrl({
              clientId: env("GOOGLE_OAUTH_CLIENT_ID"),
              redirectUri: redirectUri(),
              purpose,
              state,
              codeChallenge: await pkceChallenge(verifier),
            }),
            flow: await c.sealBlob("flow", { n: st.n, v: verifier, e: st.e }),
            maxAge: Math.floor(FLOW_TTL_MS / 1000),
          });
        }
        // Clients that navigate to a start link (the current DeskDev client).
        return json({ url: `${redirectBase()}/start?state=${encodeURIComponent(state)}` });
      }

      case "finish": {
        const opened = await keys().openBlob("grant", body.grant);
        if (!isPendingGrant(opened)) return json({ error: PUBLIC_ERRORS.grantInvalid }, 400);
        // Someone else's consent link was opened here (or this one was forwarded).
        // No revoke: Google revokes a whole grant at once, which would also kill
        // that person's own DeskDev connection to the same Google account.
        if (opened.u !== user.id) return json({ error: PUBLIC_ERRORS.grantOtherUser }, 403);
        if (Date.now() > opened.e) return json({ error: PUBLIC_ERRORS.grantExpired }, 400);
        return opened.p === "workspace"
          ? await finishWorkspace(json, admin, caller, opened)
          : await finishPersonal(json, admin, caller, opened);
      }

      case "disconnect": {
        const purpose = parsePurpose(body.purpose);
        if (!purpose) return json({ error: PUBLIC_ERRORS.badRequest }, 400);
        return purpose === "workspace" ? await disconnectWorkspace(json, admin, caller) : await disconnectPersonal(json, admin, caller);
      }

      case "export": {
        // Admins only: workspace data leaving into a personal Drive is an
        // admin decision, and every export leaves an audit_log row.
        if (!(await caller.isAdmin())) return json({ error: PUBLIC_ERRORS.adminOnly }, 403);
        const userDb = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
          global: { headers: { Authorization: `Bearer ${jwt}` } },
          auth: { autoRefreshToken: false, persistSession: false },
        });
        return await exportToSheets(json, admin, userDb, user.id, body.tabs);
      }

      case "revoke_user": {
        if (!(await caller.isAdmin())) return json({ error: PUBLIC_ERRORS.adminOnly }, 403);
        const target = body.userId;
        if (typeof target !== "string" || !UUID.test(target)) return json({ error: PUBLIC_ERRORS.badRequest }, 400);
        const result = await revokeGoogleForUser(admin, target);
        await audit(admin, { actorId: user.id, action: "google.revoked", entity: "profile", entityId: target, detail: { ...result } });
        return json({ ok: true, ...result });
      }

      case "rotate_tokens": {
        if (!(await caller.isAdmin())) return json({ error: PUBLIC_ERRORS.adminOnly }, 403);
        const c = keys();
        const result = await resealAll(admin, c);
        await audit(admin, { actorId: user.id, action: "google.keys_rotated", entity: "google_keys", entityId: c.current, detail: { ...result } });
        return json({ ok: true, key: c.current, ...result });
      }

      default:
        return json({ error: PUBLIC_ERRORS.badRequest }, 400);
    }
  } catch (err) {
    if (err instanceof ReauthRequired) {
      console.warn("google function: reauth required:", err.message);
      return json({ error: PUBLIC_ERRORS.reauth, reauth: true }, 409);
    }
    if (err instanceof Forbidden) return json({ error: PUBLIC_ERRORS.adminOnly }, 403);
    if (err instanceof ConfigError) {
      console.error("google function: configuration:", err.message);
      return json({ error: PUBLIC_ERRORS.notConfigured }, 503);
    }
    if (err instanceof GoogleError) {
      console.error("google function: Google:", err.message);
      return json({ error: PUBLIC_ERRORS.google }, 502);
    }
    console.error("google function:", err);
    return json({ error: PUBLIC_ERRORS.unexpected }, 500);
  }
});
