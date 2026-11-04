import { createClient } from '@supabase/supabase-js'

// Read as literal `process.env.NEXT_PUBLIC_*` so the build can inline them.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

/** True when both NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set. */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

/**
 * Only the password-reset page takes a session out of the URL (the recovery
 * link's #access_token=…). Anywhere else a crafted #access_token=… fragment
 * would sign the visitor into someone else's account without asking — the
 * site's Team login hands over through /auth/callback, which checks first.
 */
export function acceptsSessionFromUrl(url: URL, params: Record<string, string>): boolean {
  if (!url.pathname.endsWith('/reset-password')) return false
  return Boolean(params.access_token || params.error || params.error_description || params.error_code)
}

// Shared client against the public schema. When unconfigured we still create
// a client with placeholder values so imports never throw — the db adapter
// checks isSupabaseConfigured before making any network call.
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: acceptsSessionFromUrl } },
)

