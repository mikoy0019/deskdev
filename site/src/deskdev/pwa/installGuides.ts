// Web-only (not mirrored to mobile). Step-by-step install instructions for
// every way a visitor can (or can't) install DeskDev, worded from the verified
// 2026 browser behavior in the PWA research (iOS 26 "Open as Web App", Chrome's
// "Install and create shortcut", Samsung/Firefox/Edge shortcuts, in-app browsers).
//
// Step text marks the labels people look for on screen with **double
// asterisks**; splitEmphasis() turns that into bold runs for the UI.
import type { InAppBrowser, InstallMethod, PlatformInfo } from './platform'

/** A small picture of the control a step talks about. */
export type GuideGlyph =
  | 'share'
  | 'more-vert'
  | 'more-horiz'
  | 'menu'
  | 'plus-square'
  | 'toggle'
  | 'install'
  | 'home'
  | 'copy'
  | 'browser'
  | 'chrome'

export interface GuideStep {
  glyph: GuideGlyph
  text: string
}

export interface InstallGuide {
  title: string
  intro: string
  steps: GuideStep[]
  note?: string
  /** This browser only makes a shortcut (or none) — Chrome installs the real app. */
  recommendChrome?: boolean
}

/** Every InstallMethod, for exhaustive checks and tests. */
export const INSTALL_METHODS: readonly InstallMethod[] = [
  'installed',
  'prompt',
  'ios-safari',
  'ios-other-browser',
  'android-chrome-menu',
  'samsung-menu',
  'firefox-android-menu',
  'edge-android-menu',
  'desktop-menu',
  'in-app-browser',
  'unsupported',
]

const IN_APP_NAMES: Record<InAppBrowser, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  messenger: 'Messenger',
  threads: 'Threads',
  linkedin: 'LinkedIn',
  twitter: 'X',
  tiktok: 'TikTok',
  snapchat: 'Snapchat',
  line: 'LINE',
  wechat: 'WeChat',
  reddit: 'Reddit',
  google: 'the Google app',
  gmail: 'Gmail',
  slack: 'Slack',
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  webview: 'this app',
}

/** The app whose built-in browser is showing the page: 'Instagram', 'this app'… */
export function inAppName(inApp: InAppBrowser | null): string {
  return inApp ? IN_APP_NAMES[inApp] : 'this app'
}

const BROWSER_NAMES: Record<PlatformInfo['browser'], string> = {
  safari: 'Safari',
  chrome: 'Chrome',
  edge: 'Edge',
  firefox: 'Firefox',
  samsung: 'Samsung Internet',
  opera: 'Opera',
  other: 'your browser',
}

/** 'Safari', 'Chrome', 'Instagram's browser'… for status lines. */
export function browserName(p: PlatformInfo): string {
  if (p.inApp) return p.inApp === 'webview' ? 'an in-app browser' : `${IN_APP_NAMES[p.inApp]}’s browser`
  return BROWSER_NAMES[p.browser]
}

export type DeviceKind = 'ios' | 'android' | 'desktop'

/** Which of the install page's device tabs this platform belongs to. */
export function deviceKind(p: PlatformInfo): DeviceKind | null {
  if (p.os === 'ios' || p.os === 'android' || p.os === 'desktop') return p.os
  return null
}

/** 'iPhone', 'iPad', 'Android device', 'computer'. */
export function deviceName(p: PlatformInfo): string {
  if (p.os === 'ios') return p.isIPad ? 'iPad' : 'iPhone'
  if (p.os === 'android') return 'Android device'
  if (p.os === 'desktop') return 'computer'
  return 'device'
}

/** Splits '**bold** text' into runs. An unmatched ** stays literal. */
export function splitEmphasis(text: string): { text: string; strong: boolean }[] {
  const parts: { text: string; strong: boolean }[] = []
  const re = /\*\*(.+?)\*\*/g
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), strong: false })
    parts.push({ text: m[1], strong: true })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), strong: false })
  return parts
}

/** The text without its ** markers — for aria labels and plain-text use. */
export function plainText(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1')
}

// ── iOS ──────────────────────────────────────────────────────────────────

// iOS 26 froze Safari's OS token at 18_6, but Safari's Version/NN is honest.
// Unknown versions are treated as current: that's what most iPhones run.
function isModernIOS(p: PlatformInfo): boolean {
  return p.osVersion === null || p.osVersion >= 26
}

function iosSafariGuide(p: PlatformInfo): InstallGuide {
  const title = 'Add DeskDev to your Home Screen'
  if (p.isIPad) {
    if (isModernIOS(p)) {
      return {
        title,
        intro: 'Safari installs DeskDev on your iPad. No App Store needed.',
        steps: [
          { glyph: 'share', text: 'Tap **Share** at the top right of Safari.' },
          { glyph: 'more-horiz', text: 'Tap **View More**.' },
          { glyph: 'plus-square', text: 'Tap **Add to Home Screen**.' },
          { glyph: 'toggle', text: 'Leave **Open as Web App** switched on.' },
          { glyph: 'home', text: 'Tap **Add**. DeskDev appears on your Home Screen.' },
        ],
        note: 'With **Open as Web App** off you get a Safari bookmark, not the app. Remove it and add it again.',
      }
    }
    return {
      title,
      intro: 'Safari installs DeskDev on your iPad. No App Store needed.',
      steps: [
        { glyph: 'share', text: 'Tap **Share** (the square with an arrow) at the top of Safari.' },
        { glyph: 'plus-square', text: 'Scroll down and tap **Add to Home Screen**.' },
        { glyph: 'home', text: 'Tap **Add**. DeskDev appears on your Home Screen.' },
      ],
      note: legacyNote(p),
    }
  }

  if (isModernIOS(p)) {
    return {
      title,
      intro: 'Safari installs DeskDev in a few taps. No App Store needed.',
      steps: [
        { glyph: 'more-horiz', text: 'Tap **•••** at the right of the address bar.' },
        {
          glyph: 'share',
          text: 'Tap **Share**. With the Bottom or Top tab layout, **Share** is right in the toolbar, so skip the •••.',
        },
        {
          glyph: 'plus-square',
          text: 'Scroll down and tap **Add to Home Screen**. Not listed? Tap **Edit Actions** and add it.',
        },
        { glyph: 'toggle', text: 'Leave **Open as Web App** switched on.' },
        { glyph: 'home', text: 'Tap **Add**. DeskDev appears on your Home Screen.' },
      ],
      note: 'With **Open as Web App** off you get a Safari bookmark, not the app. Remove it and add it again.',
    }
  }

  return {
    title,
    intro: 'Safari installs DeskDev in three taps. No App Store needed.',
    steps: [
      { glyph: 'share', text: 'Tap **Share** (the square with an arrow) in the toolbar at the bottom.' },
      { glyph: 'plus-square', text: 'Scroll down and tap **Add to Home Screen**.' },
      { glyph: 'home', text: 'Tap **Add** at the top right. DeskDev appears on your Home Screen.' },
    ],
    note: legacyNote(p),
  }
}

function legacyNote(p: PlatformInfo): string | undefined {
  // Web Push and the app badge arrived in iOS 16.4; the version's minor part
  // isn't in the UA, so iOS 16 gets the hint too.
  if (p.osVersion !== null && p.osVersion <= 16) {
    return 'Notifications need iOS 16.4 or later. Update in **Settings → General → Software Update**.'
  }
  return undefined
}

function iosOtherBrowserGuide(p: PlatformInfo): InstallGuide {
  const title = 'Add DeskDev to your Home Screen'
  const finish: GuideStep[] = [
    { glyph: 'plus-square', text: 'Scroll down and tap **Add to Home Screen**.' },
    { glyph: 'toggle', text: 'If you see **Open as Web App**, leave it on.' },
    { glyph: 'home', text: 'Tap **Add**. DeskDev appears on your Home Screen.' },
  ]
  const note = 'Can’t find **Add to Home Screen**? Open this page in Safari and follow the steps there.'
  switch (p.browser) {
    case 'chrome':
      return {
        title,
        intro: 'Chrome adds DeskDev to your Home Screen, where it opens as its own app.',
        steps: [{ glyph: 'share', text: 'Tap **Share** at the right of the address bar.' }, ...finish],
        note,
      }
    case 'firefox':
      return {
        title,
        intro: 'Firefox adds DeskDev to your Home Screen, where it opens as its own app.',
        steps: [{ glyph: 'menu', text: 'Tap the **☰** menu, then **Share**.' }, ...finish],
        note,
      }
    case 'edge':
      return {
        title,
        intro: 'Edge adds DeskDev to your Home Screen, where it opens as its own app.',
        steps: [{ glyph: 'more-horiz', text: 'Tap **•••** at the bottom of the screen, then **Share**.' }, ...finish],
        note,
      }
    default:
      return {
        title,
        intro: 'Most iPhone browsers can add DeskDev to your Home Screen from their Share menu.',
        steps: [{ glyph: 'share', text: 'Find **Share** in your browser’s toolbar or menu.' }, ...finish],
        note,
      }
  }
}

function iosInAppGuide(p: PlatformInfo): InstallGuide {
  const app = inAppName(p.inApp)
  const steps: GuideStep[] = [
    { glyph: 'more-horiz', text: `Tap **•••** (or the menu button) in ${app}’s browser.` },
    {
      glyph: 'browser',
      text: 'Choose **Open in Safari**. It may say **Open in browser** or **Open in external browser**.',
    },
    { glyph: 'plus-square', text: 'In Safari, add DeskDev to your Home Screen. This page shows you how.' },
  ]
  return {
    title: 'Open this page in Safari',
    intro: `${capitalize(app)}’s built-in browser can’t install apps. Safari can.`,
    steps,
    note:
      p.inApp === 'telegram'
        ? 'No option? Copy the link and paste it into Safari. Telegram can also open links in Safari: **Settings → Data and Storage → Browser**.'
        : 'No such option? Copy the link and paste it into Safari’s address bar.',
  }
}

// ── Android ──────────────────────────────────────────────────────────────

const CHROME_ANDROID_STEPS: GuideStep[] = [
  { glyph: 'more-vert', text: 'Tap **⋮** at the top right of Chrome.' },
  {
    glyph: 'install',
    text: 'Tap **Install and create shortcut**. Older versions say **Install app** or **Add to Home screen**.',
  },
  { glyph: 'plus-square', text: 'Choose **Install**, then confirm.' },
  { glyph: 'home', text: 'DeskDev appears on your home screen and in your app list within a few seconds.' },
]

function androidChromeGuide(): InstallGuide {
  return {
    title: 'Install DeskDev',
    intro: 'Chrome installs DeskDev as a real app, on your home screen and in your app list.',
    steps: CHROME_ANDROID_STEPS,
    note: 'Pick **Install**, not **Create shortcut**. A shortcut only opens Chrome.',
  }
}

function samsungGuide(): InstallGuide {
  return {
    title: 'Install DeskDev',
    intro:
      'Samsung Internet installs DeskDev on Galaxy phones. On other phones it only adds a shortcut, so Chrome is the safer choice.',
    steps: [
      { glyph: 'menu', text: 'Tap **≡** at the bottom right. (Or tap the install icon in the address bar.)' },
      { glyph: 'plus-square', text: 'Tap **Add page to**, then **Home screen**.' },
      { glyph: 'home', text: 'Confirm with **Add** or **Install**.' },
    ],
    note: 'If it lands as a browser shortcut, or Android blocks it, install from Chrome instead.',
    recommendChrome: true,
  }
}

function firefoxAndroidGuide(): InstallGuide {
  return {
    title: 'Add DeskDev to your home screen',
    intro:
      'Firefox adds DeskDev as a home-screen shortcut that opens in Firefox. For the full app, with notifications and an app-list entry, use Chrome.',
    steps: [
      { glyph: 'more-vert', text: 'Tap **⋮**, then **More**.' },
      { glyph: 'plus-square', text: 'Tap **Add app to Home screen**.' },
      { glyph: 'home', text: 'Confirm with **Add**.' },
    ],
    recommendChrome: true,
  }
}

function edgeAndroidGuide(): InstallGuide {
  return {
    title: 'Add DeskDev to your home screen',
    intro:
      'Edge adds DeskDev as a shortcut that opens in Edge. For the full app, with notifications and an app-list entry, use Chrome.',
    steps: [
      { glyph: 'more-horiz', text: 'Tap **•••** at the bottom of the screen.' },
      { glyph: 'plus-square', text: 'Tap **Add to phone**.' },
      { glyph: 'install', text: 'Choose **Install app**, then confirm.' },
    ],
    recommendChrome: true,
  }
}

function androidInAppGuide(p: PlatformInfo): InstallGuide {
  const app = inAppName(p.inApp)
  return {
    title: 'Open this page in Chrome',
    intro: `${capitalize(app)}’s built-in browser can’t install apps. Chrome can.`,
    steps: [
      { glyph: 'chrome', text: 'Tap **Open in Chrome**.' },
      {
        glyph: 'more-vert',
        text: `Nothing happened? Tap **⋮** in ${app}’s browser and choose **Open in Chrome** or **Open in browser**.`,
      },
      { glyph: 'install', text: 'In Chrome, install DeskDev. This page shows you how.' },
    ],
    note: 'Still stuck? Copy the link and paste it into Chrome’s address bar.',
    recommendChrome: true,
  }
}

// ── Desktop ──────────────────────────────────────────────────────────────

function desktopGuide(p: PlatformInfo): InstallGuide {
  const title = 'Install DeskDev on this computer'
  const done: GuideStep = {
    glyph: 'home',
    text: 'Click **Install**. DeskDev opens in its own window and stays in your dock, taskbar or app list.',
  }
  switch (p.browser) {
    case 'edge':
      return {
        title,
        intro: 'Edge installs DeskDev as an app with its own window.',
        steps: [
          { glyph: 'install', text: 'Click **App available** at the right of the address bar.' },
          {
            glyph: 'more-horiz',
            text: 'Not there? Open **•••** → **Apps** → **Install this site as an app**.',
          },
          done,
        ],
      }
    case 'safari':
      return {
        title,
        intro: 'Safari adds DeskDev to your Dock as an app with its own window.',
        steps: [
          { glyph: 'share', text: 'In the menu bar, choose **File** → **Add to Dock**. (Or **Share** → **Add to Dock**.)' },
          { glyph: 'home', text: 'Click **Add**. DeskDev opens from the Dock like any Mac app.' },
        ],
        note: 'Add to Dock needs macOS Sonoma or later.',
      }
    case 'opera':
      return {
        title,
        intro: 'Opera can install DeskDev as an app with its own window.',
        steps: [{ glyph: 'install', text: 'Click the install icon at the right of the address bar.' }, done],
        note: 'No install icon? Chrome and Edge install DeskDev reliably.',
      }
    default:
      return {
        title,
        intro: 'Chrome installs DeskDev as an app with its own window.',
        steps: [
          { glyph: 'install', text: 'Click the install icon at the right of the address bar.' },
          {
            glyph: 'more-vert',
            text: 'Not there? Open **⋮** → **Cast, save, and share** → **Install DeskDev Studio…**',
          },
          done,
        ],
      }
  }
}

// ── Everything else ──────────────────────────────────────────────────────

function promptGuide(p: PlatformInfo): InstallGuide {
  const mobile = p.isMobile
  return {
    title: 'Install DeskDev',
    intro: mobile
      ? 'Your browser can install DeskDev right from this page.'
      : 'Your browser can install DeskDev on this computer right from this page.',
    steps: [
      { glyph: 'install', text: mobile ? 'Tap **Install**.' : 'Click **Install**.' },
      { glyph: 'plus-square', text: 'Confirm **Install** in the dialog.' },
      {
        glyph: 'home',
        text: mobile
          ? 'DeskDev appears on your home screen within a few seconds.'
          : 'DeskDev opens in its own window and stays in your dock, taskbar or app list.',
      },
    ],
  }
}

function unsupportedGuide(p: PlatformInfo): InstallGuide {
  if (p.os === 'android') {
    return {
      title: 'Install from Chrome',
      intro: 'This browser can’t install DeskDev. Chrome can, in a few taps.',
      steps: [
        { glyph: 'copy', text: 'Copy the link below.' },
        { glyph: 'chrome', text: 'Open **Chrome** and paste it into the address bar.' },
        ...CHROME_ANDROID_STEPS.slice(0, 3),
      ],
      recommendChrome: true,
    }
  }
  if (p.os === 'desktop') {
    return {
      title: 'Use Chrome, Edge or Safari',
      intro: `${capitalize(BROWSER_NAMES[p.browser])} doesn’t install web apps on computers. Chrome, Edge and Safari do. Or put DeskDev on your phone instead.`,
      steps: [
        { glyph: 'copy', text: 'Copy the link below.' },
        { glyph: 'browser', text: 'Open **Chrome**, **Edge** or **Safari** and paste it into the address bar.' },
        { glyph: 'install', text: 'Install DeskDev from there. This page shows you how.' },
      ],
    }
  }
  return {
    title: 'Open this page on your phone',
    intro: 'DeskDev installs from Safari on iPhone and iPad, and from Chrome on Android.',
    steps: [
      { glyph: 'copy', text: 'Copy the link below, or scan the code with your phone’s Camera app.' },
      { glyph: 'browser', text: 'Open it in **Safari** (iPhone, iPad) or **Chrome** (Android).' },
      { glyph: 'install', text: 'Follow the install steps there.' },
    ],
  }
}

function installedGuide(p: PlatformInfo): InstallGuide {
  return {
    title: 'You’re using the app',
    intro: 'DeskDev is installed on this device and running as an app.',
    steps: [
      {
        glyph: 'home',
        text:
          p.os === 'desktop'
            ? 'Open DeskDev from your dock, taskbar or app list any time.'
            : 'Open DeskDev from your home screen any time.',
      },
    ],
  }
}

/** The instructions for this visitor, given how they can install. */
export function installGuide(method: InstallMethod, p: PlatformInfo): InstallGuide {
  switch (method) {
    case 'installed':
      return installedGuide(p)
    case 'prompt':
      return promptGuide(p)
    case 'ios-safari':
      return iosSafariGuide(p)
    case 'ios-other-browser':
      return iosOtherBrowserGuide(p)
    case 'android-chrome-menu':
      return androidChromeGuide()
    case 'samsung-menu':
      return samsungGuide()
    case 'firefox-android-menu':
      return firefoxAndroidGuide()
    case 'edge-android-menu':
      return edgeAndroidGuide()
    case 'desktop-menu':
      return desktopGuide(p)
    case 'in-app-browser':
      return p.os === 'android' ? androidInAppGuide(p) : iosInAppGuide(p)
    case 'unsupported':
      return unsupportedGuide(p)
  }
}

const SAMPLE: Record<DeviceKind, PlatformInfo> = {
  ios: { os: 'ios', browser: 'safari', inApp: null, isIPad: false, isMobile: true, osVersion: 26 },
  android: { os: 'android', browser: 'chrome', inApp: null, isIPad: false, isMobile: true, osVersion: null },
  desktop: { os: 'desktop', browser: 'chrome', inApp: null, isIPad: false, isMobile: false, osVersion: null },
}

/**
 * Generic instructions for a device you're not holding — the install page's
 * "Installing on another device?" tabs. Covers the common case and mentions
 * the variants in the note.
 */
export function deviceGuide(device: DeviceKind): InstallGuide {
  switch (device) {
    case 'ios':
      return {
        ...iosSafariGuide(SAMPLE.ios),
        intro: 'Open this page in Safari on your iPhone, then:',
        note: 'On iPad: **Share** → **View More** → **Add to Home Screen**. On iOS 18 or earlier, **Share** sits in the toolbar and there’s no Open as Web App switch. Chrome, Edge and Firefox for iPhone can add it from their Share menu too.',
      }
    case 'android':
      return {
        ...androidChromeGuide(),
        intro: 'Open this page in Chrome on your Android phone, then:',
        note: 'Pick **Install**, not **Create shortcut**. Samsung Internet, Firefox and Edge only add a shortcut on most phones.',
      }
    case 'desktop':
      return {
        ...desktopGuide(SAMPLE.desktop),
        intro: 'Open this page in Chrome or Edge on your computer, then:',
        note: 'In Edge, click **App available** in the address bar. On a Mac with Safari: **File** → **Add to Dock**.',
      }
  }
}

// ── Escaping in-app browsers ─────────────────────────────────────────────

/**
 * An Android link that reopens `url` in Chrome from a web view. It only works
 * as a real link the user taps (Chrome ignores intents from timers and
 * redirects); the fallback URL keeps it harmless where Chrome is missing.
 */
export function chromeIntentUrl(url: string): string {
  const u = new URL(url)
  const scheme = u.protocol.replace(':', '')
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${scheme};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`
}

/** LINE's documented switch: the link opens in the phone's default browser. */
export function lineExternalUrl(url: string): string {
  const u = new URL(url)
  u.searchParams.set('openExternalBrowser', '1')
  return u.toString()
}

// ── Install banner snooze ────────────────────────────────────────────────

export const BANNER_DISMISS_KEY = 'deskdev.install-banner.dismissedAt'
export const BANNER_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000

/** True while a dismissal stored as epoch ms is younger than 14 days. */
export function bannerSnoozed(stored: string | null, now: number): boolean {
  if (!stored) return false
  const at = Number(stored)
  if (!Number.isFinite(at)) return false
  // abs(): a timestamp far in the future (a clock that was wrong) must not
  // hide the banner for good.
  return Math.abs(now - at) < BANNER_SNOOZE_MS
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// ── Sharing the install link ─────────────────────────────────────────────

/**
 * Copies text from a click handler. Falls back to a hidden textarea where the
 * async Clipboard API is missing — in-app web views and plain-http hosts.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Permission or focus problems: try the old way below.
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

/** The Web Share sheet is there (phones, Safari, Edge — not desktop Chrome on Linux). */
export function canShareLink(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function'
}

/** Opens the share sheet. 'cancelled' when the user closed it. */
export async function shareLink(url: string): Promise<'shared' | 'cancelled' | 'failed'> {
  try {
    await navigator.share({ title: 'DeskDev', text: 'Install DeskDev on your phone', url })
    return 'shared'
  } catch (err) {
    return err instanceof DOMException && err.name === 'AbortError' ? 'cancelled' : 'failed'
  }
}
