import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { constants, inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { APPLE_SPLASH, splashHref, splashMedia, type AppleSplash } from './splash'

const HERE = path.dirname(fileURLToPath(import.meta.url))
// site/public: splashHref() and the icon URLs are paths under it.
const PUBLIC = path.resolve(HERE, '../../../public')
const THEMES = ['light', 'dark'] as const
const REGENERATE = 'run `node scripts/generate-pwa-assets.mjs` from site/'

const hex = (rgb: number[]) => `#${rgb.slice(0, 3).map((n) => n.toString(16).padStart(2, '0')).join('')}`

interface Png {
  width: number
  height: number
  transparent: boolean
  /** The top-left pixel as [r, g, b, a]. */
  corner: number[]
}

/** Size, transparency and top-left pixel of a PNG under public/, or null when it's missing. */
function readPng(url: string): Png | null {
  const file = path.join(PUBLIC, ...url.split('/'))
  if (!existsSync(file)) return null
  const png = readFileSync(file)
  expect(png.subarray(0, 8).toString('hex'), `${url} is not a PNG`).toBe('89504e470d0a1a0a')
  expect(png.toString('latin1', 12, 16), `${url} has no IHDR`).toBe('IHDR')
  const depth = png[24]
  const colourType = png[25]
  let palette = Buffer.alloc(0)
  let alpha: Buffer | null = null
  const idat: Buffer[] = []
  for (let at = 8; at + 8 <= png.length; at += 12 + png.readUInt32BE(at)) {
    const body = png.subarray(at + 8, at + 8 + png.readUInt32BE(at))
    const type = png.toString('latin1', at + 4, at + 8)
    if (type === 'PLTE') palette = body
    if (type === 'tRNS') alpha = body
    if (type === 'IDAT') idat.push(body)
  }
  // No PNG filter predicts the first pixel of the first row, so the first few
  // inflated bytes hold it as stored, after the row's filter-type byte.
  const row = inflateSync(Buffer.concat(idat).subarray(0, 1024), { finishFlush: constants.Z_SYNC_FLUSH })
  const sample = (n: number) => row[1 + n * (depth === 16 ? 2 : 1)] // a 16-bit sample's high byte
  const packed = row[1] >> (8 - Math.min(depth, 8)) // index or level when pixels share a byte
  const grey = depth < 8 ? Math.round((packed * 255) / ((1 << depth) - 1)) : sample(0)
  const corners: Record<number, number[]> = {
    0: [grey, grey, grey, 255],
    2: [sample(0), sample(1), sample(2), 255],
    3: [...palette.subarray(packed * 3, packed * 3 + 3), alpha?.[packed] ?? 255],
    4: [grey, grey, grey, sample(1)],
    6: [sample(0), sample(1), sample(2), sample(3)],
  }
  expect(corners[colourType], `${url} has unknown PNG colour type ${colourType}`).toBeDefined()
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
    transparent: colourType === 4 || colourType === 6 || alpha !== null,
    corner: corners[colourType],
  }
}

/**
 * The --ink-900 values (page colour) set in index.css's plain `:root {` (light)
 * or `.dark {` (dark) blocks: the generator paints the launch screens with them.
 */
function pageColours(theme: (typeof THEMES)[number]): string[] {
  const css = readFileSync(path.resolve(HERE, '../index.css'), 'utf8')
  const selector = theme === 'light' ? ':root' : '\\.dark'
  const found = new Set<string>()
  for (const [, body] of css.matchAll(new RegExp(`(?:^|[\\s;{}])${selector}\\s*\\{([^}]*)\\}`, 'g'))) {
    const rgb = body.match(/--ink-900:\s*(\d+)\s+(\d+)\s+(\d+)\s*;/)
    if (rgb) found.add(hex(rgb.slice(1, 4).map(Number)))
  }
  return [...found]
}

const device = (s: AppleSplash) => `${s.deviceWidth}x${s.deviceHeight}@${s.ratio}`

describe('APPLE_SPLASH', () => {
  // [image width, image height, device-width, device-height, ratio], portrait.
  const iphones = [
    [1320, 2868, 440, 956, 3],
    [1206, 2622, 402, 874, 3],
    [1260, 2736, 420, 912, 3],
    [1290, 2796, 430, 932, 3],
    [1179, 2556, 393, 852, 3],
    [1284, 2778, 428, 926, 3],
    [1170, 2532, 390, 844, 3],
    [1125, 2436, 375, 812, 3],
    [1242, 2688, 414, 896, 3],
    [828, 1792, 414, 896, 2],
    [750, 1334, 375, 667, 2],
    [1242, 2208, 414, 736, 3],
  ]
  const ipads = [
    [2048, 2732, 1024, 1366, 2],
    [1668, 2388, 834, 1194, 2],
    [1640, 2360, 820, 1180, 2],
    [1668, 2224, 834, 1112, 2],
    [1620, 2160, 810, 1080, 2],
    [1488, 2266, 744, 1133, 2],
    // iPad Pro 13" and 11" (M4 and later), iPad mini 5th gen and the 9.7" iPads.
    [2064, 2752, 1032, 1376, 2],
    [1668, 2420, 834, 1210, 2],
    [1536, 2048, 768, 1024, 2],
  ]
  const has = (orientation: AppleSplash['orientation'], [w, h, dw, dh, ratio]: number[]) =>
    APPLE_SPLASH.some(
      (s) =>
        s.orientation === orientation &&
        s.width === (orientation === 'portrait' ? w : h) &&
        s.height === (orientation === 'portrait' ? h : w) &&
        s.deviceWidth === dw &&
        s.deviceHeight === dh &&
        s.ratio === ratio,
    )

  it('covers every supported iPhone in portrait', () => {
    for (const size of iphones) expect(has('portrait', size), size.join(' ')).toBe(true)
  })

  it('covers the iPads in both orientations', () => {
    for (const size of ipads) {
      expect(has('portrait', size), size.join(' ')).toBe(true)
      expect(has('landscape', size), size.join(' ')).toBe(true)
    }
  })

  it('lists nothing else', () => {
    expect(APPLE_SPLASH).toHaveLength(iphones.length + ipads.length * 2)
  })

  it('gives every landscape image a portrait twin', () => {
    for (const s of APPLE_SPLASH.filter((s) => s.orientation === 'landscape')) {
      expect(APPLE_SPLASH.some((p) => p.orientation === 'portrait' && device(p) === device(s)), device(s)).toBe(true)
    }
  })

  it('sizes each image as the portrait CSS size times the ratio, turned with the device', () => {
    for (const s of APPLE_SPLASH) {
      expect(s.deviceWidth, device(s)).toBeLessThan(s.deviceHeight)
      expect([2, 3]).toContain(s.ratio)
      const [w, h] = [s.deviceWidth * s.ratio, s.deviceHeight * s.ratio]
      expect([s.width, s.height], device(s)).toEqual(s.orientation === 'portrait' ? [w, h] : [h, w])
    }
  })

  it('has no duplicate entries', () => {
    const keys = APPLE_SPLASH.map((s) => `${device(s)} ${s.orientation}`)
    expect(new Set(keys).size).toBe(keys.length)
    for (const theme of THEMES) {
      const hrefs = APPLE_SPLASH.map((s) => splashHref(s, theme))
      expect(new Set(hrefs).size).toBe(hrefs.length)
    }
  })

  it('builds well-formed, distinct media queries', () => {
    const all = APPLE_SPLASH.flatMap((s) => THEMES.map((theme) => splashMedia(s, theme)))
    expect(new Set(all).size).toBe(all.length)
    for (const s of APPLE_SPLASH) {
      for (const theme of THEMES) {
        expect(splashMedia(s, theme)).toBe(
          `(device-width: ${s.deviceWidth}px) and (device-height: ${s.deviceHeight}px)` +
            ` and (-webkit-device-pixel-ratio: ${s.ratio}) and (orientation: ${s.orientation})` +
            ` and (prefers-color-scheme: ${theme})`,
        )
        expect(splashMedia(s, theme)).toMatch(
          /^\(device-width: \d+px\) and \(device-height: \d+px\) and \(-webkit-device-pixel-ratio: [23]\) and \(orientation: (portrait|landscape)\) and \(prefers-color-scheme: (light|dark)\)$/,
        )
      }
    }
  })

  it('points each href at its own file under /workspace/icons/splash/', () => {
    for (const s of APPLE_SPLASH) {
      for (const theme of THEMES) {
        expect(splashHref(s, theme)).toBe(`/workspace/icons/splash/apple-splash-${s.width}x${s.height}-${theme}.png`)
      }
    }
  })
})

describe('launch screen files', () => {
  const page = { light: pageColours('light'), dark: pageColours('dark') }
  const cases = APPLE_SPLASH.flatMap((s) =>
    THEMES.map((theme) => {
      const href = splashHref(s, theme)
      return { href, file: path.posix.basename(href), width: s.width, height: s.height, theme }
    }),
  )

  it.each(THEMES)('index.css sets one %s page colour', (theme) => {
    expect(page[theme], `--ink-900 in index.css's plain ${theme === 'light' ? ':root' : '.dark'} blocks`).toHaveLength(1)
  })

  it.each(cases)('$file is an opaque $width×$height PNG in the page colour', ({ href, width, height, theme }) => {
    const png = readPng(href)
    expect(png, `${href} is missing: ${REGENERATE}`).not.toBeNull()
    expect([png!.width, png!.height]).toEqual([width, height])
    expect(png!.transparent).toBe(false)
    // The app's first paint is ink-900: any other colour flashes at the hand-off.
    expect(hex(png!.corner), `${href} is not the ${theme} --ink-900 in index.css: ${REGENERATE}`).toBe(page[theme][0])
  })
})

describe('PWA icons', () => {
  const brand = readFileSync(path.join(PUBLIC, 'workspace', 'favicon.svg'), 'utf8')
    .match(/<rect\b[^>]*\bfill="(#[0-9a-f]{6})"/i)?.[1]
    ?.toLowerCase()

  // [file, size, full bleed]. Full-bleed icons are opaque brand blue to the
  // edge: iOS paints transparency black and launchers crop maskable icons to
  // their own shape. The others keep transparent corners.
  const icons: Array<[string, number, boolean]> = [
    ['icon-192.png', 192, false],
    ['icon-512.png', 512, false],
    ['icon-maskable-192.png', 192, true],
    ['icon-maskable-512.png', 512, true],
    ['icon-monochrome-512.png', 512, false],
    ['apple-touch-icon.png', 180, true],
    ['badge-96.png', 96, false],
    ['shortcut-tasks-96.png', 96, true],
    ['shortcut-chat-96.png', 96, true],
    ['shortcut-calendar-96.png', 96, true],
    ['shortcut-projects-96.png', 96, true],
  ]

  it('takes the brand colour from the favicon tile', () => {
    expect(brand).toMatch(/^#[0-9a-f]{6}$/)
  })

  it.each(icons)('%s is %i px square', (file, size, fullBleed) => {
    const png = readPng(`/workspace/icons/${file}`)
    expect(png, `${file} is missing: ${REGENERATE}`).not.toBeNull()
    expect([png!.width, png!.height]).toEqual([size, size])
    if (fullBleed) {
      expect(png!.transparent, `${file} must be opaque`).toBe(false)
      expect(hex(png!.corner), `${file} must be the favicon's brand colour to the edge: ${REGENERATE}`).toBe(brand)
    } else {
      expect(png!.transparent, `${file} needs its alpha channel`).toBe(true)
      expect(png!.corner[3], `${file} must have transparent corners`).toBe(0)
    }
  })
})
