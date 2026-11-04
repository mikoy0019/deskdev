import { describe, it, expect } from 'vitest'
import { parseVideoUrl, isEmbeddableVideoUrl } from './videoEmbed'

describe('parseVideoUrl — providers', () => {
  it('normalises every YouTube URL shape to one nocookie embed', () => {
    const expected = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/live/dQw4w9WgXcQ',
    ]) {
      expect(parseVideoUrl(url), url).toMatchObject({ provider: 'youtube', kind: 'iframe', src: expected })
    }
  })

  it('builds a Vimeo player URL and keeps the unlisted privacy hash', () => {
    expect(parseVideoUrl('https://vimeo.com/123456789')).toMatchObject({
      provider: 'vimeo', src: 'https://player.vimeo.com/video/123456789',
    })
    // Unlisted links carry the hash as a path segment or as ?h=.
    expect(parseVideoUrl('https://vimeo.com/123456789/abc123def')).toMatchObject({
      src: 'https://player.vimeo.com/video/123456789?h=abc123def',
    })
    expect(parseVideoUrl('https://vimeo.com/123456789?h=abc123def')).toMatchObject({
      src: 'https://player.vimeo.com/video/123456789?h=abc123def',
    })
    expect(parseVideoUrl('https://player.vimeo.com/video/123456789')).toMatchObject({
      src: 'https://player.vimeo.com/video/123456789',
    })
  })

  it('converts a Loom share link to an embed link', () => {
    expect(parseVideoUrl('https://www.loom.com/share/abc123def456')).toMatchObject({
      provider: 'loom', src: 'https://www.loom.com/embed/abc123def456',
    })
    expect(parseVideoUrl('https://www.loom.com/embed/abc123def456')).toMatchObject({
      src: 'https://www.loom.com/embed/abc123def456',
    })
  })

  it('rewrites a Drive /view link to /preview', () => {
    expect(parseVideoUrl('https://drive.google.com/file/d/1AbC_dEfGhIj/view?usp=sharing')).toMatchObject({
      provider: 'drive', src: 'https://drive.google.com/file/d/1AbC_dEfGhIj/preview',
    })
  })

  it('plays a direct video file natively instead of in an iframe', () => {
    const r = parseVideoUrl('https://cdn.example.com/sops/dns-migration.mp4')
    expect(r).toMatchObject({ provider: 'file', kind: 'file' })
    // kind 'file' is what keeps an arbitrary host out of an <iframe>.
    expect(r?.kind).not.toBe('iframe')
  })
})

describe('parseVideoUrl — poster thumbnails', () => {
  it('derives a YouTube poster from the video id', () => {
    expect(parseVideoUrl('https://youtu.be/dQw4w9WgXcQ')?.thumbnail)
      .toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')
  })

  it('derives a Loom poster from the share id', () => {
    expect(parseVideoUrl('https://www.loom.com/share/abc123def456')?.thumbnail)
      .toBe('https://cdn.loom.com/sessions/thumbnails/abc123def456-with-play.gif')
  })

  it('derives a Drive poster from the file id', () => {
    expect(parseVideoUrl('https://drive.google.com/file/d/1AbC_dEfGhIj/view')?.thumbnail)
      .toBe('https://drive.google.com/thumbnail?id=1AbC_dEfGhIj&sz=w640')
  })

  it('has no poster for Vimeo or a direct file — both need a runtime fallback', () => {
    expect(parseVideoUrl('https://vimeo.com/123456789')?.thumbnail).toBeUndefined()
    expect(parseVideoUrl('https://cdn.example.com/a.mp4')?.thumbnail).toBeUndefined()
  })

  it('serves every poster over https so a tile never mixes content', () => {
    for (const url of [
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.loom.com/share/abc123def456',
      'https://drive.google.com/file/d/1AbC_dEfGhIj/view',
    ]) {
      const thumb = parseVideoUrl(url)?.thumbnail
      expect(thumb, url).toMatch(/^https:\/\//)
    }
  })
})

describe('parseVideoUrl — rejects anything not allowlisted', () => {
  it('rejects non-https schemes, including script-bearing ones', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'http://www.youtube.com/watch?v=dQw4w9WgXcQ', // downgrade
      'blob:https://evil.example.com/abc',
      'file:///etc/passwd',
    ]) {
      expect(parseVideoUrl(url), url).toBeNull()
    }
  })

  it('rejects an arbitrary host even when it mimics a known provider path', () => {
    for (const url of [
      'https://evil.example.com/embed/dQw4w9WgXcQ',
      'https://evil.example.com/share/abc123def456',
      // Lookalike hosts must not pass a substring check.
      'https://youtube.com.evil.example.com/watch?v=dQw4w9WgXcQ',
      'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
      'https://vimeo.com.attacker.net/123456789',
    ]) {
      expect(parseVideoUrl(url), url).toBeNull()
    }
  })

  it('rejects allowlisted hosts with an unusable path or id', () => {
    for (const url of [
      'https://www.youtube.com/',
      'https://www.youtube.com/watch',            // no v=
      'https://www.youtube.com/watch?v=short',    // id too short
      'https://vimeo.com/not-numeric',
      'https://www.loom.com/looks-wrong/abc123def456',
      'https://drive.google.com/drive/folders/abc123def456',
      'https://drive.google.com/file/x/abc123def456/view',
    ]) {
      expect(parseVideoUrl(url), url).toBeNull()
    }
  })

  it('rejects empty, blank, and malformed input', () => {
    for (const url of ['', '   ', 'not a url', 'www.youtube.com/watch?v=dQw4w9WgXcQ']) {
      expect(parseVideoUrl(url), JSON.stringify(url)).toBeNull()
    }
  })

  it('rejects a path traversal attempt in a YouTube id', () => {
    expect(parseVideoUrl('https://www.youtube.com/embed/../../evil')).toBeNull()
  })
})

describe('isEmbeddableVideoUrl', () => {
  it('agrees with parseVideoUrl', () => {
    expect(isEmbeddableVideoUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true)
    expect(isEmbeddableVideoUrl('https://evil.example.com/x')).toBe(false)
  })

  it('tolerates surrounding whitespace from a paste', () => {
    expect(isEmbeddableVideoUrl('  https://youtu.be/dQw4w9WgXcQ  ')).toBe(true)
  })
})
