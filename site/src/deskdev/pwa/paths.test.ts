import { afterEach, describe, expect, it, vi } from 'vitest'

// lib/basePath.ts decides BASE_PATH once, at import, from the host — so each
// value gets a fresh copy of paths.ts over a mocked basePath.
async function load(base: '' | '/workspace') {
  vi.resetModules()
  vi.doMock('../lib/basePath', () => ({
    BASE_PATH: base,
    withBase: (path: string) => `${base}${path}`,
    assetUrl: (path: string) => `/workspace${path}`,
  }))
  return import('./paths')
}

afterEach(() => {
  vi.doUnmock('../lib/basePath')
})

const origin = () => window.location.origin

describe("paths with BASE_PATH '/workspace' (a route of the site)", () => {
  it('stripBase turns browser paths into router paths', async () => {
    const { stripBase } = await load('/workspace')
    expect(stripBase('/workspace/tasks')).toBe('/tasks')
    expect(stripBase('/workspace/messages/42')).toBe('/messages/42')
    expect(stripBase('/workspace')).toBe('/')
    expect(stripBase('/workspace/')).toBe('/')
  })

  it('stripBase leaves paths outside the base alone', async () => {
    const { stripBase } = await load('/workspace')
    expect(stripBase('/workspaces')).toBe('/workspaces')
    expect(stripBase('/login')).toBe('/login')
    expect(stripBase('')).toBe('/')
  })

  it('appUrl builds absolute in-app URLs, with the bare base as the root', async () => {
    const { appUrl } = await load('/workspace')
    expect(appUrl('/tasks')).toBe(`${origin()}/workspace/tasks`)
    expect(appUrl('messages/42')).toBe(`${origin()}/workspace/messages/42`)
    // '/workspace/' 308-redirects to '/workspace', so the root never gets the slash.
    expect(appUrl('/')).toBe(`${origin()}/workspace`)
    expect(appUrl('/?source=pwa')).toBe(`${origin()}/workspace?source=pwa`)
    expect(appUrl('/#top')).toBe(`${origin()}/workspace#top`)
  })

  it('appBase is the origin plus the base, without a trailing slash', async () => {
    const { appBase } = await load('/workspace')
    expect(appBase()).toBe(`${origin()}/workspace`)
  })

  it('appPathFromUrl routes in-app URLs and refuses everything else', async () => {
    const { appPathFromUrl } = await load('/workspace')
    expect(appPathFromUrl(`${origin()}/workspace/messages/42?from=push#m9`)).toBe('/messages/42?from=push#m9')
    expect(appPathFromUrl(`${origin()}/workspace`)).toBe('/')
    expect(appPathFromUrl('/workspace/tasks')).toBe('/tasks')
    expect(appPathFromUrl(`${origin()}/login`)).toBeNull()
    expect(appPathFromUrl('https://evil.example/workspace/tasks')).toBeNull()
    expect(appPathFromUrl('http://[broken')).toBeNull()
  })
})

describe("paths with BASE_PATH '' (DeskDev's own subdomain)", () => {
  it('stripBase is the identity', async () => {
    const { stripBase } = await load('')
    expect(stripBase('/tasks')).toBe('/tasks')
    expect(stripBase('/')).toBe('/')
    expect(stripBase('')).toBe('/')
  })

  it('appUrl and appBase sit at the origin root', async () => {
    const { appUrl, appBase } = await load('')
    expect(appUrl('/')).toBe(`${origin()}/`)
    expect(appUrl('/tasks')).toBe(`${origin()}/tasks`)
    expect(appUrl('channels/7')).toBe(`${origin()}/channels/7`)
    expect(appBase()).toBe(origin())
  })

  it('appPathFromUrl keeps same-origin paths and refuses other origins', async () => {
    const { appPathFromUrl } = await load('')
    expect(appPathFromUrl(`${origin()}/messages/1?x=1`)).toBe('/messages/1?x=1')
    expect(appPathFromUrl(`${origin()}/`)).toBe('/')
    expect(appPathFromUrl('https://evil.example/messages/1')).toBeNull()
  })
})
