#!/usr/bin/env node
// DeskDev's PWA icons and iOS launch screens, all drawn from one artwork:
// public/workspace/favicon.svg (the brand tile and its white "D"). Everything
// lands in public/workspace/icons/ — commit it.
//
//   node scripts/generate-pwa-assets.mjs           regenerate what changed
//   node scripts/generate-pwa-assets.mjs --check   exit 1 if anything is stale
//   node scripts/generate-pwa-assets.mjs --force   re-encode every file
//
// Not a build step on purpose: sharp is only an optional dependency of next.
// Files whose pixels come out unchanged are left alone, so a rerun (even on a
// machine whose zlib picks different bytes) produces no diff. --force is for
// after changing the encoder.
//
// The launch-screen sizes live in src/deskdev/pwa/splash.ts, which the
// workspace layout renders as <link>s too. Node loads it with its built-in
// type stripping (Node 22.18+), so the two can't drift apart. Their colours
// come from src/deskdev/index.css; splash.test.ts fails when the PNGs on disk
// no longer match either.

import { createRequire } from 'node:module'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = path.join(SITE, 'public')
const ICONS = path.join(PUBLIC, 'workspace', 'icons')
const FAVICON = path.join(PUBLIC, 'workspace', 'favicon.svg')
const SPLASH_TS = path.join(SITE, 'src', 'deskdev', 'pwa', 'splash.ts')
const INDEX_CSS = path.join(SITE, 'src', 'deskdev', 'index.css')
const ICONS_URL = '/workspace/icons/'
const SPLASH_FILE = /^apple-splash-\d+x\d+-(light|dark)\.png$/
const CHECK = process.argv.includes('--check')
const FORCE = process.argv.includes('--force')

const SPLASH_LOGO = 96 // CSS px, times the device pixel ratio

// The "D" relative to the favicon, where it is half the tile's height.
// Maskable: its farthest corner sits 26.6% from the centre, well inside the
// 40% safe circle every launcher mask keeps.
const MASKABLE_D = 0.85
// Badge: ~65% of the height. Android draws it at status-bar size and only
// reads the alpha channel.
const BADGE_D = 1.3

// Manifest shortcuts reuse the sidebar's lucide icons (components/Sidebar.tsx).
const SHORTCUTS = {
  tasks: 'square-check-big', // CheckSquare
  chat: 'message-circle',
  calendar: 'calendar',
  projects: 'briefcase',
}

function fail(message, cause) {
  console.error(`generate-pwa-assets: ${message}`)
  if (cause) console.error(cause)
  process.exit(1)
}

async function loadSharp() {
  try {
    return (await import('sharp')).default
  } catch (err) {
    fail(
      'sharp is not installed. It comes with next as an optional dependency;\n' +
        'reinstall site/ dependencies with optional packages enabled (npm install --include=optional).',
      err,
    )
  }
}

async function loadSplash() {
  try {
    return await import(pathToFileURL(SPLASH_TS).href)
  } catch (err) {
    if (err?.code === 'ERR_UNKNOWN_FILE_EXTENSION') {
      fail(`Node ${process.version} can't load splash.ts. Use Node 22.18+ (built-in TypeScript type stripping).`)
    }
    throw err
  }
}

/** The real lucide geometry: each icon module exports its element list. */
async function lucideIcon(name) {
  let pkg
  try {
    pkg = createRequire(import.meta.url).resolve('lucide-react/package.json')
  } catch (err) {
    fail('lucide-react is not installed: install site/ dependencies first.', err)
  }
  const file = path.join(path.dirname(pkg), 'dist', 'esm', 'icons', `${name}.js`)
  const { __iconNode } = await import(pathToFileURL(file).href).catch((err) => fail(`no lucide icon "${name}"`, err))
  if (!Array.isArray(__iconNode)) fail(`lucide-react's "${name}" no longer exports __iconNode`)
  return __iconNode
}

/**
 * Each theme's page colour (--ink-900) in src/deskdev/index.css, so the launch
 * screen hands over to the app's first paint without a flash.
 */
async function pageColours() {
  const css = await readFile(INDEX_CSS, 'utf8').catch((err) => fail(`can't read ${INDEX_CSS}`, err))
  const colours = {}
  for (const [theme, selector] of Object.entries({ light: ':root', dark: '.dark' })) {
    // Plain `:root {` and `.dark {` blocks only, not `:root[data-density=…] {`.
    const blocks = new RegExp(`(?:^|[\\s;{}])${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'g')
    const found = new Set()
    for (const [, body] of css.matchAll(blocks)) {
      const rgb = body.match(/--ink-900:\s*(\d+)\s+(\d+)\s+(\d+)\s*;/)
      if (rgb) found.add(`#${rgb.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`)
    }
    if (found.size !== 1) {
      fail(`index.css should set --ink-900 to one "R G B" triplet in a plain "${selector} {" block (found ${found.size}); update pageColours().`)
    }
    colours[theme] = [...found][0]
  }
  return colours
}

const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]

const escapeAttr = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** favicon.svg's geometry: a square viewBox, the brand <rect> and the "D" <path>. */
function parseFavicon(source) {
  const root = source.match(/<svg\b[^>]*>/)
  const rect = source.match(/<rect\b[^>]*>/)?.[0]
  const letter = source.match(/<path\b[^>]*>/)?.[0]
  const end = source.lastIndexOf('</svg>')
  const [x, y, w, h] = (root && attr(root[0], 'viewBox')?.trim().split(/[\s,]+/).map(Number)) ?? []
  const art = {
    grid: w,
    body: root && end > 0 ? source.slice(root.index + root[0].length, end).trim() : '',
    brand: rect && attr(rect, 'fill'),
    glyph: letter && attr(letter, 'fill'),
    d: letter && attr(letter, 'd'),
  }
  if (x !== 0 || y !== 0 || !(w > 0) || w !== h || !art.body || !art.brand || !art.glyph || !art.d) {
    fail('favicon.svg is no longer a square viewBox with a filled <rect> tile and a filled "D" <path>; update parseFavicon().')
  }
  return art
}

function svg(width, height, body, viewBox = `0 0 ${width} ${height}`) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}">${body}</svg>`
}

/** Every asset as { file (relative to icons/), kind, markup }. */
async function plan(art, splashes, page) {
  const grid = `0 0 ${art.grid} ${art.grid}`
  const c = art.grid / 2
  const bleed = `<rect width="${art.grid}" height="${art.grid}" fill="${art.brand}"/>`
  const letter = (scale) =>
    `<path d="${art.d}" fill="${art.glyph}" transform="translate(${c} ${c}) scale(${scale}) translate(${-c} ${-c})"/>`
  const tile = (size) => svg(size, size, art.body, grid)

  const assets = [
    // purpose "any": the favicon itself, rounded corners and all.
    { file: 'icon-192.png', kind: 'rgba', markup: tile(192) },
    { file: 'icon-512.png', kind: 'rgba', markup: tile(512) },
    // purpose "maskable": full bleed, so any launcher shape crops blue, never transparency.
    { file: 'icon-maskable-192.png', kind: 'opaque', markup: svg(192, 192, bleed + letter(MASKABLE_D), grid) },
    { file: 'icon-maskable-512.png', kind: 'opaque', markup: svg(512, 512, bleed + letter(MASKABLE_D), grid) },
    { file: 'icon-monochrome-512.png', kind: 'alpha', markup: svg(512, 512, letter(MASKABLE_D), grid) },
    // iOS rounds the corners itself and paints transparency black. The D at its
    // favicon size (half the tile) also stays clear of the Liquid Glass rim.
    { file: 'apple-touch-icon.png', kind: 'opaque', markup: svg(180, 180, bleed + letter(1), grid) },
    { file: 'badge-96.png', kind: 'alpha', markup: svg(96, 96, letter(BADGE_D), grid) },
  ]

  // Full bleed with the glyph at half size: inside the safe zone, so the
  // manifest can offer them as "any" or "maskable".
  for (const [name, icon] of Object.entries(SHORTCUTS)) {
    const elements = (await lucideIcon(icon))
      .map(([tag, attrs]) => {
        const list = Object.entries(attrs).filter(([key]) => key !== 'key')
        return `<${tag}${list.map(([key, value]) => ` ${key}="${escapeAttr(value)}"`).join('')}/>`
      })
      .join('')
    const glyph =
      `<g transform="translate(6 6) scale(0.5)" fill="none" stroke="${art.glyph}" stroke-width="2"` +
      ` stroke-linecap="round" stroke-linejoin="round">${elements}</g>`
    const body = `<rect width="24" height="24" fill="${art.brand}"/>${glyph}`
    assets.push({ file: `shortcut-${name}-96.png`, kind: 'opaque', markup: svg(96, 96, body, '0 0 24 24') })
  }

  const seen = new Map()
  for (const s of splashes.APPLE_SPLASH) {
    for (const theme of ['light', 'dark']) {
      const href = splashes.splashHref(s, theme)
      if (!href.startsWith(`${ICONS_URL}splash/`) || !SPLASH_FILE.test(path.posix.basename(href))) {
        fail(`splashHref() must stay inside ${ICONS_URL}splash/ and match ${SPLASH_FILE}: ${href}`)
      }
      // Whole pixels, so the tile's straight edges stay crisp.
      const size = Math.round(SPLASH_LOGO * s.ratio)
      const x = Math.round((s.width - size) / 2)
      const y = Math.round((s.height - size) / 2)
      const markup = svg(
        s.width,
        s.height,
        `<rect width="${s.width}" height="${s.height}" fill="${page[theme]}"/>` +
          `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="${grid}">${art.body}</svg>`,
      )
      const file = href.slice(ICONS_URL.length)
      if (seen.has(file)) {
        if (seen.get(file) !== markup) fail(`two APPLE_SPLASH entries share ${file} but draw different images`)
        continue
      }
      seen.set(file, markup)
      assets.push({ file, kind: 'opaque', markup })
    }
  }
  return assets
}

async function rasterize(sharp, { file, kind, markup }) {
  const { data, info } = await sharp(Buffer.from(markup)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = info
  if (kind === 'opaque') {
    const rgb = Buffer.alloc(width * height * 3)
    for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
      if (data[i + 3] !== 255) fail(`${file} must be fully opaque, but pixel ${i / 4} has alpha ${data[i + 3]}`)
      rgb[j] = data[i]
      rgb[j + 1] = data[i + 1]
      rgb[j + 2] = data[i + 2]
    }
    return { data: rgb, width, height, channels: 3 }
  }
  // Only the alpha channel is read (Android tints badges and monochrome
  // icons): make every pixel white and let compression have the rest.
  if (kind === 'alpha') for (let i = 0; i < data.length; i += 4) data[i] = data[i + 1] = data[i + 2] = 255
  return { data, width, height, channels: 4 }
}

function countColours({ data, channels }, limit) {
  const seen = new Set()
  for (let i = 0; i < data.length && seen.size <= limit; i += channels) {
    seen.add(channels === 4 ? data.readUInt32BE(i) : (data[i] << 16) | (data[i + 1] << 8) | data[i + 2])
  }
  return seen.size
}

function isGrey({ data, channels }) {
  for (let i = 0; i < data.length; i += channels) {
    if (data[i] !== data[i + 1] || data[i] !== data[i + 2]) return false
  }
  return true
}

/** A PNG's pixels as sRGB, or null when it doesn't have alpha exactly where `like` does. */
async function decode(sharp, png, like) {
  const image = sharp(png)
  const { hasAlpha } = await image.metadata()
  if (hasAlpha !== (like.channels === 4)) return null
  const { data, info } = await image.toColourspace('srgb').raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, channels: info.channels }
}

const samePixels = (a, b) =>
  !!a && a.width === b.width && a.height === b.height && a.channels === b.channels && a.data.equals(b.data)

/** How a PNG stores its pixels, from the colour type in its IHDR chunk. */
const pngMode = (png) => ({ 0: 'grey', 2: 'rgb', 3: 'palette', 4: 'grey+a', 6: 'rgba' })[png[25]] ?? `type ${png[25]}`

/**
 * The smallest PNG that decodes to exactly these pixels. Every candidate is
 * decoded and compared: the quantiser behind palette output isn't exact even
 * under 256 colours, so a palette is used only where it happens to be.
 */
async function encode(sharp, raw) {
  const { width, height, channels } = raw
  const colours = countColours(raw, 256)
  const grey = isGrey(raw)
  const candidates = []
  for (const adaptiveFiltering of [true, false]) {
    candidates.push({ adaptiveFiltering })
    if (grey) candidates.push({ adaptiveFiltering, colourspace: 'b-w' })
    if (colours <= 256) {
      // 256 slots tend to keep colours exact; just enough slots allows 1/2/4-bit pixels.
      for (const slots of new Set([256, Math.max(2, colours)])) {
        candidates.push({ adaptiveFiltering, palette: true, colours: slots, quality: 100, dither: 0, effort: 10 })
      }
    }
  }
  let best = null
  for (const { colourspace, ...options } of candidates) {
    let image = sharp(raw.data, { raw: { width, height, channels } })
    if (colourspace) image = image.toColourspace(colourspace)
    const png = await image.png({ compressionLevel: 9, ...options }).toBuffer()
    if ((!best || png.length < best.length) && samePixels(await decode(sharp, png, raw), raw)) best = png
  }
  if (!best) fail('no PNG encoding reproduced the image exactly')
  return best
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`

async function main() {
  const sharp = await loadSharp()
  const splashes = await loadSplash()
  const art = parseFavicon(await readFile(FAVICON, 'utf8'))
  const assets = await plan(art, splashes, await pageColours())

  const counts = { created: 0, updated: 0, unchanged: 0, stale: 0, removed: 0 }
  let total = 0
  for (const asset of assets) {
    const target = path.join(ICONS, ...asset.file.split('/'))
    const raw = await rasterize(sharp, asset)
    const current = await readFile(target).catch(() => null)
    // Same pixels → keep the file, whatever bytes this machine's zlib would pick.
    const same = current !== null && samePixels(await decode(sharp, current, raw).catch(() => null), raw)
    let png = current
    let status = 'unchanged'
    if (CHECK) {
      if (!same) status = 'stale'
    } else if (!same || FORCE) {
      png = await encode(sharp, raw)
      if (!current?.equals(png)) {
        status = current ? 'updated' : 'created'
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(target, png)
      }
    }
    counts[status]++
    total += png?.length ?? 0
    const mode = png ? pngMode(png) : 'missing'
    console.log(
      `${asset.file.padEnd(46)} ${`${raw.width}x${raw.height}`.padStart(9)} ${kb(png?.length ?? 0).padStart(9)}  ${mode.padEnd(7)} ${status}`,
    )
  }

  // Launch screens dropped from APPLE_SPLASH.
  const wanted = new Set(assets.map((asset) => asset.file))
  const splashDir = path.join(ICONS, 'splash')
  for (const name of await readdir(splashDir).catch(() => [])) {
    if (!SPLASH_FILE.test(name) || wanted.has(`splash/${name}`)) continue
    if (CHECK) {
      counts.stale++
      console.log(`splash/${name}  no longer in APPLE_SPLASH`)
    } else {
      await rm(path.join(splashDir, name))
      counts.removed++
      console.log(`splash/${name}  removed (no longer in APPLE_SPLASH)`)
    }
  }

  const splashCount = assets.filter((asset) => asset.file.startsWith('splash/')).length
  console.log(
    `\n${assets.length} files (${assets.length - splashCount} icons, ${splashCount} launch screens), ${kb(total)} in total. ` +
      Object.entries(counts)
        .filter(([, n]) => n > 0)
        .map(([status, n]) => `${n} ${status}`)
        .join(', '),
  )
  if (CHECK && counts.stale > 0) {
    console.error('Stale PWA assets: run `node scripts/generate-pwa-assets.mjs` from site/ and commit the result.')
    process.exit(1)
  }
}

await main()
