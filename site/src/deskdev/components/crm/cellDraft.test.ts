import { describe, expect, it } from 'vitest'
import { draftError } from './cellDraft'

describe('draftError', () => {
  it('lets any cell be cleared', () => {
    expect(draftError('number', '   ')).toBeNull()
    expect(draftError('url', '')).toBeNull()
  })

  it('takes text as typed', () => {
    expect(draftError('text', 'not a link')).toBeNull()
  })

  it('refuses a number that will not parse', () => {
    expect(draftError('number', '12.5')).toBeNull()
    expect(draftError('number', ' -3 ')).toBeNull()
    expect(draftError('number', '12abc')).toBe('Enter a valid number')
    expect(draftError('number', 'Infinity')).toBe('Enter a valid number')
  })

  it('takes a link with or without its scheme', () => {
    expect(draftError('url', 'https://harbordental.com')).toBeNull()
    expect(draftError('url', 'HTTP://example.com/a?b=1#c')).toBeNull()
    expect(draftError('url', 'example.com')).toBeNull()
    expect(draftError('url', ' sub.example.co.uk/path ')).toBeNull()
  })

  it('refuses text that is not a link', () => {
    for (const bad of ['not a link', 'example', 'https://', 'example .com', 'javascript:alert(1)', 'ftp://example.com']) {
      expect(draftError('url', bad), bad).toBe('Enter a link, like example.com')
    }
  })
})
