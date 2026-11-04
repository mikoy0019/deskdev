import { supabase, isSupabaseConfigured } from './supabase'
import { remoteGate } from './db'

// Profile and client pictures (052): the public 'avatars' Storage bucket,
// writable by admins only, keys under profiles/<id>/ and clients/<id>/. The
// browser crops every upload to a centred square and encodes a 256 px WebP
// (a few KB), so the same small file serves every avatar size, retina too.
// Each upload gets a fresh random name, so a CDN never serves the old face.
// Web only: it needs a canvas. The phone app shows pictures, it doesn't set them.

export const AVATAR_BUCKET = 'avatars'
export const AVATAR_SIZE = 256
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']
/** Before resizing: a phone photo is fine, a 40 MB scan is not. */
const MAX_INPUT_BYTES = 15 * 1024 * 1024
const YEAR_SECONDS = '31536000'

export type AvatarOwner = { kind: 'profiles' | 'clients'; id: string }

/** A key that is already a URL (local-mode data URLs, absolute or site paths). */
function isDirectUrl(key: string): boolean {
  return /^(https?:|data:|blob:|\/)/i.test(key)
}

/** The URL to show for a stored picture key, or undefined for none. */
export function avatarImageUrl(key: string | undefined | null): string | undefined {
  if (!key) return undefined
  if (isDirectUrl(key) || !isSupabaseConfigured) return key
  return supabase.storage.from(AVATAR_BUCKET).getPublicUrl(key).data.publicUrl
}

/** Centre-crop to a square and encode `size` px WebP. */
export async function squareWebp(file: Blob, size = AVATAR_SIZE, quality = 0.86): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    const side = Math.min(bitmap.width, bitmap.height)
    const sx = Math.round((bitmap.width - side) / 2)
    const sy = Math.round((bitmap.height - side) / 2)
    const out = Math.min(size, side)
    const canvas = document.createElement('canvas')
    canvas.width = out
    canvas.height = out
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('This browser cannot resize images.')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, out, out)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
    if (!blob) throw new Error('This browser cannot encode WebP images.')
    return blob
  } finally {
    bitmap.close()
  }
}

/** 16 random URL-safe characters for the object name. */
function randomName(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  let raw = ''
  for (const b of bytes) raw += String.fromCharCode(b)
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** The object key for a new picture of `owner` (matches 052's CHECKs and storage policy). */
export function avatarKeyFor(owner: AvatarOwner, name: string = randomName()): string {
  return `${owner.kind}/${owner.id}/${name}.webp`
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the image.'))
    reader.readAsDataURL(blob)
  })
}

export type AvatarUploadResult = { ok: true; key: string } | { ok: false; error: string }

/**
 * Crop, resize and store one picture. Remote mode uploads it to the bucket;
 * local mode keeps it as a data URL so the demo shows it too. The caller then
 * saves the key on the profile or client (store.setPicture).
 */
export async function uploadAvatar(owner: AvatarOwner, file: Blob): Promise<AvatarUploadResult> {
  if (!ACCEPTED.includes(file.type)) return { ok: false, error: 'Use a PNG, JPEG, WebP, GIF or AVIF image.' }
  if (file.size > MAX_INPUT_BYTES) return { ok: false, error: 'That image is over 15 MB. Pick a smaller one.' }
  try {
    const gate = await remoteGate()
    if (gate === 'signed-out') return { ok: false, error: 'Your session has ended. Sign in again to upload.' }
    if (gate === 'offline') return { ok: false, error: "You're offline, so the picture wasn't uploaded." }
    if (gate === 'account-changed') return { ok: false, error: 'A different account is signed in on this browser now. Reload this page.' }
    const blob = await squareWebp(file)
    if (gate === 'local') return { ok: true, key: await toDataUrl(blob) }
    const key = avatarKeyFor(owner)
    const { error } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(key, blob, { contentType: 'image/webp', cacheControl: YEAR_SECONDS, upsert: false })
    if (error) {
      return {
        ok: false,
        error: /bucket not found/i.test(error.message)
          ? 'Pictures are not set up on this workspace yet (migration 052).'
          : /row-level security|unauthori[sz]ed|403/i.test(error.message)
            ? 'Only admins can change pictures.'
            : error.message,
      }
    }
    return { ok: true, key }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not upload the picture.' }
  }
}

/** Delete a replaced or removed picture. Keys that are URLs aren't ours. Never throws. */
export async function removeAvatarObject(key: string | undefined | null): Promise<void> {
  if (!key || isDirectUrl(key)) return
  try {
    if ((await remoteGate()) !== 'ok') return
    const { error } = await supabase.storage.from(AVATAR_BUCKET).remove([key])
    if (error) console.warn('[avatars] delete failed:', error.message)
  } catch (err) {
    console.warn('[avatars] delete failed:', err)
  }
}
