// Web-only (not mirrored to mobile). Which device, browser and in-app browser
// is showing DeskDev — the install page picks its instructions from this, and
// the app decides what it can offer (prompt, push, badge).
//
// User-agent sniffing is best-effort by nature: in-app browsers can rewrite
// their UA, SFSafariViewController and Chrome Custom Tabs are indistinguishable
// from Safari and Chrome (both can install, so that's fine), and iOS 26+ froze
// the UA's OS token at 18_6. Every caller must degrade gracefully.

export type OS = 'ios' | 'android' | 'desktop' | 'other'
export type Browser = 'safari' | 'chrome' | 'edge' | 'firefox' | 'samsung' | 'opera' | 'other'
export type InAppBrowser =
  | 'facebook'
  | 'instagram'
  | 'messenger'
  | 'threads'
  | 'linkedin'
  | 'twitter'
  | 'tiktok'
  | 'snapchat'
  | 'line'
  | 'wechat'
  | 'reddit'
  | 'google'
  | 'gmail'
  | 'slack'
  | 'telegram'
  | 'whatsapp'
  | 'webview'

export interface PlatformInfo {
  os: OS
  /** The real browser app. 'other' inside in-app browsers, which are web views, not browsers. */
  browser: Browser
  /** Set when the page runs inside another app's web view — such a view can never install. */
  inApp: InAppBrowser | null
  /** iPads, including iPadOS's desktop-class "Macintosh" UA. */
  isIPad: boolean
  /** A phone or tablet OS (iOS, iPadOS, Android). */
  isMobile: boolean
  /**
   * Major OS version where the UA still tells it: iOS/iPadOS (Safari's
   * Version/NN token, else the OS token — frozen at 18 from iOS 26, so a lower
   * bound) and Android (null for Chrome's reduced 'Android 10; K'). Null on
   * desktop, whose UAs are frozen (macOS 10_15_7, Windows NT 10.0).
   */
  osVersion: number | null
}

export interface PlatformInput {
  userAgent?: string
  /** navigator.platform — iPadOS reports 'MacIntel'. */
  platform?: string
  maxTouchPoints?: number
  /** Telegram's in-app browser injects TelegramWebviewProxy; its UA is a plain web view's. */
  hasTelegramProxy?: boolean
  /**
   * navigator.standalone (iOS only). A Home Screen web app sends a web view's
   * UA — no Safari/ token — so it must not be mistaken for an in-app browser.
   */
  standalone?: boolean
}

// In-app browsers by their UA tokens (inapp-spy's tables, June 2026, plus the
// Android set from the PWA research). Order matters: Messenger carries FBAN/FBAV
// too, and Threads is built on Instagram's stack.
const IN_APP: [InAppBrowser, RegExp][] = [
  ['messenger', /FBAN\/Messenger|FB_IAB\/MESSENGER|Orca-Android|\bFB[\w_]+\/Messenger/i],
  ['threads', /\bBarcelona\b/],
  ['instagram', /\bInstagram\b/],
  // FBAN/FBAV can be missing from recent builds; the FBDV/FBMD/… family stays.
  ['facebook', /\bFB\w+\/|\bFB4A\b|\bFBIOS\b|\bFacebook\b/],
  ['linkedin', /LinkedInApp/],
  ['snapchat', /\bSnapchat\b/],
  ['tiktok', /musical_ly|Bytedance/i],
  ['twitter', /\bTwitter/],
  ['line', /\bLine\//],
  ['wechat', /MicroMessenger\//],
  ['whatsapp', /\b(?:WAiOS|WA4A)\//],
  ['reddit', /\bReddit\//],
  ['slack', /\bSlack(?:_SSB)?\//],
  ['google', /\bGSA\//],
  // Gmail has no UA marker: it opens links in SFSafariViewController (iOS) or a
  // Custom Tab (Android), which look like — and install like — the browser.
  // When it does use a bare web view, the generic check below catches it.
]

const TELEGRAM_GLOBALS = ['TelegramWebviewProxy', 'TelegramWebviewProxyProto', 'TelegramWebview']

type NavigatorLike = Navigator & { standalone?: boolean }

function liveNavigator(): NavigatorLike | undefined {
  return typeof navigator === 'undefined' ? undefined : (navigator as NavigatorLike)
}

function hasTelegramGlobals(): boolean {
  if (typeof window === 'undefined') return false
  return TELEGRAM_GLOBALS.some((key) => key in window)
}

function iosVersion(ua: string): number | null {
  // Safari's Version/NN tracks iOS, and is the only honest number on iOS 26+,
  // where the OS token is frozen at 18_6. Chrome, Firefox and web views don't
  // send it, so fall back to the (possibly frozen) OS token.
  const version = /\bVersion\/(\d+)/.exec(ua)
  if (version) return Number(version[1])
  const os = /\bOS (\d+)[_.]\d/.exec(ua)
  return os ? Number(os[1]) : null
}

function androidVersion(ua: string): number | null {
  // Chrome's reduced UA (and Samsung's, which copies it) always reads
  // 'Android 10; K' — a placeholder, not the device's version.
  if (/\bAndroid 10; K(?:; wv)?\)/.test(ua)) return null
  const match = /\bAndroid (\d+)/.exec(ua)
  return match ? Number(match[1]) : null
}

function iosBrowser(ua: string): Browser {
  if (/\bEdgiOS\//.test(ua)) return 'edge'
  if (/\bCriOS\//.test(ua)) return 'chrome'
  // Firefox on an iPad may send a desktop Gecko UA.
  if (/\bFxiOS\/|\bFirefox\//.test(ua)) return 'firefox'
  if (/\bOPiOS\/|\bOPT\//.test(ua)) return 'opera'
  // Other WebKit shells that ship their own browser UI.
  if (/\bYaBrowser\/|\bDuckDuckGo\/|\bBrave\b/.test(ua)) return 'other'
  return /\bSafari\//.test(ua) ? 'safari' : 'other'
}

function androidBrowser(ua: string): Browser {
  if (/\bSamsungBrowser\//.test(ua)) return 'samsung'
  if (/\bEdgA\//.test(ua)) return 'edge'
  if (/\bOPR\/|\bOPiOS\/|Opera/.test(ua)) return 'opera'
  if (/\bFirefox\//.test(ua)) return 'firefox'
  // Chromium forks that can't mint a WebAPK, so Chrome's steps would mislead.
  if (/\b(?:YaBrowser|UCBrowser|MiuiBrowser|HuaweiBrowser|HeyTapBrowser|VivoBrowser|Vivaldi|DuckDuckGo)\//.test(ua)) {
    return 'other'
  }
  return /\bChrome\//.test(ua) ? 'chrome' : 'other'
}

function desktopBrowser(ua: string): Browser {
  if (/\bEdge?\//.test(ua)) return 'edge'
  if (/\bOPR\//.test(ua)) return 'opera'
  if (/\bFirefox\//.test(ua)) return 'firefox'
  if (/\b(?:YaBrowser|Vivaldi|Electron)\//.test(ua)) return 'other'
  if (/\bChrom(?:e|ium)\//.test(ua)) return 'chrome'
  if (/\bVersion\/[\d.]+.*\bSafari\//.test(ua)) return 'safari'
  return 'other'
}

/**
 * What's running this page. Every input defaults to the live navigator/window,
 * so `detectPlatform()` describes the current device; tests pass a UA.
 */
export function detectPlatform(input: PlatformInput = {}): PlatformInfo {
  const nav = liveNavigator()
  const ua = input.userAgent ?? nav?.userAgent ?? ''
  const platform = input.platform ?? nav?.platform ?? ''
  const maxTouchPoints = input.maxTouchPoints ?? nav?.maxTouchPoints ?? 0
  const telegram = input.hasTelegramProxy ?? hasTelegramGlobals()
  const standalone = input.standalone ?? nav?.standalone === true

  const iOSDevice = /\b(?:iPhone|iPad|iPod)\b/.test(ua)
  // iPadOS 13+ asks for desktop sites with a Mac UA; only touch gives it away
  // (no Mac has a touchscreen).
  const desktopClassIPad = !iOSDevice && (platform === 'MacIntel' || /\bMacintosh\b/.test(ua)) && maxTouchPoints > 1
  const isIPad = /\biPad\b/.test(ua) || desktopClassIPad

  let os: OS
  if (iOSDevice || desktopClassIPad) os = 'ios'
  else if (/\bAndroid\b/.test(ua)) os = 'android'
  else if (/\b(?:Windows NT|Macintosh|Mac OS X|CrOS|X11|Linux)\b/.test(ua)) os = 'desktop'
  else os = 'other'

  let inApp: InAppBrowser | null = telegram ? 'telegram' : null
  if (!inApp) inApp = IN_APP.find(([, re]) => re.test(ua))?.[0] ?? null
  if (!inApp) {
    // Generic web views. Android's carry '; wv)' (legacy and reduced UAs) or
    // Chrome's tokens behind 'Version/4.0', which Chrome itself never sends.
    // iOS ones (WKWebView) simply lack Safari's 'Safari/' token — as does a
    // Home Screen web app, which is why `standalone` is checked.
    if (os === 'android' && (/; wv\)/.test(ua) || /\bVersion\/4\.0 .*\bChrome\//.test(ua))) inApp = 'webview'
    else if (os === 'ios' && !standalone && !/\b(?:Safari|Firefox)\//.test(ua)) inApp = 'webview'
  }

  let browser: Browser
  if (inApp) browser = 'other'
  else if (os === 'ios') browser = standalone && !/\bSafari\//.test(ua) ? 'safari' : iosBrowser(ua)
  else if (os === 'android') browser = androidBrowser(ua)
  else if (os === 'desktop') browser = desktopBrowser(ua)
  else browser = 'other'

  let osVersion: number | null = null
  if (os === 'ios') osVersion = iosVersion(ua)
  else if (os === 'android') osVersion = androidVersion(ua)

  return {
    os,
    browser,
    inApp,
    isIPad,
    isMobile: os === 'ios' || os === 'android' || /\bMobi/.test(ua),
    osVersion,
  }
}

const STANDALONE_DISPLAY_MODES = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'] as const

/** The display-mode media queries that mean "running as an installed app". */
export const STANDALONE_QUERIES = STANDALONE_DISPLAY_MODES.map((mode) => `(display-mode: ${mode})`)

/**
 * True inside the installed app. Checks every app display mode — iOS matches
 * 'fullscreen' rather than 'standalone' for a standalone manifest (WebKit bug
 * 264218) — plus navigator.standalone, which iOS has always set.
 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  if (liveNavigator()?.standalone === true) return true
  if (typeof window.matchMedia !== 'function') return false
  return STANDALONE_QUERIES.some((query) => window.matchMedia(query).matches)
}

export type InstallMethod =
  | 'installed'
  | 'prompt'
  | 'ios-safari'
  | 'ios-other-browser'
  | 'android-chrome-menu'
  | 'samsung-menu'
  | 'firefox-android-menu'
  | 'edge-android-menu'
  | 'desktop-menu'
  | 'in-app-browser'
  | 'unsupported'

/**
 * How this visitor can install DeskDev. Order matters: an in-app web view can
 * never install, even when its UA looks like Chrome, so it wins over a prompt.
 */
export function installMethod(p: PlatformInfo, opts: { standalone: boolean; canPrompt: boolean }): InstallMethod {
  if (opts.standalone) return 'installed'
  if (p.inApp) return 'in-app-browser'
  if (opts.canPrompt) return 'prompt'
  if (p.os === 'ios') return p.browser === 'safari' ? 'ios-safari' : 'ios-other-browser'
  if (p.os === 'android') {
    switch (p.browser) {
      case 'chrome':
        return 'android-chrome-menu'
      case 'samsung':
        return 'samsung-menu'
      case 'firefox':
        return 'firefox-android-menu'
      case 'edge':
        return 'edge-android-menu'
      default:
        return 'unsupported'
    }
  }
  if (p.os === 'desktop') {
    // Chrome/Edge/Opera without a stashed prompt still install from their
    // menu, and Safari 17+ on macOS has File → Add to Dock. Firefox can't.
    if (p.browser === 'chrome' || p.browser === 'edge' || p.browser === 'opera' || p.browser === 'safari') {
      return 'desktop-menu'
    }
    return 'unsupported'
  }
  return 'unsupported'
}
