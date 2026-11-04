// DeskDev Studio — admin-users: the sign-up allow-list (migration 042)
//
// Since 042 the database refuses every auth.users row that GoTrue inserts
// unless the address is on public.signup_allowlist; the entry is used up by
// that insert. This is the one place that writes the entry, so "an admin
// added this person" is the only way an account comes into being.
//
// Kept apart from index.ts so it runs under Node as well:
// supabase/tests/admin-users-allowlist.test.mjs drives it against a database
// with the migrations applied. Only a type is imported, on purpose.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Runs `create` (the GoTrue call) with `email` on the allow-list, and takes
 * the entry off again afterwards whatever happened: on success the guard has
 * already used it up, on failure it would otherwise let that address sign
 * itself up until it expires.
 *
 * A failed write is logged and `create` still runs. This function is not the
 * lock, the database is: with 042 applied GoTrue then answers "Database error
 * saving new user" and nothing is created; before 042 (the function is
 * deployed first) there is no table yet and creating works as it always did.
 */
export async function withSignupAllowed<T>(
  admin: SupabaseClient,
  email: string,
  invitedBy: string,
  create: () => Promise<T>,
): Promise<T> {
  const { data: entry, error } = await admin
    .from("signup_allowlist")
    .insert({ email, invited_by: invitedBy })
    .select("id")
    .single();
  if (error) console.error("[admin-users] create: allow-list write failed", error);

  try {
    return await create();
  } finally {
    if (entry?.id) {
      // Never let the cleanup replace the result (or the error) of `create`:
      // a row left behind expires on its own after ten minutes.
      try {
        const { error: cleanupError } = await admin
          .from("signup_allowlist").delete().eq("id", entry.id);
        if (cleanupError) console.error("[admin-users] create: allow-list cleanup failed", cleanupError);
      } catch (err) {
        console.error("[admin-users] create: allow-list cleanup failed", err);
      }
    }
  }
}
