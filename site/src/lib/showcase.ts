// The public showcase (/portfolio, the home strip, the sitemap): server-only
// reads of DeskDev's showcase_items (037).
//
// - Anon PostgREST with an explicit column list: under column grants
//   `select=*` is a permission error, and anon is never granted consent,
//   notes, client or project ids. No status filter either: anon has no grant
//   on `status`, and the RLS policy (status='published' AND link_status<>'down')
//   already does that filtering.
// - One cached request for everything (revalidate 300, tag 'showcase', so a
//   later revalidateTag('showcase') can flush it); every view filters in memory.
// - Any failure (unset env, 3 s timeout, error status, bad body, zero rows)
//   serves the committed fallback (src/content/showcase-fallback.ts, refreshed
//   by scripts/showcase-snapshot.mjs before each build), so a Supabase outage
//   can't blank the portfolio. The page holding the fallback is cached like
//   any other (see serveFallback); the failed request itself is not — Next.js
//   only stores a fetch when it answered 200 — so the next render reads live.
//
// No privileged key ever reaches this file (PLAN rule 5): the anon key is the
// same public value the browser bundle already carries.

import { cache } from 'react';
import type { MockupVariant } from '../components/site/portfolio/AppMockup';
import type { ClientSite, Product } from '../components/site/portfolio/types';
import { SHOWCASE_FALLBACK } from '../content/showcase-fallback';

/* ═══════════════ ROW (what PostgREST returns) ═══════════════ */

/** The columns anon is granted. Keep in sync with scripts/showcase-snapshot.mjs (a test checks). */
export const SHOWCASE_COLUMNS = [
  'slug',
  'kind',
  'title',
  'url',
  'link_public',
  'industry',
  'summary',
  'result_tag',
  'stack',
  'accent',
  'mockup_variant',
  'image_key',
  'image_key_small',
  'image_alt',
  'image_source',
  'case_study',
  'featured',
  'home_featured',
  'sort_order',
  'launched_on',
  'published_at',
] as const;

/**
 * 037 grants anon `public_url` (url only when link_public), never `url`, so a
 * private app's address cannot leak. PostgREST's alias keeps the row key `url`.
 */
export const SHOWCASE_SELECT = SHOWCASE_COLUMNS.map((col) => (col === 'url' ? 'url:public_url' : col)).join(',');

export type ShowcaseKind = 'website' | 'web_app' | 'product';

/**
 * Where an item's image comes from. Stored in `image_source`; when it is null
 * the key's shape decides (a '/' path is a file in /public, an https URL is
 * used as is, anything else is a key in the 'showcase' bucket).
 * - `mockup`: render the themed AppMockup even though `image_key` is set (the
 *   capture is only a sign-in screen; the file stays for when it's replaced)
 * - `none`: the capture is known to show an error page; render the monogram
 * - `mshots`: no stored image yet; a website falls back to an mShots capture
 *   of its URL until the screenshot backfill lands
 */
export type ShowcaseImageSource = 'upload' | 'capture' | 'local' | 'mshots' | 'mockup' | 'none';

export interface ShowcaseRow {
  slug: string;
  kind: ShowcaseKind;
  title: string;
  url: string | null;
  link_public: boolean | null;
  industry: string | null;
  summary: string | null;
  result_tag: string | null;
  stack: string[] | null;
  accent: string | null;
  mockup_variant: string | null;
  image_key: string | null;
  image_key_small: string | null;
  image_alt: string | null;
  image_source: string | null;
  case_study: unknown;
  featured: boolean | null;
  home_featured: boolean | null;
  sort_order: number | null;
  launched_on: string | null;
  published_at: string | null;
}

/** A fallback row: the public columns plus the status the row had when written. */
export interface ShowcaseFallbackRow extends ShowcaseRow {
  status: 'published' | 'ready' | 'draft' | 'hidden' | 'archived';
}

/* ═══════════════ ITEM (what the site renders) ═══════════════ */

/**
 * `case_study` jsonb. Every field optional; DeskDev writes it. The testimonial
 * arrives as `testimonial: { quote, author, role }` (DeskDev's
 * ShowcaseCaseStudy) or the older `quote: { text, author, role }`.
 */
export interface ShowcaseCaseStudy {
  challenge: string | null;
  approach: string | null;
  outcome: string | null;
  metrics: { label: string; value: string }[];
  quote: { text: string; author: string; role: string | null } | null;
}

export interface ShowcaseItem {
  slug: string;
  kind: ShowcaseKind;
  title: string;
  /** Absolute http(s) URL, or null when there is none or `link_public` is off
   *  (a login-gated app: "Private app — demo on request"). */
  url: string | null;
  /** "hikewales.com" — for display, even when the link itself is private. */
  host: string | null;
  linkPublic: boolean;
  industry: string;
  summary: string | null;
  resultTag: string | null;
  stack: string[];
  /** `#rrggbb`-style colour, validated (it lands in style attributes). */
  accent: string | null;
  mockupVariant: MockupVariant | null;
  /** Best image: the 1280w file, else the 640w, else a local or legacy capture. */
  imageUrl: string | null;
  /** `<640w url> 640w, <1280w url> 1280w` when both stored sizes exist. */
  imageSrcSet: string | null;
  imageAlt: string;
  /** Render the themed AppMockup instead of the image. */
  preferMockup: boolean;
  /** The capture is known to be broken: render the monogram. */
  noShot: boolean;
  caseStudy: ShowcaseCaseStudy | null;
  /** `/portfolio/<slug>` for featured items with case-study content, else null. */
  detailHref: string | null;
  featured: boolean;
  homeFeatured: boolean;
  sortOrder: number;
  launchedOn: string | null;
  publishedAt: string | null;
}

export type ShowcaseSource = 'live' | 'fallback';

export interface ShowcaseLoad {
  items: ShowcaseItem[];
  source: ShowcaseSource;
  /** Why the fallback was served (logged; never shown to visitors). */
  reason?: string;
}

/* ═══════════════ MAPPER ═══════════════ */

const KINDS: readonly ShowcaseKind[] = ['website', 'web_app', 'product'];
const VARIANTS: readonly MockupVariant[] = ['dashboard', 'crm', 'email', 'invoicing', 'inventory', 'ops', 'pos', 'delivery'];
const IMAGE_SOURCES: readonly ShowcaseImageSource[] = ['upload', 'capture', 'local', 'mshots', 'mockup', 'none'];
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const ACCENT_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const LOCAL_PATH_RE = /^\/(?!\/)[\w./-]+$/;

export const SHOWCASE_BUCKET = 'showcase';

function str(v: unknown, max = 2000): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function httpUrl(v: unknown): string | null {
  const s = str(v, 2048);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href.replace(/\/$/, '') : null;
  } catch {
    return null;
  }
}

/** "https://supernova-dashboard.vercel.app/" → "supernova-dashboard.vercel.app" (same rule as the cards' hostOf). */
export function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/** The legacy hotlinked hero capture the cards use today (640x360, 16:9). */
export function mshotsUrl(url: string, w = 640, h = 360): string {
  return `https://s.wordpress.com/mshots/v1/${encodeURIComponent(url)}?w=${w}&h=${h}`;
}

/** Public URL of a key in the 'showcase' bucket; null for anything that could escape it. */
export function storageUrl(key: string, supabaseUrl: string | null): string | null {
  if (!supabaseUrl) return null;
  const parts = key.split('/');
  if (parts.some((p) => !p || p === '.' || p === '..')) return null;
  return `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${SHOWCASE_BUCKET}/${parts.map(encodeURIComponent).join('/')}`;
}

/** A stored image key → URL: a /public path, an https URL, or a bucket key. */
export function resolveImageKey(key: unknown, supabaseUrl: string | null): string | null {
  const k = str(key, 1024);
  if (!k) return null;
  if (k.startsWith('/')) return LOCAL_PATH_RE.test(k) && !k.includes('..') ? k : null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(k)) return k.startsWith('https://') && httpUrl(k) ? k : null;
  return storageUrl(k, supabaseUrl);
}

function caseStudyOf(v: unknown): ShowcaseCaseStudy | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const metrics = Array.isArray(o.metrics)
    ? o.metrics
        .map((m) => {
          if (!m || typeof m !== 'object') return null;
          const label = str((m as Record<string, unknown>).label, 80);
          const value = str((m as Record<string, unknown>).value, 40);
          return label && value ? { label, value } : null;
        })
        .filter((m): m is { label: string; value: string } => m !== null)
        .slice(0, 6)
    : [];
  let quote: ShowcaseCaseStudy['quote'] = null;
  if (o.quote && typeof o.quote === 'object' && !Array.isArray(o.quote)) {
    const q = o.quote as Record<string, unknown>;
    const text = str(q.text, 600);
    const author = str(q.author, 120);
    if (text && author) quote = { text, author, role: str(q.role, 120) };
  }
  if (!quote && o.testimonial && typeof o.testimonial === 'object' && !Array.isArray(o.testimonial)) {
    const t = o.testimonial as Record<string, unknown>;
    const text = str(t.quote, 600);
    const author = str(t.author, 120);
    if (text && author) quote = { text, author, role: str(t.role, 120) };
  }
  const study: ShowcaseCaseStudy = {
    challenge: str(o.challenge, 4000),
    approach: str(o.approach, 4000),
    outcome: str(o.outcome, 4000),
    metrics,
    quote,
  };
  return study.challenge || study.approach || study.outcome || metrics.length || quote ? study : null;
}

/**
 * One PostgREST (or fallback) row → the item the site renders, or null when
 * the row is unusable. Everything is validated: this is the boundary where
 * database text becomes HTML attributes.
 */
export function mapShowcaseRow(raw: unknown, supabaseUrl: string | null): ShowcaseItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Partial<Record<keyof ShowcaseRow, unknown>>;

  const slug = typeof row.slug === 'string' && SLUG_RE.test(row.slug) ? row.slug : null;
  const kind = KINDS.find((k) => k === row.kind) ?? null;
  const title = str(row.title, 120);
  if (!slug || !kind || !title) return null;

  const fullUrl = httpUrl(row.url);
  const linkPublic = row.link_public !== false;
  const source = IMAGE_SOURCES.find((s) => s === row.image_source) ?? null;

  const large = resolveImageKey(row.image_key, supabaseUrl);
  const small = resolveImageKey(row.image_key_small, supabaseUrl);
  let imageUrl = source === 'none' ? null : (large ?? small);
  // No stored image yet: a public website keeps today's mShots capture until
  // the backfill uploads one (products and apps get the mockup instead).
  if (!imageUrl && source !== 'none' && kind === 'website' && fullUrl && linkPublic) imageUrl = mshotsUrl(fullUrl);
  const imageSrcSet = source !== 'none' && large && small && large !== small ? `${small} 640w, ${large} 1280w` : null;

  const caseStudy = caseStudyOf(row.case_study);
  const featured = row.featured === true;
  const sortOrder = typeof row.sort_order === 'number' && Number.isFinite(row.sort_order) ? row.sort_order : 0;

  return {
    slug,
    kind,
    title,
    url: linkPublic ? fullUrl : null,
    host: fullUrl ? hostOf(fullUrl) : null,
    linkPublic,
    industry: str(row.industry, 80) ?? '',
    summary: str(row.summary, 400),
    resultTag: str(row.result_tag, 60),
    stack: Array.isArray(row.stack)
      ? row.stack.map((s) => str(s, 40)).filter((s): s is string => s !== null).slice(0, 12)
      : [],
    accent: typeof row.accent === 'string' && ACCENT_RE.test(row.accent.trim()) ? row.accent.trim() : null,
    mockupVariant: VARIANTS.find((v) => v === row.mockup_variant) ?? null,
    imageUrl,
    imageSrcSet,
    imageAlt: str(row.image_alt, 300) ?? (kind === 'website' ? `${title} website` : `${title} screenshot`),
    preferMockup: source === 'mockup',
    noShot: source === 'none' || (!imageUrl && kind === 'website'),
    caseStudy,
    detailHref: featured && caseStudy ? `/portfolio/${slug}` : null,
    featured,
    homeFeatured: row.home_featured === true,
    sortOrder,
    launchedOn: str(row.launched_on, 32),
    publishedAt: str(row.published_at, 40),
  };
}

export function mapShowcaseRows(rows: readonly unknown[], supabaseUrl: string | null): ShowcaseItem[] {
  const seen = new Set<string>();
  const items: ShowcaseItem[] = [];
  for (const row of rows) {
    const item = mapShowcaseRow(row, supabaseUrl);
    if (!item || seen.has(item.slug)) continue;
    seen.add(item.slug);
    items.push(item);
  }
  // Featured first, then curation order: the order DeskDev's compareShowcase shows.
  return items.sort(
    (a, b) => Number(b.featured) - Number(a.featured) || a.sortOrder - b.sortOrder || a.title.localeCompare(b.title),
  );
}

/* ═══════════════ ADAPTERS (the existing card props) ═══════════════ */

/**
 * ProductFeature's `product` prop. The optional keys appear only when they
 * add something, so a legacy row maps to exactly the props the page passed
 * when the data was hardcoded.
 */
export function toProduct(item: ShowcaseItem): Product {
  return {
    name: item.title,
    category: item.industry,
    blurb: item.summary ?? '',
    accent: item.accent ?? '#1a6bff',
    variant: item.mockupVariant ?? 'dashboard',
    // ProductFeature only links values starting with 'http'; '' renders unlinked.
    url: item.url ?? '',
    image: item.imageUrl,
    preferMockup: item.preferMockup || undefined,
    stack: item.stack,
    live: item.url !== null,
    // A private app still names its host ("Private app — demo on request").
    ...(item.url === null && item.host ? { host: item.host } : {}),
    ...(item.imageSrcSet ? { imageSrcSet: item.imageSrcSet } : {}),
    ...(item.detailHref ? { detailHref: item.detailHref } : {}),
  };
}

/**
 * ClientCard's `site` and `src` props (`site.url` is the bare host, as today).
 * `href: null` when the link is private; `detailHref` when the item has a
 * case-study page, which the card then opens instead of the live site.
 */
export function toClientCard(item: ShowcaseItem): { site: ClientSite; src: string } {
  return {
    site: {
      url: item.host ?? '',
      name: item.title,
      category: item.industry,
      noShot: item.noShot || undefined,
      ...(item.url === null ? { href: null } : {}),
      ...(item.detailHref ? { detailHref: item.detailHref } : {}),
    },
    src: item.imageUrl ?? '',
  };
}

/** True for an mShots capture URL (the hotlinked, sometimes-broken kind). */
export function isMshots(url: string | null | undefined): boolean {
  return Boolean(url?.startsWith('https://s.wordpress.com/mshots/'));
}

/** The home page's "selected work" card shape. */
export function toHomeCard(item: ShowcaseItem): {
  name: string;
  domain: string;
  tag: string;
  result: string;
  image: string;
  fallback?: boolean;
} {
  return {
    name: item.title,
    domain: item.host ?? '',
    tag: item.industry,
    result: item.resultTag ?? '',
    image: item.imageUrl ? (isMshots(item.imageUrl) && item.url ? mshotsUrl(item.url, 600, 420) : item.imageUrl) : '',
    fallback: !item.imageUrl || undefined,
  };
}

/* ═══════════════ LOADER ═══════════════ */

export const SHOWCASE_TAG = 'showcase';
export const SHOWCASE_REVALIDATE_SECONDS = 300;
export const SHOWCASE_TIMEOUT_MS = 3000;

interface ShowcaseConfig {
  supabaseUrl: string | null;
  anonKey: string | null;
}

function showcaseConfig(): ShowcaseConfig {
  // Literal process.env.NEXT_PUBLIC_* so the build inlines them.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || null;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || null;
  return { supabaseUrl: supabaseUrl ? supabaseUrl.replace(/\/+$/, '') : null, anonKey };
}

export function showcaseRequest(cfg: { supabaseUrl: string; anonKey: string }): { url: string; headers: Record<string, string> } {
  const url = new URL('/rest/v1/showcase_items', cfg.supabaseUrl);
  url.searchParams.set('select', SHOWCASE_SELECT);
  url.searchParams.set('order', 'sort_order.asc,slug.asc');
  const headers: Record<string, string> = { apikey: cfg.anonKey, Accept: 'application/json' };
  // Legacy anon keys are JWTs and also go in Authorization; the newer
  // sb_publishable_ keys aren't JWTs and must not.
  if (cfg.anonKey.startsWith('eyJ')) headers.Authorization = `Bearer ${cfg.anonKey}`;
  return { url: url.toString(), headers };
}

/** The committed fallback, as anon would see it: published rows only. */
export function fallbackItems(supabaseUrl: string | null = showcaseConfig().supabaseUrl): ShowcaseItem[] {
  return mapShowcaseRows(
    SHOWCASE_FALLBACK.filter((r) => r.status === 'published'),
    supabaseUrl,
  );
}

function serveFallback(reason: string, supabaseUrl: string | null): ShowcaseLoad {
  // Cached like the live page, on purpose. Opting out (noStore()) inside a
  // cached render — home and /portfolio re-rendering after their 5 minutes,
  // or rendering on a cache miss — makes Next.js fail the page with
  // DYNAMIC_SERVER_USAGE: visitors got a 500 instead of this fallback
  // whenever Supabase answered slower than SHOWCASE_TIMEOUT_MS. The price is
  // that the fallback can stay up for one revalidate window after Supabase
  // recovers.
  console.warn(`[showcase] serving the committed fallback: ${reason}`);
  return { items: fallbackItems(supabaseUrl), source: 'fallback', reason };
}

/**
 * Fetches the published showcase. Never throws; on any failure returns the
 * fallback with `source: 'fallback'`. Exported uncached for tests; pages use
 * loadShowcase (memoised per request).
 */
export async function fetchShowcase(fetchImpl: typeof fetch = fetch, cfg: ShowcaseConfig = showcaseConfig()): Promise<ShowcaseLoad> {
  if (!cfg.supabaseUrl || !cfg.anonKey) return serveFallback('Supabase env not set', cfg.supabaseUrl);

  const { url, headers } = showcaseRequest({ supabaseUrl: cfg.supabaseUrl, anonKey: cfg.anonKey });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SHOWCASE_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      headers,
      signal: controller.signal,
      next: { revalidate: SHOWCASE_REVALIDATE_SECONDS, tags: [SHOWCASE_TAG] },
    } as RequestInit);
    if (!res.ok) return serveFallback(`HTTP ${res.status}`, cfg.supabaseUrl);
    const body: unknown = await res.json();
    if (!Array.isArray(body)) return serveFallback('response is not an array', cfg.supabaseUrl);
    const items = mapShowcaseRows(body, cfg.supabaseUrl);
    // Zero rows is a misconfiguration (grants, policy, an unapplied
    // migration), never a showcase someone emptied on purpose.
    if (items.length === 0) return serveFallback(body.length ? 'no usable rows' : 'no published rows', cfg.supabaseUrl);
    return { items, source: 'live' };
  } catch (err) {
    const reason = controller.signal.aborted ? `timed out after ${SHOWCASE_TIMEOUT_MS} ms` : err instanceof Error ? err.message : String(err);
    return serveFallback(reason, cfg.supabaseUrl);
  } finally {
    clearTimeout(timer);
  }
}

/** One fetch per request, however many components ask. */
export const loadShowcase = cache(() => fetchShowcase());

export interface ShowcaseQuery {
  kind?: ShowcaseKind;
  /** Only `featured` items. */
  featuredOnly?: boolean;
  /** Only `home_featured` items (the home page strip). */
  homeOnly?: boolean;
}

export function filterShowcase(items: readonly ShowcaseItem[], q: ShowcaseQuery = {}): ShowcaseItem[] {
  return items.filter(
    (i) => (!q.kind || i.kind === q.kind) && (!q.featuredOnly || i.featured) && (!q.homeOnly || i.homeFeatured),
  );
}

/** Published showcase items in display order. Never throws, never empty while the fallback has rows. */
export async function getShowcase(q: ShowcaseQuery = {}): Promise<ShowcaseItem[]> {
  return filterShowcase((await loadShowcase()).items, q);
}

/** One published item by slug, or null (the caller answers 404). */
export async function getShowcaseItem(slug: string): Promise<ShowcaseItem | null> {
  return (await loadShowcase()).items.find((i) => i.slug === slug) ?? null;
}
