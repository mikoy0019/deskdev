// Web-only. iOS launch screens for the installed app. iOS ignores the
// manifest's background_color: without an apple-touch-startup-image whose
// media query matches the device exactly (CSS size, pixel ratio, orientation)
// a cold start shows a blank white screen. prefers-color-scheme picks the
// light or dark image, matching ink-900 so the hand-off to the app is seamless.
//
// Import-free on purpose: scripts/generate-pwa-assets.mjs loads this file with
// Node's type stripping, so the PNGs it writes and the <link>s the workspace
// layout renders come from the same list.

export interface AppleSplash {
  /** Image pixels, as oriented (landscape images are wider than tall). */
  width: number
  height: number
  /** Portrait CSS pixels: iOS keeps device-width/height fixed when it rotates. */
  deviceWidth: number
  deviceHeight: number
  ratio: number
  orientation: 'portrait' | 'landscape'
}

// [image width, image height, device-width, device-height, pixel ratio], portrait.
type Size = readonly [number, number, number, number, number]

const IPHONES: Size[] = [
  [1320, 2868, 440, 956, 3], // 16, 17 Pro Max
  [1206, 2622, 402, 874, 3], // 16 Pro, 17, 17 Pro
  [1260, 2736, 420, 912, 3], // Air
  [1290, 2796, 430, 932, 3], // 14 Pro Max, 15 Plus/Pro Max, 16 Plus
  [1179, 2556, 393, 852, 3], // 14 Pro, 15, 15 Pro, 16
  [1284, 2778, 428, 926, 3], // 12/13 Pro Max, 14 Plus
  [1170, 2532, 390, 844, 3], // 12, 13, 14, 16e
  [1125, 2436, 375, 812, 3], // X, XS, 11 Pro, 12/13 mini
  [1242, 2688, 414, 896, 3], // XS Max, 11 Pro Max
  [828, 1792, 414, 896, 2], // XR, 11
  [750, 1334, 375, 667, 2], // SE 2nd/3rd gen, 6–8
  [1242, 2208, 414, 736, 3], // 6–8 Plus
]

const IPADS: Size[] = [
  [2064, 2752, 1032, 1376, 2], // Pro 13" (M4 and later)
  [2048, 2732, 1024, 1366, 2], // Pro 12.9", Air 13"
  [1668, 2420, 834, 1210, 2], // Pro 11" (M4 and later)
  [1668, 2388, 834, 1194, 2], // Pro 11" (1st–4th gen)
  [1640, 2360, 820, 1180, 2], // Air 10.9"/11", iPad 10th gen and A16
  [1668, 2224, 834, 1112, 2], // Air 3rd gen, Pro 10.5"
  [1620, 2160, 810, 1080, 2], // iPad 7th–9th gen
  [1488, 2266, 744, 1133, 2], // mini 6th gen, mini A17 Pro
  [1536, 2048, 768, 1024, 2], // mini 5th gen, 9.7" iPads
]

function portrait([width, height, deviceWidth, deviceHeight, ratio]: Size): AppleSplash {
  return { width, height, deviceWidth, deviceHeight, ratio, orientation: 'portrait' }
}

function landscape(size: Size): AppleSplash {
  return { ...portrait(size), width: size[1], height: size[0], orientation: 'landscape' }
}

// iPads open apps in whichever way they're held; iPhones launch them upright.
export const APPLE_SPLASH: AppleSplash[] = [
  ...IPHONES.map(portrait),
  ...IPADS.flatMap((size) => [portrait(size), landscape(size)]),
]

/** Served from public/workspace/, i.e. /workspace/* on every host (see assetUrl). */
export function splashHref(s: AppleSplash, theme: 'light' | 'dark'): string {
  return `/workspace/icons/splash/apple-splash-${s.width}x${s.height}-${theme}.png`
}

export function splashMedia(s: AppleSplash, theme: 'light' | 'dark'): string {
  return (
    `(device-width: ${s.deviceWidth}px) and (device-height: ${s.deviceHeight}px)` +
    ` and (-webkit-device-pixel-ratio: ${s.ratio}) and (orientation: ${s.orientation})` +
    ` and (prefers-color-scheme: ${theme})`
  )
}
