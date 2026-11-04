// Web-only (not mirrored to mobile). DeskDev for Windows (desktop/ at the repo
// root): a native window around this web app. desktop/build.mjs publishes the
// installer and a small version file into site/public/downloads/, served
// as-is by the Workers asset layer on every host. Settings → Desktop app reads
// the version file to offer the download; the app adds "DeskDevDesktop/x.y.z"
// to its user agent, which is how this side knows it is running inside it.

export const DESKTOP_RELEASE_PATH = '/downloads/deskdev-desktop.json'

export interface DesktopRelease {
  version: string
  /** Root-relative, e.g. /downloads/DeskDev-Setup.exe. */
  url: string
  size: number
  sha256?: string
  /** YYYY-MM-DD */
  released?: string
}

const VERSION = /^\d+\.\d+\.\d+$/

/** The desktop app's version when this page runs inside it, else null. */
export function desktopAppVersion(userAgent: string | null | undefined): string | null {
  const m = /\bDeskDevDesktop\/(\d+\.\d+\.\d+)\b/.exec(userAgent ?? '')
  return m ? m[1] : null
}

export function isWindows(userAgent: string | null | undefined): boolean {
  return /\bWindows NT\b/.test(userAgent ?? '')
}

/** Negative when a is older than b, positive when newer, 0 when equal. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d
  }
  return 0
}

/** The version file, checked: anything malformed reads as "no release". */
export function parseRelease(raw: unknown): DesktopRelease | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.version !== 'string' || !VERSION.test(r.version)) return null
  // Same host only: the file sits next to the installer it names.
  if (typeof r.url !== 'string' || !/^\/downloads\/[A-Za-z0-9._-]+\.exe$/.test(r.url)) return null
  if (typeof r.size !== 'number' || !Number.isFinite(r.size) || r.size <= 0) return null
  return {
    version: r.version,
    url: r.url,
    size: r.size,
    sha256: typeof r.sha256 === 'string' && /^[0-9a-f]{64}$/.test(r.sha256) ? r.sha256 : undefined,
    released: typeof r.released === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.released) ? r.released : undefined,
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Fetches the published release. Null when none is published here (or the network failed). */
export async function fetchDesktopRelease(signal?: AbortSignal): Promise<DesktopRelease | null> {
  try {
    const res = await fetch(DESKTOP_RELEASE_PATH, { cache: 'no-cache', signal })
    if (!res.ok) return null
    return parseRelease(await res.json())
  } catch {
    return null
  }
}
