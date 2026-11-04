// Links people type in (meeting links). Mobile copy of webHref from
// site/src/deskdev/lib/links.ts, written without URL parsing so it behaves the
// same on every JS engine. Not in the shared-drift mirror list.

/** host[:port] then an optional path/query/fragment, no spaces. */
const WEB = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?([/?#][^\s]*)?$/i

/**
 * A typed web address as an absolute http(s) URL, or undefined. A missing
 * scheme gets https:// ("meet.google.com/abc" would otherwise be a relative
 * path on the web app); "javascript:…" and other schemes never match.
 */
export function webHref(value: string | null | undefined): string | undefined {
  const text = value?.trim()
  if (!text) return undefined
  const candidate = /^https?:\/\//i.test(text) ? text : `https://${text}`
  return WEB.test(candidate) ? candidate : undefined
}
