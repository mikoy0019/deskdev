// DeskDev Studio — admin-users Edge Function
// Single endpoint for admin-managed user lifecycle:
//   POST { action: 'create' | 'update' | 'delete' | 'deactivate' | 'reactivate', ...payload }
//
// Auth flow:
//   1. Verify caller JWT (anon client + Authorization header)
//   2. Verify caller's profile role = 'admin' and not deactivated (service-role client)
//   3. Perform auth.admin operation + patch public.profiles
//
// The service-role key never leaves this function.
//
// Audit (migration 032): every PostgREST call from here carries the verified
// admin's id in `x-deskdev-actor`, which public.audit_actor() believes only
// for the service role, so the database's audit triggers name the admin.
// What happens inside GoTrue (create, ban, password, delete) never passes
// those triggers with an actor, so it is logged here through
// write_audit_log() as `auth.*` rows. Requires 032 to be applied first:
// this file reads and writes profiles.deactivated_at.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, isForeignOrigin } from "./cors.ts";
import { revokeGoogleForUser } from "../_shared/google_grants.ts";
import { withSignupAllowed } from "./signup_allowlist.ts";

const ROLES = ["admin", "member"] as const;
type Role = (typeof ROLES)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "Banned" for ~100 years: GoTrue's way of switching an account off. */
const DEACTIVATED_BAN = "876000h";

const LAST_ADMIN =
  "DeskDev needs at least one admin. Make someone else an admin first.";
const HAS_HISTORY =
  "This person can't be deleted because DeskDev still has records linked to them " +
  "(tasks, time entries, CRM rows, events, vault items...). Deactivate them instead: " +
  "it blocks sign-in and keeps their history.";
const VAULT_OWNER_ACCOUNT =
  "This is the vault owner's account: vault reset approvals go to its address. " +
  "Only its owner can change its email or password, and it can't be deleted here. " +
  "Hand the vault approval address to someone else from inside the Vault first.";
const VAULT_OWNER_ADDRESS =
  "That address approves vault resets, so it can't be given to another account.";
const DEACTIVATED_TARGET =
  "This person is deactivated. Reactivate them first, then give them access.";

const sameEmail = (a: unknown, b: unknown): boolean =>
  typeof a === "string" && typeof b === "string" && a.trim() !== "" &&
  a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The address that approves vault resets (vault_settings, 022/030). Whoever
 * signs in with it can hand the vault over (vault_settings_owner_update
 * matches auth.email()), so no admin may move it onto an account they
 * control, reset that account's password, or delete and recreate it.
 * Errors throw: the caller answers 500 rather than skip the check.
 */
async function vaultOwnerEmail(admin: SupabaseClient): Promise<string | null> {
  const { data, error } = await admin
    .from("vault_settings").select("owner_email").eq("singleton", true).limit(1).maybeSingle();
  if (error) throw error;
  const owner = (data as { owner_email?: string | null } | null)?.owner_email;
  return owner && owner.trim() ? owner : null;
}

/** The sign-in email of `userId` (null when there is no such user); throws on other errors. */
async function authEmailOf(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error && error.status === 404) return null;
  if (error) throw error;
  return data.user?.email ?? null;
}

interface CreatePayload {
  action: "create";
  email: string;
  password: string;
  full_name: string;
  role?: Role;
  permissions?: Record<string, string>;
  phone?: string;
  title?: string;
  avatar_color?: string;
}

interface UpdatePayload {
  action: "update";
  user_id: string;
  email?: string;
  password?: string;
  full_name?: string;
  role?: Role;
  permissions?: Record<string, string>;
  phone?: string;
  title?: string;
  avatar_color?: string;
}

interface TargetPayload {
  action: "delete" | "deactivate" | "reactivate";
  user_id: string;
}

type Payload = CreatePayload | UpdatePayload | TargetPayload;

/**
 * GoTrue's 4xx messages ("already registered", "Password should be at least 6
 * characters") tell the admin what to fix, so they go back as-is. Anything else
 * (5xx, database errors) is logged here and answered with `fallback`.
 */
function authMessage(error: { message?: string; status?: number }, fallback: string): string {
  const status = error.status ?? 500;
  const message = error.message ?? "";
  if (status >= 400 && status < 500 && message && !/database error/i.test(message)) {
    return message;
  }
  console.error("[admin-users]", fallback, error);
  return fallback;
}

/**
 * Would taking admin away from `userId` (demote, deactivate, delete) leave
 * DeskDev with no active admin at all? Count-then-act, so two admins demoting
 * each other at the same instant can still race past it; 032's
 * guard_last_admin trigger is the hard backstop for that.
 */
async function wouldRemoveLastAdmin(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data: target, error } = await admin
    .from("profiles").select("role, deactivated_at").eq("id", userId).maybeSingle();
  if (error) throw error;
  if (target?.role !== "admin" || target?.deactivated_at) return false;
  const { count, error: countError } = await admin
    .from("profiles").select("id", { count: "exact", head: true })
    .eq("role", "admin").is("deactivated_at", null);
  if (countError) throw countError;
  return (count ?? 0) <= 1;
}

/**
 * Offboarding: forget the person's personal Google grant and revoke it at
 * Google. Never blocks the admin action (missing keys or an unreadable token
 * only skip the Google-side revoke), so failures are logged, not returned.
 */
async function dropGoogleGrant(admin: SupabaseClient, userId: string): Promise<void> {
  try {
    await revokeGoogleForUser(admin, userId);
  } catch (err) {
    console.error("[admin-users] google revoke failed", err);
  }
}

/** profiles.deactivated_at of `userId`; null when active or missing. Throws on errors. */
async function deactivatedAt(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("profiles").select("deactivated_at").eq("id", userId).maybeSingle();
  if (error) throw error;
  return (data as { deactivated_at?: string | null } | null)?.deactivated_at ?? null;
}

/**
 * One audit_log row for something done inside GoTrue (see the header). Never
 * fails the action it records: the change already happened, and refusing to
 * report success would only make the admin retry it.
 */
async function audit(
  admin: SupabaseClient,
  actorId: string,
  action: string,
  userId: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await admin.rpc("write_audit_log", {
    p_action: action,
    p_entity: "profile",
    p_entity_id: userId,
    p_detail: detail,
    p_actor: actorId,
  });
  if (error) console.error("[admin-users] audit write failed", action, error);
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req);
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (isForeignOrigin(req)) return json({ error: "Origin not allowed" }, 403);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  try {
    // 1. Verify caller JWT
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Missing Authorization header" }, 401);

    const anonClient = createClient(supabaseUrl, anonKey);
    const {
      data: { user: caller },
      error: authError,
    } = await anonClient.auth.getUser(token);
    if (authError || !caller) return json({ error: "Invalid token" }, 401);

    // 2. Verify caller is an active admin (service-role client bypasses RLS).
    // The actor header comes from the verified token, never from the body.
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { "x-deskdev-actor": caller.id } },
    });

    const { data: callerProfile, error: profileError } = await admin
      .from("profiles")
      .select("role, deactivated_at")
      .eq("id", caller.id)
      .single();
    if (profileError || callerProfile?.role !== "admin" || callerProfile?.deactivated_at) {
      return json({ error: "Admin access required" }, 403);
    }

    // 3. Handle action
    let payload: Payload;
    try {
      payload = (await req.json()) as Payload;
    } catch {
      return json({ error: "Request body must be JSON" }, 400);
    }
    if (!payload || typeof payload !== "object") {
      return json({ error: "Request body must be a JSON object" }, 400);
    }

    switch (payload.action) {
      case "create": {
        const { email, password, full_name } = payload;
        if (!email || !password || !full_name) {
          return json(
            { error: "email, password and full_name are required" },
            400,
          );
        }
        // An account created with the owner's address would sign in with a
        // password this admin chose.
        if (sameEmail(email, await vaultOwnerEmail(admin))) {
          return json({ error: VAULT_OWNER_ADDRESS }, 409);
        }
        const role = payload.role === "admin" ? "admin" : "member";
        const permissions = payload.permissions ?? {};

        // 042's guard refuses any account whose address is not on the
        // allow-list at the moment GoTrue inserts it.
        const { data, error } = await withSignupAllowed(admin, email, caller.id, () =>
          admin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: {
              full_name,
              role,
              permissions,
              phone: payload.phone ?? null,
              title: payload.title ?? null,
            },
          }));
        if (error) {
          return json({ error: authMessage(error, "Could not create the user") }, 400);
        }

        // handle_new_user trigger already created the profile; patch extras
        // (also acts as a safety net if metadata parsing changes).
        const { error: patchError } = await admin
          .from("profiles")
          .update({
            email,
            full_name,
            role,
            permissions,
            phone: payload.phone ?? null,
            title: payload.title ?? null,
            avatar_color: payload.avatar_color ?? null,
          })
          .eq("id", data.user.id);
        if (patchError) {
          console.error("[admin-users] create: profile patch failed", patchError);
          return json({ error: "The user was created, but saving their profile failed" }, 500);
        }

        await audit(admin, caller.id, "auth.user_created", data.user.id, { email, full_name, role });
        return json({ ok: true, user_id: data.user.id });
      }

      case "update": {
        const { user_id } = payload;
        if (typeof user_id !== "string" || !UUID.test(user_id)) {
          return json({ error: "user_id must be a user's id" }, 400);
        }

        // Validate everything before the first write, so a rejected request
        // changes nothing (auth and profile can't drift apart).
        if (payload.role !== undefined && !ROLES.includes(payload.role)) {
          return json({ error: "role must be 'admin' or 'member'" }, 400);
        }
        let email: string | undefined;
        if (payload.email !== undefined) {
          email = typeof payload.email === "string" ? payload.email.trim() : "";
          if (!email) return json({ error: "email can't be empty" }, 400);
        }
        if (payload.role === "member" && await wouldRemoveLastAdmin(admin, user_id)) {
          return json({ error: LAST_ADMIN }, 409);
        }
        // Access granted to a deactivated account would do nothing (RLS
        // ignores it) and would come back silently on reactivation.
        if (
          (payload.role === "admin" ||
            (payload.permissions !== undefined && Object.keys(payload.permissions ?? {}).length > 0)) &&
          await deactivatedAt(admin, user_id)
        ) {
          return json({ error: DEACTIVATED_TARGET }, 409);
        }
        // Sign-in details touch the vault owner check (see vaultOwnerEmail).
        if (email !== undefined || payload.password) {
          const owner = await vaultOwnerEmail(admin);
          if (owner) {
            const current = await authEmailOf(admin, user_id);
            const emailChanges = email !== undefined && !sameEmail(email, current);
            if (sameEmail(current, owner) && user_id !== caller.id && (emailChanges || payload.password)) {
              return json({ error: VAULT_OWNER_ACCOUNT }, 403);
            }
            if (emailChanges && sameEmail(email, owner)) {
              return json({ error: VAULT_OWNER_ADDRESS }, 409);
            }
          }
        }

        // Update auth record when email/password/metadata change
        const authUpdates: Record<string, unknown> = {};
        if (email !== undefined) authUpdates.email = email;
        if (payload.password) authUpdates.password = payload.password;

        const metaUpdates: Record<string, unknown> = {};
        if (payload.full_name !== undefined) metaUpdates.full_name = payload.full_name;
        if (payload.role !== undefined) metaUpdates.role = payload.role;
        if (payload.permissions !== undefined) metaUpdates.permissions = payload.permissions;
        if (payload.phone !== undefined) metaUpdates.phone = payload.phone;
        if (payload.title !== undefined) metaUpdates.title = payload.title;
        if (Object.keys(metaUpdates).length > 0) {
          authUpdates.user_metadata = metaUpdates;
        }

        // What to put back if the profile write fails after the auth write
        // succeeded (a password change can't be undone, and doesn't need to be:
        // profiles has no password).
        let restore: Record<string, unknown> | null = null;
        if (email !== undefined || authUpdates.user_metadata) {
          const { data: before } = await admin.auth.admin.getUserById(user_id);
          if (before?.user) {
            restore = {};
            if (email !== undefined && before.user.email) restore.email = before.user.email;
            if (authUpdates.user_metadata) {
              const prev = before.user.user_metadata ?? {};
              restore.user_metadata = Object.fromEntries(
                Object.keys(metaUpdates).map((k) => [k, prev[k] ?? null]),
              );
            }
          }
        }

        if (Object.keys(authUpdates).length > 0) {
          const { error } = await admin.auth.admin.updateUserById(
            user_id,
            authUpdates,
          );
          if (error) {
            return json({ error: authMessage(error, "Could not update the user's sign-in details") }, 400);
          }
        }

        // Patch profiles row
        const profileUpdates: Record<string, unknown> = {};
        if (email !== undefined) profileUpdates.email = email;
        if (payload.full_name !== undefined) profileUpdates.full_name = payload.full_name;
        if (payload.role !== undefined) profileUpdates.role = payload.role;
        if (payload.permissions !== undefined) profileUpdates.permissions = payload.permissions;
        if (payload.phone !== undefined) profileUpdates.phone = payload.phone;
        if (payload.title !== undefined) profileUpdates.title = payload.title;
        if (payload.avatar_color !== undefined) profileUpdates.avatar_color = payload.avatar_color;

        if (Object.keys(profileUpdates).length > 0) {
          const { error } = await admin
            .from("profiles")
            .update(profileUpdates)
            .eq("id", user_id);
          if (error) {
            console.error("[admin-users] update: profile write failed", error);
            if (restore && Object.keys(restore).length > 0) {
              const { error: undoError } = await admin.auth.admin.updateUserById(user_id, restore);
              if (undoError) console.error("[admin-users] update: auth rollback failed", undoError);
            }
            return json({ error: "Could not save the profile changes" }, 400);
          }
        }

        // Role, permission and email changes are logged by 032's trigger on
        // profiles; a password set by an admin only exists in GoTrue.
        if (payload.password) {
          await audit(admin, caller.id, "auth.password_set", user_id, { self: user_id === caller.id });
        }
        return json({ ok: true, user_id });
      }

      case "delete": {
        const { user_id } = payload;
        if (typeof user_id !== "string" || !UUID.test(user_id)) {
          return json({ error: "user_id must be a user's id" }, 400);
        }
        if (user_id === caller.id) {
          return json({ error: "Cannot delete your own account" }, 400);
        }
        if (await wouldRemoveLastAdmin(admin, user_id)) {
          return json({ error: LAST_ADMIN }, 409);
        }
        // Deleting the owner frees the address for an account this admin creates.
        {
          const owner = await vaultOwnerEmail(admin);
          if (owner && sameEmail(await authEmailOf(admin, user_id), owner)) {
            return json({ error: VAULT_OWNER_ACCOUNT }, 403);
          }
        }

        const { data: gone } = await admin
          .from("profiles").select("email, full_name, role").eq("id", user_id).maybeSingle();

        // Before the auth user goes: google_connections cascades from
        // auth.users, and the sealed token is needed to revoke at Google.
        await dropGoogleGrant(admin, user_id);

        const { error } = await admin.auth.admin.deleteUser(user_id);
        if (error) {
          // GoTrue reports any database failure as "Database error deleting
          // user". Since 032 every foreign key to profiles is ON DELETE SET
          // NULL, so this should not happen; if it does, a newer table points
          // at the profile without that rule.
          if (/database error/i.test(error.message ?? "")) {
            console.error("[admin-users] delete blocked by linked records", error);
            return json({ error: HAS_HISTORY, code: "user_has_history" }, 409);
          }
          return json({ error: authMessage(error, "Could not delete the user") }, 400);
        }
        // profiles row is removed by ON DELETE CASCADE from auth.users; 032's
        // trigger logs 'profile.deleted' without an actor (GoTrue has none),
        // so this row records who did it.
        await audit(admin, caller.id, "auth.user_deleted", user_id, {
          email: gone?.email ?? null,
          full_name: gone?.full_name ?? null,
          role: gone?.role ?? null,
        });
        return json({ ok: true, user_id });
      }

      case "deactivate": {
        // Offboarding that keeps history: drop their access in DeskDev at once
        // (RLS reads profiles on every request, and since 032 is_admin() and
        // has_perm() refuse a deactivated profile), stop their pushes, then ban
        // the auth account so no new session can start. An access token they
        // already hold keeps working until it expires (about an hour), with
        // no rights. The database stamps deactivated_at / deactivated_by and
        // writes 'profile.deactivated' to the audit log.
        const { user_id } = payload;
        if (typeof user_id !== "string" || !UUID.test(user_id)) {
          return json({ error: "user_id must be a user's id" }, 400);
        }
        if (user_id === caller.id) {
          return json({ error: "Cannot deactivate your own account" }, 400);
        }
        if (await wouldRemoveLastAdmin(admin, user_id)) {
          return json({ error: LAST_ADMIN }, 409);
        }

        const { error: demoteError } = await admin
          .from("profiles")
          .update({
            role: "member",
            permissions: {},
            deactivated_at: new Date().toISOString(),
            deactivated_by: caller.id,
          })
          .eq("id", user_id);
        if (demoteError) {
          console.error("[admin-users] deactivate: profile write failed", demoteError);
          return json({ error: "Could not remove the user's access" }, 400);
        }

        // 032's trigger already deletes them on deactivation; this covers a
        // retry and a database where that trigger is missing.
        const { error: pushError } = await admin
          .from("push_subscriptions").delete().eq("user_id", user_id);
        if (pushError) console.error("[admin-users] deactivate: push cleanup failed", pushError);

        await dropGoogleGrant(admin, user_id);

        const { error } = await admin.auth.admin.updateUserById(user_id, {
          ban_duration: DEACTIVATED_BAN,
          user_metadata: { role: "member", permissions: {} },
        });
        if (error) {
          // Access is already gone; only the sign-in block failed. Running
          // deactivate again is safe (the first stamp stands).
          return json({ error: authMessage(error, "Could not block the user's sign-in") }, 400);
        }
        await audit(admin, caller.id, "auth.sign_in_blocked", user_id);
        return json({ ok: true, user_id });
      }

      case "reactivate": {
        // Lets them sign in again as a member with no permissions; an admin
        // then grants access through update. Lift the ban first: if that
        // fails nothing has changed. If clearing the profile then fails, the
        // ban goes back on so the two never disagree.
        const { user_id } = payload;
        if (typeof user_id !== "string" || !UUID.test(user_id)) {
          return json({ error: "user_id must be a user's id" }, 400);
        }
        const { error } = await admin.auth.admin.updateUserById(user_id, { ban_duration: "none" });
        if (error) {
          return json({ error: authMessage(error, "Could not reactivate the user") }, 400);
        }
        const { error: profileError } = await admin
          .from("profiles")
          .update({ deactivated_at: null, deactivated_by: null })
          .eq("id", user_id);
        if (profileError) {
          console.error("[admin-users] reactivate: profile write failed", profileError);
          const { error: undoError } = await admin.auth.admin.updateUserById(user_id, {
            ban_duration: DEACTIVATED_BAN,
          });
          if (undoError) console.error("[admin-users] reactivate: re-ban failed", undoError);
          return json({ error: "Could not reactivate the user" }, 400);
        }
        await audit(admin, caller.id, "auth.sign_in_restored", user_id);
        return json({ ok: true, user_id });
      }

      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (err) {
    console.error("[admin-users] unexpected error", err);
    return json({ error: "Unexpected error" }, 500);
  }
});
