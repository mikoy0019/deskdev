import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeftIcon, ArrowUpRightIcon, LockSimpleIcon } from '@phosphor-icons/react/ssr';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { PageHero } from '@/components/site/PageHero';
import { Button } from '@/components/site/Button';
import { Eyebrow } from '@/components/site/Typography';
import { Reveal, RevealMedia, Stagger, StaggerItem } from '@/components/site/motion';
import { Frame } from '@/components/site/portfolio/ProductFeature';
import { PortfolioCta } from '@/components/site/portfolio/PortfolioCta';
import { featureShot, hostedShot, NEW_TAB_NOTE_ID, pad2 } from '@/components/site/portfolio/types';
import { JsonLd } from '@/components/site/JsonLd';
import { SHARED_OPEN_GRAPH, SHARED_TWITTER, breadcrumbJsonLd } from '@/lib/seo';
import { getShowcaseItem, toProduct, type ShowcaseItem } from '@/lib/showcase';
import { CASE_STUDY_FIXTURES } from '@/components/site/portfolio/caseStudyFixture';

// One showcase item's case study, written in DeskDev (showcase_items.case_study,
// 037). Like /portfolio, it re-reads the showcase at most every five minutes,
// so an edit in DeskDev shows here without a deploy.
export const revalidate = 300;

// No generateStaticParams: this route renders per request (its showcase read
// is still the cached fetch). It once had to, because the committed-fallback
// path opted the render out of caching and failed a cached render with a 500;
// src/lib/showcase.ts serveFallback no longer does, so caching it like
// /portfolio is an option now.

type Params = { params: Promise<{ slug: string }> };

/** Only featured items with case-study content have a page (the sitemap lists the same set). */
async function caseStudyOf(slug: string): Promise<ShowcaseItem | null> {
  // The fixtures only exist in the test build, so the screen can be rendered without the live database.
  const item = (await getShowcaseItem(slug)) ?? CASE_STUDY_FIXTURES.find((i) => i.slug === slug) ?? null;
  return item && item.detailHref && item.caseStudy ? item : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const item = await caseStudyOf(slug);
  if (!item) return { title: 'Page not found', robots: { index: false, follow: false } };
  const description = item.summary ?? item.caseStudy?.outcome ?? undefined;
  // The study's own capture when it shows one; otherwise the site's share image.
  // A page's openGraph replaces the layout's whole object, so the shared fields
  // (site name, type, locale) are spread back in, and the Twitter card is set
  // to match instead of keeping the layout's generic one.
  const capture = item.imageUrl && !item.preferMockup && !item.noShot ? { url: item.imageUrl, alt: item.imageAlt } : null;
  const images = capture ? [capture] : [...SHARED_OPEN_GRAPH.images];
  return {
    title: item.title,
    description,
    alternates: { canonical: `/portfolio/${item.slug}` },
    openGraph: { ...SHARED_OPEN_GRAPH, title: item.title, description, url: `/portfolio/${item.slug}`, images },
    twitter: { ...SHARED_TWITTER, title: item.title, description, images },
  };
}

const KIND_LABEL: Record<ShowcaseItem['kind'], string> = {
  website: 'Website',
  web_app: 'Web app',
  product: 'In-house product',
};

/** "2026-03-14" → "March 2026"; anything unparseable is left out. */
function monthOf(date: string | null): string | null {
  if (!date) return null;
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Hairlines of the results grid (two across, three from lg) for the cell at
 * index `i`: a rule on the left of every cell but the first of its row, a
 * rule above every row but the first.
 */
const metricRules = (i: number) =>
  [
    i % 2 === 1 ? 'border-l border-line pl-5 max-lg:sm:pl-8' : 'max-lg:pr-5 max-lg:sm:pr-8',
    i >= 2 ? 'border-t border-line' : '',
    i % 3 === 0 ? 'lg:border-l-0 lg:pl-0 lg:pr-8' : 'lg:border-l lg:border-line lg:px-8',
    i === 2 ? 'lg:border-t-0' : '',
  ].join(' ');

/** Blank lines in the stored text are paragraph breaks. */
const paragraphs = (text: string) =>
  text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

export default async function CaseStudy({ params }: Params) {
  const { slug } = await params;
  const item = await caseStudyOf(slug);
  if (!item || !item.caseStudy) notFound();
  const study = item.caseStudy;

  const launched = monthOf(item.launchedOn);
  const facts = [
    { label: 'Type', value: KIND_LABEL[item.kind] },
    item.industry ? { label: 'Industry', value: item.industry } : null,
    item.resultTag ? { label: 'Result', value: item.resultTag } : null,
    launched ? { label: 'Launched', value: launched } : null,
  ].filter((f): f is { label: string; value: string } => f !== null);

  const parts = [
    { title: 'The challenge', body: study.challenge },
    { title: 'The approach', body: study.approach },
    { title: 'The outcome', body: study.outcome },
  ].filter((p): p is { title: string; body: string } => Boolean(p.body));

  // A website shows its own hero capture, plain. A product or app goes in the
  // browser frame when we host a capture of it. With no capture the page goes
  // straight from the hero to the results: no stand-in is drawn.
  const siteShot = item.kind === 'website' && item.imageUrl && !item.noShot ? featureShot(item.imageUrl) : null;
  const product = item.kind === 'website' ? null : { ...toProduct(item), imageSrcSet: item.imageSrcSet, imageAlt: item.imageAlt, host: item.host };
  const appShot = product ? hostedShot(product) : null;

  // The last row of the results grid is padded with empty ruled cells, so the
  // hairlines run the full width instead of stopping at the last figure.
  const metricCount = study.metrics.length;
  const padBelowLg = metricCount > 2 && metricCount % 2 === 1 ? 1 : 0;
  const padFromLg = metricCount > 3 ? (3 - (metricCount % 3)) % 3 : 0;

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <Navbar />

      <main className="flex-1">
        {/* Home > Portfolio > this case study. The layout names the fixed pages from the path
            alone; this trail needs the item's title, so the page renders it. */}
        <JsonLd data={breadcrumbJsonLd([{ name: 'Portfolio', path: '/portfolio' }, { name: item.title, path: `/portfolio/${item.slug}` }])} />
        <span id={NEW_TAB_NOTE_ID} hidden>
          Opens in a new tab
        </span>

        {/* ═══════════════ HERO ═══════════════ */}
        <PageHero
          eyebrow={
            <Link
              href="/portfolio"
              className="nx-link nx-mono group/back min-h-11 touch-manipulation text-[0.75rem] tracking-[0.08em] text-fg-2 uppercase [-webkit-tap-highlight-color:transparent]"
            >
              <ArrowLeftIcon
                size={14}
                aria-hidden
                className="shrink-0 transition-[translate] duration-200 ease-out motion-safe:[@media(hover:hover)_and_(pointer:fine)]:group-hover/back:-translate-x-0.5"
              />
              <span>Portfolio</span>
            </Link>
          }
          title={item.title}
          lede={item.summary ?? undefined}
          actions={
            item.url ? (
              <Button
                href={item.url}
                target="_blank"
                rel="noreferrer noopener"
                aria-describedby={NEW_TAB_NOTE_ID}
                variant="primary"
                size="lg"
                icon={<ArrowUpRightIcon size={18} aria-hidden />}
              >
                Visit the live site
              </Button>
            ) : item.host ? (
              <p className="nx-mono inline-flex min-h-11 items-center gap-2 text-[0.8125rem] tracking-[0.04em] text-fg-3">
                <LockSimpleIcon size={14} aria-hidden className="shrink-0" />
                Private app. Demo on request.
              </p>
            ) : undefined
          }
          aside={
            <dl className="border-t border-line">
              {facts.map((fact) => (
                <div key={fact.label} className="flex items-baseline justify-between gap-6 border-b border-line py-4">
                  <dt className="nx-eyebrow">{fact.label}</dt>
                  <dd className="text-right text-[0.9375rem] text-fg">{fact.value}</dd>
                </div>
              ))}
              {item.stack.length > 0 && (
                <div className="border-b border-line py-4">
                  <dt className="nx-eyebrow">Stack</dt>
                  <dd className="mt-3">
                    <ul className="flex flex-wrap gap-2">
                      {item.stack.map((tech) => (
                        <li key={tech} className="nx-tag">
                          {tech}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
            </dl>
          }
        />

        {/* ═══════════════ CAPTURE ═══════════════ */}
        {(siteShot || (product && appShot)) && (
          <section className="pb-[var(--nx-section)]">
            <div className="nx-wrap">
              {siteShot ? (
                <Reveal variant="clip">
                  <div className="relative aspect-video overflow-hidden rounded-[var(--nx-radius-lg)] border border-line bg-surface-2 shadow-[var(--shadow-lg)]">
                    <RevealMedia className="absolute inset-0">
                      {/* eslint-disable-next-line @next/next/no-img-element -- remote capture at its own 16:9 ratio, inside the reveal frame */}
                      <img
                        src={siteShot}
                        srcSet={item.imageSrcSet ?? undefined}
                        sizes={item.imageSrcSet ? '(min-width: 1280px) 1200px, 100vw' : undefined}
                        alt={item.imageAlt}
                        width={1280}
                        height={720}
                        decoding="async"
                        className="absolute inset-0 h-full w-full object-cover object-top"
                      />
                    </RevealMedia>
                  </div>
                </Reveal>
              ) : product && appShot ? (
                <Frame product={product} screenshot={appShot} index={0} sizes="(min-width: 1500px) 1360px, 94vw" />
              ) : null}
            </div>
          </section>
        )}

        {/* ═══════════════ RESULTS ═══════════════
            Hairline-ruled figures, two across on phones and three from lg. */}
        {study.metrics.length > 0 && (
          <section className="nx-band border-y border-line" aria-labelledby="results-title">
            <div className="nx-wrap">
              <h2 id="results-title" className="sr-only">
                Results
              </h2>
              <Stagger each={0.08} className="grid grid-cols-2 lg:grid-cols-3">
                {study.metrics.map((metric, i) => (
                  <StaggerItem
                    key={`${metric.label}-${i}`}
                    className={`flex min-w-0 flex-col gap-3 py-10 md:py-14 ${metricRules(i)}`}
                  >
                    <span className="nx-numeral text-[clamp(2.25rem,5vw,4.25rem)] tabular-nums [overflow-wrap:anywhere]">{metric.value}</span>
                    <span className="nx-eyebrow">{metric.label}</span>
                  </StaggerItem>
                ))}
                {Array.from({ length: Math.max(padBelowLg, padFromLg) }, (_, k) => (
                  <StaggerItem
                    key={`pad-${k}`}
                    aria-hidden
                    className={`${k < padBelowLg ? '' : 'max-lg:hidden'} ${k < padFromLg ? '' : 'lg:hidden'} ${metricRules(metricCount + k)}`}
                  />
                ))}
              </Stagger>
            </div>
          </section>
        )}

        {/* ═══════════════ STORY ═══════════════
            A ledger, not cards: each part is one hairline-ruled row, its
            title held in the left columns while the text runs on the right. */}
        {parts.length > 0 && (
          <section className="nx-section" aria-label="Case study">
            <div className="nx-wrap">
              {parts.map((part, i) => (
                <Reveal key={part.title}>
                  <article className="grid gap-x-16 gap-y-6 border-t border-line py-[clamp(2.5rem,6vw,5rem)] lg:grid-cols-12">
                    <div className="lg:col-span-4">
                      <p className="nx-mono text-[0.75rem] tabular-nums text-fg-3" aria-hidden>
                        <span className="text-fg-2">{pad2(i + 1)}</span> / {pad2(parts.length)}
                      </p>
                      <h2 className="nx-h2 mt-4 text-[clamp(1.75rem,3vw,2.75rem)]">{part.title}</h2>
                    </div>
                    <div className="flex max-w-[62ch] flex-col gap-5 lg:col-span-8">
                      {paragraphs(part.body).map((p, n) => (
                        <p key={n} className={`text-pretty ${n === 0 ? 'nx-lede' : 'nx-body'}`}>
                          {p}
                        </p>
                      ))}
                    </div>
                  </article>
                </Reveal>
              ))}
            </div>
          </section>
        )}

        {/* ═══════════════ QUOTE ═══════════════ */}
        {study.quote && (
          <section className="nx-section nx-band border-t border-line" aria-label="Client quote">
            <div className="nx-wrap">
              <Reveal>
                <figure className="max-w-4xl">
                  <Eyebrow className="mb-8 text-accent-text">In their words</Eyebrow>
                  <blockquote className="font-heading text-[clamp(1.5rem,3vw,2.5rem)] leading-[1.25] font-medium tracking-[-0.02em] text-balance text-fg">
                    “{study.quote.text}”
                  </blockquote>
                  <figcaption className="mt-8 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-line pt-5">
                    <span className="text-[0.9375rem] font-medium text-fg">{study.quote.author}</span>
                    {study.quote.role && <span className="nx-mono text-[0.75rem] text-fg-3">{study.quote.role}</span>}
                  </figcaption>
                </figure>
              </Reveal>
            </div>
          </section>
        )}

        <PortfolioCta />
      </main>

      <Footer />
    </div>
  );
}
