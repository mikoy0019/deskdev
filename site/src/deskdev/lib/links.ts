// Links people type into DeskDev (meeting links, mainly). Not mirrored to
// mobile: mobile/src/lib/links.ts carries its own copy of webHref.

/**
 * A typed web address as an absolute http(s) URL, or undefined when it isn't
 * one. A missing scheme gets https:// (people paste "meet.google.com/abc-defg"),
 * which would otherwise resolve as a path inside DeskDev. Only http(s) is
 * prefixed-tested, so "javascript:…" becomes "https://javascript:…", which is
 * not a valid URL and is dropped, and any other scheme is refused.
 */
export function webHref(value: string | null | undefined): string | undefined {
  const text = value?.trim()
  if (!text) return undefined
  const candidate = /^https?:\/\//i.test(text) ? text : `https://${text}`
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    if (!url.hostname) return undefined
    return url.href
  } catch {
    return undefined
  }
}
