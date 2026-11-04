import { describe, expect, it } from 'vitest'
import { formLinkUrl, newFormToken, quickFormMailto, quickFormState, sha256Hex } from './quickForm'

const NOW = Date.parse('2026-10-06T08:00:00Z')

describe('quick-form tokens', () => {
  it('are 43-char base64url strings, the shape form_link_read accepts, and never repeat', () => {
    const a = newFormToken()
    const b = newFormToken()
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a).not.toBe(b)
  })

  it('hash to the lowercase hex sha256 the database stores', async () => {
    // sha256('abc'), the classic test vector.
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('link to the site, not to DeskDev', () => {
    expect(formLinkUrl('TOKEN', 'https://nixgensolutions.com')).toBe('https://nixgensolutions.com/f/TOKEN')
  })
})

describe('quickFormState', () => {
  const open = { shareTokenHash: 'a'.repeat(64), shareExpiresAt: '2026-10-20T08:00:00Z' }
  it('reads none, open, expired and answered', () => {
    expect(quickFormState(undefined, NOW)).toBe('none')
    expect(quickFormState({}, NOW)).toBe('none')
    expect(quickFormState(open, NOW)).toBe('open')
    expect(quickFormState({ ...open, shareExpiresAt: '2026-10-01T00:00:00Z' }, NOW)).toBe('expired')
    expect(quickFormState({ ...open, customerSubmittedAt: '2026-10-05T00:00:00Z' }, NOW)).toBe('answered')
  })
})

describe('quickFormMailto', () => {
  it('addresses the customer by first name, keeps the @, and encodes spaces as %20', () => {
    const href = quickFormMailto({ to: 'maya@kalye.ph', name: 'Maya Santos', formTitle: 'Project onboarding', url: 'https://x/f/T', from: 'Bryan' })
    expect(href.startsWith('mailto:maya@kalye.ph?')).toBe(true)
    expect(href).not.toContain('+')
    const body = new URLSearchParams(href.split('?')[1]).get('body')!
    expect(body).toContain('Hi Maya,')
    expect(body).toContain('https://x/f/T')
    expect(body).toContain('Bryan')
  })
})
