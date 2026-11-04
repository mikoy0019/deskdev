import { describe, expect, it } from 'vitest'
import { detectPlatform, installMethod, type PlatformInfo } from './platform'
import {
  BANNER_SNOOZE_MS,
  INSTALL_METHODS,
  bannerSnoozed,
  browserName,
  chromeIntentUrl,
  deviceGuide,
  deviceKind,
  installGuide,
  lineExternalUrl,
  plainText,
  splitEmphasis,
  type InstallGuide,
} from './installGuides'

const UA = {
  iphone26Safari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  iphone17Safari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphone16Safari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1',
  ipad26Desktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.122 Mobile/15E148 Safari/604.1',
  iphoneFirefox:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/143.0 Mobile/15E148 Safari/605.1.15',
  iphoneEdge:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/140.0.3485.94 Mobile/15E148 Safari/605.1.15',
  iphoneInstagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 400.0.0.0 (iPhone15,2; iOS 18_6; en_US; en; scale=3.00; 1179x2556; 0)',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  androidSamsung:
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 15; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0',
  androidEdge:
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 EdgA/140.0.0.0',
  androidFacebook:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.0;]',
  desktopChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  desktopEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  desktopFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0',
}

function platform(ua: string, extra: { platform?: string; maxTouchPoints?: number } = {}): PlatformInfo {
  return detectPlatform({
    userAgent: ua,
    platform: extra.platform ?? '',
    maxTouchPoints: extra.maxTouchPoints ?? 0,
    hasTelegramProxy: false,
    standalone: false,
  })
}

function guideFor(ua: string, opts: { canPrompt?: boolean; standalone?: boolean; platform?: string; maxTouchPoints?: number } = {}) {
  const p = platform(ua, opts)
  const method = installMethod(p, { standalone: opts.standalone ?? false, canPrompt: opts.canPrompt ?? false })
  return { p, method, guide: installGuide(method, p) }
}

const allText = (g: InstallGuide) => [g.title, g.intro, g.note ?? '', ...g.steps.map((s) => s.text)].join('\n')

// One platform per method, so every method is exercised with a fitting device.
const SAMPLES: [string, PlatformInfo][] = [
  ['iphone26', platform(UA.iphone26Safari)],
  ['iphone17', platform(UA.iphone17Safari)],
  ['ipad', platform(UA.ipad26Desktop, { platform: 'MacIntel', maxTouchPoints: 5 })],
  ['iphoneChrome', platform(UA.iphoneChrome)],
  ['androidChrome', platform(UA.androidChrome)],
  ['androidFacebook', platform(UA.androidFacebook)],
  ['iphoneInstagram', platform(UA.iphoneInstagram)],
  ['desktopChrome', platform(UA.desktopChrome)],
  ['macSafari', platform(UA.macSafari)],
  ['desktopFirefox', platform(UA.desktopFirefox)],
]

describe('installGuide', () => {
  it('has a guide with real steps for every method on every sample device', () => {
    for (const method of INSTALL_METHODS) {
      for (const [name, p] of SAMPLES) {
        const g = installGuide(method, p)
        expect(g.title, `${method} / ${name}`).toBeTruthy()
        expect(g.intro, `${method} / ${name}`).toBeTruthy()
        expect(g.steps.length, `${method} / ${name}`).toBeGreaterThan(0)
        for (const step of g.steps) {
          expect(plainText(step.text).trim(), `${method} / ${name}`).not.toBe('')
          expect(step.glyph).toBeTruthy()
        }
        if (g.note !== undefined) expect(g.note.trim()).not.toBe('')
      }
    }
  })

  it('lists every InstallMethod exactly once', () => {
    expect(new Set(INSTALL_METHODS).size).toBe(INSTALL_METHODS.length)
    expect(INSTALL_METHODS).toHaveLength(11)
  })

  it('iOS 26 Safari: ••• → Share → Add to Home Screen, with Open as Web App left on', () => {
    const { method, guide } = guideFor(UA.iphone26Safari)
    expect(method).toBe('ios-safari')
    const text = allText(guide)
    expect(text).toContain('Open as Web App')
    expect(text).toContain('Edit Actions')
    expect(guide.steps.map((s) => s.glyph)).toEqual(['more-horiz', 'share', 'plus-square', 'toggle', 'home'])
  })

  it('iPad on iOS 26 goes through View More', () => {
    const { p, guide } = guideFor(UA.ipad26Desktop, { platform: 'MacIntel', maxTouchPoints: 5 })
    expect(p.isIPad).toBe(true)
    expect(allText(guide)).toContain('View More')
    expect(allText(guide)).toContain('Open as Web App')
  })

  it('iOS 17/18 Safari has no Open as Web App switch and no ••• step', () => {
    const { guide } = guideFor(UA.iphone17Safari)
    expect(allText(guide)).not.toContain('Open as Web App')
    expect(guide.steps[0].glyph).toBe('share')
    expect(guide.note).toBeUndefined()
  })

  it('iOS 16 mentions the 16.4 requirement for notifications', () => {
    expect(guideFor(UA.iphone16Safari).guide.note).toContain('16.4')
  })

  it('third-party iOS browsers each start from their own Share button', () => {
    expect(guideFor(UA.iphoneChrome).guide.steps[0].text).toContain('right of the address bar')
    expect(guideFor(UA.iphoneFirefox).guide.steps[0].glyph).toBe('menu')
    expect(guideFor(UA.iphoneEdge).guide.steps[0].text).toContain('•••')
    for (const ua of [UA.iphoneChrome, UA.iphoneFirefox, UA.iphoneEdge]) {
      const { method, guide } = guideFor(ua)
      expect(method).toBe('ios-other-browser')
      expect(allText(guide)).toContain('Add to Home Screen')
    }
  })

  it('Android Chrome uses the current menu label and keeps the old ones', () => {
    const { method, guide } = guideFor(UA.androidChrome)
    expect(method).toBe('android-chrome-menu')
    const text = allText(guide)
    expect(text).toContain('Install and create shortcut')
    expect(text).toContain('Add to Home screen')
    expect(guide.recommendChrome).toBeFalsy()
  })

  it('Samsung, Firefox and Edge on Android recommend Chrome but keep their own steps', () => {
    const cases: [string, string, string][] = [
      [UA.androidSamsung, 'samsung-menu', 'Add page to'],
      [UA.androidFirefox, 'firefox-android-menu', 'Add app to Home screen'],
      [UA.androidEdge, 'edge-android-menu', 'Add to phone'],
    ]
    for (const [ua, expected, label] of cases) {
      const { method, guide } = guideFor(ua)
      expect(method).toBe(expected)
      expect(guide.recommendChrome).toBe(true)
      expect(allText(guide)).toContain(label)
    }
  })

  it('a prompt wins on Android Chrome and desktop', () => {
    expect(guideFor(UA.androidChrome, { canPrompt: true }).method).toBe('prompt')
    const desktop = guideFor(UA.desktopChrome, { canPrompt: true })
    expect(desktop.method).toBe('prompt')
    expect(allText(desktop.guide)).toContain('own window')
  })

  it('in-app browsers point to Safari on iOS and Chrome on Android', () => {
    const ios = guideFor(UA.iphoneInstagram)
    expect(ios.method).toBe('in-app-browser')
    expect(ios.guide.title).toContain('Safari')
    expect(ios.guide.intro).toContain('Instagram')
    const android = guideFor(UA.androidFacebook)
    expect(android.method).toBe('in-app-browser')
    expect(android.guide.title).toContain('Chrome')
    expect(android.guide.steps[0].glyph).toBe('chrome')
  })

  it('desktop guides follow the browser', () => {
    expect(allText(guideFor(UA.desktopChrome).guide)).toContain('Cast, save, and share')
    expect(allText(guideFor(UA.desktopEdge).guide)).toContain('App available')
    expect(allText(guideFor(UA.macSafari).guide)).toContain('Add to Dock')
    const firefox = guideFor(UA.desktopFirefox)
    expect(firefox.method).toBe('unsupported')
    expect(firefox.guide.intro).toContain('Firefox')
  })

  it('standalone is the installed guide', () => {
    const { method, guide } = guideFor(UA.iphone26Safari, { standalone: true })
    expect(method).toBe('installed')
    expect(guide.title).toMatch(/using the app/)
  })
})

describe('deviceGuide', () => {
  it('covers each device tab', () => {
    expect(allText(deviceGuide('ios'))).toContain('Open as Web App')
    expect(allText(deviceGuide('ios'))).toContain('View More')
    expect(allText(deviceGuide('android'))).toContain('Install and create shortcut')
    expect(allText(deviceGuide('desktop'))).toContain('Add to Dock')
  })
})

describe('labels', () => {
  it('names devices and browsers', () => {
    expect(deviceKind(platform(UA.iphone26Safari))).toBe('ios')
    expect(deviceKind(platform(UA.androidChrome))).toBe('android')
    expect(deviceKind(platform(UA.desktopChrome))).toBe('desktop')
    expect(browserName(platform(UA.iphoneInstagram))).toBe('Instagram’s browser')
    expect(browserName(platform(UA.androidSamsung))).toBe('Samsung Internet')
  })
})

describe('splitEmphasis', () => {
  it('splits bold runs', () => {
    expect(splitEmphasis('Tap **Share**, then **Add**.')).toEqual([
      { text: 'Tap ', strong: false },
      { text: 'Share', strong: true },
      { text: ', then ', strong: false },
      { text: 'Add', strong: true },
      { text: '.', strong: false },
    ])
  })

  it('leaves plain and unmatched text alone', () => {
    expect(splitEmphasis('plain')).toEqual([{ text: 'plain', strong: false }])
    expect(splitEmphasis('a ** b')).toEqual([{ text: 'a ** b', strong: false }])
    expect(plainText('Tap **Share**')).toBe('Tap Share')
  })
})

describe('chromeIntentUrl', () => {
  it('builds the documented intent:// form with a fallback', () => {
    expect(chromeIntentUrl('https://nixgensolutions.com/workspace/install?src=iab')).toBe(
      'intent://nixgensolutions.com/workspace/install?src=iab#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=https%3A%2F%2Fnixgensolutions.com%2Fworkspace%2Finstall%3Fsrc%3Diab;end',
    )
  })

  it('keeps the port and scheme of a local URL', () => {
    expect(chromeIntentUrl('http://localhost:6980/workspace/install')).toMatch(
      /^intent:\/\/localhost:6980\/workspace\/install#Intent;scheme=http;/,
    )
  })
})

describe('lineExternalUrl', () => {
  it('adds openExternalBrowser=1, keeping other params', () => {
    expect(lineExternalUrl('https://a.example/install?x=1')).toBe('https://a.example/install?x=1&openExternalBrowser=1')
  })
})

describe('bannerSnoozed', () => {
  const now = 1_800_000_000_000
  it('snoozes for 14 days', () => {
    expect(bannerSnoozed(null, now)).toBe(false)
    expect(bannerSnoozed('garbage', now)).toBe(false)
    expect(bannerSnoozed(String(now - 1000), now)).toBe(true)
    expect(bannerSnoozed(String(now - BANNER_SNOOZE_MS + 1), now)).toBe(true)
    expect(bannerSnoozed(String(now - BANNER_SNOOZE_MS), now)).toBe(false)
  })

  it('ignores a timestamp from the far future', () => {
    expect(bannerSnoozed(String(now + BANNER_SNOOZE_MS * 10), now)).toBe(false)
  })
})
