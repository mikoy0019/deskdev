import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchVideoMeta, looksLikeUrl } from './videoOembed'

const YT = 'https://www.youtube.com/watch?v=3YG3XLmBX4A'

function mockFetch(impl: (url: string) => unknown) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => impl(url)))
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('fetchVideoMeta', () => {
  it('returns the provider title and poster', async () => {
    mockFetch(() => ({
      ok: true,
      json: async () => ({
        title: 'Elementor Basics in 15 Minutes',
        thumbnail_url: 'https://i.ytimg.com/vi/3YG3XLmBX4A/hqdefault.jpg',
      }),
    }))
    expect(await fetchVideoMeta(YT)).toEqual({
      title: 'Elementor Basics in 15 Minutes',
      thumbnail: 'https://i.ytimg.com/vi/3YG3XLmBX4A/hqdefault.jpg',
    })
  })

  it('calls the right endpoint per provider', async () => {
    const seen: string[] = []
    mockFetch((url) => { seen.push(url); return { ok: true, json: async () => ({ title: 'x' }) } })
    await fetchVideoMeta(YT)
    await fetchVideoMeta('https://www.loom.com/share/abc123def456')
    await fetchVideoMeta('https://vimeo.com/123456789')
    expect(seen[0]).toContain('youtube.com/oembed')
    expect(seen[1]).toContain('loom.com/v1/oembed')
    expect(seen[2]).toContain('vimeo.com/api/oembed.json')
  })

  it('never calls the network for a provider with no oEmbed', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    expect(await fetchVideoMeta('https://drive.google.com/file/d/1AbC_dEfGhIj/view')).toBeNull()
    expect(await fetchVideoMeta('https://cdn.example.com/a.mp4')).toBeNull()
    expect(await fetchVideoMeta('https://evil.example.com/x')).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('rejects a non-https poster from a hostile response', async () => {
    mockFetch(() => ({
      ok: true,
      json: async () => ({ title: 'ok', thumbnail_url: 'javascript:alert(1)' }),
    }))
    const meta = await fetchVideoMeta(YT)
    expect(meta?.thumbnail).toBeUndefined()
    expect(meta?.title).toBe('ok')
  })

  it('normalises whitespace and caps an overlong title', async () => {
    mockFetch(() => ({
      ok: true,
      json: async () => ({ title: '  Spaced\n\n  Out  ' }),
    }))
    expect((await fetchVideoMeta(YT))?.title).toBe('Spaced Out')

    mockFetch(() => ({ ok: true, json: async () => ({ title: 'x'.repeat(500) }) }))
    expect((await fetchVideoMeta(YT))?.title).toHaveLength(200)
  })

  it('returns null on every failure path instead of throwing', async () => {
    mockFetch(() => ({ ok: false, json: async () => ({}) }))
    expect(await fetchVideoMeta(YT)).toBeNull()

    mockFetch(() => { throw new Error('offline') })
    expect(await fetchVideoMeta(YT)).toBeNull()

    mockFetch(() => ({ ok: true, json: async () => { throw new Error('bad json') } }))
    expect(await fetchVideoMeta(YT)).toBeNull()

    // Usable response shape, but nothing worth keeping.
    mockFetch(() => ({ ok: true, json: async () => ({ title: '', thumbnail_url: null }) }))
    expect(await fetchVideoMeta(YT)).toBeNull()
  })
})

describe('looksLikeUrl', () => {
  it('spots a pasted URL so it can be replaced by the real title', () => {
    expect(looksLikeUrl('https://www.youtube.com/watch?v=3YG3XLmBX4A')).toBe(true)
    expect(looksLikeUrl('  http://example.com  ')).toBe(true)
  })

  it('leaves a human title alone', () => {
    expect(looksLikeUrl('Elementor Basics in 15 Minutes')).toBe(false)
    expect(looksLikeUrl('')).toBe(false)
    // A title that merely mentions a link is still a title.
    expect(looksLikeUrl('Watch https://example.com first')).toBe(false)
  })
})
