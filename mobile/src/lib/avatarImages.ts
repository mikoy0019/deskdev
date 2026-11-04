import { isSupabaseConfigured, supabase } from '@/lib/supabase'

// Profile and client pictures (052), shown on the phone. Admins set them in
// the web app (site/src/deskdev/lib/avatarImages.ts crops and uploads); the
// phone only builds the public URL of the 'avatars' bucket key.

const AVATAR_BUCKET = 'avatars'

/** The URL to show for a stored picture key, or undefined for none. */
export function avatarImageUrl(key: string | undefined | null): string | undefined {
  if (!key) return undefined
  if (/^(https?:|data:|blob:)/i.test(key) || !isSupabaseConfigured) return key
  return supabase.storage.from(AVATAR_BUCKET).getPublicUrl(key).data.publicUrl
}
