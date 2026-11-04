'use client';

import { usePathname } from 'next/navigation';
import { JsonLd } from '@/components/site/JsonLd';
import { jsonLdForPath } from '@/lib/seo';

/**
 * The structured data a page gets from its address alone (src/lib/seo.ts):
 * WebSite on home, breadcrumbs on the inner pages, the Service list on
 * /services. A client component only because a layout cannot read the path;
 * it is in the server HTML like any other markup, which is what crawlers read.
 * Blocks that need page data (a FAQ, a case study's name) are rendered by the
 * component that holds that data.
 */
export function SiteJsonLd() {
  const pathname = usePathname();
  return (
    <>
      {jsonLdForPath(pathname).map((block) => (
        <JsonLd key={block['@type']} data={block} />
      ))}
    </>
  );
}
