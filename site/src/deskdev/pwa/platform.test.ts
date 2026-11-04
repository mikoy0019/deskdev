import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectPlatform, installMethod, isStandalone, type PlatformInfo, type PlatformInput } from './platform'

// Real-world user agents (2024–2026). Where a vendor's exact string varies by
// build, the token the detection keys on is what matters (see platform.ts).
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)'
const ANDROID_WV =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/127.0.6533.103 Mobile Safari/537.36'
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'

// A fixed environment so the live jsdom navigator/window never leaks in.
const BASE: PlatformInput = { platform: '', maxTouchPoints: 0, hasTelegramProxy: false, standalone: false }

interface Row {
  name: string
  ua: string
  expected: Partial<PlatformInfo>
  input?: PlatformInput
}

const ios = (browser: PlatformInfo['browser'], osVersion: number | null, inApp: PlatformInfo['inApp'] = null) => ({
  os: 'ios' as const,
  browser,
  inApp,
  isIPad: false,
  isMobile: true,
  osVersion,
})
const iosApp = (inApp: PlatformInfo['inApp'], osVersion = 17) => ios('other', osVersion, inApp)
const android = (browser: PlatformInfo['browser'], osVersion: number | null, inApp: PlatformInfo['inApp'] = null) => ({
  os: 'android' as const,
  browser,
  inApp,
  isIPad: false,
  isMobile: true,
  osVersion,
})
const androidApp = (inApp: PlatformInfo['inApp']) => android('other', 14, inApp)
const desktop = (browser: PlatformInfo['browser'], inApp: PlatformInfo['inApp'] = null) => ({
  os: 'desktop' as const,
  browser,
  inApp,
  isIPad: false,
  isMobile: false,
  osVersion: null,
})

const ROWS: Row[] = [
  // ── iOS / iPadOS browsers ────────────────────────────────────────────────
  {
    name: 'iOS 26 Safari (OS token frozen at 18_6)',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
    expected: ios('safari', 26),
  },
  {
    name: 'iOS 27 Safari',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0.1 Mobile/15E148 Safari/604.1',
    expected: ios('safari', 27),
  },
  {
    name: 'iOS 17.4 Safari',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    expected: ios('safari', 17),
  },
  {
    name: 'iOS 16.3 Safari',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1',
    expected: ios('safari', 16),
  },
  {
    name: 'iPad Safari, mobile UA',
    ua: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    expected: { ...ios('safari', 17), isIPad: true },
  },
  {
    name: 'iPadOS Safari, desktop-class Macintosh UA + touch',
    ua: MAC_SAFARI,
    input: { platform: 'MacIntel', maxTouchPoints: 5 },
    expected: { ...ios('safari', 26), isIPad: true },
  },
  {
    name: 'iPadOS Firefox, desktop Gecko UA + touch',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0',
    input: { platform: 'MacIntel', maxTouchPoints: 5 },
    expected: { ...ios('firefox', null), isIPad: true },
  },
  {
    name: 'Chrome for iOS',
    ua: `${IPHONE} CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1`,
    expected: ios('chrome', 17),
  },
  {
    name: 'Chrome for iOS on iOS 26 (no Version token: frozen 18 is a lower bound)',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.101 Mobile/15E148 Safari/604.1',
    expected: ios('chrome', 18),
  },
  {
    name: 'Firefox for iOS',
    ua: `${IPHONE} FxiOS/127.0 Mobile/15E148 Safari/605.1.15`,
    expected: ios('firefox', 17),
  },
  {
    name: 'Edge for iOS',
    ua: `${IPHONE} Version/17.0 EdgiOS/125.2535.86 Mobile/15E148 Safari/605.1.15`,
    expected: ios('edge', 17),
  },
  {
    name: 'Opera for iOS (OPT)',
    ua: `${IPHONE} Version/17.5 Mobile/15E148 Safari/604.1 OPT/5.0.6`,
    expected: ios('opera', 17),
  },
  {
    name: 'Opera for iOS (OPiOS)',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) OPiOS/16.0.14.122053 Mobile/15E148 Safari/9537.53',
    expected: ios('opera', 16),
  },
  {
    name: 'generic iOS WKWebView (no Safari/ token)',
    ua: `${IPHONE} Mobile/15E148`,
    expected: iosApp('webview'),
  },
  {
    name: 'iOS Home Screen web app (web-view UA, navigator.standalone)',
    ua: `${IPHONE} Mobile/15E148`,
    input: { standalone: true },
    expected: ios('safari', 17),
  },
  {
    name: 'desktop-class iPad in-app web view',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
    input: { platform: 'MacIntel', maxTouchPoints: 5 },
    expected: { ...ios('other', null, 'webview'), isIPad: true },
  },

  // ── iOS in-app browsers ──────────────────────────────────────────────────
  {
    name: 'Facebook (iOS)',
    ua: `${IPHONE} Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.43.105;FBBV/620361932;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5;FBRV/622464735]`,
    expected: iosApp('facebook'),
  },
  {
    name: 'Facebook (iOS) build without FBAN/FBAV',
    ua: `${IPHONE} Mobile/15E148 [FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]`,
    expected: iosApp('facebook'),
  },
  {
    name: 'Messenger (iOS)',
    ua: `${IPHONE} Mobile/15E148 [FBAN/MessengerForiOS;FBAV/466.0.0.36.109;FBBV/615298262;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBCR/;FBID/phone;FBLC/en_US;FBOP/5;FBRV/0]`,
    expected: iosApp('messenger'),
  },
  {
    name: 'Instagram (iOS)',
    ua: `${IPHONE} Mobile/15E148 Instagram 337.0.3.23.54 (iPhone14,5; iOS 17_5; en_US; en; scale=3.00; 1170x2532; 615290234)`,
    expected: iosApp('instagram'),
  },
  {
    name: 'Threads (iOS)',
    ua: `${IPHONE} Mobile/15E148 Barcelona 337.0.0.27.110 (iPhone14,5; iOS 17_5; en_US; en; scale=3.00; 1170x2532; 615290234)`,
    expected: iosApp('threads'),
  },
  {
    name: 'LinkedIn (iOS)',
    ua: `${IPHONE} Mobile/15E148 [LinkedInApp]/9.29.8961`,
    expected: iosApp('linkedin'),
  },
  {
    name: 'X / Twitter (iOS)',
    ua: `${IPHONE} Mobile/15E148 Twitter for iPhone/10.48`,
    expected: iosApp('twitter'),
  },
  {
    name: 'TikTok (iOS)',
    ua: `${IPHONE} Mobile/15E148 musical_ly_35.1.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/en Region/US ByteFullLocale/en isDarkMode/0 WKWebView/1 BytedanceWebview/d8a21c6`,
    expected: iosApp('tiktok'),
  },
  {
    name: 'Snapchat (iOS) — carries a Safari/ token',
    ua: `${IPHONE} Mobile/15E148 Snapchat/13.0.0.39 (like Safari/8618.2.12.10.4, panda)`,
    expected: iosApp('snapchat'),
  },
  {
    name: 'LINE (iOS)',
    ua: `${IPHONE} Mobile/15E148 Safari Line/14.9.0`,
    expected: iosApp('line'),
  },
  {
    name: 'WeChat (iOS)',
    ua: `${IPHONE} Mobile/15E148 MicroMessenger/8.0.49(0x18003137) NetType/WIFI Language/en`,
    expected: iosApp('wechat'),
  },
  {
    name: 'Google app (iOS)',
    ua: `${IPHONE} GSA/322.0.648915268 Mobile/15E148 Safari/604.1`,
    expected: iosApp('google'),
  },
  {
    name: 'WhatsApp (iOS)',
    ua: `${IPHONE} Mobile/15E148 WAiOS/24.12.78`,
    expected: iosApp('whatsapp'),
  },
  {
    name: 'Reddit (iOS)',
    ua: `${IPHONE} Mobile/15E148 Reddit/Version 2024.22.0/Build 1542817/iOS Version 17.5 (Build 21F79)`,
    expected: iosApp('reddit'),
  },
  {
    name: "Telegram's browser (iOS) — Safari's UA, caught by its injected global",
    ua: `${IPHONE} Version/17.5 Mobile/15E148 Safari/604.1`,
    input: { hasTelegramProxy: true },
    expected: iosApp('telegram'),
  },

  // ── Android browsers ─────────────────────────────────────────────────────
  {
    name: 'Chrome for Android, reduced UA (Android 10; K is a placeholder)',
    ua: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
    expected: android('chrome', null),
  },
  {
    name: 'Chrome for Android, full UA',
    ua: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36',
    expected: android('chrome', 13),
  },
  {
    name: 'Chrome on an Android tablet (no Mobile token)',
    ua: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    expected: android('chrome', 14),
  },
  {
    name: 'Samsung Internet',
    ua: 'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
    expected: android('samsung', 14),
  },
  {
    name: 'Firefox for Android',
    ua: 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0',
    expected: android('firefox', 14),
  },
  {
    name: 'Edge for Android',
    ua: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36 EdgA/128.0.0.0',
    expected: android('edge', null),
  },
  {
    name: 'Opera for Android',
    ua: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36 OPR/84.0.4452.82244',
    expected: android('opera', null),
  },
  {
    name: 'Android WebView, legacy UA',
    ua: 'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230805.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36',
    expected: android('other', 13, 'webview'),
  },
  {
    name: 'Android WebView, reduced UA',
    ua: 'Mozilla/5.0 (Linux; Android 10; K; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36',
    expected: android('other', null, 'webview'),
  },
  {
    name: "Android WebView without '; wv' (Version/4.0 + Chrome/)",
    ua: 'Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.0.0 Mobile Safari/537.36',
    expected: android('other', 12, 'webview'),
  },

  // ── Android in-app browsers ──────────────────────────────────────────────
  { name: 'Facebook (Android)', ua: `${ANDROID_WV} [FB_IAB/FB4A;FBAV/477.0.0.49.82;]`, expected: androidApp('facebook') },
  {
    name: 'Messenger (Android, Orca)',
    ua: `${ANDROID_WV} [FB_IAB/Orca-Android;FB4A;FBAV/465.0.0.48.109;]`,
    expected: androidApp('messenger'),
  },
  {
    name: 'Messenger (Android, FB_IAB/MESSENGER)',
    ua: `${ANDROID_WV} [FB_IAB/MESSENGER;FBAV/465.0.0.48.109;]`,
    expected: androidApp('messenger'),
  },
  {
    name: 'Instagram (Android)',
    ua: `${ANDROID_WV} Instagram 343.0.0.33.101 Android (34/14; 420dpi; 1080x2400; Google/google; Pixel 8; shiba; shiba; en_US; 628341212)`,
    expected: androidApp('instagram'),
  },
  {
    name: 'Threads (Android)',
    ua: `${ANDROID_WV} Barcelona 343.0.0.33.101 Android (34/14; 420dpi; 1080x2400; Google/google; Pixel 8; shiba; shiba; en_US; 628341212)`,
    expected: androidApp('threads'),
  },
  { name: 'LinkedIn (Android)', ua: `${ANDROID_WV} [LinkedInApp]/4.1.981`, expected: androidApp('linkedin') },
  {
    name: 'TikTok (Android)',
    ua: `${ANDROID_WV} trill_350402 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/trill app_version/35.4.2 ByteLocale/en BytedanceWebview/d8a21c6`,
    expected: androidApp('tiktok'),
  },
  {
    name: 'Snapchat (Android)',
    ua: `${ANDROID_WV} Snapchat/13.3.0.44 (Pixel 8; Android 14#11228537#34; gzip; )`,
    expected: androidApp('snapchat'),
  },
  { name: 'X / Twitter (Android)', ua: `${ANDROID_WV} TwitterAndroid`, expected: androidApp('twitter') },
  { name: 'LINE (Android)', ua: `${ANDROID_WV} Line/14.12.1/IAB`, expected: androidApp('line') },
  {
    name: 'WeChat (Android)',
    ua: `${ANDROID_WV} XWEB/1160065 MMWEBSDK/20231202 MMWEBID/2768 MicroMessenger/8.0.47.2560(0x28002F30) WeChat/arm64 Weixin NetType/WIFI Language/en ABI/arm64`,
    expected: androidApp('wechat'),
  },
  {
    name: 'Reddit (Android)',
    ua: `${ANDROID_WV} Reddit/Version 2024.32.0/Build 1607823/Android 14`,
    expected: androidApp('reddit'),
  },
  { name: 'Google app (Android)', ua: `${ANDROID_WV} GSA/15.33.38.29.arm64`, expected: androidApp('google') },
  { name: 'WhatsApp (Android)', ua: `${ANDROID_WV} WA4A/2.24.17.79`, expected: androidApp('whatsapp') },
  {
    name: "Telegram's browser (Android) — a plain web view plus its injected global",
    ua: ANDROID_WV,
    input: { hasTelegramProxy: true },
    expected: androidApp('telegram'),
  },

  // ── Desktop ──────────────────────────────────────────────────────────────
  {
    name: 'Chrome on Windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    input: { platform: 'Win32' },
    expected: desktop('chrome'),
  },
  {
    name: 'Edge on Windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
    expected: desktop('edge'),
  },
  {
    name: 'Firefox on Windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0',
    expected: desktop('firefox'),
  },
  {
    name: 'Opera on Windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 OPR/123.0.0.0',
    expected: desktop('opera'),
  },
  {
    name: 'Safari on a Mac (no touch)',
    ua: MAC_SAFARI,
    input: { platform: 'MacIntel', maxTouchPoints: 0 },
    expected: desktop('safari'),
  },
  {
    name: 'Chrome on a Mac',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    input: { platform: 'MacIntel' },
    expected: desktop('chrome'),
  },
  {
    name: 'Firefox on Linux',
    ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0',
    expected: desktop('firefox'),
  },
  {
    name: 'Chrome on ChromeOS',
    ua: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    expected: desktop('chrome'),
  },
  {
    name: 'Slack desktop app (Electron)',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Slack/4.38.125 Chrome/124.0.6367.243 Electron/30.1.0 Safari/537.36 Sonic Slack_SSB/4.38.125',
    expected: desktop('other', 'slack'),
  },

  // ── Nothing to go on ─────────────────────────────────────────────────────
  {
    name: 'empty user agent',
    ua: '',
    expected: { os: 'other', browser: 'other', inApp: null, isIPad: false, isMobile: false, osVersion: null },
  },
]

describe('detectPlatform', () => {
  it('covers a broad UA matrix', () => {
    expect(ROWS.length).toBeGreaterThanOrEqual(35)
  })

  it.each(ROWS)('$name', ({ ua, input, expected }) => {
    expect(detectPlatform({ ...BASE, ...input, userAgent: ua })).toEqual(expected)
  })
})

describe('detectPlatform defaults', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (window as Window & { TelegramWebviewProxy?: unknown }).TelegramWebviewProxy
  })

  it('reads the live navigator when no input is given', () => {
    vi.stubGlobal('navigator', {
      userAgent: MAC_SAFARI,
      platform: 'MacIntel',
      maxTouchPoints: 5,
    })
    expect(detectPlatform()).toMatchObject({ os: 'ios', isIPad: true, browser: 'safari', osVersion: 26 })
  })

  it("detects Telegram's injected global by default", () => {
    ;(window as Window & { TelegramWebviewProxy?: unknown }).TelegramWebviewProxy = {}
    expect(detectPlatform({ userAgent: ANDROID_WV }).inApp).toBe('telegram')
  })

  it('treats navigator.standalone as a Home Screen app, not a web view', () => {
    vi.stubGlobal('navigator', { userAgent: `${IPHONE} Mobile/15E148`, standalone: true, maxTouchPoints: 5 })
    expect(detectPlatform()).toMatchObject({ os: 'ios', inApp: null, browser: 'safari' })
  })
})

describe('isStandalone', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function stubMatchMedia(matching: string[]) {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({ matches: matching.includes(query), media: query })),
    )
  }

  it('is false without matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(isStandalone()).toBe(false)
  })

  it('is false in a browser tab', () => {
    stubMatchMedia(['(display-mode: browser)'])
    expect(isStandalone()).toBe(false)
  })

  it.each(['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'])('is true for display-mode %s', (mode) => {
    stubMatchMedia([`(display-mode: ${mode})`])
    expect(isStandalone()).toBe(true)
  })

  it('is true when iOS sets navigator.standalone', () => {
    stubMatchMedia([])
    vi.stubGlobal('navigator', { userAgent: IPHONE, standalone: true })
    expect(isStandalone()).toBe(true)
  })
})

describe('installMethod', () => {
  const p = (ua: string, input: PlatformInput = {}) => detectPlatform({ ...BASE, ...input, userAgent: ua })
  const tab = { standalone: false, canPrompt: false }

  const iosSafari = p(ROWS[0].ua)
  const iPadSafari = p(MAC_SAFARI, { platform: 'MacIntel', maxTouchPoints: 5 })
  const iosChrome = p(`${IPHONE} CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1`)
  const iosFirefox = p(`${IPHONE} FxiOS/127.0 Mobile/15E148 Safari/605.1.15`)
  const instagram = p(`${IPHONE} Mobile/15E148 Instagram 337.0.3.23.54 (iPhone14,5; iOS 17_5)`)
  const androidChrome = p(
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  )
  const samsung = p(
    'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  )
  const firefoxAndroid = p('Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0')
  const edgeAndroid = p(
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36 EdgA/128.0.0.0',
  )
  const operaAndroid = p(
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36 OPR/84.0.4452.82244',
  )
  const facebookAndroid = p(`${ANDROID_WV} [FB_IAB/FB4A;FBAV/477.0.0.49.82;]`)
  const desktopChrome = p(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  )
  const desktopEdge = p(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  )
  const desktopOpera = p(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 OPR/123.0.0.0',
  )
  const macSafari = p(MAC_SAFARI, { platform: 'MacIntel', maxTouchPoints: 0 })
  const desktopFirefox = p('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0')
  const unknown = p('')

  it('reports the installed app first, whatever else is true', () => {
    expect(installMethod(iosSafari, { standalone: true, canPrompt: false })).toBe('installed')
    expect(installMethod(androidChrome, { standalone: true, canPrompt: true })).toBe('installed')
    expect(installMethod(instagram, { standalone: true, canPrompt: false })).toBe('installed')
  })

  it('sends every in-app browser to a real browser, even with a prompt', () => {
    expect(installMethod(instagram, tab)).toBe('in-app-browser')
    expect(installMethod(facebookAndroid, { standalone: false, canPrompt: true })).toBe('in-app-browser')
  })

  it('prefers the browser prompt when one is stashed', () => {
    expect(installMethod(androidChrome, { standalone: false, canPrompt: true })).toBe('prompt')
    expect(installMethod(samsung, { standalone: false, canPrompt: true })).toBe('prompt')
    expect(installMethod(desktopChrome, { standalone: false, canPrompt: true })).toBe('prompt')
  })

  it('routes iOS to Safari steps or the other-browser steps', () => {
    expect(installMethod(iosSafari, tab)).toBe('ios-safari')
    expect(installMethod(iPadSafari, tab)).toBe('ios-safari')
    expect(installMethod(iosChrome, tab)).toBe('ios-other-browser')
    expect(installMethod(iosFirefox, tab)).toBe('ios-other-browser')
  })

  it('routes Android browsers to their own menu steps', () => {
    expect(installMethod(androidChrome, tab)).toBe('android-chrome-menu')
    expect(installMethod(samsung, tab)).toBe('samsung-menu')
    expect(installMethod(firefoxAndroid, tab)).toBe('firefox-android-menu')
    expect(installMethod(edgeAndroid, tab)).toBe('edge-android-menu')
    expect(installMethod(operaAndroid, tab)).toBe('unsupported')
  })

  it('uses the desktop menu where a browser can install, and nothing where it cannot', () => {
    expect(installMethod(desktopChrome, tab)).toBe('desktop-menu')
    expect(installMethod(desktopEdge, tab)).toBe('desktop-menu')
    expect(installMethod(desktopOpera, tab)).toBe('desktop-menu')
    expect(installMethod(macSafari, tab)).toBe('desktop-menu')
    expect(installMethod(desktopFirefox, tab)).toBe('unsupported')
    expect(installMethod(unknown, tab)).toBe('unsupported')
  })
})
