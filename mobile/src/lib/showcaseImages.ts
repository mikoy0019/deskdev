import { supabase, isSupabaseConfigured } from './supabase'
import { remoteGate } from './db'

// Showcase screenshots (037) — the mobile side, same exports as
// site/src/deskdev/lib/showcaseImages.ts (the shared store imports it by
// path). Showing a screenshot and deleting stored ones work the same;
// uploading needs the web app for now: it resizes to two webp widths with a
// canvas, which React Native doesn't have.

export const SHOWCASE_BUCKET = 'showcase'
export const SHOWCASE_MAX_BYTES = 5 * 1024 * 1024
export const SHOWCASE_WIDTHS = { large: 1280, small: 640 } as const

/** A key that is already a URL (legacy entries, local-mode data URLs, site paths). */
function isDirectUrl(key: string): boolean {
  return /^(https?:|data:|blob:|\/)/i.test(key)
}

/** The public URL for a stored image key, or the key itself when it already is one. */
export function showcaseImageUrl(key: string | undefined): string | undefined {
  if (!key) return undefined
  if (isDirectUrl(key) || !isSupabaseConfigured) return key
  return supabase.storage.from(SHOWCASE_BUCKET).getPublicUrl(key).data.publicUrl
}

export interface ShowcaseUploadResult {
  ok: boolean
  imageKey?: string
  imageKeySmall?: string
  error?: string
}

/** Screenshots are uploaded from the web app (it resizes them first). */
export async function uploadShowcaseImage(_file: Blob): Promise<ShowcaseUploadResult> {
  void _file
  return { ok: false, error: 'Upload screenshots from the DeskDev web app — it resizes them for the site.' }
}

/**
 * Delete stored objects (a takedown, or a replaced screenshot). Keys that are
 * URLs aren't ours to delete and are skipped. Never throws.
 */
export async function removeShowcaseImages(keys: (string | undefined)[]): Promise<void> {
  const stored = [...new Set(keys.filter((k): k is string => Boolean(k) && !isDirectUrl(k as string)))]
  if (stored.length === 0) return
  try {
    if ((await remoteGate()) !== 'ok') return
    const { error } = await supabase.storage.from(SHOWCASE_BUCKET).remove(stored)
    if (error) console.warn('[showcase] image delete failed:', error.message)
  } catch (err) {
    console.warn('[showcase] image delete failed:', err)
  }
}
