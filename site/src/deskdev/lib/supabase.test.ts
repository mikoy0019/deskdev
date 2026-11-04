import { describe, expect, it } from 'vitest'
import { acceptsSessionFromUrl } from './supabase'

const at = (href: string) => new URL(href)
const recovery = { access_token: 'AT', refresh_token: 'RT', type: 'recovery' }

describe('acceptsSessionFromUrl', () => {
  it('takes the recovery link on the reset page (either deployment)', () => {
    expect(acceptsSessionFromUrl(at('https://workspace.example.com/reset-password'), recovery)).toBe(true)
    expect(acceptsSessionFromUrl(at('https://example.com/workspace/reset-password'), recovery)).toBe(true)
    // Expired / used links still reach the page as errors.
    expect(acceptsSessionFromUrl(at('https://example.com/workspace/reset-password'), { error_description: 'expired' })).toBe(true)
  })

  it('ignores a token fragment anywhere else (login CSRF)', () => {
    for (const path of ['/', '/settings', '/auth/callback', '/workspace/vault', '/reset-password/x']) {
      expect(acceptsSessionFromUrl(at(`https://example.com${path}`), recovery), path).toBe(false)
    }
  })

  it('ignores the reset page without a token or error', () => {
    expect(acceptsSessionFromUrl(at('https://example.com/reset-password'), {})).toBe(false)
  })
})
