// DeskDev Studio — stored Google grants (shared by the `google` and
// `admin-users` Edge Functions; Deno only).
//
// Two places hold a refresh token, both with RLS on and no policies, so only
// the service role inside an Edge Function can read them:
// - public.google_connections   one row per person, purpose "personal" (027)
// - public.google_workspace_link the company account, purpose "workspace" (040).
//                                Written directly with the service role; 040's
//                                triggers on the row own the side effects
//                                (account switch, worker kick, revoked → admins).
//
// The offboarding hook is revokeGoogleForUser(): admin-users calls it when a
// person is deactivated or deleted, and the google function's admin
// `revoke_user` action calls the same code.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { GoogleCrypto, KeyConfigError, TokenUnreadable, type GetEnv, type TokenOwner } from "./google_crypto.ts";
import { mayRevokeAtGoogle, REVOKE_URL, TOKEN_URL } from "./google_policy.ts";

export const denoEnv: GetEnv = (name) => Deno.env.get(name)?.trim() || undefined;

/** A server secret is missing or malformed: answer 503, delete nothing. */
export class ConfigError extends Error {}
/** The stored grant is gone or dead: the person must connect again (409 {reauth}). */
export class ReauthRequired extends Error {}
/** Google failed or refused; details are logged, never returned. */
export class GoogleError extends Error {}

export function requireEnv(getEnv: GetEnv, name: string): string {
  const v = getEnv(name)?.trim();
  if (!v) throw new ConfigError(`${name} is not set`);
  return v;
}

/** The keyring as a GoogleCrypto, with key problems surfaced as ConfigError (503). */
export function cryptoFromEnv(getEnv: GetEnv = denoEnv): GoogleCrypto {
  try {
    return GoogleCrypto.fromEnv(getEnv);
  } catch (err) {
    if (err instanceof KeyConfigError) throw new ConfigError(err.message);
    throw err;
  }
}

export async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
  } catch (err) {
    const why = err instanceof Error && err.name === "TimeoutError" ? `timed out after ${ms / 1000}s` : String(err);
    throw new GoogleError(`Google did not answer (${why})`);
  }
}

export interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

export async function tokenCall(getEnv: GetEnv, params: Record<string, string>): Promise<{ ok: boolean; data: TokenResponse }> {
  const res = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv(getEnv, "GOOGLE_OAUTH_CLIENT_ID"),
      client_secret: requireEnv(getEnv, "GOOGLE_OAUTH_CLIENT_SECRET"),
      ...params,
    }),
  }, 15_000);
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  return { ok: res.ok, data };
}

/** Best effort: removes DeskDev from the Google account's "third-party access" page. */
export async function revokeAtGoogle(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    // The row is already gone; a stale grant at Google is harmless and can be removed there.
    return false;
  }
}

// ---------------------------------------------------------------- writing tokens

const CHECK_VIOLATION = "23514";

/**
 * Stores a personal grant. Sealed v2; while google_connections still has 027's
 * CHECK (refresh_token_enc LIKE 'v1.%'), i.e. until a migration widens it to
 * '^v[0-9]+\.', the insert is refused with 23514 and the row is written as v1
 * instead, so deploying this function never depends on the migration order.
 */
export async function storeUserGrant(
  admin: SupabaseClient,
  crypto: GoogleCrypto,
  row: { userId: string; email: string; scopes: string[]; refreshToken: string },
): Promise<{ error: string | null; format: "v1" | "v2" }> {
  const base = { user_id: row.userId, google_email: row.email, scopes: row.scopes, connected_at: new Date().toISOString() };
  const v2 = await crypto.sealToken(row.refreshToken, { kind: "user", userId: row.userId });
  const first = await admin.from("google_connections").upsert({ ...base, refresh_token_enc: v2 });
  if (!first.error) return { error: null, format: "v2" };
  if (first.error.code !== CHECK_VIOLATION) return { error: first.error.message, format: "v2" };
  const v1 = await crypto.sealTokenV1(row.refreshToken, row.userId);
  const second = await admin.from("google_connections").upsert({ ...base, refresh_token_enc: v1 });
  return { error: second.error?.message ?? null, format: "v1" };
}

/** Re-seals a stale token with the current key. Best effort: a failure leaves the old, still-readable row. */
async function resealUser(admin: SupabaseClient, crypto: GoogleCrypto, userId: string, token: string): Promise<boolean> {
  const sealed = await crypto.sealToken(token, { kind: "user", userId });
  const { error } = await admin.from("google_connections").update({ refresh_token_enc: sealed }).eq("user_id", userId);
  return !error; // 23514 while 027's CHECK stands: the v1 row stays, which is fine
}

async function resealWorkspace(admin: SupabaseClient, crypto: GoogleCrypto, token: string): Promise<boolean> {
  const sealed = await crypto.sealToken(token, { kind: "workspace" });
  const { error } = await admin.from("google_workspace_link").update({ refresh_token_enc: sealed }).eq("id", true);
  return !error;
}

// ---------------------------------------------------------------- reading tokens

export interface WorkspaceLinkRow {
  google_email: string | null;
  scopes: string[] | null;
  refresh_token_enc: string | null;
  status: string | null;
  connected_at: string | null;
}

/**
 * Stores the company grant: one upsert of 040's singleton row. Everything
 * that follows from it lives in 040's triggers on that row, whoever writes
 * it: a different Google account drops the old calendar id and re-queues
 * every synced event, and (re)connecting kicks the sync worker. connected_at
 * is always renewed, which is what tells the trigger a reconnect happened.
 */
export async function storeWorkspaceGrant(
  admin: SupabaseClient,
  crypto: GoogleCrypto,
  row: { email: string; scopes: string[]; refreshToken: string; connectedBy: string },
): Promise<{ error: string | null }> {
  const { error } = await admin.from("google_workspace_link").upsert({
    id: true,
    status: "active",
    google_email: row.email,
    scopes: row.scopes,
    refresh_token_enc: await crypto.sealToken(row.refreshToken, { kind: "workspace" }),
    connected_by: row.connectedBy,
    connected_at: new Date().toISOString(),
    revoked_at: null,
    revoked_reason: null,
    last_error: null,
  });
  return { error: error ? `${error.code ?? ""} ${error.message}`.trim() : null };
}

/**
 * An admin's Disconnect: the row stays (calendar id and sync history outlive
 * a grant) with status 'revoked' and NO token, so nothing usable is left at
 * rest even when the Google-side revoke is skipped. 040's trigger notifies the
 * admins only for a revoke that still holds a token (Google's doing), so a
 * deliberate Disconnect is quiet; the caller writes its audit_log row.
 */
export async function clearWorkspaceGrant(admin: SupabaseClient): Promise<{ error: string | null }> {
  const { error } = await admin.from("google_workspace_link")
    .update({ status: "revoked", refresh_token_enc: null, revoked_at: new Date().toISOString(), revoked_reason: "disconnected" })
    .eq("id", true);
  return { error: error ? `${error.code ?? ""} ${error.message}`.trim() : null };
}

/**
 * Google refused the company grant: 040's google_workspace_mark_revoked() sets
 * status 'revoked' and tells every active admin once. Falls back to a plain
 * update when the function is missing, so the link never stays 'active' on a
 * dead grant.
 */
export async function markWorkspaceRevoked(admin: SupabaseClient, reason: string): Promise<void> {
  const { error } = await admin.rpc("google_workspace_mark_revoked", { p_reason: reason });
  if (!error) return;
  console.error("google: google_workspace_mark_revoked failed", error.code, error.message);
  await admin.from("google_workspace_link")
    .update({ status: "revoked", revoked_at: new Date().toISOString(), revoked_reason: reason })
    .eq("id", true)
    .eq("status", "active");
}

/**
 * Whether a user may use admin-only actions: role admin AND not deactivated
 * (032). A deactivated admin is banned from signing in, but an access token
 * issued before the ban stays valid for up to an hour; this closes that gap.
 * select("*") so the check still works before 032 adds deactivated_at.
 */
export async function isActiveAdmin(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await admin.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw new Error(`profiles read failed: ${error.message}`);
  const p = data as { role?: string; deactivated_at?: string | null } | null;
  return p?.role === "admin" && !p.deactivated_at;
}

/** The workspace link, or null when there is none OR its table does not exist yet (migration 040). */
export async function readWorkspaceLink(admin: SupabaseClient): Promise<{ row: WorkspaceLinkRow | null; available: boolean }> {
  const { data, error } = await admin
    .from("google_workspace_link")
    .select("google_email, scopes, refresh_token_enc, status, connected_at")
    .eq("id", true)
    .maybeSingle();
  if (error) {
    console.error("google: workspace link unreadable", error.code, error.message);
    return { row: null, available: false };
  }
  return { row: (data as WorkspaceLinkRow | null) ?? null, available: true };
}

async function openOrConfig(crypto: GoogleCrypto, sealed: string, owner: TokenOwner) {
  try {
    return await crypto.openToken(sealed, owner);
  } catch (err) {
    if (err instanceof KeyConfigError) throw new ConfigError(err.message);
    throw err; // TokenUnreadable
  }
}

/** A short-lived access token for one person's personal grant. A dead grant deletes the row. */
export async function accessTokenForUser(
  admin: SupabaseClient,
  crypto: GoogleCrypto,
  getEnv: GetEnv,
  userId: string,
): Promise<string> {
  const { data: row, error } = await admin
    .from("google_connections").select("refresh_token_enc").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`google_connections read failed: ${error.message}`);
  if (!row) throw new ReauthRequired("not connected");

  let opened;
  try {
    opened = await openOrConfig(crypto, row.refresh_token_enc, { kind: "user", userId });
  } catch (err) {
    if (!(err instanceof TokenUnreadable)) throw err;
    await admin.from("google_connections").delete().eq("user_id", userId);
    throw new ReauthRequired("stored token unreadable");
  }

  const { ok, data } = await tokenCall(getEnv, { refresh_token: opened.token, grant_type: "refresh_token" });
  if (!ok || !data.access_token) {
    if (data.error === "invalid_grant") {
      await admin.from("google_connections").delete().eq("user_id", userId);
      throw new ReauthRequired("invalid_grant");
    }
    throw new GoogleError(`refresh failed: ${data.error ?? "unknown"} ${data.error_description ?? ""}`.trim());
  }
  if (opened.stale) await resealUser(admin, crypto, userId, opened.token);
  return data.access_token;
}

/**
 * A short-lived access token for the company account (Team Calendar, C1).
 * A dead grant marks the link revoked (it is never deleted: the calendar id
 * and history stay) and throws ReauthRequired.
 */
export async function accessTokenForWorkspace(admin: SupabaseClient, crypto: GoogleCrypto, getEnv: GetEnv): Promise<string> {
  const { row, available } = await readWorkspaceLink(admin);
  if (!available) throw new ConfigError("google_workspace_link is not available (migration 040)");
  if (!row || row.status !== "active" || !row.refresh_token_enc) throw new ReauthRequired("workspace not connected");

  const markRevoked = (why: string) => markWorkspaceRevoked(admin, why);

  let opened;
  try {
    opened = await openOrConfig(crypto, row.refresh_token_enc, { kind: "workspace" });
  } catch (err) {
    if (!(err instanceof TokenUnreadable)) throw err;
    await markRevoked("stored token unreadable");
    throw new ReauthRequired("workspace token unreadable");
  }
  const { ok, data } = await tokenCall(getEnv, { refresh_token: opened.token, grant_type: "refresh_token" });
  if (!ok || !data.access_token) {
    if (data.error === "invalid_grant") {
      await markRevoked("invalid_grant");
      throw new ReauthRequired("workspace invalid_grant");
    }
    throw new GoogleError(`workspace refresh failed: ${data.error ?? "unknown"}`);
  }
  if (opened.stale) await resealWorkspace(admin, crypto, opened.token);
  return data.access_token;
}

// ---------------------------------------------------------------- offboarding

export interface RevokeResult {
  /** A personal connection existed and its row is gone. */
  removed: boolean;
  /** Google confirmed the revoke. False when skipped (shared account, unreadable token) or Google failed. */
  revokedAtGoogle: boolean;
  /** Why the Google-side revoke was skipped, if it was. */
  skipped?: "shared_with_workspace" | "unreadable" | "no_keys";
}

/**
 * Offboarding hook: removes a person's personal Google grant (row first, so a
 * failure at Google can never leave a usable grant behind), then revokes it
 * at Google unless the company workspace link uses the same Google account
 * (revoking would also kill the Team Calendar's grant). The workspace link
 * itself belongs to the company account, not to the person, and is left alone.
 *
 * Never throws for a missing key or an unreadable token: deactivation must
 * not fail because Google is not set up. A database error does throw.
 */
export async function revokeGoogleForUser(
  admin: SupabaseClient,
  userId: string,
  getEnv: GetEnv = denoEnv,
): Promise<RevokeResult> {
  const { data: row, error } = await admin
    .from("google_connections").select("google_email, refresh_token_enc").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`google_connections read failed: ${error.message}`);
  if (!row) return { removed: false, revokedAtGoogle: false };

  const { error: delError } = await admin.from("google_connections").delete().eq("user_id", userId);
  if (delError) throw new Error(`google_connections delete failed: ${delError.message}`);

  const { row: link } = await readWorkspaceLink(admin);
  if (!mayRevokeAtGoogle(row.google_email, [link?.status === "active" ? link.google_email : null])) {
    return { removed: true, revokedAtGoogle: false, skipped: "shared_with_workspace" };
  }

  let crypto: GoogleCrypto;
  try {
    crypto = GoogleCrypto.fromEnv(getEnv);
  } catch {
    return { removed: true, revokedAtGoogle: false, skipped: "no_keys" };
  }
  let token: string;
  try {
    token = (await crypto.openToken(row.refresh_token_enc, { kind: "user", userId })).token;
  } catch {
    return { removed: true, revokedAtGoogle: false, skipped: "unreadable" };
  }
  return { removed: true, revokedAtGoogle: await revokeAtGoogle(token) };
}

// ---------------------------------------------------------------- key rotation

export interface RotateResult {
  resealed: number;
  current: number;
  failed: number;
  workspace: "resealed" | "current" | "none" | "failed";
}

/**
 * Re-seals every stored token with the current key (GOOGLE_TOKEN_KEY_ID), so
 * an old key can be removed from GOOGLE_TOKEN_KEYS afterwards. Rows that fail
 * (unreadable, or v1 still enforced by 027's CHECK) are counted, not deleted.
 */
export async function resealAll(admin: SupabaseClient, crypto: GoogleCrypto): Promise<RotateResult> {
  const out: RotateResult = { resealed: 0, current: 0, failed: 0, workspace: "none" };
  const { data, error } = await admin.from("google_connections").select("user_id, refresh_token_enc");
  if (error) throw new Error(`google_connections read failed: ${error.message}`);
  for (const r of (data ?? []) as { user_id: string; refresh_token_enc: string }[]) {
    try {
      const opened = await crypto.openToken(r.refresh_token_enc, { kind: "user", userId: r.user_id });
      if (!opened.stale) {
        out.current++;
        continue;
      }
      if (await resealUser(admin, crypto, r.user_id, opened.token)) out.resealed++;
      else out.failed++;
    } catch {
      out.failed++;
    }
  }
  const { row } = await readWorkspaceLink(admin);
  if (row?.refresh_token_enc) {
    try {
      const opened = await crypto.openToken(row.refresh_token_enc, { kind: "workspace" });
      out.workspace = !opened.stale ? "current" : (await resealWorkspace(admin, crypto, opened.token)) ? "resealed" : "failed";
    } catch {
      out.workspace = "failed";
    }
  }
  return out;
}

// ---------------------------------------------------------------- audit

/**
 * One audit_log row (migration 032; written only by the service role and
 * SECURITY DEFINER triggers). Returns false when it could not be written, so
 * a caller that must not act unaudited (the Drive export) can refuse.
 */
export async function audit(
  admin: SupabaseClient,
  entry: { actorId: string | null; action: string; entity: string; entityId?: string | null; detail?: Record<string, unknown> },
): Promise<{ ok: boolean; id: number | null }> {
  const { data, error } = await admin
    .from("audit_log")
    .insert({
      actor_id: entry.actorId,
      action: entry.action,
      entity: entry.entity,
      entity_id: entry.entityId ?? null,
      detail: entry.detail ?? {},
    })
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("google: audit_log write failed", entry.action, error.code, error.message);
    return { ok: false, id: null };
  }
  return { ok: true, id: (data as { id?: number } | null)?.id ?? null };
}
