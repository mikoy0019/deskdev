import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';
import { getShowcase } from '@/lib/showcase';

// Public marketing routes only. /login (team sign-in) and /workspace (DeskDev,
// served from its own subdomain in production) are deliberately left out.
const ROUTES = ['/', '/services', '/about', '/portfolio', '/process', '/contact', '/book', '/templates'] as const;
const LEGAL_ROUTES = ['/privacy', '/terms'] as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages: MetadataRoute.Sitemap = ROUTES.map((route) => ({
    url: route === '/' ? SITE_URL : `${SITE_URL}${route}`,
    changeFrequency: 'monthly',
    priority: route === '/' ? 1 : 0.8,
  }));

  const legal: MetadataRoute.Sitemap = LEGAL_ROUTES.map((route) => ({
    url: `${SITE_URL}${route}`,
    changeFrequency: 'yearly',
    priority: 0.3,
  }));

  // Only featured items with case-study content get a /portfolio/<slug> page;
  // ~90 thin pages would hurt more than help. getShowcase never throws (it
  // serves the committed fallback), the catch is belt and braces.
  const caseStudies: MetadataRoute.Sitemap = (await getShowcase({ featuredOnly: true }).catch(() => []))
    .filter((item) => item.detailHref)
    .map((item) => ({
      url: `${SITE_URL}${item.detailHref}`,
      ...(item.publishedAt ? { lastModified: item.publishedAt } : {}),
      changeFrequency: 'monthly',
      priority: 0.6,
    }));

  return [...pages, ...legal, ...caseStudies];
}
