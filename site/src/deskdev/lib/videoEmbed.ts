// Turns an admin-pasted video link into something safe to render.
//
// SOP videos are external links, not uploads, so the URL is attacker-shaped
// input the moment an account with `courses: edit` is compromised. Rendering
// an arbitrary URL in an <iframe> hands that origin a frame on our page, so
// nothing is embedded unless its host is on the allowlist below and the
// scheme is https. Anything else is rejected and offered as a plain link.

export type VideoProvider = 'youtube' | 'vimeo' | 'loom' | 'drive' | 'file'

export interface VideoEmbed {
  provider: VideoProvider
  /** 'iframe' → provider player; 'file' → native <video> element. */
  kind: 'iframe' | 'file'
  /** Fully-qualified https URL, safe to put in src. */
  src: string
  /** Human label for the provider, e.g. "YouTube". */
  label: string
  /**
   * Static poster image, when the provider serves one from a predictable URL.
   * Vimeo and direct files have none (Vimeo needs an oEmbed round-trip), and
   * Loom's CDN path is undocumented — so callers MUST handle onError and fall
   * back to a placeholder rather than trusting this to resolve.
   */
  thumbnail?: string
}

const LABELS: Record<VideoProvider, string> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  loom: 'Loom',
  drive: 'Google Drive',
  file: 'Direct file',
}

const YOUTUBE_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com']
const VIMEO_HOSTS = ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com']
const LOOM_HOSTS = ['loom.com', 'www.loom.com']
const DRIVE_HOSTS = ['drive.google.com']

const FILE_EXT = /\.(mp4|webm|ogg|ogv|mov|m4v)$/i

/** YouTube/Loom ids are opaque slugs; keep the charset tight. */
const SLUG = /^[A-Za-z0-9_-]{6,64}$/
const DIGITS = /^[0-9]{6,20}$/

function parseUrl(raw: string): URL | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  // https only — blocks javascript:, data:, blob: and plain http downgrades.
  if (url.protocol !== 'https:') return null
  return url
}

/** Path segments with empties stripped: "/file/d/x/view" → ["file","d","x","view"]. */
const segments = (url: URL): string[] => url.pathname.split('/').filter(Boolean)

function youtubeId(url: URL): string | null {
  const host = url.hostname.toLowerCase()
  const parts = segments(url)
  if (host === 'youtu.be' || host === 'www.youtu.be') return parts[0] ?? null
  // /watch?v=ID
  if (parts[0] === 'watch') return url.searchParams.get('v')
  // /embed/ID, /shorts/ID, /live/ID, /v/ID
  if (['embed', 'shorts', 'live', 'v'].includes(parts[0] ?? '')) return parts[1] ?? null
  return null
}

/**
 * Parse a pasted link into an embeddable descriptor, or null when the host is
 * not allowlisted / the shape is unrecognised.
 */
export function parseVideoUrl(raw: string): VideoEmbed | null {
  const url = parseUrl(raw)
  if (!url) return null
  const host = url.hostname.toLowerCase()

  if (YOUTUBE_HOSTS.includes(host)) {
    const id = youtubeId(url)
    if (!id || !SLUG.test(id)) return null
    // nocookie host so a viewer who never presses play gets no tracking cookie.
    return {
      provider: 'youtube', kind: 'iframe', label: LABELS.youtube,
      src: `https://www.youtube-nocookie.com/embed/${id}`,
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    }
  }

  if (VIMEO_HOSTS.includes(host)) {
    const parts = segments(url)
    // player.vimeo.com/video/ID — already an embed URL.
    const idx = parts[0] === 'video' ? 1 : 0
    const id = parts[idx]
    if (!id || !DIGITS.test(id)) return null
    // Unlisted videos carry a privacy hash as the next segment (or ?h=).
    const hash = parts[idx + 1] ?? url.searchParams.get('h') ?? ''
    const suffix = hash && SLUG.test(hash) ? `?h=${hash}` : ''
    return { provider: 'vimeo', kind: 'iframe', label: LABELS.vimeo, src: `https://player.vimeo.com/video/${id}${suffix}` }
  }

  if (LOOM_HOSTS.includes(host)) {
    const parts = segments(url)
    // /share/HASH or an already-embed /embed/HASH
    if (parts[0] !== 'share' && parts[0] !== 'embed') return null
    const id = parts[1]
    if (!id || !SLUG.test(id)) return null
    return {
      provider: 'loom', kind: 'iframe', label: LABELS.loom,
      src: `https://www.loom.com/embed/${id}`,
      thumbnail: `https://cdn.loom.com/sessions/thumbnails/${id}-with-play.gif`,
    }
  }

  if (DRIVE_HOSTS.includes(host)) {
    const parts = segments(url)
    // /file/d/ID/view → /file/d/ID/preview
    if (parts[0] !== 'file' || parts[1] !== 'd') return null
    const id = parts[2]
    if (!id || !SLUG.test(id)) return null
    return {
      provider: 'drive', kind: 'iframe', label: LABELS.drive,
      src: `https://drive.google.com/file/d/${id}/preview`,
      thumbnail: `https://drive.google.com/thumbnail?id=${id}&sz=w640`,
    }
  }

  // Any https URL that names a video file plays in a native <video>. No iframe
  // is created, so no third-party origin gets a frame — only media is decoded.
  if (FILE_EXT.test(url.pathname)) {
    return { provider: 'file', kind: 'file', label: LABELS.file, src: url.toString() }
  }

  return null
}

/** True when the link will actually render. Used to validate the paste field. */
export const isEmbeddableVideoUrl = (raw: string): boolean => parseVideoUrl(raw) !== null

/** Providers listed in the UI hint, in the order we want them read. */
export const SUPPORTED_VIDEO_HINT = 'YouTube, Vimeo, Loom, Google Drive, or a direct .mp4/.webm link'
