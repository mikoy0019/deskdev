import { describe, expect, it } from 'vitest'
import { compareVersions, desktopAppVersion, formatSize, isWindows, parseRelease } from './desktopApp'

const EDGE_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0'

describe('desktopAppVersion', () => {
  it('reads the version the Windows app adds to its user agent', () => {
    expect(desktopAppVersion(`${EDGE_WIN} DeskDevDesktop/1.2.3`)).toBe('1.2.3')
  })

  it('is null in a plain browser', () => {
    expect(desktopAppVersion(EDGE_WIN)).toBeNull()
    expect(desktopAppVersion('')).toBeNull()
    expect(desktopAppVersion(undefined)).toBeNull()
    expect(desktopAppVersion(`${EDGE_WIN} DeskDevDesktop/1.2`)).toBeNull()
  })
})

describe('isWindows', () => {
  it('spots Windows', () => {
    expect(isWindows(EDGE_WIN)).toBe(true)
    expect(isWindows('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe(false)
    expect(isWindows(null)).toBe(false)
  })
})

describe('compareVersions', () => {
  it('orders by major, minor, patch — numerically', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.1', '1.0.0')).toBeGreaterThan(0)
    expect(compareVersions('1.9.0', '1.10.0')).toBeLessThan(0)
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0)
  })
})

describe('parseRelease', () => {
  const good = {
    version: '1.0.0',
    url: '/downloads/DeskDev-Setup.exe',
    size: 1_887_436,
    sha256: 'a'.repeat(64),
    released: '2026-10-06',
  }

  it('accepts what desktop/build.mjs writes', () => {
    expect(parseRelease(good)).toEqual(good)
  })

  it('drops optional fields that are malformed', () => {
    expect(parseRelease({ ...good, sha256: 'nope', released: 'yesterday' })).toEqual({
      version: '1.0.0',
      url: '/downloads/DeskDev-Setup.exe',
      size: 1_887_436,
      sha256: undefined,
      released: undefined,
    })
  })

  it('refuses anything it should not link to', () => {
    for (const bad of [
      null,
      'x',
      { ...good, version: 'v1' },
      { ...good, url: 'https://evil.example/DeskDev-Setup.exe' },
      { ...good, url: '//evil.example/downloads/x.exe' },
      { ...good, url: '/downloads/../secret.exe' },
      { ...good, url: '/downloads/setup.msi' },
      { ...good, size: 0 },
      { ...good, size: '12' },
    ]) {
      expect(parseRelease(bad), JSON.stringify(bad)).toBeNull()
    }
  })
})

describe('formatSize', () => {
  it('reads like a download size', () => {
    expect(formatSize(1_887_436)).toBe('1.8 MB')
    expect(formatSize(300 * 1024)).toBe('300 KB')
    expect(formatSize(10)).toBe('1 KB')
  })
})
