import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from './supabase'
import type { PermFeature, PermLevel, Role } from './types'

// Typed wrapper around the `admin-users` edge function — the only way to
// create or delete workspace users in remote mode. The profiles table has no
// INSERT/DELETE policies (rows are born from the auth signup trigger and die
// with their auth.users row via ON DELETE CASCADE), so the whole user
// lifecycle goes through the service-role function in
// supabase/functions/admin-users.
//
// Contract (POST, caller must be a signed-in admin):
//   { action: 'create', email, password, full_name, role?, permissions?, phone?, title?, avatar_color? }
//   { action: 'update', user_id, email?, password?, full_name?, role?, permissions?, phone?, title?, avatar_color? }
//   { action: 'delete', user_id }
//   { action: 'deactivate' | 'reactivate', user_id }
// → { ok: true, user_id } on success, { error } with a 4xx/5xx status otherwise.

/**
 * Remote mode — same signal the store's login()/logout() switch on: when the
 * Supabase env vars are set, auth (and therefore user management) lives in
 * Supabase. db.ts additionally checks for a session per call; here a missing
 * session simply surfaces as a 401 error from the function.
 */
export function isRemoteMode(): boolean {
  return isSupabaseConfigured
}

export interface AdminUsersResult {
  ok: boolean
  /** Auth user id of the created/updated/deleted user — set on success. */
  userId?: string
  error?: string
}

export interface CreateUserInput {
  email: string
  password: string
  fullName: string
  role?: Role
  permissions?: Partial<Record<PermFeature, PermLevel>>
  phone?: string
  title?: string
  avatarColor?: string
}

/** For clearable fields, `null` clears remotely; `undefined` leaves untouched. */
export interface UpdateUserInput {
  email?: string
  password?: string
  fullName?: string
  role?: Role
  permissions?: Partial<Record<PermFeature, PermLevel>>
  phone?: string | null
  title?: string | null
  avatarColor?: string | null
}

interface FunctionResponse {
  ok?: boolean
  user_id?: string
  error?: string
}

async function invoke(payload: Record<string, unknown>): Promise<AdminUsersResult> {
  if (!isRemoteMode()) {
    return { ok: false, error: 'Remote mode is not configured' }
  }
  try {
    const { data, error } = await supabase.functions.invoke<FunctionResponse>(
      'admin-users',
      { body: payload },
    )
    if (error) {
      let message = error.message || 'Request failed'
      // Non-2xx responses carry the function's { error } body on the context.
      if (error instanceof FunctionsHttpError) {
        try {
          const body = (await error.context.json()) as FunctionResponse
          if (body?.error) message = body.error
        } catch {
          // keep the generic message
        }
      }
      return { ok: false, error: message }
    }
    if (!data?.ok) return { ok: false, error: data?.error ?? 'Request failed' }
    return { ok: true, userId: data.user_id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Request failed' }
  }
}

/** Create an auth user + profile. Resolves with the server-issued user id. */
export function createUser(input: CreateUserInput): Promise<AdminUsersResult> {
  return invoke({
    action: 'create',
    email: input.email,
    password: input.password,
    full_name: input.fullName,
    role: input.role,
    permissions: input.permissions,
    phone: input.phone,
    title: input.title,
    avatar_color: input.avatarColor,
  })
}

/** Patch the auth record (email/password/metadata) + the profiles row. */
export function updateUser(userId: string, patch: UpdateUserInput): Promise<AdminUsersResult> {
  return invoke({
    action: 'update',
    user_id: userId,
    email: patch.email,
    password: patch.password,
    full_name: patch.fullName,
    role: patch.role,
    permissions: patch.permissions,
    phone: patch.phone,
    title: patch.title,
    avatar_color: patch.avatarColor,
  })
}

/** Delete the auth user — the profiles row follows via ON DELETE CASCADE. */
export function deleteUser(userId: string): Promise<AdminUsersResult> {
  return invoke({ action: 'delete', user_id: userId })
}

/**
 * Offboard without deleting: the function strips role and permissions, bans
 * sign-in and stamps profiles.deactivated_at (032), so history keeps the name.
 */
export function deactivateUser(userId: string): Promise<AdminUsersResult> {
  return invoke({ action: 'deactivate', user_id: userId })
}

/** Lift the ban. They come back as a member with no permissions; grant access with updateUser. */
export function reactivateUser(userId: string): Promise<AdminUsersResult> {
  return invoke({ action: 'reactivate', user_id: userId })
}
