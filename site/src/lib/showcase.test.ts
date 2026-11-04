import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The fallback must not opt the render out of caching: noStore() inside a
// cached page (home, /portfolio) fails it with DYNAMIC_SERVER_USAGE, a 500.
const noStore = vi.fn();
vi.mock('next/cache', () => ({ unstable_noStore: () => noStore() }));

import {
  fallbackItems,
  fetchShowcase,
  filterShowcase,
  getShowcase,
  getShowcaseItem,
  mapShowcaseRow,
  mapShowcaseRows,
  resolveImageKey,
  SHOWCASE_COLUMNS,
  SHOWCASE_SELECT,
  SHOWCASE_REVALIDATE_SECONDS,
  SHOWCASE_TAG,
  SHOWCASE_TIMEOUT_MS,
  toClientCard,
  toHomeCard,
  toProduct,
  type ShowcaseRow,
} from './showcase';
import { SHOWCASE_FALLBACK } from '../content/showcase-fallback';
import * as snapshot from '../../scripts/showcase-snapshot.mjs';

const SB = 'https://proj.supabase.co';
const CFG = { supabaseUrl: SB, anonKey: 'eyJhbGciOiJIUzI1NiJ9.test.sig' };

function row(over: Partial<ShowcaseRow> = {}): ShowcaseRow {
  return {
    slug: 'acme',
    kind: 'website',
    title: 'Acme',
    url: 'https://acme.com',
    link_public: true,
    industry: 'Plumbing',
    summary: null,
    result_tag: null,
    stack: [],
    accent: null,
    mockup_variant: null,
    image_key: null,
    image_key_small: null,
    image_alt: null,
    image_source: null,
    case_study: null,
    featured: false,
    home_featured: false,
    sort_order: 0,
    launched_on: null,
    published_at: null,
    ...over,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const shot = (host: string) => `https://s.wordpress.com/mshots/v1/${encodeURIComponent('https://' + host)}?w=640&h=360`;

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  noStore.mockClear();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  vi.useRealTimers();
});

describe('column list', () => {
  it('matches the prebuild snapshot script', () => {
    expect([...SHOWCASE_COLUMNS]).toEqual(snapshot.SHOWCASE_COLUMNS);
    expect(SHOWCASE_SELECT).toBe(snapshot.SHOWCASE_SELECT);
  });

  it('reads public_url (the anon grant) under the url key, never url itself', () => {
    const cols = SHOWCASE_SELECT.split(',');
    expect(cols).toContain('url:public_url');
    expect(cols).not.toContain('url');
  });

  it('never asks for a column anon must not be granted', () => {
    for (const col of ['status', 'consent', 'consent_note', 'consent_at', 'client_id', 'project_id', 'created_by', 'published_by', 'link_fail_count', 'id']) {
      expect(SHOWCASE_COLUMNS).not.toContain(col);
    }
  });
});

describe('fallback file', () => {
  // The file is regenerated from what anon may read (scripts/showcase-snapshot.mjs),
  // so its size follows the live showcase. Only its shape is fixed.
  it('holds only what the public may see: published rows, each slug once', () => {
    expect(SHOWCASE_FALLBACK.length).toBeGreaterThan(0);
    expect(SHOWCASE_FALLBACK.every((r) => r.status === 'published')).toBe(true);
    expect(SHOWCASE_FALLBACK.every((r) => ['product', 'website', 'web_app'].includes(r.kind))).toBe(true);
    expect(new Set(SHOWCASE_FALLBACK.map((r) => r.slug)).size).toBe(SHOWCASE_FALLBACK.length);
    expect(fallbackItems(null)).toHaveLength(SHOWCASE_FALLBACK.length);
  });

  it('carries no URL for a link that was taken down', () => {
    // 037 serves anon `public_url`, which is null while link_public is false; a
    // takedown in DeskDev must not leave the address in the committed file.
    for (const row of SHOWCASE_FALLBACK) {
      if (!row.link_public) expect(row.url, row.slug).toBeNull();
    }
    // 041 took the dead product demos down, so at least these are private now.
    expect(SHOWCASE_FALLBACK.some((r) => !r.link_public)).toBe(true);
  });

  it('is exactly what the snapshot script would write for the same rows', () => {
    // A Windows checkout (core.autocrlf) has CRLF where the script writes LF.
    const file = readFileSync(resolve(__dirname, '../content/showcase-fallback.ts'), 'utf8').replace(/\r\n/g, '\n');
    expect(snapshot.renderFallbackModule(SHOWCASE_FALLBACK)).toBe(file);
  });

  it('maps a product to the props the page renders, linked only while its demo is public', () => {
    const items = fallbackItems(null);
    const inbox = items.find((i) => i.slug === 'inbox-ai')!;
    expect(toProduct(inbox)).toEqual({
      name: 'Inbox AI',
      category: 'AI Email Assistant',
      blurb: 'Drafts, triages, and replies to inbound email automatically so no lead or message ever slips through the cracks.',
      accent: '#8b5cf6',
      variant: 'email',
      // its demo link is down (041): '' renders unlinked, and the card reads "private app"
      url: '',
      image: '/products/inbox-ai.png',
      preferMockup: undefined,
      stack: ['Next.js', 'Supabase', 'OpenAI'],
      live: false,
    });
    for (const item of items.filter((i) => i.kind === 'product')) {
      const product = toProduct(item);
      expect(product.live, item.slug).toBe(item.url !== null);
      expect(product.url === '' || product.url.startsWith('https://'), item.slug).toBe(true);
    }
    expect(toProduct(items.find((i) => i.slug === 'supernova')!)).toMatchObject({ image: '/products/supernova-dashboard.png', preferMockup: true });
    expect(toProduct(items.find((i) => i.slug === 'elev8te')!).image).toBe(
      'https://s.wordpress.com/mshots/v1/https%3A%2F%2Felev8te-crm.vercel.app?w=1280&h=800',
    );
  });

  it('maps a client site back to ClientCard props with the same mShots capture', () => {
    const hike = fallbackItems(null).find((i) => i.slug === 'hike-wales')!;
    expect(toClientCard(hike)).toEqual({
      site: { url: 'hikewales.com', name: 'Hike Wales', category: 'Travel / 3D', noShot: undefined },
      src: shot('hikewales.com'),
    });
  });

  it('keeps the home strip result tags and its own capture size', () => {
    const home = filterShowcase(fallbackItems(null), { homeOnly: true });
    // Four States Concrete is the eighth home card but sits in 'ready'.
    expect(home.map((i) => i.slug)).toEqual([
      'hike-wales',
      'upscale-rails',
      'colorado-river-expeditions',
      'shira-salon',
      'topcore-it',
      'lumina-comfort',
      'tank-it-easy',
    ]);
    expect(toHomeCard(home[0])).toEqual({
      name: 'Hike Wales',
      domain: 'hikewales.com',
      tag: 'Travel / 3D',
      result: 'WebGL hero',
      image: `https://s.wordpress.com/mshots/v1/${encodeURIComponent('https://hikewales.com')}?w=600&h=420`,
      fallback: undefined,
    });
  });
});

describe('mapShowcaseRow', () => {
  it('builds bucket URLs and a srcset from stored keys', () => {
    const item = mapShowcaseRow(row({ image_key: 'acme/abc123-1280.webp', image_key_small: 'acme/abc123-640.webp', image_source: 'upload' }), SB)!;
    expect(item.imageUrl).toBe(`${SB}/storage/v1/object/public/showcase/acme/abc123-1280.webp`);
    expect(item.imageSrcSet).toBe(
      `${SB}/storage/v1/object/public/showcase/acme/abc123-640.webp 640w, ${SB}/storage/v1/object/public/showcase/acme/abc123-1280.webp 1280w`,
    );
    expect(item.noShot).toBe(false);
  });

  it('refuses image keys that could leave the bucket or run script', () => {
    expect(resolveImageKey('../secret.png', SB)).toBeNull();
    expect(resolveImageKey('a//b.png', SB)).toBeNull();
    expect(resolveImageKey('javascript:alert(1)', SB)).toBeNull();
    expect(resolveImageKey('http://insecure.example/x.png', SB)).toBeNull();
    expect(resolveImageKey('//evil.example/x.png', SB)).toBeNull();
    expect(resolveImageKey('/products/../x.png', SB)).toBeNull();
    expect(resolveImageKey('acme/x.png', null)).toBeNull();
    expect(resolveImageKey('acme/a b.png', SB)).toBe(`${SB}/storage/v1/object/public/showcase/acme/a%20b.png`);
  });

  it('falls back to the mShots capture only for public websites', () => {
    expect(mapShowcaseRow(row(), SB)!.imageUrl).toBe(shot('acme.com'));
    const product = mapShowcaseRow(row({ kind: 'product', mockup_variant: 'crm' }), SB)!;
    expect(product.imageUrl).toBeNull();
    expect(product.noShot).toBe(false);
    const none = mapShowcaseRow(row({ image_source: 'none' }), SB)!;
    expect(none.imageUrl).toBeNull();
    expect(none.noShot).toBe(true);
  });

  it('hides the link of a private app but keeps its host', () => {
    const item = mapShowcaseRow(row({ kind: 'web_app', url: 'https://app.acme.com/login', link_public: false }), SB)!;
    expect(item.url).toBeNull();
    expect(item.host).toBe('app.acme.com/login');
    expect(item.linkPublic).toBe(false);
    expect(toProduct(item)).toMatchObject({ url: '', live: false, host: 'app.acme.com/login' });
    // A private client site renders unlinked (ClientCard reads href: null).
    const site = mapShowcaseRow(row({ url: 'https://acme.com', link_public: false }), SB)!;
    expect(toClientCard(site).site).toMatchObject({ url: 'acme.com', href: null });
  });

  it('points featured case studies at their page from both card kinds', () => {
    const study = { challenge: 'Slow site', outcome: '3x leads' };
    const site = mapShowcaseRow(row({ featured: true, case_study: study }), SB)!;
    expect(toClientCard(site).site.detailHref).toBe('/portfolio/acme');
    const app = mapShowcaseRow(row({ kind: 'product', featured: true, case_study: study }), SB)!;
    expect(toProduct(app).detailHref).toBe('/portfolio/acme');
    // Without a case study, neither card grows the key.
    expect(toClientCard(mapShowcaseRow(row(), SB)!).site).not.toHaveProperty('detailHref');
  });

  it("passes a stored screenshot's srcset to the product card", () => {
    const item = mapShowcaseRow(row({ kind: 'product', image_key: 'acme/1280.webp', image_key_small: 'acme/640.webp' }), SB)!;
    expect(toProduct(item).imageSrcSet).toBe(
      `${SB}/storage/v1/object/public/showcase/acme/640.webp 640w, ${SB}/storage/v1/object/public/showcase/acme/1280.webp 1280w`,
    );
  });

  it('validates what lands in attributes', () => {
    const item = mapShowcaseRow(
      row({ url: 'javascript:alert(1)', accent: 'red;background:url(x)', mockup_variant: 'nope', stack: ['React', 3 as never, ' ', 'Supabase'] }),
      SB,
    )!;
    expect(item.url).toBeNull();
    expect(item.accent).toBeNull();
    expect(item.mockupVariant).toBeNull();
    expect(item.stack).toEqual(['React', 'Supabase']);
    expect(mapShowcaseRow(row({ accent: '#1A6BFF' }), SB)!.accent).toBe('#1A6BFF');
    expect(mapShowcaseRow(row({ url: 'http://legacy.example' }), SB)!.url).toBe('http://legacy.example');
  });

  it('drops unusable rows', () => {
    expect(mapShowcaseRow(null, SB)).toBeNull();
    expect(mapShowcaseRow(row({ slug: 'Bad Slug' }), SB)).toBeNull();
    expect(mapShowcaseRow(row({ kind: 'blog' as never }), SB)).toBeNull();
    expect(mapShowcaseRow(row({ title: '  ' }), SB)).toBeNull();
  });

  it('gives a detail page only to featured items with case-study content', () => {
    const study = { challenge: 'Slow site', outcome: '3x leads', metrics: [{ label: 'Leads', value: '3x' }, { label: 'x' }], quote: { text: 'Great', author: 'Jo' } };
    const featured = mapShowcaseRow(row({ featured: true, case_study: study }), SB)!;
    expect(featured.detailHref).toBe('/portfolio/acme');
    expect(featured.caseStudy).toEqual({
      challenge: 'Slow site',
      approach: null,
      outcome: '3x leads',
      metrics: [{ label: 'Leads', value: '3x' }],
      quote: { text: 'Great', author: 'Jo', role: null },
    });
    expect(mapShowcaseRow(row({ featured: false, case_study: study }), SB)!.detailHref).toBeNull();
    expect(mapShowcaseRow(row({ featured: true, case_study: {} }), SB)!.detailHref).toBeNull();
  });

  it("reads DeskDev's testimonial shape as the quote", () => {
    const item = mapShowcaseRow(
      row({ featured: true, case_study: { testimonial: { quote: 'They delivered', author: 'Ana', role: 'Owner' } } }),
      SB,
    )!;
    expect(item.caseStudy?.quote).toEqual({ text: 'They delivered', author: 'Ana', role: 'Owner' });
    expect(item.detailHref).toBe('/portfolio/acme');
  });

  it('puts featured items first, then curation order', () => {
    const items = mapShowcaseRows(
      [row({ slug: 'a', sort_order: 1 }), row({ slug: 'b', sort_order: 9, featured: true }), row({ slug: 'c', sort_order: 2 })],
      SB,
    );
    expect(items.map((i) => i.slug)).toEqual(['b', 'a', 'c']);
  });

  it('sorts, and keeps the first of duplicate slugs', () => {
    const items = mapShowcaseRows(
      [row({ slug: 'b', title: 'B', sort_order: 2 }), row({ slug: 'a', title: 'A', sort_order: 2 }), row({ slug: 'c', title: 'C', sort_order: 1 }), row({ slug: 'c', title: 'Dup', sort_order: 0 })],
      SB,
    );
    expect(items.map((i) => `${i.slug}:${i.title}`)).toEqual(['c:C', 'a:A', 'b:B']);
  });
});

describe('fetchShowcase', () => {
  it('reads PostgREST as anon with an explicit column list and a 300 s tagged cache', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([row({ slug: 'live-one', title: 'Live One' })]));
    const load = await fetchShowcase(fetchImpl as unknown as typeof fetch, CFG);

    expect(load.source).toBe('live');
    expect(load.items.map((i) => i.slug)).toEqual(['live-one']);
    expect(noStore).not.toHaveBeenCalled();

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit & { next: { revalidate: number; tags: string[] } }];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(`${SB}/rest/v1/showcase_items`);
    expect(u.searchParams.get('select')).toBe(SHOWCASE_SELECT);
    expect(u.searchParams.has('status')).toBe(false);
    expect(init.headers).toEqual({ apikey: CFG.anonKey, Accept: 'application/json', Authorization: `Bearer ${CFG.anonKey}` });
    expect(init.next).toEqual({ revalidate: SHOWCASE_REVALIDATE_SECONDS, tags: [SHOWCASE_TAG] });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.cache).toBeUndefined();
  });

  it('sends a publishable (non-JWT) key only as apikey', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([row()]));
    await fetchShowcase(fetchImpl as unknown as typeof fetch, { supabaseUrl: SB, anonKey: 'sb_publishable_abc' });
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toEqual({ apikey: 'sb_publishable_abc', Accept: 'application/json' });
  });

  const failures: [string, () => Promise<Response>, RegExp][] = [
    ['an error status', async () => jsonResponse({ message: 'permission denied for table showcase_items' }, 401), /HTTP 401/],
    ['a network error', async () => { throw new TypeError('fetch failed'); }, /fetch failed/],
    ['a body that is not an array', async () => jsonResponse({ rows: [] }), /not an array/],
    ['zero rows', async () => jsonResponse([]), /no published rows/],
    ['only unusable rows', async () => jsonResponse([{ slug: 'x' }]), /no usable rows/],
    ['invalid JSON', async () => new Response('<html>paused</html>', { status: 200 }), /JSON|Unexpected/],
  ];

  it.each(failures)('serves the fallback, without failing a cached render, on %s', async (_label, impl, reason) => {
    const load = await fetchShowcase(vi.fn(impl) as unknown as typeof fetch, CFG);
    expect(load.source).toBe('fallback');
    expect(load.reason).toMatch(reason);
    expect(load.items).toHaveLength(76);
    expect(noStore).not.toHaveBeenCalled();
  });

  it('gives up after 3 s and serves the fallback', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const pending = fetchShowcase(fetchImpl as unknown as typeof fetch, CFG);
    await vi.advanceTimersByTimeAsync(SHOWCASE_TIMEOUT_MS - 1);
    expect(warn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const load = await pending;
    expect(load.source).toBe('fallback');
    expect(load.reason).toBe(`timed out after ${SHOWCASE_TIMEOUT_MS} ms`);
    expect(noStore).not.toHaveBeenCalled();
  });

  it('serves the fallback without fetching when the env is unset', async () => {
    const fetchImpl = vi.fn();
    const load = await fetchShowcase(fetchImpl as unknown as typeof fetch, { supabaseUrl: null, anonKey: null });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(load.source).toBe('fallback');
    expect(noStore).not.toHaveBeenCalled();
  });

  it('never remembers a fallback: the next call reads live again', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse([row({ slug: 'back', title: 'Back' })]));
    expect((await fetchShowcase(fetchImpl as unknown as typeof fetch, CFG)).source).toBe('fallback');
    const again = await fetchShowcase(fetchImpl as unknown as typeof fetch, CFG);
    expect(again.source).toBe('live');
    expect(again.items.map((i) => i.slug)).toEqual(['back']);
    // The fallback itself never goes through fetch, so nothing of it can land in the fetch cache.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('getShowcase / getShowcaseItem', () => {
  // No NEXT_PUBLIC_SUPABASE_* in the test env, so these read the fallback.
  it('filters by kind, featured and home', async () => {
    expect(await getShowcase({ kind: 'product' })).toHaveLength(8);
    expect(await getShowcase({ kind: 'website' })).toHaveLength(68);
    expect(await getShowcase({ featuredOnly: true })).toHaveLength(0);
    expect(await getShowcase({ homeOnly: true })).toHaveLength(7);
    expect(await getShowcase()).toHaveLength(76);
  });

  it('finds one published item by slug', async () => {
    expect((await getShowcaseItem('hike-wales'))?.title).toBe('Hike Wales');
    expect(await getShowcaseItem('four-states-concrete')).toBeNull(); // 'ready', not public
    expect(await getShowcaseItem('nope')).toBeNull();
  });
});

describe('snapshot script', () => {
  it('writes rows that read back unchanged, quotes and all', () => {
    const tricky = snapshot.toFallbackRow(
      row({ slug: 'q', title: "O'Neil \\ \"Co\"\nLine", stack: ["it's"], case_study: { challenge: 'a b', metrics: [{ label: 'x', value: '1' }] } }),
    );
    const src = snapshot.renderFallbackModule([tricky]);
    const body = src.slice(src.indexOf('= [') + 2).replace(/;\s*$/, '');
    const back = new Function(`return ${body}`)();
    expect(back).toEqual([tricky]);
  });

  it('drops rows without slug, title or a known kind and fills defaults', () => {
    expect(snapshot.toFallbackRow({ slug: 'a', title: 'A' })).toBeNull();
    expect(snapshot.toFallbackRow({ slug: 'a', title: 'A', kind: 'website' })).toMatchObject({
      link_public: true,
      featured: false,
      stack: [],
      sort_order: 0,
      status: 'published',
    });
  });
});
