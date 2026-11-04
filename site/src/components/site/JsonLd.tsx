import { serializeJsonLd, type JsonLd as JsonLdData } from '@/lib/seo';

/**
 * One structured-data block (builders: src/lib/seo.ts). Renders nothing for
 * null, so a page can pass a builder's result straight in. Plain markup with
 * no client code: usable from server pages and client components alike.
 */
export function JsonLd({ data }: { data: JsonLdData | null | undefined }) {
  if (!data) return null;
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
