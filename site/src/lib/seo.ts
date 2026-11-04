// Head and structured data for the marketing site: one place for the shared
// share-card fields, per-page metadata and the JSON-LD blocks.
//
// Everything here is built from what the site already states (names, routes,
// the contact address, the copy of a FAQ). Nothing is invented for search
// engines: no ratings, no addresses, no opening hours.
//
// Pure apart from the origin it reads through hosts.ts, so it is unit-tested
// (seo.test.ts parses every block it produces).
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import type { Metadata } from 'next';
import { SITE_ORIGIN } from './hosts';

/**
 * Canonical origin for absolute URLs (share images, JSON-LD, sitemap).
 * Production sets NEXT_PUBLIC_SITE_URL; anything else (local dev, previews)
 * falls back to the live domain so a shared link never points at localhost.
 */
export const SITE_URL = SITE_ORIGIN ?? 'https://nixgensolutions.com';
export const SITE_NAME = 'NixGen Solutions';
export const CONTACT_EMAIL = 'nixgensolutions@gmail.com';

export const SHARE_TITLE = 'NixGen Solutions — Websites That Work. Systems That Scale.';
export const SHARE_DESCRIPTION =
  'Premium websites, branding, automation, and SEO for service businesses. Built like a product launch, not a template — by senior designers and engineers.';
export const SHARE_IMAGE = { url: '/og-image.png', width: 1200, height: 630, alt: SHARE_TITLE };

/** Open Graph fields every page shares. A page adds its own title, description and url. */
export const SHARED_OPEN_GRAPH = {
  type: 'website',
  siteName: SITE_NAME,
  locale: 'en_US',
  images: [SHARE_IMAGE],
} as const;

/** Twitter card fields every page shares. */
export const SHARED_TWITTER = {
  card: 'summary_large_image',
  images: [SHARE_IMAGE],
} as const;

/** Absolute URL of a site path ("/" gives the bare origin plus a slash). */
export function absoluteUrl(path = '/'): string {
  return new URL(path, `${SITE_URL}/`).href;
}

/**
 * Metadata for one page: title, description, canonical, and a share card that
 * says the same thing. Without it a page inherits the layout's card, so a
 * shared /services link previews as the home page.
 *
 *   export const metadata = pageMeta({ title: 'Services', description: '…', path: '/services' });
 *
 * `title` is the bare page name (the layout's template adds the site name);
 * pass `{ absolute }` for a title that should stand as written.
 */
export function pageMeta({
  title,
  description,
  path,
}: {
  title: string | { absolute: string };
  description: string;
  path: string;
}): Metadata {
  const shareTitle = typeof title === 'string' ? `${title} | ${SITE_NAME}` : title.absolute;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { ...SHARED_OPEN_GRAPH, images: [...SHARED_OPEN_GRAPH.images], title: shareTitle, description, url: absoluteUrl(path) },
    twitter: { ...SHARED_TWITTER, images: [...SHARED_TWITTER.images], title: shareTitle, description },
  };
}

/* ─────────────────────────── Site map of names ─────────────────────────── */

/** The six services, in the order the site lists them. The footer links and the Service list read this. */
export const SERVICE_LINKS = [
  { label: 'Conversion Websites', href: '/services#conversion' },
  { label: 'Automation Systems', href: '/services#automation' },
  { label: 'Revenue Dashboards', href: '/services#dashboards' },
  { label: 'AI Operations', href: '/services#operations' },
  { label: 'Branding & Identity', href: '/services#branding' },
  { label: 'SEO & Visibility', href: '/services#seo' },
] as const;

/** Inner pages by path, named as their own <title> names them. Breadcrumbs read this. */
export const SITE_PAGES: Readonly<Record<string, string>> = {
  '/services': 'Services',
  '/about': 'About',
  '/portfolio': 'Portfolio',
  '/process': 'Process',
  '/contact': 'Contact',
  '/templates': 'Template Gallery',
  '/privacy': 'Privacy Policy',
  '/terms': 'Terms of Service',
};

/* ─────────────────────────── JSON-LD ─────────────────────────── */

export type JsonLd = { '@context': 'https://schema.org'; '@type': string; [key: string]: unknown };

const CONTEXT = 'https://schema.org' as const;
const ORGANIZATION_ID = `${SITE_URL}/#organization`;
const WEBSITE_ID = `${SITE_URL}/#website`;

/** Name, domain, logo and the contact address from the footer. No `sameAs` until the owner supplies profile URLs. */
export function organizationJsonLd(): JsonLd {
  return {
    '@context': CONTEXT,
    '@type': 'Organization',
    '@id': ORGANIZATION_ID,
    name: SITE_NAME,
    url: SITE_URL,
    logo: absoluteUrl('/logo.png'),
    email: CONTACT_EMAIL,
  };
}

/** The site itself (home page only): the name search engines show above a result. */
export function webSiteJsonLd(): JsonLd {
  return {
    '@context': CONTEXT,
    '@type': 'WebSite',
    '@id': WEBSITE_ID,
    name: SITE_NAME,
    url: absoluteUrl('/'),
    inLanguage: 'en',
    publisher: { '@id': ORGANIZATION_ID },
  };
}

export type Crumb = { name: string; path: string };

/** Home, then the given trail. Pass the pages below Home, outermost first. */
export function breadcrumbJsonLd(trail: readonly Crumb[]): JsonLd {
  return {
    '@context': CONTEXT,
    '@type': 'BreadcrumbList',
    itemListElement: [{ name: 'Home', path: '/' }, ...trail].map((crumb, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  };
}

/** Breadcrumbs for a known inner page ("/services"), or null for home and for paths this file cannot name. */
export function breadcrumbForPath(pathname: string): JsonLd | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const name = SITE_PAGES[path];
  return name ? breadcrumbJsonLd([{ name, path }]) : null;
}

/** A FAQ as it is printed on the page. Questions or answers that come out empty are left out; no entries, no block. */
export function faqJsonLd(items: readonly { question: string; answer: string }[]): JsonLd | null {
  const entries = items
    .map((item) => ({ question: item.question.trim(), answer: item.answer.trim() }))
    .filter((item) => item.question && item.answer);
  if (entries.length === 0) return null;
  return {
    '@context': CONTEXT,
    '@type': 'FAQPage',
    mainEntity: entries.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };
}

export type ServiceEntry = { name: string; path: string; description?: string };

/** The services as an ordered list, each one offered by the organization above. */
export function serviceListJsonLd(services: readonly ServiceEntry[]): JsonLd {
  return {
    '@context': CONTEXT,
    '@type': 'ItemList',
    name: `${SITE_NAME} services`,
    itemListElement: services.map((service, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Service',
        name: service.name,
        url: absoluteUrl(service.path),
        ...(service.description ? { description: service.description } : {}),
        provider: { '@id': ORGANIZATION_ID },
      },
    })),
  };
}

/** The blocks a path gets from its address alone: WebSite on home, breadcrumbs (and the Service list on /services) on inner pages. */
export function jsonLdForPath(pathname: string): JsonLd[] {
  if (pathname === '/') return [webSiteJsonLd()];
  const crumbs = breadcrumbForPath(pathname);
  if (!crumbs) return [];
  const path = pathname.replace(/\/+$/, '');
  return path === '/services'
    ? [crumbs, serviceListJsonLd(SERVICE_LINKS.map((s) => ({ name: s.label, path: s.href })))]
    : [crumbs];
}

/** JSON for a <script type="application/ld+json">: "<" is escaped so the text can never close the tag early. */
export function serializeJsonLd(data: JsonLd | readonly JsonLd[]): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/**
 * The words of a React node, for structured data built from copy that is
 * written as JSX (a FAQ answer with a link in it). Elements contribute their
 * children; anything that is not text contributes nothing.
 */
export function nodeText(node: ReactNode): string {
  return rawText(node).replace(/\s+/g, ' ').trim();
}

function rawText(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child);
      if (!isValidElement(child)) return '';
      if (child.type === 'br') return ' ';
      return rawText((child as ReactElement<{ children?: ReactNode }>).props.children);
    })
    .join('');
}
