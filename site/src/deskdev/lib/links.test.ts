import { describe, expect, it } from 'vitest'
import { webHref } from './links'

describe('webHref', () => {
  it('keeps http(s) links', () => {
    expect(webHref('https://meet.google.com/abc-defg-hij')).toBe('https://meet.google.com/abc-defg-hij')
    expect(webHref('  HTTP://zoom.us/j/123?pwd=x ')).toBe('http://zoom.us/j/123?pwd=x')
  })

  it('adds https:// when the scheme is missing', () => {
    expect(webHref('meet.google.com/abc-defg-hij')).toBe('https://meet.google.com/abc-defg-hij')
    expect(webHref('zoom.us/j/123')).toBe('https://zoom.us/j/123')
    expect(webHref('localhost:3000/x')).toBe('https://localhost:3000/x')
  })

  it('drops anything that is not a web address', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JavaScript:alert(document.cookie)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'https://',
      'not a url',
      '',
      '   ',
      null,
      undefined,
    ]) {
      expect(webHref(bad), String(bad)).toBeUndefined()
    }
  })

  it('never returns a non-http(s) scheme', () => {
    for (const odd of ['file:///etc/passwd', 'ftp://x.test/a', 'mailto:a@b.test', 'tel:+15551234']) {
      const href = webHref(odd)
      expect(href === undefined || /^https?:\/\//.test(href), `${odd} → ${href}`).toBe(true)
    }
  })
})
