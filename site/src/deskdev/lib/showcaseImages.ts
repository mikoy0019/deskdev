import { supabase, isSupabaseConfigured } from './supabase'
import { remoteGate } from './db'

// Showcase screenshots (037): the public 'showcase' Storage bucket, 5 MB per
// object, image types only, writable with showcase:edit. The browser resizes
// every upload to two webp widths, and keys are content-addressed, so a
// re-upload of the same picture is the same object and every URL can be
// cached for a year. Web only: it needs a canvas.

export const SHOWCASE_BUCKET = 'showcase'
export const SHOWCASE_MAX_BYTES = 5 * 1024 * 1024
export const SHOWCASE_WIDTHS = { large: 1280, small: 640 } as const
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']
const YEAR_SECONDS = '31536000'

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

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Scale `file` down to at most `width` pixels wide and encode it as webp. */
export async function resizeToWebp(file: Blob, width: number, quality = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, width / bitmap.width)
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('This browser cannot resize images.')
    ctx.drawImage(bitmap, 0, 0, w, h)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
    if (!blob) throw new Error('This browser cannot encode webp images.')
    return blob
  } finally {
    bitmap.close()
  }
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the image.'))
    reader.readAsDataURL(blob)
  })
}

export interface ShowcaseUploadResult {
  ok: boolean
  imageKey?: string
  imageKeySmall?: string
  error?: string
}

/** Content-addressed objects: "already exists" means the same bytes are there. */
function isDuplicate(error: { message?: string; statusCode?: string | number } | null): boolean {
  if (!error) return false
  return String(error.statusCode) === '409' || /already exists|duplicate/i.test(error.message ?? '')
}

/**
 * Resize and upload one screenshot. Remote mode stores both widths in the
 * bucket under items/<sha256>-<width>.webp; local mode, with no storage,
 * keeps the small one as a data URL so the demo still shows a picture.
 */
export async function uploadShowcaseImage(file: Blob): Promise<ShowcaseUploadResult> {
  if (!ACCEPTED.includes(file.type)) {
    return { ok: false, error: 'Use a PNG, JPEG, WebP, GIF or AVIF image.' }
  }
  try {
    const gate = await remoteGate()
    if (gate === 'signed-out') return { ok: false, error: 'Your session has ended. Sign in again to upload.' }
    if (gate === 'offline') return { ok: false, error: "You're offline, so the image wasn't uploaded." }
    const small = await resizeToWebp(file, SHOWCASE_WIDTHS.small)
    if (gate === 'local') {
      const url = await toDataUrl(small)
      return { ok: true, imageKey: url, imageKeySmall: url }
    }
    const large = await resizeToWebp(file, SHOWCASE_WIDTHS.large)
    if (large.size > SHOWCASE_MAX_BYTES) return { ok: false, error: 'That image is too large even after resizing (5 MB max).' }
    const hash = await sha256Hex(file)
    const keys = { large: `items/${hash}-${SHOWCASE_WIDTHS.large}.webp`, small: `items/${hash}-${SHOWCASE_WIDTHS.small}.webp` }
    const bucket = supabase.storage.from(SHOWCASE_BUCKET)
    for (const [key, blob] of [[keys.large, large], [keys.small, small]] as const) {
      const { error } = await bucket.upload(key, blob, { contentType: 'image/webp', cacheControl: YEAR_SECONDS, upsert: false })
      if (error && !isDuplicate(error)) return { ok: false, error: error.message }
    }
    return { ok: true, imageKey: keys.large, imageKeySmall: keys.small }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not upload the image.' }
  }
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
