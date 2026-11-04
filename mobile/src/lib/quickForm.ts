import { SITE_ORIGIN, randomBytes, sha256Hex } from './platform'
import type { FormResponse } from './types'

// Customer quick-form links (047). The link is nixgensolutions.com/f/<token>:
// a 256-bit random token the team copies or emails once. The database keeps
// only its sha256, so a leaked table dump or a realtime echo can't open the
// form; the site's server resolves the token with form_link_read.

/** How long a link stays open. */
export const FORM_LINK_DAYS = 14

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** base64url without padding — written out, since React Native has no guaranteed btoa. */
function base64url(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63]
    if (i + 1 < bytes.length) out += B64URL[(n >> 6) & 63]
    if (i + 2 < bytes.length) out += B64URL[n & 63]
  }
  return out
}

/** 32 random bytes as base64url: 43 characters, the shape form_link_read accepts. */
export function newFormToken(): string {
  return base64url(randomBytes(32))
}

/** Lowercase hex sha256 of the token — what 047 stores and looks up (platform crypto). */
export { sha256Hex }

/**
 * The public link. The form lives on the site, which in production is another
 * host than DeskDev (src/lib/hosts.ts); without the split it is this origin.
 */
export function formLinkUrl(token: string, origin: string | null = SITE_ORIGIN): string {
  const base = origin ?? (typeof window !== 'undefined' && window.location ? window.location.origin : '')
  return `${base}/f/${token}`
}

export type QuickFormState = 'none' | 'open' | 'expired' | 'answered'

/** Where the customer link stands: none sent, open, expired unanswered, or answered. */
export function quickFormState(
  response: Pick<FormResponse, 'shareTokenHash' | 'shareExpiresAt' | 'customerSubmittedAt'> | undefined,
  now: number = Date.now(),
): QuickFormState {
  if (!response) return 'none'
  if (response.customerSubmittedAt) return 'answered'
  if (!response.shareTokenHash || !response.shareExpiresAt) return 'none'
  return new Date(response.shareExpiresAt).getTime() > now ? 'open' : 'expired'
}

/** The email that carries a quick-form link: sent from DeskDev (049) or opened in a mail app. */
export function quickFormEmail(opts: { name?: string; formTitle: string; url: string; from?: string }): { subject: string; body: string } {
  const hello = opts.name ? `Hi ${opts.name.split(/\s+/)[0]},` : 'Hi,'
  const body = [
    hello,
    '',
    `Could you fill in this short form before we continue? It's private to you and takes a few minutes:`,
    opts.url,
    '',
    `The link works for ${FORM_LINK_DAYS} days.`,
    '',
    'Thanks,',
    opts.from ?? 'NixGen Solutions',
  ].join('\n')
  return { subject: `${opts.formTitle} — NixGen Solutions`, body }
}

/** The same email as a mailto: link, for sending from your own mail app. */
export function quickFormMailto(opts: { to?: string; name?: string; formTitle: string; url: string; from?: string }): string {
  const { subject, body } = quickFormEmail(opts)
  const params = new URLSearchParams({ subject, body })
  // URLSearchParams encodes spaces as '+', which mail apps show literally.
  // The address keeps its '@' (an encoded %40 confuses some mail apps); anything odd is dropped.
  return `mailto:${(opts.to ?? '').replace(/[^\w.+@-]/g, '')}?${params.toString().replace(/\+/g, '%20')}`
}
