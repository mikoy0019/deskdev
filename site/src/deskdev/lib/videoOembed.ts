// Reads a video's real title and poster from the provider's oEmbed endpoint.
//
// Called once, when an admin saves an SOP link — never on render. The result
// is stored on the topic so a grid of cards costs zero network requests.
//
// Everything here is best-effort: oEmbed can fail on a private video, a rate
// limit, a CORS hiccup, or an offline client. Every failure path returns null
// and the caller falls back to a typed title and the guessed poster.

import { parseVideoUrl } from './videoEmbed'

export interface VideoMeta {
  /** The video's own title, e.g. "Elementor Basics in 15 Minutes". */
  title?: string
  /** Poster URL straight from the provider — authoritative, unlike our guess. */
  thumbnail?: string
}

/** oEmbed endpoint per provider. Drive and direct files publish none. */
function endpointFor(url: string): string | null {
  const parsed = parseVideoUrl(url)
  if (!parsed) return null
  const target = encodeURIComponent(url.trim())
  switch (parsed.provider) {
    case 'youtube': return `https://www.youtube.com/oembed?url=${target}&format=json`
    case 'loom': return `https://www.loom.com/v1/oembed?url=${target}`
    case 'vimeo': return `https://vimeo.com/api/oembed.json?url=${target}`
    default: return null
  }
}

/**
 * The provider controls this response, so treat the poster URL as untrusted:
 * only an https URL is allowed to reach an <img src>.
 */
function safeThumbnail(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  try {
    return new URL(value).protocol === 'https:' ? value : undefined
  } catch {
    return undefined
  }
}

function safeTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  // Collapse whitespace and cap the length — a title becomes a row in the UI,
  // and providers occasionally return very long strings.
  const trimmed = value.replace(/\s+/g, ' ').trim()
  return trimmed ? trimmed.slice(0, 200) : undefined
}

/**
 * Fetch title + poster for a video link. Resolves to null when the provider
 * has no oEmbed endpoint, the request fails, or the response is unusable —
 * callers must handle null rather than treating it as an error.
 */
export async function fetchVideoMeta(
  url: string,
  signal?: AbortSignal,
): Promise<VideoMeta | null> {
  const endpoint = endpointFor(url)
  if (!endpoint) return null
  try {
    const res = await fetch(endpoint, { signal })
    if (!res.ok) return null
    const json: unknown = await res.json()
    if (!json || typeof json !== 'object') return null
    const body = json as Record<string, unknown>
    const meta: VideoMeta = {
      title: safeTitle(body.title),
      thumbnail: safeThumbnail(body.thumbnail_url),
    }
    return meta.title || meta.thumbnail ? meta : null
  } catch {
    // Aborted, offline, CORS-blocked, or malformed JSON — all non-fatal.
    return null
  }
}

/** True when a string is really just a pasted URL, not a human title. */
export function looksLikeUrl(value: string): boolean {
  const v = value.trim()
  if (!v || /\s/.test(v)) return false
  return /^https?:\/\//i.test(v)
}
