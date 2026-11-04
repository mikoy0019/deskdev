// Web-only. DeskDev's web app manifest, served by the
// app/workspace/manifest.webmanifest route for the host that asked: on
// DeskDev's own subdomain the app lives at the root (base ''), elsewhere —
// local dev, previews — at /workspace.
//
// Identity rules (see the PWA research): id, scope and start_url never end in
// a slash — Next.js 308-redirects '/workspace/' and scopes are plain prefix
// matches — and id must never change once people have installed the app.
// Chrome uploads all of this to Google's WebAPK server, so nothing here may be
// secret or user-specific.
//
// Import-free on purpose, like splash.ts: pure data, testable on its own.

export type ManifestBase = '' | '/workspace'

interface ManifestImage {
  src: string
  sizes: string
  type: string
  purpose?: 'any' | 'maskable' | 'monochrome'
}

interface Screenshot extends ManifestImage {
  form_factor: 'narrow' | 'wide'
  label: string
}

/** Files in public/workspace/ — /workspace/* on every host (see assetUrl). */
const ASSETS = '/workspace'
const ICONS = `${ASSETS}/icons`

const DESCRIPTION = 'A calm, editorial workspace for client projects, tasks, meetings and CRM.'
// The splash Android builds from the manifest can't follow dark mode, so it
// uses the dark page (ink-900); the bars recolor from the page's theme-color.
const SHELL_COLOR = '#0a0c12'

function png(src: string, size: number, purpose: ManifestImage['purpose']): ManifestImage {
  return { src, sizes: `${size}x${size}`, type: 'image/png', purpose }
}

// One purpose per entry: 'any maskable' on one file pads the regular icon or
// crops the maskable one.
const ICON_SET: ManifestImage[] = [
  png(`${ICONS}/icon-192.png`, 192, 'any'),
  png(`${ICONS}/icon-512.png`, 512, 'any'),
  png(`${ICONS}/icon-maskable-192.png`, 192, 'maskable'),
  png(`${ICONS}/icon-maskable-512.png`, 512, 'maskable'),
  png(`${ICONS}/icon-monochrome-512.png`, 512, 'monochrome'),
  { src: `${ASSETS}/favicon.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
]

// Android launchers show at most four.
const SHORTCUTS = [
  { name: 'Tasks', path: '/tasks', icon: 'tasks', description: 'Open your task list' },
  { name: 'Chat', path: '/messages', icon: 'chat', description: 'Open your conversations' },
  { name: 'Calendar', path: '/calendar', icon: 'calendar', description: 'Open the calendar' },
  { name: 'Projects', path: '/projects', icon: 'projects', description: 'Open your projects' },
] as const

// Chrome's richer install sheet: phones use the narrow shots (one shared
// aspect ratio, long side ≤ 2.3× the short one), desktop the wide one.
const SCREENSHOTS: Screenshot[] = [
  {
    src: `${ASSETS}/screenshots/narrow-home.png`,
    sizes: '1170x2532',
    type: 'image/png',
    form_factor: 'narrow',
    label: 'Home: what needs you today, at a glance',
  },
  {
    src: `${ASSETS}/screenshots/narrow-tasks.png`,
    sizes: '1170x2532',
    type: 'image/png',
    form_factor: 'narrow',
    label: 'Tasks for every client project',
  },
  {
    src: `${ASSETS}/screenshots/narrow-chat.png`,
    sizes: '1170x2532',
    type: 'image/png',
    form_factor: 'narrow',
    label: 'Team chat and client conversations',
  },
  {
    src: `${ASSETS}/screenshots/wide-home.png`,
    sizes: '2560x1600',
    type: 'image/png',
    form_factor: 'wide',
    label: 'The DeskDev workspace on a desktop',
  },
]

/**
 * The manifest for DeskDev served at `base` ('' on its own host, '/workspace'
 * elsewhere) from `origin` (scheme + host, no trailing slash).
 */
export function buildManifest(base: ManifestBase, origin: string): Record<string, unknown> {
  const root = base || '/'
  return {
    id: root,
    name: 'DeskDev Studio',
    short_name: 'DeskDev',
    description: DESCRIPTION,
    start_url: `${root}?source=pwa`,
    scope: root,
    display: 'standalone',
    background_color: SHELL_COLOR,
    theme_color: SHELL_COLOR,
    lang: 'en',
    dir: 'ltr',
    categories: ['business', 'productivity'],
    // Lets a browser tab ask navigator.getInstalledRelatedApps() whether this
    // app is installed. A 'webapp' entry never hides the install prompt.
    prefer_related_applications: false,
    related_applications: [{ platform: 'webapp', url: `${origin}${ASSETS}/manifest.webmanifest` }],
    // Desktop: a captured link focuses the open window instead of a second one.
    launch_handler: { client_mode: ['focus-existing', 'auto'] },
    icons: ICON_SET,
    shortcuts: SHORTCUTS.map(({ name, path, icon, description }) => ({
      name,
      short_name: name,
      description,
      url: `${base}${path}`,
      icons: [png(`${ICONS}/shortcut-${icon}-96.png`, 96, 'any')],
    })),
    screenshots: SCREENSHOTS,
  }
}
