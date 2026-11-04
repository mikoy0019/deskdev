// Web-only (not mirrored to mobile). The browser chrome (Android status bar,
// desktop app title bar) takes its colour from <meta name="theme-color">. The
// workspace layout ships two, keyed to the OS colour scheme; once the app has
// resolved its own theme they must follow the in-app choice instead.

/** The Topbar surface per theme (index.css --ink-850), when CSS can't be read. */
export const CHROME_FALLBACK = { light: '#eef0f4', dark: '#0e1119' } as const

/** '14 17 25' (an index.css RGB triplet) → '#0e1119'; null when malformed. */
export function tripletToHex(triplet: string): string | null {
  const parts = triplet.trim().split(/[\s,]+/)
  if (parts.length !== 3) return null
  const nums = parts.map(Number)
  if (!nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return null
  return `#${nums.map((n) => n.toString(16).padStart(2, '0')).join('')}`
}

/**
 * Point every theme-color meta at the resolved theme's Topbar colour and drop
 * their media queries, so the status bar matches the app rather than the OS.
 * Call after the .dark class has been applied — it reads the live token.
 */
export function syncThemeColor(dark: boolean): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const live = tripletToHex(getComputedStyle(root).getPropertyValue('--ink-850'))
  const color = live ?? CHROME_FALLBACK[dark ? 'dark' : 'light']
  let metas = Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'))
  if (metas.length === 0) {
    const meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.appendChild(meta)
    metas = [meta]
  }
  for (const meta of metas) {
    meta.removeAttribute('media')
    meta.setAttribute('content', color)
  }
}
