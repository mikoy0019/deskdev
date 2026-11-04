import { describe, expect, it } from 'vitest'
import { bookingMailto, bookingPageUrl } from './booking'

describe('bookingPageUrl', () => {
  it('points at the site, with the person filled in when known', () => {
    expect(bookingPageUrl({}, 'https://nixgensolutions.com')).toBe('https://nixgensolutions.com/book')
    expect(bookingPageUrl({ name: ' Maya Santos ', email: 'maya@kalye.ph' }, 'https://nixgensolutions.com')).toBe(
      'https://nixgensolutions.com/book?name=Maya+Santos&email=maya%40kalye.ph',
    )
  })
})

describe('bookingMailto', () => {
  it('names the meeting, greets by first name and carries the link', () => {
    const href = bookingMailto({ to: 'maya@kalye.ph', name: 'Maya Santos', url: 'https://x/book', title: 'Discovery call' })
    expect(href.startsWith('mailto:maya@kalye.ph?')).toBe(true)
    const q = new URLSearchParams(href.split('?')[1])
    expect(q.get('subject')).toBe('Discovery call with NixGen Solutions')
    expect(q.get('body')).toContain('Hi Maya,')
    expect(q.get('body')).toContain('a discovery call')
    expect(q.get('body')).toContain('https://x/book')
  })
})
