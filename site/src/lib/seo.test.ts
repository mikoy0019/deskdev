import { createElement, Fragment } from 'react';
import { describe, expect, it } from 'vitest';
import {
  CONTACT_EMAIL,
  SERVICE_LINKS,
  SITE_NAME,
  SITE_PAGES,
  SITE_URL,
  absoluteUrl,
  breadcrumbForPath,
  breadcrumbJsonLd,
  faqJsonLd,
  jsonLdForPath,
  nodeText,
  organizationJsonLd,
  pageMeta,
  serializeJsonLd,
  serviceListJsonLd,
  webSiteJsonLd,
  type JsonLd,
} from './seo';

/** What a crawler does with a block: read the script's text as JSON. */
const parse = (data: JsonLd | JsonLd[]) => JSON.parse(serializeJsonLd(data)) as Record<string, unknown> | Record<string, unknown>[];

describe('absoluteUrl', () => {
  it('resolves site paths against the canonical origin', () => {
    expect(absoluteUrl('/')).toBe(`${SITE_URL}/`);
    expect(absoluteUrl('/services')).toBe(`${SITE_URL}/services`);
    expect(absoluteUrl('/services#seo')).toBe(`${SITE_URL}/services#seo`);
  });
});

describe('pageMeta', () => {
  const meta = pageMeta({ title: 'Services', description: 'What we build.', path: '/services' });

  it('keeps the bare title for the layout template and names the page in the share card', () => {
    expect(meta.title).toBe('Services');
    expect(meta.description).toBe('What we build.');
    expect(meta.alternates).toEqual({ canonical: '/services' });
    expect(meta.openGraph).toMatchObject({
      type: 'website',
      siteName: SITE_NAME,
      title: `Services | ${SITE_NAME}`,
      description: 'What we build.',
      url: `${SITE_URL}/services`,
    });
    expect(meta.twitter).toMatchObject({ card: 'summary_large_image', title: `Services | ${SITE_NAME}`, description: 'What we build.' });
  });

  it('carries the share image on both cards', () => {
    const og = meta.openGraph as { images: { url: string }[] };
    const tw = meta.twitter as { images: { url: string }[] };
    expect(og.images[0].url).toBe('/og-image.png');
    expect(tw.images[0].url).toBe('/og-image.png');
  });

  it('uses an absolute title as written', () => {
    const home = pageMeta({ title: { absolute: 'NixGen Solutions' }, description: 'Home.', path: '/' });
    expect(home.title).toEqual({ absolute: 'NixGen Solutions' });
    expect((home.openGraph as { title: string; url: string }).title).toBe('NixGen Solutions');
    expect((home.openGraph as { url: string }).url).toBe(`${SITE_URL}/`);
  });
});

describe('JSON-LD blocks', () => {
  it('every block survives a round trip through JSON', () => {
    const blocks: JsonLd[] = [
      organizationJsonLd(),
      webSiteJsonLd(),
      breadcrumbJsonLd([{ name: 'Portfolio', path: '/portfolio' }]),
      faqJsonLd([{ question: 'How long?', answer: 'It depends.' }])!,
      serviceListJsonLd([{ name: 'SEO & Visibility', path: '/services#seo' }]),
    ];
    for (const block of blocks) {
      const parsed = parse(block) as Record<string, unknown>;
      expect(parsed['@context']).toBe('https://schema.org');
      expect(typeof parsed['@type']).toBe('string');
      expect(parsed).toEqual(block);
    }
  });

  it('organization states only what the site states', () => {
    expect(organizationJsonLd()).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: SITE_NAME,
      url: SITE_URL,
      logo: `${SITE_URL}/logo.png`,
      email: CONTACT_EMAIL,
    });
  });

  it('website points back at the organization', () => {
    const site = webSiteJsonLd();
    expect(site.url).toBe(`${SITE_URL}/`);
    expect(site.publisher).toEqual({ '@id': organizationJsonLd()['@id'] });
  });

  it('breadcrumbs start at Home and number from 1 with absolute URLs', () => {
    const list = breadcrumbJsonLd([
      { name: 'Portfolio', path: '/portfolio' },
      { name: 'A case study', path: '/portfolio/a-case-study' },
    ]);
    expect(list.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
      { '@type': 'ListItem', position: 2, name: 'Portfolio', item: `${SITE_URL}/portfolio` },
      { '@type': 'ListItem', position: 3, name: 'A case study', item: `${SITE_URL}/portfolio/a-case-study` },
    ]);
  });

  it('names every known inner page and nothing else', () => {
    for (const [path, name] of Object.entries(SITE_PAGES)) {
      const list = breadcrumbForPath(path)!;
      expect((list.itemListElement as { name: string }[])[1].name).toBe(name);
      // A trailing slash is the same page.
      expect(breadcrumbForPath(`${path}/`)).toEqual(list);
    }
    expect(breadcrumbForPath('/')).toBeNull();
    expect(breadcrumbForPath('/login')).toBeNull();
    expect(breadcrumbForPath('/portfolio/some-slug')).toBeNull();
  });

  it('faq keeps the questions in order and drops empty entries', () => {
    const faq = faqJsonLd([
      { question: ' First? ', answer: ' One. ' },
      { question: 'Empty answer?', answer: '   ' },
      { question: 'Second?', answer: 'Two.' },
    ])!;
    expect(faq.mainEntity).toEqual([
      { '@type': 'Question', name: 'First?', acceptedAnswer: { '@type': 'Answer', text: 'One.' } },
      { '@type': 'Question', name: 'Second?', acceptedAnswer: { '@type': 'Answer', text: 'Two.' } },
    ]);
    expect(faqJsonLd([])).toBeNull();
    expect(faqJsonLd([{ question: 'Only a question?', answer: '' }])).toBeNull();
  });

  it('service list is ordered and credits the organization', () => {
    const list = serviceListJsonLd([
      { name: 'Conversion Websites', path: '/services#conversion', description: 'Sites that book calls.' },
      { name: 'SEO & Visibility', path: '/services#seo' },
    ]);
    const items = list.itemListElement as { position: number; item: Record<string, unknown> }[];
    expect(items.map((i) => i.position)).toEqual([1, 2]);
    expect(items[0].item).toEqual({
      '@type': 'Service',
      name: 'Conversion Websites',
      url: `${SITE_URL}/services#conversion`,
      description: 'Sites that book calls.',
      provider: { '@id': `${SITE_URL}/#organization` },
    });
    expect(items[1].item).not.toHaveProperty('description');
  });
});

describe('jsonLdForPath', () => {
  const types = (path: string) => jsonLdForPath(path).map((b) => b['@type']);

  it('home gets the WebSite block', () => {
    expect(types('/')).toEqual(['WebSite']);
  });

  it('inner pages get breadcrumbs; /services also lists the six services', () => {
    expect(types('/about')).toEqual(['BreadcrumbList']);
    expect(types('/services')).toEqual(['BreadcrumbList', 'ItemList']);
    const list = jsonLdForPath('/services')[1].itemListElement as { item: { name: string; url: string } }[];
    expect(list.map((i) => i.item.name)).toEqual(SERVICE_LINKS.map((s) => s.label));
    expect(list.every((i) => i.item.url.startsWith(`${SITE_URL}/services#`))).toBe(true);
  });

  it('unknown paths get nothing', () => {
    expect(jsonLdForPath('/login')).toEqual([]);
    expect(jsonLdForPath('/no-such-page')).toEqual([]);
  });

  it('every path produces parseable JSON', () => {
    for (const path of ['/', ...Object.keys(SITE_PAGES)]) {
      for (const block of jsonLdForPath(path)) expect(() => parse(block)).not.toThrow();
    }
  });
});

describe('serializeJsonLd', () => {
  it('cannot close its script tag', () => {
    const text = serializeJsonLd(faqJsonLd([{ question: 'Is </script> safe?', answer: '<b>Yes</b>' }])!);
    expect(text).not.toContain('<');
    expect((JSON.parse(text) as { mainEntity: { name: string }[] }).mainEntity[0].name).toBe('Is </script> safe?');
  });
});

describe('nodeText', () => {
  it('reads plain strings and numbers', () => {
    expect(nodeText('Two weeks.')).toBe('Two weeks.');
    expect(nodeText(14)).toBe('14');
    expect(nodeText(null)).toBe('');
  });

  it('reads through elements and fragments, keeping the sentence intact', () => {
    const answer = createElement(
      Fragment,
      null,
      'Yes. See the ',
      createElement('a', { href: '/privacy' }, 'Privacy ', createElement('em', null, 'Policy')),
      ' for details.',
    );
    expect(nodeText(answer)).toBe('Yes. See the Privacy Policy for details.');
  });

  it('turns line breaks and runs of whitespace into single spaces', () => {
    expect(nodeText(createElement('p', null, 'One', createElement('br'), 'two\n   three'))).toBe('One two three');
  });
});
