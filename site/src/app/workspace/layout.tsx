import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono, Space_Grotesk } from 'next/font/google'
// Self-hosted fallback for the display face, used only if the next/font
// variable is ever missing (see --font-display in index.css).
import '@fontsource-variable/schibsted-grotesk'
import '@/deskdev/index.css'
import { APPLE_SPLASH, splashHref, splashMedia } from '@/deskdev/pwa/splash'
import { READ_THEME_MODE_SCRIPT } from '@/deskdev/theme/themeStorage'

export const metadata: Metadata = {
  metadataBase: new URL('https://workspace.nixgensolutions.com'),
  title: 'DeskDev Studio',
  description:
    'DeskDev Studio — a calm, editorial workspace for client projects, tasks, meetings and CRM.',
  // A private workspace: nothing in it belongs in a search index.
  robots: { index: false, follow: false },
  applicationName: 'DeskDev',
  manifest: '/workspace/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/workspace/favicon.svg', type: 'image/svg+xml' },
      { url: '/workspace/icons/icon-192.png', type: 'image/png', sizes: '192x192' },
    ],
    apple: { url: '/workspace/icons/apple-touch-icon.png', sizes: '180x180' },
  },
  // statusBarStyle 'default': an opaque bar. With black-translucent, iOS 26+
  // lays its blur over whatever draws beneath the status bar.
  appleWebApp: { capable: true, title: 'DeskDev', statusBarStyle: 'default' },
  // Next.js emits only mobile-web-app-capable for appleWebApp.capable, and iOS
  // still ignores apple-touch-startup-image without the apple- prefixed tag.
  other: { 'apple-mobile-web-app-capable': 'yes' },
  // Phone numbers and addresses in client records stay plain text, not links
  // iOS invents.
  formatDetection: { telephone: false, email: false, address: false },
  openGraph: {
    type: 'website',
    title: 'DeskDev Studio',
    description: 'A calm, editorial workspace for client projects, tasks, meetings and CRM.',
    images: ['/workspace/og.svg'],
  },
  twitter: { card: 'summary_large_image' },
}

// Paints the browser chrome to match the top bar (ink-850) instead of flashing
// white. viewportFit 'cover' lets the shell reach under the notch and home
// indicator; the safe-area variables in index.css pad it back.
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eef0f4' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1119' },
  ],
  colorScheme: 'light dark',
  viewportFit: 'cover',
}

// The NixGen type system, the same faces app/(site)/layout.tsx loads: Geist for
// UI text, Geist Mono for figures and code, Space Grotesk for display. next/font
// downloads them at build time and serves them from this origin (no Google
// request at runtime), so the PWA's offline shell keeps them. index.css reads
// the variables in --font-sans / --font-mono / --font-display. Variable fonts:
// one file per face covers every weight we use.
const sans = Geist({ subsets: ['latin'], variable: '--font-dd-sans', display: 'swap' })
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-dd-mono', display: 'swap' })
const display = Space_Grotesk({ subsets: ['latin'], variable: '--font-dd-display', display: 'swap' })

// Runs before first paint, so a stored theme never flashes the other one.
// (i) Mirrors ThemeContext.tsx and DensityProvider.tsx exactly. The theme comes
// from themeStorage.ts's READ_THEME_MODE_SCRIPT (the site's `nixgen-theme`
// cookie, then localStorage, then the legacy `deskdev-theme` key, else
// 'system'); density from `deskdev-density`, else 'comfortable'. An explicit
// light/dark choice also wins over the OS in the theme-color metas; in 'system'
// mode their media queries already pick the right one and keep following the OS.
// (ii) Chrome fires beforeinstallprompt right after load, long before DeskDev
// (client-only, lazily loaded) mounts: stash it for pwa/install.ts.
const PRE_PAINT_SCRIPT = `(function () {
  var w = window, d = document, root = d.documentElement
  try {
    var mode = (${READ_THEME_MODE_SCRIPT})()
    var dark = mode === 'dark' || (mode === 'system' && w.matchMedia('(prefers-color-scheme: dark)').matches)
    root.classList.toggle('dark', dark)
    var density = 'comfortable'
    try {
      var v = localStorage.getItem('deskdev-density')
      if (v === 'comfortable' || v === 'compact') density = v
    } catch (e) {}
    root.setAttribute('data-density', density)
    if (mode !== 'system') {
      // Flip the media queries, never the content: React matches these metas
      // by content when it hydrates and would add a copy of any it can't find.
      var metas = d.querySelectorAll('meta[name="theme-color"]')
      for (var i = 0; i < metas.length; i++) {
        var forDark = /dark/.test(metas[i].getAttribute('media') || '')
        metas[i].setAttribute('media', forDark === dark ? 'all' : 'not all')
      }
    }
  } catch (e) {}
  try {
    w.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault()
      w.__ddBip = e
      w.dispatchEvent(new Event('dd:bip'))
    })
    w.addEventListener('appinstalled', function () {
      w.__ddInstalled = true
      w.__ddBip = undefined
      w.dispatchEvent(new Event('dd:appinstalled'))
    })
  } catch (e) {}
})()`

// The page colour (ink-900) before the stylesheet arrives, so a launch that
// has no matching startup image doesn't flash white. index.css gives <body>
// the same colour once it loads.
const PAGE_BACKGROUND = 'html,body{background-color:#f5f6f8}html.dark,html.dark body{background-color:#0a0c12}'

/**
 * DeskDev's own root layout — a separate document from the marketing site's
 * app/(site)/layout.tsx, so neither design system's global styles reach the
 * other. Moving between the two is a full page load.
 */
export default function WorkspaceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // The pre-paint script sets the dark class / data-density on <html> before
    // React hydrates; ThemeProvider and DensityProvider keep them in sync after.
    <html lang="en" className={`${sans.variable} ${mono.variable} ${display.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PRE_PAINT_SCRIPT }} />
        <style dangerouslySetInnerHTML={{ __html: PAGE_BACKGROUND }} />
        {/* iOS launch screens. Plain relative links: metadata.appleWebApp's
            startupImage would make them absolute to metadataBase. */}
        {APPLE_SPLASH.flatMap((s) =>
          (['light', 'dark'] as const).map((theme) => (
            <link
              key={`${s.width}x${s.height}-${theme}`}
              rel="apple-touch-startup-image"
              media={splashMedia(s, theme)}
              href={splashHref(s, theme)}
            />
          )),
        )}
      </head>
      <body>{children}</body>
    </html>
  )
}
