import { SITE_ORIGIN } from './platform'

// The public booking page (048): nixgensolutions.com/book. It lives on the
// site, which in production is another host than DeskDev (src/lib/hosts.ts).

/**
 * The booking page, optionally with the person's name and email filled in
 * (the page reads ?name= and ?email=, so a lead books without retyping and
 * the booking lands on their existing lead).
 */
export function bookingPageUrl(
  who: { name?: string; email?: string } = {},
  origin: string | null = SITE_ORIGIN,
): string {
  const base = origin ?? (typeof window !== 'undefined' && window.location ? window.location.origin : '')
  const params = new URLSearchParams()
  if (who.name?.trim()) params.set('name', who.name.trim())
  if (who.email?.trim()) params.set('email', who.email.trim())
  const query = params.toString()
  return `${base}/book${query ? `?${query}` : ''}`
}

/** The email that carries the booking link: sent from DeskDev (049) or opened in a mail app. */
export function bookingEmail(opts: { name?: string; url: string; title: string; from?: string }): { subject: string; body: string } {
  const hello = opts.name ? `Hi ${opts.name.split(/\s+/)[0]},` : 'Hi,'
  const body = [
    hello,
    '',
    `Pick a time that suits you for a ${opts.title.toLowerCase()} — the times shown are the ones we're free:`,
    opts.url,
    '',
    "You'll get a calendar invite with the video link straight away.",
    '',
    'Thanks,',
    opts.from ?? 'NixGen Solutions',
  ].join('\n')
  return { subject: `${opts.title} with NixGen Solutions`, body }
}

/** The same email as a mailto: link, for sending from your own mail app. */
export function bookingMailto(opts: { to?: string; name?: string; url: string; title: string; from?: string }): string {
  const { subject, body } = bookingEmail(opts)
  const params = new URLSearchParams({ subject, body })
  return `mailto:${(opts.to ?? '').replace(/[^\w.+@-]/g, '')}?${params.toString().replace(/\+/g, '%20')}`
}
