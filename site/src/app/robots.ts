import type { MetadataRoute } from 'next';
import { INDEXABLE } from '../lib/hosts';
import { SITE_URL } from '../lib/seo';

export default function robots(): MetadataRoute.Robots {
  // Only the production domain is for search engines. The workers.dev address
  // the site lives on before the DNS cutover, previews and local builds turn
  // every crawler away, so a temporary host never competes with the real one.
  // (Pages there also carry X-Robots-Tag: noindex, set in next.config.ts.)
  if (!INDEXABLE) {
    return { rules: { userAgent: '*', disallow: '/' } };
  }

  // Crawl the marketing site; keep crawlers out of the DeskDev app, the API and
  // the private customer forms (/f/<token>, which are noindex as well).
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/workspace', '/api', '/f/'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
