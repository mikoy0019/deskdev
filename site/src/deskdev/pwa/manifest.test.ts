import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildManifest, type ManifestBase } from './manifest'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC = path.resolve(HERE, '../../../public')
const ORIGIN = 'https://workspace.example.test'

interface Image {
  src: string
  sizes: string
  type: string
  purpose?: string
  form_factor?: string
  label?: string
}

interface Shortcut {
  name: string
  short_name: string
  description: string
  url: string
  icons: Image[]
}

interface Manifest {
  id: string
  scope: string
  start_url: string
  icons: Image[]
  shortcuts: Shortcut[]
  screenshots: Image[]
  related_applications: { platform: string; url: string }[]
  [key: string]: unknown
}

const build = (base: ManifestBase) => buildManifest(base, ORIGIN) as unknown as Manifest

// The manifest spec's within-scope rule: same origin and a plain string prefix.
function inScope(url: string, scope: string): boolean {
  const target = new URL(url, ORIGIN)
  const scopeUrl = new URL(scope, ORIGIN)
  return target.origin === scopeUrl.origin && target.pathname.startsWith(scopeUrl.pathname)
}

function dims(sizes: string): [number, number] {
  const match = /^(\d+)x(\d+)$/.exec(sizes)
  expect(match, `bad sizes ${sizes}`).not.toBeNull()
  return [Number(match![1]), Number(match![2])]
}

describe.each([
  ['', '/'],
  ['/workspace', '/workspace'],
] as const)('buildManifest(%j)', (base, root) => {
  const manifest = build(base)

  it('pins id, scope and start_url to the base, never with a trailing slash past it', () => {
    expect(manifest.id).toBe(root)
    expect(manifest.scope).toBe(root)
    expect(manifest.start_url).toBe(`${root}?source=pwa`)
    if (base) {
      expect(manifest.scope.endsWith('/')).toBe(false)
      expect(manifest.id.endsWith('/')).toBe(false)
    }
  })

  it('resolves id to the start URL without its query', () => {
    // A user agent computes the id against start_url's origin: keeping them in
    // step means the same app identity on both hosts' rules.
    const start = new URL(manifest.start_url, ORIGIN)
    expect(new URL(manifest.id, ORIGIN).pathname).toBe(start.pathname)
  })

  it('keeps start_url and every shortcut inside the scope', () => {
    expect(inScope(manifest.start_url, manifest.scope)).toBe(true)
    expect(manifest.shortcuts.length).toBeGreaterThan(0)
    expect(manifest.shortcuts.length).toBeLessThanOrEqual(4)
    for (const shortcut of manifest.shortcuts) {
      expect(inScope(shortcut.url, manifest.scope), shortcut.url).toBe(true)
      expect(shortcut.url.startsWith(`${base}/`)).toBe(true)
      expect(shortcut.short_name).toBeTruthy()
      expect(shortcut.description).toBeTruthy()
      expect(shortcut.icons).toEqual([
        expect.objectContaining({ sizes: '96x96', type: 'image/png', purpose: 'any' }),
      ])
    }
    expect(manifest.shortcuts.map((s) => s.url)).toEqual(
      ['/tasks', '/messages', '/calendar', '/projects'].map((p) => `${base}${p}`),
    )
  })

  it('describes the app the same way on every host', () => {
    expect(manifest).toMatchObject({
      name: 'DeskDev Studio',
      short_name: 'DeskDev',
      display: 'standalone',
      background_color: '#0a0c12',
      theme_color: '#0a0c12',
      lang: 'en',
      dir: 'ltr',
      categories: ['business', 'productivity'],
      prefer_related_applications: false,
      launch_handler: { client_mode: ['focus-existing', 'auto'] },
    })
    expect(manifest).not.toHaveProperty('display_override')
    expect(manifest.related_applications).toEqual([
      { platform: 'webapp', url: `${ORIGIN}/workspace/manifest.webmanifest` },
    ])
  })
})

describe('icons', () => {
  const { icons } = build('/workspace')

  it('gives every icon exactly one purpose', () => {
    for (const icon of icons) expect(['any', 'maskable', 'monochrome']).toContain(icon.purpose)
  })

  it('has 192 and 512 PNGs for any and maskable, plus monochrome and the SVG', () => {
    const has = (purpose: string, sizes: string, type = 'image/png') =>
      icons.some((i) => i.purpose === purpose && i.sizes === sizes && i.type === type)
    expect(has('any', '192x192')).toBe(true)
    expect(has('any', '512x512')).toBe(true)
    expect(has('maskable', '192x192')).toBe(true)
    expect(has('maskable', '512x512')).toBe(true)
    expect(has('monochrome', '512x512')).toBe(true)
    expect(has('any', 'any', 'image/svg+xml')).toBe(true)
  })

  it('points at files in public/', () => {
    const manifest = build('')
    const files = [...manifest.icons, ...manifest.shortcuts.flatMap((s) => s.icons)].map((i) => i.src)
    for (const src of files) {
      expect(src.startsWith('/workspace/'), src).toBe(true)
      expect(existsSync(path.join(PUBLIC, ...src.split('/'))), `${src} is missing`).toBe(true)
    }
  })
})

describe('screenshots', () => {
  const { screenshots } = build('/workspace')

  it('lists three narrow and one wide PNG, each labelled', () => {
    expect(screenshots.filter((s) => s.form_factor === 'narrow')).toHaveLength(3)
    expect(screenshots.filter((s) => s.form_factor === 'wide')).toHaveLength(1)
    for (const shot of screenshots) {
      expect(shot.type).toBe('image/png')
      expect(shot.label).toBeTruthy()
      expect(shot.src.startsWith('/workspace/screenshots/')).toBe(true)
    }
  })

  it('keeps Chrome’s size rules: sides 320–3840, long side ≤ 2.3× the short one', () => {
    for (const shot of screenshots) {
      const [w, h] = dims(shot.sizes)
      for (const side of [w, h]) {
        expect(side).toBeGreaterThanOrEqual(320)
        expect(side).toBeLessThanOrEqual(3840)
      }
      expect(Math.max(w, h) / Math.min(w, h)).toBeLessThanOrEqual(2.3)
      if (shot.form_factor === 'narrow') expect(h).toBeGreaterThan(w)
      if (shot.form_factor === 'wide') expect(w).toBeGreaterThan(h)
    }
  })

  it('gives the narrow shots one shared aspect ratio', () => {
    const ratios = new Set(
      screenshots.filter((s) => s.form_factor === 'narrow').map((s) => {
        const [w, h] = dims(s.sizes)
        return (h / w).toFixed(4)
      }),
    )
    expect(ratios.size).toBe(1)
  })
})

it('carries nothing host- or user-specific beyond the origin it was asked for', () => {
  const json = JSON.stringify(buildManifest('', ORIGIN))
  const origins = json.match(/https?:\/\/[^/"]+/g) ?? []
  expect(new Set(origins)).toEqual(new Set([ORIGIN]))
})
